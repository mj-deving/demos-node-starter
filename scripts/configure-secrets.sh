#!/usr/bin/env bash
set -euo pipefail

SSH_CONFIG=""
HOST=""
FFI=false
SETUP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh-config) SSH_CONFIG="${2:-}"; shift 2 ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --ffi) FFI=true; shift ;;
    --setup) SETUP=true; shift ;;
    *) echo "configure-secrets: unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -f "${SSH_CONFIG}" ]] || { echo "configure-secrets: SSH config missing" >&2; exit 1; }
[[ "${HOST}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$ ]] || { echo "configure-secrets: invalid host alias" >&2; exit 1; }
[[ -t 0 && -t 1 ]] || { echo "configure-secrets: run in an interactive terminal" >&2; exit 1; }

protocol="$(ssh -F "${SSH_CONFIG}" -o BatchMode=yes "${HOST}" "sudo -n /usr/local/sbin/demos-secret-set-batch --protocol")"
[[ "${protocol}" == "demos-secret-set-batch/v2" ]] || {
  echo "configure-secrets: remote secret helper is missing or outdated; run './demosctl upgrade-operator --confirm upgrade-operator'" >&2
  exit 1
}

echo "Enter only credentials owned by this operator. Input is hidden and sent directly to the root-owned node secret file."
echo "Do not reuse credentials copied from chat or another operator. Same-owner fleet keys must follow docs/secret-operations.md."
if [[ "${SETUP}" == true ]]; then
  echo "Core setup currently requires HELIUS_API_KEY. GitHub and Etherscan are feature-gated and optional."
fi

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
  requirement="optional"
  if [[ "${SETUP}" == true ]]; then
    case "${key}" in
      HELIUS_API_KEY) requirement="required" ;;
    esac
  fi
  read -r -s -p "${key} (${requirement}): " value
  printf '\n'
  if [[ "${value}" == *$'\n'* || "${value}" == *$'\r'* ]]; then
    echo "configure-secrets: invalid newline in ${key}" >&2
    exit 1
  fi
  if [[ -n "${value}" ]]; then
    payload+="${key}=${value}"$'\n'
    set_keys+=("${key}")
  elif [[ "${requirement}" == "required" ]]; then
    echo "configure-secrets: ${key} is required during initial setup" >&2
    exit 1
  fi
  unset value
done

response="$(printf '%s' "${payload}" | ssh -F "${SSH_CONFIG}" -o BatchMode=yes "${HOST}" \
  "sudo -n /usr/local/sbin/demos-secret-set-batch")"
unset payload

expected=""
for key in "${set_keys[@]}"; do
  [[ -z "${expected}" ]] || expected+=$'\n'
  expected+="${key}=verified"
done
[[ "${response}" == "${expected}" ]] || {
  echo "configure-secrets: remote helper did not return the exact value-free verification receipt" >&2
  exit 1
}
unset response expected

printf 'Verified fields:'
if [[ ${#set_keys[@]} -eq 0 ]]; then
  printf ' none\n'
else
  printf '\n'
  printf '  %s=verified\n' "${set_keys[@]}"
fi
echo "Secret values were not read back. Restart remains a separate command."
echo "Blank prompts preserved existing values. Run './demosctl secrets doctor' for value-free status."
