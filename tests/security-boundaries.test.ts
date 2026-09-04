import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

describe("checked-in safety boundaries", () => {
  test("remote service selects required services and excludes reaper", () => {
    const bootstrap = readFileSync(join(ROOT, "scripts", "remote-bootstrap.sh"), "utf8")
    const execStart = bootstrap.split("\n").find((line) => line.startsWith("ExecStart=")) || ""
    expect(execStart).toContain("postgres tlsnotary node prometheus grafana")
    expect(execStart).not.toContain("reaper")
    expect(bootstrap).toContain('chown -R root:root "${REPO_DIR}"')
    expect(bootstrap).toContain('chmod -R go-w "${REPO_DIR}"')
    expect(bootstrap).toContain("node checkout already exists; use the backup-gated demosctl update command")
    expect(bootstrap).toContain('set_env "${secret_key}" "" "${REPO_DIR}/.env"')
    expect(bootstrap).not.toContain('sudo -u "${RUNTIME_USER}" git')
    expect(bootstrap).not.toContain("docker compose down -v")
    expect(bootstrap).not.toContain("git reset --hard")
    expect(bootstrap).toContain('checkout --detach "${COMMIT}"')
    expect(bootstrap).toContain("cleanup_checkout")
    expect(bootstrap.indexOf('rev-parse "origin/${BRANCH}"')).toBeLessThan(bootstrap.indexOf('mv -- "${staging_root}/checkout" "${REPO_DIR}"'))
    expect(bootstrap).toContain('VERSION_ID:-}" == "22.04"')
    expect(bootstrap).toContain('dpkg --print-architecture)" == "amd64"')
    expect(bootstrap).toContain('docker pull "${HELPER_IMAGE}"')
  })

  test("secret configuration transports stdin and never places values in SSH arguments", () => {
    const script = readFileSync(join(ROOT, "scripts", "configure-secrets.sh"), "utf8")
    const bootstrap = readFileSync(join(ROOT, "scripts", "remote-bootstrap.sh"), "utf8")
    expect(script).toContain("read -r -s")
    expect(script).toContain("printf '%s' \"${payload}\" | ssh")
    expect(script).toContain("demos-secret-set-batch")
    expect(bootstrap).toContain("demos-secret-status")
    expect(bootstrap).toContain("install -m 0600 -o root -g root")
    expect(bootstrap).toContain('mv -- "${candidate}" "${SECRETS_FILE}"')
    expect(bootstrap).toContain("previous file restored")
    expect(bootstrap).toContain('[[ "${persisted}" == "${line}" ]]')
    expect(bootstrap).not.toContain('grep -Fqx -- "${line}"')
    expect(bootstrap).toContain("demos-secret-set-batch/v2")
    expect(bootstrap).toContain("demos-secret-status/v3")
    expect(bootstrap).toContain('[[ "${1:-}" != "--require-core" ]]')
    expect(script).toContain("%s=verified")
    expect(script).toContain('[[ "${response}" == "${expected}" ]]')
    expect(script).toContain("upgrade-operator")
    const upgrade = readFileSync(join(ROOT, "scripts", "install-secret-helpers.sh"), "utf8")
    expect(upgrade).toContain("demos-secret-set-batch/v2")
    expect(upgrade).toContain("demos-secret-status/v3")
    expect(upgrade).not.toContain('grep -Fqx -- "${line}"')
    expect(script).not.toContain("sshpass")
    expect(script).not.toMatch(/echo[^\n]*\$\{?value/)
  })

  test("secret operations cover ownership, rotation, recovery, exposure, and offboarding", () => {
    const runbook = readFileSync(join(ROOT, "docs", "secret-operations.md"), "utf8")
    for (const heading of ["Secret inventory", "Secure entry and verification", "Node identity backup", "Routine rotation", "Exposure response", "Offboarding and node transfer", "Quarterly audit"]) {
      expect(runbook).toContain(`## ${heading}`)
    }
    for (const material of ["DEMOS node identity", "SSH private key", "GITHUB_TOKEN", "ETHERSCAN_API_KEY", "HELIUS_API_KEY", "TLSNotary", "Hosting account credentials"]) {
      expect(runbook).toContain(material)
    }
  })

  test("repository exposes no provider lifecycle command", () => {
    const cli = readFileSync(join(ROOT, "src", "demosctl.ts"), "utf8")
    expect(cli).not.toMatch(/deleteInstance|stopInstance|shutdown -h|systemctl reboot/i)
    expect(cli).not.toMatch(/provider[^\n]*(delete|stop|reinstall)/i)
  })

  test("restore stages and validates before touching live state", () => {
    const cli = readFileSync(join(ROOT, "src", "demosctl.ts"), "utf8")
    const restore = cli.slice(cli.indexOf("async function restoreCommand"), cli.indexOf("function serviceCommand"))
    const staging = cli.slice(cli.indexOf("async function stageAndVerifyArchive"), cli.indexOf("function removeRemoteVolume"))
    expect(cli.indexOf("async function stageAndVerifyArchive")).toBeLessThan(cli.indexOf("async function restoreCommand"))
    expect(staging).toContain("live state was not touched")
    expect(restore).toContain("/source:ro")
    expect(restore).toContain("rollbackVolume")
    expect(restore).toContain("activation failed; recovering prior volume state")
    expect(restore).toContain("live_existed=false")
    expect(restore).toContain("docker volume create demos_node_state")
    expect(restore).toContain("cleanup failed; plaintext recovery volumes retained for manual recovery")
    expect(restore).toContain("test -s /target/.demos_identity")
    expect(restore).toContain("expected-public-key")
    expect(staging).toContain("verifyStagedIdentity")
    expect(restore).toContain("grep -Fx --")
    expect(restore).toContain("--pull=never --network=none --cap-drop=ALL")
  })

  test("backup requires an existing volume with node identity", () => {
    const cli = readFileSync(join(ROOT, "src", "demosctl.ts"), "utf8")
    const backup = cli.slice(cli.indexOf("async function backupCommand"), cli.indexOf("async function restoreCommand"))
    expect(backup).toContain("docker volume inspect demos_node_state")
    expect(backup).toContain("test -s /state/.demos_identity")
    expect(cli).toContain('HELPER_IMAGE = "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"')
    expect(backup).toContain("docker image inspect ${HELPER_IMAGE}")
    expect(backup).toContain("docker pull ${HELPER_IMAGE}")
    expect(backup).toContain("--network=none")
  })

  test("recovery qualification is durable, password-manager independent, and gates valuable actions", () => {
    const cli = readFileSync(join(ROOT, "src", "demosctl.ts"), "utf8")
    const backup = cli.slice(cli.indexOf("async function backupCommand"), cli.indexOf("async function restoreCommand"))
    const stake = cli.slice(cli.indexOf("async function stakeCommand"), cli.indexOf("async function updateCommand"))
    const update = cli.slice(cli.indexOf("async function updateCommand"), cli.indexOf("async function getJson"))

    expect(cli).toContain("RECOVERY_CONFIG_PATH")
    expect(cli).toContain("RECOVERY_RECEIPT_PATH")
    expect(cli).toContain("recoveryCopyPath")
    expect(cli).toContain("archiveSha256")
    expect(cli).toContain("qualifiedAt")
    expect(cli).toContain("age-keygen")
    expect(cli).toContain('purpose === "reinstall"')
    expect(cli).toContain("SAFE TO REINSTALL")
    expect(cli).toContain("REINSTALL_AUTH_PATH")
    expect(cli).toContain("retrustHostCommand")
    expect(cli).toContain("Date.parse(authorization.expiresAt) <= Date.now()")
    expect(cli).toContain("renameSync(REINSTALL_AUTH_PATH, REINSTALL_CLAIM_PATH)")
    expect(cli).toContain("rollback snapshot identity mismatch")
    expect(cli).toContain("rollback identity verification failed")
    expect(backup).toContain("stageAndVerifyArchive")
    expect(backup).not.toContain('[binary("age"), "-p"')
    expect(stake).toContain('requireQualifiedRecovery(config, "stake")')
    expect(update).toContain("await backupCommand(config)")
    expect(cli).not.toContain("op item")
    expect(cli).not.toContain("1password")
  })

  test("beginner onboarding and secret setup expose value-free resumable guidance", () => {
    const cli = readFileSync(join(ROOT, "src", "demosctl.ts"), "utf8")
    const script = readFileSync(join(ROOT, "scripts", "configure-secrets.sh"), "utf8")
    expect(cli).toContain('case "onboard"')
    expect(cli).toContain('parsed.rest[0] === "setup"')
    expect(script).toContain("HELIUS_API_KEY) requirement=\"required\"")
    expect(script).not.toContain("GITHUB_TOKEN|ETHERSCAN_API_KEY|HELIUS_API_KEY) requirement=\"required\"")
    expect(script).toContain('read -r -s -p "${key} (${requirement}): " value')
    expect(script).not.toMatch(/echo[^\n]*\$\{?value/)
  })

  test("credential policy explains purpose and controlled fleet reuse without broad GitHub access", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8")
    const runbook = readFileSync(join(ROOT, "docs", "secret-operations.md"), "utf8")
    const bootstrap = readFileSync(join(ROOT, "scripts", "remote-bootstrap.sh"), "utf8")
    const upgrade = readFileSync(join(ROOT, "scripts", "install-secret-helpers.sh"), "utf8")
    const register = readFileSync(join(ROOT, "docs", "templates", "credential-register.md"), "utf8")

    for (const credential of ["GITHUB_TOKEN", "ETHERSCAN_API_KEY", "HELIUS_API_KEY"]) {
      expect(readme).toContain(credential)
      expect(runbook).toContain(credential)
    }
    for (const term of ["one operator-owned fleet", "aggregate quota", "IP restrictions", "coordinate fleet rotation"]) expect(runbook).toContain(term)
    expect(readme).toContain("never distribute a classic `repo` token")
    expect(runbook).toContain("not the DEMOS node identity")
    expect(register).toContain("Never record a token value")
    expect(bootstrap).toContain("HELIUS_API_KEY) printf '%s=missing")
    expect(upgrade).toContain("HELIUS_API_KEY) printf '%s=missing")
    expect(bootstrap).not.toContain("GITHUB_TOKEN|ETHERSCAN_API_KEY|HELIUS_API_KEY) printf '%s=missing")
    expect(upgrade).not.toContain("GITHUB_TOKEN|ETHERSCAN_API_KEY|HELIUS_API_KEY) printf '%s=missing")
  })

  test("status validates DEMOS response semantics and identity agreement", () => {
    const cli = readFileSync(join(ROOT, "src", "demosctl.ts"), "utf8")
    const status = cli.slice(cli.indexOf("async function statusCommand"), cli.indexOf("function sshCommand"))
    expect(status).toContain('message === "Hello, World!"')
    expect(status).toContain("infoBody.connectionString === config.publicUrl")
    expect(status).toContain("publicKey.body === infoBody?.identity && publicKey.body === service.localIdentity")
    expect(status).toContain("http://127.0.0.1:53550/info")
  })

  test("command center preserves onboarding, decisions, cadence, and value-free memory", () => {
    const operations = readFileSync(join(ROOT, "OPERATIONS.md"), "utf8")
    const onboarding = readFileSync(join(ROOT, "docs", "security-onboarding.md"), "utf8")
    const decisions = readFileSync(join(ROOT, "docs", "decisions", "README.md"), "utf8")
    const incident = readFileSync(join(ROOT, "docs", "templates", "incident-record.md"), "utf8")
    for (const term of ["Start every session", "Sources of truth", "Routine cadence", "Change procedure", "Incident entry point"]) expect(operations).toContain(term)
    for (const term of ["Personal identity", "Workstation", "Repository and Codex", "Host and credentials", "Recovery and handover"]) expect(onboarding).toContain(term)
    expect(decisions).toContain("0001-command-center-and-secret-boundaries.md")
    expect(incident).toContain("Never record tokens")
  })

  test("host authentication completes before SSH private-key generation", () => {
    const cli = readFileSync(join(ROOT, "src", "demosctl.ts"), "utf8")
    const init = cli.slice(cli.indexOf("export function initCommand"), cli.indexOf("function doctorCommand"))
    expect(init.indexOf("scanned SSH host keys did not match")).toBeLessThan(init.indexOf("if (generatedDuringInit) createIdentity"))
    expect(cli).toContain('runChecked(binary("ssh-keygen"), ["-t", "ed25519"')
  })
})
