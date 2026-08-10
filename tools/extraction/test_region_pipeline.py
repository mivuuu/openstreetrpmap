from __future__ import annotations

from pathlib import Path
import json
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from region_pipeline import alignment_coefficients, alignment_metrics
from shapely.geometry import shape


ROOT = Path(__file__).resolve().parents[2]


class RegionPipelineTests(unittest.TestCase):
    def test_alignment_maps_local_bounds_to_world_bounds(self) -> None:
        config = {
            "alignment": {
                "localLandBoundsPx": [10, 20, 110, 220],
                "parentComponentBoundsWorld": [500, 300, 700, 800],
            }
        }
        scale_x, scale_y, offset_x, offset_y = alignment_coefficients(config)
        self.assertAlmostEqual(10 * scale_x + offset_x, 500)
        self.assertAlmostEqual(110 * scale_x + offset_x, 700)
        self.assertAlmostEqual(20 * scale_y + offset_y, 300)
        self.assertAlmostEqual(220 * scale_y + offset_y, 800)

    def test_identical_footprints_have_perfect_alignment(self) -> None:
        footprint = np.zeros((32, 32), dtype=np.uint8)
        footprint[4:28, 6:24] = 1
        report = alignment_metrics(footprint, footprint.copy(), 3)
        self.assertEqual(report["intersectionOverUnion"], 1)
        self.assertEqual(report["boundaryFScore"], 1)

    def test_region_013_and_034_metadata_and_geometry_are_distinct(self) -> None:
        data = json.loads((ROOT / "public/data/regions.geojson").read_text(encoding="utf-8"))
        by_id = {feature["properties"]["id"]: feature for feature in data["features"]}
        argezia = by_id["region-013"]
        hesperidia = by_id["region-034"]

        self.assertEqual(argezia["properties"]["name"], "Аргезия")
        self.assertEqual(hesperidia["properties"]["name"], "Гесперидия")
        self.assertEqual(argezia["geometry"]["type"], "Polygon")
        self.assertEqual(hesperidia["geometry"]["type"], "Polygon")

        argezia_geometry = shape(argezia["geometry"])
        hesperidia_geometry = shape(hesperidia["geometry"])
        self.assertTrue(argezia_geometry.disjoint(hesperidia_geometry))
        self.assertLess(hesperidia_geometry.centroid.x, argezia_geometry.centroid.x)

    def test_every_extracted_region_has_production_label_properties(self) -> None:
        data = json.loads((ROOT / "public/data/regions.geojson").read_text(encoding="utf-8"))
        required = {"id", "number", "name", "countryId", "type", "isCapital", "labelRank"}
        for feature in data["features"]:
            self.assertTrue(required.issubset(feature["properties"]))
            self.assertFalse(feature["properties"]["name"].startswith("Region "))

        capital = next(feature for feature in data["features"] if feature["properties"]["number"] == 10)
        self.assertEqual(capital["properties"]["name"], "Клерополь")
        self.assertTrue(capital["properties"]["isCapital"])


if __name__ == "__main__":
    unittest.main()
