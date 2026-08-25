#!/usr/bin/env python3
"""Transfer the reviewed Izmatia territory from country-013 to country-006."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
COUNTRY_006_RGB = np.asarray([0, 127, 127], dtype=np.int16)
COUNTRY_013_RGB = np.asarray([91, 127, 0], dtype=np.int16)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=Path,
        default=ROOT / "public/data/regions/country-006/mainland/regions-config.json",
    )
    parser.add_argument("--mask", type=Path, default=ROOT / "countries-mask.png")
    parser.add_argument("--land-mask", type=Path, default=ROOT / "land-mask.png")
    parser.add_argument("--public-copy", type=Path, default=ROOT / "public/countries-mask.png")
    return parser.parse_args()


def read_image(path: Path, flags: int) -> np.ndarray:
    image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), flags)
    if image is None:
        raise FileNotFoundError(path)
    return image


def write_image(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ok, encoded = cv2.imencode(path.suffix, image)
    if not ok:
        raise RuntimeError(f"Cannot encode image: {path}")
    encoded.tofile(path)


def fill_holes(mask: np.ndarray) -> np.ndarray:
    padded = cv2.copyMakeBorder(mask, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    flood = padded.copy()
    flood_mask = np.zeros((flood.shape[0] + 2, flood.shape[1] + 2), dtype=np.uint8)
    cv2.floodFill(flood, flood_mask, (0, 0), 255)
    return cv2.bitwise_or(mask, cv2.bitwise_not(flood)[1:-1, 1:-1])


def main() -> None:
    args = parse_args()
    config_path = args.config.resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    source = read_image(config_path.parent / config["referenceSource"], cv2.IMREAD_COLOR)
    political = read_image(args.mask, cv2.IMREAD_COLOR)
    land = read_image(args.land_mask, cv2.IMREAD_GRAYSCALE) >= 128
    if political.shape[:2] != land.shape:
        raise RuntimeError("Political and land masks must have identical dimensions")

    settings = config["preparation"]
    captured_rgb = np.asarray(settings["capturedRegionFillRgb"], dtype=np.int16)
    source_rgb = source[:, :, ::-1].astype(np.int16)
    captured = (
        np.max(np.abs(source_rgb - captured_rgb), axis=2)
        <= int(settings["capturedColorTolerance"])
    ).astype(np.uint8) * 255
    captured = cv2.morphologyEx(
        captured, cv2.MORPH_CLOSE, np.ones((7, 7), dtype=np.uint8)
    )
    captured = fill_holes(captured)
    count, labels, stats, _ = cv2.connectedComponentsWithStats((captured > 0).astype(np.uint8), 8)
    if count <= 1:
        raise RuntimeError("Captured Izmatia component was not found")
    component = max(range(1, count), key=lambda index: int(stats[index, cv2.CC_STAT_AREA]))
    captured = (labels == component).astype(np.uint8) * 255

    local_left, local_top, local_right, local_bottom = config["alignment"]["localLandBoundsPx"]
    world_left, world_top, world_right, world_bottom = config["targetTerritory"][
        "expectedTransformComponentBoundsWorld"
    ]
    scale_x = (world_right - world_left) / (local_right - local_left)
    scale_y = (world_bottom - world_top) / (local_bottom - local_top)
    offset_x = world_left - local_left * scale_x
    offset_y = world_top - local_top * scale_y
    transform = np.asarray([[scale_x, 0, offset_x], [0, scale_y, offset_y]], dtype=np.float32)
    transfer = cv2.warpAffine(
        captured,
        transform,
        (political.shape[1], political.shape[0]),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    ) > 0
    transfer &= land

    political_rgb = political[:, :, ::-1].astype(np.int16)
    distance_006 = np.sum((political_rgb - COUNTRY_006_RGB) ** 2, axis=2)
    distance_013 = np.sum((political_rgb - COUNTRY_013_RGB) ** 2, axis=2)
    belongs_to_pair = np.minimum(distance_006, distance_013) <= 3200
    foreign_pixels = transfer & ~belongs_to_pair
    foreign_count = int(np.count_nonzero(foreign_pixels))
    if foreign_count > 32 or foreign_count / max(1, int(np.count_nonzero(transfer))) > 0.08:
        foreign_colors, foreign_counts = np.unique(
            political_rgb[foreign_pixels], axis=0, return_counts=True
        )
        frequent_foreign_colors = sorted(
            zip(foreign_counts.tolist(), foreign_colors.tolist()), reverse=True
        )[:8]
        raise RuntimeError(
            "Izmatia transfer intersects "
            f"{foreign_count} foreign pixels: {frequent_foreign_colors}"
        )
    transfer &= belongs_to_pair
    from_013 = transfer & (distance_013 < distance_006)
    already_006 = transfer & ~from_013
    if np.count_nonzero(from_013) == 0 and np.count_nonzero(already_006) == 0:
        raise RuntimeError("Izmatia transfer does not intersect country-006/country-013")

    political[transfer] = COUNTRY_006_RGB[::-1].astype(np.uint8)

    # The capture creates a new continuous frontier. Small disconnected remnants of
    # country-013 inside the reviewed transfer window are raster artefacts, not
    # enclaves; keep the large connected mainland component untouched.
    updated_rgb = political[:, :, ::-1].astype(np.int16)
    updated_distance_006 = np.sum((updated_rgb - COUNTRY_006_RGB) ** 2, axis=2)
    updated_distance_013 = np.sum((updated_rgb - COUNTRY_013_RGB) ** 2, axis=2)
    # Limit component detection to actual country-013 pixels. Comparing only
    # against country-006 can accidentally classify nearby third-country colours
    # as country-013 and connect otherwise isolated raster specks to the mainland.
    country_013_like = (updated_distance_013 <= 3200).astype(np.uint8)
    component_count, component_labels, component_stats, _ = cv2.connectedComponentsWithStats(
        country_013_like, 8
    )
    transfer_y, transfer_x = np.where(transfer)
    review_bounds = (
        int(transfer_x.min()) - 2,
        int(transfer_y.min()) - 2,
        int(transfer_x.max()) + 3,
        int(transfer_y.max()) + 3,
    )
    artefact_mask = np.zeros_like(transfer)
    artefact_components = []
    for component_index in range(1, component_count):
        x, y, width, height, area = [
            int(value) for value in component_stats[component_index]
        ]
        inside_review = (
            x >= review_bounds[0]
            and y >= review_bounds[1]
            and x + width <= review_bounds[2]
            and y + height <= review_bounds[3]
        )
        if inside_review and area <= 32:
            artefact_mask |= component_labels == component_index
            artefact_components.append({
                "area": area,
                "bbox": [x, y, width, height],
            })
    political[artefact_mask] = COUNTRY_006_RGB[::-1].astype(np.uint8)
    write_image(args.mask, political)
    write_image(args.public_copy, political)

    ys, xs = np.where(transfer)
    report = {
        "correction": "country-013-izmatia-to-country-006",
        "sourceDataset": config["datasetId"],
        "sourceRegionNumber": 16,
        "fromCountryId": "country-013",
        "toCountryId": "country-006",
        "pixelsTransferredFromCountry013": int(np.count_nonzero(from_013)),
        "pixelsAlreadyCountry006": int(np.count_nonzero(already_006)),
        "foreignPixelsPreserved": foreign_count,
        "country013ArtefactPixelsReassigned": int(np.count_nonzero(artefact_mask)),
        "country013ArtefactComponents": artefact_components,
        "worldPixelBounds": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
        "transform": {
            "scaleX": scale_x,
            "scaleY": scale_y,
            "offsetX": offset_x,
            "offsetY": offset_y,
        },
    }
    report_path = config_path.parent / "political-transfer-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
