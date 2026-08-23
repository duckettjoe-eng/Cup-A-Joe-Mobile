#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
prompt_file="$repo_root/HERMES_TUCK_FRUMP_REFRESH.md"
hermes_bin="${HERMES_BIN:-/Users/joe/.local/bin/hermes}"
usage_dir="${TUCK_FRUMP_USAGE_DIR:-${TMPDIR:-/tmp}/tuck-frump-hermes-usage}"
hermes_provider="${TUCK_FRUMP_HERMES_PROVIDER:-}"
hermes_model="${TUCK_FRUMP_HERMES_MODEL:-}"

if [[ ! -x "$hermes_bin" ]]; then
  echo "Hermes executable not found: $hermes_bin" >&2
  exit 1
fi

if [[ ! -f "$prompt_file" ]]; then
  echo "Refresh prompt not found: $prompt_file" >&2
  exit 1
fi

mkdir -p "$usage_dir"
usage_file="$usage_dir/$(date -u +%Y%m%dT%H%M%SZ).json"

cd "$repo_root"
prompt="$(<"$prompt_file")"
hermes_args=(--usage-file "$usage_file")

if [[ -n "$hermes_provider" || -n "$hermes_model" ]]; then
  if [[ -z "$hermes_provider" || -z "$hermes_model" ]]; then
    echo "Set both TUCK_FRUMP_HERMES_PROVIDER and TUCK_FRUMP_HERMES_MODEL, or neither." >&2
    exit 1
  fi
  hermes_args+=(--provider "$hermes_provider" --model "$hermes_model")
fi

if [[ "${TUCK_FRUMP_ALREADY_ISOLATED:-0}" == "1" ]]; then
  prompt+=$'\n\nFor this run, the caller has already provided a persistent isolated worktree at: '
  prompt+="$repo_root"
  prompt+=$'\nUse that exact absolute path as the workdir for every terminal or file operation. Do not create another worktree and do not commit; leave the validated data/stories.json diff for review.'
else
  hermes_args+=(--worktree)
fi

exec "$hermes_bin" "${hermes_args[@]}" --oneshot "$prompt"
