# Security

## Credential handling

Do not open issues, paste chat messages, or commit files containing tokens, passwords, API keys, mnemonics, private keys, recovery codes, or provider credentials.

`./demosctl secrets setup --confirm secrets` accepts first-use credentials through hidden terminal input and streams them over SSH directly into `/etc/demos-node/node.env`. The remote helper validates and atomically installs the whole file, then reports only verified field names. It never returns secret values. Later partial rotation uses `secrets configure`.

Recovery works without a password manager. `recovery create` produces two mode-`0600` Age key files outside the repository, encrypts the live identity archive, then proves the persisted second copy can decrypt the exact archive and reproduce the live node public key. Staking, updating, and reinstall authorization fail closed without this proof. A password manager is an optional additional storage choice, not a dependency of this repository.

The lifecycle policy for node identity, SSH keys, API tokens, rotation, recovery, exposure response, and offboarding is in [docs/secret-operations.md](docs/secret-operations.md).

If a credential appears in chat, Git, logs, screenshots, or terminal history, assume it is compromised and revoke or rotate it at the issuing service before continuing.

## Access model

- Use one dedicated, passphrase-protected Ed25519 SSH key per operator/node.
- Generate that key with `./demosctl prepare-key` before host provisioning and keep it outside `.demos/`. Initialization accepts only the exact tool-prepared alias, path, Ed25519 keypair, and recorded fingerprint; arbitrary existing keys and state-colliding paths remain rejected.
- For a newly created or reinstalled host, explicitly bind `--trust-new-host` to the exact dashboard hostname/IP; the tool records and pins the first observed Ed25519 key, and all later SSH connections fail closed on change.
- For inherited or valuable existing hosts, verify the OpenSSH SHA256 fingerprint through an independent authenticated channel and use `--host-key-sha256`.
- Provision only the public key through the host-management surface, during host creation when the provider injects account keys only at provisioning time.
- Use an operator-controlled Ubuntu host dedicated to the node workload. Shared hosting is unsupported.
- Require amd64/x86-64 architecture while the upstream TLSNotary service remains amd64-only.
- The systemd unit uses root-associated Docker authority; therefore every upstream revision must be reviewed and supplied as an exact 40-character commit SHA.
- Backup and restore use a digest-pinned, network-disabled helper image; changing that digest is a security-sensitive review.
- Host lifecycle and firewall management are outside this tool.
- Re-pinning an SSH host key after reinstall requires a fresh, two-hour recovery authorization bound to the same configured hostname and qualified archive; the authorization is consumed after one successful re-trust.
- Codex should run with workspace permissions and approvals, not unrestricted Full Access.

## Reporting

Use GitHub's private vulnerability-reporting form on the repository Security tab when available. Do not open a public issue for a suspected vulnerability. Include reproduction steps without live credentials, private host addresses, or node identities.
