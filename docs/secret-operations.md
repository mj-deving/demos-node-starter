# Secret Operations for DEMOS Node Runners

This runbook covers the complete secret lifecycle: creation, storage, use, backup, rotation, exposure response, and offboarding. It never requires a secret value to enter Codex, Git, an issue, or a chat.

## Secret inventory

| Material | Owner | Canonical location | Backup | Rotation rule |
|---|---|---|---|---|
| DEMOS node identity/mnemonic | Individual node operator | Docker volume `demos_node_state` on the VPS | Passphrase-encrypted `age` archives in two operator-controlled locations | Do not rotate casually; coordinate identity replacement with the network maintainer |
| SSH private key | Individual operator | Workstation `~/.ssh/` | Password manager or encrypted offline backup | Rotate on device loss, operator departure, or suspected exposure |
| SSH public key | Individual operator | Provider control panel and VPS `authorized_keys` | No secret backup required | Overlap old and new keys until new access is proven, then remove old key |
| GitHub token | Individual operator | `/etc/demos-node/node.env` | No backup; recreate at issuer | Short expiry and least privilege; revoke before replacing after exposure |
| Etherscan/Helius/API tokens | Individual operator | `/etc/demos-node/node.env` | No backup; recreate at issuer | Separate production/test keys; use IP restriction where supported |
| TLSNotary signing key | Node operator, FFI mode only | `/etc/demos-node/node.env` | Encrypted operator backup | Default Docker mode does not need this key |
| Contabo credentials | Provider account owner | Provider-approved password manager or broker | Provider recovery process | Never place on the node; outside this repository |
| Coordinator SUDO key and allowlists | Network maintainer | Maintainer-controlled configuration channel | Maintainer-owned | Public configuration is not a runner secret, but it still requires authenticated provenance |

Shared credentials are prohibited. Every runner creates and can independently revoke their own credentials.

## Creation rules

1. Create credentials only on the issuer's authenticated site.
2. Give each credential one purpose and a short, descriptive name containing the node alias.
3. Use the smallest permission set and a finite expiry.
4. Enable MFA on GitHub, the VPS provider, email, and password-manager accounts.
5. Never create a credential from a link or instruction copied from an unauthenticated message without verifying the issuer domain.
6. Do not use the same token across nodes, development machines, or operators.

The current upstream GitHub integration reads gists. A classic `repo` scope is therefore not justified by the observed code path alone. Follow a broader coordinator requirement only after the maintainer confirms why it is needed and accepts the blast radius.

## Secure entry and verification

Use:

```bash
./demosctl secrets configure
./demosctl secrets doctor
```

`configure` uses hidden input and sends only non-empty updates through SSH stdin. Blank prompts preserve existing values. `doctor` returns file owner, mode, and `set`/`unset` status for allowlisted names; it never returns values.

The secret file must always report:

```text
file=present
owner=root:root
mode=600
```

Do not run `cat`, `sed`, an editor screen-share, shell tracing, environment dumps, or diagnostic bundles against the secret file.

## Node identity backup

Before staking, updating, restoring, or any database-clean operation:

```bash
./demosctl backup
```

The backup is encrypted before it reaches workstation storage. Keep two copies:

- one on the operator workstation or encrypted external drive;
- one in an operator-controlled password manager or encrypted off-site store.

The backup passphrase belongs in the password manager, not beside the archive. A backup is not qualified until a restore has been tested on a disposable node and the restored public key matches the original. Never perform the first restore drill against the only live node.

## Routine rotation

For an API token:

1. Create a new individually owned token at the issuer.
2. Enter it with `./demosctl secrets configure`; enter only the changed field and leave the rest blank.
3. Run `./demosctl secrets doctor` for value-free state.
4. Restart with `./demosctl stop --confirm stop`, followed by a separate `./demosctl start --confirm start`.
5. Run `./demosctl status` and a feature-specific check.
6. Revoke the old token at the issuer.

For an SSH key, add the new public key first, prove a separate login with `IdentitiesOnly=yes`, then remove the old public key. Never remove the last verified access path.

## Exposure response

If a secret appears in chat, Git, terminal history, logs, screenshots, or an unexpected process:

1. Stop copying or processing the exposed material.
2. Revoke the credential at its issuer. Editing or deleting the message is not revocation.
3. Create a new credential with a distinct identity and least privilege.
4. Replace it through hidden input.
5. Restart only the node service when required.
6. Verify the affected feature and review issuer audit/usage logs for unauthorized use.
7. Record only the credential name, exposure channel, revoke time, replacement time, and verification result—never the value.

If the DEMOS mnemonic or SSH private key is exposed, stop normal operation and coordinate identity/access replacement. Do not improvise a destructive reinstall.

## Offboarding and node transfer

- Revoke the departing operator's API tokens and remove their SSH public key.
- Create replacement credentials owned by the new operator; do not transfer personal tokens.
- Transfer the encrypted node-identity backup through an authenticated, access-controlled channel.
- Prove the new operator's SSH access before removing the old path.
- Confirm who owns the node identity and staking position in writing.
- Review provider access, GitHub access, password-manager sharing, monitoring, and recovery contacts.

## Quarterly audit

- `./demosctl secrets doctor` reports root ownership and mode `600`.
- Every set token has an identified owner, purpose, issuer, expiry, and revocation path.
- No shared tokens remain.
- The SSH authorized-key list matches active operators.
- Two encrypted identity backups exist and one disposable restore drill has passed in the last year.
- Provider audit logs and API usage show no unexplained activity.
