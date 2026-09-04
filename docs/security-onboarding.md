# Security Onboarding

Complete this before an operator installs or inherits a node. This is an access and recovery contract, not a request for anyone to disclose credentials.

## Personal identity

- [ ] The operator uses their own GitHub, Codex/OpenAI, email, and hosting/provider identities; a password manager is optional.
- [ ] MFA or passkeys are enabled; recovery codes are stored outside the workstation.
- [ ] No account, browser profile, token, SSH private key, or Codex session was copied from another operator.
- [ ] The operator can identify who may approve node, repository, provider, and testnet changes.

## Workstation

- [ ] Full-disk encryption and automatic screen locking are enabled.
- [ ] The operating system, browser, Codex, Git, Bun, OpenSSH, and `age` receive security updates.
- [ ] `./demosctl prepare-key` created a dedicated, passphrase-protected Ed25519 key before host provisioning.
- [ ] Only the printed `.pub` path was selected while creating or reinstalling the host; the private key never left the workstation.
- [ ] `./demosctl init` validated and consumed the exact prepared-identity marker after the host became reachable.
- [ ] SSH host trust used the right route: explicit `--trust-new-host` immediately after provisioning/reinstall, or an independently verified fingerprint for an inherited or valuable existing host.
- [ ] The fingerprint recorded in `.demos/WORKSPACE.md` is treated as the permanent pin; any later mismatch stops work and triggers investigation.
- [ ] The private SSH key was backed up to an encrypted offline location after access was proven.
- [ ] The operator understands that Codex must never receive or inspect secret values.

## Repository and Codex

- [ ] The repository was cloned from the expected owner and the Git remote was checked.
- [ ] Codex opened this repository and read `AGENTS.md` plus the local node-runner skill.
- [ ] Workspace permissions require approval; unrestricted access is not enabled for routine node operations.
- [ ] `.demos/`, `.env`, backups, logs, and private inventory are ignored by Git.
- [ ] `bun run check` passes from a fresh dependency install.

## Host and credentials

- [ ] The operator controls the node host, it runs supported Ubuntu, and the node workload is not mixed with untrusted tenants.
- [ ] The exact upstream commit supplied to install or update was inspected and approved independently of the branch name.
- [ ] Provider ownership, billing contact, recovery path, and firewall owner are known.
- [ ] Every API token has one named human owner, purpose, expiry, revocation route, and declared scope: one node or one operator-owned fleet.
- [ ] The operator reviewed the credential matrix: Helius is current core setup; GitHub and Etherscan are feature-gated pending maintainer confirmation.
- [ ] `./demosctl secrets setup --confirm secrets` completed with an operator-owned Helius key; no value from chat or documentation was reused.
- [ ] Any fleet-scoped key has a value-free register entry, sufficient aggregate quota, monitoring, coordinated rotation, and IP restrictions where supported.
- [ ] `./demosctl secrets doctor` reports only names/status, owner `root:root`, and mode `600`.
- [ ] Existing installations ran `upgrade-operator` and both remote helper protocols were verified before any secret write.
- [ ] No credential from chat, documentation, another operator, or a shared spreadsheet is in use. Same-owner fleet reuse is documented and must not be confused with cross-operator sharing.

## Recovery and handover

- [ ] `recovery create` produced two mode-`0600` Age recovery-key files outside this repository and `.demos/`, in separate failure domains.
- [ ] A value-free `RECOVERY QUALIFIED` receipt exists only after the exact archive was decrypted with the persisted second key, staged, and matched to the live node public key.
- [ ] The operator can run `recovery check` before staking, updating, or reinstalling; a non-empty ciphertext or successful storage command is understood not to be proof.
- [ ] The operator understands the two-hour, exact-host `retrust-host` procedure after an authorized OS reinstall.
- [ ] A second authorized person knows the recovery and offboarding procedure without possessing unnecessary access.

Sign-off records only operator name, date, node alias, completion state, and exceptions. It must not contain keys, tokens, recovery codes, mnemonics, IP allowlists, or raw configuration.
