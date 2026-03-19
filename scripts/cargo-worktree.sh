#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if [[ -z "${CARGO_TARGET_DIR:-}" ]] || [[ "$CARGO_TARGET_DIR" == ".git"* ]]; then
    git_common_dir="$(git -C "$repo_root" rev-parse --git-common-dir)"
    if [[ "$git_common_dir" != /* ]]; then
         git_common_dir="$repo_root/$git_common_dir"
    fi
    export CARGO_TARGET_DIR="$git_common_dir/lucode-target"
fi

mkdir -p "$CARGO_TARGET_DIR"

cd "$repo_root/src-tauri"
exec cargo "$@"
