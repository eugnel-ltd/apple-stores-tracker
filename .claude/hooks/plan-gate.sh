#!/bin/sh
# PreToolUse hook for Bash: the plan-divergence gate. Exit 2 blocks the command and sends stderr
# to Claude. Needs jq, git, xargs and POSIX text utilities.
#
# Rule (SKILL.md §3 step 4, templates/plan.md): a commit that changes a file the plan does not
# name must update the plan's Divergences section in the same commit.
#   - Acts only on a `git commit` command; every other command passes.
#   - The plan is docs/plans/<issue>.md, the issue taken from the branch name <type>/<issue>-<slug>.
#     No issue number in the branch, or no plan file: the commit passes (trivial and doc-only work).
#   - The plan names files as "- `<path>`" lines under "## Files that change". Each path occupies
#     one line. An entry ending in "/" covers everything under it; an entry may be a shell glob
#     ("src/*.py"). A changed path containing LF is not representable and is always outside.
#   - The commit's files are the staged ones, plus the tracked changes when the command holds -a,
#     --all or a short flag group with a (-am) anywhere: a superset only makes the gate stricter.
#   - The plan's Divergences count only when the plan's change is already staged (index copy).
#   - The hook runs before the command. When the same command also stages (git add, rm, mv or
#     stage), it cannot know what will be staged: it passes only when every change in the tree,
#     untracked files included, is inside the plan; else it asks to stage and commit separately.
#     A commit with pathspecs is not inspected beyond that; review criterion 8 is the backstop.
# Every decision is logged to .claude/gate.log.
cmd=$(jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0
printf '%s\n' "$cmd" | grep -Eq '(^|[;&|(][[:space:]]*|[[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+commit([[:space:]]|$)' || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
set -f # plan entries are patterns for case, never expanded against the tree

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
issue=$(printf '%s\n' "$branch" | sed -n 's|^[A-Za-z0-9_.-]*/\([0-9][0-9]*\)\([-_].*\)\{0,1\}$|\1|p')
[ -n "$issue" ] || exit 0
plan=docs/plans/$issue.md
stages=0
printf '%s\n' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+(add|rm|mv|stage)([[:space:]]|$)' && stages=1
# For the files, any "-a" in the command counts: a superset only makes the gate stricter.
any_a=0
printf '%s\n' "$cmd" | grep -Eq '[[:space:]](-a|--all|-[A-Za-z]*a[A-Za-z]*)([[:space:]]|$)' && any_a=1
mkdir -p .claude
log() { printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$1" "$plan" "$2" >> .claude/gate.log; }
block_gate() {
  log block "$1"
  echo "BLOCKED: $plan is in force, but the plan gate could not safely read complete paths: $1." >&2
  exit 2
}

umask 077
gate_tmp=$(mktemp -d "${TMPDIR:-/tmp}/ai-sdlc-plan-gate.XXXXXX") || block_gate "private temporary directory creation failed"
cleanup() { rm -rf "$gate_tmp"; }
trap cleanup 0
trap 'cleanup; exit 2' HUP INT TERM

# The plan's Divergences count only from the index: the hook never guesses what a command will
# stage. A successful empty metadata read means absent; a failed read blocks instead of silently
# falling back to a different plan copy.
index_entry=$gate_tmp/index-entry
if ! git ls-files --stage -z -- "$plan" > "$index_entry" 2>/dev/null; then
  block_gate "the staged plan metadata could not be read"
fi
plan_in_index=0
if [ -s "$index_entry" ]; then
  plan_in_index=1
elif [ ! -f "$plan" ]; then
  exit 0
fi

# A combined staging command or commit -a can replace the index plan after this hook reads it.
# When its working copy differs, require the caller to stage the intended plan first.
if [ "$plan_in_index" = 1 ] && { [ "$stages" = 1 ] || [ "$any_a" = 1 ]; }; then
  git diff --quiet -- "$plan" 2>/dev/null
  working_plan_rc=$?
  case "$working_plan_rc" in
    0) ;;
    1)
      log block "the command may stage the plan's working copy unlike its index copy"
      echo "BLOCKED: $plan differs between the working tree and the index, and this command may stage it. Stage the plan you mean (git add '$plan'), then run git commit as a separate command." >&2
      exit 2
      ;;
    *) block_gate "the working plan state could not be read" ;;
  esac
fi

plan_file=$gate_tmp/plan
plan_without_nul=$gate_tmp/plan-without-nul
named_file=$gate_tmp/named
files_file=$gate_tmp/files
outside_file=$gate_tmp/outside
outside_display=$gate_tmp/outside-display
: > "$outside_file" || block_gate "temporary path list creation failed"
: > "$outside_display" || block_gate "temporary display list creation failed"

if [ "$plan_in_index" = 1 ]; then
  git show ":$plan" > "$plan_file" 2>/dev/null || block_gate "the staged plan could not be read"
else
  cat "$plan" > "$plan_file" 2>/dev/null || block_gate "the working plan could not be read"
fi

# NUL cannot occur in a Git pathname. Reject it while the plan is still a byte stream, before awk
# or shell read can discard it and turn a malformed entry into a broader pattern.
LC_ALL=C tr -d '\000' < "$plan_file" > "$plan_without_nul" || block_gate "plan NUL validation failed"
cmp "$plan_file" "$plan_without_nul" >/dev/null 2>&1
plan_nul_rc=$?
case "$plan_nul_rc" in
  0) ;;
  1) block_gate "the plan contains a NUL byte" ;;
  *) block_gate "plan NUL validation failed" ;;
esac

# Extract complete backtick-fenced path operands. Existing plans may put comma-separated operands
# on one bullet or annotate them before the description colon. Backticks in the complete suffix
# must still form matching spans, so malformed text cannot authorise only a valid prefix.
if ! awk '
  function tick_run(text, pos,    width) {
    width = 0
    while (substr(text, pos + width, 1) == "`") width++
    return width
  }
  function find_close(text, pos, width,    run) {
    while (pos <= length(text)) {
      if (substr(text, pos, 1) != "`") { pos++; continue }
      run = tick_run(text, pos)
      if (run == width) return pos
      pos += run
    }
    return 0
  }
  function max_tick_run(text,    pos, run, biggest) {
    biggest = 0
    pos = 1
    while (pos <= length(text)) {
      if (substr(text, pos, 1) != "`") { pos++; continue }
      run = tick_run(text, pos)
      if (run > biggest) biggest = run
      pos += run
    }
    return biggest
  }
  function emit_path(text, start, width, finish,    content, path) {
    content = substr(text, start + width, finish - start - width)
    path = content
    if (width >= 2 && length(content) >= 2 &&
        substr(content, 1, 1) == " " && substr(content, length(content), 1) == " ") {
      path = substr(content, 2, length(content) - 2)
    }
    if (path == "" || max_tick_run(path) >= width) return 0
    print path
    return 1
  }
  function parse_bullet(line,    s, width, finish, rest, pos, run, closing, depth, description, c) {
    s = line
    sub(/^[[:space:]]*[-*][[:space:]]*/, "", s)
    width = tick_run(s, 1)
    if (width == 0) return 0
    finish = find_close(s, width + 1, width)
    if (finish == 0 || !emit_path(s, 1, width, finish)) return 0

    rest = substr(s, finish + width)
    pos = 1
    depth = 0
    description = 0
    while (pos <= length(rest)) {
      c = substr(rest, pos, 1)
      if (c == "`") {
        run = tick_run(rest, pos)
        closing = find_close(rest, pos + run, run)
        if (closing == 0) return 0
        if (!description && depth == 0 && !emit_path(rest, pos, run, closing)) return 0
        pos = closing + run
        continue
      }
      if (!description) {
        if (c == "(") depth++
        else if (c == ")" && depth > 0) depth--
        else if (c == ":" && depth == 0) description = 1
      }
      pos++
    }
    return 1
  }
  /^## / { on = ($0 ~ /^## Files that change[[:space:]]*$/); next }
  on && /^[[:space:]]*[-*]([[:space:]]|$)/ {
    if (!parse_bullet($0)) bad = 1
  }
  END { if (bad) exit 1 }
' "$plan_file" > "$named_file"; then
  block_gate "Files that change contains an empty or malformed path entry"
fi

# Git writes NUL-delimited records. They remain NUL-delimited until xargs supplies exactly one
# complete record as the helper's quoted positional argument.
: > "$files_file" || block_gate "temporary changed-path list creation failed"
git diff --cached --name-only -z >> "$files_file" 2>/dev/null || block_gate "staged paths could not be read"
if [ "$any_a" = 1 ]; then
  git diff --name-only -z >> "$files_file" 2>/dev/null || block_gate "tracked working paths could not be read"
fi
if [ "$stages" = 1 ]; then
  git diff --name-only -z >> "$files_file" 2>/dev/null || block_gate "tracked working paths could not be read"
  git ls-files --others --exclude-standard -z >> "$files_file" 2>/dev/null || block_gate "untracked paths could not be read"
fi
[ -s "$files_file" ] || exit 0

match_helper=$gate_tmp/match-one
cat > "$match_helper" <<'MATCH_HELPER' || block_gate "path matcher creation failed"
#!/bin/sh
f=$1
mark_outside() {
  printf '%s\0' "$f" >> "$PLAN_GATE_OUTSIDE" || exit 1
  printf ' %s' "$f" >> "$PLAN_GATE_OUTSIDE_DISPLAY" || exit 1
  exit 0
}

# LF path bytes cannot be represented by a one-line plan entry. Reject them before every match,
# including a directory or wildcard that would otherwise cover the path.
case "$f" in
  *'
'*) mark_outside ;;
esac
[ "$f" = "$PLAN_GATE_PLAN" ] && exit 0

while IFS= read -r n || [ -n "$n" ]; do
  [ "$f" = "$n" ] && exit 0
  case "$n" in */) case "$f" in "$n"*) exit 0 ;; esac ;; esac
  # The value is intentionally a case pattern. It is never evaluated or expanded against files.
  # shellcheck disable=SC2254
  case "$f" in $n) exit 0 ;; esac
done < "$PLAN_GATE_NAMED" || exit 1
mark_outside
MATCH_HELPER
chmod 700 "$match_helper" || block_gate "path matcher creation failed"

if ! PLAN_GATE_NAMED=$named_file \
  PLAN_GATE_OUTSIDE=$outside_file \
  PLAN_GATE_OUTSIDE_DISPLAY=$outside_display \
  PLAN_GATE_PLAN=$plan \
  xargs -0 -n 1 "$match_helper" < "$files_file"; then
  block_gate "NUL-delimited path matching failed"
fi
[ -s "$outside_file" ] || { log allow "inside the plan"; exit 0; }
if ! outside=$(cat "$outside_display"); then
  block_gate "outside path display could not be read"
fi

# Outside the plan: the same commit must change the plan's Divergences section.
section() { awk '/^## / { on = ($0 ~ /^## Divergences[[:space:]]*$/); next } on'; }
if ! new_div=$(section < "$plan_file"); then
  block_gate "the staged Divergences section could not be read"
fi
old_plan=$gate_tmp/old-plan
head_entry=$gate_tmp/head-entry
if ! git ls-tree -z --name-only HEAD -- "$plan" > "$head_entry" 2>/dev/null; then
  block_gate "the committed plan metadata could not be read"
fi
if [ -s "$head_entry" ]; then
  git show "HEAD:$plan" > "$old_plan" 2>/dev/null || block_gate "the committed plan could not be read"
else
  : > "$old_plan" || block_gate "temporary committed-plan copy could not be created"
fi
if ! old_div=$(section < "$old_plan"); then
  block_gate "the committed Divergences section could not be read"
fi
staged_plan=0
git diff --cached --quiet -- "$plan" 2>/dev/null
plan_diff_rc=$?
case "$plan_diff_rc" in
  0) ;;
  1) staged_plan=1 ;;
  *) block_gate "the staged plan state could not be read" ;;
esac
if [ "$stages" = 1 ]; then
  # Before the command runs, the hook cannot know which files its git add will stage, so it reads
  # the whole tree. That superset lies inside the plan (passed above) or the commit waits.
  log block "stages and commits in one command, tree outside the plan:$outside"
  echo "BLOCKED: $plan is in force and the tree has changes outside it:$outside. Stage first, then run git commit as a separate command, so the plan gate reads the exact files." >&2
  exit 2
fi
if [ "$staged_plan" = 1 ] && [ "$new_div" != "$old_div" ]; then
  log allow "outside the plan, Divergences updated:$outside"; exit 0
fi
log block "outside the plan:$outside"
echo "BLOCKED: this commit changes files $plan does not name:$outside. Add them under '## Files that change', or log the divergence under '## Divergences' (date, what changed, why), and stage the plan (git add '"$plan"') before the commit." >&2
exit 2
