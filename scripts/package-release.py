#!/usr/bin/env python3
"""Freeze the SDK package and create its versioned GitHub release tarball."""
from pathlib import Path
import hashlib, io, json, subprocess, tempfile, zipfile
root = Path(__file__).resolve().parents[1]
pkg = json.loads((root / 'package.json').read_text())
sdk = root / 'dist.zip'
with zipfile.ZipFile(sdk) as archive:
    assert archive.testzip() is None
    files = {name: archive.read(name) for name in archive.namelist()}
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in sorted(files.items()):
        info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, data, compresslevel=9)
sdk.write_bytes(buffer.getvalue())
with tempfile.TemporaryDirectory(prefix='watchface-core-pack-') as tmp:
    result = subprocess.run(['npm', 'pack', '--pack-destination', tmp, '--json'],
        cwd=root, check=True, capture_output=True, text=True)
    metadata = json.loads(result.stdout)[0]
    artifact = Path(tmp) / metadata['filename']
    releases = root / 'releases'
    releases.mkdir(exist_ok=True)
    target = releases / artifact.name
    target.write_bytes(artifact.read_bytes())
checksums = []
for path in (sdk, target):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    checksums.append(digest + '  ' + str(path.relative_to(root)))
    print(str(path.relative_to(root)), path.stat().st_size, digest)
(releases / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
