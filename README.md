# AUR Maintainer

**Automatically maintain and publish Arch Linux AUR packages with GitHub
Actions.**

AUR Maintainer detects upstream releases and tags, updates package metadata,
regenerates `.SRCINFO`, validates changes, and creates or updates
package-specific pull requests. It can optionally squash-merge updates and
publish packages directly to the Arch User Repository (AUR) over SSH.

- **Automated updates:** detect new upstream versions and prepare package
  changes.
- **Pull requests:** create or update one PR per package, with optional
  automatic merging.
- **AUR publishing:** publish changed packages or the current package state
  using SSH.
- **Extensible:** built-in GitHub and npm connectors, plus support for custom
  connectors.

## Quick start

Create `.github/workflows/aur-maintainer.yml` in your repository:

```yaml
name: AUR Maintainer

on:
  schedule:
    - cron: '17 */6 * * *'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  maintain:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Maintain AUR packages
        uses: soker90/aur-maintainer@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          base-branch: master
          update-branch: update
          auto-merge: false
```

This workflow checks for updates every six hours and can also be triggered
manually.

Configure your packages in `.aur-maintainer.yml`. If your repository uses a
different default branch, adjust `base-branch` accordingly.

For automatic PR creation, enable **Settings → Actions → General → Allow GitHub
Actions to create and approve pull requests** when using the repository's
default `GITHUB_TOKEN`. A dedicated token may be needed for your repository's
permission requirements.

See the [configuration reference](docs/CONFIGURATION.md) for all supported
options.

## Package configuration

Create `.aur-maintainer.yml` in the repository root:

```yaml
packages:
  - path: packages/example-bin
    connector: github-release
    config:
      repository: owner/project
    updates: {}
```

Each package entry supports:

| Field       | Description                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `path`      | Package directory relative to the repository root                                                     |
| `connector` | Connector used to detect new versions                                                                 |
| `config`    | Connector-specific settings                                                                           |
| `updates`   | Optional templates for updating version-derived, `source`, and `sha256` assignments in the `PKGBUILD` |
| `timeout`   | Timeout in seconds for package-local custom connectors; defaults to `30`                              |

The detected version updates `pkgver`. For compatibility, package-local
`update.yml` files are still supported, but new configurations should use the
repository-level `.aur-maintainer.yml`.

## Built-in connectors

- `github-release`: detects versions from GitHub Releases.
- `github-tag`: detects versions from GitHub Tags.
- `npm`: detects the latest npm registry dist-tag and calculates the tarball
  SHA-256.

For example, to track an npm package and update its tarball metadata:

```yaml
packages:
  - path: packages/example-node-module
    connector: npm
    config:
      package: example-node-module
    updates:
      source: 'source=("${source}")'
      sha256: '_sha256=${sha256}'
```

Use `updates.version` for additional assignments derived from the detected
version, such as `version: '_npmver=${version}'`. This mapping is applied even
when the connector returns no source or checksum.

For example, to track GitHub Releases:

```yaml
packages:
  - path: packages/example-bin
    connector: github-release
    config:
      repository: owner/project
```

## Custom connectors

Use a custom connector when the upstream project cannot be handled by a built-in
connector.

### Repository-level connectors

Create `connectors/<name>/index.js`. The module must default-export a factory
returning a connector with the same name as its directory.

The factory receives a context containing `fetch` and, when available, a GitHub
token.

### Package-level connectors

Set `connector: custom` and create `<package>/connector/detect.sh`.

The script runs from the package directory and receives:

- `AUR_MAINTAINER_PACKAGE`
- `AUR_MAINTAINER_PACKAGE_PATH`
- `AUR_MAINTAINER_CONFIG_JSON`

It must output non-empty `version`, `source`, and `sha256` fields as `key=value`
lines:

```text
version=1.2.3
source=https://example.com/example-1.2.3.tar.gz
sha256=0123456789abcdef...
```

The default timeout is 30 seconds. The `timeout` field must be a positive
integer.

## Pull requests and validation

AUR Maintainer processes **one package update per run**, following the order in
`.aur-maintainer.yml`.

With `update-branch: update`, a package named `example-bin` uses the branch
`update/example-bin`. The input is a branch prefix, not a complete branch name.

Existing update PRs for the same package and base branch are reused instead of
duplicated. Their titles and descriptions are refreshed with the current version
transition.

Before creating a PR, the Action regenerates package metadata and validates the
changes. If validation fails:

- No update PR is created.
- The generated `PKGBUILD` and `.SRCINFO` changes are preserved on the update
  branch.
- A GitHub issue is created with the validation error when the token has
  `issues: write` permission.

### Automatic merging

Set `auto-merge: true` to wait for GitHub checks and squash-merge the generated
PR.

`auto-merge-timeout` defaults to `1800` seconds (30 minutes) and must be a
positive integer. Failed checks, conflicts, or a timeout cause the Action to
fail without merging the PR.

## Publishing packages to the AUR

AUR publishing is optional and requires an AUR account and an SSH key authorized
for that account. It is separate from the GitHub token used for maintenance and
pull requests.

### 1. Generate an SSH key

Generate a dedicated key pair on your local machine:

```bash
ssh-keygen -t ed25519 -C "aur-publishing" -f ~/.ssh/aur
```

This creates:

- `~/.ssh/aur`: your private key.
- `~/.ssh/aur.pub`: your public key.

Sign in to [aur.archlinux.org](https://aur.archlinux.org/) and add the public
key to your account's SSH public keys.

### 2. Configure GitHub Secrets

In your repository, open **Settings → Secrets and variables → Actions → New
repository secret**.

Create the following repository secret:

| Secret                | Value                                 |
| --------------------- | ------------------------------------- |
| `AUR_SSH_PRIVATE_KEY` | The complete contents of `~/.ssh/aur` |

Never commit your private key to the repository.

### 3. Enable publishing

AUR Maintainer supports two publishing modes:

- `aur-publish: true`: publishes a changed package as part of maintenance.
- `aur-publish-only: true`: publishes the current package state without checking
  upstream for updates. This is useful after an update PR has been merged.

Both modes require the `aur-ssh-key` and `aur-known-hosts` inputs.

For example, publish the current package state after merging an update PR:

```yaml
- name: Resolve AUR known hosts
  id: known-hosts
  run: |
    {
      echo 'hosts<<EOF'
      ssh-keyscan -H aur.archlinux.org
      echo 'EOF'
    } >> "$GITHUB_OUTPUT"

- name: Publish packages to AUR
  uses: soker90/aur-maintainer@v1
  with:
    aur-publish-only: true
    aur-ssh-key: ${{ secrets.AUR_SSH_PRIVATE_KEY }}
    aur-known-hosts: ${{ steps.known-hosts.outputs.hosts }}
```

This follows the workflow structure used by
[aur-packages](https://github.com/soker90/aur-packages/blob/master/.github/workflows/aur-maintainer.yml).

The publisher synchronizes package-root files such as `PKGBUILD` and `.SRCINFO`
with the corresponding AUR repository and excludes the legacy `update.yml`.

**Security:** verify the SSH host key for `aur.archlinux.org` against a trusted
source before relying on it. `ssh-keyscan` retrieves a host key but does not
independently authenticate it.

## Inputs

| Input                | Default               | Description                                              |
| -------------------- | --------------------- | -------------------------------------------------------- |
| `config`             | `.aur-maintainer.yml` | Repository configuration path                            |
| `github-token`       | Empty                 | GitHub API and pull request authentication               |
| `update-branch`      | `update`              | Prefix for generated package branches                    |
| `base-branch`        | `main`                | Branch receiving update PRs                              |
| `auto-merge`         | `false`               | Wait for checks and squash-merge generated PRs           |
| `auto-merge-timeout` | `1800`                | Maximum auto-merge wait in seconds                       |
| `aur-publish`        | `false`               | Publish changed packages during maintenance              |
| `aur-publish-only`   | `false`               | Publish current package state without upstream detection |
| `aur-ssh-key`        | Empty                 | Private SSH key for AUR publishing                       |
| `aur-known-hosts`    | Empty                 | Known-hosts entry for `aur.archlinux.org`                |

## Outputs

- `packages`: JSON array of discovered packages and detected update candidates.
- `pull-request`: URL of the first generated update PR.
- `pull-requests`: JSON array containing generated update PR URLs.
- `validation-failure-issue`: URL of a validation-failure issue, when created.

## Permissions

For maintenance with PR creation:

```yaml
permissions:
  contents: write
  pull-requests: write
```

Add `issues: write` if you want the Action to create issues when package
validation fails:

```yaml
permissions:
  contents: write
  pull-requests: write
  issues: write
```

The repository must also allow GitHub Actions to create pull requests when using
`GITHUB_TOKEN`. A dedicated token can be used when the workflow needs different
permissions or behavior.

AUR publishing uses SSH credentials rather than GitHub permissions.

## Development

The Action uses Node.js 24.

```bash
npm install
npm test
npm run bundle
```

The generated `dist/` directory is committed because GitHub Actions executes the
bundled JavaScript.

## Versioning

Use the stable major tag in workflows:

```yaml
uses: soker90/aur-maintainer@v1
```

The `v1` tag is intended to track the latest compatible stable v1 release. For
reproducible pinning, use a specific release tag, such as `v1.10.2`.

## Documentation and examples

- [Configuration reference](docs/CONFIGURATION.md)
- [Example consumer repository](https://github.com/soker90/aur-packages)
- [Releases](https://github.com/soker90/aur-maintainer/releases)
- [GitHub Marketplace](https://github.com/marketplace/actions/aur-maintainer)
