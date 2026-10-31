# Host contract — 0.1.0

The core supplies state and decisions. A watchface supplies its platform APIs,
persistence namespace, settings, drawing and event ownership.

## Phone side

`require('pebble-watchface-core')` exports:

| Export | Purpose |
| --- | --- |
| `createMessageQueue(options)` | Returns a serialized `send(payload, success, failure)` function shared by theme, complication and context messages |
| `createComplications(options)` | Subscribes to the first two global choices; supplies `refresh()`, `configure()` and `status()` |
| `createContext(options)` | Coordinates music, optional notifications and phone battery; supplies refresh/configuration/connection/status/stop methods |
| `wire` | Bounded text/image normalization and version-2 packet encoding helpers |

Both source coordinators receive `pebble`, generated `keys`, the shared `send`,
`now`, `later`, `cancelLater` and `getSettings`. `now()` returns milliseconds,
like `Date.now()`; wire timestamps are converted to seconds. Complications also
receive `storage`, optional `cacheKey`, optional `localizeBoolean` and logging.
Halftone supplies its legacy cache key; Dynamic supplies its own namespace.

The host owns `ready`, `appmessage`, configuration and close events. It starts
or refreshes coordinators, routes context session requests, and sends only
validated presentation settings to native code. Source access and notification
permissions remain explicit phone-app behavior.

## Native side

Include `<pebble-watchface-core/pebble-watchface-core.h>` and create one
`WatchfaceCore` per host. `WfcConfig` accepts optional `WfcStorage` operations,
a first cache key, and `on_changed(context)`. Without the relevant storage
callbacks, normal RAM state still works and persistent cache operations are
unavailable. Reserve the complete eight-key cache range for the core.

A typical host lifecycle is:

1. Call `wfc_init` with current connection state and the previously saved
   session token. Persist the resulting token in the host's session key.
2. Call `wfc_load_cache(now)` when storage is available. Loading does not renew
   the records' original confirmation or expiry times.
3. In one native inbox dispatcher, route data tuples to
   `wfc_receive_complications` or `wfc_receive_context`. Parse the context marker
   separately and pass it to the latter. The same dispatcher can handle the
   host's color/text settings. Invalid data must reach the appropriate clear
   path rather than leaving stale private context visible.
4. Forward connection transitions through `wfc_connection_changed`. Persist
   an advanced token after reconnect and schedule the host's startup request.
5. After opening an outbox, obtain `wfc_request_marker`; report accepted sends,
   immediate/asynchronous failures and successful ACKs through the matching
   `wfc_request_*` functions. These protect a new connection generation from
   late ACKs belonging to an old one.
6. Call `wfc_tick(now)` on the host's minute tick. A true result asks the host to
   request replacement data; the host still owns connection/outbox checks.
7. Call `wfc_prune_context(now)` after receiving context and from its expiry
   timer. Schedule the returned absolute next expiry, or cancel the timer for
   zero. Refresh the host's layers when state changes.

Native `now` values and stored timestamps use Unix seconds. The host owns all
Pebble timer creation/cancellation, service subscriptions, AppMessage handlers
and persistent session-key writes. It may use `on_changed` to refresh its UI
or perform those updates after routing an event.

## Data and privacy rules

| Data | Contract |
| --- | --- |
| Selected complications | First two global choices; at most two hours from confirmed receipt, capped by an earlier source expiry |
| Music / phone battery | Confirmation lease at most 120 seconds; one-minute phone refresh |
| New notification | At most 12 seconds, retaining original expiry |
| Paused music | Five-second grace period |
| Context cache | Never persisted; cleared on disconnect or native relaunch |
| Notification baseline | Existing notifications are not replayed on startup, reconnect or access reconfiguration |

The native context packet uses five fixed roles: music title/art, music artist,
notification title/icon, notification body and low phone battery. Notification
context takes priority over music. An unmarked frame may recover music/status,
but private notifications stay blocked until a fresh marked baseline matches
the current native session.

The v2 bounded packet and CRC contract are exercised by the shared fixtures in
`tests/fixtures/`. Changing the wire format requires a deliberate versioned
migration on both C and JavaScript sides. Do not infer weather semantics from
arbitrary percentages or rewrite a provider's formatted units.

## Presentation boundary

A consumer chooses what to draw and how much space it receives. Layout
coordinates, fonts, font-resource IDs, generated glyph metrics, border effects
and animation frames are not part of the core state. Native Timeline Peek is
owned by Pebble; consumers adapt to the unobstructed area and do not create a
second copy of calendar events.

Each consumer has its own UUID, settings and permission manifest. Its PBW
contains its pinned library version, so changing the shared repository alone
does not update installed watchfaces.
