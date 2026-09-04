# Changelog

All notable changes to this project are documented here.

## 0.1.0 - 2026-09-04

Initial experimental public alpha candidate:

- one provider-neutral `demosctl` command surface for a single operator-controlled Ubuntu node;
- pre-provision dedicated SSH identity creation outside operator state, transactional and recoverable initialization, and either bounded first-use trust for a newly provisioned host or independently verified host-key pinning;
- exact upstream commit approval for install and update;
- resumable `onboard` guidance and first-use `secrets setup` with stdin-only, atomic root-owned storage plus exact value-free verification;
- password-manager-independent Age recovery with two persisted key copies, exact ciphertext digest, fresh-process decrypt, isolated staged identity comparison, and a value-free qualification receipt;
- recovery-gated staking/update, short-lived reinstall authorization, one-time exact-host SSH re-trust, and identity-bound transactional restore;
- versioned remote secret-helper handshakes with an explicit no-restart operator-helper upgrade path for existing installations;
- a documentation-authoritative provider-credential matrix, Helius-only core setup gate, safe same-owner fleet reuse rules, and a value-free credential-register template;
- digest-pinned, network-disabled recovery helper;
- service, public RPC, URL, and node-identity verification;
- security onboarding, operations runbook, decision ledger, incident template, and private local workspace memory.

Live host installation and testnet acceptance remain environment-specific verification gates.
