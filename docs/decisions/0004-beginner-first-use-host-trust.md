# 0004: Beginner first-use SSH host trust

- Status: accepted
- Date: 2026-09-04

## Context

The initial public-alpha policy required every beginner to retrieve an SSH fingerprint through an independent management console. Many VPS dashboards expose that only through a VNC console, which makes the recommended first install too difficult for a new operator and encourages unsafe workarounds.

## Decision

- Before host provisioning, `prepare-key` creates the dedicated passphrase-protected Ed25519 identity outside the operator-state directory and a private, value-free marker bound to its alias, path, and public-key fingerprint.
- The operator selects only that `.pub` key while creating or reinstalling the host. `init` later validates both halves of the prepared keypair against the marker and consumes the marker only after operator state is committed successfully.
- A host created or reinstalled moments earlier in the operator's authenticated provider dashboard may use `--trust-new-host HOST`, where `HOST` must exactly match `--hostname`.
- Initialization accepts exactly one distinct Ed25519 host key, displays and records its SHA256 fingerprint, and writes it to the private repository-local `known_hosts` file.
- The first-use route refuses existing operator or host-key state. Every later SSH connection keeps `StrictHostKeyChecking yes` and fails on key change.
- Host-key state is not written until key generation or prepared-key validation succeeds. Failed initialization removes only files created by that invocation and preserves a prepared identity for retry. A confirmation-gated recovery command archives incomplete value-free state left by older versions, but refuses to touch any state containing operator configuration.
- An inherited host, valuable existing host, or higher-assurance environment uses `--host-key-sha256` with a fingerprint obtained independently.

## Consequences

The beginner route is vulnerable if an attacker can intercept the very first connection. Restricting it to a host the operator has just provisioned narrows that exposure but does not eliminate it. Preparing the client key before provisioning supports dashboards that inject keys only at creation time, while transactional initialization avoids manual cleanup after cancellation. A new operator can therefore complete onboarding without VNC knowledge, and persistent pinning still detects later interception or unexpected reinstalls.
