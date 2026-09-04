# Decision Ledger

This directory records durable security, architecture, and operating decisions so a new operator or Codex session can understand why the command center behaves as it does.

Create a numbered record from `0000-template.md` when a choice changes authority, secret handling, recovery, runtime architecture, update policy, exposure, or verification. Do not use this ledger for daily task tracking or secret-bearing incident evidence.

Current decisions:

- `0001-command-center-and-secret-boundaries.md` — repository ownership, local/private state, and secret boundaries.
- `0002-bounded-node-lifecycle.md` — service-only lifecycle, upstream policy, and excluded Docker reaper.
