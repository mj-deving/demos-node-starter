#!/usr/bin/env bash
set -euo pipefail

SSH_CONFIG=""
HOST=""
FFI=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh-config) SSH_CONFIG="${2:-}"; shift 2 ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --ffi) FFI=true; shift ;;
    *) echo "configure-secrets: unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -f "${SSH_CONFIG}" ]] || { echo "configure-secrets: SSH config missing" >&2; exit 1; }
[[ "${HOST}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$ ]] || { echo "configure-secrets: invalid host alias" >&2; exit 1; }
[[ -t 0 && -t 1 ]] || { echo "configure-secrets: run in an interactive terminal" >&2; exit 1; }

echo "Enter only credentials owned by this operator. Leave optional fields blank."
echo "Do not reuse credentials copied from chat or another node runner."

keys=(
  GITHUB_TOKEN
  ETHERSCAN_API_KEY
  HELIUS_API_KEY
  RAPID_API_KEY
  DISCORD_BOT_TOKEN
  NOMIS_API_KEY
  NOMIS_CLIENT_ID
  HUMAN_PASSPORT_API_KEY
  HUMAN_PASSPORT_SCORER_ID
)
if [[ "${FFI}" == true ]]; then
  keys+=(TLSNOTARY_SIGNING_KEY)
fi

payload=""
set_keys=()
for key in "${keys[@]}"; do
  value=""
  read -r -s -p "${key} (optional): " value
  printf '\n'
  if [[ "${value}" == *$'\n'* || "${value}" == *$'\r'* ]]; then
    echo "configure-secrets: invalid newline in ${key}" >&2
    exit 1
  fi
  if [[ -n "${value}" ]]; then
    payload+="${key}=${value}"$'\n'
    set_keys+=("${key}")
  fi
  unset value
done

printf '%s' "${payload}" | ssh -F "${SSH_CONFIG}" -o BatchMode=yes "${HOST}" \
  "sudo -n /usr/local/sbin/demos-secret-set-batch"
unset payload

printf 'Configured fields:'
if [[ ${#set_keys[@]} -eq 0 ]]; then
  printf ' none\n'
else
  printf '\n'
  printf '  %s=set\n' "${set_keys[@]}"
fi
echo "Secret values were not read back. Restart remains a separate command."
echo "Blank prompts preserved existing values. Run './demosctl secrets doctor' for value-free status."
