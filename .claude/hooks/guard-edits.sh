#!/bin/sh
# PreToolUse hook for Edit|Write|MultiEdit|NotebookEdit. Exit 2 blocks the edit and sends
# stderr to Claude. Needs jq. Adapt the test-path patterns to the repo's layout.
#
# Enforces three must-hold rules:
#   1. docs/owner-decisions.md is append-only, quoting the owner's words and following
#      the repo's authority rules; never edited by an agent's editor tool.
#   2. On a fix/ branch, once the failing test is committed, test files are read-only.
#   3. No credential-shaped text enters the tree.
# Every decision is logged to .claude/gate.log (add it to .gitignore).
in=$(cat)
path_json=
path_rc=0
path_json=$(printf '%s' "$in" | jq -c '
  (.tool_input // {}) as $tool_input |
  if ($tool_input | type) != "object" then
    error("edit tool input must be an object")
  elif (($tool_input | has("file_path")) and (($tool_input.file_path | type) != "string")) or
       (($tool_input | has("notebook_path")) and (($tool_input.notebook_path | type) != "string")) then
    error("edit target path must be a string")
  elif ($tool_input | has("file_path")) then
    $tool_input.file_path
  elif ($tool_input | has("notebook_path")) then
    $tool_input.notebook_path
  else
    empty
  end |
  select(length > 0)
' 2>/dev/null) || path_rc=$?
[ "$path_rc" -eq 0 ] || {
  echo "BLOCKED: the edit target path could not be validated." >&2
  exit 2
}
[ -n "$path_json" ] || exit 0
project=${CLAUDE_PROJECT_DIR:-.}
start=$(pwd -L 2>/dev/null) || {
  echo "BLOCKED: the project root could not be validated." >&2
  exit 2
}
case "$project" in
  /*) configured=$project ;;
  *) configured=$start/$project ;;
esac
cd "$project" 2>/dev/null || {
  echo "BLOCKED: the project root could not be validated." >&2
  exit 2
}
physical=$(pwd -P 2>/dev/null) || {
  echo "BLOCKED: the project root could not be validated." >&2
  exit 2
}
rel=$path_json
mkdir -p .claude
log() { printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$1" "$rel" "$2" >> .claude/gate.log; }
block() { log block "$1"; echo "BLOCKED: $1" >&2; exit 2; }

# Validate the original target components before an allow. The configured project path is a
# trusted root spelling (it may itself be a symlink); aliases below that boundary are not trusted.
validated=
validation_rc=0
validated=$(python3 -I - "$configured" "$physical" "$path_json" <<'PY'
import json
import os
import stat
import sys

OUTSIDE = 10
ALIAS = 11
INVALID = 12
PROTECTED = 13


def stop(code):
    raise SystemExit(code)


if len(sys.argv) != 4:
    stop(INVALID)
configured, physical, target_json = sys.argv[1:]
try:
    target = json.loads(target_json)
except (TypeError, ValueError):
    stop(INVALID)
if not isinstance(target, str) or not target:
    stop(INVALID)
configured = configured.rstrip(os.sep) or os.sep
physical = physical.rstrip(os.sep) or os.sep
if not os.path.isabs(configured) or not os.path.isabs(physical):
    stop(INVALID)
try:
    if not os.path.samefile(configured, physical):
        stop(INVALID)
except OSError:
    stop(INVALID)


def suffix_below(value, root):
    if value == root:
        return ""
    prefix = root if root == os.sep else root + os.sep
    if value.startswith(prefix):
        return value[len(prefix):]
    return None


if os.path.isabs(target):
    suffix = suffix_below(target, configured)
    if suffix is None:
        suffix = suffix_below(target, physical)
    if suffix is None:
        stop(OUTSIDE)
else:
    suffix = target

parts = suffix.split(os.sep)
current = physical
for index, part in enumerate(parts):
    if part in ("", "."):
        continue
    if part == "..":
        if current == physical:
            stop(OUTSIDE)
        current = os.path.dirname(current)
        continue
    candidate = os.path.join(current, part)
    try:
        info = os.lstat(candidate)
    except FileNotFoundError:
        info = None
    except OSError:
        stop(INVALID)
    if info is not None:
        if stat.S_ISLNK(info.st_mode):
            stop(ALIAS)
        if parts[index + 1:] and not stat.S_ISDIR(info.st_mode):
            stop(INVALID)
    current = candidate

protected = os.path.join(physical, "docs", "owner-decisions.md")
if current == protected:
    stop(PROTECTED)
try:
    target_info = os.lstat(current)
except FileNotFoundError:
    target_info = None
except OSError:
    stop(INVALID)
try:
    protected_info = os.lstat(protected)
except FileNotFoundError:
    protected_info = None
except OSError:
    stop(INVALID)
if (target_info is not None and protected_info is not None and
        (target_info.st_dev, target_info.st_ino) ==
        (protected_info.st_dev, protected_info.st_ino)):
    stop(PROTECTED)
if any(ord(char) < 32 or ord(char) == 127 for char in target):
    stop(INVALID)

relative = os.path.relpath(current, physical)
if relative == os.pardir or relative.startswith(os.pardir + os.sep):
    stop(OUTSIDE)
sys.stdout.write(relative)
PY
) || validation_rc=$?
case "$validation_rc" in
  0) [ -n "$validated" ] || block "the edit target path could not be validated."; rel=$validated ;;
  10) block "the edit target is outside the project." ;;
  11) block "the edit target uses an unsafe symbolic-link alias." ;;
  13)
    block "docs/owner-decisions.md is append-only. Quote the owner's words when recording a decision. If the repo's rules reserve this file to the owner, only the owner may edit it. Never remove or reword an entry." ;;
  *) block "the edit target path could not be validated." ;;
esac

# 1. Owner decisions: follow the repo's recording procedure, never edit existing entries.
[ "$rel" = docs/owner-decisions.md ] &&
  block "docs/owner-decisions.md is append-only. Quote the owner's words when recording a decision. If the repo's rules reserve this file to the owner, only the owner may edit it. Never remove or reword an entry."

# 2. Fix task: the committed failing test is locked.
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
case "$branch" in fix/*)
  case "$rel" in tests/*|*/tests/*|*test_*.py|*_test.go|*.test.*|*.spec.*)
    git diff --quiet origin/main...HEAD -- 'tests/' ':(glob)**/test_*.py' \
      ':(glob)**/*_test.go' ':(glob)**/*.test.*' ':(glob)**/*.spec.*' 2>/dev/null ||
      block "fix task: the failing test is committed; fix the code, not the test. If the test is wrong, say so and stop." ;;
  esac ;;
esac

# 3. Credentials in the new content. A sample, not a complete scanner.
new=$(printf '%s' "$in" | jq -r '[.tool_input.content, .tool_input.new_string,
  (.tool_input.edits // [] | .[].new_string), .tool_input.new_source] | map(select(.)) | join("\n")')
printf '%s' "$new" | grep -Eq -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
  -e 'AKIA[0-9A-Z]{16}' -e 'gh[pousr]_[A-Za-z0-9]{36}' -e 'sk-[A-Za-z0-9_-]{20,}' \
  -e 'xox[abprs]-[A-Za-z0-9-]{10,}' \
  -e '(api[_-]?key|secret|token|password)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{12,}' &&
  block "this edit adds what looks like a credential. Read it from the environment or the secret store instead."

log allow edit
exit 0
