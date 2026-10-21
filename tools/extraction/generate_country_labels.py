#!/usr/bin/env python3
"""Attach country names without changing geometry and create production label points."""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import MultiPolygon, Point, mapping, shape
from shapely.ops import polylabel


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public/data"
NAMES_PATH = Path(__file__).with_name("country-names.json")
OVERRIDES_PATH = Path(__file__).with_name("country-label-overrides.json")
OUTPUT_PATH = DATA / "country-label-points.geojson"
REPORT_PATH = DATA / "country-label-placement-report.json"
NAMED_COUNTRY_FILES = [DATA / "countries.geojson", DATA / "countries-display.geojson"]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def label_rank(area: float) -> int:
    if area >= 30000:
        return 1
    if area >= 9000:
        return 2
    return 3


def main() -> None:
    names = read_json(NAMES_PATH)
    overrides = read_json(OVERRIDES_PATH)
    countries = read_json(NAMED_COUNTRY_FILES[0])
    country_by_id = {feature["properties"]["id"]: feature for feature in countries["features"]}
    if set(names) != set(country_by_id):
        raise RuntimeError(f"Country-name mapping mismatch: names={len(names)}, countries={len(country_by_id)}")

    # Properties only: coordinates and geometry objects are copied unchanged.
    for path in NAMED_COUNTRY_FILES:
        collection = read_json(path)
        for feature in collection["features"]:
            country_id = feature["properties"]["id"]
            metadata = names[country_id]
            feature["properties"]["name"] = metadata["name"]
            feature["properties"]["type"] = "country"
            if "stateGroupId" in metadata:
                feature["properties"]["stateGroupId"] = metadata["stateGroupId"]
                feature["properties"]["stateName"] = metadata["stateName"]
            feature["properties"]["productionLabel"] = metadata.get("productionLabel", True)
        write_json(path, collection)

    country_area = {
        country_id: shape(feature["geometry"]).area
        for country_id, feature in country_by_id.items()
    }
    state_area: dict[str, float] = {}
    for country_id, metadata in names.items():
        state_group_id = metadata.get("stateGroupId", country_id)
        state_area[state_group_id] = state_area.get(state_group_id, 0.0) + country_area[country_id]

    labels = []
    report_rows = []
    for country_id, metadata in names.items():
        if not metadata.get("productionLabel", True):
            continue
        geometry = shape(country_by_id[country_id]["geometry"])
        components = list(geometry.geoms) if isinstance(geometry, MultiPolygon) else [geometry]
        override = overrides.get(country_id)
        placements = []
        if override is not None and "componentAnchors" in override:
            selected_components = []
            for coordinates in override["componentAnchors"]:
                anchor = Point(float(coordinates[0]), float(coordinates[1]))
                matches = [component for component in components if component.covers(anchor)]
                if len(matches) != 1:
                    raise RuntimeError(
                        f"Component anchor for {country_id} must be inside exactly one component"
                    )
                selected_component = matches[0]
                if any(selected_component.equals(existing) for existing in selected_components):
                    raise RuntimeError(f"Duplicate component anchor for {country_id}")
                selected_components.append(selected_component)
                placements.append((
                    polylabel(selected_component, tolerance=0.05),
                    selected_component,
                    "component-anchor-polylabel",
                ))
        elif override is not None:
            point = Point(float(override["labelX"]), float(override["labelY"]))
            matches = [component for component in components if component.covers(point)]
            if len(matches) != 1:
                raise RuntimeError(f"Production override for {country_id} must be inside exactly one component")
            selected_component = matches[0]
            placements.append((point, selected_component, "manual-override"))
        else:
            selected_component = max(components, key=lambda component: component.area)
            point = polylabel(selected_component, tolerance=0.05)
            placements.append((point, selected_component, "largest-component-polylabel"))
        state_name = metadata.get("stateName", metadata["name"])
        for placement_index, (point, selected_component, placement_method) in enumerate(
            placements,
            start=1,
        ):
            clearance = point.distance(selected_component.boundary)
            if clearance <= 0:
                raise RuntimeError(
                    f"Production label point for {country_id} is not safely inside its component"
                )
            label_id = f"{country_id}-production-label"
            if len(placements) > 1:
                label_id += f"-{placement_index}"
            properties = {
                "id": label_id,
                "countryId": country_id,
                "name": state_name,
                "type": "country-label",
                "stateGroupId": metadata.get("stateGroupId", country_id),
                "labelRank": label_rank(state_area[metadata.get("stateGroupId", country_id)]),
                "areaWorld": state_area[metadata.get("stateGroupId", country_id)],
                "placementMethod": placement_method,
                "boundaryClearanceWorld": clearance,
            }
            labels.append({
                "type": "Feature",
                "id": properties["id"],
                "properties": properties,
                "geometry": mapping(point),
            })
            report_rows.append({
                "countryId": country_id,
                "name": state_name,
                "labelIndex": placement_index,
                "componentCount": len(components),
                "placementMethod": placement_method,
                "labelPointWorld": [point.x, point.y],
                "boundaryClearanceWorld": clearance,
                "manualOverrideReason": override.get("reason") if override else None,
            })

    expected_label_count = sum(
        len(overrides.get(country_id, {}).get("componentAnchors", [None]))
        for country_id, metadata in names.items()
        if metadata.get("productionLabel", True)
    )
    if len(labels) != expected_label_count:
        raise RuntimeError(
            f"Expected {expected_label_count} political-entity labels, generated {len(labels)}"
        )
    write_json(OUTPUT_PATH, {"type": "FeatureCollection", "features": labels})
    write_json(REPORT_PATH, {"productionLabelCount": len(labels), "labels": report_rows})
    print(f"Named {len(country_by_id)} country features and generated {len(labels)} production state labels")


if __name__ == "__main__":
    main()
