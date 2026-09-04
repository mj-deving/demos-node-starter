# DEMOS Node Starter

A beginner-safe, Codex-assisted operator kit for running one DEMOS testnet node on a dedicated Ubuntu VPS.

This repository manages the node through SSH. It does **not** purchase, reboot, reinstall, stop, or delete a VPS, and it does not use the Contabo API.

## What you need

- A dedicated Ubuntu 22.04 or 24.04 VPS with at least 4 CPU cores, 4 GB RAM, SSD storage, and a public IPv4 address.
- TCP ports `53550` and `53551` allowed by the provider firewall.
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

Choose a short local alias and substitute the VPS public IP:

```bash
./demosctl init \
  --alias my-demos-node \
  --hostname 203.0.113.10 \
  --public-url http://203.0.113.10:53550
```

The command asks for a passphrase and creates a dedicated Ed25519 key. Upload **only** the matching `.pub` file through the Contabo control panel. Never upload or paste the private key.

Load the key into your local SSH agent with `ssh-add <identity-file>` before running unattended checks. `./demosctl workspace` writes a private, gitignored `.demos/WORKSPACE.md` system map for future operators and Codex sessions.

The example address `203.0.113.10` is documentation-only. Use the real address assigned to your VPS.

## 3. Verify access without changing the VPS

```bash
./demosctl doctor
```

The doctor checks local dependencies, state-file permissions, root SSH authentication, and that the target is Linux. It does not install or stop anything.

## 4. Install the node

Review the exact target shown by `.demos/operator.json`, then run:

```bash
./demosctl install --confirm install
```

The installer:

- accepts only Ubuntu on a dedicated VPS;
- installs Docker from Docker's official Ubuntu repository;
- creates a non-sudo `demos` runtime user;
- clones `https://github.com/kynesyslabs/node.git` on `stabilisation` into `/opt/demos-node`;
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
./demosctl secrets configure
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
./demosctl secrets configure --ffi
```

Shared Discord, RapidAPI, Nomis, GitHub, or other credentials copied from chat must not be used. If a credential has appeared in chat or Git, rotate it first.

## 6. Back up identity and inspect the public key

```bash
./demosctl backup
./demosctl pubkey
```

`backup` streams the `demos_node_state` volume through passphrase encryption into `.demos/backups/`. No plaintext archive is created. Store a second copy of the encrypted file somewhere durable.

## 7. Stop, fund, and stake

Stopping the node does not stop the VPS:

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
./demosctl update --confirm update
./demosctl stop --confirm stop
./demosctl start --confirm start
```

`update` creates an encrypted backup first, refuses dirty or divergent Git state, fast-forwards only from `origin/stabilisation`, and then restarts the node service. Run `status` afterward.

Successful mutating CLI actions append a value-free receipt to `.demos/operations.jsonl`. The log records time, target alias, action, and outcome only; it is local operator memory, not proof that the network accepted the node.

## Recovery

Restore leaves the service stopped:

```bash
./demosctl restore --from .demos/backups/my-demos-node-TIMESTAMP.tar.age --confirm restore
./demosctl start --confirm start
./demosctl status
```

There is deliberately no purge command. Never use `docker compose down -v` unless the node owner explicitly intends to destroy the node identity and all persisted state.

## Current alpha limits

- Private alpha; not yet approved for public redistribution or live-node rollout.
- Dedicated Ubuntu VPS only.
- Provider firewall setup remains manual.
- Network bootstrap peer and final chain-aware acceptance must be confirmed by the Kynesys maintainer.
- No Contabo API integration.
