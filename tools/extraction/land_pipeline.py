"""Binary physical-geography extraction from the authoritative land mask."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import numpy as np
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.geometry import GeometryCollection, LineString, MultiLineString, shape
from shapely.ops import unary_union
from shapely.validation import explain_validity

from topology import (
    boundary_feature_collections,
    polygons_from_shared_arcs,
    raster_interface_segments,
    shared_arcs,
)


def read_binary_land_mask(
    mask_path: Path,
    threshold: int,
    expected_width: int,
    expected_height: int,
) -> tuple[np.ndarray, dict[str, Any]]:
    grayscale = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    if grayscale is None:
        raise FileNotFoundError(f"Cannot read land mask: {mask_path}")
    if grayscale.shape != (expected_height, expected_width):
        raise ValueError(
            f"land-mask dimensions must be {expected_width}x{expected_height}; "
            f"received {grayscale.shape[1]}x{grayscale.shape[0]}"
        )

    binary = np.where(grayscale >= threshold, 1, 0).astype(np.int32)
    intermediate = (grayscale > 0) & (grayscale < 255)
    return binary, {
        "threshold": threshold,
        "blackPixelCount": int(np.count_nonzero(grayscale == 0)),
        "whitePixelCount": int(np.count_nonzero(grayscale == 255)),
        "intermediatePixelCount": int(np.count_nonzero(intermediate)),
        "binaryLandPixelCount": int(np.count_nonzero(binary)),
        "binaryOceanPixelCount": int(binary.size - np.count_nonzero(binary)),
    }


def extract_land_products(
    binary_labels: np.ndarray,
    simplification_tolerance_px: float,
    snap_tolerance_px: float,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    component_count, _, stats, _ = cv2.connectedComponentsWithStats(
        binary_labels.astype(np.uint8),
        8,
    )
    component_areas = sorted(int(area) for area in stats[1:, cv2.CC_STAT_AREA])

    segments = raster_interface_segments(binary_labels)
    arcs = shared_arcs(segments, simplification_tolerance_px, snap_tolerance_px)
    geometries = polygons_from_shared_arcs(binary_labels, arcs)
    land_geometry = geometries.get(1)
    if not isinstance(land_geometry, (Polygon, MultiPolygon)):
        raise RuntimeError("Binary land mask did not produce polygonal land geometry")

    polygons = [land_geometry] if isinstance(land_geometry, Polygon) else list(land_geometry.geoms)
    hole_count = sum(len(polygon.interiors) for polygon in polygons)
    land = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "id": "land-001",
            "properties": {
                "id": "land-001",
                "name": "World landmass",
                "type": "land",
                "source": "authoritative-land-mask",
                "polygonCount": len(polygons),
                "holeCount": hole_count,
            },
            "geometry": mapping(land_geometry),
        }],
    }
    _, coastline, _ = boundary_feature_collections(arcs)

    report = {
        "source": "land-mask.png",
        "binaryConnectedComponentCount": component_count - 1,
        "vectorPolygonCount": len(polygons),
        "holeCount": hole_count,
        "componentAreaPixels": {
            "minimum": component_areas[0] if component_areas else 0,
            "maximum": component_areas[-1] if component_areas else 0,
            "total": sum(component_areas),
        },
        "removedComponentCount": 0,
        "removedComponents": [],
        "simplificationTolerancePx": simplification_tolerance_px,
        "snapTolerancePx": snap_tolerance_px,
        "valid": land_geometry.is_valid,
        "validityReason": explain_validity(land_geometry),
        "vectorArea": land_geometry.area,
        "binaryLandPixelArea": int(np.count_nonzero(binary_labels)),
        "areaDeltaFromBinaryPixels": land_geometry.area - int(np.count_nonzero(binary_labels)),
        "coastlineFeatureCount": len(coastline["features"]),
        "coordinateScaling": (
            "worldX=pixelX/maskWidth*1925; "
            "worldY=pixelY/maskHeight*1080"
        ),
    }
    return land, coastline, report


def clip_politics_to_land(
    countries: dict[str, Any],
    borders: dict[str, Any],
    land: dict[str, Any],
    explicit_unclaimed: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Create display-only political datasets; authoritative inputs stay untouched."""
    land_geometry = shape(land["features"][0]["geometry"])

    clipped_countries: list[dict[str, Any]] = []
    source_country_geometries = []
    for feature in countries["features"]:
        source = shape(feature["geometry"])
        source_country_geometries.append(source)
        clipped = source.intersection(land_geometry)
        polygon_parts: list[Polygon] = []
        if isinstance(clipped, Polygon):
            polygon_parts = [clipped]
        elif isinstance(clipped, MultiPolygon):
            polygon_parts = list(clipped.geoms)
        elif isinstance(clipped, GeometryCollection):
            polygon_parts = [part for part in clipped.geoms if isinstance(part, Polygon)]
        if not polygon_parts:
            continue
        geometry = polygon_parts[0] if len(polygon_parts) == 1 else MultiPolygon(polygon_parts)
        properties = dict(feature.get("properties") or {})
        properties["displayClip"] = "authoritative-land-mask"
        clipped_countries.append({
            **feature,
            "properties": properties,
            "geometry": mapping(geometry),
        })

    clipped_borders: list[dict[str, Any]] = []
    for feature in borders["features"]:
        clipped = shape(feature["geometry"]).intersection(land_geometry)
        line_parts: list[LineString] = []
        if isinstance(clipped, LineString):
            line_parts = [clipped]
        elif isinstance(clipped, MultiLineString):
            line_parts = list(clipped.geoms)
        elif isinstance(clipped, GeometryCollection):
            line_parts = [part for part in clipped.geoms if isinstance(part, LineString)]
        if not line_parts:
            continue
        geometry = line_parts[0] if len(line_parts) == 1 else MultiLineString(line_parts)
        clipped_borders.append({**feature, "geometry": mapping(geometry)})

    country_union = unary_union(source_country_geometries)
    explicit_unclaimed_geometries = [
        shape(feature["geometry"])
        for feature in (explicit_unclaimed or {}).get("features", [])
    ]
    explicit_unclaimed_union = (
        unary_union(explicit_unclaimed_geometries)
        if explicit_unclaimed_geometries
        else GeometryCollection()
    )
    unassigned_geometry = land_geometry.difference(country_union).difference(explicit_unclaimed_union)
    unassigned_land = {
        "type": "FeatureCollection",
        "features": [] if unassigned_geometry.is_empty else [{
            "type": "Feature",
            "id": "unassigned-land-001",
            "properties": {
                "id": "unassigned-land-001",
                "name": "Unassigned land",
                "type": "unassigned-land",
                "source": "land-minus-authoritative-countries",
            },
            "geometry": mapping(unassigned_geometry),
        }],
    }
    report = {
        "authoritativeCountriesChanged": False,
        "displayCountryFeatureCount": len(clipped_countries),
        "displayBorderFeatureCount": len(clipped_borders),
        "unassignedLandArea": unassigned_geometry.area,
        "explicitUnclaimedLandArea": land_geometry.intersection(explicit_unclaimed_union).area,
        "countryAreaOutsideLandRemovedFromDisplay": country_union.difference(land_geometry).area,
        "landCountryIntersectionArea": land_geometry.intersection(country_union).area,
        "direction": "politics-clipped-to-land",
    }
    return (
        {"type": "FeatureCollection", "features": clipped_countries},
        {"type": "FeatureCollection", "features": clipped_borders},
        unassigned_land,
        report,
    )
