# Security Policy

## Supported versions

Security fixes are applied to the current major release.

## Reporting a vulnerability

Please do not open a public GitHub issue for an undisclosed security
vulnerability.

Use GitHub's private vulnerability reporting for this repository when available.
If private reporting is unavailable, contact the repository owner through a
private GitHub channel before disclosing the issue publicly.

Please include:

- a description of the vulnerability;
- affected versions;
- reproduction steps;
- impact and required privileges;
- any suggested mitigation.

## Security model

AUR Maintainer intentionally executes Arch package build logic and custom
connectors. A PKGBUILD, package-local connector, or repository-local connector
must therefore be treated as trusted code.

Users should:

- avoid running privileged publishing workflows on untrusted pull requests;
- keep AUR SSH keys dedicated and revocable;
- use least-privilege GITHUB_TOKEN permissions;
- prefer ephemeral runners for package builds;
- separate detection/update workflows from credentialed AUR publishing when
  possible.
