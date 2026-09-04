---
task: "Build a beginner-safe Codex-assisted operator kit for DEMOS testnet nodes"
slug: demos-node-starter
project: DEMOS Node Starter
phase: climbing
progress: 21/28
started: 2026-09-04T00:00:00Z
updated: 2026-09-04T20:19:11Z
principal_stated_goal: "implement this plan."
---

## Problem

New DEMOS node runners currently receive a dense message containing infrastructure actions, broad credentials, stale configuration, and a destructive staking path. They need a safe, repeatable route from a new Codex workspace and an operator-controlled Ubuntu host to a verified testnet node without inheriting another operator's secrets or infrastructure authority.

## Vision

An operator with no Codex or node experience clones one small public repository, opens it in Codex, follows one command surface, and can always answer: which host is targeted, what will change, where secrets live, how identity is backed up, whether the service is running, and whether the public node is healthy.

## Out of Scope

- Host acquisition, shutdown, reboot, reinstall, billing, or provider-specific automation.
- Shared servers, multi-node fleet orchestration, or upstream node-source changes.
- Cross-operator network credentials, central bot tokens, or private fleet inventory.
- Windows-native automation; Windows operators use WSL.

## Principles

- Exact authority before effect.
- Secret values never cross Git, chat, argv, logs, or readback.
- Recovery precedes destructive state change.
- Live service and endpoint evidence precede readiness claims.
- Upstream source stays vanilla; the starter is an additive operator layer.

## Constraints

- Bun/TypeScript is the local CLI runtime; the remote bootstrap is Bash for Ubuntu 22.04/24.04.
- Install and update require an operator-approved full commit SHA reachable from `stabilisation`.
- Remote lifecycle is limited to `demos-node.service`.
- The upstream Docker-socket reaper service is not started.
- All local operator state and backups are gitignored.

## Goal

Deliver an experimental public GitHub alpha at `mj-deving/demos-node-starter` with a repo-local Codex skill and one `./demosctl` interface that configures dedicated SSH access, installs a DEMOS node safely, transfers operator-owned node or fleet secrets without disclosure, backs up and restores identity state, stakes with an explicit gate, and verifies service plus public endpoint health.

## Claims

- [x] ISC-1: A fresh clone installs dependencies and `bun run check` passes.
- [x] ISC-2: `init` validates a public `http://` or `https://` port-53550 URL and writes mode-0600 gitignored operator state.
- [ ] ISC-3: `prepare-key` creates a dedicated Ed25519 key before host provisioning; `init` accepts only that exact recorded keypair or creates a new one inline, without reading or printing private-key content.
- [ ] ISC-4: `doctor` validates local dependencies, state shape, SSH authentication, and remote platform without mutation.
- [x] ISC-5: Every remote mutation requires the exact command confirmation token; install and update bind confirmation to a full approved commit.
- [ ] ISC-6: `install` targets a supported operator-controlled Ubuntu host, verifies an exact upstream commit, and installs `demos-node.service`.
- [x] ISC-7: The installed service starts explicit Compose services and never starts the Docker-socket reaper.
- [x] ISC-8: `secrets setup` and `secrets configure` use hidden input and SSH stdin; a versioned remote-helper handshake rejects legacy behavior, and the current helper atomically commits a validated root-owned mode-0600 file, performs exact value-free post-write verification without secret argv, and rolls back on failure.
- [x] ISC-9: No secret fixture appears in Git, command arguments, CLI output, or committed files.
- [x] ISC-10: Password-manager-independent recovery persists two matching mode-0600 Age-key files outside the repository and qualifies the exact encrypted archive by digest, fresh-process decrypt with the second copy, isolated staging, and live/staged identity agreement.
- [x] ISC-11: `restore` requires a confirmed encrypted backup, verifies its staged public key before stopping only the node service, retains rollback until the copied live identity matches, and leaves the service stopped.
- [x] ISC-12: `stake` requires fresh recovery qualification, refuses while the service is active, and requires explicit confirmation.
- [x] ISC-13: `stop` and `start` control only `demos-node.service`; start does not claim readiness.
- [x] ISC-14: `update` refuses a dirty or divergent checkout, creates and qualifies a fresh backup, accepts only an approved descendant commit on the configured upstream branch, and restarts only after commit-bound confirmation.
- [x] ISC-15: `status` reports systemd, RPC root, `/info`, and `/publickey` independently; validates response semantics, connection URL, and identity agreement; and fails if required evidence is unavailable.
- [x] ISC-16: Anti: the repository contains no provider lifecycle command, cross-operator credential, private fleet inventory, volume-deletion command, force-reset command, or global skill install.
- [x] ISC-17: Secret operations document ownership, least privilege, storage, value-free audit, encrypted recovery, rotation, exposure response, and offboarding for every secret class.
- [x] ISC-18: The repository acts as an ongoing command center with a read order, security onboarding, decision ledger, system map, value-free operation receipts, maintenance cadence, and incident template.
- [ ] ISC-19: `prepare-key` supports provisioning-time SSH-key injection; `init` accepts either an independently verified SHA256 fingerprint or an explicit first-use trust value bound to the exact new hostname, records the selected route and observed Ed25519 fingerprint, and pins that key for every later SSH connection.
- [ ] ISC-20: Anti: first-use trust cannot be silent, cannot overwrite existing operator or host-key state, cannot place an identity inside operator state, cannot strand partial state after key-generation failure or an older interrupted initialization, cannot accept arbitrary or changed prepared identities or multiple distinct host keys, and cannot weaken later SSH host-key checking.
- [x] ISC-21: Reinstall authorization requires a fresh live recovery check, expires after two hours, binds the configured hostname, archive digest, and node identity, and is consumed by exactly one successful host-key re-trust.
- [x] ISC-22: Anti: no valuable action treats ciphertext existence, secret-store exit status, or a non-empty recovery key as proof; staking, update, and reinstall preparation fail closed unless the persisted second key decrypts and reproduces the live identity.
- [x] ISC-23: `onboard` is resumable from missing state and emits only the next safe command without requiring provider-console expertise or a password manager; funding guidance requires a fresh purpose-bound recovery check and unchanged live identity.
- [ ] ISC-24: A disposable Ubuntu canary completes preparation, installation, credential setup, recovery qualification, stake preparation, restore, and runtime verification without manual repair.
- [ ] ISC-25: Current network bootstrap, credential policy, and validator acceptance evidence are confirmed by the network maintainer.
- [x] ISC-26: Public documentation explains, without requiring source inspection, the purpose, present requirement, privilege/quota risk, and safe fleet-reuse policy for GitHub, Etherscan, and Helius credentials.
- [x] ISC-27: Initial secret setup and its value-free status gate require only the currently active Helius integration; GitHub and Etherscan remain explicitly feature-gated pending maintainer confirmation.
- [x] ISC-28: Anti: the starter never instructs a runner to place a classic GitHub token with `repo` scope on a node, reuse credentials across unrelated operators, or treat a rotatable provider API key as node-identity recovery material.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to |
|---|---|---|---|---|---|
| ISC-1 | bash | full repository gate | exit 0 | `bun run check && git diff --check` | literal |
| ISC-2 | bun-test | init validation and state permissions | all fixtures pass | `bun test` | literal |
| ISC-5 | bun-test | mutation confirmation gate | all mutations reject missing/wrong token | `bun test` | derived: authority |
| ISC-7 | bash | remote service excludes reaper | zero reaper service target | `rg 'up .*postgres.*node' scripts/remote-bootstrap.sh` | literal |
| ISC-8 | bash | secret transport shape | hidden read plus stdin; no argv value | `bash -n scripts/configure-secrets.sh && bun test` | literal |
| ISC-9 | bash | secret and history scan | zero findings | `rg` focused high-risk token assignments, excluding test fixtures and this specification | derived: secrecy |
| ISC-10 | bun-test | backup failure handling | empty artifacts rejected | `bun test` | literal |
| ISC-15 | bun-test | status evidence separation | service, health, info remain distinct | `bun test` | derived: evidence |
| ISC-16 | bash | forbidden-effect scan | zero commands | `rg 'down -v|reset --hard|instance.*(stop|delete)|shutdown|reboot' .` | literal |
| ISC-17 | bun-test | secret lifecycle coverage | every lifecycle and secret class present | `bun test` | derived: secret operations |
| ISC-18 | bun-test | command-center continuity surfaces | all required docs and private-state fields present | `bun test` | literal |
| ISC-19 | bun-test | explicit first-use and independently verified host-key routes | both routes pin one observed Ed25519 key and record provenance | `bun test` | derived: beginner-safe SSH onboarding |
| ISC-20 | bun-test | first-use misuse and changed-key rejection | every unsafe fixture rejects; generated SSH config remains strict | `bun test` | derived: SSH trust boundary |
| ISC-21 | bun-test | reinstall/re-trust authorization lifecycle | target-bound authorization is created, consumed once, and rejects replay | `bun test` | derived: recovery before trust change |
| ISC-22 | bun-test | persisted-key and archive tamper falsifiers | empty key, changed copy, and changed archive all fail before valuable mutation | `bun test` | derived: incident prevention |
| ISC-23 | bun-test | empty-state onboarding | fresh state emits preparation as the first safe action | `bun test` | literal |
| ISC-24 | live-canary | clean Ubuntu end-to-end run | all phases pass without undocumented repair | `demosctl` plus host evidence | derived: beginner usability |
| ISC-25 | maintainer | chain-aware acceptance | maintainer confirms current policy and node acceptance | authenticated maintainer channel | literal |
| ISC-26 | bun-test | credential policy documentation | all three credentials have purpose, requirement, fleet reuse, quota, rotation, and revocation guidance | `bun test` | derived: beginner operability |
| ISC-27 | bun-test | setup/status required-key contract | Helius is the only core API credential; GitHub and Etherscan report optional when absent | `bun test` | literal |
| ISC-28 | bash | broad-token and cross-operator sharing guard | zero setup instructions requiring classic `repo`; no cross-operator reuse | `rg` plus `bun test` | derived: least privilege |

## Features

### F1 · Safe local control plane
Why: The operator needs one understandable interface whose state and effects are inspectable before any remote action.

- ISC-1, ISC-2, ISC-3, ISC-4, ISC-5, ISC-15, ISC-19, ISC-20, ISC-21, ISC-23

### F2 · Bounded remote node lifecycle
Why: A prepared Ubuntu host becomes a recoverable node without giving the tool hosting-account or host-wide lifecycle authority.

- ISC-6, ISC-7, ISC-11, ISC-12, ISC-13, ISC-14, ISC-24, ISC-25

### F3 · Credential and identity protection
Why: Node participation must not depend on copying shared credentials or exposing recovery material to Codex.

- ISC-8, ISC-9, ISC-10, ISC-16, ISC-17, ISC-22, ISC-26, ISC-27, ISC-28

## Decisions

- 2026-09-04: Chose a separate private starter repository over edits to upstream or the private fleet repo, preserving both authority boundaries.
- 2026-09-04: Chose a repo-local skill over a plugin or global skill because the workflow depends on this repository's CLI and DEMOS-specific runtime contract.
- 2026-09-04: Kept host acquisition and networking provider-neutral; the node workflow begins from verified SSH access to a prepared Ubuntu host.
- 2026-09-04: Chose a root-owned, non-group-writable checkout and explicit Compose service selection to prevent host-user edits from reaching root-run Docker and to exclude the upstream reaper, whose Docker socket is root-equivalent.
- 2026-09-04: Chose interactive stdin secret transfer over checked-in templates, environment arguments, or model-mediated credential entry.
- 2026-09-04: Strengthened secret handling into a full lifecycle contract with value-free inspection, per-operator ownership, encrypted recovery, issuer-side revocation, and offboarding.
- 2026-09-04: Expanded the initial alpha from an installer into a durable operator command center with versioned decisions and gitignored per-node memory.
- 2026-09-04: Prepared the repository as an experimental public alpha and bound privileged supply-chain, first-contact SSH, and restore operations to explicit immutable evidence.
- 2026-09-04: refined: Added an explicit one-time trust route for a newly provisioned hostname because requiring beginners to operate a provider console made the safe path unusable; independent fingerprint verification remains the hardened route and every later connection stays strictly pinned.
- 2026-09-04: refined: Split SSH identity preparation from host enrollment so provider dashboards can inject the public key at provisioning time; initialization consumes only the exact tool-recorded keypair and commits host trust transactionally.
- 2026-09-04: refined: Made the public recovery path independent of password managers. Two persisted Age-key copies plus exact decryption and identity proof replace reliance on a storage command's exit status.
- 2026-09-04: refined: Bound post-reinstall SSH host-key replacement to a short-lived, single-use authorization created while the old live node and qualified recovery archive can still be compared.
- 2026-09-04: refined: Made credential policy documentation-authoritative for beginners: Helius is the current core feature credential, GitHub and Etherscan are feature-gated, and operator-owned fleet reuse is allowed only with explicit quota, restriction, rotation, and blast-radius controls.

## Log

- 2026-09-04: Design approved by the principal. Public-share preparation authorized; repository visibility remains a separate external action.
- 2026-09-04: Independent second look deferred until the implementation diff exists; no public or live-node effect occurs in this alpha build.
- 2026-09-04: Added security onboarding, operational read order, decision records, a generated local system map, and value-free operation receipts for continuity across operators and Codex sessions.
- 2026-09-04: Review hardened install idempotence, backup identity validation, rollback-preserving restore activation, root-owned Compose inputs, and endpoint semantic validation.
- 2026-09-04: Public-readiness security scan confirmed five findings; the candidate now requires exact upstream commits, pinned SSH host identity, a fresh SSH key, a digest-pinned networkless recovery helper, and staged restore public-key agreement.
- 2026-09-04: Principal feedback refuted console-only SSH onboarding; the implementation must make the first-use risk understandable without asking a beginner to retrieve provider-console key material.
- 2026-09-04: The Node 3 incident identified a systemic proof gap: encrypted archive existence and a nominal credential-store write were mistaken for durable decryptability. Recovery is now qualified mechanically and gates valuable actions.
- 2026-09-04: Credential-policy implementation aligned README, security onboarding, secret operations, setup prompts, value-free helper status, decision ledger, and tests. The status-helper protocol advanced to v3 so existing nodes cannot silently retain the former three-key gate.
- 2026-09-04: Full-tree Autoreview found three P2 recovery defects. The implementation now blocks reinstall authorization while a re-trust claim is unresolved, proves plaintext staging-volume removal after pipeline failure, and resets host-local onboarding progress after re-trust with an explicit identity-restore phase.

## Verification

- 2026-09-04: `bun run check` passed with 19 tests, 85 expectations, TypeScript typecheck, and Bash syntax checks.
- 2026-09-04: ShellCheck passed for the launcher and both remote/local shell scripts.
- 2026-09-04: Native `quick_validate.py` reported `Skill is valid!` for the repository-local skill.
- 2026-09-04: TruffleHog found no credential candidate outside ignored dependencies; focused high-risk token-pattern scan was clean.
- 2026-09-04: Upstream `origin/stabilisation` confirmed `demos_node_state` and the explicit Compose service/reaper boundaries used by the starter.
- 2026-09-04: Pre-commit independent review found five P1/P2 defects. All were accepted and repaired: root-owned Compose inputs, identity-aware backup validation, rollback-preserving restore activation, repeat-install rejection, and semantic endpoint/identity checks.
- 2026-09-04: A fresh clone of private commit `3a649f7` installed the frozen Bun dependencies, passed all 19 tests and 85 expectations, and resolved every tracked local Markdown link.
- 2026-09-04: SSH key generation, remote doctor, and full bootstrap remain deliberately unclaimed until the disposable Ubuntu canary.
- 2026-09-04: Focused recovery/security suite passed 46 tests and 287 expectations after adding two-copy recovery, tamper gates, atomic secret writes, resumable onboarding, one-time re-trust, and legacy-helper rejection.
- 2026-09-04: Fresh-context bypass review found five recovery/secret edge cases. All were accepted and repaired: funding now requires purpose-bound recovery plus unchanged live identity; legacy helpers fail a version handshake and have an explicit upgrade path; secret values never enter verification argv; rollback snapshots and restored rollback state require exact identity equality; reinstall authorization is atomically claimed and fails closed on concurrent/incomplete claims.
- 2026-09-04: Credential-policy gate passed 47 tests and 306 expectations, TypeScript checking, Bash syntax, `git diff --check`, local Markdown link resolution, and a focused high-risk secret-assignment scan. TruffleHog reported zero verified or unverified secrets; one ignored dependency binary could not be decoded and was covered by the focused text scan.
- 2026-09-04: Full-tree P0-P2 Autoreview reported three P2 findings; all three were validated and repaired with regression tests before delivery.
- 2026-09-04: Final release gate passed 49 tests and 322 expectations, TypeScript, Bash syntax, ShellCheck, isolated native skill validation, local Markdown-link resolution, focused secret-assignment scan, and `git diff --check`.

## Remaining Work

- [ ] Confirm active bootstrap peer, credential policy, and staking acceptance signal with the Kynesys maintainer before claiming testnet readiness.
- [ ] Run the public alpha against a disposable Ubuntu 24.04 canary before using it for valuable live identity material.
- [ ] Change repository visibility only as a deliberate repository-owner action after reviewing the final public tree.
