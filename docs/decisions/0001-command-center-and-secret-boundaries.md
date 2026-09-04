# 0001: Repository command center and secret boundaries

- Status: accepted
- Date: 2026-09-04
- Owner: DEMOS node operator

## Context

Beginner operators need durable memory across Codex sessions without placing host inventory or credentials in a repository intended for later redistribution.

## Decision

The repository is the versioned command center. Policy, procedures, tests, and decisions are tracked. Per-node identifiers and value-free operation receipts live under gitignored mode-`0600` `.demos/`. Secret values live only at their issuer, the operator's approved recovery store, or root-owned `/etc/demos-node/node.env`; Codex and Git never read them.

## Consequences

`./demosctl workspace` regenerates the local system map and `./demosctl history` shows successful CLI mutations. Operators must back up workstation state separately and must not paste `.demos/` into issues. A new machine is recovered from the repository, operator-owned SSH material, encrypted identity backup, and issuer-side token recreation.

## Evidence

`tests/demosctl.test.ts`, `tests/security-boundaries.test.ts`, `OPERATIONS.md`, and `docs/secret-operations.md`.
