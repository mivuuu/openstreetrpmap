#!/usr/bin/env python3
"""Generate one readable debug label point per existing country feature."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from shapely.geometry import MultiPolygon, Point, Polygon, mapping, shape


ROOT = Path(__file__).resolve().parents[2]
COUNTRIES = ROOT / "public/data/countries.geojson"
OVERRIDES = Path(__file__).with_name("country-debug-label-overrides.json")
OUTPUT = ROOT / "public/data/country-debug-label-points.geojson"
ID_LIST = ROOT / "public/data/country-ids.txt"
REPORT = ROOT / "public/data/country-debug-label-report.json"
RASTER_SCALE = 4


def polylabel_like_point(polygon: Polygon) -> Point:
    left, top, right, bottom = polygon.bounds
    width = max(1, int(np.ceil((right - left) * RASTER_SCALE)) + 3)
    height = max(1, int(np.ceil((bottom - top) * RASTER_SCALE)) + 3)
    mask = np.zeros((height, width), dtype=np.uint8)

    def pixels(coordinates):
        values = (np.asarray(coordinates) - [left, top]) * RASTER_SCALE + 1
        return np.rint(values).astype(np.int32)

    cv2.fillPoly(mask, [pixels(polygon.exterior.coords)], 255)
    for interior in polygon.interiors:
        cv2.fillPoly(mask, [pixels(interior.coords)], 0)
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    _, clearance, _, location = cv2.minMaxLoc(distance)
    point = Point(
        left + (location[0] - 1) / RASTER_SCALE,
        top + (location[1] - 1) / RASTER_SCALE,
    )
    return point if polygon.covers(point) else polygon.representative_point()


def main() -> None:
    countries = json.loads(COUNTRIES.read_text(encoding="utf-8"))
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    features = []
    report_rows = []

    for feature in countries["features"]:
        country_id = feature["properties"]["id"]
        geometry = shape(feature["geometry"])
        components = list(geometry.geoms) if isinstance(geometry, MultiPolygon) else [geometry]
        total_area = sum(component.area for component in components)
        largest = max(components, key=lambda component: component.area)
        override = overrides.get(country_id)
        if override is not None:
            point = Point(float(override[0]), float(override[1]))
            containing = [component for component in components if component.covers(point)]
            if len(containing) != 1:
                raise RuntimeError(f"Override for {country_id} is not inside exactly one component")
            selected = containing[0]
            selection_method = "manual-override"
        else:
            selected = largest
            point = polylabel_like_point(selected)
            selection_method = "largest-component-polylabel"

        suffix = country_id.removeprefix("country-")
        largest_share = largest.area / total_area
        questionable = len(components) > 10 or largest_share < 0.75
        properties = {
            "id": f"{country_id}-debug-label",
            "countryId": country_id,
            "label": suffix,
            "type": "country-debug-label",
            "componentCount": len(components),
            "selectionMethod": selection_method,
            "questionableAutomaticSelection": questionable and override is None,
        }
        features.append({
            "type": "Feature",
            "id": properties["id"],
            "properties": properties,
            "geometry": mapping(point),
        })
        report_rows.append({
            "countryId": country_id,
            "componentCount": len(components),
            "largestComponentAreaShare": largest_share,
            "selectionMethod": selection_method,
            "labelPointWorld": [point.x, point.y],
            "pointInsideSelectedComponent": selected.covers(point),
            "questionableAutomaticSelection": questionable and override is None,
        })

    ids = [feature["properties"]["countryId"] for feature in features]
    if len(ids) != len(set(ids)):
        raise RuntimeError("Duplicate country ID in debug labels")
    if len(ids) != len(countries["features"]):
        raise RuntimeError("Not every country received exactly one debug label")

    OUTPUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    ID_LIST.write_text("\n".join(ids) + "\n", encoding="utf-8")
    REPORT.write_text(json.dumps({"countryCount": len(ids), "countries": report_rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Generated {len(ids)} unique country debug labels")


if __name__ == "__main__":
    main()
