#!/bin/sh
# PreToolUse hook for Bash and the GitHub MCP review tool: agents never submit a formal APPROVE.
# A person's formal GitHub APPROVE on the exact head counts as an independent human reviewer
# (owner, 25 Oct 2026: "Of course human review is more valuable and of course can replace one of
# the ai reviewer."), so an agent with the owner's login must never make one. Agent reviews stay
# PR comments (references/review-prompt.md); eugnel-bot's formal reviews come from
# scripts/bot_review.sh in Actions, not from a session. Exit 2 blocks the call. Needs jq.
in=$(cat)
tool=$(printf '%s' "$in" | jq -r '.tool_name // empty')
block() {
  echo "BLOCKED: agents never submit a formal APPROVE review (modules/review.md, Human review). Post the review as a PR comment with its VERDICT line instead." >&2
  exit 2
}
case "$tool" in
  *pull_request_review_write*|*create_pull_request_review*|*submit_pending_pull_request_review*)
    [ "$(printf '%s' "$in" | jq -r '.tool_input.event // empty')" = APPROVE ] && block
    exit 0 ;;
esac
cmd=$(printf '%s' "$in" | jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0
printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+review([[:space:]].*)?[[:space:]](--approve|-a)([[:space:]=]|$)' && block
if printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+api'; then
  # REST: an APPROVE in argv, or a body from --input, whose file this hook cannot read.
  if printf '%s' "$cmd" | grep -q 'reviews' \
    && printf '%s' "$cmd" | grep -Eq 'event=APPROVE|"event"[[:space:]]*:[[:space:]]*"APPROVE"|--input'; then
    block
  fi
  # GraphQL: agents never add or submit a formal review, whatever its event. A query or body
  # read from a file (--input, -F query=@file) is opaque here, so it is blocked too.
  printf '%s' "$cmd" | grep -Eq 'addPullRequestReview|submitPullRequestReview' && block
  if printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+api([[:space:]].*)?[[:space:]]graphql([[:space:]]|$)' \
    && printf '%s' "$cmd" | grep -Eq -- '--input|=@'; then
    block
  fi
fi
# Best effort only: a wrapper script (python3, sh) that calls gh is not seen. The rule binds every
# agent and CLI; this hook only catches the direct calls (modules/review.md, Human review).
exit 0
