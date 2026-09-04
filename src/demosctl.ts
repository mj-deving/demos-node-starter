#!/usr/bin/env bun

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

export type OperatorConfig = {
  schemaVersion: 1
  alias: string
  hostname: string
  user: string
  publicUrl: string
  identityFile: string
  upstreamRepo: "https://github.com/kynesyslabs/node.git"
  branch: string
  serviceName: "demos-node.service"
  remoteDir: "/opt/demos-node"
}

const ROOT = resolve(import.meta.dir, "..")
const STATE_DIR = resolve(process.env.DEMOSCTL_STATE_DIR || join(ROOT, ".demos"))
const CONFIG_PATH = join(STATE_DIR, "operator.json")
const SSH_CONFIG_PATH = join(STATE_DIR, "ssh_config")
const BACKUP_DIR = join(STATE_DIR, "backups")
const WORKSPACE_PATH = join(STATE_DIR, "WORKSPACE.md")
const OPERATIONS_LOG_PATH = join(STATE_DIR, "operations.jsonl")
const REMOTE_DIR = "/opt/demos-node"
const UPSTREAM_REPO = "https://github.com/kynesyslabs/node.git" as const
const SERVICE = "demos-node.service" as const
const MUTATIONS = new Set(["install", "restore", "stake", "start", "stop", "update"])

type Parsed = { command?: string; options: Map<string, string | true>; rest: string[] }

function parse(argv: string[]): Parsed {
  const [command, ...tail] = argv
  const options = new Map<string, string | true>()
  const rest: string[] = []
  for (let index = 0; index < tail.length; index += 1) {
    const token = tail[index]
    if (!token.startsWith("--")) {
      rest.push(token)
      continue
    }
    const name = token.slice(2)
    const next = tail[index + 1]
    if (next && !next.startsWith("--")) {
      options.set(name, next)
      index += 1
    } else {
      options.set(name, true)
    }
  }
  return { command, options, rest }
}

function option(parsed: Parsed, name: string, fallback?: string): string | undefined {
  const value = parsed.options.get(name)
  if (value === undefined || value === true) return fallback
  return value
}

function requiredOption(parsed: Parsed, name: string): string {
  const value = option(parsed, name)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function validateSimple(label: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value) || value.startsWith("-")) throw new Error(`invalid ${label}`)
  return value
}

function sshConfigValue(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("SSH identity path must not contain newlines")
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

export function validatePublicUrl(value: string): string {
  const parsed = new URL(value)
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("public URL must use http or https")
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("public URL must contain only scheme, host, and port")
  }
  if (parsed.port !== "53550") throw new Error("public URL must use port 53550")
  if (new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)) {
    throw new Error("public URL must be reachable by network peers")
  }
  return parsed.toString().replace(/\/$/, "")
}

function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  chmodSync(STATE_DIR, 0o700)
}

function writePrivate(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 })
  chmodSync(path, 0o600)
}

function appendOperation(config: OperatorConfig, action: string, outcome = "completed"): void {
  ensureStateDir()
  const entry = { timestamp: new Date().toISOString(), target: config.alias, action, outcome }
  writeFileSync(OPERATIONS_LOG_PATH, `${JSON.stringify(entry)}\n`, { mode: 0o600, flag: "a" })
  chmodSync(OPERATIONS_LOG_PATH, 0o600)
}

function refreshWorkspace(config: OperatorConfig): void {
  const content = `# Local DEMOS Node Workspace\n\nThis generated file is private, gitignored operator memory. It contains locations and identifiers, never secret values.\n\n## Target\n\n- Alias: \`${config.alias}\`\n- Host: \`${config.hostname}\`\n- Public URL: \`${config.publicUrl}\`\n- SSH identity: \`${config.identityFile}\`\n- Upstream: \`${config.upstreamRepo}\`\n- Branch: \`${config.branch}\`\n- Remote directory: \`${config.remoteDir}\`\n- Service: \`${config.serviceName}\`\n\n## Canonical locations\n\n- Local configuration: \`${CONFIG_PATH}\`\n- Local SSH configuration: \`${SSH_CONFIG_PATH}\`\n- Encrypted identity backups: \`${BACKUP_DIR}\`\n- Value-free operation history: \`${OPERATIONS_LOG_PATH}\`\n- Remote secret environment: \`/etc/demos-node/node.env\` (never read back)\n- Remote node state: Docker volume \`demos_node_state\`\n\n## Safe next checks\n\n\`\`\`bash\n./demosctl doctor\n./demosctl secrets doctor\n./demosctl status\n./demosctl history\n\`\`\`\n`
  writePrivate(WORKSPACE_PATH, content)
}

export function readConfig(): OperatorConfig {
  if (!existsSync(CONFIG_PATH)) throw new Error("operator state missing; run ./demosctl init first")
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<OperatorConfig>
  if (
    config.schemaVersion !== 1 ||
    !config.alias ||
    !config.hostname ||
    !config.user ||
    !config.publicUrl ||
    !config.identityFile ||
    config.upstreamRepo !== UPSTREAM_REPO ||
    !config.branch ||
    config.serviceName !== SERVICE ||
    config.remoteDir !== REMOTE_DIR
  ) {
    throw new Error("operator state has an invalid or unsupported shape")
  }
  if ((statSync(CONFIG_PATH).mode & 0o077) !== 0) throw new Error("operator state permissions must be 0600")
  validatePublicUrl(config.publicUrl)
  return config as OperatorConfig
}

function binary(name: string): string {
  const override = process.env[`DEMOSCTL_${name.toUpperCase().replaceAll("-", "_")}_BIN`]
  const path = override || Bun.which(name)
  if (!path) throw new Error(`required command not found: ${name}`)
  return path
}

function sshArgs(config: OperatorConfig, remoteArgs: string[] = []): string[] {
  return ["-F", SSH_CONFIG_PATH, "-o", "BatchMode=yes", config.alias, ...remoteArgs]
}

function runChecked(command: string, args: string[], options: { stdin?: Blob | Uint8Array | "inherit"; stdout?: "inherit" | "pipe" } = {}): string {
  const result = Bun.spawnSync([command, ...args], {
    cwd: ROOT,
    stdin: options.stdin ?? "inherit",
    stdout: options.stdout ?? "inherit",
    stderr: "inherit",
    env: process.env,
  })
  if (result.exitCode !== 0) throw new Error(`${basename(command)} exited ${result.exitCode}`)
  return result.stdout ? result.stdout.toString() : ""
}

function requireConfirmation(parsed: Parsed): void {
  const command = parsed.command || ""
  if (MUTATIONS.has(command) && option(parsed, "confirm") !== command) {
    throw new Error(`refusing remote mutation; pass --confirm ${command}`)
  }
}

export function initCommand(parsed: Parsed): void {
  const alias = validateSimple("alias", requiredOption(parsed, "alias"), /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/)
  const hostname = validateSimple("hostname", requiredOption(parsed, "hostname"), /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/)
  const user = validateSimple("user", option(parsed, "user", "root")!, /^[a-z_][a-z0-9_-]{0,31}$/)
  const branch = validateSimple("branch", option(parsed, "branch", "stabilisation")!, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/)
  const publicUrl = validatePublicUrl(requiredOption(parsed, "public-url"))
  const identityFile = resolve(option(parsed, "identity-file", join(homedir(), ".ssh", `demos-node-${alias}`))!)

  ensureStateDir()
  if (parsed.options.has("skip-keygen") && process.env.DEMOSCTL_TEST_MODE !== "1") {
    throw new Error("--skip-keygen is reserved for isolated tests")
  }
  if (!parsed.options.has("skip-keygen") && !existsSync(identityFile)) {
    mkdirSync(dirname(identityFile), { recursive: true, mode: 0o700 })
    console.log(`Creating a dedicated passphrase-protected SSH identity at ${identityFile}`)
    runChecked(binary("ssh-keygen"), ["-t", "ed25519", "-a", "100", "-f", identityFile, "-C", `demos-node-${alias}`])
  }

  const config: OperatorConfig = {
    schemaVersion: 1,
    alias,
    hostname,
    user,
    publicUrl,
    identityFile,
    upstreamRepo: UPSTREAM_REPO,
    branch,
    serviceName: SERVICE,
    remoteDir: REMOTE_DIR,
  }
  writePrivate(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
  writePrivate(
    SSH_CONFIG_PATH,
    `Host ${alias}\n  HostName ${hostname}\n  User ${user}\n  IdentityFile ${sshConfigValue(identityFile)}\n  IdentitiesOnly yes\n  StrictHostKeyChecking ask\n`,
  )
  refreshWorkspace(config)
  appendOperation(config, "init")
  console.log("Operator state initialized. Provision only the .pub key on the node host, then run ./demosctl doctor.")
}

function doctorCommand(parsed: Parsed): void {
  const config = readConfig()
  if (!existsSync(config.identityFile) || !existsSync(`${config.identityFile}.pub`)) {
    throw new Error("dedicated SSH identity or public key is missing")
  }
  if ((statSync(config.identityFile).mode & 0o077) !== 0) throw new Error("SSH private-key permissions must be 0600")
  const required = ["bun", "git", "ssh", "ssh-keygen", "age"]
  const local = Object.fromEntries(required.map((name) => [name, binary(name)]))
  const result: Record<string, unknown> = { local: "ok", commands: local, config: "ok" }
  if (!parsed.options.has("local-only")) {
    const output = runChecked(binary("ssh"), sshArgs(config, ["uname -s; test \"$(id -u)\" -eq 0; command -v sudo >/dev/null; printf REMOTE_OK"]), { stdout: "pipe" })
    if (!output.includes("Linux") || !output.includes("REMOTE_OK")) throw new Error("remote must be Linux with root SSH and sudo")
    result.ssh = "ok"
    result.remote = "linux-root"
  }
  console.log(JSON.stringify(result, null, 2))
}

function installCommand(config: OperatorConfig): void {
  const script = readFileSync(join(ROOT, "scripts", "remote-bootstrap.sh"))
  runChecked(binary("ssh"), sshArgs(config, ["bash", "-s", "--", "--public-url", config.publicUrl, "--branch", config.branch]), {
    stdin: new Uint8Array(script),
  })
  appendOperation(config, "install")
  console.log("Install completed. This proves the service action completed, not testnet readiness; run ./demosctl status.")
}

function secretsCommand(config: OperatorConfig, parsed: Parsed): void {
  if (parsed.rest[0] === "doctor") {
    runChecked(binary("ssh"), sshArgs(config, ["sudo -n /usr/local/sbin/demos-secret-status"]))
    return
  }
  if (parsed.rest[0] !== "configure") throw new Error("usage: ./demosctl secrets configure|doctor")
  const args = [join(ROOT, "scripts", "configure-secrets.sh"), "--ssh-config", SSH_CONFIG_PATH, "--host", config.alias]
  if (parsed.options.has("ffi")) args.push("--ffi")
  runChecked("bash", args)
  appendOperation(config, "secrets-configure")
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "").replaceAll("-", "").replace(/\.\d{3}Z$/, "Z")
}

async function backupCommand(config: OperatorConfig): Promise<string> {
  binary("age")
  mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 })
  const outputPath = join(BACKUP_DIR, `${config.alias}-${timestamp()}.tar.age`)
  const remote = "sudo -n docker volume inspect demos_node_state >/dev/null && sudo -n docker run --rm -v demos_node_state:/state:ro alpine:3.20 sh -ec 'test -s /state/.demos_identity; tar -C /state -cf - .'"
  const ssh = Bun.spawn([binary("ssh"), ...sshArgs(config, [remote])], { cwd: ROOT, stdout: "pipe", stderr: "inherit" })
  const age = Bun.spawn([binary("age"), "-p", "-o", outputPath], { cwd: ROOT, stdin: ssh.stdout, stdout: "inherit", stderr: "inherit" })
  const [sshExit, ageExit] = await Promise.all([ssh.exited, age.exited])
  if (sshExit !== 0 || ageExit !== 0 || !existsSync(outputPath) || statSync(outputPath).size === 0) {
    if (existsSync(outputPath)) unlinkSync(outputPath)
    throw new Error("encrypted backup failed or was empty")
  }
  chmodSync(outputPath, 0o600)
  console.log(`Encrypted backup created: ${outputPath}`)
  appendOperation(config, "backup")
  return outputPath
}

async function restoreCommand(config: OperatorConfig, parsed: Parsed): Promise<void> {
  const source = resolve(requiredOption(parsed, "from"))
  if (!existsSync(source) || statSync(source).size === 0 || !source.endsWith(".age")) throw new Error("--from must be a non-empty .age backup")
  const stagingVolume = `demos_node_state_restore_${Date.now()}`
  const rollbackVolume = `demos_node_state_rollback_${Date.now()}`
  const age = Bun.spawn([binary("age"), "-d", source], { cwd: ROOT, stdout: "pipe", stderr: "inherit" })
  const stageRemote = `sudo -n docker volume create ${stagingVolume} >/dev/null && sudo -n docker run --rm -i -v ${stagingVolume}:/state alpine:3.20 sh -ec 'tar -C /state -xf -; test -s /state/.demos_identity'`
  const ssh = Bun.spawn([binary("ssh"), ...sshArgs(config, [stageRemote])], { cwd: ROOT, stdin: age.stdout, stdout: "inherit", stderr: "inherit" })
  const [ageExit, sshExit] = await Promise.all([age.exited, ssh.exited])
  if (ageExit !== 0 || sshExit !== 0) {
    throw new Error(`backup validation/staging failed; live state was not touched (staging volume: ${stagingVolume})`)
  }
  const activateRemote = [
    `sudo -n systemctl stop ${SERVICE}`,
    "sudo -n docker volume inspect demos_node_state >/dev/null",
    `sudo -n docker volume create ${rollbackVolume} >/dev/null`,
    `sudo -n docker run --rm -v demos_node_state:/source:ro -v ${rollbackVolume}:/target alpine:3.20 sh -ec 'cp -a /source/. /target/; test -s /target/.demos_identity'`,
    `(sudo -n docker run --rm -v ${stagingVolume}:/source:ro -v demos_node_state:/target alpine:3.20 sh -ec 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; cp -a /source/. /target/; test -s /target/.demos_identity' || { echo 'activation failed; restoring rollback volume' >&2; sudo -n docker run --rm -v ${rollbackVolume}:/source:ro -v demos_node_state:/target alpine:3.20 sh -ec 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; cp -a /source/. /target/; test -s /target/.demos_identity'; exit 1; })`,
    `sudo -n docker volume rm ${stagingVolume} ${rollbackVolume} >/dev/null`,
    `systemctl show ${SERVICE} --property=LoadState,ActiveState,SubState --no-pager`,
  ].join(" && ")
  runChecked(binary("ssh"), sshArgs(config, [activateRemote]))
  appendOperation(config, "restore")
  console.log("State restored. The node remains stopped; run ./demosctl start --confirm start separately.")
}

function serviceCommand(config: OperatorConfig, action: "start" | "stop"): void {
  const remote = `sudo -n systemctl ${action} ${SERVICE} && systemctl show ${SERVICE} --property=LoadState,ActiveState,SubState --no-pager`
  runChecked(binary("ssh"), sshArgs(config, [remote]))
  appendOperation(config, action)
  console.log(action === "start" ? "Service start completed; run status before claiming readiness." : "Node service stopped; the VPS remains running.")
}

function pubkeyCommand(config: OperatorConfig): void {
  const remote = `cd ${REMOTE_DIR} && if systemctl is-active --quiet ${SERVICE}; then sudo -n docker compose --env-file .env --env-file /etc/demos-node/node.env exec -T node bun run show:pubkey; else sudo -n docker compose --env-file .env --env-file /etc/demos-node/node.env run --rm node bun run show:pubkey; fi`
  runChecked(binary("ssh"), sshArgs(config, [remote]))
}

function stakeCommand(config: OperatorConfig): void {
  const remote = `! systemctl is-active --quiet ${SERVICE} && cd ${REMOTE_DIR} && sudo -n docker compose --env-file .env --env-file /etc/demos-node/node.env run --rm node bun run validator:stake`
  runChecked(binary("ssh"), sshArgs(config, [remote]))
  appendOperation(config, "stake")
  console.log("Stake command completed. Verify validator/network state before starting the node.")
}

async function updateCommand(config: OperatorConfig): Promise<void> {
  await backupCommand(config)
  const remote = [
    `cd ${REMOTE_DIR}`,
    `test \"$(git remote get-url origin)\" = \"${UPSTREAM_REPO}\"`,
    `test \"$(git branch --show-current)\" = \"${config.branch}\"`,
    `test -z \"$(git status --porcelain)\"`,
    `sudo -n git fetch origin ${config.branch}`,
    `sudo -n git merge --ff-only origin/${config.branch}`,
    `sudo -n systemctl restart ${SERVICE}`,
    `systemctl show ${SERVICE} --property=LoadState,ActiveState,SubState,InvocationID --no-pager`,
  ].join(" && ")
  runChecked(binary("ssh"), sshArgs(config, [remote]))
  appendOperation(config, "update")
  console.log("Fast-forward update and service restart completed; run status before claiming readiness.")
}

async function getJson(url: string): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { "cache-control": "no-cache" } })
    const text = await response.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {}
    return { ok: response.ok, status: response.status, body }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function statusCommand(config: OperatorConfig): Promise<void> {
  let service: { ok: boolean; output?: string; localIdentity?: string; error?: string }
  try {
    const marker = "---DEMOS-LOCAL-INFO---"
    const output = runChecked(binary("ssh"), sshArgs(config, [`systemctl show ${SERVICE} --property=LoadState,ActiveState,SubState,Result,NRestarts --no-pager && printf '\\n${marker}\\n' && curl -fsS http://127.0.0.1:53550/info`]), { stdout: "pipe" })
    const [serviceOutput, localInfoText] = output.split(marker)
    const localInfo = JSON.parse(localInfoText.trim()) as Record<string, unknown>
    const localIdentity = typeof localInfo.identity === "string" ? localInfo.identity : undefined
    service = { ok: serviceOutput.includes("ActiveState=active") && serviceOutput.includes("SubState=running") && Boolean(localIdentity), output: serviceOutput.trim(), localIdentity }
  } catch (error) {
    service = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const [root, info, publicKey] = await Promise.all([
    getJson(`${config.publicUrl}/`),
    getJson(`${config.publicUrl}/info`),
    getJson(`${config.publicUrl}/publickey`),
  ])
  const rootBody = root.body as Record<string, unknown> | undefined
  const infoBody = info.body as Record<string, unknown> | undefined
  const rootValid = root.ok && rootBody?.message === "Hello, World!"
  const infoValid = info.ok && typeof infoBody?.version === "string" && typeof infoBody?.identity === "string" && infoBody.connectionString === config.publicUrl
  const publicKeyValid = publicKey.ok && typeof publicKey.body === "string" && publicKey.body === infoBody?.identity && publicKey.body === service.localIdentity
  const report = {
    target: config.alias,
    publicUrl: config.publicUrl,
    service,
    rpc: { ...root, valid: rootValid },
    info: { ...info, valid: infoValid },
    publicKey: { ...publicKey, valid: publicKeyValid },
  }
  console.log(JSON.stringify(report, null, 2))
  if (!service.ok || !rootValid || !infoValid || !publicKeyValid) throw new Error("node readiness evidence is incomplete or targets a different node")
}

function sshCommand(config: OperatorConfig): void {
  runChecked(binary("ssh"), ["-F", SSH_CONFIG_PATH, config.alias])
}

function workspaceCommand(config: OperatorConfig): void {
  refreshWorkspace(config)
  console.log(`Workspace memory refreshed: ${WORKSPACE_PATH}`)
}

function historyCommand(): void {
  if (!existsSync(OPERATIONS_LOG_PATH)) {
    console.log("No local operation history recorded yet.")
    return
  }
  process.stdout.write(readFileSync(OPERATIONS_LOG_PATH, "utf8"))
}

function usage(): void {
  console.log(`DEMOS node starter

Usage:
  ./demosctl init --alias NAME --hostname HOST --public-url http://HOST:53550 [--user root]
  ./demosctl doctor [--local-only]
  ./demosctl ssh
  ./demosctl install --confirm install
  ./demosctl secrets configure [--ffi]
  ./demosctl secrets doctor
  ./demosctl pubkey
  ./demosctl backup
  ./demosctl restore --from PATH --confirm restore
  ./demosctl stake --confirm stake
  ./demosctl status
  ./demosctl workspace
  ./demosctl history
  ./demosctl stop --confirm stop
  ./demosctl start --confirm start
  ./demosctl update --confirm update`)
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parse(argv)
  if (!parsed.command || parsed.command === "help" || parsed.options.has("help")) {
    usage()
    return
  }
  if (parsed.command === "init") return initCommand(parsed)
  const config = readConfig()
  requireConfirmation(parsed)
  switch (parsed.command) {
    case "doctor": return doctorCommand(parsed)
    case "ssh": return sshCommand(config)
    case "install": return installCommand(config)
    case "secrets": return secretsCommand(config, parsed)
    case "pubkey": return pubkeyCommand(config)
    case "backup": await backupCommand(config); return
    case "restore": await restoreCommand(config, parsed); return
    case "stake": return stakeCommand(config)
    case "status": await statusCommand(config); return
    case "workspace": return workspaceCommand(config)
    case "history": return historyCommand()
    case "stop": return serviceCommand(config, "stop")
    case "start": return serviceCommand(config, "start")
    case "update": await updateCommand(config); return
    default: throw new Error(`unknown command: ${parsed.command}`)
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
