# AUR Maintainer

A GitHub Action for automating the maintenance of Arch Linux AUR packages.

The stable public interface is **v1**. AUR Maintainer detects upstream versions,
updates package metadata, regenerates `.SRCINFO`, validates changes, creates or
updates package-specific pull requests, optionally squash-merges them, and can
publish packages to the AUR.

## Quick start

```yaml
permissions:
  contents: write
  issues: write
  pull-requests: write

steps:
  - uses: actions/checkout@v7

  - uses: soker90/aur-maintainer@v1
    with:
      github-token: ${{ secrets.GITHUB_TOKEN }}
      base-branch: main
      update-branch: update
      auto-merge: true
```

The complete stable API and configuration reference is in
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Repository configuration

The preferred configuration is `.aur-maintainer.yml`:

```yaml
packages:
  - path: packages/example-bin
    connector: github-release
    config:
      repository: owner/project
    updates: {}
```

Supported built-in connectors are `github-release` and `github-tag`.

Package entries support:

- `path`: package directory.
- `connector`: connector name.
- `config`: connector-specific settings.
- `updates`: optional `source` and `sha256` PKGBUILD assignment templates.
- `timeout`: package-local custom connector timeout in seconds; default `30`.

The version returned by a connector always updates `pkgver`.
For compatibility, a package path may still refer to a package-local
`update.yml`. New configurations should use `.aur-maintainer.yml`.

## Custom connectors

Repository-local connectors live at `connectors/<name>/index.js` and must
default-export a factory returning a connector with the same name.

Package-local connectors use `connector: custom` and
`<package>/connector/detect.sh`. The script receives:

- `AUR_MAINTAINER_PACKAGE`
- `AUR_MAINTAINER_PACKAGE_PATH`
- `AUR_MAINTAINER_CONFIG_JSON`

It must output non-empty `version`, `source`, and `sha256` fields as
`key=value` lines. The default timeout is 30 seconds.

## Pull requests

Only one package update is processed per run. With the default
`update-branch: update`, package `example-bin` uses `update/example-bin`.

The input is a branch **prefix**, not a complete branch name.

Existing update PRs for the same package/base branch are reused rather than
duplicated. Their title and body are refreshed with the current version
transition.

If validation fails, no update PR is created. Generated `PKGBUILD` and
`.SRCINFO` changes are preserved on the update branch and a validation issue
is created when a token with `issues: write` is available.

## Auto-merge

Set `auto-merge: true` to wait for checks and squash-merge the generated PR.

`auto-merge-timeout` defaults to `1800` seconds (30 minutes) and must be a
positive integer. Failed checks, conflicts, or a timeout fail the Action
without merging the PR.

## AUR publishing

`aur-publish` publishes a changed package during maintenance.

`aur-publish-only` publishes the current package state without running
upstream detection. It is intended for a workflow triggered after an update
PR merges.

Both publishing modes require `aur-ssh-key` and `aur-known-hosts`.
The publisher syncs package-root files such as `PKGBUILD` and `.SRCINFO` and
excludes the legacy `update.yml`.

## Inputs

| Input                | Default               |
| -------------------- | --------------------- |
| `config`             | `.aur-maintainer.yml` |
| `github-token`       | empty                 |
| `update-branch`      | `update`              |
| `base-branch`        | `main`                |
| `auto-merge`         | `false`               |
| `auto-merge-timeout` | `1800`                |
| `aur-publish`        | `false`               |
| `aur-publish-only`   | `false`               |
| `aur-ssh-key`        | empty                 |
| `aur-known-hosts`    | empty                 |

## Outputs

- `packages`: JSON array of discovered packages and candidates.
- `pull-request`: first generated update PR URL.
- `pull-requests`: JSON array of generated update PR URLs.
- `validation-failure-issue`: validation-failure issue URL, when created.

## Permissions

For maintenance with PR creation and validation issue reporting:

```yaml
permissions:
  contents: write
  issues: write
  pull-requests: write
```

`issues: write` is only needed for validation-failure issues.
AUR publishing uses SSH credentials rather than GitHub permissions.

## Development

```bash
npm install
npm test
npm run bundle
```

The generated `dist/` directory is committed because GitHub executes the
checked-in JavaScript bundle.

## Versioning

Consumers should normally use `soker90/aur-maintainer@v1`.
Releases use semantic tags such as `v1.0.9`; `v1` points to the latest
compatible v1 release. Consumers needing reproducible supply-chain pinning can
pin a specific release commit.
