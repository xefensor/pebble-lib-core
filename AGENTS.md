# Pebble Watchface Core maintainer instructions

## Scope

Work on the existing stock-PebbleOS implementation; preserve accepted behaviour and public compatibility.
Read [CONTRIBUTING](CONTRIBUTING.md) for setup, output locations and commit/release policy.
Older packages, QA records and source archives remain frozen. Hosts and consumer
pins are independent; history is not a second active specification.

## Important boundaries

This is an embedded library, not an installed service. Hosts own SDK callbacks, timers, persistence keys, UI, permissions, vibration and Quiet Time. Keep the two-reading/five-record bounds and strict v1–v4 compatibility. Receipt time is not observation time; cache restore never renews a lease. Media/notification text must never reach persistence or logs. Baselines prevent alert-history replay. Consumer pins and app releases advance independently.

## Read only what the task needs

- Ownership, storage, source lifecycle, privacy or capabilities:
  [current maintenance contracts](docs/MAINTENANCE.md).
- Public API or wire changes: [host/provider contract](docs/HOST-CONTRACT.md) and existing cross-language fixtures.
- Versioning, archives, tags, upload or deployment: [release boundary](docs/RELEASING.md).

## Work and verification

Respect research/review versus implementation scope. Preserve established user
choices; clarify materially different interpretations before changing direction.
Run relevant required checks. Tests alone do not judge visual quality. Keep
source/portable tests, packaged execution, native emulator and real-device
verification distinct. Use disposable development evidence; do not overwrite
historical proof or relabel it as fresh.

`npm test` runs portable source tests and workflow guards. `npm run build`
creates a disposable candidate; it must not replace frozen dist/release files.
Do not bump versions or create release archives for routine edits. Never push,
publish or deploy as an implicit part of testing. Keep instructions current;
put superseded decisions in [history](docs/history/maintainer-notes-before-rework.md).
