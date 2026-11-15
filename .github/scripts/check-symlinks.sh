#!/usr/bin/env bash
# Refuses a proposed change that contains a symbolic link.
# check-protected.py judges a link by its own path and never follows it to its target, so a link
# is the one way a change can carry content the path policy cannot see. A repair or sculpt proposal
# has no legitimate reason to add one.
# Run from the repository root. Workflows load this script from origin/main into RUNNER_TEMP BEFORE
# any proposed change is applied, exactly like check-protected.py, so a patch cannot weaken it.
set -euo pipefail
bad=0

# Tracked paths whose new mode (field 2 of --raw output) is a symlink (120000).
if git diff --no-renames --raw origin/main | awk '$2 == "120000" { found = 1 } END { exit found ? 0 : 1 }'; then
  echo "::error::Proposed change contains a symbolic link; refused."
  bad=1
fi

# New files are untracked at this point, so `git diff` cannot see them; look at the working tree.
while IFS= read -r -d '' file; do
  if [ -L "$file" ]; then
    echo "::error::Untracked symbolic link refused: $file"
    bad=1
  fi
done < <(git ls-files -z --others --exclude-standard)

exit "$bad"
