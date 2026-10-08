# AUR Maintainer


Automate maintenance of Arch Linux AUR packages from GitHub Actions.

AUR Maintainer discovers packages, detects upstream versions, updates PKGBUILD
files, regenerates .SRCINFO, validates packages, and creates focused GitHub pull
requests. It can optionally auto-merge validated updates and publish them to the
AUR.

> **Security:** validation executes PKGBUILD build logic and custom connectors
> are executable code. Do not expose AUR credentials to workflows that execute
> untrusted pull requests.

## Features

- Central or package-local configuration and automatic package discovery.
- Built-in github-release and github-tag connectors.
- Repository-local JavaScript connectors.
- Package-local shell connectors with configurable timeouts.
- Automatic pkgver updates plus optional source/SHA-256 templates.
- .SRCINFO regeneration and package validation.
- Arch Linux Docker fallback when packaging tools are unavailable.
- One focused update branch/PR per package update.
- Optional squash auto-merge with a configurable timeout.
- Validation-failure issues with the failed update preserved.
- Strict SSH host-key checking for AUR publishing.
- Publish-only mode.

## Requirements

Use a Linux runner, preferably ubuntu-latest. The repository must be checked out
before the action runs.

The action uses Node.js 24. Validation uses Arch packaging tools when available
and otherwise requires Docker.

## Quick start

```yaml
name: Maintain AUR

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

      - uses: soker90/aur-maintainer@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

For auto-merge:

```yaml
auto-merge: true
auto-merge-timeout: 1800
```

## Permissions

The caller workflow controls GITHUB_TOKEN permissions. Grant only what is
needed.

Typical PR maintenance:

```yaml
permissions:
  contents: write
  pull-requests: write
```

Add issues: write when you want validation-failure issues.

github-token is required for auto-merge. Without a token, detection and local
updates can still run, but no GitHub branch/PR is created.

## Inputs

### Inputs

- config: configuration path. Default: .aur-maintainer.yml.
- github-token: GitHub API and repository automation token.
- update-branch: prefix for generated update branches. Default: update.
- base-branch: PR base branch. Default: main.
- auto-merge: wait for checks and squash-merge. Default: false.
- auto-merge-timeout: maximum check wait in seconds. Default: 1800.
- aur-publish: publish an updated package after validation.
- aur-publish-only: publish the current package state without upstream
  detection.
- aur-ssh-key: private SSH key authorized for the AUR account.
- aur-known-hosts: trusted host-key data for aur.archlinux.org.


AUR SSH inputs are required when publishing is enabled.

## Outputs

### Outputs

- packages: JSON with inspected packages, candidates, and update results.
- pull-request: URL of the first generated PR.
- pull-requests: JSON array of generated PR URLs.
- validation-failure-issue: URL of the validation-failure issue.


## Configuration

### Central configuration

Create .aur-maintainer.yml:

```yaml
packages:
  - path: github-copilot-app-bin
    connector: github-release
    config:
      repository: github/copilot
    updates: {}

  - path: toolhive-studio-bin
    connector: github-release
    config:
      repository: stacklok/toolhive-studio
    updates: {}
```

Each entry supports path, connector, config, updates, and an optional timeout.

If packages is not configured, the action discovers the repository root when it
contains PKGBUILD and directories immediately below packages/.

### Package-local configuration

A discovered package can use update.yml:

```yaml
connector: github-release
config:
  repository: owner/project
updates: {}
```

For package-local custom connectors, connector/update.yml is also supported. Do
not define both files.

## Built-in connectors

### github-release

Selects the latest GitHub Release:

```yaml
connector: github-release
config:
  repository: owner/project
updates: {}
```

A leading v is removed from numeric tags such as v1.2.3.

### github-tag

Reads GitHub tags, filters them to Arch-compatible versions, and selects the
highest version using Arch package-version comparison:

```yaml
connector: github-tag
config:
  repository: owner/project
updates: {}
```

## Custom connectors

### Repository JavaScript connector

Create connectors/name/index.js:

```js
export default function createConnector(context) {
  return {
    name: 'name',
    async detect(pkg, config) {
      return {
        version: '1.2.3',
        source: 'https://example.com/example-1.2.3.tar.gz',
        sha256: '0123456789abcdef...'
      }
    }
  }
}
```

The returned name must match the directory name. The factory receives
context.fetch and the configured GitHub token, when available.

### Package shell connector

Use:

```yaml
connector: custom
timeout: 120
config:
  channel: stable
updates:
  source: 'source=("example-${version}.tar.gz::${source}")'
  sha256: 'sha256sums=("${sha256}")'
```

Create connector/detect.sh. It receives AUR_MAINTAINER_PACKAGE,
AUR_MAINTAINER_PACKAGE_PATH, and AUR_MAINTAINER_CONFIG_JSON.

It must print:

```text
version=1.2.3
source=https://example.com/example-1.2.3.tar.gz
sha256=0123456789abcdef...
```

All three fields are required. Default timeout: 30 seconds.

## PKGBUILD updates

pkgver is updated when a newer supported version is detected. Optional source
and sha256 fields are updated only when their templates are configured.

Templates support ${version}, ${source}, and ${sha256}.

The action uses targeted replacements rather than rewriting the whole PKGBUILD.

## Validation

After an update, AUR Maintainer:

1. runs updpkgsums;
2. regenerates .SRCINFO;
3. runs namcap on PKGBUILD;
4. runs makepkg --verifysource;
5. verifies .SRCINFO matches the generated metadata;
6. builds with makepkg -sf --noconfirm;
7. verifies every artifact from makepkg --packagelist;
8. runs namcap on every artifact;
9. installs artifacts with pacman -U --noconfirm.

If the Arch tools are unavailable, validation is repeated in an Arch Linux
Docker container.

On validation failure, the updated files are preserved and an issue is created
when GitHub authentication is available. The action then fails.

## Pull requests and update cadence

A valid update creates a package-specific branch using update-branch and a
focused PR.

For example, update-branch: update and package vega-cli-bin produce
update/vega-cli-bin.

Only the first package that produces an update is processed in one run. This
deliberately avoids multi-package PRs.

## Auto-merge

```yaml
auto-merge: true
auto-merge-timeout: 1800
```

The action waits for check runs on the generated PR head and squash-merges when
GitHub reports the PR as mergeable.

The timeout is a maximum polling window, not a mandatory delay. github-token is
required.

## Publishing to the AUR

```yaml
- uses: soker90/aur-maintainer@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    aur-publish: true
    aur-ssh-key: ${{ secrets.AUR_SSH_PRIVATE_KEY }}
    aur-known-hosts: ${{ secrets.AUR_KNOWN_HOSTS }}
```

Publishing happens after validation. SSH uses strict host-key checking and
pushes to the AUR master branch.

The AUR repository is synchronized with the managed package directory, including
removal of tracked files that no longer exist locally.

For publish-only synchronization:

```yaml
aur-publish-only: true
```

This skips upstream detection and takes precedence over aur-publish.

## Security

AUR Maintainer executes PKGBUILD build logic and optional custom connectors.
Treat them as trusted code.

Never expose AUR SSH keys or other write credentials to untrusted pull requests.
Avoid pull_request_target when it would check out and execute untrusted code.

Prefer this architecture:

```text
trusted scheduled/manual workflow
        |
        v
detect -> update -> validate -> PR
                              |
                              v
                         required CI
                              |
                              v
                            merge
                              |
                              v
                       trusted publish
                              |
                              v
                             AUR
```

Use least-privilege GITHUB_TOKEN permissions, a dedicated revocable AUR SSH key,
and ephemeral runners where possible.

## Troubleshooting

**No package discovered:** check config path, package paths, PKGBUILD files, and
custom connector layout.

**GitHub API error:** verify owner/name repository syntax, repository access,
token permissions, and rate limits. Real 403 responses are surfaced instead of
being retried anonymously.

**Validation cannot start:** ensure Arch tools or Docker are available.

**.SRCINFO mismatch:**

```bash
updpkgsums PKGBUILD
makepkg --printsrcinfo > .SRCINFO
```

**Auto-merge does not happen:** check auto-merge, github-token, token
permissions, required checks, mergeability, and timeout.

**AUR publishing fails:** verify the dedicated AUR SSH key, known-hosts, package
access, and master branch.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm run ci-test
npm run package
```

dist is generated code and is committed because GitHub executes the bundled
JavaScript when the action is consumed. CI verifies dist and runs the local
action against the freshly generated bundle.

## Release process

Releases use semantic tags such as v1.0.0 and the major tag v1.

The release workflow is manually triggered from main. It validates the requested
version, verifies the release commit, creates the release, moves v1, and
verifies the resulting tags.

Use:

```yaml
uses: soker90/aur-maintainer@v1
```

or pin a full commit SHA for an immutable reference.

## Contributing

When changing public behavior:

1. update TypeScript;
2. add or update tests;
3. regenerate dist;
4. update README.md and README_ES.md;
5. run CI;
6. keep the PR focused.

## License

MIT. See LICENSE.
