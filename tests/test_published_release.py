"""Audit the real frozen milestone with the repository’s own validator."""

from pathlib import Path
import importlib.util
import json
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "published_release", ROOT / "scripts/github-release.py"
)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class PublishedRelease(unittest.TestCase):
    def test_current_frozen_milestone_uses_its_immutable_source_tag(self):
        package = json.loads((ROOT / "package.json").read_text())
        tag = "v" + release.release_id(package)
        result = subprocess.run(
            ["git", "rev-parse", "--verify", "refs/tags/" + tag + "^{commit}"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            self.skipTest(
                "No frozen milestone for this development version; fetch tags to audit a release"
            )
        with tempfile.TemporaryDirectory(prefix="published-release-test-") as folder:
            manifest = release.prepare(ROOT, ROOT / ".github/release.json", Path(folder))
            self.assertEqual(manifest["source_commit"], result.stdout.strip())
            self.assertTrue(manifest["assets"])
