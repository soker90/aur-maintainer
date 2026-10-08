# Contributing

## Development

Requirements:

- Node.js 24
- npm
- Linux is recommended for integration tests

Install dependencies:

~~~bash
npm ci
~~~

Run the local checks:

~~~bash
npm run format:check
npm run lint
npm run ci-test
npm run package
~~~

The generated dist directory is committed because GitHub executes the bundled JavaScript when the Action is consumed.

## Pull requests

Keep changes focused. For behavior changes:

1. update the TypeScript source;
2. add or update tests;
3. regenerate dist;
4. update README.md and README_ES.md;
5. run CI;
6. describe security or permission changes in the PR.

Do not merge until CI and CodeQL are green.

## Release process

Releases use semantic versions such as v1.0.0. The release workflow creates the versioned release and moves the major v1 tag.

The initial Marketplace release is v1.0.0. Breaking public changes require a new major version.
