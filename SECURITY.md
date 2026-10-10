# Security Policy

## Reporting a vulnerability

Please report undisclosed security vulnerabilities privately through GitHub's
private vulnerability reporting for this repository when available.

Do not open a public issue for an undisclosed vulnerability.

Include the affected version, reproduction steps, impact, and any suggested
mitigation.

## Security model

AUR Maintainer executes PKGBUILD files and custom connectors. Treat repository
package code as trusted executable code.

Use least-privilege GitHub token permissions, dedicated AUR SSH credentials, and
trusted workflows for publishing and auto-merge.
