"""Release provenance and immutability tests; no network or SDK is used."""

import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SPEC = importlib.util.spec_from_file_location(
    "github_release", Path(__file__).resolve().parents[1] / "scripts/github-release.py"
)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


def zip_bytes(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return output.getvalue()


def tar_bytes(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, content in files.items():
            entry = tarfile.TarInfo("package/" + name)
            entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content))
    return output.getvalue()


class FakeGitHub:
    def __init__(self):
        self.item = None
        self.tag = None
        self.files = {}
        self.writes = []
        self.fail_upload = None

    def release(self, tag):
        return self.item

    def tag_commit(self, tag):
        return self.tag

    def create_tag(self, tag, commit):
        self.writes.append(("tag", tag))
        self.tag = commit

    def create_release(self, manifest, notes):
        self.writes.append(("draft", manifest["tag"]))
        self.item = {
            "id": 1,
            "tag_name": manifest["tag"],
            "draft": True,
            "prerelease": manifest["prerelease"],
        }
        return self.item

    def assets(self, item):
        return [
            {
                "id": index,
                "name": name,
                "size": len(content),
                "digest": "sha256:" + release.digest(content),
            }
            for index, (name, content) in enumerate(self.files.items())
        ]

    def verify_asset(self, item, asset, expected):
        release.GitHub.verify_asset(self, item, asset, expected)

    def upload(self, tag, path):
        if path.name == self.fail_upload:
            raise ValueError("simulated interrupted upload")
        self.writes.append(("upload", path.name))
        self.files[path.name] = path.read_bytes()

    def publish(self, item, prerelease):
        self.writes.append(("publish", item["tag_name"]))
        self.item["draft"] = False
        self.item["prerelease"] = prerelease


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"GITHUB_REPOSITORY": ""})
        environment.start()
        self.addCleanup(environment.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / "repo"
        self.root.mkdir()
        self.out = self.base / "output"
        self.config_path = self.base / "release.json"
        self.run_git("init", "-b", "main")
        self.run_git("config", "user.name", "Release Test")
        self.run_git("config", "user.email", "release-test@example.invalid")
        self.package = {"name": "fixture-library", "version": "1.2.3"}
        files = {
            "package.json": json.dumps(self.package).encode(),
            "LICENSE": b"fixture license",
            "src/js/index.js": b"module.exports = {};\n",
            "src/c/core.c": b"int fixture(void){return 1;}\n",
            "include/core.h": b"int fixture(void);\n",
        }
        sdk = zip_bytes(
            {
                "js/index.js": files["src/js/index.js"],
                "include/fixture-library/core.h": files["include/core.h"],
            }
        )
        files["dist.zip"] = sdk
        files["releases/fixture-1.2.3.tgz"] = tar_bytes(files)
        files["releases/SHA256SUMS.txt"] = (
            release.digest(sdk)
            + "  dist.zip\n"
            + release.digest(files["releases/fixture-1.2.3.tgz"])
            + "  releases/fixture-1.2.3.tgz\n"
        ).encode()
        files["README.md"] = (
            b"# Fixture\n\n## Version 1.2.3\n\nCorrect release notes.\n\n## Older\nNo.\n"
        )
        for name, content in files.items():
            self.write(name, content)
        self.original = self.commit()
        self.config = {
            "repository": "owner/fixture",
            "kind": "core",
            "display_name": "Fixture",
            "tag_prefix": "v",
            "prerelease": False,
            "assets": ["dist.zip", "releases/fixture-{version}.tgz"],
            "checksums_file": "releases/SHA256SUMS.txt",
            "notes": {"path": "README.md", "heading": "## Version {version}"},
            "bootstrap": {"version": "1.2.3", "source_commit": self.original},
        }
        self.config_path.write_text(json.dumps(self.config))

    def tearDown(self):
        self.temp.cleanup()

    def run_git(self, *args):
        return (
            subprocess.check_output(["git", "-C", str(self.root), *args], stderr=subprocess.DEVNULL)
            .decode()
            .strip()
        )

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def commit(self):
        self.run_git("add", "--all")
        self.run_git("commit", "-m", "Fixture")
        return self.run_git("rev-parse", "HEAD")

    def prepared(self):
        return release.prepare(self.root, self.config_path, self.out)

    def test_tagged_release_survives_later_package_scripts_and_docs(self):
        self.run_git("tag", "v1.2.3", self.original)
        self.config.pop("bootstrap", None)
        self.config_path.write_text(json.dumps(self.config))
        metadata = dict(self.package, scripts={"test": "new maintenance check"})
        self.write("package.json", json.dumps(metadata).encode())
        self.write("README.md", b"Current contributor documentation\n")
        self.commit()
        manifest = self.prepared()
        self.assertEqual(manifest["source_commit"], self.original)
        release.validate_prepared(self.root, self.config_path, self.out)

    def test_tag_on_unrelated_history_is_rejected(self):
        self.run_git("branch", "original", self.original)
        self.run_git("checkout", "--orphan", "other")
        self.write("README.md", b"Unrelated source\n")
        unrelated = self.commit()
        self.run_git("tag", "v1.2.3", unrelated)
        self.run_git("checkout", "original")
        with self.assertRaisesRegex(ValueError, "not an ancestor"):
            self.prepared()
        self.assertFalse(self.out.exists())

    def test_manifest_tampering_is_rejected_before_publication(self):
        self.prepared()
        path = self.out / "release-manifest.json"
        metadata = json.loads(path.read_text())
        metadata["repository"] = "owner/another"
        path.write_text(json.dumps(metadata))
        with self.assertRaisesRegex(ValueError, "manifest differs"):
            release.validate_prepared(self.root, self.config_path, self.out)

    def test_prepared_notes_and_extra_assets_are_rejected(self):
        self.prepared()
        (self.out / "release-notes.md").write_text("altered notes")
        with self.assertRaisesRegex(ValueError, "Prepared asset changed"):
            release.validate_prepared(self.root, self.config_path, self.out)
        self.prepared()
        (self.out / "unexpected.pbw").write_bytes(b"stale output")
        with self.assertRaisesRegex(ValueError, "inventory differs"):
            release.validate_prepared(self.root, self.config_path, self.out)
        with self.assertRaisesRegex(ValueError, "Unexpected file"):
            self.prepared()

    def test_publication_context_requires_manual_main_workflow(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "manually dispatched"):
                release.require_manual_workflow()
        environment = {
            "GITHUB_ACTIONS": "true",
            "GITHUB_REPOSITORY": "owner/fixture",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_WORKFLOW_REF": "owner/fixture/.github/workflows/release.yml@refs/heads/main",
        }
        with patch.dict(os.environ, environment, clear=True):
            release.require_manual_workflow()
            for key, value in [
                ("GITHUB_EVENT_NAME", "push"),
                ("GITHUB_REF", "refs/heads/topic"),
                (
                    "GITHUB_WORKFLOW_REF",
                    "owner/fixture/.github/workflows/check.yml@refs/heads/main",
                ),
            ]:
                with patch.dict(os.environ, {key: value}):
                    with self.assertRaisesRegex(ValueError, "manually dispatched"):
                        release.require_manual_workflow()

    def test_published_tag_cannot_move_even_with_identical_asset_bytes(self):
        self.prepared()
        github = FakeGitHub()
        release.publish(self.root, self.out, github)
        self.write("README.md", b"Later documentation\n")
        github.tag = self.commit()
        before = github.writes[:]
        with self.assertRaisesRegex(ValueError, "tags are never moved"):
            release.publish(self.root, self.out, github)
        self.assertEqual(github.writes, before)

    def test_all_local_dependencies_require_matching_lock_and_provenance(self):
        import base64

        raw = tar_bytes(
            {
                "package.json": json.dumps(
                    {"name": "fixture-dependency", "version": "0.1.0"}
                ).encode()
            }
        )
        self.write("vendor/dependency.tgz", raw)
        request = "file:vendor/dependency.tgz"
        integrity = (
            "sha512-" + base64.b64encode(__import__("hashlib").sha512(raw).digest()).decode()
        )
        metadata = dict(self.package, dependencies={"fixture-dependency": request})
        lock = {
            "packages": {
                "node_modules/fixture-dependency": {
                    "resolved": request,
                    "integrity": integrity,
                    "version": "0.1.0",
                }
            }
        }
        pin = {
            "package": "fixture-dependency",
            "archive": "dependency.tgz",
            "version": "0.1.0",
            "sha256": release.digest(raw),
            "integrity": integrity,
        }
        self.write("vendor/DEPENDENCY.json", json.dumps(pin).encode())
        self.write("package-lock.json", json.dumps(lock).encode())
        commit = self.commit()
        release.validate_dependencies(self.root, commit, metadata)
        lock["packages"]["node_modules/fixture-dependency"]["integrity"] = "sha512-tampered"
        self.write("package-lock.json", json.dumps(lock).encode())
        with self.assertRaisesRegex(ValueError, "Dependency lock differs"):
            release.validate_dependencies(self.root, self.commit(), metadata)
        lock["packages"]["node_modules/fixture-dependency"]["integrity"] = integrity
        self.write("package-lock.json", json.dumps(lock).encode())
        pin["sha256"] = "0" * 64
        self.write("vendor/DEPENDENCY.json", json.dumps(pin).encode())
        with self.assertRaisesRegex(ValueError, "Dependency provenance differs"):
            release.validate_dependencies(self.root, self.commit(), metadata)

    def test_bootstrap_uses_tested_commit_and_flat_download_checksums(self):
        self.write("README.md", b"Unreleased documentation update\n")
        self.write(".github/workflows/release.yml", b"new automation\n")
        self.commit()
        manifest = self.prepared()
        self.assertEqual(manifest["source_commit"], self.original)
        self.assertIn("Correct release notes.", (self.out / "release-notes.md").read_text())
        self.assertNotIn("Older", (self.out / "release-notes.md").read_text())
        self.assertNotIn("releases/", (self.out / "SHA256SUMS.txt").read_text())

    def test_reusing_version_cannot_hide_changed_selected_asset(self):
        self.write("dist.zip", b"changed artifact without a version bump")
        self.commit()
        with self.assertRaisesRegex(ValueError, "existing version's asset changed"):
            self.prepared()
        self.assertFalse(self.out.exists())

    def test_package_rejects_stale_source(self):
        self.config.pop("bootstrap")
        self.config_path.write_text(json.dumps(self.config))
        self.write("src/js/index.js", b"new source missing from frozen tar\n")
        self.commit()
        with self.assertRaisesRegex(ValueError, "Stale package input"):
            self.prepared()

    def test_package_rejects_stale_exported_header(self):
        with tarfile.open(self.root / "releases/fixture-1.2.3.tgz") as archive:
            files = {
                member.name[8:]: archive.extractfile(member).read()
                for member in archive.getmembers()
            }
        files["dist.zip"] = zip_bytes(
            {
                "js/index.js": files["src/js/index.js"],
                "include/fixture-library/core.h": b"stale exported header",
            }
        )
        assets = {"dist.zip": files["dist.zip"], "releases/fixture-1.2.3.tgz": tar_bytes(files)}
        with self.assertRaisesRegex(ValueError, "SDK exported header differs"):
            release.validate_artifacts(self.root, self.config, self.original, self.package, assets)

    def test_rc_and_beta_ids_are_distinct_and_validated(self):
        self.assertEqual(
            release.release_id({"version": "1.9.0", "halftoneReleaseCandidate": 6}), "1.9.0-rc.6"
        )
        self.assertEqual(
            release.release_id({"version": "1.9.0", "halftoneBeta": 2}), "1.9.0-beta.2"
        )
        for package in [
            {"version": "1.2.3", "releaseCandidate": True},
            {"version": "1.2.3", "halftoneBeta": 0},
            {"version": "1.2.3;echo bad"},
            {"version": "256.0.0"},
        ]:
            with self.assertRaises(ValueError):
                release.release_id(package)

    def test_release_candidate_cannot_be_promoted_by_stable_config(self):
        self.write("package.json", json.dumps({**self.package, "releaseCandidate": 1}).encode())
        self.commit()
        with self.assertRaisesRegex(ValueError, "must be marked prerelease"):
            self.prepared()

    def test_new_release_is_draft_until_all_verified_uploads_complete(self):
        self.prepared()
        github = FakeGitHub()
        self.assertEqual(release.publish(self.root, self.out, github), "published")
        self.assertEqual(
            [kind for kind, _ in github.writes],
            ["tag", "draft", "upload", "upload", "upload", "publish"],
        )
        before = github.writes[:]
        self.assertEqual(release.publish(self.root, self.out, github), "unchanged")
        self.assertEqual(github.writes, before)

    def test_published_missing_or_different_assets_are_not_repaired_or_clobbered(self):
        self.prepared()
        for mutation in (
            lambda g: g.files.pop("dist.zip"),
            lambda g: g.files.update({"dist.zip": b"wrong"}),
        ):
            github = FakeGitHub()
            release.publish(self.root, self.out, github)
            mutation(github)
            before = github.writes[:]
            with self.assertRaises(ValueError):
                release.publish(self.root, self.out, github)
            self.assertEqual(github.writes, before)

    def test_partial_draft_upload_resumes_without_replacing_existing_asset(self):
        self.prepared()
        github = FakeGitHub()
        github.fail_upload = "fixture-1.2.3.tgz"
        with self.assertRaisesRegex(ValueError, "interrupted upload"):
            release.publish(self.root, self.out, github)
        self.assertTrue(github.item["draft"])
        self.assertEqual(set(github.files), {"dist.zip"})
        github.fail_upload = None
        self.assertEqual(release.publish(self.root, self.out, github), "published")
        self.assertEqual(github.writes.count(("upload", "dist.zip")), 1)

    def test_resumed_draft_gets_configured_prerelease_policy(self):
        manifest = self.prepared()
        github = FakeGitHub()
        github.tag = self.original
        github.create_release(manifest, "existing draft")
        github.item["prerelease"] = True
        self.assertEqual(release.publish(self.root, self.out, github), "published")
        self.assertFalse(github.item["prerelease"])
        api = release.GitHub("owner/fixture")
        with patch.object(api, "api") as call:
            api.publish({"id": 1}, True)
        self.assertEqual(call.call_args.args[2]["prerelease"], True)

    def test_published_prerelease_policy_mismatch_does_not_edit_release(self):
        self.prepared()
        github = FakeGitHub()
        release.publish(self.root, self.out, github)
        github.item["prerelease"] = True
        before = github.writes[:]
        with self.assertRaisesRegex(ValueError, "prerelease flag differs"):
            release.publish(self.root, self.out, github)
        self.assertEqual(github.writes, before)

    def test_workflow_cannot_publish_to_another_repository(self):
        self.prepared()
        github = FakeGitHub()
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "owner/another"}):
            with self.assertRaisesRegex(ValueError, "repository differs"):
                release.publish(self.root, self.out, github)
        self.assertEqual(github.writes, [])

    def test_mismatched_orphan_tag_is_never_moved(self):
        self.prepared()
        github = FakeGitHub()
        github.tag = "f" * 40
        with self.assertRaisesRegex(ValueError, "never moved"):
            release.publish(self.root, self.out, github)
        self.assertEqual(github.writes, [])

    def test_changed_prepared_bytes_fail_before_any_github_write(self):
        self.prepared()
        (self.out / "dist.zip").write_bytes(b"tampered")
        github = FakeGitHub()
        with self.assertRaisesRegex(ValueError, "Prepared asset changed"):
            release.publish(self.root, self.out, github)
        self.assertEqual(github.writes, [])

    def test_only_http404_is_treated_as_missing(self):
        github = release.GitHub("owner/fixture")
        with patch.object(
            release.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 1, b"", b"gh: Not Found (HTTP 404)"),
        ):
            self.assertIsNone(github.release("v1.2.3"))
        with patch.object(
            release.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 1, b"", b"gh: Forbidden (HTTP 403)"),
        ):
            with self.assertRaisesRegex(ValueError, "request failed"):
                github.release("v1.2.3")


if __name__ == "__main__":
    unittest.main()
