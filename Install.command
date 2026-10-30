#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
VD_UV="$(command -v uv || true)"
VD_TEMP=""
if [ -z "$VD_UV" ]; then
  VD_TEMP="$(mktemp -d)"
  trap 'rm -rf "$VD_TEMP"' EXIT
  /usr/bin/curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://astral.sh/uv/install.sh -o "$VD_TEMP/uv-install.sh"
  UV_INSTALL_DIR="$VD_TEMP/bin" UV_NO_MODIFY_PATH=1 /bin/sh "$VD_TEMP/uv-install.sh"
  VD_UV="$VD_TEMP/bin/uv"
fi
"$VD_UV" run --python 3.13 --no-project scripts/install.py --uv "$VD_UV" "$@"
echo
read -r -p "Press Return to close this window. "
