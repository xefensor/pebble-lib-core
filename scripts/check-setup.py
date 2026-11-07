#!/usr/bin/env python3
"""Check the development runtimes selected by this checkout; never install tools."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", action="store_true", help="Also require Pebble SDK 4.33.1")
    args = parser.parse_args()
    package = json.loads((ROOT / "package.json").read_text())
    errors = []
    expected_python = (ROOT / ".python-version").read_text().strip()
    actual_python = ".".join(map(str, sys.version_info[:3]))
    if actual_python != expected_python:
        errors.append(f"Python {actual_python}: select {expected_python} from .python-version")
    expected_node = (ROOT / ".node-version").read_text().strip()
    try:
        actual_node = (
            subprocess.check_output(["node", "--version"], text=True).strip().removeprefix("v")
        )
        if actual_node != expected_node:
            errors.append(f"Node {actual_node}: select {expected_node} from .node-version")
    except (OSError, subprocess.CalledProcessError):
        errors.append(f"Node is unavailable: select {expected_node} from .node-version")
    if "pebble" in package and not shutil.which(os.environ.get("CC", "cc")):
        errors.append("A C99 compiler is required; install cc or set CC")
    if args.sdk:
        try:
            installed = subprocess.check_output(
                ["pebble", "sdk", "list"], text=True, stderr=subprocess.STDOUT
            )
            if "4.33.1" not in installed:
                errors.append("Install and select Pebble SDK 4.33.1")
        except (OSError, subprocess.CalledProcessError):
            errors.append("Pebble CLI is unavailable; follow CONTRIBUTING.md for SDK setup")
    if errors:
        print("Setup needs attention:\n- " + "\n- ".join(errors), file=sys.stderr)
        return 1
    print(
        f"Setup PASS: Node {expected_node}, Python {expected_python}"
        + (", Pebble SDK 4.33.1 installed" if args.sdk else "")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
