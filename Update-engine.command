#!/bin/bash
set -euo pipefail
exec "$(dirname "$0")/Install.command" --engine-only
