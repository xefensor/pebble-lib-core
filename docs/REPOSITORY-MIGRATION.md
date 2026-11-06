# XOCE repository migration

The repository naming convention is `pebble-<type>-<name>`, under the XOCE
(Xef's Open Computing Ecosystem) umbrella.

| Identity | Value |
| --- | --- |
| Former repository | `xefensor/pebble-watchface-core` |
| Repository destination | [`xefensor/pebble-lib-core`](https://github.com/xefensor/pebble-lib-core) |
| Public package and import name | `pebble-watchface-core` |
| Current published version | `0.5.1` |
| Frozen artifact source | `a3e344651df22333f24bf52e7af9a10c2a1810cd` |

This is a repository and documentation migration. Public JavaScript exports,
C includes, wire formats and runtime behaviour are unchanged. Consumer `file:`
dependencies, version pins and archive checksums stay the same. Maintained
consumer provenance can point its repository field at the new destination while
retaining the original source commit and archive identity.

Published tags, SDK archives and package tarballs retain their original source
and bytes. Embedded package metadata or documentation in those historical
archives may still name the former repository. The current README supplies the
maintained download links. Changing published package bytes requires a new
version; do not rebuild 0.5.1 to update an embedded URL.

The release bootstrap now identifies the original tested 0.5.1 source rather
than the older 0.4.1 bootstrap. This lets metadata-only changes on the current
branch validate the original release without repackaging it. Future versions use
their own artifact commits. Historical QA records remain evidence of their
original checks.

## Migration verification

On 2026-11-06, `npm test` passed 130 JavaScript tests and five portable native
suites; the release-helper suite passed 18 tests. All nine tracked release files,
including `dist.zip`, were compared with the pre-migration commit and
retained their original bytes. These are local automated checks, not a new
phone or physical-watch validation.
