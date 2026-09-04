# DEMOS Node Starter

A security-first, Codex-assisted operator kit for running one DEMOS testnet node on an operator-controlled Ubuntu host. This repository is an experimental public alpha: inspect every approved upstream commit and use a disposable Ubuntu host before operating valuable identity material.

The host can be a cloud VPS from any provider, dedicated hardware, or a suitable local Ubuntu system. The starter connects through SSH and begins after the operator has prepared the host and its network access.

## What you need

- An operator-controlled amd64/x86-64 Ubuntu 22.04 or 24.04 host with at least 4 CPU cores, 4 GB RAM, and SSD storage. ARM hosts are not supported because the required upstream TLSNotary image is currently amd64-only.
- A publicly reachable IP or DNS endpoint for the node, with TCP ports `53550` and `53551` routed to the host.
- A Mac, Linux, or Windows-with-WSL workstation with Git, Bun, OpenSSH, and `age`.
- Codex in the ChatGPT desktop app, CLI, or IDE extension. Use workspace permissions with approvals; do not enable unrestricted Full Access for node operations.
- Your own GitHub, Etherscan, and Helius accounts if the current testnet coordinator requires those features.

The upstream node currently treats external API keys as optional feature credentials. Do not create broad credentials until the network maintainer confirms the exact requirement. In particular, GitHub recommends fine-grained access over classic tokens; a classic `repo` token reaches every repository the operator can access.

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

## 2. Create the dedicated SSH identity

From your host's authenticated console, copy its OpenSSH host-key fingerprint in `SHA256:...` format. This must come from a channel independent of SSH. Choose a short local alias and substitute the real host, URL, and fingerprint:

```bash
./demosctl init \
  --alias my-demos-node \
  --hostname 203.0.113.10 \
  --public-url http://203.0.113.10:53550 \
  --host-key-sha256 SHA256:REPLACE_WITH_CONSOLE_FINGERPRINT
```

The command verifies the host key, asks for a passphrase, and creates a new dedicated Ed25519 key. It refuses to reuse an existing key or overwrite existing operator state. Add **only** the matching `.pub` file through your host-management console or the host's `authorized_keys`. Never upload or paste the private key.

Load the key into your local SSH agent with `ssh-add <identity-file>` before running unattended checks. `./demosctl workspace` writes a private, gitignored `.demos/WORKSPACE.md` system map for future operators and Codex sessions.

The example address `203.0.113.10` is documentation-only. Use the real address or DNS name routed to your host.

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

## 5. Configure individually owned credentials

Create credentials only in the issuing service's own dashboard:

- [GitHub token security](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Etherscan API setup](https://docs.etherscan.io/introduction)
- [Helius API-key authentication](https://www.helius.dev/docs/api-reference/authentication)

Then enter them through hidden terminal prompts:

```bash
./demosctl secrets configure --confirm secrets
```

The values stream through SSH stdin into `/etc/demos-node/node.env`. They are not written to the workstation, passed as command arguments, or read back. Empty fields stay unset. Restarting remains a separate decision.

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

Shared Discord, RapidAPI, Nomis, GitHub, or other credentials copied from chat must not be used. If a credential has appeared in chat or Git, rotate it first.

## 6. Back up identity and inspect the public key

```bash
./demosctl backup
./demosctl pubkey
```

`backup` streams the `demos_node_state` volume through passphrase encryption into `.demos/backups/`. No plaintext archive is created. Store a second copy of the encrypted file somewhere durable.

## 7. Stop, fund, and stake

Stopping the node does not stop or reboot the host:

```bash
./demosctl stop --confirm stop
./demosctl pubkey
```

Use the current network coordinator's approved faucet and staking instructions. The upstream guide currently points operators to [faucet.demos.sh](https://faucet.demos.sh) and the [`stabilisation` staking guide](https://github.com/kynesyslabs/node/blob/stabilisation/documentation/staking.md).

After funding the displayed public key:

```bash
./demosctl stake --confirm stake
```

The command refuses to stake while `demos-node.service` is active.

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
./demosctl backup
./demosctl update --commit FULL_APPROVED_SHA --confirm update:FULL_APPROVED_SHA
./demosctl stop --confirm stop
./demosctl start --confirm start
```

`update` creates an encrypted backup first, refuses dirty or divergent Git state, verifies that the explicitly approved commit belongs to `origin/stabilisation` and descends from the installed commit, then checks out that exact revision and restarts the service. Run `status` afterward.

Successful mutating CLI actions append a value-free receipt to `.demos/operations.jsonl`. The log records time, target alias, action, and outcome only; it is local operator memory, not proof that the network accepted the node.

## Recovery

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

Before live state is touched, restore derives the public key from the staged archive and requires it to match the separately recorded expected key. Recovery commands provision the content-addressed helper image when it is absent, then run it with pulls disabled, networking disabled, and Linux capabilities removed.

## Current limitations

- Experimental public alpha; a disposable-host canary remains mandatory before live use.
- Operator-controlled Ubuntu host only; shared hosting is unsupported.
- Public routing and host firewall setup remain operator-managed.
- Network bootstrap peer and final chain-aware acceptance must be confirmed by the Kynesys maintainer.

## Contributing, security, and license

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes and [SECURITY.md](SECURITY.md) for private vulnerability reporting and operator boundaries. This starter is licensed under [CC BY-NC-SA 4.0](LICENSE.md). The upstream DEMOS node fetched during installation is a separate project governed by its own license and policies.
