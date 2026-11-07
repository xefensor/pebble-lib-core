# Developing Pebble Watchface Core

Use Node 22, Python 3.12 and a C99 compiler (`cc`, or set `CC`). Portable tests do not need a
phone, watch or Pebble SDK. For native SDK builds install [Pebble SDK
4.33.1](https://developer.repebble.com/sdk/) and make `pebble` available on PATH. This
repository builds independently from its own committed dependencies.

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run pack:candidate
```

`npm test` runs source/native, workflow, release-fixture and documentation checks. CI uses Node
22 and Python 3.12; it does not claim SDK, emulator or physical-device coverage.

`src/js`, `src/c` and `include` own readings, packet/state/cache logic and host-injected
transport. Root entry modules preserve public imports. Consumers retain their own release pins.

## Outputs and evidence

Active source lives in the directories above. Generated SDK and npm packages live in ignored
`build/candidate/`. Disposable QA belongs in `build/qa/`. Candidate checks reject changed source
or altered build outputs. Frozen `dist/`, `releases/` and root `dist.zip` belong to their
original release tags. Existing `docs/qa/` records and images are historical evidence; do not
overwrite or relabel them.

Read [maintenance contracts](docs/MAINTENANCE.md) before changing ownership, privacy or
compatibility. For visual changes, inspect the consuming app in the emulator; portable tests
establish no visual/device claim. Report source tests, packaged audits, emulator runs and
real-device tests separately.

## Release commands

`npm run release:prepare` validates committed frozen inputs and writes `build/release/`. It
never builds or publishes. `npm run release:publish` is restricted to the manually dispatched
GitHub release workflow on main. See [RELEASING](docs/RELEASING.md) for freezing a new version
and safe reruns. Finish authorized work in reviewable local commits; pushing or publication
needs explicit scope.

[History index](docs/history/index.md).
