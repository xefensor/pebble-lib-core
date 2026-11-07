"""Local build paths and immutable-release boundaries; no sibling dependencies."""
from pathlib import Path
import argparse
import json
import os
import hashlib


def candidate(root, name):
    """Checks use a fresh development build unless an artifact is explicit."""
    override = os.environ.get('PEBBLE_PBW')
    if override:
        return Path(override).expanduser().resolve()
    version = json.loads((root / 'package.json').read_text())['version']
    return root / 'build/candidate' / (name + '-' + version + '.pbw')


def qa_output(root, suite):
    override = os.environ.get('PEBBLE_QA_OUTPUT_ROOT')
    base = Path(override).expanduser().resolve() if override else root / 'build/qa'
    return base / suite


def require_new_artifacts(paths):
    existing = [str(path) for path in paths if path.exists()]
    if existing:
        raise ValueError('Refusing to replace frozen artifacts: ' + ', '.join(existing)
                         + '. Use a new version; ordinary builds belong in build/candidate.')


def build_output(root, name):
    parser = argparse.ArgumentParser(description='Build a local candidate; freeze only with --release.')
    parser.add_argument('--release', action='store_true', help='Explicitly prepare a new version in dist/')
    args = parser.parse_args()
    if args.release:
        version = json.loads((root / 'package.json').read_text())['version']
        protected = [p for folder in ('dist', 'releases')
                     for p in (root / folder).glob(name + '-' + version + '*')]
        require_new_artifacts(protected)
        return root / 'dist'
    return root / 'build/candidate'


def build_inputs(root):
    names = {'package.json', 'package-lock.json', 'wscript', 'config.html', 'LICENSE', 'THIRD-PARTY-NOTICES.md'}
    names.update(p.name for p in root.glob('*.js'))
    for directory in ('src', 'include', 'resources', 'vendor', 'licenses'):
        names.update(str(p.relative_to(root)) for p in (root / directory).rglob('*') if p.is_file())
    for pattern in ('build.py', 'repo_workflow.py', 'package-release.py', 'bundle-*', 'minify-*', 'release_*', 'generate-config*'):
        names.update(str(p.relative_to(root)) for p in (root / 'scripts').glob(pattern) if p.is_file())
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            for name in sorted(names) if (root / name).is_file()}


def record_build(root, pbw, *additional):
    record = {'inputs': build_inputs(root), 'artifacts': {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in (pbw, *additional)}}
    (pbw.parent / 'candidate.json').write_text(json.dumps(record, indent=2) + '\n')


def check_build(root, pbw):
    if pbw.parent.resolve() != (root / 'build/candidate').resolve():
        return  # An explicitly supplied frozen artifact has its own source snapshot.
    record = json.loads((pbw.parent / 'candidate.json').read_text())
    if record['inputs'] != build_inputs(root):
        raise ValueError('Candidate is stale: build inputs changed. Run npm run build again.')
    for name, digest in record['artifacts'].items():
        if hashlib.sha256((pbw.parent / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Candidate artifact changed after building: ' + name)
