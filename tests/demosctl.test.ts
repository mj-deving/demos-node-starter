import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
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

function initializeTestOperator(state: string): void {
  const result = run(
    ["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--skip-keygen", "--skip-host-key-check"],
    { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1" },
  )
  expect(result.exitCode).toBe(0)
}

function recoveryFixture(publicKey = `0x${"a".repeat(64)}`) {
  const bin = tempDir()
  const ssh = join(bin, "ssh")
  const age = join(bin, "age")
  const ageKeygen = join(bin, "age-keygen")
  const sshLog = join(bin, "ssh.log")
  const alternateRecipient = `age1${"z".repeat(58)}`
  const recipient = `age1${"q".repeat(58)}`
  writeFileSync(ageKeygen, `#!/bin/sh
if [ "$1" = "-o" ]; then
  printf 'AGE-SECRET-KEY-TEST-FIXTURE\n' > "$2"
  exit 0
fi
if grep -q corrupted "$2" 2>/dev/null; then
  printf '${alternateRecipient}\n'
else
  printf '${recipient}\n'
fi
`)
  writeFileSync(age, `#!/bin/sh
case " $* " in
  *" -r "*)
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "-o" ]; then shift; output="$1"; break; fi
      shift
    done
    cat > "$output"
    ;;
  *" -d "*) printf 'tar-fixture' ;;
  *) exit 1 ;;
esac
`)
  writeFileSync(ssh, `#!/bin/sh
printf '%s\n' "$*" >> "${sshLog}"
case "$*" in
  *show:pubkey*) printf 'Public Key: ${publicKey}\n' ;;
  *'docker volume create demos_node_state_restore_'*) cat >/dev/null ;;
  *'docker volume rm demos_node_state_restore_'*) ;;
  *) printf 'tar-fixture' ;;
esac
`)
  for (const path of [ssh, age, ageKeygen]) chmodSync(path, 0o700)
  return { age, ageKeygen, recipient, ssh, sshLog }
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
  test("failed inline key generation leaves no committed state and remains retryable", () => {
    const state = tempDir()
    const fakeBinDir = tempDir()
    const identity = join(tempDir(), "identity")
    const attempts = join(fakeBinDir, "attempts")
    const fingerprint = `SHA256:${"A".repeat(43)}`
    const keyscan = join(fakeBinDir, "ssh-keyscan")
    const keygen = join(fakeBinDir, "ssh-keygen")
    writeFileSync(keyscan, "#!/bin/sh\nprintf '203.0.113.10 ssh-ed25519 RetryFixture\\n'\n")
    writeFileSync(keygen, `#!/bin/sh\nif [ "$1" = "-lf" ]; then\n  cat >/dev/null\n  printf '256 ${fingerprint} fixture (ED25519)\\n'\n  exit 0\nfi\nprintf 'attempt\\n' >> "${attempts}"\nexit 1\n`)
    chmodSync(keyscan, 0o700)
    chmodSync(keygen, 0o700)
    const args = ["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--trust-new-host", "203.0.113.10", "--identity-file", identity]
    const env = { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_KEYSCAN_BIN: keyscan, DEMOSCTL_SSH_KEYGEN_BIN: keygen }

    const first = run(args, env)
    const second = run(args, env)

    expect(first.exitCode).not.toBe(0)
    expect(second.exitCode).not.toBe(0)
    expect(second.stderr.toString()).not.toContain("operator state already exists")
    expect(readFileSync(attempts, "utf8").trim().split("\n")).toHaveLength(2)
    for (const name of ["known_hosts", "operator.json", "ssh_config", "WORKSPACE.md", "operations.jsonl"]) expect(existsSync(join(state, name))).toBe(false)
    expect(existsSync(identity)).toBe(false)
    expect(existsSync(`${identity}.pub`)).toBe(false)
  })

  test("a tool-prepared identity can be provisioned before init and is consumed exactly once", () => {
    const state = tempDir()
    const fakeBinDir = tempDir()
    const identity = join(tempDir(), "identity")
    const invocations = join(fakeBinDir, "invocations")
    const fingerprint = `SHA256:${"B".repeat(43)}`
    const keygen = join(fakeBinDir, "ssh-keygen")
    writeFileSync(keygen, `#!/bin/sh\nprintf '%s\\n' "$1" >> "${invocations}"\nif [ "$1" = "-t" ]; then\n  while [ "$#" -gt 0 ]; do\n    if [ "$1" = "-f" ]; then shift; key_path="$1"; break; fi\n    shift\n  done\n  printf 'private fixture\\n' > "$key_path"\n  printf 'ssh-ed25519 PreparedFixture demos-node-canary\\n' > "$key_path.pub"\n  exit 0\nfi\nprintf '256 ${fingerprint} fixture (ED25519)\\n'\n`)
    chmodSync(keygen, 0o700)
    const env = { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1", DEMOSCTL_SSH_KEYGEN_BIN: keygen }

    const prepared = run(["prepare-key", "--alias", "canary", "--identity-file", identity], env)
    expect(prepared.exitCode).toBe(0)
    expect(existsSync(join(state, "prepared-identity.json"))).toBe(true)
    expect(statSync(join(state, "prepared-identity.json")).mode & 0o777).toBe(0o600)
    expect(prepared.stdout.toString()).toContain(`${identity}.pub`)

    const initialized = run(["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", fingerprint, "--identity-file", identity, "--skip-host-key-check"], env)
    expect(initialized.exitCode).toBe(0)
    expect(existsSync(join(state, "prepared-identity.json"))).toBe(false)
    expect(readFileSync(invocations, "utf8").trim().split("\n").filter((value) => value === "-t")).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(state, "operator.json"), "utf8")).identityFile).toBe(identity)
  })

  test("init rejects a prepared identity whose public key changed", () => {
    const state = tempDir()
    const fakeBinDir = tempDir()
    const identity = join(tempDir(), "identity")
    const originalFingerprint = `SHA256:${"C".repeat(43)}`
    const changedFingerprint = `SHA256:${"D".repeat(43)}`
    const keygen = join(fakeBinDir, "ssh-keygen")
    writeFileSync(keygen, `#!/bin/sh\nif [ "$1" = "-t" ]; then\n  while [ "$#" -gt 0 ]; do\n    if [ "$1" = "-f" ]; then shift; key_path="$1"; break; fi\n    shift\n  done\n  printf 'private fixture\\n' > "$key_path"\n  printf 'ssh-ed25519 PreparedFixture demos-node-canary\\n' > "$key_path.pub"\n  exit 0\nfi\nif [ "$2" != "-" ] && grep -q '^tampered$' "$2" 2>/dev/null; then\n  printf '256 ${changedFingerprint} fixture (ED25519)\\n'\nelse\n  printf '256 ${originalFingerprint} fixture (ED25519)\\n'\nfi\n`)
    chmodSync(keygen, 0o700)
    const env = { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1", DEMOSCTL_SSH_KEYGEN_BIN: keygen }
    expect(run(["prepare-key", "--alias", "canary", "--identity-file", identity], env).exitCode).toBe(0)
    writeFileSync(`${identity}.pub`, "tampered\n")

    const result = run(["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", originalFingerprint, "--identity-file", identity, "--skip-host-key-check"], env)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("no longer matches its recorded fingerprint")
    expect(existsSync(join(state, "prepared-identity.json"))).toBe(true)
    expect(existsSync(join(state, "known_hosts"))).toBe(false)
  })

  test("init pins a new host on explicit first use and records the observed fingerprint", () => {
    const state = tempDir()
    const fakeBinDir = tempDir()
    const fingerprint = `SHA256:${"B".repeat(43)}`
    const keyscan = join(fakeBinDir, "ssh-keyscan")
    const keygen = join(fakeBinDir, "ssh-keygen")
    writeFileSync(keyscan, "#!/bin/sh\nprintf '203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFirstUseFixture\\n'\n")
    writeFileSync(keygen, `#!/bin/sh\ncat >/dev/null\nprintf '256 ${fingerprint} fixture (ED25519)\\n'\n`)
    chmodSync(keyscan, 0o700)
    chmodSync(keygen, 0o700)

    const result = run(
      ["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--trust-new-host", "203.0.113.10", "--skip-keygen"],
      { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1", DEMOSCTL_SSH_KEYSCAN_BIN: keyscan, DEMOSCTL_SSH_KEYGEN_BIN: keygen },
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain(fingerprint)
    const config = JSON.parse(readFileSync(join(state, "operator.json"), "utf8"))
    expect(config.hostKeyTrust).toBe("first-use")
    expect(config.hostKeyFingerprint).toBe(fingerprint)
    expect(readFileSync(join(state, "known_hosts"), "utf8")).toContain("ssh-ed25519")
    expect(readFileSync(join(state, "ssh_config"), "utf8")).toContain("StrictHostKeyChecking yes")
  })

  test("init refuses missing, ambiguous, or incorrectly bound first-use trust", () => {
    const common = ["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--skip-keygen"]
    const noTrust = run(common, { DEMOSCTL_STATE_DIR: tempDir(), DEMOSCTL_TEST_MODE: "1" })
    expect(noTrust.exitCode).not.toBe(0)
    expect(noTrust.stderr.toString()).toContain("choose exactly one SSH trust route")

    const wrongHost = run([...common, "--trust-new-host", "other.example"], { DEMOSCTL_STATE_DIR: tempDir(), DEMOSCTL_TEST_MODE: "1" })
    expect(wrongHost.exitCode).not.toBe(0)
    expect(wrongHost.stderr.toString()).toContain("must exactly match --hostname")

    const both = run([...common, "--trust-new-host", "203.0.113.10", "--host-key-sha256", `SHA256:${"A".repeat(43)}`], { DEMOSCTL_STATE_DIR: tempDir(), DEMOSCTL_TEST_MODE: "1" })
    expect(both.exitCode).not.toBe(0)
    expect(both.stderr.toString()).toContain("choose exactly one SSH trust route")
  })

  test("first-use trust refuses multiple distinct Ed25519 host keys", () => {
    const state = tempDir()
    const fakeBinDir = tempDir()
    const keyscan = join(fakeBinDir, "ssh-keyscan")
    const keygen = join(fakeBinDir, "ssh-keygen")
    writeFileSync(keyscan, "#!/bin/sh\nprintf '203.0.113.10 ssh-ed25519 FirstKey\\n203.0.113.10 ssh-ed25519 SecondKey\\n'\n")
    writeFileSync(keygen, `#!/bin/sh\nvalue="$(cat)"\ncase "$value" in\n  *FirstKey*) fingerprint='SHA256:${"A".repeat(43)}' ;;\n  *) fingerprint='SHA256:${"B".repeat(43)}' ;;\nesac\nprintf '256 %s fixture (ED25519)\\n' "$fingerprint"\n`)
    chmodSync(keyscan, 0o700)
    chmodSync(keygen, 0o700)
    const result = run(
      ["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--trust-new-host", "203.0.113.10", "--skip-keygen"],
      { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1", DEMOSCTL_SSH_KEYSCAN_BIN: keyscan, DEMOSCTL_SSH_KEYGEN_BIN: keygen },
    )
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("exactly one distinct Ed25519 SSH host key")
    expect(Bun.file(join(state, "known_hosts")).size).toBe(0)
  })

  test("independently verified trust pins only the matching Ed25519 key", () => {
    const state = tempDir()
    const fakeBinDir = tempDir()
    const fingerprint = `SHA256:${"C".repeat(43)}`
    const keyscan = join(fakeBinDir, "ssh-keyscan")
    const keygen = join(fakeBinDir, "ssh-keygen")
    writeFileSync(keyscan, "#!/bin/sh\nprintf '203.0.113.10 ssh-ed25519 VerifiedKey\\n'\n")
    writeFileSync(keygen, `#!/bin/sh\ncat >/dev/null\nprintf '256 ${fingerprint} fixture (ED25519)\\n'\n`)
    chmodSync(keyscan, 0o700)
    chmodSync(keygen, 0o700)
    const result = run(
      ["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", fingerprint, "--skip-keygen"],
      { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1", DEMOSCTL_SSH_KEYSCAN_BIN: keyscan, DEMOSCTL_SSH_KEYGEN_BIN: keygen },
    )
    expect(result.exitCode).toBe(0)
    const config = JSON.parse(readFileSync(join(state, "operator.json"), "utf8"))
    expect(config.hostKeyTrust).toBe("verified")
    expect(config.hostKeyFingerprint).toBe(fingerprint)
  })

  test("init writes private state without credentials", () => {
    const state = tempDir()
    const identity = join(tempDir(), "id_ed25519")
    const result = run(
      [
        "init",
        "--alias", "canary",
        "--hostname", "203.0.113.10",
        "--public-url", "http://203.0.113.10:53550",
        "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "--identity-file", identity,
        "--skip-keygen",
        "--skip-host-key-check",
      ],
      { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1" },
    )
    expect(result.exitCode).toBe(0)
    const operatorPath = join(state, "operator.json")
    expect(statSync(operatorPath).mode & 0o777).toBe(0o600)
    expect(statSync(join(state, "ssh_config")).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(state, "ssh_config"), "utf8")).toContain(`IdentityFile "${identity}"`)
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
    const identity = join(tempDir(), "existing-key")
    writeFileSync(identity, "not-a-real-key", { mode: 0o600 })
    writeFileSync(`${identity}.pub`, "not-a-real-public-key\n", { mode: 0o600 })
    const result = run(["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--identity-file", identity, "--skip-host-key-check"], { DEMOSCTL_STATE_DIR: join(state, "operator"), DEMOSCTL_TEST_MODE: "1" })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("refusing to reuse an existing SSH key")
  })

  test("identity paths inside operator state are rejected before key generation", () => {
    const state = tempDir()
    const fakeBinDir = tempDir()
    const invocations = join(fakeBinDir, "invocations")
    const keygen = join(fakeBinDir, "ssh-keygen")
    writeFileSync(keygen, `#!/bin/sh\nprintf invoked >> "${invocations}"\nexit 1\n`)
    chmodSync(keygen, 0o700)
    const env = { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_KEYGEN_BIN: keygen }

    const prepared = run(["prepare-key", "--alias", "canary", "--identity-file", join(state, "prepared-identity.json")], env)
    const initialized = run(["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--trust-new-host", "203.0.113.10", "--identity-file", join(state, "operator.json")], env)

    expect(prepared.exitCode).not.toBe(0)
    expect(initialized.exitCode).not.toBe(0)
    expect(prepared.stderr.toString()).toContain("outside the operator state directory")
    expect(initialized.stderr.toString()).toContain("outside the operator state directory")
    expect(existsSync(invocations)).toBe(false)
    expect(readdirSync(state)).toHaveLength(0)
  })

  test("legacy incomplete initialization can be archived before retry", () => {
    const state = tempDir()
    const knownHosts = join(state, "known_hosts")
    writeFileSync(knownHosts, "203.0.113.10 ssh-ed25519 LegacyPartial\n", { mode: 0o600 })
    const denied = run(["archive-incomplete-init"], { DEMOSCTL_STATE_DIR: state })
    expect(denied.exitCode).not.toBe(0)
    expect(existsSync(knownHosts)).toBe(true)

    const archived = run(["archive-incomplete-init", "--confirm", "archive-incomplete-init"], { DEMOSCTL_STATE_DIR: state })
    expect(archived.exitCode).toBe(0)
    expect(existsSync(knownHosts)).toBe(false)
    const archiveName = readdirSync(state).find((name) => name.startsWith("incomplete-init-"))
    expect(archiveName).toBeDefined()
    expect(readFileSync(join(state, archiveName!, "known_hosts"), "utf8")).toContain("LegacyPartial")

    const retried = run(["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", `SHA256:${"E".repeat(43)}`, "--skip-keygen", "--skip-host-key-check"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1" })
    expect(retried.exitCode).toBe(0)
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
    const result = run(["restore", "--from", backup, "--expected-public-key", `0x${"a".repeat(64)}`, "--legacy-passphrase", "--confirm", "restore"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: ssh, DEMOSCTL_AGE_BIN: age })
    expect(result.exitCode).not.toBe(0)
    const calls = readFileSync(log, "utf8")
    expect(calls).toContain("show:pubkey")
    expect(calls).toContain("docker volume rm demos_node_state_restore_")
    expect(calls).not.toContain("systemctl stop")
  })

  test("restore can transactionally create a missing live state volume", () => {
    const state = tempDir()
    const fakeBinDir = tempDir()
    const ssh = join(fakeBinDir, "ssh")
    const age = join(fakeBinDir, "age")
    const log = join(fakeBinDir, "ssh.log")
    const backup = join(state, "preserved-node.tar.age")
    writeFileSync(backup, "encrypted-fixture", { mode: 0o600 })
    writeFileSync(age, "#!/bin/sh\nprintf 'tar-fixture'\n")
    writeFileSync(ssh, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncase "$*" in\n  *show:pubkey*) printf 'Public Key: 0x${"a".repeat(64)}\\n' ;;\n  *) cat >/dev/null ;;\nesac\n`)
    chmodSync(age, 0o700)
    chmodSync(ssh, 0o700)
    expect(run(["init", "--alias", "canary", "--hostname", "203.0.113.10", "--public-url", "http://203.0.113.10:53550", "--host-key-sha256", "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--skip-keygen", "--skip-host-key-check"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_TEST_MODE: "1" }).exitCode).toBe(0)

    const result = run(["restore", "--from", backup, "--expected-public-key", `0x${"a".repeat(64)}`, "--legacy-passphrase", "--confirm", "restore"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: ssh, DEMOSCTL_AGE_BIN: age })
    expect(result.exitCode).toBe(0)
    const calls = readFileSync(log, "utf8")
    expect(calls).toContain("if sudo -n docker volume inspect demos_node_state")
    expect(calls).toContain("sudo -n docker volume create demos_node_state")
    expect(calls).toContain("live_existed=false")
    expect(calls).toContain("docker volume rm demos_node_state_restore_")
    expect(calls).toContain("demos_node_state >/dev/null || echo 'cleanup failed")
  })
})

describe("qualified recovery", () => {
  test("secret doctor rejects a legacy remote helper before trusting status", () => {
    const state = tempDir()
    const bin = tempDir()
    const ssh = join(bin, "ssh")
    const log = join(bin, "ssh.log")
    writeFileSync(ssh, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nprintf 'file=present\\nowner=root:root\\nmode=600\\nGITHUB_TOKEN=%s\\n' configured\n`)
    chmodSync(ssh, 0o700)
    initializeTestOperator(state)

    const result = run(["secrets", "doctor"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: ssh })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("missing or outdated")
    expect(readFileSync(log, "utf8")).toContain("--protocol")
  })

  test("a successful key-generator exit with an empty persisted key fails closed", () => {
    const state = tempDir()
    const bin = tempDir()
    const keygen = join(bin, "age-keygen")
    const primaryKey = join(tempDir(), "recovery.agekey")
    const recoveryCopy = join(tempDir(), "recovery.agekey")
    writeFileSync(keygen, "#!/bin/sh\nif [ \"$1\" = \"-o\" ]; then : > \"$2\"; exit 0; fi\nexit 1\n")
    chmodSync(keygen, 0o700)
    initializeTestOperator(state)

    const result = run(
      ["recovery", "create", "--key-file", primaryKey, "--copy-to", recoveryCopy, "--confirm", "recovery"],
      { DEMOSCTL_STATE_DIR: state, DEMOSCTL_AGE_KEYGEN_BIN: keygen },
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("recovery key is empty")
    expect(existsSync(primaryKey)).toBe(false)
    expect(existsSync(recoveryCopy)).toBe(false)
    expect(existsSync(join(state, "recovery.json"))).toBe(false)
    expect(existsSync(join(state, "recovery-receipt.json"))).toBe(false)
  })

  test("creates two persisted key copies and qualifies the exact encrypted identity archive", () => {
    const state = tempDir()
    const keys = tempDir()
    const second = tempDir()
    const fixture = recoveryFixture()
    initializeTestOperator(state)
    const primaryKey = join(keys, "recovery.agekey")
    const recoveryCopy = join(second, "recovery.agekey")
    const env = {
      DEMOSCTL_STATE_DIR: state,
      DEMOSCTL_TEST_MODE: "1",
      DEMOSCTL_SSH_BIN: fixture.ssh,
      DEMOSCTL_AGE_BIN: fixture.age,
      DEMOSCTL_AGE_KEYGEN_BIN: fixture.ageKeygen,
    }

    const result = run(["recovery", "create", "--key-file", primaryKey, "--copy-to", recoveryCopy, "--confirm", "recovery"], env)

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain("RECOVERY QUALIFIED")
    expect(statSync(primaryKey).mode & 0o777).toBe(0o600)
    expect(statSync(recoveryCopy).mode & 0o777).toBe(0o600)
    expect(readFileSync(primaryKey, "utf8")).toBe(readFileSync(recoveryCopy, "utf8"))
    const recovery = JSON.parse(readFileSync(join(state, "recovery.json"), "utf8"))
    const receipt = JSON.parse(readFileSync(join(state, "recovery-receipt.json"), "utf8"))
    expect(recovery.recipient).toBe(fixture.recipient)
    expect(receipt.expectedPublicKey).toBe(`0x${"a".repeat(64)}`)
    expect(receipt.archiveSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.archiveSize).toBeGreaterThan(0)
    expect(readFileSync(fixture.sshLog, "utf8")).toContain("show:pubkey")
  })

  test("stake fails closed before SSH when no qualified recovery exists", () => {
    const state = tempDir()
    const fixture = recoveryFixture()
    initializeTestOperator(state)
    const result = run(["stake", "--confirm", "stake"], { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: fixture.ssh, DEMOSCTL_AGE_KEYGEN_BIN: fixture.ageKeygen })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("recovery configuration is missing")
    expect(existsSync(fixture.sshLog)).toBe(false)
  })

  test("changed recovery copy invalidates qualification before staking", () => {
    const state = tempDir()
    const keys = tempDir()
    const second = tempDir()
    const fixture = recoveryFixture()
    initializeTestOperator(state)
    const recoveryCopy = join(second, "recovery.agekey")
    const env = { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: fixture.ssh, DEMOSCTL_AGE_BIN: fixture.age, DEMOSCTL_AGE_KEYGEN_BIN: fixture.ageKeygen }
    expect(run(["recovery", "create", "--key-file", join(keys, "recovery.agekey"), "--copy-to", recoveryCopy, "--confirm", "recovery"], env).exitCode).toBe(0)
    writeFileSync(recoveryCopy, "corrupted\n", { mode: 0o600 })
    writeFileSync(fixture.sshLog, "")

    const result = run(["stake", "--confirm", "stake"], env)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("key copies do not match")
    expect(readFileSync(fixture.sshLog, "utf8")).toBe("")
  })

  test("tampered archive invalidates reinstall qualification before SSH", () => {
    const state = tempDir()
    const fixture = recoveryFixture()
    initializeTestOperator(state)
    const env = { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: fixture.ssh, DEMOSCTL_AGE_BIN: fixture.age, DEMOSCTL_AGE_KEYGEN_BIN: fixture.ageKeygen }
    expect(run(["recovery", "create", "--key-file", join(tempDir(), "recovery.agekey"), "--copy-to", join(tempDir(), "recovery.agekey"), "--confirm", "recovery"], env).exitCode).toBe(0)
    const receipt = JSON.parse(readFileSync(join(state, "recovery-receipt.json"), "utf8"))
    writeFileSync(receipt.archivePath, "tampered archive", { mode: 0o600 })
    writeFileSync(fixture.sshLog, "")

    const result = run(["recovery", "check", "--for", "reinstall", "--confirm", "recovery-check:reinstall"], env)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toMatch(/changed size|digest changed/)
    expect(readFileSync(fixture.sshLog, "utf8")).toBe("")
  })

  test("decrypt failure explicitly removes the plaintext staging volume", () => {
    const state = tempDir()
    const fixture = recoveryFixture()
    const backup = join(tempDir(), "identity.tar.age")
    writeFileSync(backup, "ciphertext", { mode: 0o600 })
    writeFileSync(fixture.age, "#!/bin/sh\nprintf 'tar-fixture'\nexit 1\n")
    chmodSync(fixture.age, 0o700)
    initializeTestOperator(state)

    const result = run(["restore", "--from", backup, "--expected-public-key", `0x${"a".repeat(64)}`, "--legacy-passphrase", "--confirm", "restore"], {
      DEMOSCTL_STATE_DIR: state,
      DEMOSCTL_SSH_BIN: fixture.ssh,
      DEMOSCTL_AGE_BIN: fixture.age,
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain("staging cleanup")
    const calls = readFileSync(fixture.sshLog, "utf8").trim().split("\n")
    expect(calls.some((call) => /docker volume rm demos_node_state_restore_\d+ >\/dev\/null; fi; ! sudo -n docker volume inspect/.test(call))).toBe(true)
  })

  test("reinstall authorization is short-lived, target-bound, and consumed by exact host re-trust", () => {
    const state = tempDir()
    const fixture = recoveryFixture()
    const hostTools = tempDir()
    const keyscan = join(hostTools, "ssh-keyscan")
    const keygen = join(hostTools, "ssh-keygen")
    const fingerprint = `SHA256:${"R".repeat(43)}`
    writeFileSync(keyscan, "#!/bin/sh\nprintf '203.0.113.10 ssh-ed25519 ReinstalledHostFixture\\n'\n")
    writeFileSync(keygen, `#!/bin/sh\ncat >/dev/null\nprintf '256 ${fingerprint} fixture (ED25519)\\n'\n`)
    chmodSync(keyscan, 0o700)
    chmodSync(keygen, 0o700)
    initializeTestOperator(state)
    const env = { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: fixture.ssh, DEMOSCTL_AGE_BIN: fixture.age, DEMOSCTL_AGE_KEYGEN_BIN: fixture.ageKeygen }
    expect(run(["recovery", "create", "--key-file", join(tempDir(), "recovery.agekey"), "--copy-to", join(tempDir(), "recovery.agekey"), "--confirm", "recovery"], env).exitCode).toBe(0)
    expect(run(["recovery", "check", "--for", "reinstall", "--confirm", "recovery-check:reinstall"], env).exitCode).toBe(0)
    expect(existsSync(join(state, "reinstall-authorization.json"))).toBe(true)

    writeFileSync(join(state, "reinstall-authorization.claimed.json"), "incomplete transaction\n", { mode: 0o600 })
    writeFileSync(fixture.sshLog, "")
    const reauthorize = run(["recovery", "check", "--for", "reinstall", "--confirm", "recovery-check:reinstall"], env)
    expect(reauthorize.exitCode).not.toBe(0)
    expect(reauthorize.stderr.toString()).toContain("incomplete host re-trust claim")
    expect(readFileSync(fixture.sshLog, "utf8")).toBe("")

    const concurrent = run(["retrust-host", "--hostname", "203.0.113.10", "--confirm", "retrust-host:203.0.113.10"], { ...env, DEMOSCTL_SSH_KEYSCAN_BIN: keyscan, DEMOSCTL_SSH_KEYGEN_BIN: keygen })
    expect(concurrent.exitCode).not.toBe(0)
    expect(concurrent.stderr.toString()).toContain("incomplete host re-trust claim")
    expect(existsSync(join(state, "reinstall-authorization.json"))).toBe(true)
    rmSync(join(state, "reinstall-authorization.claimed.json"))

    const wrongTarget = run(["retrust-host", "--hostname", "other.example", "--confirm", "retrust-host:other.example"], { ...env, DEMOSCTL_SSH_KEYSCAN_BIN: keyscan, DEMOSCTL_SSH_KEYGEN_BIN: keygen })
    expect(wrongTarget.exitCode).not.toBe(0)
    expect(existsSync(join(state, "reinstall-authorization.json"))).toBe(true)

    const retrusted = run(["retrust-host", "--hostname", "203.0.113.10", "--confirm", "retrust-host:203.0.113.10"], { ...env, DEMOSCTL_SSH_KEYSCAN_BIN: keyscan, DEMOSCTL_SSH_KEYGEN_BIN: keygen })
    expect(retrusted.exitCode).toBe(0)
    expect(existsSync(join(state, "reinstall-authorization.json"))).toBe(false)
    expect(readFileSync(join(state, "known_hosts"), "utf8")).toContain("ReinstalledHostFixture")
    expect(JSON.parse(readFileSync(join(state, "operator.json"), "utf8")).hostKeyFingerprint).toBe(fingerprint)

    const replay = run(["retrust-host", "--hostname", "203.0.113.10", "--confirm", "retrust-host:203.0.113.10"], { ...env, DEMOSCTL_SSH_KEYSCAN_BIN: keyscan, DEMOSCTL_SSH_KEYGEN_BIN: keygen })
    expect(replay.exitCode).not.toBe(0)
  })

  test("onboarding never displays a funding step from receipt existence alone", () => {
    const state = tempDir()
    const fixture = recoveryFixture()
    initializeTestOperator(state)
    const env = { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: fixture.ssh, DEMOSCTL_AGE_BIN: fixture.age, DEMOSCTL_AGE_KEYGEN_BIN: fixture.ageKeygen }
    expect(run(["recovery", "create", "--key-file", join(tempDir(), "recovery.agekey"), "--copy-to", join(tempDir(), "recovery.agekey"), "--confirm", "recovery"], env).exitCode).toBe(0)
    writeFileSync(join(state, "operations.jsonl"), `${JSON.stringify({ action: "install", outcome: "completed" })}\n${JSON.stringify({ action: "secrets-setup", outcome: "completed" })}\n`, { mode: 0o600 })

    const beforeCheck = run(["onboard"], env)
    expect(beforeCheck.exitCode).toBe(0)
    expect(beforeCheck.stdout.toString()).toContain("recovery check --for stake")
    expect(beforeCheck.stdout.toString()).not.toContain("fund the")

    expect(run(["recovery", "check", "--for", "stake", "--confirm", "recovery-check:stake"], env).exitCode).toBe(0)
    const afterCheck = run(["onboard"], env)
    expect(afterCheck.stdout.toString()).toContain("fund the recovery-verified identity")
  })

  test("onboard starts with SSH preparation without requiring operator state", () => {
    const result = run(["onboard"], { DEMOSCTL_STATE_DIR: tempDir() })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain("ONBOARDING 1/10")
    expect(result.stdout.toString()).toContain("prepare-key")
  })

  test("onboarding resets host-local progress and restores identity after host re-trust", () => {
    const state = tempDir()
    const fixture = recoveryFixture()
    initializeTestOperator(state)
    const env = { DEMOSCTL_STATE_DIR: state, DEMOSCTL_SSH_BIN: fixture.ssh, DEMOSCTL_AGE_BIN: fixture.age, DEMOSCTL_AGE_KEYGEN_BIN: fixture.ageKeygen }
    expect(run(["recovery", "create", "--key-file", join(tempDir(), "recovery.agekey"), "--copy-to", join(tempDir(), "recovery.agekey"), "--confirm", "recovery"], env).exitCode).toBe(0)
    const beforeRetrust = ["install", "secrets-setup", "stake", "start"].map((action) => JSON.stringify({ action, outcome: "completed" }))
    writeFileSync(join(state, "operations.jsonl"), `${beforeRetrust.join("\n")}\n${JSON.stringify({ action: "retrust-host", outcome: "completed" })}\n`, { mode: 0o600 })

    const afterRetrust = run(["onboard", "--commit", "a".repeat(40)], env)
    expect(afterRetrust.exitCode).toBe(0)
    expect(afterRetrust.stdout.toString()).toContain("ONBOARDING 3/10")
    expect(afterRetrust.stdout.toString()).toContain("demosctl install")

    writeFileSync(join(state, "operations.jsonl"), `${beforeRetrust.join("\n")}\n${JSON.stringify({ action: "retrust-host", outcome: "completed" })}\n${JSON.stringify({ action: "install", outcome: "completed" })}\n${JSON.stringify({ action: "secrets-setup", outcome: "completed" })}\n`, { mode: 0o600 })
    const readyToRestore = run(["onboard"], env)
    expect(readyToRestore.exitCode).toBe(0)
    expect(readyToRestore.stdout.toString()).toContain("ONBOARDING 5/10")
    expect(readyToRestore.stdout.toString()).toContain("demosctl restore --from")
    expect(readyToRestore.stdout.toString()).not.toContain("recovery check --for stake")
  })
})
