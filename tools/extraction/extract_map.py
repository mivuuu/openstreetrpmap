#!/usr/bin/env python3
"""Extract development GeoJSON from the fictional world's raster artwork.

This is an offline authoring tool. It never runs in the browser and never
modifies the source PNG. Coordinates remain source-image pixel coordinates.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from shapely.geometry import MultiPolygon, Polygon, mapping

from land_pipeline import clip_politics_to_land, extract_land_products, read_binary_land_mask
from mask_states import configured_colors, is_ocean, is_unclaimed
from topology import (
    boundary_feature_collections,
    country_feature_collection as topology_country_feature_collection,
    polygons_from_shared_arcs,
    raster_interface_segments,
    shared_arcs,
    validate_topology,
)


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = Path(__file__).with_name("extraction.config.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--land-mask",
        type=Path,
        default=ROOT / "land-mask.png",
        help="Authoritative binary physical-geography mask.",
    )
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public" / "data")
    parser.add_argument(
        "--preview",
        type=Path,
        default=ROOT / "public" / "debug" / "extraction-preview.png",
    )
    parser.add_argument(
        "--countries-mask",
        type=Path,
        default=ROOT / "countries-mask.png",
        help="Authoritative flat-color RGB/RGBA political mask.",
    )
    return parser.parse_args()


def odd_kernel(size: int) -> np.ndarray:
    normalized = max(1, int(size))
    if normalized % 2 == 0:
        normalized += 1
    return np.ones((normalized, normalized), dtype=np.uint8)


def contour_to_ring(contour: np.ndarray, tolerance: float) -> list[list[float]] | None:
    approximated = cv2.approxPolyDP(contour, tolerance, True)
    points = approximated.reshape(-1, 2)
    if len(points) < 3:
        points = contour.reshape(-1, 2)
    if len(points) < 3:
        return None
    ring = [[float(x), float(y)] for x, y in points]
    ring.append(ring[0])
    return ring


def pixel_envelope_ring(contour: np.ndarray) -> list[list[float]]:
    """Return a valid minimal polygon for a degenerate one-pixel-wide component."""
    x, y, width, height = cv2.boundingRect(contour)
    left, top = x - 0.5, y - 0.5
    right, bottom = x + width - 0.5, y + height - 0.5
    return [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
        [left, top],
    ]


def mask_to_polygons(
    mask: np.ndarray,
    tolerance: float,
    minimum_area: float = 1.0,
    include_holes: bool = False,
) -> list[list[list[list[float]]]]:
    retrieval = cv2.RETR_CCOMP if include_holes else cv2.RETR_EXTERNAL
    contours, hierarchy = cv2.findContours(mask, retrieval, cv2.CHAIN_APPROX_SIMPLE)
    polygons: list[list[list[list[float]]]] = []
    if hierarchy is None:
        return polygons
    hierarchy = hierarchy[0]
    for index, contour in enumerate(contours):
        if include_holes and hierarchy[index][3] != -1:
            continue
        contour_area = cv2.contourArea(contour)
        ring = (
            contour_to_ring(contour, tolerance)
            if contour_area >= minimum_area
            else pixel_envelope_ring(contour)
        )
        if ring is not None:
            polygon = [ring]
            if include_holes:
                child = int(hierarchy[index][2])
                while child != -1:
                    hole = contours[child]
                    hole_area = cv2.contourArea(hole)
                    hole_ring = (
                        contour_to_ring(hole, tolerance)
                        if hole_area >= minimum_area
                        else pixel_envelope_ring(hole)
                    )
                    if hole_ring is not None:
                        polygon.append(hole_ring)
                    child = int(hierarchy[child][0])
            polygons.append(polygon)
    return polygons


def geometry_from_polygons(polygons: list[list[list[list[float]]]]) -> dict[str, Any]:
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


def mask_country_labels(
    mask_path: Path,
    settings: dict[str, Any],
    mask_state_settings: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray, list[tuple[int, int, int]], np.ndarray, np.ndarray]:
    raw = cv2.imread(str(mask_path), cv2.IMREAD_UNCHANGED)
    if raw is None:
        raise FileNotFoundError(f"Cannot read countries mask: {mask_path}")
    if raw.shape[:2] != (1080, 1925):
        raise ValueError("countries-mask dimensions must be exactly 1925x1080")

    if raw.shape[2] == 4:
        rgb = cv2.cvtColor(raw[:, :, :3], cv2.COLOR_BGR2RGB)
        alpha = raw[:, :, 3]
    else:
        rgb = cv2.cvtColor(raw, cv2.COLOR_BGR2RGB)
        alpha = np.full(raw.shape[:2], 255, dtype=np.uint8)

    ocean_pixels = is_ocean(rgb, alpha, mask_state_settings)
    unclaimed_pixels = is_unclaimed(rgb, alpha, mask_state_settings)
    foreground = ~(ocean_pixels | unclaimed_pixels)

    # The supplied RGBA mask contains antialiased edge colors. A country color
    # must therefore have a coherent exact-color interior, not merely occur in
    # one or two edge pixels. All foreground edge pixels are then assigned to
    # the nearest detected palette color; no resulting island is area-filtered.
    unique_colors, counts = np.unique(rgb[foreground].reshape(-1, 3), axis=0, return_counts=True)
    palette: list[tuple[int, int, int]] = []
    for color, count in zip(unique_colors, counts):
        if count < settings["paletteMinimumConnectedArea"]:
            continue
        exact = foreground & np.all(rgb == color, axis=2)
        component_count, _, stats, _ = cv2.connectedComponentsWithStats(exact.astype(np.uint8), 8)
        largest = int(stats[1:, cv2.CC_STAT_AREA].max()) if component_count > 1 else 0
        opaque_ratio = float(np.count_nonzero(exact & (alpha == 255)) / count)
        if (
            largest >= settings["paletteMinimumConnectedArea"]
            and opaque_ratio >= settings["paletteMinimumOpaqueRatio"]
        ):
            palette.append(tuple(int(channel) for channel in color))

    if not palette:
        raise RuntimeError("countries-mask contains no coherent non-black palette colors")

    seed_labels = np.zeros(raw.shape[:2], dtype=np.int32)
    for index, color in enumerate(palette, start=1):
        seed_labels[foreground & np.all(rgb == color, axis=2)] = index

    # Spatial propagation is essential for colors that share a hue at different
    # brightnesses (for example bright and dark red countries). RGB distance
    # would incorrectly turn antialiased bright-red coast pixels into dark-red
    # micro-islands. Every edge pixel instead inherits its nearest exact fill.
    distance_input = np.where(seed_labels > 0, 0, 1).astype(np.uint8)
    _, nearest_pixels = cv2.distanceTransformWithLabels(
        distance_input,
        cv2.DIST_L2,
        5,
        labelType=cv2.DIST_LABEL_PIXEL,
    )
    lookup = np.zeros(int(nearest_pixels.max()) + 1, dtype=np.int32)
    seed_pixels = seed_labels > 0
    lookup[nearest_pixels[seed_pixels]] = seed_labels[seed_pixels]
    labels = np.where(foreground, lookup[nearest_pixels], 0).astype(np.int32)

    # The flat mask is authoritative; derive its boundaries only for the preview.
    border = np.zeros(raw.shape[:2], dtype=np.uint8)
    for label in range(1, len(palette) + 1):
        region = np.where(labels == label, 255, 0).astype(np.uint8)
        border = cv2.bitwise_or(border, cv2.morphologyEx(region, cv2.MORPH_GRADIENT, odd_kernel(3)))
    reference = raw[:, :, :3].copy()
    reference = (reference.astype(np.float32) * (alpha[:, :, None] / 255)).astype(np.uint8)
    return labels, border, palette, reference, unclaimed_pixels


def unclaimed_feature_collection(
    unclaimed_labels: np.ndarray,
    settings: dict[str, Any],
    mask_state_settings: dict[str, Any],
) -> dict[str, Any]:
    if not np.any(unclaimed_labels):
        return {"type": "FeatureCollection", "features": []}
    segments = raster_interface_segments(unclaimed_labels.astype(np.int32))
    arcs = shared_arcs(
        segments,
        settings["simplificationTolerance"],
        settings["snapTolerancePx"],
    )
    geometry = polygons_from_shared_arcs(unclaimed_labels.astype(np.int32), arcs).get(1)
    if not isinstance(geometry, (Polygon, MultiPolygon)):
        raise RuntimeError("Unclaimed mask did not produce polygonal geometry")
    _, unclaimed_color = configured_colors(mask_state_settings)
    polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "id": "unclaimed-001",
            "properties": {
                "id": "unclaimed-001",
                "type": "unclaimed",
                "source": "countries-mask-reserved-color",
                "rgb": [int(channel) for channel in unclaimed_color],
                "polygonCount": len(polygons),
                "holeCount": sum(len(polygon.interiors) for polygon in polygons),
            },
            "geometry": mapping(geometry),
        }],
    }


def countries_feature_collection(
    labels: np.ndarray,
    colors: list[tuple[int, int, int]],
    settings: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    features: list[dict[str, Any]] = []
    report: list[dict[str, Any]] = []
    for index, color in enumerate(colors, start=1):
        label = index
        region = np.where(labels == label, 255, 0).astype(np.uint8)
        polygons = mask_to_polygons(
            region,
            settings["simplificationTolerance"],
            settings["minimumPolygonArea"],
            include_holes=True,
        )
        if not polygons:
            continue
        feature_id = f"country-{index:03d}"
        rgb = list(color)
        hex_color = "#" + "".join(f"{channel:02x}" for channel in color)
        hole_count = sum(max(0, len(polygon) - 1) for polygon in polygons)
        features.append(
            {
                "type": "Feature",
                "id": feature_id,
                "properties": {
                    "id": feature_id,
                    "name": "Unassigned",
                    "type": "country",
                    "status": "mask-defined",
                    "source": "countries-mask",
                    "extractionConfidence": "authoritative-mask",
                    "rgb": rgb,
                    "color": hex_color,
                    "polygonCount": len(polygons),
                    "holeCount": hole_count,
                    "styleIndex": (index - 1) % 6,
                },
                "geometry": geometry_from_polygons(polygons),
            }
        )
        report.append({"id": feature_id, "rgb": rgb, "polygons": len(polygons), "holes": hole_count})
    return {"type": "FeatureCollection", "features": features}, report


def render_preview(
    mask_reference: np.ndarray,
    country_labels: np.ndarray,
    country_border: np.ndarray,
) -> np.ndarray:
    preview = (mask_reference.astype(np.float32) * 0.72).astype(np.uint8)
    vector_fill = country_labels > 0
    preview[vector_fill] = (preview[vector_fill] * 0.78 + np.asarray([205, 205, 205]) * 0.22).astype(np.uint8)
    preview[country_border > 0] = (255, 255, 255)
    return preview


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary.replace(path)


def main() -> None:
    args = parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    land_settings = config["landMask"]
    binary_land, land_raster_report = read_binary_land_mask(
        args.land_mask,
        land_settings["threshold"],
        land_settings["worldWidth"],
        land_settings["worldHeight"],
    )
    land, coastline, land_vector_report = extract_land_products(
        binary_land,
        land_settings["simplificationTolerance"],
        land_settings["snapTolerancePx"],
    )

    country_labels, border, colors, mask_reference, raw_unclaimed = mask_country_labels(
        args.countries_mask,
        config["countries"],
        config["maskStates"],
    )
    physical_land = binary_land > 0
    unclaimed_inside_land = raw_unclaimed & physical_land
    unclaimed_outside_land = raw_unclaimed & ~physical_land
    unclaimed = unclaimed_feature_collection(
        unclaimed_inside_land.astype(np.int32),
        config["countries"],
        config["maskStates"],
    )
    raw_countries, _ = countries_feature_collection(country_labels, colors, config["countries"])
    topology_settings = config["countries"]
    interface_segments = raster_interface_segments(country_labels)
    arcs = shared_arcs(
        interface_segments,
        topology_settings["simplificationTolerance"],
        topology_settings["snapTolerancePx"],
    )
    country_geometries = polygons_from_shared_arcs(country_labels, arcs)
    countries, report = topology_country_feature_collection(country_geometries, colors)
    borders, _, vertices = boundary_feature_collections(arcs)
    display_countries, display_borders, unassigned_land, clipping_report = clip_politics_to_land(
        countries,
        borders,
        land,
        unclaimed,
    )
    clipping_report["explicitUnclaimedPixelCount"] = int(np.count_nonzero(unclaimed_inside_land))
    clipping_report["unclaimedOutsideLandPixelCount"] = int(np.count_nonzero(unclaimed_outside_land))
    validation = validate_topology(
        raw_countries,
        countries,
        country_labels,
        arcs,
        topology_settings["simplificationTolerance"],
        topology_settings["snapTolerancePx"],
    )
    validation["physicalLand"] = {
        "source": "authoritative-land-mask",
        "independentFromCountries": True,
        "note": "Countries never define production land or coastline.",
    }

    write_json(args.output_dir / "land.geojson", land)
    write_json(args.output_dir / "countries.geojson", countries)
    write_json(args.output_dir / "countries-raw.geojson", raw_countries)
    write_json(args.output_dir / "country-borders.geojson", borders)
    write_json(args.output_dir / "countries-display.geojson", display_countries)
    write_json(args.output_dir / "country-borders-display.geojson", display_borders)
    write_json(args.output_dir / "unassigned-land.geojson", unassigned_land)
    write_json(args.output_dir / "unclaimed.geojson", unclaimed)
    write_json(args.output_dir / "coastline.geojson", coastline)
    write_json(args.output_dir / "country-vertices.geojson", vertices)
    write_json(
        args.output_dir / "countries-report.json",
        {"countries": report, "topology": validation},
    )
    write_json(args.output_dir / "countries-validation-report.json", validation)
    write_json(
        args.output_dir / "land-report.json",
        {
            "raster": land_raster_report,
            "vector": land_vector_report,
            "politicalDisplayClip": clipping_report,
        },
    )
    args.preview.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.preview), render_preview(mask_reference, country_labels, border))

    land_geometry = land["features"][0]["geometry"]
    land_polygons = 1 if land_geometry["type"] == "Polygon" else len(land_geometry["coordinates"])
    print(f"land polygons: {land_polygons}")
    print(f"countries: {len(countries['features'])}")
    for item in report:
        print(
            f"{item['id']} -> RGB({','.join(str(value) for value in item['rgb'])})"
            f" -> polygons={item['polygons']} holes={item['holes']}"
        )
    print(f"wrote: {args.output_dir / 'land.geojson'}")
    print(f"wrote: {args.output_dir / 'countries.geojson'}")
    print(f"wrote: {args.output_dir / 'country-borders.geojson'}")
    print(f"wrote: {args.output_dir / 'coastline.geojson'}")
    print(f"wrote: {args.output_dir / 'country-vertices.geojson'}")
    print(f"wrote: {args.output_dir / 'countries-validation-report.json'}")
    print(f"wrote: {args.output_dir / 'countries-report.json'}")
    print(f"wrote: {args.preview}")


if __name__ == "__main__":
    main()
