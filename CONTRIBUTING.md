# Contributing

Thank you for helping make DEMOS node operation safer for beginners.

## Before opening a change

1. Read `SECURITY.md`, `AGENTS.md`, and the relevant decision records.
2. Open an issue for behavior changes unless the fix is small and unambiguous.
3. Never include credentials, private host addresses, node identities, mnemonics, operator state, or real backup artifacts.
4. Keep hosting and network instructions provider-neutral.
5. Do not patch the upstream DEMOS node in this repository. Propose upstream changes to its owning project.

## Pull-request gate

Run:

```bash
bun install --frozen-lockfile
bun run check
git diff --check
```

Security-boundary changes must also update the relevant tests, `SECURITY.md`, operator runbooks, and a decision record. Describe what was verified locally and what still requires a disposable Ubuntu host. A green local or CI run is not evidence of testnet membership.

## Vulnerabilities

Do not disclose vulnerabilities in a public issue. Follow the private reporting process in `SECURITY.md`.
