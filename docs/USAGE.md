# Using Pebble Watchface Core

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

See [the host contract](../docs/HOST-CONTRACT.md) for lifecycle details and the
public [C header](../include/pebble-watchface-core.h) / [JS entrypoint](../src/js/index.js)
for exact signatures. Halftone and Dynamic are complete consumer examples.
