#!/usr/bin/env python3
"""Explicitly freeze a new library version; never replace an existing tarball."""
from pathlib import Path
import hashlib,io,json,subprocess,tempfile,zipfile


def package(root,sdk_input=None):
    metadata=json.loads((root/'package.json').read_text())
    filename=metadata['name'].replace('@','').replace('/','-')+'-'+metadata['version']+'.tgz'
    releases=root/'releases';target=releases/filename
    if target.exists():raise ValueError('Frozen library version already exists; use a new version.')
    sdk_input=sdk_input or root/'dist.zip'
    with zipfile.ZipFile(sdk_input) as archive:
        if archive.testzip() is not None:raise ValueError('Corrupt SDK package')
        files={name:archive.read(name) for name in archive.namelist()}
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,data in sorted(files.items()):
            info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3
            info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,data,compresslevel=9)
    sdk=root/'dist.zip';sdk.write_bytes(buffer.getvalue());releases.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pebble-library-release-') as directory:
        result=subprocess.run(['npm','pack','--ignore-scripts','--pack-destination',directory,'--json'],cwd=root,check=True,capture_output=True,text=True)
        packed=Path(directory)/json.loads(result.stdout)[0]['filename']
        target.write_bytes(packed.read_bytes())
    (releases/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(root))+'\n' for p in (sdk,target)))
    print(target)


if __name__=='__main__':
    from repo_workflow import check_build
    root=Path(__file__).resolve().parents[1]
    sdk=root/'build/candidate/dist.zip'
    # The version guard also runs before checking SDK availability.
    metadata=json.loads((root/'package.json').read_text())
    target=root/'releases'/(metadata['name'].replace('@','').replace('/','-')+'-'+metadata['version']+'.tgz')
    if target.exists():raise ValueError('Frozen library version already exists; use a new version.')
    check_build(root,sdk)
    package(root,sdk)
