# Security

## Credential handling

Do not open issues, paste chat messages, or commit files containing tokens, passwords, API keys, mnemonics, private keys, recovery codes, or provider credentials.

`./demosctl secrets configure --confirm secrets` accepts secrets through hidden terminal input and streams them over SSH directly into `/etc/demos-node/node.env`. The tool reports only whether each field is set; it never reads secret values back.

The lifecycle policy for node identity, SSH keys, API tokens, rotation, recovery, exposure response, and offboarding is in [docs/secret-operations.md](docs/secret-operations.md).

If a credential appears in chat, Git, logs, screenshots, or terminal history, assume it is compromised and revoke or rotate it at the issuing service before continuing.

## Access model

- Use one dedicated, passphrase-protected Ed25519 SSH key per operator/node.
- Pin the host's OpenSSH SHA256 fingerprint from an authenticated, out-of-band management console before first SSH contact.
- Provision only the public key through the host-management surface.
- Use an operator-controlled Ubuntu host dedicated to the node workload. Shared hosting is unsupported.
- Require amd64/x86-64 architecture while the upstream TLSNotary service remains amd64-only.
- The systemd unit uses root-associated Docker authority; therefore every upstream revision must be reviewed and supplied as an exact 40-character commit SHA.
- Backup and restore use a digest-pinned, network-disabled helper image; changing that digest is a security-sensitive review.
- Host lifecycle and firewall management are outside this tool.
- Codex should run with workspace permissions and approvals, not unrestricted Full Access.

## Reporting

Use GitHub's private vulnerability-reporting form on the repository Security tab when available. Do not open a public issue for a suspected vulnerability. Include reproduction steps without live credentials, private host addresses, or node identities.
