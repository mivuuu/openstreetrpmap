#!/usr/bin/env python3
"""Transform one configured country-local categorical region mask into world GeoJSON."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from shapely.geometry import GeometryCollection, MultiLineString, MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import unary_union

from region_pipeline import (
    alignment_coefficients,
    alignment_metrics,
    atomic_write_json,
    local_geometry_to_world,
    rasterize_geometry,
    reference_land_mask,
    world_geometry_to_local,
)
from topology import polygons_from_shared_arcs, raster_interface_segments, shared_arcs


ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--countries", type=Path, default=ROOT / "public" / "data" / "countries.geojson")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public" / "data")
    return parser.parse_args()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def polygonal(geometry):
    if isinstance(geometry, (Polygon, MultiPolygon)):
        return geometry
    if isinstance(geometry, GeometryCollection):
        parts = [part for part in geometry.geoms if isinstance(part, Polygon)]
        if not parts:
            return GeometryCollection()
        return parts[0] if len(parts) == 1 else MultiPolygon(parts)
    return GeometryCollection()


def main() -> None:
    args = parse_args()
    config_path = args.config.resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    folder = config_path.parent
    mask_path = folder / config["source"]
    reference_path = folder / config["reference"]
    mask_bgr = cv2.imread(str(mask_path), cv2.IMREAD_COLOR)
    reference = cv2.imread(str(reference_path), cv2.IMREAD_COLOR)
    if mask_bgr is None:
        raise FileNotFoundError(mask_path)
    if reference is None:
        raise FileNotFoundError(reference_path)
    if mask_bgr.shape != reference.shape:
        raise ValueError("regions-mask and regions-source dimensions differ")

    reference_land, reference_report = reference_land_mask(reference, config["maskPreparation"])
    expected_bounds = [int(value) for value in config["alignment"]["localLandBoundsPx"]]
    if reference_report["boundsPx"] != expected_bounds:
        raise RuntimeError(
            f"Alignment mismatch: configured local bounds {expected_bounds}, "
            f"detected {reference_report['boundsPx']}"
        )

    countries = json.loads(args.countries.read_text(encoding="utf-8"))
    parent_feature = next(
        (feature for feature in countries["features"] if feature["properties"]["id"] == config["parentCountryId"]),
        None,
    )
    if parent_feature is None:
        raise RuntimeError(f"Parent country not found: {config['parentCountryId']}")
    parent = shape(parent_feature["geometry"])
    parent_bounds = config["alignment"]["parentComponentBoundsWorld"]
    parent_cluster = polygonal(parent.intersection(box(*parent_bounds)))
    local_parent_cluster = world_geometry_to_local(parent_cluster, config)
    candidate_land = rasterize_geometry(local_parent_cluster, reference.shape[1], reference.shape[0])
    alignment = alignment_metrics(
        reference_land,
        candidate_land,
        int(config["alignment"]["boundaryTolerancePx"]),
    )
    alignment["accepted"] = bool(
        alignment["intersectionOverUnion"] >= config["alignment"]["minimumIoU"]
        and alignment["boundaryFScore"] >= config["alignment"]["minimumBoundaryFScore"]
    )
    if not alignment["accepted"]:
        raise RuntimeError(
            "Alignment mismatch: refusing aggressive deformation; "
            f"IoU={alignment['intersectionOverUnion']:.4f}, "
            f"boundaryF={alignment['boundaryFScore']:.4f}"
        )

    mask_rgb = cv2.cvtColor(mask_bgr, cv2.COLOR_BGR2RGB)
    foreground = np.any(mask_rgb != 0, axis=2)
    colors = sorted(
        tuple(int(channel) for channel in color)
        for color in np.unique(mask_rgb[foreground].reshape(-1, 3), axis=0)
    )
    region_names = {int(number): name for number, name in config["regionNames"].items()}
    assignment_by_color = {
        tuple(int(channel) for channel in color_key.split(",")): int(number)
        for color_key, number in config["regionAssignments"].items()
    }
    missing_assignments = [color for color in colors if color not in assignment_by_color]
    if missing_assignments:
        raise RuntimeError(f"Region colors have no metadata assignment: {missing_assignments}")
    assigned_numbers = [assignment_by_color[color] for color in colors]
    if len(assigned_numbers) != len(set(assigned_numbers)):
        raise RuntimeError("Each extracted polygon must map to a distinct administrative region")
    unknown_numbers = [number for number in assigned_numbers if number not in region_names]
    if unknown_numbers:
        raise RuntimeError(f"Assigned region numbers have no name: {unknown_numbers}")

    labels = np.zeros(mask_rgb.shape[:2], dtype=np.int32)
    for label, color in enumerate(colors, start=1):
        labels[foreground & np.all(mask_rgb == color, axis=2)] = label

    pixel_area_by_label = {
        label: int(np.count_nonzero(labels == label))
        for label in range(1, len(colors) + 1)
    }
    area_order = sorted(pixel_area_by_label, key=pixel_area_by_label.get, reverse=True)
    area_rank_by_label = {
        label: min(3, (index * 3 // max(1, len(area_order))) + 1)
        for index, label in enumerate(area_order)
    }

    extraction = config["extraction"]
    arcs = shared_arcs(
        raster_interface_segments(labels),
        extraction["simplificationTolerancePx"],
        extraction["snapTolerancePx"],
    )
    local_geometries = polygons_from_shared_arcs(labels, arcs)
    region_features: list[dict[str, Any]] = []
    raw_region_features: list[dict[str, Any]] = []
    region_geometries = []
    outside_parent_area = 0.0
    invalid_ids: list[str] = []
    label_features: list[dict[str, Any]] = []
    region_id_by_label: dict[int, str] = {}
    geometry_sha256_by_region: dict[str, str] = {}

    for label, color in enumerate(colors, start=1):
        local_geometry = local_geometries.get(label)
        if local_geometry is None:
            continue
        number = assignment_by_color[color]
        region_id = f"region-{number:03d}"
        region_id_by_label[label] = region_id
        world_raw = local_geometry_to_world(local_geometry, config)
        outside_parent_area += world_raw.difference(parent).area
        world_geometry = polygonal(world_raw.intersection(parent))
        if world_geometry.is_empty:
            continue
        if not world_geometry.is_valid:
            invalid_ids.append(region_id)
        is_capital = number == 10
        properties = {
            "id": region_id,
            "number": number,
            "name": region_names[number],
            "type": "region",
            "countryId": config["parentCountryId"],
            "rgb": list(color),
            "styleIndex": (number - 1) % 5,
            "isCapital": is_capital,
            "capital": is_capital,
            "labelRank": area_rank_by_label[label],
            "importance": area_rank_by_label[label],
            "areaWorld": world_geometry.area,
            "labelPointMethod": "representative-point",
            "source": f"regions/{config['parentCountryId']}/{config['source']}",
        }
        feature = {
            "type": "Feature",
            "id": region_id,
            "properties": properties,
            "geometry": mapping(world_geometry),
        }
        region_features.append(feature)
        region_geometries.append(world_geometry)
        geometry_sha256_by_region[region_id] = hashlib.sha256(world_geometry.wkb).hexdigest()
        raw_region_features.append({**feature, "geometry": mapping(world_raw)})
        label_point = world_geometry.representative_point()
        label_features.append({
            "type": "Feature",
            "id": f"{region_id}-label",
            "properties": properties,
            "geometry": mapping(label_point),
        })

    border_features: list[dict[str, Any]] = []
    shared_pairs = set()
    for (first, second), lines in sorted(arcs.items()):
        if first <= 0 or second <= 0:
            continue
        if first not in region_id_by_label or second not in region_id_by_label:
            continue
        shared_pairs.add((first, second))
        for part_index, line in enumerate(lines, start=1):
            world_line = local_geometry_to_world(line, config).intersection(parent)
            if world_line.is_empty:
                continue
            if isinstance(world_line, GeometryCollection):
                line_parts = [part for part in world_line.geoms if part.geom_type == "LineString"]
                if not line_parts:
                    continue
                world_line = line_parts[0] if len(line_parts) == 1 else MultiLineString(line_parts)
            border_id = f"region-border-{first:03d}-{second:03d}-{part_index:03d}"
            border_features.append({
                "type": "Feature",
                "id": border_id,
                "properties": {
                    "id": border_id,
                    "type": "region-border",
                    "countryId": config["parentCountryId"],
                    "leftRegionId": region_id_by_label[first],
                    "rightRegionId": region_id_by_label[second],
                },
                "geometry": mapping(world_line),
            })

    overlap_area = 0.0
    overlap_pairs = []
    for first in range(len(region_geometries)):
        for second in range(first + 1, len(region_geometries)):
            area = region_geometries[first].intersection(region_geometries[second]).area
            if area > 1e-7:
                overlap_area += area
                overlap_pairs.append([region_features[first]["id"], region_features[second]["id"], area])

    region_union = unary_union(region_geometries)
    cluster_area = parent_cluster.area
    scale_x, scale_y, offset_x, offset_y = alignment_coefficients(config)
    local_assigned_pixels = int(np.count_nonzero(labels))
    expected_world_area = local_assigned_pixels * scale_x * scale_y
    features_by_number = {
        feature["properties"]["number"]: feature
        for feature in region_features
    }
    region_013 = features_by_number.get(13)
    region_034 = features_by_number.get(34)
    if region_013 is None or region_034 is None:
        raise RuntimeError("Both region-013 and region-034 must exist")
    geometry_013 = shape(region_013["geometry"])
    geometry_034 = shape(region_034["geometry"])
    if geometry_013.geom_type != "Polygon" or geometry_034.geom_type != "Polygon":
        raise RuntimeError("Аргезия and Гесперидия must remain separate Polygon features")
    if not geometry_013.disjoint(geometry_034):
        raise RuntimeError("Аргезия and Гесперидия must be spatially separate")

    validation = {
        "parentCountryId": config["parentCountryId"],
        "sourceMaskSha256": sha256(mask_path),
        "referenceSha256": sha256(reference_path),
        "localImageSize": [reference.shape[1], reference.shape[0]],
        "alignment": alignment | {
            "method": config["alignment"]["method"],
            "localLandBoundsPx": expected_bounds,
            "parentComponentBoundsWorld": parent_bounds,
            "scaleX": scale_x,
            "scaleY": scale_y,
            "offsetX": offset_x,
            "offsetY": offset_y,
        },
        "regions": {
            "count": len(region_features),
            "uniqueColorCount": len(colors),
            "invalidGeometryCount": len(invalid_ids),
            "invalidGeometryIds": invalid_ids,
            "overlapPairCount": len(overlap_pairs),
            "overlapArea": overlap_area,
            "outsideParentAreaBeforeClip": outside_parent_area,
            "outsideParentAreaAfterClip": region_union.difference(parent).area,
            "regionUnionArea": region_union.area,
            "localAssignedPixelCount": local_assigned_pixels,
            "localUnassignedReferenceLandPixelCount": int(
                np.count_nonzero(reference_land & (labels == 0))
            ),
            "expectedWorldAreaFromMaskPixels": expected_world_area,
            "areaDeltaAfterParentClip": region_union.area - expected_world_area,
            "parentLocalClusterArea": cluster_area,
            "parentLocalClusterCoverageRatio": region_union.intersection(parent_cluster).area / max(1e-12, cluster_area),
            "sharedRegionPairCount": len(shared_pairs),
            "borderFeatureCount": len(border_features),
            "labelPointCount": len(label_features),
            "labelPointsOutsideRegions": sum(
                not geometry.covers(shape(label_features[index]["geometry"]))
                for index, geometry in enumerate(region_geometries)
            ),
            "regionAutofillUsed": False,
            "uncoloredMaskPixelsRemainUnassigned": True,
            "assignedRegionNumbers": sorted(assigned_numbers),
            "missingRegionNumbers": sorted(set(region_names) - set(assigned_numbers)),
            "geometrySha256ByRegion": geometry_sha256_by_region,
            "region013": {
                "id": region_013["properties"]["id"],
                "name": region_013["properties"]["name"],
                "geometryType": geometry_013.geom_type,
                "bounds": list(geometry_013.bounds),
            },
            "region034": {
                "id": region_034["properties"]["id"],
                "name": region_034["properties"]["name"],
                "geometryType": geometry_034.geom_type,
                "bounds": list(geometry_034.bounds),
            },
            "region013And034AreSeparate": geometry_013.disjoint(geometry_034),
        },
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    atomic_write_json(args.output_dir / "regions.geojson", {"type": "FeatureCollection", "features": region_features})
    atomic_write_json(args.output_dir / "region-borders.geojson", {"type": "FeatureCollection", "features": border_features})
    atomic_write_json(args.output_dir / "region-label-points.geojson", {"type": "FeatureCollection", "features": label_features})
    atomic_write_json(args.output_dir / "regions-raw-world.geojson", {"type": "FeatureCollection", "features": raw_region_features})
    atomic_write_json(args.output_dir / "regions-validation-report.json", validation)

    alignment_preview = reference.copy()
    reference_boundary = cv2.morphologyEx(reference_land, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    candidate_boundary = cv2.morphologyEx(candidate_land, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    alignment_preview[reference_boundary > 0] = (0, 255, 255)
    alignment_preview[candidate_boundary > 0] = (255, 0, 255)
    preview_path = ROOT / "public" / "debug" / f"{config['parentCountryId']}-regions-alignment.png"
    cv2.imwrite(str(preview_path), alignment_preview)
    print(json.dumps(validation, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
