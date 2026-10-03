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
- Optionally enable automatic merging after validation.
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

A package declares how its upstream is discovered in `update.yml`:

```yaml
connector: github-tag
config:
  repository: stacklok/toolhive-studio
```

For repositories that publish versions as Git tags without GitHub Releases, use
the `github-tag` connector:

```yaml
connector: github-tag
config:
  repository: owner/project
```

The global configuration can restrict which package directories are managed:

```yaml
packages:
  - packages/example-bin
```

Package-specific connectors use a `connector/` directory. Its configuration
replaces the package-root `update.yml` and the detector must be named
`detect.sh`:

```text
packages/example-bin/
├── PKGBUILD
├── .SRCINFO
└── connector/
    ├── update.yml
    └── detect.sh
```

The detector is executed with the package directory as its working directory.
It receives `AUR_MAINTAINER_PACKAGE` and `AUR_MAINTAINER_PACKAGE_PATH` in its
environment and must write exactly one non-empty value for each of these
fields to standard output:

```text
version=1.2.3
source=https://example.com/archive.tar.gz
sha256=0123456789abcdef...
```

Unknown fields, duplicate fields, malformed lines, empty values, or missing
fields are rejected. The three values form the package-local connector
contract; `update.yml` controls how source and checksum values are applied to
the package's PKGBUILD. A package must not define both `update.yml` and
`connector/update.yml`.

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

The package selects it normally from `update.yml`:

```yaml
connector: example
config:
  url: https://example.com/releases/latest.json
```

Repository-local connectors are loaded only from the repository's
`connectors/<name>/index.js` directories. A local connector cannot replace a
built-in connector with the same name, and its returned connector name must
match the directory name. Generic connectors continue to be provided by this
Action.

A package can optionally map connector metadata to PKGBUILD assignments with the
`updates` section. The `version` field always updates `pkgver`; source and
checksum fields are opt-in because package layouts differ:

```yaml
connector: custom
config: {}
updates:
  source: 'source=("vega-${version}.tar.gz::${source}")'
  sha256: '_sha256=${sha256}'
```

Each mapping is a complete PKGBUILD assignment template. The supported
placeholders are `${version}`, `${source}`, and `${sha256}`. This keeps
package-specific source naming explicit instead of making the Action infer
PKGBUILD structure.

## Usage

The intended interface is a single Action:

```yaml
permissions:
  contents: write
  pull-requests: write

steps:
  - uses: soker90/aur-maintainer@v1
    with:
      github-token: ${{ secrets.GITHUB_TOKEN }}
```

When `github-token` is provided, the Action commits validated package updates to
`update-branch` and opens an update pull request against `base-branch`. Without
a token, package updates are still applied to the workspace but no pull request
is created.

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
