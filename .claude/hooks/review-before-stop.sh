#!/bin/sh
# Claude Code Stop hook: ask the writer for the independent review once per stop.
# Usage: JSON on stdin (stop_hook_active boolean and cwd); CLAUDE_PROJECT_DIR preferred.
# Exit 0 always: block with decision JSON, otherwise allow with no stdout.
# Errors fail open with one diagnostic line on stderr. AI_SDLC_REVIEW_HOOK=off opts out.
set -u
allow_error() { echo 'review-before-stop: review status unknown; allowing stop' >&2; exit 0; }
[ "${AI_SDLC_REVIEW_HOOK:-}" = off ] && exit 0
if command -v jq >/dev/null 2>&1; then
  parsed=$(jq -er '
    if type != "object" or ((.stop_hook_active // false) | type) != "boolean" then error("payload")
    elif .stop_hook_active == true then "true\n"
    elif ((.cwd // "") | type) != "string" or ((.cwd // "") | test("[\u0000-\u001f]")) then error("cwd")
    else "false\n" + (.cwd // "") end' 2>/dev/null) || allow_error
elif command -v python3 >/dev/null 2>&1; then
  parsed=$(python3 -c '
import json,sys
p=json.load(sys.stdin)
a=p.get("stop_hook_active",False)
assert type(a) is bool
if a: print("true")
else:
 c=p.get("cwd", "")
 assert isinstance(c,str) and not any(ord(x)<32 for x in c)
 print("false\n"+c)
' 2>/dev/null) || allow_error
else
  allow_error
fi
active=$(printf '%s\n' "$parsed" | sed -n '1p' 2>/dev/null) || allow_error
[ "$active" = true ] && exit 0
payload_cwd=$(printf '%s\n' "$parsed" | sed -n '2p' 2>/dev/null) || allow_error
project=${CLAUDE_PROJECT_DIR:-$payload_cwd}
[ -n "$project" ] || allow_error
[ "$(git -C "$project" rev-parse --is-inside-work-tree 2>/dev/null)" = true ] || exit 0
branch=$(git -C "$project" symbolic-ref --quiet --short HEAD 2>/dev/null) || exit 0
case $branch in main|master) exit 0 ;; esac
default=$(git -C "$project" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) || default=
[ "$branch" = "${default#origin/}" ] && exit 0
origin=$(git -C "$project" remote get-url origin 2>/dev/null) || allow_error
case $origin in
  https://github.com/*) repo=${origin#https://github.com/} ;;
  git@github.com:*) repo=${origin#git@github.com:} ;;
  ssh://git@github.com/*) repo=${origin#ssh://git@github.com/} ;;
  *) exit 0 ;;
esac
repo=${repo%.git}
case $repo in *[!A-Za-z0-9_./-]*|/*|*/|'' ) allow_error ;; esac
# Exactly two non-empty path components; no credential-bearing remote reaches gh.
owner=${repo%%/*}; name=${repo#*/}
[ "$owner" != "$repo" ] && [ -n "$owner" ] && [ -n "$name" ] || allow_error
case $name in */*) allow_error ;; esac
# The signed gate bundle first (#731 section 9): with the session's Cloudflare read access, or a
# cloud session's reviewer-bundle Worker (REVIEWER_BUNDLE_URL), the
# installed skill's gates_fetch.py verifies the newest record and takes the helper from its archive
# (a cached archive only when its digest matches that record). It has 12 seconds, so with the
# helper's 45 the hook stays inside its 60-second limit. The installed skill supplies
# the local fallback; adoption no longer installs a project copy.
fetch=
for candidate in "${0%/*}/../scripts/gates_fetch.py" "${HOME:-/nonexistent}/.claude/skills/ai-sdlc/scripts/gates_fetch.py"; do
  [ -f "$candidate" ] && { fetch=$candidate; break; }
done
bundle=
if { { [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; } || [ -n "${REVIEWER_BUNDLE_URL:-}" ]; } \
   && [ -n "$fetch" ] \
   && command -v python3 >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1; then
  bundle=$(mktemp -d 2>/dev/null) || bundle=
  [ -z "$bundle" ] || trap 'rm -rf "$bundle"' EXIT
  if [ -n "$bundle" ] && timeout -k 2 12 python3 -I "$fetch" --out "$bundle/gates" \
       --only scripts/review_todo.sh --only scripts/review_on_head.sh >/dev/null 2>&1 \
       && [ -f "$bundle/gates/scripts/review_todo.sh" ]; then
    helper=$bundle/gates/scripts/review_todo.sh
  fi
fi
if [ -n "${helper:-}" ]; then
  :
elif [ -f "${HOME:-/nonexistent}/.claude/skills/ai-sdlc/scripts/review_todo.sh" ]; then
  helper=${HOME:-/nonexistent}/.claude/skills/ai-sdlc/scripts/review_todo.sh
else
  allow_error
fi
if command -v timeout >/dev/null 2>&1; then
  out=$(timeout -k 2 45 sh "$helper" --repo "$repo" --branch "$branch" --drafts --min-age 0 --max 1 2>/dev/null) || allow_error
elif command -v python3 >/dev/null 2>&1; then
  out=$(python3 -c '
import os,signal,subprocess,sys
p=subprocess.Popen(sys.argv[1:],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,start_new_session=True)
try:
 out,_=p.communicate(timeout=45)
except BaseException:
 os.killpg(p.pid,signal.SIGKILL); p.communicate(); sys.exit(1)
finally:
 try: os.killpg(p.pid,signal.SIGKILL)
 except ProcessLookupError: pass
sys.stdout.write(out); sys.exit(p.returncode)
' sh "$helper" --repo "$repo" --branch "$branch" --drafts --min-age 0 --max 1 2>/dev/null) || allow_error
else
  allow_error
fi
[ -n "$out" ] || exit 0
# The helper's fields cannot contain spaces; validate before constructing the reason.
set -f
set -- $out
[ $# -eq 4 ] && [ "$1" = REVIEW ] && [ "$2" = "$repo" ] || allow_error
pr=$3; head=$4
case $pr in ''|*[!0-9]*) allow_error ;; esac
case $head in *[!0-9a-f]*|'') allow_error ;; esac
[ ${#head} -eq 40 ] || allow_error
reason="PR $repo #$pr head $head needs an independent review. Run: python3 <ai-sdlc>/scripts/review_run.py <filled-review-prompt.md> <review.md> --head $head --pr $pr --repo $repo; then sh <ai-sdlc>/scripts/post_review.sh $repo $pr <review.md>. Fill the prompt from <ai-sdlc>/references/review-prompt.md."
if command -v jq >/dev/null 2>&1; then
  json=$(jq -cn --arg reason "$reason" '{decision:"block",reason:$reason}' 2>/dev/null) || allow_error
else
  json=$(python3 -c 'import json,sys; print(json.dumps({"decision":"block","reason":sys.argv[1]}))' "$reason" 2>/dev/null) || allow_error
fi
printf '%s\n' "$json"
exit 0
