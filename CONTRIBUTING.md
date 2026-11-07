# Developing Pebble Watchface Core

## Setup and normal work

Use Node 22+, Python3 and the Pebble SDK 4.33.1 on PATH for SDK builds.
Portable tests do not need an SDK, a phone or a watch.

```sh
npm ci --ignore-scripts
npm test
npm run build
```

Development outputs live under `build/candidate/`; QA output defaults to `build/qa/`. Frozen files under `dist/`, `releases/` and library root `dist.zip` are release snapshots.

| Task | What to read/check |
| --- | --- |
| Everyday source change | Run relevant source/native tests; use npm test for the complete portable suite. |
| Implementation boundaries | Read docs/MAINTENANCE.md for the affected ownership, compatibility or privacy boundary. |
| Wire/API change | Read the linked public specifications and add/update cross-language fixtures; consumers stay independently pinned. |
| Release/publication | Read docs/RELEASING.md. Release preparation is explicit; it is not part of every edit. |

## What counts as done

Make the requested coherent change, run relevant required checks, and report the
result and material gaps. Broaden verification for an actual failure or unresolved
risk; do not automatically repeat every historical QA suite. SDK/native changes
need a current packaged build; visual work needs actual inspection. Do not claim
fresh browser/device evidence from source checks or an old report.

## Output and commit policy

Ordinary work does not bump a version, produce source/debug release archives or
publish anything. A candidate contains the installable runtime and notices and
can be inspected independently of frozen artifacts. Candidate fingerprints reject
stale source or modified bundles. Finish a coherent authorized change in a local
commit when appropriate; do not push, tag, upload or deploy without explicit scope.

## Library candidates

`npm run build` produces build/candidate/dist.zip without changing the frozen
root dist.zip. `npm run pack:candidate` creates a temporary npm package with the
current SDK and sources. It does not repin, rebuild or publish consuming apps.

## Repository map

src/js owns host-injected subscriptions, normalization, bounded caches and the shared queue; src/c and include own portable packets/state/cache. Root entry modules preserve public imports.

[Current maintenance contracts](docs/MAINTENANCE.md) · [Release boundary](docs/RELEASING.md) ·
[Historical maintainer notes](docs/history/maintainer-notes-before-rework.md)

[Repository maintenance validation](docs/qa/repository-rework-2026-11-07/validation.json)
records the preserved baseline and this pass’s checks.
