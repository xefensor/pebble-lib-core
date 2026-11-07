# Pebble Watchface Core

An embedded library for bounded readings, phone-to-watch transport and compatible legacy context
APIs.

## Download

[Version 0.5.2](https://github.com/xefensor/pebble-lib-core/releases/tag/v0.5.2) is the current published library.

[package](https://github.com/xefensor/pebble-lib-core/releases/download/v0.5.2/pebble-watchface-core-0.5.2.tgz),
[SDK archive](https://github.com/xefensor/pebble-lib-core/releases/download/v0.5.2/dist.zip), and
[checksums](https://github.com/xefensor/pebble-lib-core/releases/download/v0.5.2/SHA256SUMS.txt).

Package name: `pebble-watchface-core`. This library is bundled by a host app; it is not
installed on the watch separately.

Download the package into your project’s `vendor/` directory, then pin it locally:

```sh
npm install --save-exact ./vendor/pebble-watchface-core-0.5.2.tgz
```

Commit the lockfile and upstream checksum/provenance record. Consumer upgrades are independent.

```c
#include <pebble-watchface-core/readings.h>
```

```js
var core = require('pebble-watchface-core/readings');
```

[Host contract](docs/HOST-CONTRACT.md) · [Integration guide](docs/USAGE.md). Hosts own SDK callbacks, permissions, timers, persistence keys and UI.

## Compatibility

The current SDK target is **Pebble Time 2 / Emery**, using **Pebble SDK 4.33.1**.

## Version 0.5.2

- Add an optional host callback for meaningful public reading labels, including source names and weather qualifiers.
- Keep media and notification identity transient; private sources do not enter public labels.
- Preserve native exports, bounded readings, storage compatibility and v1–v4 wire formats.
- Validate JavaScript/native fixtures and a fresh SDK/package build. Consuming apps still require independent validation; no physical-device run is claimed.

## Development

Use Node 22, Python 3.12 and a C compiler. SDK builds additionally need Pebble SDK 4.33.1 on
PATH.

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run pack:candidate
```

[Contributor guide](CONTRIBUTING.md) · [Release preparation](docs/RELEASING.md) · [History index](docs/history/index.md).
Development outputs belong in ignored `build/`; published archives stay frozen.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE). Preserve bundled third-party notices and attribution.
