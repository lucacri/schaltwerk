#!/usr/bin/env bash
set -euo pipefail

exec bun scripts/tracked-tests.js "$@"
