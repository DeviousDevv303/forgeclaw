#!/usr/bin/env bash
set -euo pipefail

PIP_VERSION="pip==26.2.1"
PIP_TOOLS_VERSION="pip-tools==7.6.1"

if [[ -n "${PYTHON_BIN:-}" ]]; then
  LOCK_PYTHON="$PYTHON_BIN"
elif command -v python3.11 >/dev/null 2>&1; then
  LOCK_PYTHON="$(command -v python3.11)"
elif command -v python >/dev/null 2>&1; then
  LOCK_PYTHON="$(command -v python)"
else
  echo "Python 3.11 is required." >&2
  exit 1
fi

"$LOCK_PYTHON" - <<'PY'
import sys

if sys.version_info[:2] != (3, 11):
    raise SystemExit(
        f"Python 3.11 required for lock generation; found {sys.version.split()[0]}"
    )
PY

"$LOCK_PYTHON" -m venv /tmp/lock-venv
/tmp/lock-venv/bin/python -m pip install --no-input "${PIP_VERSION}"
/tmp/lock-venv/bin/python -m pip install --no-input "${PIP_TOOLS_VERSION}"

/tmp/lock-venv/bin/pip-compile \
  --generate-hashes \
  --output-file .github/agent-task/requirements.lock \
  .github/agent-task/requirements.in

echo "Lockfile generated. SHA256:"
sha256sum .github/agent-task/requirements.lock

echo
echo "Verifying install in a fresh venv..."
"$LOCK_PYTHON" -m venv /tmp/verify-venv
/tmp/verify-venv/bin/python -m pip install --no-input "${PIP_VERSION}"
/tmp/verify-venv/bin/python -m pip install --no-input --require-hashes \
  -r .github/agent-task/requirements.lock
echo "Verification passed."
