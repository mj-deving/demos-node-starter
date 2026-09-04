# 0005: Qualified recovery without a password-manager dependency

- Status: accepted
- Date: 2026-09-04

## Context

Node identity is irreplaceable secret material. An encrypted file existing somewhere, or a secret-storage command returning exit code zero, does not prove that the corresponding decryption key was durably persisted or that the archive contains the intended identity. New operators also cannot be required to buy, configure, or understand a particular password manager before they can protect a node.

## Decision

- The default workflow uses an Age X25519 identity stored as two distinct mode-`0600` regular files outside the repository and `.demos/`. The operator chooses the second path and is instructed to use a separate failure domain.
- Backup qualification encrypts the live state, hashes the exact ciphertext, decrypts it in a fresh process with the persisted second key copy, stages it in an isolated remote volume, and compares its derived DEMOS public key with the running node.
- Only successful end-to-end proof creates a value-free recovery receipt. Staking and updates re-run the proof and fail closed without it.
- An OS reinstall requires a fresh recovery check while the old node is reachable. That check creates a two-hour authorization bound to the configured hostname, archive digest, and expected identity. Re-pinning the replacement SSH host key consumes it once.
- Funding guidance requires a purpose-bound recovery check plus an unchanged live identity; receipt-file existence is insufficient.
- Reinstall authorization is atomically renamed to a claimed state before SSH trust changes. Concurrent use is rejected, and an incomplete claim stops automatic retry for investigation.
- Secret-file writes require versioned remote-helper handshakes and use a same-directory candidate, atomic rename, exact structural and intended-field readback without secret-bearing process arguments, and rollback without returning values.
- Password managers are optional additional storage controlled by the operator. The command center has no password-manager integration or dependency.

## Consequences

Operators must safeguard two recovery-key copies; loss of both makes an encrypted archive unusable. The CLI can verify distinct paths and key equality, but it cannot prove that the operator actually selected a different physical failure domain. Reinstall preparation requires the old node to remain available long enough for live identity comparison. These constraints are shown explicitly instead of being hidden behind a green command exit.
