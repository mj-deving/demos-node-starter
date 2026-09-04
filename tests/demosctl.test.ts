import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { validateNodePublicKey, validatePublicUrl } from "../src/demosctl"

const ROOT = join(import.meta.dir, "..")
const CLI = join(ROOT, "src", "demosctl.ts")
const temporary: string[] = []

afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "demos-node-starter-test-"))
  temporary.push(path)
  return path
}

function run(args: string[], env: Record<string, string> = {}) {
  return Bun.spawnSync(["bun", CLI, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  })
}

describe("public URL validation", () => {
  test("accepts an externally addressed port-53550 URL", () => {
    expect(validatePublicUrl("http://203.0.113.10:53550")).toBe("http://203.0.113.10:53550")
  })

  test.each([
    "http://localhost:53550",
    "http://127.0.0.1:53550",
    "ftp://203.0.113.10:53550",
    "http://203.0.113.10:1234",
    "http://named-user@203.0.113.10:53550",
    "http://203.0.113.10:53550/path",
  ])("rejects unsafe or unroutable URL %s", (value) => {
    expect(() => validatePublicUrl(value)).toThrow()
  })
})

describe("node public-key validation", () => {
  test("accepts only the canonical DEMOS Ed25519 representation", () => {
    expect(validateNodePublicKey(`0x${"a".repeat(64)}`)).toBe(`0x${"a".repeat(64)}`)
    for (const value of [`0x${"a".repeat(63)}`, `0x${"a".repeat(65)}`, "a".repeat(64), `0x${"A".repeat(64)}`, `0x${"g".repeat(64)}`]) {
      expect(() => validateNodePublicKey(value)).toThrow()
    }
  })
})

describe("operator state", () => {
  test("init writes private state without credentials", () => {
    const state = tempDir()
    const result = run(
      [
        "init",
        "--alias", "canary",
        "--hostname", "203.0.113.10",
        "--public-url", "http://203.0.113.10:53550",
        "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "--identity-file", join(state, "id_ed25519"),
        "--skip-keygen",
        "--skip-host-key-check",
      ],
      { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1" },
    )
    expect(result.exitCode).toBe(0)
    const operatorPath = join(state, "operator.json")
    expect(statSync(operatorPath).mode & 0o777).toBe(0o600)
    expect(statSync(join(state, "ssh_config")).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(state, "ssh_config"), "utf8")).toContain(`IdentityFile "${join(state, "id_ed25519")}"`)
    expect(readFileSync(join(state, "ssh_config"), "utf8")).toContain("StrictHostKeyChecking yes")
    expect(readFileSync(join(state, "ssh_config"), "utf8")).toContain("UserKnownHostsFile")
    expect(statSync(join(state, "WORKSPACE.md")).mode & 0o777).toBe(0o600)
    expect(statSync(join(state, "operations.jsonl")).mode & 0o777).toBe(0o600)
    const content = readFileSync(operatorPath, "utf8")
    expect(content).toContain('"branch": "stabilisation"')
    expect(content).not.toMatch(/TOKEN|API_KEY|PASSWORD|MNEMONIC/)
    expect(readFileSync(join(state, "WORKSPACE.md"), "utf8")).toContain("never secret values")
    expect(JSON.parse(readFileSync(join(state, "operations.jsonl"), "utf8")).action).toBe("init")
  })

  test("init rejects a loopback EXPOSED_URL", () => {
    const result = run(
      ["init", "--alias", "bad", "--hostname", "127.0.0.1", "--public-url", "http://127.0.0.1:53550", "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--skip-keygen", "--skip-host-key-check"],
      { DEMOSCTL_STATE_DIR: tempDir(), DEMOSCTL_TEST_MODE: "1" },
    )
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("public URL must be reachable")
  })

  test("workspace and history expose value-free continuity metadata", () => {
    const state = tempDir()
    const env = { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1" }
    expect(run(["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--skip-keygen", "--skip-host-key-check"], env).exitCode).toBe(0)
    expect(run(["workspace"], env).exitCode).toBe(0)
    const history = run(["history"], env)
    expect(history.exitCode).toBe(0)
    expect(history.stdout.toString()).toContain('"action":"init"')
    expect(history.stdout.toString()).not.toMatch(/TOKEN|API_KEY|PASSWORD|MNEMONIC/)
  })

  test("init refuses to overwrite operator state", () => {
    const state = tempDir()
    const args = ["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--skip-keygen", "--skip-host-key-check"]
    const env = { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1" }
    expect(run(args, env).exitCode).toBe(0)
    const second = run(args, env)
    expect(second.exitCode).not.toBe(0)
    expect(second.stderr.toString()).toContain("operator state already exists")
  })

  test("init refuses silent SSH private-key reuse", () => {
    const state = tempDir()
    const identity = join(state, "existing-key")
    writeFileSync(identity, "not-a-real-key", { mode: 0o600 })
    writeFileSync(`${identity}.pub`, "not-a-real-public-key\n", { mode: 0o600 })
    const result = run(["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--identity-file", identity, "--skip-host-key-check"], { DEMOSCTL_STATE_DIR: join(state, "operator"), DEMOSCTL_TEST_MODE: "1" })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("refusing to reuse an existing SSH key")
  })
})

describe("mutation authority", () => {
  test("stop never reaches SSH without the exact confirmation", () => {
    const state = tempDir()
    const fakeBinDir = tempDir()
    const log = join(fakeBinDir, "ssh.log")
    const ssh = join(fakeBinDir, "ssh")
    writeFileSync(ssh, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nprintf 'LoadState=loaded\\nActiveState=inactive\\nSubState=dead\\n'\n`)
    chmodSync(ssh, 0o700)
    expect(run(["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--skip-keygen", "--skip-host-key-check"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1" }).exitCode).toBe(0)

    const denied = run(["stop"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: ssh })
    expect(denied.exitCode).not.toBe(0)
    expect(denied.stderr.toString()).toContain("pass --confirm stop")
    expect(Bun.file(log).size).toBe(0)

    const allowed = run(["stop", "--confirm", "stop"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: ssh })
    expect(allowed.exitCode).toBe(0)
    expect(readFileSync(log, "utf8")).toContain("systemctl stop demos-node.service")
    expect(readFileSync(log, "utf8")).not.toMatch(/shutdown|reboot|instance/)
  })

  test("install confirmation is bound to the exact approved commit", () => {
    const state = tempDir()
    const fakeBinDir = tempDir()
    const ssh = join(fakeBinDir, "ssh")
    const log = join(fakeBinDir, "ssh.log")
    writeFileSync(ssh, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`)
    chmodSync(ssh, 0o700)
    expect(run(["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--skip-keygen", "--skip-host-key-check"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1" }).exitCode).toBe(0)
    const commit = "8f6ad5830ffde90bc9e896b5f288c13b8068f81f"
    const denied = run(["install", "--commit", commit, "--confirm", "install"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: ssh })
    expect(denied.exitCode).not.toBe(0)
    expect(denied.stderr.toString()).toContain(`pass --confirm install:${commit}`)
    expect(Bun.file(log).size).toBe(0)
  })

  test("restore identity mismatch cleans staging before any service stop", () => {
    const state = tempDir()
    const fakeBinDir = tempDir()
    const ssh = join(fakeBinDir, "ssh")
    const age = join(fakeBinDir, "age")
    const log = join(fakeBinDir, "ssh.log")
    const backup = join(state, "wrong-node.tar.age")
    writeFileSync(backup, "encrypted-fixture", { mode: 0o600 })
    writeFileSync(age, "#!/bin/sh\nprintf 'tar-fixture'\n")
    writeFileSync(ssh, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncase "$*" in\n  *show:pubkey*) exit 1 ;;\nesac\ncat >/dev/null\n`)
    chmodSync(age, 0o700)
    chmodSync(ssh, 0o700)
    expect(run(["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--skip-keygen", "--skip-host-key-check"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1" }).exitCode).toBe(0)
    const result = run(["restore", "--from", backup, "--expected-public-key", `0x${"a".repeat(64)}`, "--confirm", "restore"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: ssh, DEMOSCTL_AGE_BIN: age })
    expect(result.exitCode).not.toBe(0)
    const calls = readFileSync(log, "utf8")
    expect(calls).toContain("show:pubkey")
    expect(calls).toContain("docker volume rm demos_node_state_restore_")
    expect(calls).not.toContain("systemctl stop")
  })
})
