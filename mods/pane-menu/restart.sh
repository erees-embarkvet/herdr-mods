#!/usr/bin/env bash
# Restarts the Claude Code session in a Herdr terminal and resumes the same
# conversation. The pane menu runs it detached:
#   restart.sh exit|force <terminal> <space> <tab name>
# exit: waits out a running turn, sends /exit, and leaves any exit dialog to
# the person. force: SIGTERM (then SIGKILL), no dialogs.
# Claude started from a shell is resumed in that shell, in the same pane.
# Claude that was the terminal's program ends with it: resumed in a new tab.
set -uo pipefail
PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

mode="$1" t="$2" space="$3" name="$4"
# Run from a terminal, hc send marks text as a message from it (<hc from=…>),
# and Claude reads /exit as chat. Send as nobody.
unset HC_TERMINAL_ID HC_SCOPE

fail() {
  osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "Restart Claude"' -e 'end run' "$1" >/dev/null 2>&1
  exit 1
}

info="$(hc get "$t")" || fail "No terminal $t."
[[ "$(jq -r '.status.app // empty' <<<"$info")" == claude-code ]] || fail "$t isn't running Claude Code."
pid="$(jq -r '.foreground.pid // empty' <<<"$info")"
shell_pid="$(jq -r '.pid' <<<"$info")"
# Claude Code's own record of the session a process holds.
session="$HOME/.claude/sessions/$pid.json"
sid="$(jq -r '.sessionId // empty' "$session" 2>/dev/null)"
cwd="$(jq -r '.cwd // empty' "$session" 2>/dev/null)"
[[ -n "$sid" && -n "$cwd" ]] || fail "No session found for $t."

if [[ "$mode" == force ]]; then
  kill -TERM "$pid"
  for _ in $(seq 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid"
else
  [[ "$(jq -r '.status.state' <<<"$info")" == working ]] && hc wait "$t" >/dev/null
  [[ "$(hc get "$t" | jq -r '.status.state')" == blocked ]] && fail "Claude in $t is waiting on you. Restart skipped."
  hc send "$t" /exit >/dev/null || fail "Couldn't send /exit to $t."
fi

# Up to 10 minutes to answer an exit dialog.
for _ in $(seq 1200); do
  now="$(hc get "$t" 2>/dev/null)"
  if [[ "$(jq -r '.state' <<<"$now")" != live ]]; then
    args="$(jq -nc --arg s "$space" --arg n "$name" --arg f "$cwd" --arg id "$sid" \
      '{space: $s, name: $n, folder: $f, argv: ["claude", "--resume", $id]}')"
    herdr-app "do" tab.new "$args" >/dev/null || fail "Couldn't open a tab for session $sid."
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    # Claude was the terminal's program: it finishes, unless kept (a new shell).
    if [[ "$pid" == "$shell_pid" && "$(jq -r '.pid' <<<"$now")" == "$pid" ]]; then sleep 0.5; continue; fi
    hc send "$t" "cd $(printf %q "$cwd") && claude --resume $sid" >/dev/null || fail "Couldn't resume in $t."
    exit 0
  fi
  sleep 0.5
done
fail "Claude in $t didn't exit. Restart skipped."
