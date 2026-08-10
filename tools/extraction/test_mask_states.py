from __future__ import annotations

import unittest
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_map import unclaimed_feature_collection
from fill_countries_mask import propagate_inside_land
from mask_states import classify_mask_states


SETTINGS = {
    "oceanRgb": [0, 0, 0],
    "unclaimedRgb": [128, 128, 128],
    "alphaMinimum": 1,
}


class MaskStateTests(unittest.TestCase):
    def test_three_state_classification(self) -> None:
        land = np.asarray([[False, True, True, True]])
        rgb = np.asarray([[[0, 0, 0], [255, 0, 0], [128, 128, 128], [0, 0, 0]]], dtype=np.uint8)
        alpha = np.full(land.shape, 255, dtype=np.uint8)
        states = classify_mask_states(land, rgb, alpha, SETTINGS)
        self.assertEqual(states.ocean.tolist(), [[True, False, False, False]])
        self.assertEqual(states.country.tolist(), [[False, True, False, False]])
        self.assertEqual(states.unclaimed.tolist(), [[False, False, True, False]])
        self.assertEqual(states.unknown_land.tolist(), [[False, False, False, True]])

    def test_unclaimed_column_blocks_propagation(self) -> None:
        walkable = np.ones((5, 7), dtype=bool)
        walkable[:, 3] = False
        seeds = np.zeros((5, 7), dtype=np.int32)
        seeds[2, 0] = 1
        seeds[2, 6] = 2
        propagated, distance = propagate_inside_land(walkable, seeds)
        self.assertTrue(np.all(distance[:, 3] == -1))
        self.assertTrue(np.all(propagated[:, :3] == 1))
        self.assertTrue(np.all(propagated[:, 4:] == 2))

    def test_unclaimed_is_emitted_as_its_own_dataset(self) -> None:
        labels = np.zeros((10, 12), dtype=np.int32)
        labels[2:8, 3:9] = 1
        collection = unclaimed_feature_collection(
            labels,
            {"simplificationTolerance": 0.0, "snapTolerancePx": 0.05},
            SETTINGS,
        )
        self.assertEqual(len(collection["features"]), 1)
        self.assertEqual(collection["features"][0]["properties"]["type"], "unclaimed")
        self.assertEqual(collection["features"][0]["properties"]["rgb"], [128, 128, 128])


if __name__ == "__main__":
    unittest.main()
