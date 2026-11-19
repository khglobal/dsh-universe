# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

- open this repository's **Security** tab and choose **Report a vulnerability** (GitHub private vulnerability
  reporting).

Include the version of DSH Universe (`@khglobal/dsh-universe`), the DSH version, and the steps to reproduce. We aim to
reply within five working days. Please give us a reasonable time to fix the problem before you disclose it.

## Supported versions

Only the latest published version of `@khglobal/dsh-universe` receives security fixes.

## Scope

DSH Universe runs inside DeepSeek Harness, reads session metadata on your own device and makes no network requests of
its own. Reports about data it should not read, data leaving the device, or anything that reaches a prompt are in
scope. Problems in DeepSeek Harness itself should go to the DSH project.
