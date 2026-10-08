# AUR Maintainer

A GitHub Action for automating the maintenance of Arch Linux AUR packages.

> **Status:** early development. The public API and configuration format are not
> stable yet.

## Planned capabilities

- Detect new upstream versions through reusable connectors.
- Support GitHub releases and GitHub version tags.
- Support repository-local and package-local custom connectors.
- Update `PKGBUILD` and regenerate `.SRCINFO`.
- Validate packages with Arch Linux tooling.
- Create and maintain update pull requests.
- Report package validation failures as GitHub issues with the failed update
  preserved on a branch.
- Optionally enable GitHub auto-merge after validation.
- Publish maintained packages to the Arch User Repository (AUR).

## Repository structure

The intended user-facing model is deliberately small:

```text
repository/
├── .aur-maintainer.yml       # optional global configuration
├── packages/                 # optional; packages may also live at root
│   └── example-bin/
│       ├── PKGBUILD
│       ├── .SRCINFO
│       └── update.yml
└── connectors/               # optional repository-local connectors
    └── example/
```

Package configuration can be declared directly in the repository-level
`.aur-maintainer.yml`. This is the preferred format:

```yaml
packages:
  - path: packages/example-bin
    connector: github-tag
    config:
      repository: owner/project
    updates: {}
```

For repositories that publish versions as Git tags without GitHub Releases, use
the `github-tag` connector. The `packages` list may also contain plain path
strings when a package still uses the legacy package-local `update.yml` format:

```yaml
packages:
  - packages/example-bin
```

The Action keeps that legacy discovery path for migration, but new
configurations should use inline package entries so all maintenance settings
live in one repository-level file.

The optional `updates` mapping controls which connector fields are written to
the PKGBUILD. The `version` field always updates `pkgver`; source and
checksum mappings are explicit because package layouts differ:

```yaml
packages:
  - path: packages/example-bin
    connector: github-release
    config:
      repository: owner/project
    updates:
      source: 'source=("example-${version}.tar.gz::${source}")'
      sha256: '_sha256=${sha256}'
```

Repository-local custom connectors live under `connectors/`. Each connector uses
a directory named after the connector and an ESM module at
`connectors/<name>/index.js`:

```text
connectors/
└── example/
    └── index.js
```

The module must default-export a factory that receives the same connector
context as the built-in connectors and returns a connector with a matching
`name`:

```js
export default (context) => ({
  name: 'example',
  detect: async (pkg, config) => {
    const response = await context.fetch(config.url)
    const data = await response.json()

    return { version: data.version }
  }
})
```

The package selects it from its repository-level `.aur-maintainer.yml` entry:

```yaml
packages:
  - path: packages/example-bin
    connector: example
    config:
      url: https://example.com/releases/latest.json
    updates: {}
```

Repository-local connectors are loaded only from the repository's
`connectors/<name>/index.js` directories. A local connector cannot replace a
built-in connector with the same name, and its returned connector name must
match the directory name. Generic connectors continue to be provided by this
Action.

Package-local custom connectors run `connector/detect.sh` with the package
directory as the working directory. The Action exposes the package name and path
through `AUR_MAINTAINER_PACKAGE` and `AUR_MAINTAINER_PACKAGE_PATH`. The
package's `config:` object is passed as JSON in `AUR_MAINTAINER_CONFIG_JSON`, so
the detector can use package-specific settings without parsing repository
configuration itself:

```yaml
connector: custom
config:
  channel: stable
  region: eu
```

The detector receives the JSON configuration in `AUR_MAINTAINER_CONFIG_JSON`,
for example:

```text
AUR_MAINTAINER_CONFIG_JSON='{"channel":"stable","region":"eu"}'
```

It must still emit the standard `version`, `source`, and `sha256` fields.

A package can optionally map connector metadata to PKGBUILD assignments with the
`updates` section. The `version` field always updates `pkgver`; source and
checksum fields are opt-in because package layouts differ:

```yaml
connector: custom
config: {}
timeout: 60 # override the 30-second default
updates:
  source: 'source=("vega-${version}.tar.gz::${source}")'
  sha256: '_sha256=${sha256}'
```

Package-local connectors have a 30-second execution timeout by default. Override
it with `timeout`, expressed in seconds. It must be a positive integer. When the
timeout is reached, the Action reports the affected package.

Each mapping is a complete PKGBUILD assignment template. The supported
placeholders are `${version}`, `${source}`, and `${sha256}`. This keeps
package-specific source naming explicit instead of making the Action infer
PKGBUILD structure.

## Usage

The intended interface is a single Action:

```yaml
permissions:
  contents: write
  issues: write
  pull-requests: write

steps:
  - uses: soker90/aur-maintainer@v1
    with:
      github-token: ${{ secrets.GITHUB_TOKEN }}
      auto-merge: true
      aur-publish: true
      aur-publish-only: true
      aur-ssh-key: ${{ secrets.AUR_SSH_PRIVATE_KEY }}
      aur-known-hosts: ${{ secrets.AUR_KNOWN_HOSTS }}
```

When `github-token` is provided, the Action commits validated package updates to
a package-specific branch and opens an update pull request against
`base-branch`. The `update-branch` input is the **branch prefix**, not the
complete branch name. For example, `update-branch: update` creates
`update/example-bin`.

If package validation fails, no pull request is created. Instead, the generated
`PKGBUILD` and `.SRCINFO` are preserved on the package branch and the Action
creates a GitHub issue containing the validation error and a link to that
branch. Creating these issues requires the `issues: write` permission for the
provided token.

Only one package update is processed per Action run. The first package that
needs an update is committed and its pull request is created or updated;
processing stops after that package. This is equivalent to Renovate's former
`prConcurrentLimit: 1` behavior and keeps subsequent package updates for later
runs after the current pull request has been merged.

Without a token, package updates are still applied to the workspace but no pull
request is created.

When `aur-publish` is enabled, the Action publishes the managed package files to
the AUR `master` branch using the supplied SSH key and known-hosts entry. This
mode is intended for a workflow triggered after the source repository has been
merged. Use `aur-publish-only` for that workflow so the Action does not re-run
upstream detection or modify package files before publishing. The publisher
excludes `update.yml` and includes `PKGBUILD`, `.SRCINFO`, and other package
files at the package root.

Configuration and the final set of inputs will be documented once the first
stable implementation is in place.

## Development

This repository was bootstrapped from GitHub's
[TypeScript Action template](https://github.com/actions/typescript-action).

Install dependencies and run the test suite with:

```bash
npm install
npm test
```

The distributable bundle is generated with:

```bash
npm run bundle
```

The generated `dist/` directory is committed because GitHub runs JavaScript
Actions directly from the checked-in bundle.


