#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL=""
BRANCH="stabilisation"
REPO_URL="https://github.com/kynesyslabs/node.git"
REPO_DIR="/opt/demos-node"
RUNTIME_USER="demos"
SERVICE="demos-node.service"
SECRETS_FILE="/etc/demos-node/node.env"

fail() {
  echo "remote-bootstrap: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --public-url) PUBLIC_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || fail "run through root SSH"
[[ -r /etc/os-release ]] || fail "unsupported operating system"
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || fail "only dedicated Ubuntu VPS hosts are supported"
[[ "${PUBLIC_URL}" =~ ^https?://[^/[:space:]]+:53550$ ]] || fail "--public-url must be an http(s) host on port 53550"
[[ ! "${PUBLIC_URL}" =~ (localhost|127\.0\.0\.1|\[::1\]) ]] || fail "--public-url must be publicly reachable"
[[ "${BRANCH}" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$ ]] || fail "invalid branch"

export DEBIAN_FRONTEND=noninteractive
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/dpkg/lock >/dev/null 2>&1; do
  sleep 5
done
apt-get update
apt-get install -y ca-certificates curl git gnupg sudo

if ! command -v docker >/dev/null 2>&1; then
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

if ! id "${RUNTIME_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${RUNTIME_USER}"
fi
if id -nG "${RUNTIME_USER}" | tr ' ' '\n' | grep -Eq '^(sudo|docker)$'; then
  fail "existing demos user has privileged group membership; reconcile manually"
fi

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  [[ ! -e "${REPO_DIR}" ]] || fail "${REPO_DIR} exists but is not a Git checkout"
  install -d -m 0755 -o root -g root "${REPO_DIR}"
  git clone --branch "${BRANCH}" --single-branch "${REPO_URL}" "${REPO_DIR}"
else
  fail "node checkout already exists; use the backup-gated demosctl update command"
fi
chown -R root:root "${REPO_DIR}"
chmod -R go-w "${REPO_DIR}"

[[ -f "${REPO_DIR}/.env.example" ]] || fail "upstream .env.example missing"
if [[ ! -f "${REPO_DIR}/.env" ]]; then
  install -m 0640 -o root -g "${RUNTIME_USER}" "${REPO_DIR}/.env.example" "${REPO_DIR}/.env"
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
chmod 0640 "${REPO_DIR}/.env"
chown root:"${RUNTIME_USER}" "${REPO_DIR}/.env"

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
