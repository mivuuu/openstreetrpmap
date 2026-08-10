#!/usr/bin/env python3
"""Fill missing political labels inside land without crossing water."""

from __future__ import annotations

import argparse
from collections import deque
import hashlib
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from extract_map import mask_country_labels
from land_pipeline import read_binary_land_mask
from mask_states import classify_mask_states, configured_colors


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = Path(__file__).with_name("extraction.config.json")
NEIGHBOURS = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("analyze", "safe", "full"), default="safe")
    parser.add_argument("--land-mask", type=Path, default=ROOT / "land-mask.png")
    parser.add_argument("--countries-mask", type=Path, default=ROOT / "countries-mask.png")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--max-fill-distance", type=int)
    parser.add_argument("--output", type=Path, default=ROOT / "countries-mask-filled.png")
    parser.add_argument(
        "--filled-debug",
        type=Path,
        default=ROOT / "public" / "debug" / "filled-pixels-debug.png",
    )
    parser.add_argument(
        "--unresolved-debug",
        type=Path,
        default=ROOT / "public" / "debug" / "unresolved-debug.png",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=ROOT / "public" / "data" / "countries-mask-fill-report.json",
    )
    parser.add_argument(
        "--coverage-debug",
        type=Path,
        default=ROOT / "public" / "debug" / "country-coverage-debug.png",
    )
    return parser.parse_args()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def propagate_inside_land(
    land: np.ndarray,
    seed_labels: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """8-neighbour multi-source BFS; non-land cells are never enqueued."""
    propagated = seed_labels.copy()
    distance = np.full(land.shape, -1, dtype=np.int32)
    seeds = land & (seed_labels > 0)
    missing = land & (seed_labels == 0)
    distance[seeds] = 0

    # Only seed pixels touching a missing cell need to enter the queue. This
    # keeps the propagation O(land pixels) without queuing every filled interior.
    missing_neighbourhood = cv2.dilate(missing.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    boundary_seeds = seeds & missing_neighbourhood
    queue = deque(zip(*np.nonzero(boundary_seeds)))
    height, width = land.shape

    while queue:
        y, x = queue.popleft()
        next_distance = int(distance[y, x]) + 1
        label = int(propagated[y, x])
        for dy, dx in NEIGHBOURS:
            ny, nx = y + dy, x + dx
            if (
                0 <= ny < height
                and 0 <= nx < width
                and land[ny, nx]
                and distance[ny, nx] < 0
            ):
                distance[ny, nx] = next_distance
                propagated[ny, nx] = label
                queue.append((ny, nx))

    return propagated, distance


def percentile_report(values: np.ndarray) -> dict[str, int]:
    if values.size == 0:
        return {"p50": 0, "p90": 0, "p95": 0, "p99": 0, "maximum": 0}
    return {
        f"p{percentile}": int(np.percentile(values, percentile, method="higher"))
        for percentile in (50, 90, 95, 99)
    } | {"maximum": int(values.max())}


def connected_region_report(mask: np.ndarray, distance: np.ndarray) -> list[dict[str, Any]]:
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(
        mask.astype(np.uint8), 8
    )
    regions: list[dict[str, Any]] = []
    for component in range(1, count):
        values = distance[labels == component]
        reachable_values = values[values >= 0]
        regions.append({
            "area": int(stats[component, cv2.CC_STAT_AREA]),
            "bbox": {
                "x": int(stats[component, cv2.CC_STAT_LEFT]),
                "y": int(stats[component, cv2.CC_STAT_TOP]),
                "width": int(stats[component, cv2.CC_STAT_WIDTH]),
                "height": int(stats[component, cv2.CC_STAT_HEIGHT]),
            },
            "centroid": [float(centroids[component, 0]), float(centroids[component, 1])],
            "cause": "seedless-land-component" if reachable_values.size == 0 else "beyond-safe-distance",
            "maximumReachableDistancePx": (
                int(reachable_values.max()) if reachable_values.size else None
            ),
        })
    return sorted(regions, key=lambda region: region["area"], reverse=True)


def main() -> None:
    args = parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    land_settings = config["landMask"]
    fill_settings = config["countryFill"]
    max_fill_distance = (
        args.max_fill_distance
        if args.max_fill_distance is not None
        else int(fill_settings["maxFillDistancePx"])
    )

    land_labels, land_raster_report = read_binary_land_mask(
        args.land_mask,
        land_settings["threshold"],
        land_settings["worldWidth"],
        land_settings["worldHeight"],
    )
    land = land_labels > 0
    country_labels, _, palette, _, _ = mask_country_labels(
        args.countries_mask,
        config["countries"],
        config["maskStates"],
    )
    raw = cv2.imread(str(args.countries_mask), cv2.IMREAD_UNCHANGED)
    if raw is None:
        raise FileNotFoundError(f"Cannot read countries mask: {args.countries_mask}")
    raw_bgr = raw[:, :, :3].copy()
    raw_rgb = cv2.cvtColor(raw_bgr, cv2.COLOR_BGR2RGB)
    alpha = raw[:, :, 3] if raw.shape[2] == 4 else np.full(land.shape, 255, dtype=np.uint8)
    states = classify_mask_states(land, raw_rgb, alpha, config["maskStates"])
    _, unclaimed_rgb = configured_colors(config["maskStates"])

    walkable = land & ~states.unclaimed
    seed_labels = np.where(walkable, country_labels, 0).astype(np.int32)
    existing_land_country = states.country
    missing_land = states.unknown_land
    country_outside_land = states.country_outside_land

    component_count, component_labels, component_stats, component_centroids = (
        cv2.connectedComponentsWithStats(walkable.astype(np.uint8), 8)
    )
    seed_count_by_component = np.bincount(
        component_labels[seed_labels > 0],
        minlength=component_count,
    )
    seedless_components: list[dict[str, Any]] = []
    for component in range(1, component_count):
        if seed_count_by_component[component] == 0:
            seedless_components.append({
                "component": component,
                "area": int(component_stats[component, cv2.CC_STAT_AREA]),
                "bbox": {
                    "x": int(component_stats[component, cv2.CC_STAT_LEFT]),
                    "y": int(component_stats[component, cv2.CC_STAT_TOP]),
                    "width": int(component_stats[component, cv2.CC_STAT_WIDTH]),
                    "height": int(component_stats[component, cv2.CC_STAT_HEIGHT]),
                },
                "centroid": [
                    float(component_centroids[component, 0]),
                    float(component_centroids[component, 1]),
                ],
            })

    propagated, distance = propagate_inside_land(walkable, seed_labels)
    reachable_missing = missing_land & (distance >= 0)
    seedless_missing = missing_land & (distance < 0)
    reachable_distances = distance[reachable_missing]
    distribution = percentile_report(reachable_distances)
    threshold_counts = {
        str(threshold): int(np.count_nonzero(reachable_distances <= threshold))
        for threshold in (4, 8, 16, 32, 42, 61, 79)
    }

    if args.mode == "full":
        fill_pixels = reachable_missing
    elif args.mode == "safe":
        fill_pixels = reachable_missing & (distance <= max_fill_distance)
    else:
        fill_pixels = np.zeros_like(land)
    unresolved = missing_land & ~fill_pixels
    unresolved_regions = connected_region_report(unresolved, distance)

    ilyra_x, ilyra_y, ilyra_radius = 840, 740, 140
    ilyra_slice = np.s_[
        ilyra_y - ilyra_radius : ilyra_y + ilyra_radius + 1,
        ilyra_x - ilyra_radius : ilyra_x + ilyra_radius + 1,
    ]
    ilyra_reachable_distances = distance[ilyra_slice][
        missing_land[ilyra_slice] & (distance[ilyra_slice] >= 0)
    ]

    report: dict[str, Any] = {
        "mode": args.mode,
        "algorithm": "8-neighbour multi-source BFS constrained to land minus explicit unclaimed",
        "oceanIsBarrier": True,
        "unclaimedIsBarrier": True,
        "rgbDistanceUsed": False,
        "maskStates": {
            "oceanRgb": config["maskStates"]["oceanRgb"],
            "unclaimedRgb": config["maskStates"]["unclaimedRgb"],
        },
        "sourceHashes": {
            "landMaskSha256": sha256(args.land_mask),
            "countriesMaskSha256": sha256(args.countries_mask),
        },
        "landRaster": land_raster_report,
        "paletteCountryCount": len(palette),
        "propagationComponentCount": component_count - 1,
        "seedlessLandComponentCount": len(seedless_components),
        "seedlessLandComponents": seedless_components,
        "pixels": {
            "missingLandBeforeFill": int(np.count_nonzero(missing_land)),
            "reachableMissingLand": int(np.count_nonzero(reachable_missing)),
            "seedlessMissingLand": int(np.count_nonzero(seedless_missing)),
            "filledAutomatically": int(np.count_nonzero(fill_pixels)),
            "unresolvedAfterFill": int(np.count_nonzero(unresolved)),
            "existingCountryInsideLand": int(np.count_nonzero(existing_land_country)),
            "existingCountryOutsideLandClearedInCandidate": int(np.count_nonzero(country_outside_land)),
            "explicitUnclaimedInsideLand": int(np.count_nonzero(states.unclaimed)),
            "unclaimedOutsideLand": int(np.count_nonzero(states.unclaimed_outside_land)),
        },
        "distanceDistributionPx": distribution,
        "reachablePixelsWithinDistancePx": threshold_counts,
        "safeMaxFillDistancePx": max_fill_distance,
        "maximumAppliedFillDistancePx": (
            int(distance[fill_pixels].max()) if np.any(fill_pixels) else 0
        ),
        "unresolvedRegionCount": len(unresolved_regions),
        "unresolvedRegions": unresolved_regions,
        "ilyraRegression": {
            "center": [ilyra_x, ilyra_y],
            "radius": ilyra_radius,
            "missingBefore": int(np.count_nonzero(missing_land[ilyra_slice])),
            "filled": int(np.count_nonzero(fill_pixels[ilyra_slice])),
            "unresolved": int(np.count_nonzero(unresolved[ilyra_slice])),
            "maximumReachableMissingDistance": (
                int(ilyra_reachable_distances.max())
                if ilyra_reachable_distances.size
                else 0
            ),
        },
    }

    if args.mode != "analyze":
        candidate = np.zeros_like(raw_bgr)
        candidate[existing_land_country] = raw_bgr[existing_land_country]
        candidate[states.unclaimed] = unclaimed_rgb[::-1]
        palette_bgr = np.asarray([color[::-1] for color in palette], dtype=np.uint8)
        for label in range(1, len(palette) + 1):
            assigned = fill_pixels & (propagated == label)
            candidate[assigned] = palette_bgr[label - 1]

        validation = {
            "existingCountryPixelsChangedInsideLand": int(
                np.count_nonzero(np.any(candidate[existing_land_country] != raw_bgr[existing_land_country], axis=1))
            ),
            "candidateCountryPixelsInOcean": int(
                np.count_nonzero(states.ocean & np.any(candidate != 0, axis=2))
            ),
            "candidateUnclaimedPixelsInOcean": int(
                np.count_nonzero(
                    (~land) & np.all(candidate == unclaimed_rgb[::-1], axis=2)
                )
            ),
            "sourceUnclaimedPixelsOutsideLand": int(
                np.count_nonzero(states.unclaimed_outside_land)
            ),
            "unclaimedPixelsChangedInsideLand": int(
                np.count_nonzero(
                    np.any(candidate[states.unclaimed] != raw_bgr[states.unclaimed], axis=1)
                )
            ),
            "candidateAssignedLandPixels": int(
                np.count_nonzero(land & ~states.unclaimed & np.any(candidate != 0, axis=2))
            ),
            "candidateUnclaimedLandPixels": int(np.count_nonzero(states.unclaimed)),
            "explicitUnresolvedLandPixels": int(np.count_nonzero(unresolved)),
            "landCoverageBalanced": bool(
                np.count_nonzero(land & ~states.unclaimed & np.any(candidate != 0, axis=2))
                + np.count_nonzero(states.unclaimed)
                + np.count_nonzero(unresolved)
                == np.count_nonzero(land)
            ),
        }
        report["validation"] = validation
        args.output.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(args.output), candidate)
        public_candidate = ROOT / "public" / "countries-mask-filled.png"
        cv2.imwrite(str(public_candidate), candidate)

        filled_debug = np.zeros_like(raw_bgr)
        filled_debug[fill_pixels] = (255, 0, 255)
        unresolved_debug = np.zeros_like(raw_bgr)
        unresolved_debug[unresolved] = (0, 0, 255)
        args.filled_debug.parent.mkdir(parents=True, exist_ok=True)
        args.unresolved_debug.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(args.filled_debug), filled_debug)
        cv2.imwrite(str(args.unresolved_debug), unresolved_debug)

        coverage_debug = np.zeros_like(raw_bgr)
        assigned_land = land & ~states.unclaimed & np.any(candidate != 0, axis=2)
        coverage_debug[assigned_land] = (0, 255, 0)  # green: claimed
        coverage_debug[states.unclaimed] = unclaimed_rgb[::-1]  # gray: intentional neutral
        coverage_debug[unresolved] = (0, 0, 255)  # red: accidental unknown gap
        coverage_debug[country_outside_land] = (255, 0, 0)  # blue: country over ocean
        coverage_debug[states.unclaimed_outside_land] = (255, 0, 255)  # purple
        args.coverage_debug.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(args.coverage_debug), coverage_debug)

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
