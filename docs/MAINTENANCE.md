# Pebble Watchface Core maintenance contracts

These are current implementation constraints. They apply when changing the
relevant subsystem, not as a requirement to reread every document for every edit.

## Ownership and compatibility

This is an embedded library, not an installed service. Hosts own SDK callbacks, timers, persistence keys, UI, permissions, vibration and Quiet Time. Keep the two-reading/five-record bounds and strict v1–v4 compatibility. Receipt time is not observation time; cache restore never renews a lease. Media/notification text must never reach persistence or logs. Baselines prevent alert-history replay. Consumer pins and app releases advance independently.

## Current interaction and product boundaries

Keep the readings-only and status-only adapters alongside the legacy context API. Core does not choose fonts/layout or supply weather/timer controls. Changes to wire semantics require cross-language fixtures and deliberate consumer migration. Public package/import name remains pebble-watchface-core despite the repository name.

## Source ownership

src/js owns host-injected subscriptions, normalization, bounded caches and the shared queue; src/c and include own portable packets/state/cache. Root entry modules preserve public imports.

## Phone persistence and evidence

For apps with phone settings, keep active-writer selection, separate Android
DOM/native storage views, exact application acknowledgements and bounded handoffs.
Saving stays open where supported; uncertain writes retain the draft and explicit
readback/retry. Discard cannot undo a write already sent. Load errors must not
silently replace saved choices with editable defaults. Do not introduce unsolicited
focus or scroll changes. Historical browser/emulator results do not validate a
new build. Keep portable, packaged, simulated transport and real-device claims distinct.

## Dependencies, identities and licences

Preserve public identifiers, message-key numbers, compatible storage formats,
licences and attribution. Pinned vendor archives/checksums remain independent of
sibling checkouts. Do not repin consumers or change published bytes as cleanup.

## History

[Earlier maintainer notes](history/maintainer-notes-before-rework.md) retain the
full rationale/history. Read them only when investigating an old decision.
