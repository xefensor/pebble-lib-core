# Pebble Watchface Core: release boundary

Routine builds/checks are documented in [CONTRIBUTING](../../CONTRIBUTING.md).
They do not publish or rewrite old artifacts. A commit on main does not itself
make an unpublished implementation a public download.

## Explicit milestone only

1. Agree the release scope and choose a new version for changed artifact bytes.
2. Update source/package metadata and release notes; run portable checks and a
   fresh candidate build plus the relevant native/phone checks.
3. Freeze the reviewed version explicitly, then create its final source snapshot:

```sh
npm run build
npm run release:package
```

4. Commit the frozen artifacts and metadata. Check their checksums, source/pinned
   dependency identity and actual packaged runtime against that source commit.
   Source archives are generated last, not after every normal change.
5. Push/tag/upload/publish only when explicitly requested. Existing versions and
   tags are immutable; a new docs/tooling commit does not regenerate their bytes.

The build/packaging tools refuse an existing version before replacing frozen
outputs. Development candidates have no publication side effects.

## Historical verification

Use the original source commit/tag and original versioned evidence. Current docs
may describe newer implementation; they are not a replacement source snapshot.
Do not run a source-archive freshness check against a later documentation commit
and "repair" the old release. Preserve licences, source maps in separate debug
archives, privacy and documented physical-device gaps.
