#!/usr/bin/env python3
"""Generate physical land and coastline exclusively from land-mask.png."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from land_pipeline import clip_politics_to_land, extract_land_products, read_binary_land_mask


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = Path(__file__).with_name("extraction.config.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--land-mask", type=Path, default=ROOT / "land-mask.png")
    parser.add_argument("--original", type=Path, default=ROOT / "worldmap.png")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public" / "data")
    parser.add_argument(
        "--preview",
        type=Path,
        default=ROOT / "public" / "debug" / "land-original-overlay.png",
    )
    return parser.parse_args()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary.replace(path)


def render_preview(original_path: Path, binary: np.ndarray) -> np.ndarray:
    original = cv2.imread(str(original_path), cv2.IMREAD_COLOR)
    if original is None:
        raise FileNotFoundError(f"Cannot read original map: {original_path}")
    if original.shape[:2] != binary.shape:
        raise ValueError("Original map and land mask dimensions do not match")

    preview = original.astype(np.float32)
    land = binary > 0
    overlay_color = np.asarray([116, 220, 104], dtype=np.float32)
    preview[land] = preview[land] * 0.66 + overlay_color * 0.34
    binary_u8 = (binary * 255).astype(np.uint8)
    boundary = cv2.morphologyEx(binary_u8, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    preview[boundary > 0] = np.asarray([255, 220, 40], dtype=np.float32)
    return np.clip(preview, 0, 255).astype(np.uint8)


def main() -> None:
    args = parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    settings = config["landMask"]
    binary, raster_report = read_binary_land_mask(
        args.land_mask,
        settings["threshold"],
        settings["worldWidth"],
        settings["worldHeight"],
    )
    land, coastline, vector_report = extract_land_products(
        binary,
        settings["simplificationTolerance"],
        settings["snapTolerancePx"],
    )
    report = {"raster": raster_report, "vector": vector_report}

    countries_path = args.output_dir / "countries.geojson"
    borders_path = args.output_dir / "country-borders.geojson"
    countries = json.loads(countries_path.read_text(encoding="utf-8"))
    borders = json.loads(borders_path.read_text(encoding="utf-8"))
    unclaimed_path = args.output_dir / "unclaimed.geojson"
    unclaimed = (
        json.loads(unclaimed_path.read_text(encoding="utf-8"))
        if unclaimed_path.exists()
        else {"type": "FeatureCollection", "features": []}
    )
    display_countries, display_borders, unassigned_land, clipping_report = clip_politics_to_land(
        countries,
        borders,
        land,
        unclaimed,
    )
    report["politicalDisplayClip"] = clipping_report

    write_json(args.output_dir / "land.geojson", land)
    write_json(args.output_dir / "coastline.geojson", coastline)
    write_json(args.output_dir / "countries-display.geojson", display_countries)
    write_json(args.output_dir / "country-borders-display.geojson", display_borders)
    write_json(args.output_dir / "unassigned-land.geojson", unassigned_land)
    write_json(args.output_dir / "land-report.json", report)
    args.preview.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.preview), render_preview(args.original, binary))

    print(f"binary land components: {vector_report['binaryConnectedComponentCount']}")
    print(f"vector land polygons: {vector_report['vectorPolygonCount']}")
    print(f"removed components: {vector_report['removedComponentCount']}")
    print(f"coastline features: {vector_report['coastlineFeatureCount']}")
    print(f"unassigned land area: {clipping_report['unassignedLandArea']:.3f}")
    print(
        "country area clipped from display: "
        f"{clipping_report['countryAreaOutsideLandRemovedFromDisplay']:.3f}"
    )
    print(f"valid geometry: {vector_report['valid']}")
    print(f"wrote: {args.output_dir / 'land.geojson'}")
    print(f"wrote: {args.output_dir / 'coastline.geojson'}")
    print(f"wrote: {args.output_dir / 'land-report.json'}")
    print(f"wrote: {args.preview}")


if __name__ == "__main__":
    main()
