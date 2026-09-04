# Security Onboarding

Complete this before an operator installs or inherits a node. This is an access and recovery contract, not a request for anyone to disclose credentials.

## Personal identity

- [ ] The operator uses their own GitHub, Codex/OpenAI, email, VPS-provider, and password-manager identities.
- [ ] MFA or passkeys are enabled; recovery codes are stored outside the workstation.
- [ ] No account, browser profile, token, SSH private key, or Codex session was copied from another operator.
- [ ] The operator can identify who may approve node, repository, provider, and testnet changes.

## Workstation

- [ ] Full-disk encryption and automatic screen locking are enabled.
- [ ] The operating system, browser, Codex, Git, Bun, OpenSSH, and `age` receive security updates.
- [ ] `./demosctl init` created a dedicated, passphrase-protected Ed25519 key.
- [ ] Only the `.pub` key was uploaded to the provider; the private key was backed up securely.
- [ ] The operator understands that Codex must never receive or inspect secret values.

## Repository and Codex

- [ ] The repository was cloned from the expected private owner and the Git remote was checked.
- [ ] Codex opened this repository and read `AGENTS.md` plus the local node-runner skill.
- [ ] Workspace permissions require approval; unrestricted access is not enabled for routine node operations.
- [ ] `.demos/`, `.env`, backups, logs, and private inventory are ignored by Git.
- [ ] `bun run check` passes from a fresh dependency install.

## VPS and credentials

- [ ] The VPS is dedicated to this node and runs supported Ubuntu.
- [ ] Provider ownership, billing contact, recovery path, and firewall owner are known.
- [ ] Every API token has one named human owner, purpose, expiry, and revocation route.
- [ ] `./demosctl secrets doctor` reports only names/status, owner `root:root`, and mode `600`.
- [ ] No credential from chat, documentation, another node, or a shared spreadsheet is in use.

## Recovery and handover

- [ ] Two encrypted node-identity backups exist in separate operator-controlled locations.
- [ ] The backup passphrase is stored separately from the archive.
- [ ] A disposable restore drill and public-key comparison are scheduled.
- [ ] A second authorized person knows the recovery and offboarding procedure without possessing unnecessary access.

Sign-off records only operator name, date, node alias, completion state, and exceptions. It must not contain keys, tokens, recovery codes, mnemonics, IP allowlists, or raw configuration.
