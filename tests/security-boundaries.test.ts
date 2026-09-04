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
  })

  test("secret configuration transports stdin and never places values in SSH arguments", () => {
    const script = readFileSync(join(ROOT, "scripts", "configure-secrets.sh"), "utf8")
    const bootstrap = readFileSync(join(ROOT, "scripts", "remote-bootstrap.sh"), "utf8")
    expect(script).toContain("read -r -s")
    expect(script).toContain("printf '%s' \"${payload}\" | ssh")
    expect(script).toContain("demos-secret-set-batch")
    expect(bootstrap).toContain("demos-secret-status")
    expect(bootstrap).toContain("install -m 0600 -o root -g root")
    expect(script).not.toContain("sshpass")
    expect(script).not.toMatch(/echo[^\n]*\$\{?value/)
  })

  test("secret operations cover ownership, rotation, recovery, exposure, and offboarding", () => {
    const runbook = readFileSync(join(ROOT, "docs", "secret-operations.md"), "utf8")
    for (const heading of ["Secret inventory", "Secure entry and verification", "Node identity backup", "Routine rotation", "Exposure response", "Offboarding and node transfer", "Quarterly audit"]) {
      expect(runbook).toContain(`## ${heading}`)
    }
    for (const material of ["DEMOS node identity", "SSH private key", "GitHub token", "Etherscan/Helius", "TLSNotary", "Contabo credentials"]) {
      expect(runbook).toContain(material)
    }
  })

  test("repository exposes no provider lifecycle command", () => {
    const cli = readFileSync(join(ROOT, "src", "demosctl.ts"), "utf8")
    expect(cli).not.toMatch(/contabo|deleteInstance|stopInstance|reinstall|shutdown -h|systemctl reboot/i)
  })

  test("restore stages and validates before touching live state", () => {
    const cli = readFileSync(join(ROOT, "src", "demosctl.ts"), "utf8")
    const restore = cli.slice(cli.indexOf("async function restoreCommand"), cli.indexOf("function serviceCommand"))
    expect(restore.indexOf("stageRemote")).toBeLessThan(restore.indexOf("systemctl stop"))
    expect(restore).toContain("live state was not touched")
    expect(restore).toContain("/source:ro")
    expect(restore).toContain("rollbackVolume")
    expect(restore).toContain("activation failed; restoring rollback volume")
    expect(restore).toContain("test -s /target/.demos_identity")
  })

  test("backup requires an existing volume with node identity", () => {
    const cli = readFileSync(join(ROOT, "src", "demosctl.ts"), "utf8")
    const backup = cli.slice(cli.indexOf("async function backupCommand"), cli.indexOf("async function restoreCommand"))
    expect(backup).toContain("docker volume inspect demos_node_state")
    expect(backup).toContain("test -s /state/.demos_identity")
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
    for (const term of ["Personal identity", "Workstation", "Repository and Codex", "VPS and credentials", "Recovery and handover"]) expect(onboarding).toContain(term)
    expect(decisions).toContain("0001-command-center-and-secret-boundaries.md")
    expect(incident).toContain("Never record tokens")
  })
})
