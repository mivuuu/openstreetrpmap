#!/usr/bin/env python3
"""Rebuild political vectors with safe land-constrained gap reconciliation."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
FILLED_MASK = ROOT / "countries-mask-filled.png"
FILL_REPORT = ROOT / "public" / "data" / "countries-mask-fill-report.json"


def run_tool(script: str, *arguments: str) -> None:
    command = [sys.executable, str(TOOLS / script), *arguments]
    print(f"\n> {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> None:
    run_tool("apply_country006_izmatia_transfer.py")
    run_tool("fill_countries_mask.py", "--mode", "safe")
    run_tool("extract_map.py", "--countries-mask", str(FILLED_MASK))
    run_tool("generate_country_labels.py")
    run_tool("generate_country_debug_labels.py")

    report = json.loads(FILL_REPORT.read_text(encoding="utf-8"))
    pixels = report["pixels"]
    print(
        "\nPolitical map rebuilt: "
        f"filled {pixels['filledAutomatically']} accidental land-gap pixels; "
        f"left {pixels['unresolvedAfterFill']} pixels for explicit review."
    )


if __name__ == "__main__":
    main()
