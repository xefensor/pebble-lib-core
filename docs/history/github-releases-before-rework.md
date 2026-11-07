# Historical GITHUB-RELEASES.md

Retained before the2026-11-07 rework. Use current UI/maintenance/development
documentation for work on main; older evidence retains its original scope.

# GitHub releases

[Core 0.5.1](https://github.com/xefensor/pebble-lib-core/releases/tag/v0.5.1)
is published. The repository's [Releases page](https://github.com/xefensor/pebble-lib-core/releases)
contains the versioned downloads; [README.md](../README.md) explains which
package a consumer needs and [AGENTS.md](../AGENTS.md) records maintainer rules.

Core is a library package, not an app to install on the watch. Publishing it
does not rebuild or repin Dynamic, Halftone or an installed PBW. Each consumer
continues to use its committed tarball until deliberately upgraded and released.

## Current frozen release

The `v0.5.1` tag points to the already-tested artifact commit
`a3e344651df22333f24bf52e7af9a10c2a1810cd`. Its assets are:

- `pebble-watchface-core-0.5.1.tgz` — the pinned consumer package.
- `dist.zip` — the compiled Pebble SDK library and exported headers/JavaScript.
- `SHA256SUMS.txt` — flat filenames for checking downloaded files together.

Download the two packages and the checksum attachment into one directory, then
run `sha256sum -c SHA256SUMS.txt`. The repository's
[`releases/SHA256SUMS.txt`](../releases/SHA256SUMS.txt) instead records repository
paths; the workflow validates those inputs and generates the flat attachment.

Adding release automation or editing documentation on `main` does not change
these published files, their tag or the packaged README. The release's tagged
source and package contents remain the historical snapshot. Future package
versions will contain the documentation present when they are built.

## Preparing the next version

1. Make the engine change and its regression tests. Update the package version,
   lockfile, current README download links and matching `## Version X.Y.Z`
   release-notes section.
   Preserve existing version sections as history.
2. Run the portable engine and release-automation suites:

   ```sh
   npm ci --ignore-scripts
   npm test
   python3 -m unittest discover -s tests -p test_github_release.py
   ```

3. Build and package with the intended Pebble SDK:

   ```sh
   pebble build
   python3 scripts/package-release.py
   ```

4. Review the versioned tarball, `dist.zip`, checksums and notes, then create a
   local commit containing them and the version change. Before pushing it, run:

   ```sh
   python3 scripts/github-release.py prepare --output /tmp/pebble-core-release-check
   ```

5. Push the checked commit to `main`. A consumer's relevant native/render checks
   are separate from Core's portable tests.

The `prepare` command validates committed inputs at `HEAD` and writes local
staging files. It does not check uncommitted package edits. A local staging
folder is not a release and does not upload anything.

## Automatic publication

The [GitHub release workflow](../.github/workflows/release.yml) runs on relevant
`main` pushes: package metadata, artifact/checksum directories, release
configuration, the workflow or its helper/tests. Ordinary README/docs-only
pushes do not create another release. It can also be run through
**Actions → GitHub release → Run workflow**, selecting `main`.

The read-only job installs dependencies, runs portable tests and validates the
selected committed artifacts. The publication job repeats artifact validation,
creates a draft, uploads and verifies the exact files, then publishes. It uses
GitHub's built-in token with content-write permission only in that job. No SDK
rebuild, personal access token or external scheduler is required in Actions.

[`.github/release.json`](../.github/release.json) controls the exact current
asset paths, tag prefix, prerelease flag and README notes heading. Templates
select only the package version being released, never all historical artifacts
with a broad glob. Its bootstrap identifies the original published 0.5.1 commit;
new versions use their own artifact commit.

The [XOCE repository migration](REPOSITORY-MIGRATION.md) changes the publication
destination to `xefensor/pebble-lib-core`. It retains the package name, source
commit and published asset bytes.

## Reruns and failures

A rerun verifies an identical existing release rather than uploading it again.
Published assets and tags are never overwritten by the workflow. Changed package
bytes require a new version. An incomplete matching draft can resume; a
conflicting existing tag, wrong release state, unexpected asset or changed hash
fails instead of being silently replaced.

The checks cover archive integrity, versions/checksums, selected package/source
identity, SDK exported headers/JavaScript, and immutable publication behavior.
They do not prove a new binary's physical behavior or substitute for building
and checking packages before committing them. Validation results should retain
their actual portable, emulator, consumer or device scope.
