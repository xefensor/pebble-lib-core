# GitHub releases

Versioned packages are published on [Pebble Watchface Core's Releases page](https://github.com/xefensor/pebble-watchface-core/releases). GitHub Actions publishes the exact committed, validated packages and checksums; it does not rebuild them in a different SDK environment.

The initial version is **v0.4.1**, tagged at the already-tested artifact commit `6a6fb32e5a52d146e60d32fd6ee1b92e67722ada`. Adding release automation does not change the frozen package/source archive or its checksums. The new automation files live on `main` and will be included in future source snapshots.

## Publishing the next version

1. Bump the package version and update release notes. Prepare and validate the versioned artifacts using the repository's existing packaging steps.
2. Refresh the checksum file, then commit the version, artifacts and notes to `main`. The **GitHub release** workflow checks the packages and portable tests before publishing.
3. Keep `.github/release.json` aligned with the exact filenames. Its bootstrap applies only to the initial version above; later versions use their own artifact commit.

Each release includes selected current assets and a flat `SHA256SUMS.txt` for downloaded files. Historical files are not uploaded by a broad glob. Published assets and existing tags are never overwritten. A rerun verifies an identical existing release; conflicting bytes, stale packages or a different existing tag target cause failure and require a new version.

The workflow can also be rerun from **Actions → GitHub release → Run workflow**. It uses GitHub's built-in token with repository-content write access only in the publication job. No personal access token or external scheduler is required.

Core is a library package, not an app to install on the watch. Consumers keep their existing pinned archive until deliberately updated; publishing Core does not rebuild or repin Dynamic or Halftone.
