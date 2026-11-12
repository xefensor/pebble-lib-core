#!/usr/bin/env python3
"""Freeze exact checked candidates into new versioned files; keep historical dist.zip."""
from pathlib import Path,PurePosixPath
import hashlib,io,json,shutil,tarfile,zipfile
from repo_workflow import check_build

def package(root,sdk_input=None):
    metadata=json.loads((root/'package.json').read_text());stem=metadata['name'].replace('@','').replace('/','-')+'-'+metadata['version']
    releases=root/'releases';target=releases/(stem+'.tgz');sdk_target=releases/(stem+'-sdk.zip');checksums=releases/('SHA256SUMS-'+metadata['version']+'.txt')
    if any(p.exists() for p in (target,sdk_target,checksums)):raise ValueError('Frozen library version already exists; use a new version.')
    sdk_input=sdk_input or root/'build/candidate/dist.zip';check_build(root,sdk_input)
    candidate=sdk_input.parent/(stem+'.tgz')
    if not candidate.is_file():raise ValueError('Run npm run pack:candidate before freezing the reviewed archive.')
    sdk=sdk_input.read_bytes();packed=candidate.read_bytes()
    with zipfile.ZipFile(io.BytesIO(sdk)) as archive:
        if archive.testzip() is not None or len(archive.namelist())!=len(set(archive.namelist())):raise ValueError('Corrupt SDK package')
    with tarfile.open(fileobj=io.BytesIO(packed),mode='r:gz') as archive:
        members=archive.getmembers();names=[m.name for m in members]
        if len(names)!=len(set(names)):raise ValueError('Duplicate npm package member')
        files={}
        for member in members:
            path=PurePosixPath(member.name)
            if not member.isfile() or not member.name.startswith('package/') or '..' in path.parts or '\\' in member.name:raise ValueError('Unsafe npm package member')
            files[member.name[8:]]=archive.extractfile(member).read()
        if files.get('dist.zip')!=sdk or json.loads(files['package.json'])['version']!=metadata['version']:raise ValueError('Candidate tarball contains another SDK/version')
        for name,data in files.items():
            if name!='dist.zip' and (root/name).read_bytes()!=data:raise ValueError('Stale candidate package input: '+name)
    releases.mkdir(exist_ok=True)
    # Exclusive creation never overwrites a reviewed artifact, even on a race.
    for path,data in ((sdk_target,sdk),(target,packed)):
        with path.open('xb') as output:output.write(data)
    content=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in (sdk_target,target))
    with checksums.open('x') as output:output.write(content)
    print(target)
    return target
if __name__=='__main__':package(Path(__file__).resolve().parents[1])
