#!/usr/bin/env bash
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || { echo "install-secret-helpers: root is required" >&2; exit 1; }
install -d -m 0755 /etc/demos-node
SECRETS_FILE="/etc/demos-node/node.env"
if [[ ! -f "${SECRETS_FILE}" ]]; then install -m 0600 /dev/null "${SECRETS_FILE}"; fi
chown root:root "${SECRETS_FILE}"
chmod 0600 "${SECRETS_FILE}"

cat > /usr/local/sbin/demos-secret-set-batch <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail
SECRETS_FILE="/etc/demos-node/node.env"
if [[ "${1:-}" == "--protocol" ]]; then printf 'demos-secret-set-batch/v2\n'; exit 0; fi
[[ $# -eq 0 ]] || { echo "demos-secret-set-batch: unsupported argument" >&2; exit 1; }
allowed_key() {
  case "$1" in
    GITHUB_TOKEN|ETHERSCAN_API_KEY|HELIUS_API_KEY|RAPID_API_KEY|DISCORD_BOT_TOKEN|NOMIS_API_KEY|NOMIS_CLIENT_ID|HUMAN_PASSPORT_API_KEY|HUMAN_PASSPORT_SCORER_ID|TLSNOTARY_SIGNING_KEY) return 0 ;;
    *) return 1 ;;
  esac
}
validate_file() {
  local file="$1" line key seen="|"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -n "${line}" && "${line}" == *=* ]] || { echo "demos-secret-set-batch: invalid secret file structure" >&2; return 1; }
    key="${line%%=*}"
    allowed_key "${key}" || { echo "demos-secret-set-batch: unsupported key in secret file" >&2; return 1; }
    [[ -n "${line#*=}" ]] || { echo "demos-secret-set-batch: empty values are not accepted" >&2; return 1; }
    [[ "${seen}" != *"|${key}|"* ]] || { echo "demos-secret-set-batch: duplicate key in secret file" >&2; return 1; }
    seen+="${key}|"
  done < "${file}"
}
umask 077
incoming="$(mktemp /etc/demos-node/.node.env.incoming.XXXXXX)"
output="$(mktemp /etc/demos-node/.node.env.output.XXXXXX)"
candidate="$(mktemp /etc/demos-node/.node.env.candidate.XXXXXX)"
rollback="$(mktemp /etc/demos-node/.node.env.rollback.XXXXXX)"
next=""
cleanup() {
  rm -f -- "${incoming}" "${output}" "${candidate}" "${rollback}"
  [[ -z "${next}" ]] || rm -f -- "${next}"
}
trap cleanup EXIT
cat > "${incoming}"
cp -- "${SECRETS_FILE}" "${output}"
cp -- "${SECRETS_FILE}" "${rollback}"
if [[ -s "${output}" ]]; then validate_file "${output}"; fi
while IFS= read -r line || [[ -n "${line}" ]]; do
  [[ -n "${line}" && "${line}" == *=* ]] || { echo "demos-secret-set-batch: malformed input" >&2; exit 1; }
  key="${line%%=*}"
  value="${line#*=}"
  allowed_key "${key}" || { echo "demos-secret-set-batch: unsupported key" >&2; exit 1; }
  [[ -n "${value}" ]] || { echo "demos-secret-set-batch: empty updates are not accepted" >&2; exit 1; }
  next="$(mktemp /etc/demos-node/.node.env.next.XXXXXX)"
  replaced=false
  while IFS= read -r existing || [[ -n "${existing}" ]]; do
    if [[ "${existing%%=*}" == "${key}" ]]; then printf '%s\n' "${line}" >> "${next}"; replaced=true
    else printf '%s\n' "${existing}" >> "${next}"
    fi
  done < "${output}"
  if [[ "${replaced}" == false ]]; then printf '%s\n' "${line}" >> "${next}"; fi
  mv -- "${next}" "${output}"
  next=""
  unset value line
done < "${incoming}"
validate_file "${output}"
install -m 0600 -o root -g root "${output}" "${candidate}"
mv -- "${candidate}" "${SECRETS_FILE}"
if ! validate_file "${SECRETS_FILE}" || [[ "$(stat -c '%U:%G:%a' "${SECRETS_FILE}")" != "root:root:600" ]]; then
  install -m 0600 -o root -g root "${rollback}" "${SECRETS_FILE}"
  echo "demos-secret-set-batch: canonical secret-file verification failed; previous file restored" >&2
  exit 1
fi
while IFS= read -r line || [[ -n "${line}" ]]; do
  key="${line%%=*}"
  matched=false
  while IFS= read -r persisted || [[ -n "${persisted}" ]]; do
    if [[ "${persisted}" == "${line}" ]]; then matched=true; break; fi
  done < "${SECRETS_FILE}"
  if [[ "${matched}" == false ]]; then
    install -m 0600 -o root -g root "${rollback}" "${SECRETS_FILE}"
    echo "demos-secret-set-batch: updated value verification failed; previous file restored" >&2
    exit 1
  fi
  printf '%s=verified\n' "${key}"
done < "${incoming}"
HELPER
chmod 0755 /usr/local/sbin/demos-secret-set-batch
chown root:root /usr/local/sbin/demos-secret-set-batch

cat > /usr/local/sbin/demos-secret-status <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail
SECRETS_FILE="/etc/demos-node/node.env"
if [[ "${1:-}" == "--protocol" ]]; then printf 'demos-secret-status/v3\n'; exit 0; fi
keys=(GITHUB_TOKEN ETHERSCAN_API_KEY HELIUS_API_KEY RAPID_API_KEY DISCORD_BOT_TOKEN NOMIS_API_KEY NOMIS_CLIENT_ID HUMAN_PASSPORT_API_KEY HUMAN_PASSPORT_SCORER_ID TLSNOTARY_SIGNING_KEY)
require_core=false
[[ "${1:-}" != "--require-core" ]] || require_core=true
[[ $# -le 1 ]] || { echo "demos-secret-status: unsupported argument" >&2; exit 1; }
allowed_key() {
  case "$1" in
    GITHUB_TOKEN|ETHERSCAN_API_KEY|HELIUS_API_KEY|RAPID_API_KEY|DISCORD_BOT_TOKEN|NOMIS_API_KEY|NOMIS_CLIENT_ID|HUMAN_PASSPORT_API_KEY|HUMAN_PASSPORT_SCORER_ID|TLSNOTARY_SIGNING_KEY) return 0 ;;
    *) return 1 ;;
  esac
}
[[ -f "${SECRETS_FILE}" ]] || { echo "file=missing"; exit 1; }
mode="$(stat -c '%a' "${SECRETS_FILE}")"
owner="$(stat -c '%U:%G' "${SECRETS_FILE}")"
printf 'file=present\nowner=%s\nmode=%s\n' "${owner}" "${mode}"
[[ "${owner}" == "root:root" && "${mode}" == "600" ]] || exit 1
seen="|"
while IFS= read -r line || [[ -n "${line}" ]]; do
  [[ -n "${line}" && "${line}" == *=* ]] || { echo "file=invalid"; exit 1; }
  key="${line%%=*}"
  allowed_key "${key}" || { echo "file=invalid"; exit 1; }
  [[ -n "${line#*=}" && "${seen}" != *"|${key}|"* ]] || { echo "file=invalid"; exit 1; }
  seen+="${key}|"
done < "${SECRETS_FILE}"
missing_core=false
for key in "${keys[@]}"; do
  if grep -qE "^${key}=.+" "${SECRETS_FILE}"; then
    if [[ "${key}" == "TLSNOTARY_SIGNING_KEY" ]] && ! grep -qE '^TLSNOTARY_SIGNING_KEY=[0-9a-fA-F]{64}$' "${SECRETS_FILE}"; then printf '%s=invalid\n' "${key}"; exit 1; fi
    printf '%s=configured\n' "${key}"
  else
    case "${key}" in
      HELIUS_API_KEY) printf '%s=missing\n' "${key}"; missing_core=true ;;
      *) printf '%s=not-required\n' "${key}" ;;
    esac
  fi
done
[[ "${require_core}" == false || "${missing_core}" == false ]]
HELPER
chmod 0755 /usr/local/sbin/demos-secret-status
chown root:root /usr/local/sbin/demos-secret-status

printf 'demos-secret-helpers/v3\n'
