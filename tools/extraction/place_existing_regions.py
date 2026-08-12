#!/usr/bin/env python3
"""Place immutable local regional GeoJSON with one uniform similarity transform."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from shapely import affinity
from shapely.geometry import MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import unary_union

from region_pipeline import atomic_write_json


ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--countries", type=Path, default=ROOT / "public/data/countries.geojson")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public/data")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def component_at(components: list[Polygon], anchor: list[float], description: str) -> Polygon:
    point = Point(float(anchor[0]), float(anchor[1]))
    matches = [component for component in components if component.covers(point)]
    if len(matches) != 1:
        raise RuntimeError(f"{description} anchor {anchor} matched {len(matches)} components")
    return matches[0]


def rasterize(geometry, bounds: tuple[int, int, int, int]) -> np.ndarray:
    left, top, right, bottom = bounds
    mask = np.zeros((bottom - top + 1, right - left + 1), dtype=np.uint8)
    polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
    for polygon in polygons:
        exterior = np.rint(np.asarray(polygon.exterior.coords) - [left, top]).astype(np.int32)
        cv2.fillPoly(mask, [exterior], 1)
        for interior in polygon.interiors:
            hole = np.rint(np.asarray(interior.coords) - [left, top]).astype(np.int32)
            cv2.fillPoly(mask, [hole], 0)
    return mask


def best_uniform_transform(local_union, target: Polygon) -> tuple[float, float, float]:
    """Maximise raster contour IoU using only uniform scale and translation."""
    lx1, ly1, lx2, ly2 = local_union.bounds
    local_bounds = (int(np.floor(lx1)), int(np.floor(ly1)), int(np.ceil(lx2)), int(np.ceil(ly2)))
    local_mask = rasterize(local_union, local_bounds)

    tx1, ty1, tx2, ty2 = target.bounds
    padding = int(np.ceil(max(tx2 - tx1, ty2 - ty1)))
    search_bounds = (
        max(0, int(np.floor(tx1)) - padding),
        max(0, int(np.floor(ty1)) - padding),
        min(1925, int(np.ceil(tx2)) + padding),
        min(1080, int(np.ceil(ty2)) + padding),
    )
    target_mask = rasterize(target, search_bounds).astype(np.float32)
    target_area = float(target_mask.sum())

    width_ratio = (tx2 - tx1) / (lx2 - lx1)
    height_ratio = (ty2 - ty1) / (ly2 - ly1)
    minimum = min(width_ratio, height_ratio) * 0.6
    maximum = max(width_ratio, height_ratio) * 1.4
    step = 0.0001
    best: tuple[float, float, tuple[int, int]] | None = None
    for scale in np.arange(minimum, maximum + step / 2, step):
        width = max(1, round(local_mask.shape[1] * scale))
        height = max(1, round(local_mask.shape[0] * scale))
        if width > target_mask.shape[1] or height > target_mask.shape[0]:
            continue
        candidate = cv2.resize(local_mask, (width, height), interpolation=cv2.INTER_NEAREST).astype(np.float32)
        candidate_area = float(candidate.sum())
        correlation = cv2.matchTemplate(target_mask, candidate, cv2.TM_CCORR)
        _, intersection, _, location = cv2.minMaxLoc(correlation)
        union_area = candidate_area + target_area - float(intersection)
        iou = float(intersection) / max(1.0, union_area)
        if best is None or iou > best[0]:
            best = (iou, float(scale), location)
    if best is None:
        raise RuntimeError("No valid uniform transform candidate")

    _, scale, (match_x, match_y) = best
    offset_x = search_bounds[0] + match_x - local_bounds[0] * scale
    offset_y = search_bounds[1] + match_y - local_bounds[1] * scale
    return scale, offset_x, offset_y


def replace_dataset(path: Path, dataset_id: str, legacy_ids: set[str], features: list[dict]) -> None:
    current = read_json(path) if path.exists() else {"type": "FeatureCollection", "features": []}
    retained = [
        feature for feature in current["features"]
        if feature.get("properties", {}).get("datasetId") != dataset_id
        and feature.get("properties", {}).get("countryId") not in legacy_ids
    ]
    atomic_write_json(path, {"type": "FeatureCollection", "features": retained + features})


def main() -> None:
    args = parse_args()
    config_path = args.config if args.config.is_absolute() else ROOT / args.config
    config = read_json(config_path)
    dataset_id = config["datasetId"]
    country_id = config["parentCountryId"]
    target_component_id = config["targetComponentId"]
    territory_config = config["targetTerritory"]

    countries = read_json(args.countries)
    country = shape(next(
        feature["geometry"] for feature in countries["features"]
        if feature["properties"]["id"] == country_id
    ))
    components = list(country.geoms) if isinstance(country, MultiPolygon) else [country]
    transform_component = component_at(
        components, territory_config["transformComponentAnchorWorld"], "Transform component"
    )
    expected_bounds = territory_config["expectedTransformComponentBoundsWorld"]
    tolerance = float(territory_config.get("boundsToleranceWorld", 0.01))
    if any(abs(a - b) > tolerance for a, b in zip(transform_component.bounds, expected_bounds)):
        raise RuntimeError("Target component bounds changed; refusing silent realignment")
    associated = [
        component_at(components, anchor, "Associated component")
        for anchor in territory_config.get("associatedComponentAnchorsWorld", [])
    ]
    selected = [transform_component, *associated]
    target_territory = unary_union(selected)
    overseas = unary_union([
        component for component in components
        if all(not component.equals(item) for item in selected)
    ])

    source_files = config["geometrySources"]
    local_regions_fc = read_json(config_path.parent / source_files["regions"])
    local_borders_fc = read_json(config_path.parent / source_files["borders"])
    local_labels_fc = read_json(config_path.parent / source_files["labels"])
    local_regions = [shape(feature["geometry"]) for feature in local_regions_fc["features"]]
    local_union = unary_union(local_regions)
    scale, offset_x, offset_y = best_uniform_transform(local_union, transform_component)

    def to_world(geometry):
        return affinity.affine_transform(geometry, [scale, 0, 0, scale, offset_x, offset_y])

    region_features = []
    world_by_number = {}
    for source in local_regions_fc["features"]:
        feature = json.loads(json.dumps(source))
        geometry = to_world(shape(source["geometry"]))
        feature["geometry"] = mapping(geometry)
        feature["properties"]["areaWorld"] = geometry.area
        feature["properties"]["countryId"] = country_id
        feature["properties"]["targetComponentId"] = target_component_id
        feature["properties"]["datasetId"] = dataset_id
        region_features.append(feature)
        world_by_number[int(feature["properties"]["number"])] = geometry

    border_features = []
    for source in local_borders_fc["features"]:
        feature = json.loads(json.dumps(source))
        feature["geometry"] = mapping(to_world(shape(source["geometry"])))
        feature["properties"].update({
            "countryId": country_id, "targetComponentId": target_component_id, "datasetId": dataset_id,
        })
        border_features.append(feature)

    label_features = []
    for source in local_labels_fc["features"]:
        feature = json.loads(json.dumps(source))
        feature["geometry"] = mapping(to_world(shape(source["geometry"])))
        feature["properties"].update({
            "countryId": country_id, "targetComponentId": target_component_id, "datasetId": dataset_id,
        })
        label_features.append(feature)

    region_union = unary_union(list(world_by_number.values()))
    intersection = region_union.intersection(target_territory).area
    inside_ratio = intersection / region_union.area
    contour_iou = region_union.intersection(transform_component).area / region_union.union(transform_component).area
    overseas_intersection = region_union.intersection(overseas).area
    wrong_countries = unary_union([
        shape(feature["geometry"]) for feature in countries["features"]
        if feature["properties"]["id"] in config.get("legacyParentCountryIds", [])
    ])
    wrong_intersection = region_union.intersection(wrong_countries).area if not wrong_countries.is_empty else 0.0
    overlap_area = sum(
        first.intersection(second).area
        for index, first in enumerate(world_by_number.values())
        for second in list(world_by_number.values())[index + 1:]
    )
    labels_outside = sum(
        not world_by_number[int(feature["properties"]["number"])].covers(shape(feature["geometry"]))
        for feature in label_features
    )
    settings = config["alignment"]
    failures = []
    if inside_ratio < float(settings["minimumRegionalAreaInsideTerritory"]):
        failures.append("regional geometry is not predominantly inside the selected southwest territory")
    if contour_iou < float(settings["minimumContourIoU"]):
        failures.append("uniform contour-fit IoU is below the configured minimum")
    if overseas_intersection > float(settings["maximumOverseasIntersectionArea"]):
        failures.append("regional geometry intersects an overseas component")
    if wrong_intersection > float(settings["maximumWrongCountryIntersectionArea"]):
        failures.append("regional geometry intersects the legacy parent country")
    if overlap_area > 1e-8:
        failures.append("transformed regions overlap")
    if labels_outside:
        failures.append("one or more transformed labels are outside their regions")
    invalid_count = sum(not geometry.is_valid for geometry in world_by_number.values())
    if invalid_count:
        failures.append("one or more transformed region geometries are invalid")

    source_hash = hashlib.sha256((config_path.parent / source_files["regions"]).read_bytes()).hexdigest()
    validation = {
        "datasetId": dataset_id,
        "parentCountryId": country_id,
        "targetComponentId": target_component_id,
        "geometrySource": source_files["regions"],
        "geometrySourceSha256": source_hash,
        "alignmentAccepted": not failures,
        "alignmentFailures": failures,
        "regionCount": len(region_features),
        "borderFeatureCount": len(border_features),
        "invalidGeometryCount": invalid_count,
        "overlapArea": overlap_area,
        "regionalAreaInsideTargetTerritoryRatio": inside_ratio,
        "contourIntersectionOverUnion": contour_iou,
        "overseasIntersectionArea": overseas_intersection,
        "wrongCountryIntersectionArea": wrong_intersection,
        "labelPointsOutsideRegions": labels_outside,
        "alignment": {
            "method": "uniform similarity transform selected by maximum target-contour IoU",
            "uniformScale": scale,
            "scaleX": scale,
            "scaleY": scale,
            "offsetX": offset_x,
            "offsetY": offset_y,
            "localBounds": list(local_union.bounds),
            "transformedBounds": list(region_union.bounds),
            "targetComponentBoundsWorld": list(transform_component.bounds),
            "sourceCenterLocal": list(local_union.centroid.coords[0]),
            "transformedSourceCenterWorld": list(region_union.centroid.coords[0]),
            "targetCenterWorld": list(transform_component.centroid.coords[0]),
            "preservesAspectRatio": True,
        },
        "targetTerritory": {
            "countryComponentCount": len(components),
            "selectedComponentCount": len(selected),
            "overseasComponentCount": len(components) - len(selected),
            "selectionUsesAreaRanking": False,
            "selectionUsesGeoJsonOrder": False,
        },
    }

    if config.get("debug", {}).get("enabled", False):
        preview = np.full((1080, 1925, 3), (24, 29, 31), dtype=np.uint8)

        def draw(geometry, color, thickness=1):
            polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
            for polygon in polygons:
                points = np.rint(np.asarray(polygon.exterior.coords)).astype(np.int32)
                cv2.polylines(preview, [points], True, color, thickness)

        for component in components:
            draw(component, (120, 130, 135))
        draw(target_territory, (0, 220, 255), 2)
        draw(region_union, (255, 80, 220), 2)
        left, top, right, bottom = region_union.bounds
        cv2.rectangle(preview, (round(left), round(top)), (round(right), round(bottom)), (255, 80, 220), 1)
        source_center = region_union.centroid
        target_center = transform_component.centroid
        cv2.circle(preview, (round(source_center.x), round(source_center.y)), 5, (255, 80, 220), -1)
        cv2.circle(preview, (round(target_center.x), round(target_center.y)), 5, (0, 220, 255), -1)
        cv2.putText(preview, "source center", (round(source_center.x) + 8, round(source_center.y)), cv2.FONT_HERSHEY_SIMPLEX, .4, (255, 80, 220), 1, cv2.LINE_AA)
        cv2.putText(preview, "target center", (round(target_center.x) + 8, round(target_center.y) + 14), cv2.FONT_HERSHEY_SIMPLEX, .4, (0, 220, 255), 1, cv2.LINE_AA)
        debug_dir = ROOT / "public/debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(debug_dir / f"{dataset_id.replace('/', '-')}-world-alignment.png"), preview)
        pad = 30
        crop_left = max(0, int(np.floor(left)) - pad)
        crop_top = max(0, int(np.floor(top)) - pad)
        crop_right = min(preview.shape[1], int(np.ceil(right)) + pad)
        crop_bottom = min(preview.shape[0], int(np.ceil(bottom)) + pad)
        detail = preview[crop_top:crop_bottom, crop_left:crop_right]
        detail = cv2.resize(detail, None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
        cv2.imwrite(str(debug_dir / f"{dataset_id.replace('/', '-')}-world-alignment-detail.png"), detail)

    atomic_write_json(config_path.parent / "regions-validation-report.json", validation)
    if failures:
        raise RuntimeError("Alignment validation failed: " + "; ".join(failures))
    legacy_ids = set(config.get("legacyParentCountryIds", []))
    replace_dataset(args.output_dir / "regions.geojson", dataset_id, legacy_ids, region_features)
    replace_dataset(args.output_dir / "regions-raw-world.geojson", dataset_id, legacy_ids, region_features)
    replace_dataset(args.output_dir / "region-borders.geojson", dataset_id, legacy_ids, border_features)
    replace_dataset(args.output_dir / "region-label-points.geojson", dataset_id, legacy_ids, label_features)
    print(json.dumps(validation, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
