#!/usr/bin/env bun

import { chmodSync, constants as fsConstants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

export type OperatorConfig = {
  schemaVersion: 1
  alias: string
  hostname: string
  user: string
  publicUrl: string
  identityFile: string
  hostKeyTrust?: "verified" | "first-use"
  hostKeyFingerprint?: string
  upstreamRepo: "https://github.com/kynesyslabs/node.git"
  branch: string
  serviceName: "demos-node.service"
  remoteDir: "/opt/demos-node"
}

type PreparedIdentity = {
  schemaVersion: 1
  alias: string
  identityFile: string
  publicKeyFingerprint: string
}

type RecoveryConfig = {
  schemaVersion: 1
  alias: string
  hostname: string
  store: "local-file"
  primaryKeyPath: string
  recoveryCopyPath: string
  recipient: string
  createdAt: string
}

type RecoveryReceipt = {
  schemaVersion: 1
  alias: string
  hostname: string
  store: "local-file"
  archivePath: string
  archiveSha256: string
  archiveSize: number
  expectedPublicKey: string
  recipient: string
  qualifiedAt: string
}

type ReinstallAuthorization = {
  schemaVersion: 1
  alias: string
  hostname: string
  archiveSha256: string
  expectedPublicKey: string
  authorizedAt: string
  expiresAt: string
}

type RecoveryCheckReceipt = {
  schemaVersion: 1
  alias: string
  hostname: string
  purpose: "stake"
  archiveSha256: string
  expectedPublicKey: string
  checkedAt: string
  expiresAt: string
}

const ROOT = resolve(import.meta.dir, "..")
const STATE_DIR = resolve(process.env.DEMOSCTL_STATE_DIR || join(ROOT, ".demos"))
const CONFIG_PATH = join(STATE_DIR, "operator.json")
const SSH_CONFIG_PATH = join(STATE_DIR, "ssh_config")
const BACKUP_DIR = join(STATE_DIR, "backups")
const WORKSPACE_PATH = join(STATE_DIR, "WORKSPACE.md")
const OPERATIONS_LOG_PATH = join(STATE_DIR, "operations.jsonl")
const PREPARED_IDENTITY_PATH = join(STATE_DIR, "prepared-identity.json")
const RECOVERY_CONFIG_PATH = join(STATE_DIR, "recovery.json")
const RECOVERY_RECEIPT_PATH = join(STATE_DIR, "recovery-receipt.json")
const REINSTALL_AUTH_PATH = join(STATE_DIR, "reinstall-authorization.json")
const REINSTALL_CLAIM_PATH = join(STATE_DIR, "reinstall-authorization.claimed.json")
const RECOVERY_CHECK_PATH = join(STATE_DIR, "recovery-check-stake.json")
const REMOTE_DIR = "/opt/demos-node"
const UPSTREAM_REPO = "https://github.com/kynesyslabs/node.git" as const
const SERVICE = "demos-node.service" as const
const HELPER_IMAGE = "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"
const MUTATIONS = new Set(["restore", "stake", "start", "stop", "backup"])

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

function validateCommit(value: string): string {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("commit must be a full 40-character lowercase SHA-1")
  return value
}

function validateHostKeyFingerprint(value: string): string {
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(value)) throw new Error("host-key fingerprint must use OpenSSH SHA256 format")
  return value
}

export function validateNodePublicKey(value: string): string {
  if (!/^0x[0-9a-f]{64}$/.test(value)) throw new Error("node public key must be 0x followed by exactly 64 lowercase hexadecimal characters")
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

function writePrivateAtomic(path: string, content: string): void {
  const temporary = `${path}.new-${process.pid}`
  try {
    writePrivate(temporary, content)
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

function renderSshConfig(config: OperatorConfig): string {
  return `Host ${config.alias}\n  HostName ${config.hostname}\n  User ${config.user}\n  IdentityFile ${sshConfigValue(config.identityFile)}\n  IdentitiesOnly yes\n  UserKnownHostsFile ${sshConfigValue(join(STATE_DIR, "known_hosts"))}\n  StrictHostKeyChecking yes\n`
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
}

function validateRecoveryKeyPath(value: string, label: string): string {
  const candidate = resolve(value)
  const physicalRoot = existsSync(ROOT) ? realpathSync(ROOT) : ROOT
  const parent = dirname(candidate)
  const physicalCandidate = existsSync(parent) ? join(realpathSync(parent), basename(candidate)) : candidate
  if (pathIsWithin(physicalRoot, physicalCandidate) || pathIsWithin(STATE_DIR, physicalCandidate)) {
    throw new Error(`${label} must be outside the repository and operator state directory`)
  }
  return candidate
}

function validatePrivateRegularFile(path: string, label: string): void {
  if (!existsSync(path)) throw new Error(`${label} is missing`)
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular file, not a symlink`)
  if ((info.mode & 0o077) !== 0) throw new Error(`${label} permissions must be 0600`)
  if (info.size === 0) throw new Error(`${label} is empty`)
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256")
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
  return hasher.digest("hex")
}

function appendOperation(config: OperatorConfig, action: string, outcome = "completed"): void {
  ensureStateDir()
  const entry = { timestamp: new Date().toISOString(), target: config.alias, action, outcome }
  writeFileSync(OPERATIONS_LOG_PATH, `${JSON.stringify(entry)}\n`, { mode: 0o600, flag: "a" })
  chmodSync(OPERATIONS_LOG_PATH, 0o600)
}

function refreshWorkspace(config: OperatorConfig): void {
  const content = `# Local DEMOS Node Workspace\n\nThis generated file is private, gitignored operator memory. It contains locations and identifiers, never secret values.\n\n## Target\n\n- Alias: \`${config.alias}\`\n- Host: \`${config.hostname}\`\n- Public URL: \`${config.publicUrl}\`\n- SSH identity: \`${config.identityFile}\`\n- SSH host trust: \`${config.hostKeyTrust || "legacy-unrecorded"}\`\n- Pinned SSH fingerprint: \`${config.hostKeyFingerprint || "legacy-unrecorded"}\`\n- Upstream: \`${config.upstreamRepo}\`\n- Branch: \`${config.branch}\`\n- Remote directory: \`${config.remoteDir}\`\n- Service: \`${config.serviceName}\`\n\n## Canonical locations\n\n- Local configuration: \`${CONFIG_PATH}\`\n- Local SSH configuration: \`${SSH_CONFIG_PATH}\`\n- Recovery-key locations and public recipient: \`${RECOVERY_CONFIG_PATH}\` (value-free)\n- Latest qualified-backup receipt: \`${RECOVERY_RECEIPT_PATH}\` (value-free)\n- Encrypted identity backups: \`${BACKUP_DIR}\`\n- Value-free operation history: \`${OPERATIONS_LOG_PATH}\`\n- Remote secret environment: \`/etc/demos-node/node.env\` (never read back)\n- Remote node state: Docker volume \`demos_node_state\`\n\n## Safe next checks\n\n\`\`\`bash\n./demosctl onboard\n./demosctl doctor\n./demosctl secrets doctor\n./demosctl recovery status\n./demosctl status\n./demosctl history\n\`\`\`\n`
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
  validateSimple("alias", config.alias, /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/)
  validateSimple("hostname", config.hostname, /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/)
  validateSimple("user", config.user, /^[a-z_][a-z0-9_-]{0,31}$/)
  validateSimple("branch", config.branch, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/)
  validatePublicUrl(config.publicUrl)
  if (config.hostKeyTrust !== undefined && !new Set(["verified", "first-use"]).has(config.hostKeyTrust)) {
    throw new Error("operator state has an invalid SSH host trust mode")
  }
  if (config.hostKeyFingerprint !== undefined) validateHostKeyFingerprint(config.hostKeyFingerprint)
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

function removeIdentityPair(identityFile: string): void {
  if (existsSync(identityFile)) unlinkSync(identityFile)
  if (existsSync(`${identityFile}.pub`)) unlinkSync(`${identityFile}.pub`)
}

function createIdentity(identityFile: string, alias: string): void {
  if (existsSync(identityFile) || existsSync(`${identityFile}.pub`)) {
    throw new Error("refusing to reuse an existing SSH key; choose a new --identity-file path")
  }
  mkdirSync(dirname(identityFile), { recursive: true, mode: 0o700 })
  console.log(`Creating a dedicated passphrase-protected SSH identity at ${identityFile}`)
  try {
    runChecked(binary("ssh-keygen"), ["-t", "ed25519", "-a", "100", "-f", identityFile, "-C", `demos-node-${alias}`])
    if (!existsSync(identityFile) || !existsSync(`${identityFile}.pub`)) throw new Error("ssh-keygen did not create a complete identity pair")
    chmodSync(identityFile, 0o600)
  } catch (error) {
    removeIdentityPair(identityFile)
    throw error
  }
}

function validateIdentityPath(identityFile: string): string {
  const stateRoot = existsSync(STATE_DIR) ? realpathSync(STATE_DIR) : STATE_DIR
  const parent = dirname(identityFile)
  const physicalIdentity = existsSync(parent) ? join(realpathSync(parent), basename(identityFile)) : identityFile
  const fromState = relative(stateRoot, physicalIdentity)
  if (fromState === "" || (fromState !== ".." && !fromState.startsWith(`..${sep}`) && !isAbsolute(fromState))) {
    throw new Error("SSH identity must be stored outside the operator state directory")
  }
  return identityFile
}

function identityFingerprint(path: string): string {
  const output = runChecked(binary("ssh-keygen"), ["-lf", path, "-E", "sha256"], { stdout: "pipe" })
  if (!output.includes("(ED25519)")) throw new Error("prepared SSH identity must be Ed25519")
  const fingerprint = output.split(/\s+/).find((part) => part.startsWith("SHA256:"))
  if (!fingerprint) throw new Error("prepared SSH identity has no valid fingerprint")
  return validateHostKeyFingerprint(fingerprint)
}

function prepareKeyCommand(parsed: Parsed): void {
  const alias = validateSimple("alias", requiredOption(parsed, "alias"), /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/)
  const identityFile = validateIdentityPath(resolve(option(parsed, "identity-file", join(homedir(), ".ssh", `demos-node-${alias}`))!))
  const operatorOutputs = [CONFIG_PATH, SSH_CONFIG_PATH, join(STATE_DIR, "known_hosts"), WORKSPACE_PATH, OPERATIONS_LOG_PATH, PREPARED_IDENTITY_PATH]
  if (operatorOutputs.some((path) => existsSync(path))) throw new Error("operator or prepared-identity state already exists; use a separate clone/state directory or archive it manually")
  ensureStateDir()
  createIdentity(identityFile, alias)
  try {
    const privateFingerprint = identityFingerprint(identityFile)
    const publicFingerprint = identityFingerprint(`${identityFile}.pub`)
    if (privateFingerprint !== publicFingerprint) throw new Error("generated SSH private and public keys do not match")
    const prepared: PreparedIdentity = { schemaVersion: 1, alias, identityFile, publicKeyFingerprint: publicFingerprint }
    writePrivate(PREPARED_IDENTITY_PATH, `${JSON.stringify(prepared, null, 2)}\n`)
  } catch (error) {
    removeIdentityPair(identityFile)
    if (existsSync(PREPARED_IDENTITY_PATH)) unlinkSync(PREPARED_IDENTITY_PATH)
    throw error
  }
  console.log(`Prepared dedicated SSH identity. Provision only ${identityFile}.pub while creating the host, then run ./demosctl init.`)
}

function archiveIncompleteInitCommand(parsed: Parsed): void {
  if (option(parsed, "confirm") !== "archive-incomplete-init") throw new Error("refusing recovery action; pass --confirm archive-incomplete-init")
  if (existsSync(CONFIG_PATH)) throw new Error("operator configuration exists; refusing to archive potentially valid state")
  const partialPaths = [SSH_CONFIG_PATH, join(STATE_DIR, "known_hosts"), WORKSPACE_PATH, OPERATIONS_LOG_PATH].filter((path) => existsSync(path))
  if (partialPaths.length === 0) throw new Error("no incomplete initialization state found")
  ensureStateDir()
  const archiveDir = join(STATE_DIR, `incomplete-init-${timestamp()}-${process.pid}`)
  mkdirSync(archiveDir, { mode: 0o700 })
  const moved: Array<{ from: string; to: string }> = []
  try {
    for (const from of partialPaths) {
      const to = join(archiveDir, basename(from))
      renameSync(from, to)
      moved.push({ from, to })
    }
  } catch (error) {
    for (const { from, to } of moved.reverse()) if (existsSync(to)) renameSync(to, from)
    if (existsSync(archiveDir)) rmdirSync(archiveDir)
    throw error
  }
  console.log(`Archived incomplete initialization state for inspection: ${archiveDir}`)
}

function validatePreparedIdentity(alias: string, identityFile: string): boolean {
  if (!existsSync(PREPARED_IDENTITY_PATH)) return false
  if ((statSync(PREPARED_IDENTITY_PATH).mode & 0o077) !== 0) throw new Error("prepared identity marker permissions must be 0600")
  const prepared = JSON.parse(readFileSync(PREPARED_IDENTITY_PATH, "utf8")) as Partial<PreparedIdentity>
  if (prepared.schemaVersion !== 1 || prepared.alias !== alias || prepared.identityFile !== identityFile || !prepared.publicKeyFingerprint) {
    throw new Error("prepared identity marker does not match this alias and identity path")
  }
  const recordedFingerprint = validateHostKeyFingerprint(prepared.publicKeyFingerprint)
  if (!existsSync(identityFile) || !existsSync(`${identityFile}.pub`)) throw new Error("prepared SSH identity or public key is missing")
  if ((statSync(identityFile).mode & 0o077) !== 0) throw new Error("prepared SSH private-key permissions must be 0600")
  const privateFingerprint = identityFingerprint(identityFile)
  const publicFingerprint = identityFingerprint(`${identityFile}.pub`)
  if (privateFingerprint !== recordedFingerprint || publicFingerprint !== recordedFingerprint) {
    throw new Error("prepared SSH identity no longer matches its recorded fingerprint")
  }
  return true
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
  const hasVerifiedFingerprint = parsed.options.has("host-key-sha256")
  const hasFirstUseTrust = parsed.options.has("trust-new-host")
  if (hasVerifiedFingerprint === hasFirstUseTrust) {
    throw new Error("choose exactly one SSH trust route: --trust-new-host HOST or --host-key-sha256 SHA256:...")
  }
  const expectedFingerprint = hasVerifiedFingerprint ? validateHostKeyFingerprint(requiredOption(parsed, "host-key-sha256")) : undefined
  const trustedNewHost = hasFirstUseTrust ? requiredOption(parsed, "trust-new-host") : undefined
  if (trustedNewHost !== undefined && trustedNewHost !== hostname) {
    throw new Error("--trust-new-host must exactly match --hostname")
  }
  const identityFile = validateIdentityPath(resolve(option(parsed, "identity-file", join(homedir(), ".ssh", `demos-node-${alias}`))!))
  const knownHostsPath = join(STATE_DIR, "known_hosts")

  const operatorOutputs = [CONFIG_PATH, SSH_CONFIG_PATH, knownHostsPath, WORKSPACE_PATH, OPERATIONS_LOG_PATH]
  if (operatorOutputs.some((path) => existsSync(path))) throw new Error("operator state already exists; use a separate clone/state directory or archive it manually")
  ensureStateDir()
  if (parsed.options.has("skip-keygen") && process.env.DEMOSCTL_TEST_MODE !== "1") {
    throw new Error("--skip-keygen is reserved for isolated tests")
  }
  const preparedIdentity = parsed.options.has("skip-keygen") ? false : validatePreparedIdentity(alias, identityFile)
  if (!parsed.options.has("skip-keygen") && !preparedIdentity && (existsSync(identityFile) || existsSync(`${identityFile}.pub`))) throw new Error("refusing to reuse an existing SSH key; run ./demosctl prepare-key before provisioning or choose a new --identity-file path")
  let observedFingerprint = expectedFingerprint
  let knownHostsContent: string
  if (parsed.options.has("skip-host-key-check") && process.env.DEMOSCTL_TEST_MODE !== "1") {
    throw new Error("--skip-host-key-check is reserved for isolated tests")
  }
  if (parsed.options.has("skip-host-key-check")) {
    knownHostsContent = `${hostname} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnlyPlaceholder\n`
  } else {
    const scanned = runChecked(binary("ssh-keyscan"), ["-T", "10", "-t", "ed25519", "--", hostname], { stdout: "pipe" })
    const candidates = scanned.split("\n").flatMap((line) => {
      if (!line || line.startsWith("#") || line.split(/\s+/)[1] !== "ssh-ed25519") return []
      const check = Bun.spawnSync([binary("ssh-keygen"), "-lf", "-", "-E", "sha256"], { stdin: new Blob([`${line}\n`]), stdout: "pipe", stderr: "pipe" })
      if (check.exitCode !== 0) return []
      const fingerprint = check.stdout.toString().split(/\s+/).find((part) => part.startsWith("SHA256:"))
      return fingerprint ? [{ line, fingerprint: validateHostKeyFingerprint(fingerprint) }] : []
    })
    if (candidates.length === 0) throw new Error("the host did not present a valid Ed25519 SSH host key")
    const distinctFingerprints = [...new Set(candidates.map(({ fingerprint }) => fingerprint))]
    if (hasFirstUseTrust && distinctFingerprints.length !== 1) {
      throw new Error("first-use trust requires exactly one distinct Ed25519 SSH host key")
    }
    const matching = expectedFingerprint === undefined ? candidates : candidates.filter(({ fingerprint }) => fingerprint === expectedFingerprint)
    if (matching.length === 0) throw new Error("scanned SSH host keys did not match --host-key-sha256; verify it out of band")
    observedFingerprint = matching[0].fingerprint
    knownHostsContent = `${matching.map(({ line }) => line).join("\n")}\n`
  }

  const generatedDuringInit = !parsed.options.has("skip-keygen") && !preparedIdentity
  if (generatedDuringInit) createIdentity(identityFile, alias)

  const config: OperatorConfig = {
    schemaVersion: 1,
    alias,
    hostname,
    user,
    publicUrl,
    identityFile,
    hostKeyTrust: hasFirstUseTrust ? "first-use" : "verified",
    hostKeyFingerprint: observedFingerprint,
    upstreamRepo: UPSTREAM_REPO,
    branch,
    serviceName: SERVICE,
    remoteDir: REMOTE_DIR,
  }
  try {
    writePrivate(knownHostsPath, knownHostsContent)
    writePrivate(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
    writePrivate(
      SSH_CONFIG_PATH,
      renderSshConfig(config),
    )
    refreshWorkspace(config)
    appendOperation(config, "init")
    if (preparedIdentity) unlinkSync(PREPARED_IDENTITY_PATH)
  } catch (error) {
    for (const path of operatorOutputs) if (existsSync(path)) unlinkSync(path)
    if (generatedDuringInit) removeIdentityPair(identityFile)
    throw error
  }
  if (hasFirstUseTrust) {
    console.log(`Trusted this newly provisioned host once and pinned its Ed25519 fingerprint: ${observedFingerprint}`)
    console.log("Any later host-key change will be refused.")
  }
  console.log("Operator state initialized. Confirm the dedicated .pub key is authorized on the node host, then run ./demosctl doctor.")
}

function doctorCommand(parsed: Parsed): void {
  const config = readConfig()
  if (!existsSync(config.identityFile) || !existsSync(`${config.identityFile}.pub`)) {
    throw new Error("dedicated SSH identity or public key is missing")
  }
  if ((statSync(config.identityFile).mode & 0o077) !== 0) throw new Error("SSH private-key permissions must be 0600")
  const required = ["bun", "git", "ssh", "ssh-keygen", "ssh-keyscan", "age", "age-keygen"]
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

function installCommand(config: OperatorConfig, parsed: Parsed): void {
  const commit = validateCommit(requiredOption(parsed, "commit"))
  if (option(parsed, "confirm") !== `install:${commit}`) throw new Error(`refusing install; pass --confirm install:${commit}`)
  const script = readFileSync(join(ROOT, "scripts", "remote-bootstrap.sh"))
  runChecked(binary("ssh"), sshArgs(config, ["bash", "-s", "--", "--public-url", config.publicUrl, "--branch", config.branch, "--commit", commit]), {
    stdin: new Uint8Array(script),
  })
  appendOperation(config, "install")
  console.log("Install completed. This proves the service action completed, not testnet readiness; run ./demosctl status.")
}

function secretsCommand(config: OperatorConfig, parsed: Parsed): void {
  const requireStatusProtocol = () => {
    const protocol = runChecked(binary("ssh"), sshArgs(config, ["sudo -n /usr/local/sbin/demos-secret-status --protocol"]), { stdout: "pipe" }).trim()
    if (protocol !== "demos-secret-status/v3") throw new Error("remote secret status helper is missing or outdated; run ./demosctl upgrade-operator --confirm upgrade-operator")
  }
  if (parsed.rest[0] === "doctor") {
    requireStatusProtocol()
    runChecked(binary("ssh"), sshArgs(config, ["sudo -n /usr/local/sbin/demos-secret-status"]))
    return
  }
  if (!new Set(["configure", "setup"]).has(parsed.rest[0])) throw new Error("usage: ./demosctl secrets setup|configure|doctor")
  if (option(parsed, "confirm") !== "secrets") throw new Error("refusing secret mutation; pass --confirm secrets")
  const args = [join(ROOT, "scripts", "configure-secrets.sh"), "--ssh-config", SSH_CONFIG_PATH, "--host", config.alias]
  if (parsed.rest[0] === "setup") args.push("--setup")
  if (parsed.options.has("ffi")) args.push("--ffi")
  runChecked("bash", args)
  if (parsed.rest[0] === "setup") {
    requireStatusProtocol()
    runChecked(binary("ssh"), sshArgs(config, ["sudo -n /usr/local/sbin/demos-secret-status --require-core"]))
  }
  appendOperation(config, parsed.rest[0] === "setup" ? "secrets-setup" : "secrets-configure")
}

function upgradeOperatorCommand(config: OperatorConfig, parsed: Parsed): void {
  if (option(parsed, "confirm") !== "upgrade-operator") throw new Error("refusing operator-helper upgrade; pass --confirm upgrade-operator")
  const script = readFileSync(join(ROOT, "scripts", "install-secret-helpers.sh"))
  runChecked(binary("ssh"), sshArgs(config, ["sudo", "-n", "bash", "-s"]), { stdin: new Uint8Array(script) })
  const setter = runChecked(binary("ssh"), sshArgs(config, ["sudo -n /usr/local/sbin/demos-secret-set-batch --protocol"]), { stdout: "pipe" }).trim()
  const status = runChecked(binary("ssh"), sshArgs(config, ["sudo -n /usr/local/sbin/demos-secret-status --protocol"]), { stdout: "pipe" }).trim()
  if (setter !== "demos-secret-set-batch/v2" || status !== "demos-secret-status/v3") throw new Error("operator-helper protocol verification failed")
  appendOperation(config, "upgrade-operator")
  console.log("Remote secret helpers upgraded and exact protocols verified. No node service restart was performed.")
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "").replaceAll("-", "").replace(/\.\d{3}Z$/, "Z")
}

function ageRecipient(keyPath: string): string {
  validatePrivateRegularFile(keyPath, "recovery key")
  const recipient = runChecked(binary("age-keygen"), ["-y", keyPath], { stdout: "pipe" }).trim()
  if (!/^age1[0-9a-z]{20,}$/.test(recipient)) throw new Error("recovery key did not produce a valid Age recipient")
  return recipient
}

function readRecoveryConfig(config: OperatorConfig): RecoveryConfig {
  validatePrivateRegularFile(RECOVERY_CONFIG_PATH, "recovery configuration")
  const recovery = JSON.parse(readFileSync(RECOVERY_CONFIG_PATH, "utf8")) as Partial<RecoveryConfig>
  if (
    recovery.schemaVersion !== 1 ||
    recovery.alias !== config.alias ||
    recovery.hostname !== config.hostname ||
    recovery.store !== "local-file" ||
    !recovery.primaryKeyPath ||
    !recovery.recoveryCopyPath ||
    !recovery.recipient ||
    !recovery.createdAt
  ) throw new Error("recovery configuration has an invalid or mismatched shape")
  recovery.primaryKeyPath = validateRecoveryKeyPath(recovery.primaryKeyPath, "primary recovery key")
  recovery.recoveryCopyPath = validateRecoveryKeyPath(recovery.recoveryCopyPath, "recovery key copy")
  if (recovery.primaryKeyPath === recovery.recoveryCopyPath) throw new Error("recovery key paths must be distinct")
  const primaryRecipient = ageRecipient(recovery.primaryKeyPath)
  const copyRecipient = ageRecipient(recovery.recoveryCopyPath)
  if (primaryRecipient !== recovery.recipient || copyRecipient !== recovery.recipient) {
    throw new Error("persisted recovery key copies do not match the recorded recipient")
  }
  return recovery as RecoveryConfig
}

function currentNodePublicKey(config: OperatorConfig): string {
  const remote = `cd ${REMOTE_DIR} && if systemctl is-active --quiet ${SERVICE}; then sudo -n docker compose --env-file .env --env-file /etc/demos-node/node.env exec -T node bun run show:pubkey; else sudo -n docker compose --env-file .env --env-file /etc/demos-node/node.env run --rm --no-deps node bun run show:pubkey; fi`
  const output = runChecked(binary("ssh"), sshArgs(config, [remote]), { stdout: "pipe" })
  const matches = [...output.matchAll(/^Public Key: (0x[0-9a-f]{64})\s*$/gm)]
  if (matches.length !== 1) throw new Error("node did not return exactly one canonical public key")
  return validateNodePublicKey(matches[0][1])
}

async function stageAndVerifyArchive(config: OperatorConfig, source: string, expectedPublicKey: string, recoveryKey?: string): Promise<string> {
  if (!existsSync(source) || statSync(source).size === 0 || !source.endsWith(".age")) throw new Error("backup must be a non-empty .age archive")
  if (recoveryKey) validatePrivateRegularFile(recoveryKey, "recovery key")
  const stagingVolume = `demos_node_state_restore_${Date.now()}`
  const decryptArgs = recoveryKey ? ["-d", "-i", recoveryKey, source] : ["-d", source]
  const age = Bun.spawn([binary("age"), ...decryptArgs], { cwd: ROOT, stdin: "inherit", stdout: "pipe", stderr: "inherit" })
  const stageRemote = `set -e; cleanup() { sudo -n docker volume rm ${stagingVolume} >/dev/null 2>&1 || true; }; trap cleanup ERR INT TERM; (sudo -n docker image inspect ${HELPER_IMAGE} >/dev/null 2>&1 || sudo -n docker pull ${HELPER_IMAGE} >/dev/null); sudo -n docker volume create ${stagingVolume} >/dev/null; sudo -n docker run --rm --pull=never --network=none --cap-drop=ALL --security-opt=no-new-privileges --read-only -i -v ${stagingVolume}:/state ${HELPER_IMAGE} sh -ec 'tar -C /state -xf -; test -s /state/.demos_identity'; trap - ERR INT TERM`
  const ssh = Bun.spawn([binary("ssh"), ...sshArgs(config, [stageRemote])], { cwd: ROOT, stdin: age.stdout, stdout: "inherit", stderr: "inherit" })
  const [ageExit, sshExit] = await Promise.all([age.exited, ssh.exited])
  if (ageExit !== 0 || sshExit !== 0) {
    try {
      removeRemoteVolume(config, stagingVolume)
    } catch (cleanupError) {
      throw new Error(`backup validation/staging failed; live state was not touched, but staging cleanup could not be confirmed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
    }
    throw new Error("backup validation/staging failed; live state was not touched and staging cleanup was attempted")
  }
  const verifyStagedIdentity = `cd ${REMOTE_DIR} && sudo -n docker compose --env-file .env --env-file /etc/demos-node/node.env run --rm --no-deps -v ${stagingVolume}:/app/state node bun run show:pubkey | grep -Fx -- 'Public Key: ${expectedPublicKey}' >/dev/null`
  try {
    runChecked(binary("ssh"), sshArgs(config, [verifyStagedIdentity]))
  } catch (error) {
    runChecked(binary("ssh"), sshArgs(config, [`sudo -n docker volume rm ${stagingVolume} >/dev/null`]))
    throw new Error(`staged backup identity did not match --expected-public-key: ${error instanceof Error ? error.message : String(error)}`)
  }
  return stagingVolume
}

function removeRemoteVolume(config: OperatorConfig, volume: string): void {
  runChecked(binary("ssh"), sshArgs(config, [`if sudo -n docker volume inspect ${volume} >/dev/null 2>&1; then sudo -n docker volume rm ${volume} >/dev/null; fi; ! sudo -n docker volume inspect ${volume} >/dev/null 2>&1`]))
}

async function backupCommand(config: OperatorConfig): Promise<string> {
  const recovery = readRecoveryConfig(config)
  const expectedPublicKey = currentNodePublicKey(config)
  mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 })
  const outputPath = join(BACKUP_DIR, `${config.alias}-${timestamp()}.tar.age`)
  const remote = `sudo -n docker volume inspect demos_node_state >/dev/null && (sudo -n docker image inspect ${HELPER_IMAGE} >/dev/null 2>&1 || sudo -n docker pull ${HELPER_IMAGE} >/dev/null) && sudo -n docker run --rm --pull=never --network=none --cap-drop=ALL --security-opt=no-new-privileges --read-only -v demos_node_state:/state:ro ${HELPER_IMAGE} sh -ec 'test -s /state/.demos_identity; tar -C /state -cf - .'`
  const ssh = Bun.spawn([binary("ssh"), ...sshArgs(config, [remote])], { cwd: ROOT, stdout: "pipe", stderr: "inherit" })
  const age = Bun.spawn([binary("age"), "-r", recovery.recipient, "-o", outputPath], { cwd: ROOT, stdin: ssh.stdout, stdout: "inherit", stderr: "inherit" })
  const [sshExit, ageExit] = await Promise.all([ssh.exited, age.exited])
  if (sshExit !== 0 || ageExit !== 0 || !existsSync(outputPath) || statSync(outputPath).size === 0) {
    if (existsSync(outputPath)) unlinkSync(outputPath)
    throw new Error("encrypted backup failed or was empty")
  }
  chmodSync(outputPath, 0o600)

  let stagingVolume: string | undefined
  try {
    stagingVolume = await stageAndVerifyArchive(config, outputPath, expectedPublicKey, recovery.recoveryCopyPath)
    removeRemoteVolume(config, stagingVolume)
    stagingVolume = undefined
  } catch (error) {
    if (stagingVolume) {
      try { removeRemoteVolume(config, stagingVolume) } catch {}
    }
    unlinkSync(outputPath)
    throw new Error(`backup qualification failed; unqualified archive removed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const receipt: RecoveryReceipt = {
    schemaVersion: 1,
    alias: config.alias,
    hostname: config.hostname,
    store: "local-file",
    archivePath: outputPath,
    archiveSha256: await sha256File(outputPath),
    archiveSize: statSync(outputPath).size,
    expectedPublicKey,
    recipient: recovery.recipient,
    qualifiedAt: new Date().toISOString(),
  }
  writePrivateAtomic(RECOVERY_RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`)
  appendOperation(config, "backup-qualified")
  console.log(`RECOVERY QUALIFIED: ${outputPath}`)
  return outputPath
}

async function requireQualifiedRecovery(config: OperatorConfig, purpose: "stake" | "update" | "reinstall"): Promise<RecoveryReceipt> {
  const recovery = readRecoveryConfig(config)
  validatePrivateRegularFile(RECOVERY_RECEIPT_PATH, "recovery qualification receipt")
  const receipt = JSON.parse(readFileSync(RECOVERY_RECEIPT_PATH, "utf8")) as Partial<RecoveryReceipt>
  if (
    receipt.schemaVersion !== 1 ||
    receipt.alias !== config.alias ||
    receipt.hostname !== config.hostname ||
    receipt.store !== "local-file" ||
    !receipt.archivePath ||
    !receipt.archiveSha256 || !/^[0-9a-f]{64}$/.test(receipt.archiveSha256) ||
    !receipt.archiveSize ||
    !receipt.expectedPublicKey ||
    receipt.recipient !== recovery.recipient ||
    !receipt.qualifiedAt
  ) throw new Error("recovery qualification receipt has an invalid or mismatched shape")
  validateNodePublicKey(receipt.expectedPublicKey)
  const archivePath = resolve(receipt.archivePath)
  if (!pathIsWithin(BACKUP_DIR, archivePath)) throw new Error("qualified recovery archive must remain inside the private backup directory")
  validatePrivateRegularFile(archivePath, "qualified recovery archive")
  if (statSync(archivePath).size !== receipt.archiveSize) throw new Error("qualified recovery archive is missing or has changed size")
  if (await sha256File(archivePath) !== receipt.archiveSha256) throw new Error("qualified recovery archive digest changed")
  const currentPublicKey = currentNodePublicKey(config)
  if (currentPublicKey !== receipt.expectedPublicKey) throw new Error("qualified recovery identity no longer matches the live node")
  const stagingVolume = await stageAndVerifyArchive(config, archivePath, receipt.expectedPublicKey, recovery.recoveryCopyPath)
  removeRemoteVolume(config, stagingVolume)
  console.log(`RECOVERY QUALIFIED for ${purpose}: archive, durable key copy, digest, and node identity verified.`)
  return receipt as RecoveryReceipt
}

async function requireCurrentStakeCheck(config: OperatorConfig): Promise<void> {
  const recovery = readRecoveryConfig(config)
  validatePrivateRegularFile(RECOVERY_RECEIPT_PATH, "recovery qualification receipt")
  validatePrivateRegularFile(RECOVERY_CHECK_PATH, "stake recovery check")
  const receipt = JSON.parse(readFileSync(RECOVERY_RECEIPT_PATH, "utf8")) as Partial<RecoveryReceipt>
  const checked = JSON.parse(readFileSync(RECOVERY_CHECK_PATH, "utf8")) as Partial<RecoveryCheckReceipt>
  if (
    checked.schemaVersion !== 1 ||
    checked.alias !== config.alias ||
    checked.hostname !== config.hostname ||
    checked.purpose !== "stake" ||
    checked.archiveSha256 !== receipt.archiveSha256 ||
    checked.expectedPublicKey !== receipt.expectedPublicKey ||
    !checked.checkedAt || !Number.isFinite(Date.parse(checked.checkedAt)) ||
    !checked.expiresAt || !Number.isFinite(Date.parse(checked.expiresAt)) || Date.parse(checked.expiresAt) <= Date.now() ||
    receipt.recipient !== recovery.recipient ||
    !receipt.archivePath || !receipt.archiveSize
  ) throw new Error("stake recovery check is missing, expired, or no longer matches the qualified archive")
  const expectedPublicKey = validateNodePublicKey(checked.expectedPublicKey!)
  const archivePath = resolve(receipt.archivePath)
  if (!pathIsWithin(BACKUP_DIR, archivePath)) throw new Error("qualified recovery archive must remain inside the private backup directory")
  validatePrivateRegularFile(archivePath, "qualified recovery archive")
  if (statSync(archivePath).size !== receipt.archiveSize || await sha256File(archivePath) !== receipt.archiveSha256) {
    throw new Error("qualified recovery archive changed after the stake recovery check")
  }
  if (currentNodePublicKey(config) !== expectedPublicKey) throw new Error("live node identity changed after the stake recovery check")
}

async function recoveryCommand(config: OperatorConfig, parsed: Parsed): Promise<void> {
  const action = parsed.rest[0]
  if (action === "create") {
    if (option(parsed, "confirm") !== "recovery") throw new Error("refusing recovery setup; pass --confirm recovery")
    if (existsSync(RECOVERY_CONFIG_PATH)) throw new Error("recovery is already configured; use ./demosctl backup --confirm backup")
    const primaryKeyPath = validateRecoveryKeyPath(option(parsed, "key-file", join(homedir(), ".local", "share", "demos-node", config.alias, "recovery.agekey"))!, "primary recovery key")
    const recoveryCopyPath = validateRecoveryKeyPath(requiredOption(parsed, "copy-to"), "recovery key copy")
    if (primaryKeyPath === recoveryCopyPath) throw new Error("--copy-to must be distinct from the primary recovery key")
    if (existsSync(primaryKeyPath) || existsSync(recoveryCopyPath)) throw new Error("refusing to overwrite an existing recovery key or copy")
    for (const path of [primaryKeyPath, recoveryCopyPath]) {
      const parent = dirname(path)
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 })
    }
    try {
      runChecked(binary("age-keygen"), ["-o", primaryKeyPath], { stdout: "pipe" })
      chmodSync(primaryKeyPath, 0o600)
      copyFileSync(primaryKeyPath, recoveryCopyPath, fsConstants.COPYFILE_EXCL)
      chmodSync(recoveryCopyPath, 0o600)
      const primaryRecipient = ageRecipient(primaryKeyPath)
      const copyRecipient = ageRecipient(recoveryCopyPath)
      if (primaryRecipient !== copyRecipient) throw new Error("persisted recovery key copies do not match")
      const recovery: RecoveryConfig = {
        schemaVersion: 1,
        alias: config.alias,
        hostname: config.hostname,
        store: "local-file",
        primaryKeyPath,
        recoveryCopyPath,
        recipient: primaryRecipient,
        createdAt: new Date().toISOString(),
      }
      writePrivateAtomic(RECOVERY_CONFIG_PATH, `${JSON.stringify(recovery, null, 2)}\n`)
    } catch (error) {
      for (const path of [primaryKeyPath, recoveryCopyPath]) if (existsSync(path)) unlinkSync(path)
      throw error
    }
    appendOperation(config, "recovery-configured")
    await backupCommand(config)
    return
  }
  if (action === "check") {
    const purpose = option(parsed, "for")
    if (!purpose || !new Set(["stake", "update", "reinstall"]).has(purpose)) throw new Error("recovery check requires --for stake|update|reinstall")
    if (option(parsed, "confirm") !== `recovery-check:${purpose}`) throw new Error(`refusing remote recovery drill; pass --confirm recovery-check:${purpose}`)
    if (purpose === "reinstall" && existsSync(REINSTALL_CLAIM_PATH)) {
      throw new Error("an incomplete host re-trust claim exists; preserve .demos and investigate before authorizing another reinstall")
    }
    const receipt = await requireQualifiedRecovery(config, purpose as "stake" | "update" | "reinstall")
    if (purpose === "stake") {
      const checkedAt = new Date()
      const checked: RecoveryCheckReceipt = {
        schemaVersion: 1,
        alias: config.alias,
        hostname: config.hostname,
        purpose: "stake",
        archiveSha256: receipt.archiveSha256,
        expectedPublicKey: receipt.expectedPublicKey,
        checkedAt: checkedAt.toISOString(),
        expiresAt: new Date(checkedAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      }
      writePrivateAtomic(RECOVERY_CHECK_PATH, `${JSON.stringify(checked, null, 2)}\n`)
      console.log("Funding readiness verified for the next two hours. Rerun this check if the window expires.")
    }
    if (purpose === "reinstall") {
      const authorizedAt = new Date()
      const authorization: ReinstallAuthorization = {
        schemaVersion: 1,
        alias: config.alias,
        hostname: config.hostname,
        archiveSha256: receipt.archiveSha256,
        expectedPublicKey: receipt.expectedPublicKey,
        authorizedAt: authorizedAt.toISOString(),
        expiresAt: new Date(authorizedAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      }
      writePrivateAtomic(REINSTALL_AUTH_PATH, `${JSON.stringify(authorization, null, 2)}\n`)
      console.log("SAFE TO REINSTALL the configured host only for the next two hours. This command did not reinstall or modify the host operating system.")
      console.log(`After reinstalling the same host, run: ./demosctl retrust-host --hostname ${config.hostname} --confirm retrust-host:${config.hostname}`)
    }
    return
  }
  if (action === "status") {
    const report: Record<string, unknown> = {
      target: config.alias,
      recoveryConfigured: false,
      qualificationReceiptPresent: false,
    }
    if (existsSync(RECOVERY_CONFIG_PATH)) {
      const recovery = readRecoveryConfig(config)
      report.recoveryConfigured = true
      report.store = recovery.store
      report.primaryKeyPath = recovery.primaryKeyPath
      report.recoveryCopyPath = recovery.recoveryCopyPath
      report.recipient = recovery.recipient
    }
    if (existsSync(RECOVERY_RECEIPT_PATH)) {
      validatePrivateRegularFile(RECOVERY_RECEIPT_PATH, "recovery qualification receipt")
      const receipt = JSON.parse(readFileSync(RECOVERY_RECEIPT_PATH, "utf8")) as Partial<RecoveryReceipt>
      report.qualificationReceiptPresent = receipt.alias === config.alias && receipt.hostname === config.hostname && receipt.store === "local-file"
      report.archivePath = receipt.archivePath
      report.archiveSha256 = receipt.archiveSha256
      report.expectedPublicKey = receipt.expectedPublicKey
      report.qualifiedAt = receipt.qualifiedAt
    }
    console.log(JSON.stringify(report, null, 2))
    return
  }
  throw new Error("usage: ./demosctl recovery create|check|status")
}

async function retrustHostCommand(config: OperatorConfig, parsed: Parsed): Promise<void> {
  const hostname = validateSimple("hostname", requiredOption(parsed, "hostname"), /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/)
  if (hostname !== config.hostname) throw new Error("--hostname must exactly match the configured host")
  if (option(parsed, "confirm") !== `retrust-host:${hostname}`) throw new Error(`refusing host re-trust; pass --confirm retrust-host:${hostname}`)
  if (existsSync(REINSTALL_CLAIM_PATH)) throw new Error("an incomplete host re-trust claim exists; preserve .demos and investigate before retrying")
  validatePrivateRegularFile(REINSTALL_AUTH_PATH, "reinstall authorization")
  try {
    renameSync(REINSTALL_AUTH_PATH, REINSTALL_CLAIM_PATH)
  } catch {
    throw new Error("reinstall authorization was already claimed by another process")
  }
  let completed = false
  try {
  const authorization = JSON.parse(readFileSync(REINSTALL_CLAIM_PATH, "utf8")) as Partial<ReinstallAuthorization>
  if (
    authorization.schemaVersion !== 1 ||
    authorization.alias !== config.alias ||
    authorization.hostname !== config.hostname ||
    !authorization.archiveSha256 || !/^[0-9a-f]{64}$/.test(authorization.archiveSha256) ||
    !authorization.expectedPublicKey ||
    !authorization.authorizedAt ||
    !authorization.expiresAt ||
    !Number.isFinite(Date.parse(authorization.authorizedAt)) ||
    !Number.isFinite(Date.parse(authorization.expiresAt)) ||
    Date.parse(authorization.expiresAt) <= Date.now()
  ) throw new Error("reinstall authorization is invalid or expired; restore access to the old host and repeat the recovery check")
  validateNodePublicKey(authorization.expectedPublicKey)
  const recovery = readRecoveryConfig(config)
  validatePrivateRegularFile(RECOVERY_RECEIPT_PATH, "recovery qualification receipt")
  const receipt = JSON.parse(readFileSync(RECOVERY_RECEIPT_PATH, "utf8")) as Partial<RecoveryReceipt>
  if (
    receipt.schemaVersion !== 1 ||
    receipt.alias !== config.alias ||
    receipt.hostname !== config.hostname ||
    receipt.recipient !== recovery.recipient ||
    receipt.archiveSha256 !== authorization.archiveSha256 ||
    receipt.expectedPublicKey !== authorization.expectedPublicKey ||
    !receipt.archivePath ||
    !receipt.archiveSize
  ) {
    throw new Error("reinstall authorization no longer matches the qualified recovery receipt")
  }
  const archivePath = resolve(receipt.archivePath)
  if (!pathIsWithin(BACKUP_DIR, archivePath)) throw new Error("qualified recovery archive must remain inside the private backup directory")
  validatePrivateRegularFile(archivePath, "qualified recovery archive")
  if (statSync(archivePath).size !== receipt.archiveSize || await sha256File(archivePath) !== receipt.archiveSha256) {
    throw new Error("qualified recovery archive changed after reinstall authorization")
  }

  const scanned = runChecked(binary("ssh-keyscan"), ["-T", "10", "-t", "ed25519", "--", hostname], { stdout: "pipe" })
  const candidates = scanned.split("\n").flatMap((line) => {
    if (!line || line.startsWith("#") || line.split(/\s+/)[1] !== "ssh-ed25519") return []
    const check = Bun.spawnSync([binary("ssh-keygen"), "-lf", "-", "-E", "sha256"], { stdin: new Blob([`${line}\n`]), stdout: "pipe", stderr: "pipe" })
    if (check.exitCode !== 0) return []
    const fingerprint = check.stdout.toString().split(/\s+/).find((part) => part.startsWith("SHA256:"))
    return fingerprint ? [{ line, fingerprint: validateHostKeyFingerprint(fingerprint) }] : []
  })
  const distinct = [...new Set(candidates.map(({ fingerprint }) => fingerprint))]
  if (distinct.length !== 1 || candidates.length === 0) throw new Error("re-trust requires exactly one distinct Ed25519 SSH host key")

  const knownHostsPath = join(STATE_DIR, "known_hosts")
  validatePrivateRegularFile(knownHostsPath, "existing pinned SSH host key")
  const previousKnownHosts = readFileSync(knownHostsPath, "utf8")
  const previousConfig = readFileSync(CONFIG_PATH, "utf8")
  const previousSshConfig = readFileSync(SSH_CONFIG_PATH, "utf8")
  const previousWorkspace = existsSync(WORKSPACE_PATH) ? readFileSync(WORKSPACE_PATH, "utf8") : undefined
  const updated: OperatorConfig = { ...config, hostKeyTrust: "first-use", hostKeyFingerprint: distinct[0] }
  try {
    writePrivateAtomic(knownHostsPath, `${candidates.map(({ line }) => line).join("\n")}\n`)
    writePrivateAtomic(CONFIG_PATH, `${JSON.stringify(updated, null, 2)}\n`)
    writePrivateAtomic(SSH_CONFIG_PATH, renderSshConfig(updated))
    refreshWorkspace(updated)
    appendOperation(updated, "retrust-host")
    unlinkSync(REINSTALL_CLAIM_PATH)
    completed = true
  } catch (error) {
    writePrivateAtomic(knownHostsPath, previousKnownHosts)
    writePrivateAtomic(CONFIG_PATH, previousConfig)
    writePrivateAtomic(SSH_CONFIG_PATH, previousSshConfig)
    if (previousWorkspace !== undefined) writePrivateAtomic(WORKSPACE_PATH, previousWorkspace)
    throw error
  }
  console.log(`Pinned the reinstalled host's Ed25519 fingerprint: ${distinct[0]}`)
  console.log("Run ./demosctl doctor, reinstall the node software, and restore the qualified identity archive. The node remains stopped until you explicitly start it.")
  } finally {
    if (!completed && existsSync(REINSTALL_CLAIM_PATH) && !existsSync(REINSTALL_AUTH_PATH)) renameSync(REINSTALL_CLAIM_PATH, REINSTALL_AUTH_PATH)
  }
}

async function restoreCommand(config: OperatorConfig, parsed: Parsed): Promise<void> {
  const source = resolve(requiredOption(parsed, "from"))
  const expectedPublicKey = validateNodePublicKey(requiredOption(parsed, "expected-public-key"))
  let recoveryKey = parsed.options.has("legacy-passphrase") ? undefined : option(parsed, "recovery-key")
  if (!recoveryKey && !parsed.options.has("legacy-passphrase") && existsSync(RECOVERY_CONFIG_PATH)) recoveryKey = readRecoveryConfig(config).recoveryCopyPath
  if (!recoveryKey && !parsed.options.has("legacy-passphrase")) {
    throw new Error("recovery key is required; configure recovery, pass --recovery-key PATH, or explicitly use --legacy-passphrase")
  }
  if (recoveryKey) recoveryKey = validateRecoveryKeyPath(recoveryKey, "recovery key")
  const stagingVolume = await stageAndVerifyArchive(config, source, expectedPublicKey, recoveryKey)
  const rollbackVolume = `demos_node_state_rollback_${Date.now()}`
  const copyVolume = (source: string, target: string) => `sudo -n docker run --rm --pull=never --network=none --cap-drop=ALL --security-opt=no-new-privileges --read-only -v ${source}:/source:ro -v ${target}:/target ${HELPER_IMAGE} sh -ec 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; cp -a /source/. /target/; test -s /target/.demos_identity'`
  const volumePublicKey = (volume: string) => `cd ${REMOTE_DIR} && sudo -n docker compose --env-file .env --env-file /etc/demos-node/node.env run --rm --no-deps -v ${volume}:/app/state node bun run show:pubkey`
  const activateRemote = `set -e
sudo -n systemctl stop ${SERVICE}
live_existed=false
original_public_key=''
if sudo -n docker volume inspect demos_node_state >/dev/null 2>&1; then
  live_existed=true
  original_public_key="$(${volumePublicKey("demos_node_state")})"
  printf '%s\n' "$original_public_key" | grep -Ex 'Public Key: 0x[0-9a-f]{64}' >/dev/null
  sudo -n docker volume create ${rollbackVolume} >/dev/null
  ${copyVolume("demos_node_state", rollbackVolume)}
  rollback_public_key="$(${volumePublicKey(rollbackVolume)})"
  [ "$rollback_public_key" = "$original_public_key" ] || { echo 'rollback snapshot identity mismatch; recovery volumes retained' >&2; exit 1; }
else
  sudo -n docker volume create demos_node_state >/dev/null
fi
if ${copyVolume(stagingVolume, "demos_node_state")} && cd ${REMOTE_DIR} && sudo -n docker compose --env-file .env --env-file /etc/demos-node/node.env run --rm --no-deps node bun run show:pubkey | grep -Fx -- 'Public Key: ${expectedPublicKey}' >/dev/null; then
  sudo -n docker volume rm ${stagingVolume} >/dev/null
  if [ "$live_existed" = true ]; then sudo -n docker volume rm ${rollbackVolume} >/dev/null; fi
else
  echo 'activation failed; recovering prior volume state' >&2
  if [ "$live_existed" = true ]; then
    if ${copyVolume(rollbackVolume, "demos_node_state")}; then
      recovered_public_key="$(${volumePublicKey("demos_node_state")})"
      if [ "$recovered_public_key" = "$original_public_key" ]; then
        sudo -n docker volume rm ${stagingVolume} ${rollbackVolume} >/dev/null
      else
        echo 'rollback identity verification failed; plaintext recovery volumes retained' >&2
      fi
    else
      echo 'rollback failed; plaintext recovery volumes retained for manual recovery' >&2
    fi
  else
    sudo -n docker volume rm ${stagingVolume} demos_node_state >/dev/null || echo 'cleanup failed; plaintext recovery volumes retained for manual recovery' >&2
  fi
  exit 1
fi
systemctl show ${SERVICE} --property=LoadState,ActiveState,SubState --no-pager`
  runChecked(binary("ssh"), sshArgs(config, [activateRemote]))
  appendOperation(config, "restore")
  console.log("State restored. The node remains stopped; run ./demosctl start --confirm start separately.")
}

function serviceCommand(config: OperatorConfig, action: "start" | "stop"): void {
  const remote = `sudo -n systemctl ${action} ${SERVICE} && systemctl show ${SERVICE} --property=LoadState,ActiveState,SubState --no-pager`
  runChecked(binary("ssh"), sshArgs(config, [remote]))
  appendOperation(config, action)
  console.log(action === "start" ? "Service start completed; run status before claiming readiness." : "Node service stopped; the host remains running.")
}

function pubkeyCommand(config: OperatorConfig): void {
  console.log(`Public Key: ${currentNodePublicKey(config)}`)
}

async function stakeCommand(config: OperatorConfig): Promise<void> {
  await requireQualifiedRecovery(config, "stake")
  const remote = `test "$(systemctl show ${SERVICE} --property=ActiveState --value)" = inactive && cd ${REMOTE_DIR} && sudo -n docker compose --env-file .env --env-file /etc/demos-node/node.env run --rm node bun run validator:stake`
  runChecked(binary("ssh"), sshArgs(config, [remote]))
  appendOperation(config, "stake")
  console.log("Stake command completed. Verify validator/network state before starting the node.")
}

async function updateCommand(config: OperatorConfig, parsed: Parsed): Promise<void> {
  const commit = validateCommit(requiredOption(parsed, "commit"))
  if (option(parsed, "confirm") !== `update:${commit}`) throw new Error(`refusing update; pass --confirm update:${commit}`)
  await backupCommand(config)
  const remote = [
    `cd ${REMOTE_DIR}`,
    `test \"$(git remote get-url origin)\" = \"${UPSTREAM_REPO}\"`,
    `test -z \"$(git status --porcelain)\"`,
    `sudo -n git fetch origin ${config.branch}`,
    `sudo -n git cat-file -e ${commit}^{commit}`,
    `sudo -n git merge-base --is-ancestor ${commit} origin/${config.branch}`,
    `sudo -n git merge-base --is-ancestor HEAD ${commit}`,
    `sudo -n git checkout --detach ${commit}`,
    `test \"$(git rev-parse HEAD)\" = \"${commit}\"`,
    `sudo -n systemctl restart ${SERVICE}`,
    `systemctl show ${SERVICE} --property=LoadState,ActiveState,SubState,InvocationID --no-pager`,
  ].join(" && ")
  runChecked(binary("ssh"), sshArgs(config, [remote]))
  appendOperation(config, "update")
  console.log(`Update to approved commit ${commit} and service restart completed; run status before claiming readiness.`)
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

function operationActions(): Set<string> {
  if (!existsSync(OPERATIONS_LOG_PATH)) return new Set()
  const actions = new Set<string>()
  for (const line of readFileSync(OPERATIONS_LOG_PATH, "utf8").split("\n")) {
    if (!line) continue
    try {
      const entry = JSON.parse(line) as { action?: unknown; outcome?: unknown }
      if (typeof entry.action === "string" && entry.outcome === "completed") {
        if (entry.action === "retrust-host") {
          for (const hostLocalAction of ["install", "secrets-setup", "start", "restore"]) actions.delete(hostLocalAction)
        }
        actions.add(entry.action)
      }
    } catch {
      throw new Error("operation history is malformed; preserve it and investigate before onboarding continues")
    }
  }
  return actions
}

async function onboardCommand(parsed: Parsed, config?: OperatorConfig): Promise<void> {
  if (!config) {
    if (!existsSync(PREPARED_IDENTITY_PATH)) {
      console.log("ONBOARDING 1/10 — Prepare a dedicated SSH identity.")
      console.log("Next: ./demosctl prepare-key --alias YOUR-NODE-NAME")
      return
    }
    const prepared = JSON.parse(readFileSync(PREPARED_IDENTITY_PATH, "utf8")) as Partial<PreparedIdentity>
    console.log("ONBOARDING 2/10 — Create an Ubuntu 22.04/24.04 amd64 host with the prepared public SSH key.")
    console.log(`Public key file to provision: ${prepared.identityFile}.pub`)
    console.log("Then initialize this workspace with the host IP and public URL; use --trust-new-host only for that newly created host.")
    return
  }

  const actions = operationActions()
  if (!actions.has("install")) {
    const commit = option(parsed, "commit")
    console.log("ONBOARDING 3/10 — Verify access, then install one reviewed upstream commit.")
    console.log("Next: ./demosctl doctor")
    if (commit) {
      const exact = validateCommit(commit)
      console.log(`Then: ./demosctl install --commit ${exact} --confirm install:${exact}`)
    } else {
      console.log("Rerun ./demosctl onboard --commit <approved 40-character stabilisation commit> to receive the exact install command.")
    }
    return
  }
  if (!actions.has("secrets-setup")) {
    console.log("ONBOARDING 4/10 — Configure the operator-owned Helius core key and any enabled feature credentials through hidden terminal input.")
    console.log("Next: ./demosctl secrets setup --confirm secrets")
    return
  }
  if (actions.has("retrust-host") && !actions.has("restore")) {
    validatePrivateRegularFile(RECOVERY_RECEIPT_PATH, "recovery qualification receipt")
    const receipt = JSON.parse(readFileSync(RECOVERY_RECEIPT_PATH, "utf8")) as Partial<RecoveryReceipt>
    if (!receipt.archivePath || !receipt.expectedPublicKey) throw new Error("recovery qualification receipt is incomplete after host re-trust")
    const archivePath = resolve(receipt.archivePath)
    if (!pathIsWithin(BACKUP_DIR, archivePath)) throw new Error("qualified recovery archive must remain inside the private backup directory")
    validateNodePublicKey(receipt.expectedPublicKey)
    console.log("ONBOARDING 5/10 — Restore the qualified identity archive onto the reinstalled host.")
    console.log(`Next: ./demosctl restore --from ${archivePath} --expected-public-key ${receipt.expectedPublicKey} --confirm restore`)
    return
  }
  if (!existsSync(RECOVERY_RECEIPT_PATH)) {
    console.log("ONBOARDING 6/10 — Create and prove recoverable node-identity backup material.")
    if (existsSync(RECOVERY_CONFIG_PATH)) {
      console.log("Recovery keys are configured, but no qualified archive exists.")
      console.log("Next: ./demosctl backup --confirm backup")
    } else {
      console.log("Choose a second operator-controlled path outside this repository, then run:")
      console.log("./demosctl recovery create --copy-to /your/second/location/recovery.agekey --confirm recovery")
    }
    return
  }
  try {
    await requireCurrentStakeCheck(config)
  } catch {
    console.log("ONBOARDING 7/10 — Re-prove recovery before displaying or funding the identity.")
    console.log("Next: ./demosctl recovery check --for stake --confirm recovery-check:stake")
    return
  }
  if (!actions.has("stake")) {
    console.log("ONBOARDING 8/10 — Stop the service, display and fund the recovery-verified identity, then stake.")
    console.log("Next: ./demosctl stop --confirm stop && ./demosctl pubkey")
    console.log("After funding: ./demosctl stake --confirm stake")
    return
  }
  if (!actions.has("start")) {
    console.log("ONBOARDING 9/10 — Start only the node service.")
    console.log("Next: ./demosctl start --confirm start")
    return
  }
  console.log("ONBOARDING 10/10 — Verify runtime and network evidence.")
  console.log("Next: ./demosctl status")
}

function usage(): void {
  console.log(`DEMOS node starter

Usage:
  ./demosctl prepare-key --alias NAME [--identity-file PATH]
  ./demosctl archive-incomplete-init --confirm archive-incomplete-init
  ./demosctl init --alias NAME --hostname HOST --public-url http://HOST:53550 (--trust-new-host HOST | --host-key-sha256 SHA256:...) [--user root]
  ./demosctl doctor [--local-only]
  ./demosctl ssh
  ./demosctl install --commit FULL_SHA --confirm install:FULL_SHA
  ./demosctl upgrade-operator --confirm upgrade-operator
  ./demosctl secrets setup --confirm secrets [--ffi]
  ./demosctl secrets configure --confirm secrets [--ffi]
  ./demosctl secrets doctor
  ./demosctl pubkey
  ./demosctl recovery create --copy-to PATH --confirm recovery [--key-file PATH]
  ./demosctl recovery check --for stake|update|reinstall --confirm recovery-check:PURPOSE
  ./demosctl recovery status
  ./demosctl retrust-host --hostname HOST --confirm retrust-host:HOST
  ./demosctl backup --confirm backup
  ./demosctl restore --from PATH --expected-public-key 0x... --confirm restore [--recovery-key PATH | --legacy-passphrase]
  ./demosctl stake --confirm stake
  ./demosctl onboard [--commit FULL_SHA]
  ./demosctl status
  ./demosctl workspace
  ./demosctl history
  ./demosctl stop --confirm stop
  ./demosctl start --confirm start
  ./demosctl update --commit FULL_SHA --confirm update:FULL_SHA`)
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parse(argv)
  if (!parsed.command || parsed.command === "help" || parsed.options.has("help")) {
    usage()
    return
  }
  if (parsed.command === "prepare-key") return prepareKeyCommand(parsed)
  if (parsed.command === "archive-incomplete-init") return archiveIncompleteInitCommand(parsed)
  if (parsed.command === "init") return initCommand(parsed)
  if (parsed.command === "onboard" && !existsSync(CONFIG_PATH)) { await onboardCommand(parsed); return }
  const config = readConfig()
  requireConfirmation(parsed)
  switch (parsed.command) {
    case "doctor": return doctorCommand(parsed)
    case "ssh": return sshCommand(config)
    case "install": return installCommand(config, parsed)
    case "upgrade-operator": return upgradeOperatorCommand(config, parsed)
    case "secrets": return secretsCommand(config, parsed)
    case "recovery": await recoveryCommand(config, parsed); return
    case "retrust-host": await retrustHostCommand(config, parsed); return
    case "pubkey": return pubkeyCommand(config)
    case "backup": await backupCommand(config); return
    case "restore": await restoreCommand(config, parsed); return
    case "stake": await stakeCommand(config); return
    case "onboard": await onboardCommand(parsed, config); return
    case "status": await statusCommand(config); return
    case "workspace": return workspaceCommand(config)
    case "history": return historyCommand()
    case "stop": return serviceCommand(config, "stop")
    case "start": return serviceCommand(config, "start")
    case "update": await updateCommand(config, parsed); return
    default: throw new Error(`unknown command: ${parsed.command}`)
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
