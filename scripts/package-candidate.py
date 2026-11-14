#!/usr/bin/env python3
"""Pack current library sources with the candidate SDK in an isolated directory."""

from pathlib import Path
import argparse
import re
import json
import shutil
import subprocess
import tempfile
import sys
from repo_workflow import check_build

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--version', help='Override only the staged npm manifest with a distinct local dev version')
args = parser.parse_args()
if args.version and not re.fullmatch(r'\d+\.\d+\.\d+-dev\.\d+', args.version):
    parser.error('Candidate overrides must use an explicit -dev.N version')
sdk = root / "build/candidate/dist.zip"
check_build(root, sdk)
package = json.loads((root / "package.json").read_text())
with tempfile.TemporaryDirectory(prefix="pebble-library-candidate-") as directory:
    staging = Path(directory)
    for name in ["package.json"] + package["files"]:
        source = sdk if name == "dist.zip" else root / name
        target = staging / name
        if source.is_dir():
            shutil.copytree(source, target)
        elif source.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    if args.version:
        staged = json.loads((staging / 'package.json').read_text())
        staged['version'] = args.version
        (staging / 'package.json').write_text(json.dumps(staged, indent=2) + '\n')
    packed = subprocess.run(
        ["npm", "pack", "--ignore-scripts", "--pack-destination", str(sdk.parent), "--json"],
        cwd=staging,
        capture_output=True,
        text=True,
    )
    if packed.returncode:
        print(packed.stderr or packed.stdout, file=sys.stderr)
        raise SystemExit(packed.returncode)
    result = json.loads(packed.stdout)[0]
    print(str(sdk.parent / result["filename"]) + " (" + str(result["size"]) + " bytes)")
