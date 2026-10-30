#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
VD_PYTHON="$HOME/Library/Application Support/Video Downloader/.venv/bin/python"
"$VD_PYTHON" scripts/uninstall.py
read -r -p "Press Return to close this window. "
