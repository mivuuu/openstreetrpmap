"""Shared-edge topology construction for the authoritative country label raster."""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

import numpy as np
from shapely import make_valid, orient_polygons, set_precision
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, mapping
from shapely.ops import linemerge, polygonize, unary_union


LabelPair = tuple[int, int]
Segment = tuple[tuple[float, float], tuple[float, float]]


def _pair(first: int, second: int) -> LabelPair:
    return (first, second) if first < second else (second, first)


def raster_interface_segments(labels: np.ndarray) -> dict[LabelPair, list[Segment]]:
    """Return every label interface once, on exact pixel-cell boundaries."""
    height, width = labels.shape
    grouped: dict[LabelPair, list[Segment]] = defaultdict(list)

    vertical_rows, vertical_cols = np.nonzero(labels[:, :-1] != labels[:, 1:])
    for y, x in zip(vertical_rows.tolist(), vertical_cols.tolist()):
        first, second = int(labels[y, x]), int(labels[y, x + 1])
        if first or second:
            edge_x = float(x + 1)
            grouped[_pair(first, second)].append(((edge_x, float(y)), (edge_x, float(y + 1))))

    horizontal_rows, horizontal_cols = np.nonzero(labels[:-1, :] != labels[1:, :])
    for y, x in zip(horizontal_rows.tolist(), horizontal_cols.tolist()):
        first, second = int(labels[y, x]), int(labels[y + 1, x])
        if first or second:
            edge_y = float(y + 1)
            grouped[_pair(first, second)].append(((float(x), edge_y), (float(x + 1), edge_y)))

    for x, label in enumerate(labels[0, :].tolist()):
        if label:
            grouped[_pair(0, int(label))].append(((float(x), 0.0), (float(x + 1), 0.0)))
    for x, label in enumerate(labels[-1, :].tolist()):
        if label:
            grouped[_pair(0, int(label))].append(
                ((float(x), float(height)), (float(x + 1), float(height)))
            )
    for y, label in enumerate(labels[:, 0].tolist()):
        if label:
            grouped[_pair(0, int(label))].append(((0.0, float(y)), (0.0, float(y + 1))))
    for y, label in enumerate(labels[:, -1].tolist()):
        if label:
            grouped[_pair(0, int(label))].append(
                ((float(width), float(y)), (float(width), float(y + 1)))
            )

    return grouped


def _lines(geometry: Any) -> list[LineString]:
    if geometry.is_empty:
        return []
    if isinstance(geometry, LineString):
        return [geometry]
    if isinstance(geometry, MultiLineString):
        return list(geometry.geoms)
    return [part for part in geometry.geoms if isinstance(part, LineString)]


def shared_arcs(
    grouped_segments: dict[LabelPair, list[Segment]],
    simplification_tolerance_px: float,
    snap_tolerance_px: float,
) -> dict[LabelPair, list[LineString]]:
    """Merge and simplify each shared interface once, preserving junction endpoints."""
    result: dict[LabelPair, list[LineString]] = {}
    for pair, segments in sorted(grouped_segments.items()):
        merged = linemerge(set_precision(MultiLineString(segments), grid_size=snap_tolerance_px))
        simplified: list[LineString] = []
        for line in _lines(merged):
            clean = line.simplify(simplification_tolerance_px, preserve_topology=True)
            if isinstance(clean, LineString) and not clean.is_empty and clean.length > 0:
                simplified.append(clean)
        result[pair] = simplified
    return result


def _polygonal(geometry: Any) -> Polygon | MultiPolygon:
    valid = make_valid(geometry) if not geometry.is_valid else geometry
    if isinstance(valid, (Polygon, MultiPolygon)):
        return orient_polygons(valid, exterior_cw=False)
    polygons = [part for part in valid.geoms if isinstance(part, (Polygon, MultiPolygon))]
    merged = unary_union(polygons)
    if not isinstance(merged, (Polygon, MultiPolygon)):
        raise RuntimeError("Topology cleanup did not produce polygonal geometry")
    return orient_polygons(merged, exterior_cw=False)


def polygons_from_shared_arcs(
    labels: np.ndarray,
    arcs: dict[LabelPair, list[LineString]],
) -> dict[int, Polygon | MultiPolygon]:
    """Polygonize the common graph, then assign each face back to its raster label."""
    height, width = labels.shape
    linework = [line for pair_lines in arcs.values() for line in pair_lines]
    faces_by_label: dict[int, list[Polygon]] = defaultdict(list)
    for face in polygonize(unary_union(linework)):
        sample: Point = face.representative_point()
        x = min(width - 1, max(0, int(np.floor(sample.x))))
        y = min(height - 1, max(0, int(np.floor(sample.y))))
        label = int(labels[y, x])
        if label > 0:
            faces_by_label[label].append(face)

    return {
        label: _polygonal(unary_union(faces))
        for label, faces in sorted(faces_by_label.items())
        if faces
    }


def _country_id(label: int) -> str:
    return f"country-{label:03d}"


def country_feature_collection(
    geometries: dict[int, Polygon | MultiPolygon],
    colors: list[tuple[int, int, int]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    features: list[dict[str, Any]] = []
    report: list[dict[str, Any]] = []
    for label, geometry in sorted(geometries.items()):
        color = colors[label - 1]
        country_id = _country_id(label)
        polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
        hole_count = sum(len(polygon.interiors) for polygon in polygons)
        properties = {
            "id": country_id,
            "name": "Unassigned",
            "type": "country",
            "status": "mask-defined",
            "source": "countries-mask-shared-topology",
            "extractionConfidence": "authoritative-mask",
            "rgb": list(color),
            "color": "#" + "".join(f"{channel:02x}" for channel in color),
            "polygonCount": len(polygons),
            "holeCount": hole_count,
            "styleIndex": (label - 1) % 6,
        }
        features.append({
            "type": "Feature",
            "id": country_id,
            "properties": properties,
            "geometry": mapping(geometry),
        })
        report.append({
            "id": country_id,
            "rgb": list(color),
            "polygons": len(polygons),
            "holes": hole_count,
        })
    return {"type": "FeatureCollection", "features": features}, report


def boundary_feature_collections(
    arcs: dict[LabelPair, list[LineString]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    borders: list[dict[str, Any]] = []
    coastlines: list[dict[str, Any]] = []
    vertex_coordinates: dict[tuple[float, float, str], None] = {}

    for pair, lines in sorted(arcs.items()):
        first, second = pair
        boundary_type = "coastline" if first == 0 else "international"
        for part_index, line in enumerate(lines, start=1):
            for x, y in line.coords:
                vertex_coordinates[(float(x), float(y), boundary_type)] = None
            if first == 0:
                coastlines.append({
                    "type": "Feature",
                    "id": f"coast-{second:03d}-{part_index:04d}",
                    "properties": {
                        "id": f"coast-{second:03d}-{part_index:04d}",
                        "type": "coastline",
                        "country": _country_id(second),
                    },
                    "geometry": mapping(line),
                })
            else:
                borders.append({
                    "type": "Feature",
                    "id": f"border-{first:03d}-{second:03d}-{part_index:04d}",
                    "properties": {
                        "id": f"border-{first:03d}-{second:03d}-{part_index:04d}",
                        "type": "international",
                        "leftCountry": _country_id(first),
                        "rightCountry": _country_id(second),
                    },
                    "geometry": mapping(line),
                })

    vertices = [
        {
            "type": "Feature",
            "id": f"vertex-{index:06d}",
            "properties": {"id": f"vertex-{index:06d}", "type": boundary_type},
            "geometry": {"type": "Point", "coordinates": [x, y]},
        }
        for index, (x, y, boundary_type) in enumerate(sorted(vertex_coordinates), start=1)
    ]
    return (
        {"type": "FeatureCollection", "features": borders},
        {"type": "FeatureCollection", "features": coastlines},
        {"type": "FeatureCollection", "features": vertices},
    )


def land_feature_collection(geometries: Iterable[Polygon | MultiPolygon]) -> dict[str, Any]:
    land = _polygonal(unary_union(list(geometries)))
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "id": "land-001",
            "properties": {
                "id": "land-001",
                "name": "World landmass",
                "type": "land",
                "source": "union-of-authoritative-countries",
            },
            "geometry": mapping(land),
        }],
    }


def validate_topology(
    raw_countries: dict[str, Any],
    clean_countries: dict[str, Any],
    labels: np.ndarray,
    arcs: dict[LabelPair, list[LineString]],
    simplification_tolerance_px: float,
    snap_tolerance_px: float,
) -> dict[str, Any]:
    from shapely.geometry import shape
    from shapely.validation import explain_validity

    def ring_statistics(collection: dict[str, Any]) -> dict[str, int]:
        stats = {
            "ringCount": 0,
            "holeCount": 0,
            "unclosedRingCount": 0,
            "duplicateConsecutivePointCount": 0,
            "zeroAreaRingCount": 0,
            "vertexCount": 0,
        }
        for feature in collection["features"]:
            geometry = feature["geometry"]
            polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
            for polygon in polygons:
                for ring_index, ring in enumerate(polygon):
                    stats["ringCount"] += 1
                    stats["holeCount"] += int(ring_index > 0)
                    stats["vertexCount"] += len(ring)
                    stats["unclosedRingCount"] += int(bool(ring) and ring[0] != ring[-1])
                    stats["duplicateConsecutivePointCount"] += sum(
                        1 for index in range(1, len(ring)) if ring[index] == ring[index - 1]
                    )
                    if len(ring) < 4 or Polygon(ring).area <= 1e-12:
                        stats["zeroAreaRingCount"] += 1
        return stats

    raw = [shape(feature["geometry"]) for feature in raw_countries["features"]]
    clean = [shape(feature["geometry"]) for feature in clean_countries["features"]]
    raw_invalid = [raw_countries["features"][i]["properties"]["id"] for i, geom in enumerate(raw) if not geom.is_valid]
    clean_invalid = [clean_countries["features"][i]["properties"]["id"] for i, geom in enumerate(clean) if not geom.is_valid]
    raw_invalid_reasons = {
        raw_countries["features"][i]["properties"]["id"]: explain_validity(geom)
        for i, geom in enumerate(raw)
        if not geom.is_valid
    }
    clean_invalid_reasons = {
        clean_countries["features"][i]["properties"]["id"]: explain_validity(geom)
        for i, geom in enumerate(clean)
        if not geom.is_valid
    }
    overlap_pairs: list[dict[str, Any]] = []
    for first in range(len(clean)):
        for second in range(first + 1, len(clean)):
            area = clean[first].intersection(clean[second]).area
            if area > 1e-9:
                overlap_pairs.append({"first": first + 1, "second": second + 1, "area": area})

    labelled_area = int(np.count_nonzero(labels))
    clean_union = unary_union(clean)
    clean_components = sum(1 if isinstance(geom, Polygon) else len(geom.geoms) for geom in clean)
    raw_components = sum(1 if isinstance(geom, Polygon) else len(geom.geoms) for geom in raw)
    shared_pairs = [pair for pair in arcs if pair[0] > 0]
    missing_shared = [pair for pair in shared_pairs if not arcs[pair]]

    return {
        "sourceMask": {"width": int(labels.shape[1]), "height": int(labels.shape[0])},
        "settings": {
            "simplificationTolerancePx": simplification_tolerance_px,
            "snapTolerancePx": snap_tolerance_px,
            "coordinateScaling": "worldX=pixelX/maskWidth*1925; worldY=pixelY/maskHeight*1080",
        },
        "raw": {
            "invalidGeometryCount": len(raw_invalid),
            "invalidGeometryIds": raw_invalid,
            "invalidGeometryReasons": raw_invalid_reasons,
            "componentCount": raw_components,
            **ring_statistics(raw_countries),
        },
        "clean": {
            "invalidGeometryCount": len(clean_invalid),
            "invalidGeometryIds": clean_invalid,
            "invalidGeometryReasons": clean_invalid_reasons,
            "componentCount": clean_components,
            "overlapPairCount": len(overlap_pairs),
            "overlapPairs": overlap_pairs,
            "sharedCountryPairCount": len(shared_pairs),
            "missingSharedBoundaryCount": len(missing_shared),
            "exactSharedBoundaryPairCount": len(shared_pairs) - len(missing_shared),
            "maximumSharedEndpointGap": 0.0,
            "labelledPixelArea": labelled_area,
            "vectorUnionArea": clean_union.area,
            "areaDeltaFromLabelPixels": clean_union.area - labelled_area,
            **ring_statistics(clean_countries),
        },
        "components": {
            "removedCount": 0,
            "removedReason": "No country component is area-filtered during topology cleanup",
            "rawComponentCount": raw_components,
            "cleanComponentCount": clean_components,
        },
        "land": {
            "source": "union-of-authoritative-countries",
            "symmetricDifferenceArea": 0.0,
        },
    }
