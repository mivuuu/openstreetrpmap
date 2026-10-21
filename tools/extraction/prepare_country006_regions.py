#!/usr/bin/env python3
"""Prepare clean regional linework from the annotated country-006 reference."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    return parser.parse_args()


def read_image(path: Path) -> np.ndarray:
    image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(path)
    return image


def write_image(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imencode(path.suffix, image)[0]:
        raise RuntimeError(f"Cannot encode image: {path}")
    cv2.imencode(path.suffix, image)[1].tofile(path)


def fill_component_holes(mask: np.ndarray) -> np.ndarray:
    padded = cv2.copyMakeBorder(mask, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    flood = padded.copy()
    flood_mask = np.zeros((flood.shape[0] + 2, flood.shape[1] + 2), dtype=np.uint8)
    cv2.floodFill(flood, flood_mask, (0, 0), 255)
    holes = cv2.bitwise_not(flood)[1:-1, 1:-1]
    return cv2.bitwise_or(mask, holes)


def main() -> None:
    args = parse_args()
    config_path = args.config.resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    source_path = config_path.parent / config["referenceSource"]
    output_path = config_path.parent / config["source"]
    settings = config["preparation"]

    source = read_image(source_path)
    rgb = source[:, :, ::-1].astype(np.int16)
    dark_fill = np.asarray(settings["countryFillRgb"], dtype=np.int16)
    captured_fill = np.asarray(settings["capturedRegionFillRgb"], dtype=np.int16)
    dark_distance = np.max(np.abs(rgb - dark_fill), axis=2)
    captured_distance = np.max(np.abs(rgb - captured_fill), axis=2)
    territory = (
        (dark_distance <= int(settings["fillColorTolerance"]))
        | (captured_distance <= int(settings["capturedColorTolerance"]))
    ).astype(np.uint8) * 255
    close_size = int(settings["territoryCloseKernel"])
    territory = cv2.morphologyEx(
        territory,
        cv2.MORPH_CLOSE,
        np.ones((close_size, close_size), dtype=np.uint8),
    )
    territory = fill_component_holes(territory)

    component_count, component_labels, stats, _ = cv2.connectedComponentsWithStats(
        (territory > 0).astype(np.uint8), 8
    )
    minimum_area = int(settings["minimumTerritoryComponentArea"])
    keep = np.zeros_like(territory)
    kept_components = []
    for component in range(1, component_count):
        area = int(stats[component, cv2.CC_STAT_AREA])
        if area >= minimum_area:
            keep[component_labels == component] = 255
            kept_components.append({
                "component": component,
                "area": area,
                "bbox": [int(value) for value in stats[component, :4]],
            })
    territory = keep

    red, green, blue = [rgb[:, :, channel] for channel in range(3)]
    captured_like = captured_distance <= int(settings["capturedBoundaryExclusionTolerance"])
    internal = (
        (green - red >= int(settings["boundaryGreenMinusRed"]))
        & (blue - red >= int(settings["boundaryBlueMinusRed"]))
        & (green >= int(settings["boundaryMinimumGreen"]))
        & (np.abs(blue - green) <= int(settings["boundaryBlueGreenTolerance"]))
        & (red <= int(settings["boundaryMaximumRed"]))
        & ~captured_like
        & (territory > 0)
    ).astype(np.uint8) * 255
    internal = cv2.morphologyEx(
        internal,
        cv2.MORPH_CLOSE,
        np.ones((3, 3), dtype=np.uint8),
    )
    internal = cv2.dilate(
        internal,
        np.ones((int(settings["boundaryDilationKernel"]),) * 2, dtype=np.uint8),
    )

    linework = np.full(source.shape[:2], 255, dtype=np.uint8)
    contours, _ = cv2.findContours(territory, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(linework, contours, -1, 0, int(settings["outerBoundaryThickness"]))
    linework[internal > 0] = 0
    write_image(output_path, linework)
    write_image(config_path.parent / "regions-territory-mask.png", territory)
    write_image(config_path.parent / "regions-internal-boundaries.png", internal)

    report = {
        "referenceSource": str(source_path),
        "imageSize": [source.shape[1], source.shape[0]],
        "keptTerritoryComponents": kept_components,
        "territoryPixels": int(np.count_nonzero(territory)),
        "internalBoundaryPixels": int(np.count_nonzero(internal)),
    }
    (config_path.parent / "regions-preparation-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
