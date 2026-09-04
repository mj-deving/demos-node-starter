#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL=""
BRANCH="stabilisation"
COMMIT=""
REPO_URL="https://github.com/kynesyslabs/node.git"
REPO_DIR="/opt/demos-node"
SERVICE="demos-node.service"
SECRETS_FILE="/etc/demos-node/node.env"
HELPER_IMAGE="alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"

fail() {
  echo "remote-bootstrap: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --public-url) PUBLIC_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --commit) COMMIT="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || fail "run through root SSH"
[[ -r /etc/os-release ]] || fail "unsupported operating system"
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || fail "only operator-controlled Ubuntu hosts are supported"
[[ "${VERSION_ID:-}" == "22.04" || "${VERSION_ID:-}" == "24.04" ]] || fail "only Ubuntu 22.04 and 24.04 are supported"
[[ "$(dpkg --print-architecture)" == "amd64" ]] || fail "only amd64 hosts are supported because the required upstream TLSNotary service is linux/amd64"
[[ "${PUBLIC_URL}" =~ ^https?://[^/[:space:]]+:53550$ ]] || fail "--public-url must be an http(s) host on port 53550"
[[ ! "${PUBLIC_URL}" =~ (localhost|127\.0\.0\.1|\[::1\]) ]] || fail "--public-url must be publicly reachable"
[[ "${BRANCH}" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$ ]] || fail "invalid branch"
[[ "${COMMIT}" =~ ^[0-9a-f]{40}$ ]] || fail "--commit must be a full lowercase SHA-1"

export DEBIAN_FRONTEND=noninteractive
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/dpkg/lock >/dev/null 2>&1; do
  sleep 5
done
apt-get update
apt-get install -y ca-certificates curl git gnupg sudo

if command -v docker >/dev/null 2>&1; then
  dpkg-query -W -f='${Status}\n' docker-ce docker-compose-plugin 2>/dev/null | grep -c '^install ok installed$' | grep -qx '2' \
    || fail "existing Docker is not the expected docker-ce plus docker-compose-plugin installation; reconcile it manually"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  arch="$(dpkg --print-architecture)"
  codename="${VERSION_CODENAME:?missing Ubuntu codename}"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu %s stable\n' "${arch}" "${codename}" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker compose version >/dev/null
docker pull "${HELPER_IMAGE}"
docker image inspect "${HELPER_IMAGE}" >/dev/null

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  [[ ! -e "${REPO_DIR}" ]] || fail "${REPO_DIR} exists but is not a Git checkout"
  staging_root="$(mktemp -d /opt/demos-node.installing.XXXXXX)"
  cleanup_checkout() { [[ -z "${staging_root}" || ! -d "${staging_root}" ]] || rm -rf -- "${staging_root}"; }
  trap cleanup_checkout EXIT INT TERM
  git clone --no-checkout --branch "${BRANCH}" --single-branch "${REPO_URL}" "${staging_root}/checkout"
  [[ "$(git -C "${staging_root}/checkout" rev-parse "origin/${BRANCH}")" == "${COMMIT}" ]] \
    || fail "approved commit is not the current fetched branch tip; no code was started"
  git -C "${staging_root}/checkout" checkout --detach "${COMMIT}"
  [[ "$(git -C "${staging_root}/checkout" rev-parse HEAD)" == "${COMMIT}" ]] || fail "checkout did not match approved commit"
  mv -- "${staging_root}/checkout" "${REPO_DIR}"
  rmdir -- "${staging_root}"
  staging_root=""
  trap - EXIT INT TERM
else
  fail "node checkout already exists; use the backup-gated demosctl update command"
fi
chown -R root:root "${REPO_DIR}"
chmod -R go-w "${REPO_DIR}"

[[ -f "${REPO_DIR}/.env.example" ]] || fail "upstream .env.example missing"
if [[ ! -f "${REPO_DIR}/.env" ]]; then
  install -m 0600 -o root -g root "${REPO_DIR}/.env.example" "${REPO_DIR}/.env"
fi

set_env() {
  local key="$1" value="$2" file="$3"
  local replacement
  replacement="${value//&/\\&}"
  if grep -qE "^${key}=" "${file}"; then
    sed -i "s|^${key}=.*$|${key}=${replacement}|" "${file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${file}"
  fi
}

set_env EXPOSED_URL "${PUBLIC_URL}" "${REPO_DIR}/.env"
set_env PROD true "${REPO_DIR}/.env"
for secret_key in GITHUB_TOKEN ETHERSCAN_API_KEY HELIUS_API_KEY RAPID_API_KEY DISCORD_BOT_TOKEN NOMIS_API_KEY NOMIS_CLIENT_ID HUMAN_PASSPORT_API_KEY HUMAN_PASSPORT_SCORER_ID TLSNOTARY_SIGNING_KEY; do
  set_env "${secret_key}" "" "${REPO_DIR}/.env"
done
chmod 0600 "${REPO_DIR}/.env"
chown root:root "${REPO_DIR}/.env"

install -d -m 0755 /etc/demos-node
if [[ ! -f "${SECRETS_FILE}" ]]; then
  install -m 0600 /dev/null "${SECRETS_FILE}"
fi
chown root:root "${SECRETS_FILE}"
chmod 0600 "${SECRETS_FILE}"

cat > /usr/local/sbin/demos-secret-set-batch <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail
SECRETS_FILE="/etc/demos-node/node.env"
allowed_key() {
  case "$1" in
    GITHUB_TOKEN|ETHERSCAN_API_KEY|HELIUS_API_KEY|RAPID_API_KEY|DISCORD_BOT_TOKEN|NOMIS_API_KEY|NOMIS_CLIENT_ID|HUMAN_PASSPORT_API_KEY|HUMAN_PASSPORT_SCORER_ID|TLSNOTARY_SIGNING_KEY) return 0 ;;
    *) return 1 ;;
  esac
}
umask 077
incoming="$(mktemp /etc/demos-node/.node.env.incoming.XXXXXX)"
output="$(mktemp /etc/demos-node/.node.env.output.XXXXXX)"
next=""
cleanup() {
  rm -f -- "${incoming}" "${output}"
  [[ -z "${next}" ]] || rm -f -- "${next}"
}
trap cleanup EXIT
cat > "${incoming}"
cp -- "${SECRETS_FILE}" "${output}"
while IFS= read -r line || [[ -n "${line}" ]]; do
  [[ -n "${line}" && "${line}" == *=* ]] || { echo "demos-secret-set-batch: malformed input" >&2; exit 1; }
  key="${line%%=*}"
  value="${line#*=}"
  allowed_key "${key}" || { echo "demos-secret-set-batch: unsupported key" >&2; exit 1; }
  [[ -n "${value}" ]] || { echo "demos-secret-set-batch: empty updates are not accepted" >&2; exit 1; }
  next="$(mktemp /etc/demos-node/.node.env.next.XXXXXX)"
  replaced=false
  while IFS= read -r existing || [[ -n "${existing}" ]]; do
    if [[ "${existing%%=*}" == "${key}" ]]; then
      printf '%s\n' "${line}" >> "${next}"
      replaced=true
    else
      printf '%s\n' "${existing}" >> "${next}"
    fi
  done < "${output}"
  if [[ "${replaced}" == false ]]; then
    printf '%s\n' "${line}" >> "${next}"
  fi
  mv -- "${next}" "${output}"
  next=""
  unset value line
done < "${incoming}"
install -m 0600 -o root -g root "${output}" "${SECRETS_FILE}"
HELPER
chmod 0755 /usr/local/sbin/demos-secret-set-batch
chown root:root /usr/local/sbin/demos-secret-set-batch

cat > /usr/local/sbin/demos-secret-status <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail
SECRETS_FILE="/etc/demos-node/node.env"
keys=(GITHUB_TOKEN ETHERSCAN_API_KEY HELIUS_API_KEY RAPID_API_KEY DISCORD_BOT_TOKEN NOMIS_API_KEY NOMIS_CLIENT_ID HUMAN_PASSPORT_API_KEY HUMAN_PASSPORT_SCORER_ID TLSNOTARY_SIGNING_KEY)
[[ -f "${SECRETS_FILE}" ]] || { echo "file=missing"; exit 1; }
mode="$(stat -c '%a' "${SECRETS_FILE}")"
owner="$(stat -c '%U:%G' "${SECRETS_FILE}")"
printf 'file=present\nowner=%s\nmode=%s\n' "${owner}" "${mode}"
[[ "${owner}" == "root:root" && "${mode}" == "600" ]] || exit 1
for key in "${keys[@]}"; do
  if grep -qE "^${key}=.+" "${SECRETS_FILE}"; then
    printf '%s=set\n' "${key}"
  else
    printf '%s=unset\n' "${key}"
  fi
done
HELPER
chmod 0755 /usr/local/sbin/demos-secret-status
chown root:root /usr/local/sbin/demos-secret-status

cat > "/etc/systemd/system/${SERVICE}" <<'UNIT'
[Unit]
Description=DEMOS testnet node
After=network-online.target docker.service
Wants=network-online.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/demos-node
ExecStart=/usr/bin/docker compose --env-file /opt/demos-node/.env --env-file /etc/demos-node/node.env up --build --abort-on-container-exit postgres tlsnotary node prometheus grafana
ExecStop=/usr/bin/docker compose --env-file /opt/demos-node/.env --env-file /etc/demos-node/node.env stop -t 120 node postgres tlsnotary prometheus grafana
Restart=on-failure
RestartSec=15
TimeoutStartSec=0
TimeoutStopSec=180

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "${SERVICE}"
systemctl show "${SERVICE}" --property=LoadState,ActiveState,SubState,UnitFileState --no-pager
git -C "${REPO_DIR}" rev-parse HEAD

cat <<'OUT'
remote-bootstrap: install complete
remote-bootstrap: provider firewall was not changed
remote-bootstrap: verify TCP 53550 and 53551 reachability separately
remote-bootstrap: the Docker-socket reaper service was not selected
OUT
