# Secret Operations for DEMOS Node Runners

This runbook covers the complete secret lifecycle: creation, storage, use, backup, rotation, exposure response, and offboarding. It never requires a secret value to enter Codex, Git, an issue, or a chat.

## Secret inventory

| Material | Owner | Canonical location | Backup | Rotation rule |
|---|---|---|---|---|
| DEMOS node identity/mnemonic | Individual node operator | Docker volume `demos_node_state` on the node host | Age-encrypted archive plus two persisted recovery-key copies in separate operator-controlled locations | Do not rotate casually; coordinate identity replacement with the network maintainer |
| SSH private key | Individual operator | Workstation `~/.ssh/` | Encrypted offline backup; a password manager is optional | Rotate on device loss, operator departure, or suspected exposure |
| SSH public key | Individual operator | Hosting dashboard or host `authorized_keys` | No secret backup required | Overlap old and new keys until new access is proven, then remove the old key |
| `GITHUB_TOKEN` | Individual operator or one operator-owned fleet | `/etc/demos-node/node.env` when the Gist proof path is enabled | No backup; recreate at issuer | No repository access; short expiry; revoke before replacing after exposure |
| `ETHERSCAN_API_KEY` | Individual operator or one operator-owned fleet | `/etc/demos-node/node.env` when EVM history checks are enabled | No backup; recreate at issuer | Monitor aggregate per-key quota and coordinate fleet rotation |
| `HELIUS_API_KEY` | Individual operator or one operator-owned fleet | `/etc/demos-node/node.env`; current core Solana activity integration | No backup; recreate at issuer | Apply IP restrictions where supported, monitor aggregate quota, and coordinate fleet rotation |
| TLSNotary signing key | Node operator, FFI mode only | `/etc/demos-node/node.env` | Encrypted operator backup | Default Docker mode does not need this key |
| Hosting account credentials | Hosting account owner | The provider's secure account and recovery controls | Provider recovery process | Never place on the node or in this repository |
| Coordinator SUDO key and allowlists | Network maintainer | Maintainer-controlled configuration channel | Maintainer-owned | Public configuration is not a runner secret, but it still requires authenticated provenance |

Cross-operator credential sharing is prohibited. One person or organization may deliberately scope one provider key to its own fleet, but that is a single ownership boundary: the fleet owner must be able to restrict, monitor, rotate, and revoke it. A credential copied from another runner, chat, documentation, or a shared spreadsheet is never an operator-owned fleet key.

Provider API credentials are rotatable and revocable. They are not the DEMOS node identity, do not preserve stake, and do not belong in the node-identity recovery archive.

### Provider credential matrix

| Credential | Purpose | Current setup status | Least privilege | Same-owner fleet policy |
|---|---|---|---|---|
| `GITHUB_TOKEN` | Read a GitHub Gist for the Web2 proof path | Feature-gated; optional until enabled by the maintainer | Public Gists can be read anonymously. If the installed path requires authentication, use a dedicated fine-grained credential with no repository permissions. Do not use classic `repo`. | Prefer no token. Never distribute a broad personal token; any confirmed credential must be dedicated to this path. |
| `ETHERSCAN_API_KEY` | Read normal EVM address transaction history for cross-chain activity checks | Feature-gated; current installed call sites are dormant | Read-only API key; no wallet or signing permission | One key may cover one operator-owned fleet if its aggregate quota is sufficient and usage is monitored. |
| `HELIUS_API_KEY` | Read Solana address transactions for cross-chain activity checks | Current core integration; required by `secrets setup` | API key restricted to the nodes' public IPs where supported | One key may cover one operator-owned fleet if its aggregate quota is sufficient; plan rotation for every node using it. |

At the 2026-09-04 documentation snapshot, [GitHub's authenticated REST limit](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) is normally shared by the user, [Etherscan Free](https://docs.etherscan.io/rate-limits) allows 3 calls/second and 100,000/day, and [Helius Free](https://www.helius.dev/docs/billing/rate-limits) allows 2 requests/second for Enhanced APIs. Provider limits can change; verify the official pages before scaling. Ten nodes sharing one key consume one combined quota, not ten separate quotas.

## Creation rules

1. Create credentials only on the issuer's authenticated site.
2. Give each credential one purpose and a short, descriptive name containing the node alias or fleet alias.
3. Use the smallest permission set and a finite expiry.
4. Enable MFA on GitHub, hosting/provider, and email accounts. If you elect to use a password manager, enable MFA there too.
5. Never create a credential from a link or instruction copied from an unauthenticated message without verifying the issuer domain.
6. Never reuse a production node credential on a development machine or across unrelated operators. Same-owner node-fleet reuse is allowed only under the matrix above.

The GitHub integration reads Gists. [GitHub documents](https://docs.github.com/en/rest/gists/gists#get-a-gist) that public Gists can be read anonymously and that the Get-a-Gist endpoint needs no fine-grained permission. A classic `repo` scope gives repository access and is not justified here. Follow a broader coordinator requirement only after the maintainer confirms why it is needed and accepts the blast radius.

Keep a value-free inventory using [the credential-register template](templates/credential-register.md). Record owner, purpose, node/fleet scope, permissions, affected node aliases, expiry, restrictions, quota monitor, rotation, and revocation URL—never the value, prefix, hash, or a secret-bearing URL.

## Secure entry and verification

Use:

```bash
./demosctl secrets setup --confirm secrets
./demosctl secrets doctor
```

`setup` uses hidden input, requires an operator-owned `HELIUS_API_KEY`, and marks GitHub and Etherscan optional. It sends updates through SSH stdin. The remote helper validates a complete candidate, atomically installs it, reopens it, and returns only `verified` field names. `doctor` returns file owner, mode, and `configured`/`missing`/`not-required` status for allowlisted names; it never returns values. Use `secrets configure` for later partial rotation; blank prompts preserve existing values.

An existing node installed by an older starter must first run `./demosctl upgrade-operator --confirm upgrade-operator`. Secret commands require exact versioned helper handshakes and reject legacy helpers instead of treating their exit status as verification. This upgrade does not restart the node service.

The secret file must always report:

```text
file=present
owner=root:root
mode=600
```

Do not run `cat`, `sed`, an editor screen-share, shell tracing, environment dumps, or diagnostic bundles against the secret file.

## Node identity backup

Before staking or updating, establish recovery once:

```bash
./demosctl recovery create \
  --copy-to /mounted/offline-drive/NODE-recovery.agekey \
  --confirm recovery
```

No password manager is required. The command persists two identical Age recovery-key files outside the repository and operator-state directory. Keep them in different failure domains:

- the primary file in the workstation's private application-data directory;
- the required copy on an encrypted removable drive or another operator-controlled offline location.

The backup is encrypted before it reaches workstation storage. The CLI does not trust file existence or a successful write. It reopens the exact ciphertext using the persisted second key copy in a new process, verifies its digest, stages the contents in an isolated remote volume, and compares the staged public identity with the running node. It writes a value-free receipt only after every check succeeds.

Before an OS reinstall, run `./demosctl recovery check --for reinstall --confirm recovery-check:reinstall` while the old node is reachable. The resulting authorization lasts two hours and is consumed by the exact-host `retrust-host` command after reinstall. Provider lifecycle remains a separate human action.

For a fresh backup later, run `./demosctl backup --confirm backup`. A password manager can hold an additional copy if the operator already uses one, but it is neither assumed nor integrated by this repository. Never keep the only recovery key beside the workstation and never put it in Git, chat, or Codex.

## Routine rotation

For an API token:

1. Create a new operator-owned token at the issuer with the same node/fleet scope recorded in the value-free register.
2. Enter it with `./demosctl secrets configure --confirm secrets`; enter only the changed field and leave the rest blank.
3. Run `./demosctl secrets doctor` for value-free state.
4. Restart with `./demosctl stop --confirm stop`, followed by a separate `./demosctl start --confirm start`.
5. Run `./demosctl status` and a feature-specific check.
6. Revoke the old token at the issuer and update only the value-free register metadata.

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
- Review provider access, GitHub access, any optional password-manager sharing, monitoring, and recovery contacts.

## Quarterly audit

- `./demosctl secrets doctor` reports root ownership and mode `600`.
- Every set token has an identified owner, purpose, issuer, node/fleet scope, expiry, quota monitor, rotation owner, and revocation path.
- No cross-operator tokens remain; every same-owner fleet key still has the intended node set and restrictions.
- The SSH authorized-key list matches active operators.
- The current value-free recovery receipt still passes `recovery check`, and the two recovery-key files remain in separate failure domains.
- Provider audit logs and API usage show no unexplained activity.
