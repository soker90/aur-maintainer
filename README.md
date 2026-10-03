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
│   ├── example-bin/          # generic connector
│   │   ├── PKGBUILD
│   │   ├── .SRCINFO
│   │   └── update.yml
│   └── custom-bin/           # package-local custom connector
│       ├── PKGBUILD
│       ├── .SRCINFO
│       └── connector/
│           ├── update.yml
│           └── detect.sh
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



For a package that needs custom detection logic, keep that logic inside the
package. In that case the package has no root `update.yml`: the only package
configuration is `connector/update.yml`, which selects the `custom` connector.

The custom connector is an executable shell script at
`connector/detect.sh`. It must print exactly these standard fields:

```text
version=...
source=...
sha256=...
```

The Action executes the script from the package directory and consumes its
standard update candidate. The script should use an official, reproducible
upstream source and fail rather than guessing when the upstream format changes.

The global configuration can restrict which package directories are managed:

```yaml
packages:
  - packages/example-bin
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
