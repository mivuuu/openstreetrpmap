#!/usr/bin/env python3
"""Create a technical categorical region mask from drawn boundary linework."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from region_pipeline import atomic_write_json, odd_kernel, reference_land_mask


ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    return parser.parse_args()


def categorical_colors(count: int) -> np.ndarray:
    colors = []
    for index in range(count):
        hsv = np.uint8([[[int(index * 137.508) % 180, 220, 240]]])
        bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0, 0]
        colors.append(bgr)
    return np.asarray(colors, dtype=np.uint8)


def main() -> None:
    args = parse_args()
    config_path = args.config.resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    folder = config_path.parent
    settings = config["maskPreparation"]
    source_path = folder / config["reference"]
    source = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
    if source is None:
        raise FileNotFoundError(source_path)

    land, land_report = reference_land_mask(source, settings)
    component_count, component_labels, component_stats, _ = cv2.connectedComponentsWithStats(land, 8)
    ranked_components = sorted(
        range(1, component_count),
        key=lambda component: int(component_stats[component, cv2.CC_STAT_AREA]),
        reverse=True,
    )
    rank = int(settings["selectedLandComponentRank"])
    if rank < 1 or rank > len(ranked_components):
        raise ValueError("selectedLandComponentRank is outside detected land components")
    selected_component = ranked_components[rank - 1]
    selected_land = component_labels == selected_component

    grayscale = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY).astype(np.float32)
    blurred = cv2.GaussianBlur(
        grayscale,
        (0, 0),
        float(settings["boundaryGaussianSigma"]),
    )
    dark_linework = ((blurred - grayscale) > settings["boundaryDarknessThreshold"]).astype(np.uint8)
    dark_linework &= selected_land.astype(np.uint8)
    dark_linework = cv2.morphologyEx(
        dark_linework,
        cv2.MORPH_CLOSE,
        odd_kernel(settings["boundaryCloseKernel"]),
    )
    dark_linework = cv2.dilate(
        dark_linework,
        odd_kernel(settings["boundaryDilationKernel"]),
    )

    open_faces = selected_land & (dark_linework == 0)
    face_count, face_labels, face_stats, face_centroids = cv2.connectedComponentsWithStats(
        open_faces.astype(np.uint8),
        4,
    )
    faces = [
        component
        for component in range(1, face_count)
        if face_stats[component, cv2.CC_STAT_AREA] >= settings["minimumRegionFaceArea"]
    ]
    faces.sort(key=lambda component: (face_centroids[component, 1], face_centroids[component, 0]))
    seeds = np.zeros_like(face_labels, dtype=np.int32)
    for label, component in enumerate(faces, start=1):
        seeds[face_labels == component] = label

    distance_input = np.where(seeds > 0, 0, 1).astype(np.uint8)
    _, nearest_pixels = cv2.distanceTransformWithLabels(
        distance_input,
        cv2.DIST_L2,
        5,
        labelType=cv2.DIST_LABEL_PIXEL,
    )
    lookup = np.zeros(int(nearest_pixels.max()) + 1, dtype=np.int32)
    seed_pixels = seeds > 0
    lookup[nearest_pixels[seed_pixels]] = seeds[seed_pixels]
    labels = np.where(selected_land, lookup[nearest_pixels], 0).astype(np.int32)

    colors = categorical_colors(len(faces))
    output = np.zeros_like(source)
    for label, color in enumerate(colors, start=1):
        output[labels == label] = color
    mask_path = folder / config["source"]
    if not cv2.imwrite(str(mask_path), output):
        raise RuntimeError(f"Cannot write {mask_path}")

    preview = source.copy()
    overlay = labels > 0
    preview[overlay] = (preview[overlay] * 0.52 + output[overlay] * 0.48).astype(np.uint8)
    preview[dark_linework > 0] = (24, 24, 24)
    preview_path = ROOT / "public" / "debug" / f"{config['parentCountryId']}-regions-mask-preview.png"
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(preview_path), preview)

    report = {
        "parentCountryId": config["parentCountryId"],
        "referenceLand": land_report,
        "selectedLandComponentRank": rank,
        "selectedLandPixelCount": int(np.count_nonzero(selected_land)),
        "regionFaceCount": len(faces),
        "assignedPixelCount": int(np.count_nonzero(labels)),
        "unassignedReferenceLandPixelCount": int(np.count_nonzero(land & ~selected_land)),
        "islandsAutoAssigned": False,
        "regionAutofillUsed": False,
        "method": "dark-boundary linework polygonization; relief colors are ignored",
    }
    atomic_write_json(folder / "regions-mask-report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
