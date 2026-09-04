---
task: "Build a beginner-safe Codex-assisted operator kit for DEMOS testnet nodes"
slug: demos-node-starter
project: DEMOS Node Starter
phase: climbing
progress: 15/18
started: 2026-09-04T00:00:00Z
updated: 2026-09-04T00:00:00Z
principal_stated_goal: "implement this plan."
---

## Problem

New DEMOS node runners currently receive a dense message containing infrastructure actions, broad credentials, stale configuration, and a destructive staking path. They need a safe, repeatable route from a new Codex workspace and a dedicated VPS to a verified testnet node without inheriting another operator's secrets or infrastructure authority.

## Vision

An operator with no Codex or node experience clones one small private repository, opens it in Codex, follows one command surface, and can always answer: which host is targeted, what will change, where secrets live, how identity is backed up, whether the service is running, and whether the public node is healthy.

## Out of Scope

- VPS purchase, shutdown, reboot, reinstall, billing, or Contabo API automation.
- Shared servers, multi-node fleet orchestration, public release, or upstream node-source changes.
- Shared network credentials, central bot tokens, or private fleet inventory.
- Windows-native automation; Windows operators use WSL.

## Principles

- Exact authority before effect.
- Secret values never cross Git, chat, argv, logs, or readback.
- Recovery precedes destructive state change.
- Live service and endpoint evidence precede readiness claims.
- Upstream source stays vanilla; the starter is an additive operator layer.

## Constraints

- Bun/TypeScript is the local CLI runtime; the remote bootstrap is Bash for Ubuntu 22.04/24.04.
- Upstream is pinned by installed commit while following the `stabilisation` branch through fast-forward-only updates.
- Remote lifecycle is limited to `demos-node.service`.
- The upstream Docker-socket reaper service is not started.
- All local operator state and backups are gitignored.

## Goal

Deliver a private GitHub alpha at `mj-deving/demos-node-starter` with a repo-local Codex skill and one `./demosctl` interface that configures dedicated SSH access, installs a DEMOS node safely, transfers individually owned secrets without disclosure, backs up and restores identity state, stakes with an explicit gate, and verifies service plus public endpoint health.

## Claims

- [x] ISC-1: A fresh clone installs dependencies and `bun run check` passes.
- [x] ISC-2: `init` validates a public `http://` or `https://` port-53550 URL and writes mode-0600 gitignored operator state.
- [ ] ISC-3: `init` creates a dedicated Ed25519 key and SSH config without reading or printing private-key content.
- [ ] ISC-4: `doctor` validates local dependencies, state shape, SSH authentication, and remote platform without mutation.
- [x] ISC-5: Every remote mutation requires the exact command confirmation token.
- [ ] ISC-6: `install` targets only a dedicated Ubuntu VPS, creates a non-sudo `demos` user, fast-forward clones upstream `stabilisation`, and installs `demos-node.service`.
- [x] ISC-7: The installed service starts explicit Compose services and never starts the Docker-socket reaper.
- [x] ISC-8: `secrets configure` uses hidden input and SSH stdin, writes a root-owned mode-0600 file, and returns names/set-state only.
- [x] ISC-9: No secret fixture appears in Git, command arguments, CLI output, or committed files.
- [x] ISC-10: `backup` produces a local passphrase-encrypted archive of node state and rejects an empty artifact.
- [x] ISC-11: `restore` requires a confirmed encrypted backup, stops only the node service, restores state, and leaves the service stopped.
- [x] ISC-12: `stake` refuses while the service is active and requires explicit confirmation.
- [x] ISC-13: `stop` and `start` control only `demos-node.service`; start does not claim readiness.
- [x] ISC-14: `update` refuses a dirty or divergent checkout, requires a backup, fast-forwards only, and restarts only after explicit confirmation.
- [x] ISC-15: `status` reports systemd, RPC root, `/info`, and `/publickey` independently; validates response semantics, connection URL, and identity agreement; and fails if required evidence is unavailable.
- [x] ISC-16: Anti: the repository contains no provider lifecycle command, shared credential, private fleet inventory, volume-deletion command, force-reset command, or global skill install.
- [x] ISC-17: Secret operations document ownership, least privilege, storage, value-free audit, encrypted recovery, rotation, exposure response, and offboarding for every secret class.
- [x] ISC-18: The repository acts as an ongoing command center with a read order, security onboarding, decision ledger, system map, value-free operation receipts, maintenance cadence, and incident template.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to |
|---|---|---|---|---|---|
| ISC-1 | bash | full repository gate | exit 0 | `bun run check && git diff --check` | literal |
| ISC-2 | bun-test | init validation and state permissions | all fixtures pass | `bun test` | literal |
| ISC-5 | bun-test | mutation confirmation gate | all mutations reject missing/wrong token | `bun test` | derived: authority |
| ISC-7 | bash | remote service excludes reaper | zero reaper service target | `rg 'up .*postgres.*node' scripts/remote-bootstrap.sh` | literal |
| ISC-8 | bash | secret transport shape | hidden read plus stdin; no argv value | `bash -n scripts/configure-secrets.sh && bun test` | literal |
| ISC-9 | bash | secret and history scan | zero findings | `git grep -nE 'gh[pousr]_|sk-[A-Za-z0-9]|DISCORD_BOT_TOKEN=.+|API_KEY=.+' -- . ':!SECURITY.md'` | derived: secrecy |
| ISC-10 | bun-test | backup failure handling | empty artifacts rejected | `bun test` | literal |
| ISC-15 | bun-test | status evidence separation | service, health, info remain distinct | `bun test` | derived: evidence |
| ISC-16 | bash | forbidden-effect scan | zero commands | `rg 'down -v|reset --hard|instance.*(stop|delete)|shutdown|reboot' .` | literal |
| ISC-17 | bun-test | secret lifecycle coverage | every lifecycle and secret class present | `bun test` | derived: secret operations |
| ISC-18 | bun-test | command-center continuity surfaces | all required docs and private-state fields present | `bun test` | literal |

## Features

### F1 · Safe local control plane
Why: The operator needs one understandable interface whose state and effects are inspectable before any remote action.

- ISC-1, ISC-2, ISC-3, ISC-4, ISC-5, ISC-15

### F2 · Bounded remote node lifecycle
Why: A new VPS becomes a recoverable node without giving the tool provider-level or host-wide authority.

- ISC-6, ISC-7, ISC-11, ISC-12, ISC-13, ISC-14

### F3 · Credential and identity protection
Why: Node participation must not depend on copying shared credentials or exposing recovery material to Codex.

- ISC-8, ISC-9, ISC-10, ISC-16, ISC-17

## Decisions

- 2026-09-04: Chose a separate private starter repository over edits to upstream or the private fleet repo, preserving both authority boundaries.
- 2026-09-04: Chose a repo-local skill over a plugin or global skill because the workflow depends on this repository's CLI and DEMOS-specific runtime contract.
- 2026-09-04: Deferred Contabo API automation; SSH access is sufficient for v1 and avoids provider lifecycle authority.
- 2026-09-04: Chose a root-owned, non-group-writable checkout and explicit Compose service selection to prevent host-user edits from reaching root-run Docker and to exclude the upstream reaper, whose Docker socket is root-equivalent.
- 2026-09-04: Chose interactive stdin secret transfer over checked-in templates, environment arguments, or model-mediated credential entry.
- 2026-09-04: Strengthened secret handling into a full lifecycle contract with value-free inspection, per-operator ownership, encrypted recovery, issuer-side revocation, and offboarding.
- 2026-09-04: Expanded the private alpha from an installer into a durable operator command center with versioned decisions and gitignored per-node memory.

## Log

- 2026-09-04: Design approved by the principal. Private repository creation authorized; public release remains separately gated.
- 2026-09-04: Independent second look deferred until the implementation diff exists; no public or live-node effect occurs in this alpha build.
- 2026-09-04: Added security onboarding, operational read order, decision records, a generated local system map, and value-free operation receipts for continuity across operators and Codex sessions.
- 2026-09-04: Review hardened install idempotence, backup identity validation, rollback-preserving restore activation, root-owned Compose inputs, and endpoint semantic validation.

## Verification

- 2026-09-04: `bun run check` passed with 19 tests, 85 expectations, TypeScript typecheck, and Bash syntax checks.
- 2026-09-04: ShellCheck passed for the launcher and both remote/local shell scripts.
- 2026-09-04: Native `quick_validate.py` reported `Skill is valid!` for the repository-local skill.
- 2026-09-04: TruffleHog found no credential candidate outside ignored dependencies; focused high-risk token-pattern scan was clean.
- 2026-09-04: Upstream `origin/stabilisation` confirmed `demos_node_state` and the explicit Compose service/reaper boundaries used by the starter.
- 2026-09-04: Pre-commit independent review found five P1/P2 defects. All were accepted and repaired: root-owned Compose inputs, identity-aware backup validation, rollback-preserving restore activation, repeat-install rejection, and semantic endpoint/identity checks.
- 2026-09-04: SSH key generation, remote doctor, and full bootstrap remain deliberately unclaimed until the disposable Ubuntu canary.

## Remaining Work

- [ ] Confirm active bootstrap peer, credential policy, and staking acceptance signal with the Kynesys maintainer before public release.
- [ ] Run the private alpha against a disposable Ubuntu 24.04 canary after local fixture verification.
- [ ] Obtain explicit approval before changing repository visibility or publishing an upstream issue/PR.
