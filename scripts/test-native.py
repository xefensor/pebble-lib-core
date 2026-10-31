#!/usr/bin/env python3
"""Compile and run portable native core tests without the Pebble SDK."""
from pathlib import Path
import os
import subprocess
import tempfile
root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='watchface-core-tests-') as tmp:
    tests = sorted((root / 'tests').glob('*.c'))
    if not tests:
        raise SystemExit('No native tests found')
    for source in tests:
        output = Path(tmp) / source.stem
        subprocess.run([os.environ.get('CC', 'cc'), '-std=c99', '-Wall', '-Wextra', '-Werror',
            '-I' + str(root / 'include'), str(source),
            *map(str, sorted((root / 'src/c').glob('*.c'))), '-o', str(output)], check=True)
        subprocess.run([str(output)], check=True, cwd=root)
        print(source.name + ': PASS')
