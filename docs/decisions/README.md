# Decision Ledger

This directory records durable security, architecture, and operating decisions so a new operator or Codex session can understand why the command center behaves as it does.

Create a numbered record from `0000-template.md` when a choice changes authority, secret handling, recovery, runtime architecture, update policy, exposure, or verification. Do not use this ledger for daily task tracking or secret-bearing incident evidence.

Current decisions:

- `0001-command-center-and-secret-boundaries.md` — repository ownership, local/private state, and secret boundaries.
- `0002-bounded-node-lifecycle.md` — service-only lifecycle, upstream policy, and excluded Docker reaper.
- `0003-public-alpha-security-gates.md` — immutable update, SSH trust, helper-image, and restore-identity gates for public distribution.
- `0004-beginner-first-use-host-trust.md` — bounded first-use SSH trust for freshly provisioned hosts, with strict permanent pinning.
- `0005-qualified-recovery-without-password-manager.md` — two-copy Age recovery, mechanical qualification, operation gates, and atomic value-free secret writes.
- `0006-provider-credential-purpose-and-fleet-scope.md` — provider-key purpose, current requirement, least privilege, and controlled reuse within one operator-owned fleet.
