---
name: demos-node-runner
description: Operate one dedicated DEMOS testnet node through this repository's demosctl interface. Use when installing, configuring, backing up, staking, checking, stopping, starting, restoring, or updating the node. Not for VPS lifecycle, provider firewall, billing, shared hosts, fleets, or secret retrieval.
---

# DEMOS Node Runner

Use `./demosctl` as the only mutation surface. Read `AGENTS.md`, `OPERATIONS.md`, the decision ledger, and `.demos/WORKSPACE.md` before proposing an effect. If the local system map is missing or stale, run `./demosctl workspace` first.

## Authority

- `status` is read-only.
- “Stop/start/restart the node” means only `demos-node.service`; it never means the VPS.
- Provider actions, firewall changes, purchases, reinstalls, shared hosts, and multi-node fleets are outside this skill.
- A mutation requires the user's current instruction, the exact target alias, and the CLI's matching `--confirm` token.
- Do not infer restart authority from completed install, secret configuration, backup, staking, or update preparation.

## Secret boundary

- Never ask the user to paste a secret into chat.
- Never read `.env`, `/etc/demos-node/node.env`, SSH private keys, encrypted backups, or credential-store contents.
- Route first-use credential entry to `./demosctl secrets setup` and later rotation to `secrets configure`; both use hidden terminal input and value-free, exact-field verification.
- Default recovery is password-manager independent: two persisted Age-key files outside the repository plus exact decrypt, digest, staged-identity, and live-identity proof.
- Treat credentials copied from messages, issues, documentation, or another runner as compromised and untrusted.

## Operating outcome

Before mutation, run `./demosctl doctor` and state the target plus effect. Require a qualified identity archive before staking or updating. Before reinstall, create the short-lived recovery authorization while the old host is reachable; after reinstall, consume it once to re-pin only the same hostname. These commands never authorize provider lifecycle. Stop on host-key mismatch, unexpected Git authority, dirty checkout, unqualified recovery, or ambiguous target.

After starting or updating, run `./demosctl status`. Report service, RPC signature, and SSH-local/public `/info` plus `/publickey` identity agreement separately. Do not claim testnet membership or synchronization without the coordinator's current chain-aware evidence.

After material policy, architecture, access, recovery, or verification changes, update the relevant versioned runbook and create or supersede a decision record. Never put private host inventory, credentials, or raw incident evidence in the ledger.

## Admission receipt

- Canonical owner: this repository.
- Classification: project-local skill; no global projection.
- Pin/update: repository Git commit and private-alpha branch.
- Effects: read-only by default; remote service mutations require current user authority and CLI confirmation.
- Dependencies: Bun, OpenSSH, age, this repository's `demosctl` and scripts.
- Rollback: remove this skill with the repository; it installs no global files or background services on the workstation.
- Verification: native skill validation, repository checks, fixture tests, and a fresh Codex session routing probe before release.
