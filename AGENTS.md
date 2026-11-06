# Pebble Watchface Core maintainer notes

Core is a versioned library embedded in consuming watchfaces, not a watch app
or background service. Read [README.md](README.md) and the
[host contract](docs/HOST-CONTRACT.md) before changing its interfaces.

## Boundaries and invariants

- `src/js/` owns subscriptions, normalization, bounded caches, transient context
  and the shared transport queue. `src/c/` and `include/` own packet/state/cache
  decisions. Hosts own Pebble services, AppMessage handlers, timers, persistence
  keys, rendering, settings, permissions, vibration and Quiet Time policy.
- Keep the bounded two-reading/five-record contract. V4 packets have strict
  v1/v2/v3 compatibility; changes to bytes, bounds or semantics require deliberate
  JS/C fixture and consumer migration work. Preserve public API compatibility
  unless a versioned change is intentional.
- Receipt time is not observation time. Cache restoration never renews a lease;
  unavailable or expired values must not retain stale payloads.
- Music and notification content is transient. Keep it out of caches, logs and
  diagnostics, including when selected as ordinary readings. Source redaction,
  invalidation and filtering clear active and coalesced pending private text.
- Baselines prevent notification-history replay. Session markers and ephemeral
  event metadata travel with their snapshot; retries, icon refreshes and
  rebaselines must not invent a fresh alert. The host still owns alert behavior.
- Core does not choose fonts, coordinates or colors, supply a weather provider,
  or automatically correlate alerts with PebbleOS notifications.

## Validation and packaging

From the repository root:

```sh
npm ci --ignore-scripts
npm test
python3 -m unittest discover -s tests -p test_github_release.py
```

`npm test` runs JS and strict portable C suites without the SDK. Use relevant
cross-language fixtures for wire changes and targeted regressions for state,
privacy and source-lifecycle changes. Reuse unchanged evidence; distinguish
portable/fixture results from a consumer's native or physical-device checks.

For a new package version, update `package.json`, its lockfile and the matching
README download links and release-notes heading before building:

```sh
pebble build
python3 scripts/package-release.py
```

After reviewing and committing the new version and artifacts locally, validate
that commit before pushing it:

```sh
python3 scripts/github-release.py prepare --output /tmp/pebble-core-release-check
```

`prepare` reads committed inputs at `HEAD`, not uncommitted package edits.
The package script normalizes `dist.zip`, creates the versioned tarball under
`releases/` and records checksums. Keep SDK exports, source headers/JavaScript,
the archive version and checksums consistent. Preserve required attribution.

## GitHub releases and consumers

The [release guide](docs/GITHUB-RELEASES.md) describes the main-branch workflow.
`prepare` validates and writes local staging files; `publish` writes GitHub tags,
releases and assets and is used by the scoped publication job. Keep credentials
out of repository files and output.

Published artifacts and tags stay frozen. A docs-only update on `main` does not
repackage an existing version. For an unpublished version being prepared,
regenerate packages after changes that affect their contents. The bootstrap
configuration identifies the original tested 0.5.1 artifact commit; future
versions use their own artifact commit.

Consumers pin Core independently. Publishing here must not silently change
Dynamic or Halftone. A consumer upgrade updates the tarball, file dependency,
lockfile and `vendor/CORE.json` together, then gets its own build, visual checks
and release. Current pins are recorded by each consumer, not inferred from
Core's latest GitHub release.

## Repository identity

The XOCE repository is `xefensor/pebble-lib-core`; its public package name remains
`pebble-watchface-core`. Keep import/include paths and archive filenames compatible.
Repository metadata and documentation edits do not repackage published bytes.
The 0.5.1 bootstrap retains source `a3e344651df22333f24bf52e7af9a10c2a1810cd`;
see [repository migration notes](docs/REPOSITORY-MIGRATION.md).
