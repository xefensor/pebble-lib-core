# Releasing Pebble Watchface Core

Routine checks are in [CONTRIBUTING](../CONTRIBUTING.md). Ordinary pushes run checks only.

1. Agree a release scope and a new version when changing artifact bytes. Preserve package entrypoints, UUIDs, dependency pins and licences unless that release explicitly changes them.
2. Run portable checks and a fresh candidate build/package audit. Complete the relevant emulator, phone and watch checks, recording any gaps.
3. Freeze the reviewed milestone explicitly, then make its source snapshot last:

```sh
npm run build
npm run release:package
```

Existing versions are refused. Never regenerate a historical archive after a documentation or
tooling edit. Review checksums, source identity and vendored package provenance, then commit all
frozen inputs and release notes. No tag is created by these commands.

4. Prepare the committed release locally:

```sh
npm run release:prepare
# Optional isolated output:
npm run release:prepare -- --output /tmp/pebble-lib-core-release
```

Preparation reads this repository’s [.github/release.json](../.github/release.json), validates
checksums and packaged identity/source/dependencies, and writes a flat asset set,
SHA256SUMS.txt, release notes and provenance manifest under ignored `build/release/`. No sibling
checkout, workspace script, SDK rebuild or network access is needed. Install locked development
dependencies first where minification is audited.

For a published version, fetch its tag into a standalone checkout (`git clone` includes tags).
Preparation uses that immutable tag’s source, package metadata and notes, checks ancestry and
rejects changed committed artifact bytes. Later maintenance documentation and package scripts do
not make old archives stale. For an untagged new version, preparation validates the triggering
commit. Never move an existing tag.

5. Only after explicit publication authorization, push the reviewed commit and manually dispatch **Publish reviewed release (manual)** on main. The workflow checks and prepares the exact checkout, then calls `npm run release:publish`. Publication requires GitHub’s `workflow_dispatch` context and the repository’s release.yml on main. Local invocation and push/pull-request events are refused. GitHub CLI and the workflow token are used only in that workflow.

Publication recomputes the prepared manifest and asset bytes before any remote write. It checks
existing tag identity, never replaces an asset, resumes an interrupted draft using identical
assets, and accepts an identical published release as unchanged. Changed, incomplete or
unexpected published assets fail. To clear stale local output, choose a new empty `--output`
directory; never delete frozen inputs to make preparation pass.

## Verification scope

`npm run test:release` uses temporary Git repositories and a fake GitHub transport to exercise
source/checksum failures, immutable tags, modified assets, interrupted drafts and safe reruns.
`npm run test:workflow` covers stale build candidates. These checks do not publish anything or
establish real-device validation.

Manual dispatch follows [GitHub’s workflow event
documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).
[History](history/index.md) retains earlier policies and QA context.
