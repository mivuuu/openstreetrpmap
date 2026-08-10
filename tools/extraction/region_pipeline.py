"""Shared helpers for country-local region authoring pipelines."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon


def odd_kernel(size: int) -> np.ndarray:
    normalized = max(1, int(size))
    if normalized % 2 == 0:
        normalized += 1
    return np.ones((normalized, normalized), dtype=np.uint8)


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary.replace(path)


def reference_land_mask(image: np.ndarray, settings: dict[str, Any]) -> tuple[np.ndarray, dict[str, Any]]:
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB).astype(np.int16)
    land = (
        rgb[:, :, 0] - rgb[:, :, 2]
        > int(settings["landRedMinusBlueThreshold"])
    ).astype(np.uint8)
    land = cv2.morphologyEx(
        land,
        cv2.MORPH_CLOSE,
        odd_kernel(settings["landCloseKernel"]),
    )
    count, labels, stats, _ = cv2.connectedComponentsWithStats(land, 8)
    kept = [
        component
        for component in range(1, count)
        if stats[component, cv2.CC_STAT_AREA] >= settings["minimumLandComponentArea"]
    ]
    cleaned = np.isin(labels, kept).astype(np.uint8)
    ys, xs = np.nonzero(cleaned)
    if not xs.size:
        raise RuntimeError("Reference image contains no detectable land silhouette")
    return cleaned, {
        "componentCount": len(kept),
        "pixelCount": int(np.count_nonzero(cleaned)),
        "boundsPx": [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)],
        "componentAreas": sorted(
            [int(stats[component, cv2.CC_STAT_AREA]) for component in kept],
            reverse=True,
        ),
    }


def alignment_coefficients(config: dict[str, Any]) -> tuple[float, float, float, float]:
    local_left, local_top, local_right, local_bottom = config["alignment"]["localLandBoundsPx"]
    world_left, world_top, world_right, world_bottom = config["alignment"]["parentComponentBoundsWorld"]
    scale_x = (world_right - world_left) / (local_right - local_left)
    scale_y = (world_bottom - world_top) / (local_bottom - local_top)
    offset_x = world_left - local_left * scale_x
    offset_y = world_top - local_top * scale_y
    return scale_x, scale_y, offset_x, offset_y


def local_geometry_to_world(geometry: Polygon | MultiPolygon, config: dict[str, Any]):
    scale_x, scale_y, offset_x, offset_y = alignment_coefficients(config)
    return affinity.affine_transform(
        geometry,
        [scale_x, 0.0, 0.0, scale_y, offset_x, offset_y],
    )


def world_geometry_to_local(geometry: Polygon | MultiPolygon, config: dict[str, Any]):
    scale_x, scale_y, offset_x, offset_y = alignment_coefficients(config)
    return affinity.affine_transform(
        geometry,
        [1.0 / scale_x, 0.0, 0.0, 1.0 / scale_y, -offset_x / scale_x, -offset_y / scale_y],
    )


def rasterize_geometry(geometry, width: int, height: int) -> np.ndarray:
    output = np.zeros((height, width), dtype=np.uint8)
    if geometry.is_empty:
        return output
    polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
    for polygon in polygons:
        exterior = np.rint(np.asarray(polygon.exterior.coords)).astype(np.int32)
        cv2.fillPoly(output, [exterior], 1)
        for interior in polygon.interiors:
            hole = np.rint(np.asarray(interior.coords)).astype(np.int32)
            cv2.fillPoly(output, [hole], 0)
    return output


def alignment_metrics(reference: np.ndarray, candidate: np.ndarray, tolerance_px: int) -> dict[str, float]:
    intersection = int(np.count_nonzero(reference & candidate))
    union = int(np.count_nonzero(reference | candidate))
    reference_boundary = cv2.morphologyEx(reference, cv2.MORPH_GRADIENT, odd_kernel(3))
    candidate_boundary = cv2.morphologyEx(candidate, cv2.MORPH_GRADIENT, odd_kernel(3))
    tolerance_kernel = odd_kernel(tolerance_px)
    precision = float(
        np.count_nonzero(reference_boundary & cv2.dilate(candidate_boundary, tolerance_kernel))
        / max(1, np.count_nonzero(reference_boundary))
    )
    recall = float(
        np.count_nonzero(candidate_boundary & cv2.dilate(reference_boundary, tolerance_kernel))
        / max(1, np.count_nonzero(candidate_boundary))
    )
    f_score = 2 * precision * recall / max(1e-12, precision + recall)
    return {
        "intersectionOverUnion": intersection / max(1, union),
        "boundaryPrecision": precision,
        "boundaryRecall": recall,
        "boundaryFScore": f_score,
    }
