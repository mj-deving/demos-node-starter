# 0002: Bounded node lifecycle

- Status: accepted
- Date: 2026-09-04
- Owner: DEMOS node operator

## Context

A node-service request must not accidentally authorize a VPS reboot, deletion, provider API action, or a container with root-equivalent Docker-socket access.

## Decision

All lifecycle commands target only `demos-node.service`. The checkout and every root-consumed Compose/build input remain root-owned and non-group-writable. Source comes from the verified upstream repository on `stabilisation`; repeat install is rejected, while updates require a clean checkout, validated encrypted identity backup, and fast-forward merge. The service selects required Compose services explicitly and excludes the upstream reaper.

## Consequences

Provider firewall and VPS lifecycle remain manual, separately authorized operations. Runtime reachability requires systemd plus semantically valid RPC root, `/info`, and `/publickey` responses with identity and URL agreement; successful command exit is insufficient.

## Evidence

`scripts/remote-bootstrap.sh`, `src/demosctl.ts`, and `tests/security-boundaries.test.ts`.
