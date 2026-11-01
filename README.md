# Pebble Watchface Core

Shared data and lifecycle code for [Halftone](https://github.com/xefensor/halftone-watchface)
and [Dynamic](https://github.com/xefensor/dynamic-watchface). The current release,
**0.4.1**, provides two selected readings and transient music, notification and
phone context for Emery (Pebble Time 2). It preserves precise reading identity,
expiry and privacy; 0.4.1 fixes clearing of fully redacted or newly filtered
active and queued notifications.

The package is compiled into each watchface's PBW. Users install a watchface;
there is no separate core app or background service to install. A core update
reaches users when a consuming watchface is rebuilt and released.

## Download and release status

[Core 0.4.1 on GitHub Releases](https://github.com/xefensor/pebble-watchface-core/releases/tag/v0.4.1)
is published with these verified assets:

| Download | Use |
| --- | --- |
| [pebble-watchface-core-0.4.1.tgz](https://github.com/xefensor/pebble-watchface-core/releases/download/v0.4.1/pebble-watchface-core-0.4.1.tgz) | Version-pinned package for consuming watchfaces; includes the SDK archive, sources and license |
| [dist.zip](https://github.com/xefensor/pebble-watchface-core/releases/download/v0.4.1/dist.zip) | Built Pebble SDK library and exported headers/JavaScript |
| [SHA256SUMS.txt](https://github.com/xefensor/pebble-watchface-core/releases/download/v0.4.1/SHA256SUMS.txt) | Flat checksums for both downloaded files |

Download both packages and the checksum file into one directory, then run
`sha256sum -c SHA256SUMS.txt`. The release tag identifies the
[frozen 0.4.1 source](https://github.com/xefensor/pebble-watchface-core/tree/v0.4.1).
Later documentation and automation updates on `main` do not replace those files.

GitHub Actions publishes future packaged versions after their tests and artifact
checks pass. It uploads the committed files rather than rebuilding them with a
different SDK. See [the release guide](docs/GITHUB-RELEASES.md) for the packaging,
trigger and rerun rules, and [AGENTS.md](AGENTS.md) for maintainer instructions.

Publishing Core does **not** update installed watchfaces or their dependencies.
Dynamic currently pins 0.4.1; Halftone retains 0.1.0. Each consumer is upgraded,
built, visually checked and released independently. Core is not a separate
watch app, a background service or an appstore submission.

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

## Version 0.4.1

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

Consumers pin an independently selected release tarball, such as
`vendor/pebble-watchface-core-0.4.1.tgz`, reference it with a `file:` dependency,
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

Use a Pebble C SDK with the Emery target, Node.js for the portable JavaScript
suites and a C99 compiler for the native suites. Run these commands from a
checkout of this repository; consumers install the built package instead.

```sh
npm ci --ignore-scripts
npm test
python3 -m unittest discover -s tests -p test_github_release.py
pebble build
python3 scripts/package-release.py
```

`pebble build` creates the package's `dist.zip`, containing native code, exported
headers and phone JavaScript. `npm pack` wraps the release package as a versioned
`.tgz`; it does not publish to npm. The release script normalizes SDK ZIP
metadata, writes that tarball to `releases/` and records repository-path SHA-256
checksums. The GitHub release workflow produces a separate flat checksum
attachment for downloaded files.

`npm test` runs JavaScript and portable C suites; `npm run test:native` runs only
the C suites. These checks need neither the Pebble SDK nor an emulator. The
release automation tests use a temporary repository and fake GitHub service;
they do not publish anything. The 0.4.1 engine passed **126 JavaScript tests and
three native C suites**. The later release-automation pass added **18 passing
release tests**. These counts describe those checks, not physical-device or
live-provider coverage. Rendering, permissions and real-device results belong
to each consuming watchface's validation record.

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
