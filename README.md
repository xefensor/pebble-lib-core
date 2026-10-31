# Pebble Watchface Core

Shared data and lifecycle code for [Halftone](https://github.com/xefensor/halftone-watchface)
and [Dynamic](https://github.com/xefensor/dynamic-watchface). Version 0.1.0 is the
first extraction from Halftone's C / PebbleKit JS implementation, targeting Emery
(Pebble Time 2).

The package is compiled into each watchface's PBW. Users install a watchface;
there is no separate core app or background service to install. A core update
reaches users when a consuming watchface is rebuilt and released.

## Shared responsibilities

- The first two global Pebble complication choices, source subscriptions,
  normalized scalar/image values and bounded receipt caches.
- Music title, artist, playing state and artwork; optional new-notification
  summaries; low phone battery.
- Serialized phone-to-watch messages, v2 packet validation, freshness and
  expiry, native cache chunks and reconnect/session bookkeeping.
- Notification baselines and privacy clearing. Music/notification content
  stays transient and is not persisted or logged by this core.

Each watchface owns its layout, layers, fonts and generated font metrics,
colors, animations, clock/date presentation, settings form, UUID, permissions
and release files. The core registers no Pebble SDK services or AppMessage
callbacks; the host supplies one dispatcher and forwards relevant events.

This is an initial two-reading contract, not a general widget framework. The
wire format still contains five bounded records for compatibility. It does not
supply a weather provider, timer integration or playback controls. Source
availability and permissions remain the Pebble phone app's responsibility.

## Use from a watchface

The consumer projects pin the same release tarball in
`vendor/pebble-watchface-core-0.1.0.tgz`, reference it with a `file:` dependency,
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
npm test
pebble build
python3 scripts/package-release.py
```

`pebble build` creates the package's `dist.zip`, containing native code, exported
headers and phone JavaScript. `npm pack` wraps the release package as a versioned
`.tgz`; it does not publish to npm. The release script normalizes SDK ZIP
metadata, writes that tarball to `releases/` and records SHA-256 checksums. `npm test` runs both JavaScript and portable
C suites; `npm run test:native` runs just the latter. Neither needs a watch or
Pebble emulator. Consumer build and rendering results
belong to each watchface's validation record. The initial extraction passed
83 JavaScript tests and three portable C suites; consumer rendering is checked
separately.

## Updating both watchfaces

1. Change the core and run its portable suites, then build the Pebble package.
2. Bump the core version for a new release and create its tarball.
3. Copy that exact tarball into each consumer's `vendor/` directory. Update its
   file dependency, lockfile and `vendor/CORE.json` provenance together.
4. Build and check each consumer. Shared behavior tests cover the engine;
   separate native screenshots check that each layout still fits.
5. Release the new PBWs independently. Existing installed PBWs keep their
   bundled core until the user installs an updated watchface.

For local iteration, Pebble also supports installing a built package from its
local directory. The committed tarball is the reproducible dependency used for
consumer releases.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE), with Xef's required attribution.
Use, modification and sharing are permitted for noncommercial purposes under
that license. Commercial use requires separate permission. This is
source-available software, not an OSI-approved open-source license.
