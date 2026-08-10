"""Canonical state classification for political mask pixels."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


OCEAN_COLOR: tuple[int, int, int] = (0, 0, 0)
UNCLAIMED_COLOR: tuple[int, int, int] = (128, 128, 128)


@dataclass(frozen=True)
class MaskStates:
    ocean: np.ndarray
    country: np.ndarray
    unclaimed: np.ndarray
    unknown_land: np.ndarray
    country_outside_land: np.ndarray
    unclaimed_outside_land: np.ndarray


def configured_colors(settings: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    ocean = np.asarray(settings.get("oceanRgb", OCEAN_COLOR), dtype=np.uint8)
    unclaimed = np.asarray(settings.get("unclaimedRgb", UNCLAIMED_COLOR), dtype=np.uint8)
    if np.array_equal(ocean, unclaimed):
        raise ValueError("OCEAN_COLOR and UNCLAIMED_COLOR must be different")
    return ocean, unclaimed


def is_ocean(
    rgb: np.ndarray,
    alpha: np.ndarray,
    settings: dict[str, Any],
) -> np.ndarray:
    ocean_color, _ = configured_colors(settings)
    alpha_minimum = int(settings.get("alphaMinimum", 1))
    return (alpha < alpha_minimum) | np.all(rgb == ocean_color, axis=2)


def is_unclaimed(
    rgb: np.ndarray,
    alpha: np.ndarray,
    settings: dict[str, Any],
) -> np.ndarray:
    _, unclaimed_color = configured_colors(settings)
    alpha_minimum = int(settings.get("alphaMinimum", 1))
    return (alpha >= alpha_minimum) & np.all(rgb == unclaimed_color, axis=2)


def is_country(
    rgb: np.ndarray,
    alpha: np.ndarray,
    settings: dict[str, Any],
) -> np.ndarray:
    return ~(is_ocean(rgb, alpha, settings) | is_unclaimed(rgb, alpha, settings))


def is_unknown_land(
    land: np.ndarray,
    rgb: np.ndarray,
    alpha: np.ndarray,
    settings: dict[str, Any],
) -> np.ndarray:
    return land & is_ocean(rgb, alpha, settings)


def classify_mask_states(
    land: np.ndarray,
    rgb: np.ndarray,
    alpha: np.ndarray,
    settings: dict[str, Any],
) -> MaskStates:
    raw_ocean = is_ocean(rgb, alpha, settings)
    raw_unclaimed = is_unclaimed(rgb, alpha, settings)
    raw_country = ~(raw_ocean | raw_unclaimed)
    return MaskStates(
        ocean=~land,
        country=land & raw_country,
        unclaimed=land & raw_unclaimed,
        unknown_land=land & raw_ocean,
        country_outside_land=(~land) & raw_country,
        unclaimed_outside_land=(~land) & raw_unclaimed,
    )
