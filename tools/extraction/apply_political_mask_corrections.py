#!/usr/bin/env python3
"""Apply reviewed, coordinate-specific corrections to the political source mask."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
TARGET_MAIN_SEED = (900, 1000)
TARGET_NORTH_ISLAND_SEED = (937, 928)
UNCLAIMED_BGR = (128, 128, 128)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mask", type=Path, default=ROOT / "countries-mask.png")
    parser.add_argument("--land-mask", type=Path, default=ROOT / "land-mask.png")
    parser.add_argument(
        "--public-copy",
        type=Path,
        default=ROOT / "public" / "countries-mask.png",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=ROOT / "public" / "data" / "political-mask-corrections-report.json",
    )
    return parser.parse_args()


def component_at(labels: np.ndarray, point: tuple[int, int]) -> int:
    x, y = point
    component = int(labels[y, x])
    if component == 0:
        raise RuntimeError(f"Correction seed is outside land: {point}")
    return component


def main() -> None:
    args = parse_args()
    mask = cv2.imread(str(args.mask), cv2.IMREAD_COLOR)
    land_gray = cv2.imread(str(args.land_mask), cv2.IMREAD_GRAYSCALE)
    if mask is None:
        raise FileNotFoundError(args.mask)
    if land_gray is None:
        raise FileNotFoundError(args.land_mask)
    if mask.shape[:2] != land_gray.shape:
        raise RuntimeError("Political and land masks must have identical dimensions")

    land = land_gray >= 128
    _, land_labels, land_stats, _ = cv2.connectedComponentsWithStats(
        land.astype(np.uint8), 8
    )
    main_component = component_at(land_labels, TARGET_MAIN_SEED)
    north_component = component_at(land_labels, TARGET_NORTH_ISLAND_SEED)

    original_mask = mask.copy()
    ocean_colored = np.all(mask == 0, axis=2)
    unclaimed_colored = np.all(mask == UNCLAIMED_BGR, axis=2)
    neutral_candidate = ocean_colored | unclaimed_colored
    main_unknown = (land_labels == main_component) & neutral_candidate
    count, unknown_labels, unknown_stats, _ = cv2.connectedComponentsWithStats(
        main_unknown.astype(np.uint8), 8
    )
    if count <= 1:
        raise RuntimeError("Reviewed neutral territory was not found")
    beige_component = max(
        range(1, count),
        key=lambda component: int(unknown_stats[component, cv2.CC_STAT_AREA]),
    )
    beige_mainland = unknown_labels == beige_component
    beige_bbox = [int(value) for value in unknown_stats[beige_component, :4]]
    beige_area = int(unknown_stats[beige_component, cv2.CC_STAT_AREA])
    if beige_area < 8000 or beige_bbox != [887, 939, 120, 138]:
        raise RuntimeError(
            f"Reviewed neutral territory changed unexpectedly: area={beige_area}, bbox={beige_bbox}"
        )

    north_island = land_labels == north_component
    if np.any(~neutral_candidate[north_island]):
        raise RuntimeError("Northern neutral island unexpectedly contains a country seed")

    correction = beige_mainland | north_island
    country_pixels_before = land & np.any(mask != 0, axis=2) & ~unclaimed_colored
    mask[correction] = UNCLAIMED_BGR
    if np.any(mask[country_pixels_before] != original_mask[country_pixels_before]):
        raise RuntimeError("Correction attempted to modify existing country pixels")

    cv2.imwrite(str(args.mask), mask)
    args.public_copy.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.public_copy), mask)

    report = {
        "correction": "target-island-beige-territory-to-explicit-unclaimed",
        "unclaimedRgb": [128, 128, 128],
        "mainLandComponent": main_component,
        "mainTerritory": {"area": beige_area, "bbox": beige_bbox},
        "northIsland": {
            "landComponent": north_component,
            "area": int(land_stats[north_component, cv2.CC_STAT_AREA]),
            "bbox": [int(value) for value in land_stats[north_component, :4]],
        },
        "totalPixelsMarkedUnclaimed": int(np.count_nonzero(correction)),
        "existingCountryPixelsChanged": 0,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
