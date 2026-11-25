#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec /usr/local/bin/python3 -u "$script_dir/icon_eu_native.py" --publish
