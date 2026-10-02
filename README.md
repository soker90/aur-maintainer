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

The global configuration can restrict which package directories are managed:

```yaml
packages:
  - packages/example-bin
```

Package-specific custom connectors can live alongside the package in a
`connector/` directory. Generic connectors will be provided by this Action.

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
