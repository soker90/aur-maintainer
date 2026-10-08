# Configuration reference

This document describes the stable `v1` interface of `soker90/aur-maintainer`.

## `.aur-maintainer.yml`

The preferred configuration is a repository-level `.aur-maintainer.yml`:

```yaml
packages:
  - path: packages/example-bin
    connector: github-release
    config:
      repository: owner/project
    updates: {}
```

Each package object supports:

| Field       | Required | Description                                                      |
| ----------- | -------- | ---------------------------------------------------------------- |
| `path`      | yes      | Package directory relative to the workspace                      |
| `connector` | yes      | Connector name                                                   |
| `config`    | no       | Connector-specific object; defaults to `{}`                      |
| `updates`   | no       | `source` and/or `sha256` PKGBUILD assignment templates           |
| `timeout`   | no       | Package-local custom connector timeout; defaults to `30` seconds |

The connector version always updates `pkgver`. Update templates can use the
placeholders `${version}`, `${source}`, and `${sha256}`.

For compatibility, `packages` may also contain directory strings that use a
package-local `update.yml`. New configurations should use the repository-level
file.

## Built-in connectors

### `github-release`

Reads the latest GitHub Release for `config.repository`.

```yaml
connector: github-release
config:
  repository: owner/project
```

The release `tag_name` is converted to the package version. A leading `v` is
removed when it directly precedes a numeric version.

### `github-tag`

Reads repository tags and selects the highest supported package version.

```yaml
connector: github-tag
config:
  repository: owner/project
```

Tags without a supported package version are ignored.

## Repository-local connectors

Create `connectors/<name>/index.js`. The module must default-export a factory
whose returned connector has the same name as its directory:

```js
export default (context) => ({
  name: 'example',
  detect: async (_pkg, config) => {
    const response = await context.fetch(config.url)
    const data = await response.json()
    return { version: data.version }
  }
})
```

The factory receives `context.fetch(input, init)` and the supplied
`context.token`, when available. A repository connector cannot override a
built-in connector name.

## Package-local `custom` connectors

Set `connector: custom` and create `<package>/connector/detect.sh`.

The script runs with the package directory as its working directory and
receives `AUR_MAINTAINER_PACKAGE`, `AUR_MAINTAINER_PACKAGE_PATH`, and
`AUR_MAINTAINER_CONFIG_JSON`.

It must emit non-empty `key=value` lines for all three fields:

```text
version=1.2.3
source=https://example.com/example-1.2.3.tar.gz
sha256=0123456789abcdef...
```

The default timeout is 30 seconds. `timeout` must be a positive integer.

## Action inputs

| Input                | Default               | Description                                      |
| -------------------- | --------------------- | ------------------------------------------------ |
| `config`             | `.aur-maintainer.yml` | Repository configuration path                    |
| `github-token`       | empty                 | GitHub API token and PR authentication           |
| `update-branch`      | `update`              | Prefix for generated package branches            |
| `base-branch`        | `main`                | Branch receiving generated update PRs            |
| `auto-merge`         | `false`               | Wait for checks and squash-merge generated PRs   |
| `auto-merge-timeout` | `1800`                | Maximum auto-merge wait in seconds               |
| `aur-publish`        | `false`               | Publish changed packages to AUR                  |
| `aur-publish-only`   | `false`               | Publish current state without upstream detection |
| `aur-ssh-key`        | empty                 | SSH private key for AUR publishing               |
| `aur-known-hosts`    | empty                 | Known-hosts entry for `aur.archlinux.org`        |

`auto-merge-timeout` must be a positive integer. Both AUR publishing modes
require `aur-ssh-key` and `aur-known-hosts` when publishing is performed.

## Action outputs

- `packages`: JSON array of discovered packages and detected candidates.
- `pull-request`: URL of the first generated update PR.
- `pull-requests`: JSON array of generated update PR URLs.
- `validation-failure-issue`: validation-failure issue URL, when created.

## Update and PR lifecycle

Only one package update is processed per run. Packages are checked in
configuration order and processing stops after the first changed package.

With `update-branch: update`, package `example-bin` uses the branch
`update/example-bin`. The input is a branch prefix, not a complete branch name.

If an update PR already exists for the same package and base branch, it is
updated instead of duplicated. Its title and body are refreshed with the
current version transition.

Before a PR is created, package metadata is regenerated and validation runs.
If validation fails, the generated `PKGBUILD` and `.SRCINFO` are preserved on
the update branch. When `github-token` and `issues: write` are available, a
GitHub issue is created with the validation error.

## Auto-merge

With `auto-merge: true`, the Action waits for GitHub checks. When all reported
checks complete without a failing conclusion, the PR is squash-merged.

The default timeout is 1800 seconds (30 minutes). Failed checks, conflicts, or
a timeout fail the Action without merging the PR.

## AUR publishing

`aur-publish` publishes a package during maintenance.

`aur-publish-only` publishes the current package state without upstream
detection and is intended for a workflow that runs after an update PR merges.

Both modes require:

```yaml
aur-ssh-key: ${{ secrets.AUR_SSH_PRIVATE_KEY }}
aur-known-hosts: ${{ secrets.AUR_KNOWN_HOSTS }}
```

The publisher syncs package-root files such as `PKGBUILD` and `.SRCINFO` and
excludes the legacy `update.yml`.

## Permissions

Recommended maintenance permissions:

```yaml
permissions:
  contents: write
  issues: write
  pull-requests: write
```

`issues: write` is only required for validation-failure issues. AUR publishing
uses SSH credentials rather than GitHub permissions.

## Versioning

Consumers should use `soker90/aur-maintainer@v1`. Releases use semantic tags
such as `v1.0.9`; `v1` points to the latest compatible v1 release.
