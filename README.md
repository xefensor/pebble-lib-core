# Pebble Watchface Core

Main contains the current implementation. [Development](CONTRIBUTING.md),
[current maintenance contracts](docs/MAINTENANCE.md) and [release policy](docs/RELEASING.md)
are the active contributor references. Public downloads and frozen evidence keep
their original versions; a merge to main is not publication.

Repository: [pebble-lib-core](https://github.com/xefensor/pebble-lib-core), part of
XOCE — Xef's Open Computing Ecosystem. The package remains
`pebble-watchface-core`; see the [repository migration notes](docs/REPOSITORY-MIGRATION.md).

Shared data and lifecycle code for [Halftone](https://github.com/xefensor/halftone-watchface)
and [Dynamic](https://github.com/xefensor/pebble-watchface-dynamic). Version **0.5.2**
adds optional public reading labels while preserving the native library and
v1–v4 wire formats. See the [label-hook contract](docs/HOST-CONTRACT.md#optional-public-reading-labels).

The package is compiled into each watchface's PBW. Users install a watchface;
there is no separate Core app or service to install. Consumer versions advance
independently; Dynamic 0.18.3 bundles Core 0.5.2.

## Download and release status

[Core 0.5.2 on GitHub Releases](https://github.com/xefensor/pebble-lib-core/releases/tag/v0.5.2)
provides the following assets:

| Download | Use |
| --- | --- |
| [pebble-watchface-core-0.5.2.tgz](https://github.com/xefensor/pebble-lib-core/releases/download/v0.5.2/pebble-watchface-core-0.5.2.tgz) | Version-pinned package containing SDK, sources and license |
| [dist.zip](https://github.com/xefensor/pebble-lib-core/releases/download/v0.5.2/dist.zip) | Built Pebble SDK library and exported headers/JavaScript |
| [SHA256SUMS.txt](https://github.com/xefensor/pebble-lib-core/releases/download/v0.5.2/SHA256SUMS.txt) | Checksums for both downloads |

Download the assets together and run `sha256sum -c SHA256SUMS.txt`.
The release tag identifies the matching source. Earlier release assets and tags
retain their original bytes. See [the release guide](docs/GITHUB-RELEASES.md).

## Version 0.5.2

- Add an optional host callback for meaningful public reading labels, including source names and weather qualifiers.
- Keep media and notification identity transient; private sources do not enter public labels.
- Preserve native exports, bounded readings, storage compatibility and v1–v4 wire formats.
- Validate JavaScript/native fixtures and a fresh SDK/package build. Consuming apps still require independent validation; no physical-device run is claimed.

## Shared responsibilities

- The first two global Pebble complication choices, source subscriptions,
  normalized scalar/image values and bounded receipt caches.
- Music title, artist, playing state and artwork; optional new-notification
  summaries; low phone battery.
- Serialized phone-to-watch messages, v4 packets with strict v1/v2/v3 decoding, freshness and
  expiry, native cache chunks and reconnect/session bookkeeping.
- Notification baselines and privacy clearing. Music/notification content
  stays transient and is not persisted or logged by this core.

Each watchface owns its layout, layers, fonts and generated font metrics,
colors, animations, clock/date presentation, settings form, UUID, permissions
and release files. The core registers no Pebble SDK services or AppMessage
callbacks; the host supplies one dispatcher and forwards relevant events.

This is a bounded two-reading contract, not a general widget framework. The
wire format still contains five bounded records for compatibility. It does not
supply a weather provider, timer integration or playback controls. Source
availability and permissions remain the Pebble phone app's responsibility.

## Version 0.5.1

- Activity hosts can validate the complete context packet and retain only a
  12-byte `WfcPhoneStatus`, using `wfc_context_phone_status_read`. The decoder
  is shared with readings; private music/notification payloads are never copied.
- Existing full-context and wire APIs remain compatible. Validation-only context
  reads avoid a redundant generic validation pass.

## Historical version 0.5.0

- A new `WfcReadings` state and `readings.h` API retain the existing cache,
  freshness, private-reading clearing and reconnect behaviour without allocating
  the legacy context record set. `WatchfaceCore` remains compatible.
- `require('pebble-watchface-core/readings')` supplies complications, wire and
  the shared queue without importing the legacy context coordinator. The
  equivalent `src/js/readings` entrypoint is included in the SDK package.
- Hosts can register bounded snapshot channels with `snapshotChannels` so an
  independent activity engine can share the existing queue. State data and its
  declared sidecars replace obsolete waiting snapshots together; settings and
  commands retain FIFO order. Transport ACK semantics remain unchanged.
- The independent activity library owns new activity providers and timer
  sharing. Core neither depends on that library nor registers a second
  dispatcher. Existing `createContext` consumers can migrate independently.
- The package filenames are `pebble-watchface-core-0.5.1.tgz` and
  `dist.zip`; native SDK packaging and consumer rendering are separate checks.

## Historical version 0.4.1

- Fully redacted, malformed or newly filtered notifications clear active text immediately.
- Queued notification replacements are revalidated against each source snapshot, so a private preview cannot appear after its source has been redacted.
- Burst timing, notification privacy choices and the v4 wire format remain unchanged.

## Historical version 0.4.0

- A new notification burst gets at most three seconds for a summary/app-only
  banner or eight seconds for an actual nonempty message preview, capped by an
  earlier source expiry. Text/body/icon updates retain the first notice's
  deadline and do not start another interruption.
- Optional app-only privacy sends app name/icon (or package identity) without
  sender or message body. The ordinary summary/message preferences remain
  available; baselines and immediate privacy clearing are retained.
- Hosts may provide `keys.CONTEXT_STATE` for an atomic nine-byte side tuple:
  native session token, independent-burst counter and paused-music flag. History,
  reconnect boundaries, icon-only updates and retries do not create new event
  identities. Counters remain monotonic across rebaselines in one native session.
- Context metadata stays transient alongside its snapshot and is never persisted
  or logged. The shared queue supersedes the content and its metadata together.
- V4 packets and strict v1/v2/v3 decoding are unchanged. Hosts own event acceptance,
  vibration preferences/Quiet Time policy, pause indicators, palettes and layout.

## Historical version 0.3.0

- Precise weather/phone detail identifiers preserve Temperature, Feels like,
  High, Low, wind direction/speed and Phone battery separately from broad units.
- Known observation time stays separate from receipt time. Forecast metadata
  is explicit; no source measurement time is inferred from a fresh transfer.
- Public configured identity survives loading, unavailable, denied, disabled
  and expired states. Expired is a distinct status; missing records contain no
  stale numeric/text/image values. Private source identity remains excluded
  from persistence and unavailable snapshots.
- Notification sender/title and app name remain separate. Fast burst updates
  are coalesced into stable intervals without extending the eight-second cap.
  Icon-only updates repaint without renewing the notice lease. Source redaction
  clears private text immediately, bypassing coalescing and cancelling queued updates.
- Version 4 uses a 56-byte record header and is bounded to 5,206 bytes. A
  6,144-byte consumer inbox remains sufficient. Explicit v1/v2/v3 encoding and
  strict legacy decoding are retained. Public native v3 caches migrate safely.

## Historical version 0.2.0

- Text is bounded to 128 UTF-8 bytes per record, with separate unit and short-label
  fields. Provider-formatted values remain available alongside numeric metadata.
- Optional semantic/source identifiers, numeric value, range and unit let a
  consumer identify battery, humidity, rain and other readings without guessing
  from a percentage string. Missing or invalid metadata is never invented.
- Images can be up to 40×40, 4bpp with a 16-entry palette. Source support still
  determines available artwork detail.
- Version-3 packets are bounded to 5,186 bytes. Hosts should open at least a
  6,144-byte inbox. Decoders still strictly accept legacy versions 1 and 2.
- Native persistent caching retains eight 256-byte keys. Cache compaction strips
  images, preserves value/metadata/receipt/expiry and never renews freshness.
  Restored values carry a native-cache-origin flag, not an observation timestamp.
  Music/notification categories are excluded even when selected as normal readings.
  Legacy native caches without source identity are cleared once during upgrade;
  legacy live packet decoding remains supported.
- Pending complication/context snapshots supersede older waiting snapshots in
  their own channel. Settings and other commands keep FIFO ordering. Superseded
  callbacks receive SUPERSEDED rather than a false acknowledgement.
- Notification bursts are bounded to eight seconds; baseline/session privacy and
  five-second paused-music grace are retained.

## Use from a watchface

For a new host with an independent activity engine, use the lean entrypoints:

```c
#include <pebble-watchface-core/readings.h>
```

```js
var core = require('pebble-watchface-core/readings');
var send = core.createMessageQueue(transportOptions);
var complications = core.createComplications(complicationOptions);
```

The host creates a `WfcReadings`, calls `wfc_readings_init`, routes complication
bytes through `wfc_readings_receive`, and forwards connection changes and minute
ticks. Context/activity sessions, presentation and message handlers remain
outside this lean state. It reads the same persistent cache namespace as the
legacy API and does not renew a restored value's original times.

The following legacy entrypoints remain available for pinned consumers:

Consumers pin an independently selected release tarball, such as
`vendor/pebble-watchface-core-0.5.1.tgz`, reference it with a `file:` dependency,
and commit `package-lock.json`. `vendor/CORE.json` records the upstream version
and archive checksum. This supports `npm ci` without an npm publishing account
or a dependency on a changing Git branch.

```c
#include <pebble-watchface-core/pebble-watchface-core.h>
```

```js
var core = require('pebble-watchface-core');
var send = core.createMessageQueue(transportOptions);
var complications = core.createComplications(complicationOptions);
var context = core.createContext(contextOptions);
```

Factories receive the host's Pebble API, generated message keys, send function,
clock and timers. The complication factory also receives storage, settings,
optional boolean localization and an optional cache key. The native API stores
its state in a host-owned `WatchfaceCore` and accepts optional storage and
change-notification callbacks.

See [the host contract](docs/HOST-CONTRACT.md) for lifecycle details and the
public [C header](include/pebble-watchface-core.h) / [JS entrypoint](src/js/index.js)
for exact signatures. Halftone and Dynamic are complete consumer examples.

## Build and test

Use [CONTRIBUTING](CONTRIBUTING.md) for the current SDK/development workflow.
`npm test` runs portable JS/C and workflow guards; `npm run build` writes
`build/candidate/dist.zip` without replacing the frozen root SDK.
`npm run pack:candidate` creates an isolated development npm package.
Release packaging is a separate [explicit milestone](docs/RELEASING.md).

## Releasing Core and updating consumers

1. Make the engine change and add regression coverage for the behavior or
   contract it changes. Bump the Core version and update its release notes.
2. Run the portable suites, build with the Pebble SDK and package the exact
   `dist.zip` and versioned tarball.
3. Commit the version, checked artifacts, checksums and notes locally, then
   validate committed `HEAD` with the release helper as described in
   [the release guide](docs/GITHUB-RELEASES.md). Push the checked commit to `main`;
   GitHub Actions tests and publishes that version automatically. Existing
   published assets and tags are preserved; changed package bytes need a new
   version. Documentation-only updates do not repack a published release.
4. For each consumer being upgraded, copy the selected tarball into `vendor/`.
   Update its file dependency, lockfile and `vendor/CORE.json` provenance
   together. Leave other consumers on their existing pin.
5. Build and check that consumer, including its native layout and relevant
   lifecycle/privacy cases, then release its PBW independently. Shared engine
   tests do not establish consumer render or hardware results.

For local iteration, Pebble also supports installing a built package from its
local directory. The committed tarball is the reproducible dependency used for
consumer releases.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE), with Xef's required attribution.
Use, modification and sharing are permitted for noncommercial purposes under
that license. Commercial use requires separate permission. This is
source-available software, not an OSI-approved open-source license.
