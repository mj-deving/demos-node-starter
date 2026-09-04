# Security

## Credential handling

Do not open issues, paste chat messages, or commit files containing tokens, passwords, API keys, mnemonics, private keys, recovery codes, or provider credentials.

`./demosctl secrets configure` accepts secrets through hidden terminal input and streams them over SSH directly into `/etc/demos-node/node.env`. The tool reports only whether each field is set; it never reads secret values back.

The lifecycle policy for node identity, SSH keys, API tokens, rotation, recovery, exposure response, and offboarding is in [docs/secret-operations.md](docs/secret-operations.md).

If a credential appears in chat, Git, logs, screenshots, or terminal history, assume it is compromised and revoke or rotate it at the issuing service before continuing.

## Access model

- Use one dedicated, passphrase-protected Ed25519 SSH key per operator/node.
- Provision only the public key through the provider.
- Use a dedicated VPS. Shared or multi-tenant servers are unsupported.
- The `demos` runtime user has no sudo membership.
- Provider lifecycle and firewall APIs are outside this tool.
- Codex should run with workspace permissions and approvals, not unrestricted Full Access.

## Reporting

Report vulnerabilities privately to the repository owner. Include reproduction steps without live credentials, private host addresses, or node identities.
