#!/usr/bin/env bash
set -euo pipefail
: "${MIRKAM_ANDROID_KEYSTORE:?Path to the persistent private release keystore}"
: "${MIRKAM_ANDROID_PASSWORD_FILE:?Path to its private password file}"
if [[ $# -ne 3 ]]; then
  echo 'Usage: sign-android.sh apksigner.jar unsigned.apk output.apk' >&2
  exit 1
fi
java -jar "$1" sign --ks "$MIRKAM_ANDROID_KEYSTORE" --ks-key-alias mirkam-line --ks-pass "file:$MIRKAM_ANDROID_PASSWORD_FILE" --v4-signing-enabled false --out "$3" "$2"
java -jar "$1" verify --verbose --print-certs "$3"
