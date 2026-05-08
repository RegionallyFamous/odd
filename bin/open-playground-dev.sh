#!/usr/bin/env bash
# Open ODD “trunk” WordPress Playground in the **system browser** (default on macOS: Safari/Chrome).
# Cursor’s and most in-app Chromium panels cannot load Playground — SharedArrayBuffer / WASM.
#
# Usage:
#   bash bin/open-playground-dev.sh
#   bash bin/open-playground-dev.sh 'https://raw.githubusercontent.com/you/fork/main/blueprint-dev.json'

set -euo pipefail

BLUEPRINT_JSON="${1:-https://raw.githubusercontent.com/RegionallyFamous/odd/main/blueprint-dev.json}"

if [[ -z "${BLUEPRINT_JSON}" ]]; then
	echo "usage: bash bin/open-playground-dev.sh [blueprint-json-url]" >&2
	exit 1
fi

ENC=$( python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "${BLUEPRINT_JSON}" )

URL="https://playground.wordpress.net/?blueprint-url=${ENC}"

echo "Opening: ${URL}"
if command -v open >/dev/null 2>&1; then
	exec open "${URL}"
fi
if command -v xdg-open >/dev/null 2>&1; then
	exec xdg-open "${URL}"
fi
echo "Open this URL in a normal desktop browser:" >&2
echo "${URL}"
