#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

IDENTITY_NAME="${LUCODE_CODESIGN_IDENTITY:-Lucode Local Development}"
LOGIN_KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning | grep -F "\"${IDENTITY_NAME}\"" >/dev/null 2>&1; then
  printf '%s\n' "$IDENTITY_NAME"
  exit 0
fi

if [[ -n "${LUCODE_CODESIGN_IDENTITY:-}" ]]; then
  echo "Configured signing identity not found: ${LUCODE_CODESIGN_IDENTITY}" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lucode-codesign.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

KEY_PATH="${WORK_DIR}/lucode-local-development.key"
CERT_PATH="${WORK_DIR}/lucode-local-development.crt"
P12_PATH="${WORK_DIR}/lucode-local-development.p12"
EXT_PATH="${WORK_DIR}/codesign.ext"

cat > "$EXT_PATH" <<'EOF'
[codesign]
basicConstraints = critical,CA:TRUE
keyUsage = critical,digitalSignature,keyCertSign
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
EOF

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -nodes \
  -days 3650 \
  -subj "/CN=${IDENTITY_NAME}/" \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -extensions codesign \
  -config "$EXT_PATH" >/dev/null 2>&1

openssl pkcs12 \
  -export \
  -inkey "$KEY_PATH" \
  -in "$CERT_PATH" \
  -out "$P12_PATH" \
  -password pass: >/dev/null 2>&1

security import "$P12_PATH" \
  -k "$LOGIN_KEYCHAIN" \
  -P "" \
  -T /usr/bin/codesign >/dev/null

security add-trusted-cert \
  -r trustRoot \
  -p codeSign \
  -k "$LOGIN_KEYCHAIN" \
  "$CERT_PATH" >/dev/null

printf '%s\n' "$IDENTITY_NAME"
