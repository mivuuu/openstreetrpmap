#!/usr/bin/env python3
"""Extract explicitly assigned administrative regions from a clean linework PNG."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from shapely import affinity
from shapely.geometry import GeometryCollection, MultiLineString, MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import unary_union

from region_pipeline import atomic_write_json
from topology import polygons_from_shared_arcs, raster_interface_segments, shared_arcs


ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--countries", type=Path, default=ROOT / "public/data/countries.geojson")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public/data")
    return parser.parse_args()


def polygonal(geometry):
    if isinstance(geometry, (Polygon, MultiPolygon)):
        return geometry
    if isinstance(geometry, GeometryCollection):
        parts = [part for part in geometry.geoms if isinstance(part, Polygon)]
        return unary_union(parts) if parts else GeometryCollection()
    return GeometryCollection()


def collection(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"type": "FeatureCollection", "features": []}
    return json.loads(path.read_text(encoding="utf-8"))


def replace_dataset_features(
    path: Path,
    dataset_id: str,
    legacy_parent_country_ids: set[str],
    features: list[dict[str, Any]],
) -> None:
    current = collection(path)
    retained = [
        feature for feature in current["features"]
        if feature.get("properties", {}).get("datasetId") != dataset_id
        and feature.get("properties", {}).get("countryId") not in legacy_parent_country_ids
    ]
    atomic_write_json(path, {"type": "FeatureCollection", "features": retained + features})


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def component_at(components: list[Polygon], anchor: list[float], description: str) -> Polygon:
    point = Point(float(anchor[0]), float(anchor[1]))
    matches = [component for component in components if component.covers(point)]
    if len(matches) != 1:
        raise RuntimeError(
            f"{description} anchor {anchor} matched {len(matches)} country components; expected exactly one"
        )
    return matches[0]


def bounds_match(actual, expected, tolerance: float) -> bool:
    return all(abs(float(actual[index]) - float(expected[index])) <= tolerance for index in range(4))


def main() -> None:
    args = parse_args()
    config_path = args.config.resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    source_path = config_path.parent / config["source"]
    source = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
    if source is None:
        raise FileNotFoundError(source_path)

    gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
    settings = config["linework"]
    barrier = (gray <= int(settings["darknessThreshold"])).astype(np.uint8)
    close_size = int(settings.get("closeKernel", 1))
    if close_size > 1:
        barrier = cv2.morphologyEx(barrier, cv2.MORPH_CLOSE, np.ones((close_size, close_size), np.uint8))

    passable = (barrier == 0).astype(np.uint8)
    flood = passable.copy()
    flood_mask = np.zeros((source.shape[0] + 2, source.shape[1] + 2), dtype=np.uint8)
    cv2.floodFill(flood, flood_mask, (0, 0), 2)
    outside = flood == 2
    enclosed_land = ~outside
    open_faces = enclosed_land & (barrier == 0)

    face_count, face_labels, face_stats, face_centroids = cv2.connectedComponentsWithStats(
        open_faces.astype(np.uint8), 4
    )
    minimum_area = int(settings["minimumFaceArea"])
    kept_faces = {
        component for component in range(1, face_count)
        if int(face_stats[component, cv2.CC_STAT_AREA]) >= minimum_area
    }
    if config.get("printDetectedFaces"):
        print(json.dumps([
            {
                "component": face,
                "centroid": [round(float(face_centroids[face, 0]), 1), round(float(face_centroids[face, 1]), 1)],
                "area": int(face_stats[face, cv2.CC_STAT_AREA]),
            }
            for face in sorted(kept_faces)
        ], indent=2))
        face_preview = source.copy()
        for face in sorted(kept_faces):
            x, y = np.rint(face_centroids[face]).astype(int)
            cv2.circle(face_preview, (x, y), 18, (0, 0, 255), -1)
            cv2.putText(face_preview, str(face), (x + 22, y + 8), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)
        debug_path = ROOT / "public/debug" / f"{config['parentCountryId']}-detected-faces.png"
        debug_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(debug_path), face_preview)

    region_names = {int(number): name for number, name in config["regionNames"].items()}
    face_to_number: dict[int, int] = {}
    assigned_faces_by_number: dict[int, list[int]] = {number: [] for number in region_names}
    for number_text, seeds in config["regionSeeds"].items():
        number = int(number_text)
        if number not in region_names:
            raise RuntimeError(f"Seed assignment references unknown region {number}")
        for x, y in seeds:
            component = int(face_labels[int(y), int(x)])
            if component not in kept_faces:
                nearest = sorted(
                    (
                        round(float(np.hypot(face_centroids[face, 0] - x, face_centroids[face, 1] - y)), 1),
                        face,
                        [round(float(face_centroids[face, 0]), 1), round(float(face_centroids[face, 1]), 1)],
                    )
                    for face in kept_faces
                )[:3]
                raise RuntimeError(
                    f"Seed ({x}, {y}) for region {number} is not inside a detected face; nearest={nearest}"
                )
            previous = face_to_number.get(component)
            if previous is not None and previous != number:
                raise RuntimeError(f"Face {component} is assigned to both {previous} and {number}")
            face_to_number[component] = number
            if component not in assigned_faces_by_number[number]:
                assigned_faces_by_number[number].append(component)

    missing = sorted(number for number, faces in assigned_faces_by_number.items() if not faces)
    if missing:
        raise RuntimeError(f"Regions without an assigned face: {missing}")

    face_seeds = np.zeros_like(face_labels, dtype=np.int32)
    for component in kept_faces:
        face_seeds[face_labels == component] = component
    distance_input = np.where(face_seeds > 0, 0, 1).astype(np.uint8)
    _, nearest_pixels = cv2.distanceTransformWithLabels(
        distance_input, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL
    )
    nearest_to_component = np.zeros(int(nearest_pixels.max()) + 1, dtype=np.int32)
    seed_pixels = face_seeds > 0
    nearest_to_component[nearest_pixels[seed_pixels]] = face_seeds[seed_pixels]
    nearest_components = nearest_to_component[nearest_pixels]
    number_lookup = np.zeros(face_count, dtype=np.int32)
    for component, number in face_to_number.items():
        number_lookup[component] = number
    labels = np.where(enclosed_land, number_lookup[nearest_components], 0).astype(np.int32)

    countries = collection(args.countries)
    dataset_id = config["datasetId"]
    country_id = config["parentCountryId"]
    parent_feature = next(
        (feature for feature in countries["features"] if feature["properties"]["id"] == country_id), None
    )
    if parent_feature is None:
        raise RuntimeError(f"Parent country not found: {country_id}")
    parent = shape(parent_feature["geometry"])
    components = [parent] if isinstance(parent, Polygon) else list(parent.geoms)
    territory_config = config["targetTerritory"]
    transform_component = component_at(
        components,
        territory_config["transformComponentAnchorWorld"],
        "Transform component",
    )
    expected_component_bounds = territory_config["expectedTransformComponentBoundsWorld"]
    bounds_tolerance = float(territory_config.get("boundsToleranceWorld", 0.01))
    if not bounds_match(transform_component.bounds, expected_component_bounds, bounds_tolerance):
        raise RuntimeError(
            "Target component geometry changed: "
            f"expected bounds {expected_component_bounds}, found {list(transform_component.bounds)}"
        )
    associated_components = [
        component_at(components, anchor, "Associated component")
        for anchor in territory_config.get("associatedComponentAnchorsWorld", [])
    ]
    target_components = [transform_component, *associated_components]
    if len({component.wkb for component in target_components}) != len(target_components):
        raise RuntimeError("Target territory contains duplicate component selectors")
    target_territory = unary_union(target_components)
    overseas_territory = unary_union([
        component for component in components
        if all(not component.equals(target) for target in target_components)
    ])
    local_bounds = config["alignment"]["localLandBoundsPx"]
    world_bounds = list(transform_component.bounds)
    scale_x = (world_bounds[2] - world_bounds[0]) / (local_bounds[2] - local_bounds[0])
    scale_y = (world_bounds[3] - world_bounds[1]) / (local_bounds[3] - local_bounds[1])
    offset_x = world_bounds[0] - local_bounds[0] * scale_x
    offset_y = world_bounds[1] - local_bounds[1] * scale_y

    def to_world(geometry):
        return affinity.affine_transform(geometry, [scale_x, 0, 0, scale_y, offset_x, offset_y])

    extraction = config["extraction"]
    arcs = shared_arcs(
        raster_interface_segments(labels),
        float(extraction["simplificationTolerancePx"]),
        float(extraction["snapTolerancePx"]),
    )
    local_geometries = polygons_from_shared_arcs(labels, arcs)
    pixel_areas = {number: int(np.count_nonzero(labels == number)) for number in region_names}
    area_order = sorted(pixel_areas, key=pixel_areas.get, reverse=True)
    rank_by_number = {
        number: min(3, (index * 3 // max(1, len(area_order))) + 1)
        for index, number in enumerate(area_order)
    }

    region_features: list[dict[str, Any]] = []
    raw_features: list[dict[str, Any]] = []
    label_features: list[dict[str, Any]] = []
    world_geometries: dict[int, Any] = {}
    capital_number = int(config["capitalRegionNumber"])
    target_component_id = config["targetComponentId"]
    dataset_slug = dataset_id.replace("/", "-")
    for number in sorted(region_names):
        local_geometry = local_geometries.get(number)
        if local_geometry is None:
            raise RuntimeError(f"No geometry produced for region {number}")
        raw_geometry = polygonal(to_world(local_geometry))
        world_geometry = raw_geometry
        if world_geometry.is_empty or not world_geometry.is_valid:
            raise RuntimeError(f"Invalid geometry produced for region {number}")
        world_geometries[number] = world_geometry
        region_id = f"{dataset_slug}-region-{number:03d}"
        is_capital = number == capital_number
        properties = {
            "id": region_id,
            "number": number,
            "name": region_names[number],
            "type": "region",
            "countryId": country_id,
            "targetComponentId": target_component_id,
            "datasetId": dataset_id,
            "styleIndex": (number - 1) % 5,
            "isCapital": is_capital,
            "capital": is_capital,
            "labelRank": rank_by_number[number],
            "importance": rank_by_number[number],
            "areaWorld": world_geometry.area,
            "labelPointMethod": "representative-point",
            "source": f"regions/{dataset_id}/{config['source']}",
        }
        feature = {
            "type": "Feature", "id": region_id,
            "properties": properties, "geometry": mapping(world_geometry),
        }
        region_features.append(feature)
        raw_features.append({**feature, "geometry": mapping(raw_geometry)})
        label_features.append({
            "type": "Feature", "id": f"{region_id}-label",
            "properties": properties,
            "geometry": mapping(world_geometry.representative_point()),
        })

    border_features: list[dict[str, Any]] = []
    for (first, second), lines in sorted(arcs.items()):
        if first <= 0 or second <= 0 or first == second:
            continue
        for part_index, line in enumerate(lines, start=1):
            world_line = to_world(line)
            if world_line.is_empty:
                continue
            if isinstance(world_line, GeometryCollection):
                parts = [part for part in world_line.geoms if part.geom_type == "LineString"]
                if not parts:
                    continue
                world_line = parts[0] if len(parts) == 1 else MultiLineString(parts)
            border_id = f"{dataset_slug}-region-border-{first:03d}-{second:03d}-{part_index:03d}"
            border_features.append({
                "type": "Feature", "id": border_id,
                "properties": {
                    "id": border_id, "type": "region-border", "countryId": country_id,
                    "targetComponentId": target_component_id, "datasetId": dataset_id,
                    "leftRegionId": f"{dataset_slug}-region-{first:03d}",
                    "rightRegionId": f"{dataset_slug}-region-{second:03d}",
                },
                "geometry": mapping(world_line),
            })

    overlap_area = 0.0
    numbers = sorted(world_geometries)
    for index, first in enumerate(numbers):
        for second in numbers[index + 1:]:
            overlap_area += world_geometries[first].intersection(world_geometries[second]).area
    region_union = unary_union(list(world_geometries.values()))
    local_region_union = unary_union(list(local_geometries.values()))
    unassigned_faces = sorted(kept_faces - set(face_to_number))
    regional_inside_area = region_union.intersection(target_territory).area
    regional_inside_ratio = regional_inside_area / max(1e-12, region_union.area)
    territory_covered_ratio = regional_inside_area / max(1e-12, target_territory.area)
    contour_iou = regional_inside_area / max(1e-12, region_union.union(target_territory).area)
    overseas_intersection_area = region_union.intersection(overseas_territory).area
    legacy_country_geometries = [
        shape(feature["geometry"])
        for feature in countries["features"]
        if feature["properties"]["id"] in set(config.get("legacyParentCountryIds", []))
    ]
    wrong_country_intersection_area = (
        region_union.intersection(unary_union(legacy_country_geometries)).area
        if legacy_country_geometries else 0.0
    )
    label_points_outside_regions = sum(
        not world_geometries[feature["properties"]["number"]].covers(shape(feature["geometry"]))
        for feature in label_features
    )
    local_topology_hash = hashlib.sha256(
        b"".join(local_geometries[number].wkb for number in sorted(local_geometries))
    ).hexdigest()
    transform_integrity_ratio = (
        region_union.area / max(1e-12, local_region_union.area * scale_x * scale_y)
    )
    alignment_settings = config["alignment"]
    alignment_failures = []
    if regional_inside_ratio < float(alignment_settings["minimumRegionalAreaInsideTerritory"]):
        alignment_failures.append("regional geometry is not predominantly inside target territory")
    if contour_iou < float(alignment_settings["minimumContourIoU"]):
        alignment_failures.append("regional contour IoU is below the configured minimum")
    if overseas_intersection_area > float(alignment_settings["maximumOverseasIntersectionArea"]):
        alignment_failures.append("regional geometry intersects an overseas component")
    if wrong_country_intersection_area > float(alignment_settings["maximumWrongCountryIntersectionArea"]):
        alignment_failures.append("regional geometry still intersects a legacy/wrong parent country")
    if label_points_outside_regions:
        alignment_failures.append("one or more label points are outside their regions")
    if abs(transform_integrity_ratio - 1.0) > 1e-8:
        alignment_failures.append("the common affine transform changed relative regional geometry")
    validation = {
        "datasetId": dataset_id,
        "parentCountryId": country_id,
        "targetComponentId": target_component_id,
        "sourceSha256": sha256(source_path),
        "imageSize": [source.shape[1], source.shape[0]],
        "detectedFaceCount": len(kept_faces),
        "assignedFaceCount": len(face_to_number),
        "unassignedFaceCount": len(unassigned_faces),
        "unassignedFaceCentroidsPx": [
            [float(face_centroids[face, 0]), float(face_centroids[face, 1])]
            for face in unassigned_faces
        ],
        "regionCount": len(region_features),
        "borderFeatureCount": len(border_features),
        "invalidGeometryCount": sum(not geometry.is_valid for geometry in world_geometries.values()),
        "overlapArea": overlap_area,
        "alignmentAccepted": not alignment_failures,
        "alignmentFailures": alignment_failures,
        "regionalAreaInsideTargetTerritoryRatio": regional_inside_ratio,
        "targetTerritoryCoveredRatio": territory_covered_ratio,
        "contourIntersectionOverUnion": contour_iou,
        "overseasIntersectionArea": overseas_intersection_area,
        "wrongCountryIntersectionArea": wrong_country_intersection_area,
        "labelPointsOutsideRegions": label_points_outside_regions,
        "commonAffineTransformIntegrityRatio": transform_integrity_ratio,
        "localTopologySha256": local_topology_hash,
        "assignedNumbers": numbers,
        "capitalRegionNumber": capital_number,
        "multiPolygonRegions": [
            number for number, geometry in world_geometries.items()
            if isinstance(geometry, MultiPolygon)
        ],
        "regionPolygonCounts": {
            str(number): len(geometry.geoms) if isinstance(geometry, MultiPolygon) else 1
            for number, geometry in world_geometries.items()
        },
        "alignment": {
            "method": "target transform-component bbox scale/translation; one common affine transform",
            "localLandBoundsPx": local_bounds,
            "transformComponentBoundsWorld": world_bounds,
            "targetTerritoryBoundsWorld": list(target_territory.bounds),
            "scaleX": scale_x, "scaleY": scale_y,
            "offsetX": offset_x, "offsetY": offset_y,
        },
        "targetTerritory": {
            "countryComponentCount": len(components),
            "selectedComponentCount": len(target_components),
            "overseasComponentCount": len(components) - len(target_components),
            "transformComponentAnchorWorld": territory_config["transformComponentAnchorWorld"],
            "associatedComponentAnchorsWorld": territory_config.get("associatedComponentAnchorsWorld", []),
            "selectionUsesAreaRanking": False,
            "selectionUsesGeoJsonOrder": False,
        },
    }

    if config.get("debug", {}).get("enabled", False):
        preview = source.copy()
        palette = np.asarray([
            [215, 190, 150], [170, 210, 175], [190, 175, 225], [145, 200, 220], [220, 175, 185],
        ], dtype=np.uint8)
        for number in numbers:
            mask = labels == number
            preview[mask] = (preview[mask] * 0.45 + palette[(number - 1) % len(palette)] * 0.55).astype(np.uint8)
        inverse = [1 / scale_x, 0, 0, 1 / scale_y, -offset_x / scale_x, -offset_y / scale_y]
        for feature in region_features:
            local_region = affinity.affine_transform(shape(feature["geometry"]), inverse)
            polygons = [local_region] if local_region.geom_type == "Polygon" else list(local_region.geoms)
            for polygon in polygons:
                cv2.polylines(
                    preview,
                    [np.rint(np.asarray(polygon.exterior.coords)).astype(np.int32)],
                    True,
                    (255, 255, 0),
                    1,
                )
        for feature in border_features:
            geometry = shape(feature["geometry"])
            local = affinity.affine_transform(geometry, inverse)
            parts = [local] if local.geom_type == "LineString" else list(local.geoms)
            for part in parts:
                cv2.polylines(preview, [np.rint(np.asarray(part.coords)).astype(np.int32)], False, (0, 255, 255), 2)
        debug_folder = ROOT / "public/debug"
        debug_folder.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(debug_folder / f"{dataset_slug}-source-overlay.png"), preview)

        world_preview = np.full((1080, 1925, 3), (24, 29, 31), dtype=np.uint8)

        def draw_polygon(geometry, color, thickness, fill=None):
            polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
            for polygon in polygons:
                exterior = np.rint(np.asarray(polygon.exterior.coords)).astype(np.int32)
                if fill is not None:
                    cv2.fillPoly(world_preview, [exterior], fill)
                cv2.polylines(world_preview, [exterior], True, color, thickness)

        for index, component in enumerate(components):
            is_target = any(component.equals(target) for target in target_components)
            draw_polygon(
                component,
                (45, 235, 255) if is_target else (120, 130, 135),
                2 if is_target else 1,
                (45, 75, 78) if is_target else (42, 46, 48),
            )
            point = component.representative_point()
            cv2.circle(world_preview, (round(point.x), round(point.y)), 2, (255, 255, 255), -1)
            cv2.putText(
                world_preview, str(index), (round(point.x) + 3, round(point.y) - 3),
                cv2.FONT_HERSHEY_SIMPLEX, 0.34, (225, 225, 225), 1, cv2.LINE_AA,
            )
        draw_polygon(region_union, (255, 80, 220), 2)
        left, top, right, bottom = transform_component.bounds
        cv2.rectangle(world_preview, (round(left), round(top)), (round(right), round(bottom)), (0, 255, 255), 2)
        region_left, region_top, region_right, region_bottom = region_union.bounds
        cv2.rectangle(
            world_preview,
            (round(region_left), round(region_top)),
            (round(region_right), round(region_bottom)),
            (255, 80, 220),
            1,
        )
        cv2.imwrite(str(debug_folder / f"{dataset_slug}-world-alignment.png"), world_preview)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    legacy_parent_ids = set(config.get("legacyParentCountryIds", []))
    atomic_write_json(config_path.parent / "regions-validation-report.json", validation)
    if alignment_failures:
        raise RuntimeError("Alignment validation failed: " + "; ".join(alignment_failures))
    replace_dataset_features(args.output_dir / "regions.geojson", dataset_id, legacy_parent_ids, region_features)
    replace_dataset_features(args.output_dir / "region-borders.geojson", dataset_id, legacy_parent_ids, border_features)
    replace_dataset_features(args.output_dir / "region-label-points.geojson", dataset_id, legacy_parent_ids, label_features)
    replace_dataset_features(args.output_dir / "regions-raw-world.geojson", dataset_id, legacy_parent_ids, raw_features)
    print(json.dumps(validation, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
