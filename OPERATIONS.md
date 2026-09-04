# Operator Command Center

This repository is the durable control surface for one DEMOS node. Start every new Codex task here; do not operate the node from copied chat instructions or an untracked shell history.

## Start every session

1. Read `AGENTS.md`, this file, `docs/security-onboarding.md`, and `docs/decisions/README.md`.
2. Run `git status --short` and inspect unexpected workspace changes.
3. Run `./demosctl workspace`, then read `.demos/WORKSPACE.md` to confirm the exact target and canonical locations.
4. Run `./demosctl doctor` before a mutation and `./demosctl status` before making a runtime claim.
5. Name the target, effect, rollback, and verification before running a confirmed command.

## Sources of truth

| Question | Canonical source |
|---|---|
| What host does this workspace target? | `.demos/operator.json` and generated `.demos/WORKSPACE.md` |
| Which node code is installed? | `/opt/demos-node` exact detached Git commit and verified upstream remote on the node host |
| How is the process controlled? | `demos-node.service` |
| Where are secret values stored? | `/etc/demos-node/node.env`, root-owned mode `0600`; never read it back |
| Where is node identity stored? | Docker volume `demos_node_state` |
| Where are recovery-key locations recorded? | `.demos/recovery.json` (paths and recipient only; keys remain outside the repository) |
| What backup was mechanically qualified? | `.demos/recovery-receipt.json` (digest, identity, path, and time; no secret values) |
| What has this CLI changed? | `.demos/operations.jsonl`, a value-free local receipt log |
| Why was an operating policy chosen? | `docs/decisions/` |
| What may Codex do? | `AGENTS.md` and `.agents/skills/demos-node-runner/SKILL.md` |

`.demos/` is deliberately untracked because it contains host inventory. Back up its non-secret metadata with the workstation, but never commit or share it in a public issue.

## Routine cadence

- Each session: workspace refresh, doctor before mutation, status after runtime work.
- Before update: a freshly qualified encrypted identity backup, exact target confirmation, and review of the full approved upstream commit.
- Before funding: `recovery check --for stake` plus a live public-key comparison; never fund from receipt-file existence alone.
- Before restore: encrypted identity backup, exact target confirmation, and a separately recorded expected node public key.
- Monthly: operating-system security updates in a separately authorized maintenance window; inspect disk space and backup recency.
- Quarterly: perform the checklist in `docs/secret-operations.md` and review decisions for drift.
- Quarterly: rerun a recovery check using the persisted second key copy and inspect that the two key copies remain in separate failure domains.

## Change procedure

1. Record durable policy or architecture choices in a new decision record copied from `docs/decisions/0000-template.md`.
2. Update this repository before teaching operators a changed command.
3. Run `bun run check` and inspect the diff.
4. For remote work, use only `./demosctl` and the exact confirmation token.
5. Run `./demosctl status`; require identity agreement across `/info` and `/publickey`, and record no secret, token, mnemonic, or raw environment in evidence.

## Incident entry point

For credential exposure, use `docs/secret-operations.md`. For a runtime incident, stop making changes, preserve logs and state, and copy `docs/templates/incident-record.md` to a private incident location. Record facts, timestamps, actor, exact target, and recovery evidence—never secret values.
