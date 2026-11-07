"""Portable guards for development/release separation; no SDK or network."""
from pathlib import Path
import importlib.util
import json
import os
import tempfile
import unittest
import runpy
import types
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('workflow', ROOT / 'scripts/repo_workflow.py')
workflow = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(workflow)


class DevelopmentWorkflow(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'package.json').write_text(json.dumps({'name': 'fixture', 'version': '1.2.3'}))

    def test_default_checks_cannot_silently_use_a_frozen_release(self):
        frozen = self.root / 'dist/App-1.2.3.pbw'
        frozen.parent.mkdir()
        frozen.write_bytes(b'frozen')
        with patch.dict(os.environ, {}, clear=True):
            path = workflow.candidate(self.root, 'App')
        self.assertEqual(path, self.root / 'build/candidate/App-1.2.3.pbw')
        self.assertFalse(path.exists())
        self.assertEqual(frozen.read_bytes(), b'frozen')

    def test_explicit_artifact_and_evidence_paths_are_supported(self):
        with patch.dict(os.environ, {'PEBBLE_PBW': str(self.root / 'review.pbw'),
                                     'PEBBLE_QA_OUTPUT_ROOT': str(self.root / 'evidence')}):
            self.assertEqual(workflow.candidate(self.root, 'App'), self.root / 'review.pbw')
            self.assertEqual(workflow.qa_output(self.root, 'native'), self.root / 'evidence/native')

    def test_ordinary_build_does_not_require_new_release_version(self):
        with patch('sys.argv', ['build.py']):
            self.assertEqual(workflow.build_output(self.root, 'App'), self.root / 'build/candidate')

    def test_release_refusal_leaves_existing_bytes_intact(self):
        frozen = self.root / 'releases/App-1.2.3-source.zip'
        frozen.parent.mkdir()
        frozen.write_bytes(b'frozen source')
        with patch('sys.argv', ['build.py', '--release']):
            with self.assertRaisesRegex(ValueError, 'Refusing to replace frozen'):
                workflow.build_output(self.root, 'App')
        self.assertEqual(frozen.read_bytes(), b'frozen source')

    def test_default_qa_never_overwrites_versioned_evidence(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(workflow.qa_output(self.root, 'native'), self.root / 'build/qa/native')

    def test_changed_source_and_tampered_bundles_cannot_pass_as_current(self):
        source = self.root / 'src/main.c'
        source.parent.mkdir()
        source.write_text('original')
        output = self.root / 'build/candidate'
        output.mkdir(parents=True)
        pbw, debug = output / 'App-1.2.3.pbw', output / 'App-1.2.3-debug.zip'
        pbw.write_bytes(b'candidate');debug.write_bytes(b'debug')
        workflow.record_build(self.root, pbw, debug)
        workflow.check_build(self.root, pbw)
        source.write_text('edited after build')
        with self.assertRaisesRegex(ValueError, 'stale'):
            workflow.check_build(self.root, pbw)
        source.write_text('original');pbw.write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'changed after building'):
            workflow.check_build(self.root, pbw)

    def test_publication_is_not_triggered_by_an_ordinary_push(self):
        path = ROOT / '.github/workflows/release.yml'
        if not path.exists():self.skipTest('No publication workflow')
        source = path.read_text()
        self.assertIn('workflow_dispatch:', source)
        self.assertNotIn('\n  push:', source)

    def test_library_distclean_preserves_the_frozen_sdk(self):
        package = json.loads((ROOT / 'package.json').read_text())
        if package.get('pebble', {}).get('projectType') != 'package':
            self.skipTest('Library-only SDK cleanup')
        frozen = self.root / 'dist.zip';frozen.write_bytes(b'frozen SDK')
        fake_waf = types.SimpleNamespace(Scripting=types.SimpleNamespace(distclean=lambda _: None))
        with patch.dict('sys.modules', {'waflib': fake_waf}):
            script = runpy.run_path(str(ROOT / 'wscript'))
        previous = Path.cwd()
        try:
            os.chdir(self.root)
            script['distclean'](None)
        finally:os.chdir(previous)
        self.assertEqual(frozen.read_bytes(), b'frozen SDK')

    def test_library_release_refuses_existing_version_before_reading_sdk(self):
        package = json.loads((ROOT / 'package.json').read_text())
        if package.get('pebble', {}).get('projectType') != 'package':
            self.skipTest('Library-only package guard')
        frozen = self.root / 'releases/fixture-1.2.3.tgz'
        frozen.parent.mkdir();frozen.write_bytes(b'frozen package')
        sdk = self.root / 'dist.zip';sdk.write_bytes(b'untouched SDK')
        spec = importlib.util.spec_from_file_location('library_packager', ROOT / 'scripts/package-release.py')
        packager = importlib.util.module_from_spec(spec);spec.loader.exec_module(packager)
        with self.assertRaisesRegex(ValueError, 'Frozen library version'):
            packager.package(self.root)
        self.assertEqual(frozen.read_bytes(), b'frozen package')
        self.assertEqual(sdk.read_bytes(), b'untouched SDK')


if __name__ == '__main__':
    unittest.main()
