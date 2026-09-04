# DEMOS Node Starter

A security-first, Codex-assisted operator kit for running one DEMOS testnet node on an operator-controlled Ubuntu host. This repository is an experimental public alpha: inspect every approved upstream commit and use a disposable Ubuntu host before operating valuable identity material.

The host can be a cloud VPS from any provider, dedicated hardware, or a suitable local Ubuntu system. Local key preparation happens first; the remote workflow begins only after the operator has prepared the host and its network access.

## What you need

- An operator-controlled amd64/x86-64 Ubuntu 22.04 or 24.04 host with at least 4 CPU cores, 4 GB RAM, and SSD storage. ARM hosts are not supported because the required upstream TLSNotary image is currently amd64-only.
- A publicly reachable IP or DNS endpoint for the node, with TCP ports `53550` and `53551` routed to the host.
- A Mac, Linux, or Windows-with-WSL workstation with Git, Bun, OpenSSH, and `age`.
- Codex in the ChatGPT desktop app, CLI, or IDE extension. Use workspace permissions with approvals; do not enable unrestricted Full Access for node operations.
- Your own GitHub, Etherscan, and Helius accounts if the current testnet coordinator requires those features.

The credentials enable separate external lookup features; they are not node identity. The starter currently requires only Helius during initial secret setup and keeps GitHub and Etherscan feature-gated pending maintainer confirmation. Do not create broad credentials: a classic GitHub `repo` token reaches repositories and is not justified by the documented Gist-read purpose.

## 1. Install workstation tools

Install Codex using the [official OpenAI quickstart](https://learn.chatgpt.com/docs/quickstart). Install Bun from [bun.sh](https://bun.sh), OpenSSH through your operating system, and `age` from [age-encryption.org](https://age-encryption.org).

Then:

```bash
git clone https://github.com/mj-deving/demos-node-starter.git
cd demos-node-starter
bun install
bun run check
```

Open this folder in Codex. Codex automatically reads `AGENTS.md` and discovers the repository-local `demos-node-runner` skill.

Treat this clone as the node's command center, not as a disposable installer. Read [OPERATIONS.md](OPERATIONS.md) for the session-start procedure, sources of truth, maintenance cadence, and incident entry points.

## 2. Prepare SSH access and create the host

Before creating or reinstalling the host, generate the dedicated SSH identity:

```bash
./demosctl prepare-key --alias my-demos-node
```

The command asks for a passphrase and prints the path of the public `.pub` file. Keep the identity outside `.demos/`. Upload the `.pub` file—or open it yourself and copy its complete single line—into the provider's normal SSH-key field while creating or reinstalling the host. Never upload or paste the private key. This works with providers that inject SSH keys only during provisioning and does not require a VNC console.

After provisioning completes, use the IP address shown in the dashboard. Substitute that same address in all three places below:

```bash
./demosctl init \
  --alias my-demos-node \
  --hostname 203.0.113.10 \
  --public-url http://203.0.113.10:53550 \
  --trust-new-host 203.0.113.10
```

Use `--trust-new-host` only immediately after you create or reinstall a server in your authenticated provider dashboard. The command validates and consumes the prepared-identity marker, shows the observed host fingerprint, and pins it permanently. Any later host-key change is refused instead of silently trusted.

The tool accepts only the exact identity produced by `prepare-key`; it verifies the private key, public key, recorded fingerprint, alias, and path before use. It refuses arbitrary existing keys and never overwrites existing operator or host-key state. If host enrollment fails, the prepared identity remains available for a safe retry.

For an inherited host, a valuable existing host, or a higher-assurance setup, independently obtain its OpenSSH Ed25519 fingerprint and use the hardened route instead:

```bash
./demosctl init \
  --alias my-demos-node \
  --hostname 203.0.113.10 \
  --public-url http://203.0.113.10:53550 \
  --host-key-sha256 SHA256:REPLACE_WITH_VERIFIED_FINGERPRINT
```

Load the key into your local SSH agent with `ssh-add <identity-file>` before running unattended checks. `./demosctl workspace` writes a private, gitignored `.demos/WORKSPACE.md` system map for future operators and Codex sessions.

For an already accessible host where you can safely add a new public key through `authorized_keys`, `init` can still generate the dedicated identity inline. If interactive key generation fails or is cancelled, it leaves no committed operator or host-key state, so the same command can be retried safely.

If an older starter version already left incomplete `.demos` state and `operator.json` does not exist, preserve it and reopen initialization with:

```bash
./demosctl archive-incomplete-init --confirm archive-incomplete-init
```

The command moves only incomplete value-free state into a timestamped `.demos/incomplete-init-*` archive. It refuses to act when operator configuration exists.

The example address `203.0.113.10` is documentation-only. Use the real address or DNS name routed to your host.

At any time, run the resumable guide to see only the next safe action:

```bash
./demosctl onboard
```

## 3. Verify access without changing the host

```bash
./demosctl doctor
```

The doctor checks local dependencies, state-file permissions, root SSH authentication, and that the target is Linux. It does not install or stop anything.

## 4. Install the node

Resolve the current upstream branch tip, inspect that exact commit on GitHub, and obtain any required maintainer approval:

```bash
UPSTREAM_COMMIT="$(git ls-remote https://github.com/kynesyslabs/node.git refs/heads/stabilisation | cut -f1)"
printf '%s\n' "${UPSTREAM_COMMIT}"
```

Review the exact target in `.demos/operator.json`, then bind installation to that full commit:

```bash
./demosctl install \
  --commit "${UPSTREAM_COMMIT}" \
  --confirm "install:${UPSTREAM_COMMIT}"
```

The installer:

- accepts a supported Ubuntu host reached through root SSH;
- installs Docker from Docker's official Ubuntu repository;
- verifies Ubuntu 22.04 or 24.04 and the expected Docker CE packages;
- verifies that the fetched `stabilisation` tip is the exact approved commit and checks it out detached;
- pins the network-isolated identity backup helper by image digest;
- clones `https://github.com/kynesyslabs/node.git` into `/opt/demos-node`;
- writes `/etc/demos-node/node.env` as root-only mode `0600`;
- installs and starts only `demos-node.service`;
- starts Postgres, TLSNotary, the node, Prometheus, and Grafana explicitly;
- does not start the upstream Docker-socket reaper;
- does not modify the provider firewall.

If this repository is upgraded around an already-installed node, refresh only the versioned remote secret helpers before changing credentials:

```bash
./demosctl upgrade-operator --confirm upgrade-operator
```

The command verifies both helper protocol versions and does not restart the node service. New installations already receive the current helpers.

## 5. Configure provider credentials

The three commonly requested credentials serve different external node features. This table is the operator-facing policy; you do not need to inspect source code to decide what to create.

| Credential | What the node uses it for | Required now | Reuse across your own 10 nodes |
|---|---|---|---|
| `GITHUB_TOKEN` | Reads a GitHub Gist used by the Web2 proof path | No; configure only when the maintainer enables that path | Prefer no token for public Gists. If authentication is confirmed, use one dedicated fine-grained credential with no repository access; never distribute a classic `repo` token across VPS hosts. |
| `ETHERSCAN_API_KEY` | Looks up normal EVM address transactions for cross-chain activity checks | No; the installed integration is currently dormant | Yes, within one operator-owned fleet if the plan quota is sufficient. Monitor aggregate usage and rotate the fleet together. |
| `HELIUS_API_KEY` | Looks up Solana address transactions for cross-chain activity checks | Yes for the current core integration | Yes, within one operator-owned fleet if the plan quota is sufficient. Restrict the key to the fleet's public IPs, monitor aggregate usage, and keep a coordinated rotation plan. |

These are revocable provider credentials, not the DEMOS node identity. They do not belong in the node-identity backup. The current public limits are provider-controlled: GitHub authenticated REST requests normally share a per-user limit, Etherscan applies per-key rate and daily limits, and Helius applies plan-specific RPC/API limits. Check the linked provider pages before adding nodes.

Create credentials only in the issuing service's own dashboard:

- GitHub: [Gist authentication](https://docs.github.com/en/rest/gists/gists#get-a-gist), [token security](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), and [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- Etherscan: [API setup](https://docs.etherscan.io/getting-started) and [rate limits](https://docs.etherscan.io/rate-limits)
- Helius: [API-key authentication](https://www.helius.dev/docs/api-reference/authentication), [rate limits](https://www.helius.dev/docs/billing/rate-limits), and [key protection](https://www.helius.dev/docs/rpc/protect-your-keys)

For first-time setup, enter them through hidden terminal prompts:

```bash
./demosctl secrets setup --confirm secrets
```

Initial setup requires `HELIUS_API_KEY`. GitHub and Etherscan are clearly marked optional and may be left blank unless the network maintainer enables their feature paths. Later rotations use `./demosctl secrets configure --confirm secrets`, where every blank prompt preserves the current value.

The values stream through SSH stdin into `/etc/demos-node/node.env`. They are not written to the workstation or passed as command arguments. The remote helper validates the complete candidate file, atomically replaces the root-only canonical file, reopens it, and confirms the intended fields without returning values. Restarting remains a separate decision.

Check ownership and configured-field status without revealing values:

```bash
./demosctl secrets doctor
```

Read the complete [Secret Operations runbook](docs/secret-operations.md) before staking. It covers identity backups, token rotation, exposure response, restore drills, and operator offboarding.

Complete the [Security Onboarding checklist](docs/security-onboarding.md) for every new operator. Durable architecture and security choices belong in the [Decision Ledger](docs/decisions/README.md), never in copied chat history.

Do not use `TLSNOTARY_SIGNING_KEY` in the default Docker mode. Only operators who deliberately switch upstream to FFI mode should run:

```bash
./demosctl secrets configure --confirm secrets --ffi
```

Credentials copied from chat, documentation, another operator, Discord, or a shared spreadsheet must not be used. Controlled reuse inside one operator-owned fleet is described in the [Secret Operations runbook](docs/secret-operations.md); it is not permission to share credentials between operators. If a credential has appeared in chat or Git, rotate it first.

## 6. Create and prove identity recovery

```bash
./demosctl recovery create \
  --copy-to /mounted/offline-drive/my-demos-node-recovery.agekey \
  --confirm recovery
./demosctl pubkey
```

No password manager is required. The command creates an Age recovery identity in the workstation's private application-data directory and an exact second key copy at the path you choose. Choose a different failure domain, such as an encrypted removable drive that you disconnect afterward. Do not place either key inside this repository, `.demos/`, or beside a publicly shared archive.

The command then encrypts the live `demos_node_state` volume, decrypts the exact archive in a fresh process using the persisted second key copy, stages it in an isolated remote Docker volume, and requires its DEMOS public key to equal the running node's public key. Only then does it write a value-free `RECOVERY QUALIFIED` receipt.

A successful command, non-empty encrypted file, or credential-store exit code is never treated as recovery proof. A password manager may hold an additional operator-managed copy, but it is optional and outside the default workflow.

## 7. Stop, fund, and stake

Stopping the node does not stop or reboot the host:

```bash
./demosctl stop --confirm stop
./demosctl recovery check --for stake --confirm recovery-check:stake
./demosctl pubkey
```

Use the current network coordinator's approved faucet and staking instructions. The upstream guide currently points operators to [faucet.demos.sh](https://faucet.demos.sh) and the [`stabilisation` staking guide](https://github.com/kynesyslabs/node/blob/stabilisation/documentation/staking.md).

After funding the displayed public key:

```bash
./demosctl stake --confirm stake
```

The command first reopens the qualified archive with the second recovery-key copy and rechecks its identity against the live node. It refuses to stake unless that succeeds and `demos-node.service` is confirmed inactive.

## 8. Start and verify

```bash
./demosctl start --confirm start
./demosctl status
```

`status` reports three independent surfaces:

- systemd service state over SSH;
- the public RPC root signature;
- the SSH-local `/info` identity plus public `/info` and `/publickey`, including identity agreement and the configured connection URL.

All checks must pass before calling the node reachable and internally consistent. Testnet membership, correct genesis, synchronization, and validator acceptance still require the coordinator's current network-level verification.

## Routine operations

```bash
./demosctl status
./demosctl workspace
./demosctl history
./demosctl recovery check --for stake --confirm recovery-check:stake
./demosctl backup --confirm backup
./demosctl upgrade-operator --confirm upgrade-operator
./demosctl update --commit FULL_APPROVED_SHA --confirm update:FULL_APPROVED_SHA
./demosctl stop --confirm stop
./demosctl start --confirm start
```

`update` creates and fully qualifies a fresh encrypted backup first, refuses dirty or divergent Git state, verifies that the explicitly approved commit belongs to `origin/stabilisation` and descends from the installed commit, then checks out that exact revision and restarts the service. Run `status` afterward.

Successful mutating CLI actions append a value-free receipt to `.demos/operations.jsonl`. The log records time, target alias, action, and outcome only; it is local operator memory, not proof that the network accepted the node.

## Recovery and host reinstall

Before reinstalling the operating system, while the old host is still reachable:

```bash
./demosctl recovery check \
  --for reinstall \
  --confirm recovery-check:reinstall
```

This repeats decryption, isolated staging, digest, and live identity verification and creates a two-hour, host-bound authorization. It does not call a provider or reinstall anything. After reinstalling the same host with the existing SSH public key, consume that one-time authorization to pin the new SSH host key:

```bash
./demosctl retrust-host \
  --hostname 203.0.113.10 \
  --confirm retrust-host:203.0.113.10
```

Then run `./demosctl onboard --commit FULL_APPROVED_SHA`. The guide resets host-local progress after re-trust and walks through doctor, installation, credential setup, and restoration of the exact qualified identity archive. If the old host is already gone and no qualified archive plus recovery key exists, stop: this repository cannot recreate the lost node identity.

Restore leaves the service stopped:

```bash
./demosctl restore \
  --from .demos/backups/my-demos-node-TIMESTAMP.tar.age \
  --expected-public-key 0xYOUR_PREVIOUSLY_RECORDED_NODE_PUBLIC_KEY \
  --confirm restore
./demosctl start --confirm start
./demosctl status
```

There is deliberately no purge command. Never use `docker compose down -v` unless the node owner explicitly intends to destroy the node identity and all persisted state.

Configured recovery uses the persisted second key copy automatically. `--recovery-key PATH` permits an explicit recovery key. Older passphrase-encrypted archives require the deliberate `--legacy-passphrase` flag.

Before live state is touched, restore derives the public key from the staged archive and requires it to match the separately recorded expected key. Activation retains a rollback volume until the copied live state produces the same public key; a failed activation restores the prior live state or retains recovery volumes for manual intervention. Recovery commands provision the content-addressed helper image when it is absent, then run it with pulls disabled, networking disabled, and Linux capabilities removed.

## Current limitations

- Experimental public alpha; a disposable-host canary remains mandatory before live use.
- Operator-controlled Ubuntu host only; shared hosting is unsupported.
- Public routing and host firewall setup remain operator-managed.
- Network bootstrap peer and final chain-aware acceptance must be confirmed by the Kynesys maintainer.

## Contributing, security, and license

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes and [SECURITY.md](SECURITY.md) for private vulnerability reporting and operator boundaries. This starter is licensed under [CC BY-NC-SA 4.0](LICENSE.md). The upstream DEMOS node fetched during installation is a separate project governed by its own license and policies.
