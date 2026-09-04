# 0003: Public alpha security gates

- Status: superseded in part by [0004](0004-beginner-first-use-host-trust.md)
- Date: 2026-09-04

## Context

Public sharing brings beginner operators and untrusted supply-chain changes into a workflow that controls root-associated Docker and node identity material. Branch names, first-contact SSH prompts, mutable helper tags, and structurally valid backups are not sufficient authorization.

## Decision

- Every install and update is bound to an operator-reviewed full upstream commit SHA.
- First SSH use requires an OpenSSH SHA256 host-key fingerprint obtained through an authenticated channel independent of SSH.
- `prepare-key` creates a new SSH key before host provisioning; initialization accepts only its exact private/public fingerprints and marker, and refuses silent key or operator-state reuse.
- The identity helper image is pinned by digest, pre-pulled during install, and run with no network, no Linux capabilities, no new privileges, and a read-only root filesystem.
- Restore derives the staged node public key and compares it to a separately recorded expected value before stopping the live service.
- Public distribution is labeled experimental alpha until disposable-host and chain-aware checks are independently completed.

## Consequences

Commands are longer and operators must resolve and inspect exact fingerprints and commits. This friction binds high-impact actions to inspectable evidence and makes supply-chain updates deliberate. Host lifecycle and networking remain operator-managed and provider-neutral.
