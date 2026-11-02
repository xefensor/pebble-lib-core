# Host contract — 0.5.0

The core supplies state and decisions. A watchface supplies its platform APIs,
persistence namespace, settings, drawing and event ownership.

This contract describes 0.5.0, including the legacy 0.4.1 context interface. See the [project README](../README.md)
for package downloads, [release guide](GITHUB-RELEASES.md) for publishing, and
[maintainer notes](../AGENTS.md) for validation and change boundaries. A new
Core release does not change an installed or pinned consumer automatically.

## Readings only integration

Hosts using an independent activity engine should include `readings.h` and
create a `WfcReadings`. This additive type contains the five-slot reading
packet, public cache, freshness flags and connection state, without the separate
legacy context allocation. The five records preserve the released wire format;
the complication coordinator still selects only the first two global choices.
The old `WatchfaceCore` type, layout and function signatures remain unchanged.

| Function | Host action |
| --- | --- |
| `wfc_readings_init(state, config, connected)` | Initialize with optional `WfcConfig` storage/change callbacks |
| `wfc_readings_load_cache(state, now)` | Restore original receipt/expiry/provenance from the same eight-key namespace |
| `wfc_readings_receive(state, bytes, length, now)` | Validate and apply a reading snapshot; invalid input clears live state and cache |
| `wfc_readings_connection_changed(state, connected)` | Forward connection transitions; unknown/private selected readings clear immediately |
| `wfc_readings_tick(state, now)` | Check ready-to-expired transitions and the connected 30-minute refresh interval |
| `wfc_readings_request_accepted(state, now)` | Record when the host accepted a new reading request for delivery |
| `wfc_readings_clear_cache(state)` | Remove the configured cache keys |

On the phone, `require('pebble-watchface-core/readings')` exports
`createComplications`, `createMessageQueue` and `wire`, without loading
`createContext`. The SDK archive also contains `src/js/readings` for hosts that
use explicit source entrypoints. No services, handlers or activity sessions are
registered by either entrypoint.

Both native state types compile the same shared cache/freshness implementation.
There is no cast between their different layouts or macro-dependent public
layout. A consumer must still rebuild against its pinned 0.5.0 package.

### Additional snapshot channels

An independent engine can share the host queue through explicit declarations:

```js
var send = core.createMessageQueue({
  keys: messageKeys,
  snapshotChannels: [{
    name: 'activities',
    dataKey: 'ACTIVITY_DATA',
    sidecarKeys: ['ACTIVITY_SESSION']
  }],
  send: transportSend,
  later: setTimeout,
  cancelLater: clearTimeout
});
```

`dataKey` and `sidecarKeys` accept a generated message-key name or numeric key.
Names also resolve through `keys`, permitting either named or numeric payloads.
There can be at most 16 additional channels; names and data-key identities must
be distinct and may not replace Core's complication/context channels. A
snapshot must contain exactly one alias of its byte-array data key and only
its declared sidecar fields. Any mixed settings payload, request without data,
or unrecognized payload retains FIFO ordering. Queue registration is a host
protocol decision, not permission to coalesce commands.

Only pending snapshots in the same channel are replaced. Their copied data and
sidecars settle together, superseded callbacks fail with `SUPERSEDED`, and an
active send only succeeds after the transport callback. This preserves one
dispatcher and one serialized AppMessage queue for all host traffic.

## Phone side

`require('pebble-watchface-core')` exports:

| Export | Purpose |
| --- | --- |
| `createMessageQueue(options)` | Returns a serialized `send(payload, success, failure)` function shared by theme, complication and context messages |
| `createComplications(options)` | Subscribes to the first two global choices; supplies `refresh()`, `configure()` and `status()` |
| `createContext(options)` | Coordinates music, optional notifications and phone battery; supplies refresh/configuration/connection/status/stop methods |
| `wire` | Bounded text/image normalization and version-4 packet encoding helpers |

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
   A phone-runtime bootstrap query (ordinary `REQUEST_CONTEXT=1`, with no context
   payload) calls `wfc_context_query`, which also advances the native session,
   clears context and closes its notification baseline gate. Persist that new
   token and reset host event tracking before requesting the new baseline. This
   covers phone JavaScript restarts without a Bluetooth transition; clock-format
   queries must remain separate and do not rotate the context session.
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
| New notification | Three seconds for app/sender summaries; up to eight seconds when nonempty message text is included; retaining the burst's original expiry |
| Paused music | Five-second grace period |
| Context cache | Never persisted; cleared on disconnect or native relaunch |
| Notification baseline | Existing notifications are not replayed on startup, reconnect or access reconfiguration |

The native context packet uses five fixed roles: music title/art, music artist,
notification sender/title/icon with separate app label, notification body and low phone battery. Notification
context takes priority over music. An unmarked frame may recover music/status,
but private notifications stay blocked until a fresh marked baseline matches
the current native session.

The v4 bounded packet and CRC contract (with strict v1/v2/v3 decoding) are exercised by the shared fixtures in
`tests/fixtures/`. Changing the wire format requires a deliberate versioned
migration on both C and JavaScript sides. Do not infer weather semantics from
arbitrary percentages or rewrite a provider's formatted units.

## Versioned wire and host budgets

Version 4 uses the existing six-byte packet header and a 56-byte record header.
Version 3 retains its exact 52-byte header; versions 1/2 retain 20-byte headers.
A record retains up to 128 UTF-8 text bytes, a 16-byte unit and 24-byte label,
optional little-endian IEEE754 binary64 value/min/max, semantic/source enums,
a precise detail enum, forecast qualifier, known observation timestamp,
and a 40×40 4bpp bitmap with at most 16 palette entries. Five records fit within
5,206 bytes. Native AppMessage inboxes need at least 6,144 bytes, including
dictionary overhead. Unknown flags/enums, nonfinite metadata, invalid ranges,
UTF-8, palette references, CRC or lengths are rejected. See the public header
and cross-language fixtures for exact byte offsets.

Version 4 selected non-ready records may retain only public identity metadata;
values, images, numeric flags and receipt/expiry/observation timestamps are absent.
EMPTY records retain no identity. EXPIRED is status 7. Detail and broad kind must
agree; unknown detail/qualifier values are rejected. Byte25 carries detail,
byte26 the forecast qualifier, byte27 remains zero and bytes52–55 carry known
observation time. The doubles at28/36/44 retain their original offsets.

The original eight-key, 256-byte-per-key native cache namespace remains. Stored
snapshots drop bitmap payloads to stay bounded, while retaining scalar data and
original confirmation/expiry. Live state keeps its images. Image-only values
become unavailable in a restored cache. The native cached flag identifies only
local persistence; receipt time never claims to be provider measurement time.
Music and notification categories are excluded from both phone and native reading
caches, even when selected as ordinary complication slots. Native caches from
versions 1/2 lack source identity and are cleared during migration; live legacy
packet decoding remains supported.

The queue factory accepts the host's generated `keys` alongside transport and
timer callbacks. It recognizes pure complication and context snapshots from
those keys and exposes `send.supersedesSnapshots`. Only pending snapshots in
the same channel may be replaced. Mixed settings/data payloads retain FIFO. An active send is never
reported acknowledged before transport ACK. Replaced entries fail with
SUPERSEDED, which coordinators treat as terminal rather than retrying obsolete
data. Hosts must continue to route reconnect tokens with their own snapshot.

Per-source status is available for settings; health snapshots are not a live
configuration-page channel. Keep private music and message contents out of
status diagnostics, logs and persistent storage.

## Presentation boundary

A consumer chooses what to draw and how much space it receives. Layout
coordinates, fonts, font-resource IDs, generated glyph metrics, border effects
and animation frames are not part of the core state. Native Timeline Peek is
owned by Pebble; consumers adapt to the unobstructed area and do not create a
second copy of calendar events.

Each consumer has its own UUID, settings and permission manifest. Its PBW
contains its pinned library version, so changing the shared repository alone
does not update installed watchfaces.

## Notification presentation metadata

The notification heading record uses text for sender/title (falling back to app
only when no sender/title is supplied) and semantic.label for the app name.
The optional `getSettings().notificationAppOnly` privacy setting instead sends
only the app name (or package when the app name is absent), an empty app label,
and no message body. A source with neither app nor package is skipped in this
mode; private sender text is never used as its fallback. Changing this setting
retracts the current notice and establishes a new shade baseline.
Consumers should not split strings on punctuation to recover app identity.
Text/app identity changes are distinct from bitmap refreshes. Source burst
coalescing never renews the original interruption deadline; permission and
session clears cancel pending private updates immediately.
Every source snapshot revalidates active and queued notices even when their
instance IDs remain present. Malformed or fully redacted properties, an unusable
heading, or an app identity that no longer matches the filter immediately
retracts the old text and cancels its queued update. Restoring valid content
within the same burst does not renew its deadline or create another event.

Hosts may opt into an ephemeral playback/event sidecar by supplying
`keys.CONTEXT_STATE`. It accompanies every `CONTEXT_DATA` snapshot in the same
dictionary and does not change the version-4 packet format:

| Bytes | Value |
| --- | --- |
| 0–3 | Little-endian uint32 native session token; zero until known |
| 4–7 | Little-endian uint32 notification burst event; zero when no fresh notice is active or while a baseline marker is pending |
| 8 | Flags: bit0 marks a retained paused music track; all other bits are zero |

A positive event advances only for a new independent allowed notification
burst. Existing shade history, icon refreshes, changes within that burst,
music updates, retries and page redraws do not advance it. Event numbers remain
monotonic across privacy/source rebaselines in one native session and reset
when a different native session token arrives. They contain no provider
notification ID or private text and must never be persisted.

Before acting on a sidecar, a native host must validate its exact length and
flags, match its session to the current native token, and successfully decode
the accompanying context snapshot. Notification vibration also requires an
open notification baseline gate and a fresh notification record. The host owns
the vibration preference and Pebble Quiet Time checks. Consume a new event
even when vibration is disabled or suppressed by Quiet Time; preserve the last
consumed event when the sidecar contains zero. This prevents settings changes
or late artwork from alerting an old notification. Clear event tracking only
on a native session change. The source feed does not say whether Pebble's
native notification system already vibrated, so this mechanism cannot dedupe
against those native alerts.

The shared queue recognizes `CONTEXT_STATE` as part of a pure context snapshot,
copies its bytes, and replaces it atomically with the corresponding context
and baseline marker. A host must not queue this sidecar separately.
