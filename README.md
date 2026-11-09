# herdr-mods

My mods and layouts for the [Herdr app](https://herdr.dev).

| Mod | Key | What it is |
|---|---|---|
| `tickets` | `cmd-shift-j` | My Jira tickets with the agents on each, matched by ticket key in branch, folder, tab or space. Each shows its type, epic, PR (review and CI state), a dot when someone else changed it, and the status move its PR and agents suggest. ▶ starts an agent on it. Window (collapsible rows, corner resize grip), the same list as a layout block (`props: { "view": "list" }`), or a layout block with one column per status. |
| `tickets-launch` | — | The ▶ dialog: start `dingus drive <KEY>` in a new workspace (pick a folder) or as a tab in an open one. |
| `pane-menu` | right-click | Herdr's terminal menu plus Restart Claude: sends `/exit` once the turn ends, leaves any exit dialog to you, then resumes the same session. In the same pane if a shell started Claude, else in a new tab. Force restart kills it instead, skipping dialogs. |
| `claude-resume` | — | Resumes Claude sessions whose terminals were lost to a reboot or core crash, in the same pane. Draws nothing; the layouts give it a zero-width block. |

| Layout | What it is |
|---|---|
| `home` | Herdr's main layout with `pane-menu` as the terminal menu and `claude-resume` running. |
| `tickets` | Herdr's main layout with the tickets list in place of the Spaces and Agents sidebar. Uses `pane-menu` and `claude-resume`. |

## Install

```sh
./install.sh
```

Symlinks `mods/*` and `layouts/*` into `~/.config/herdr-app` (or `$HERDR_APP_HOME`). Merge `keys.json` into Herdr's `keys.json` by hand.

Hooks: `pre-commit install --install-hooks`. Commits to `main` are refused: work on a branch and open a PR (`SKIP=no-commit-to-branch git commit …` to bypass). CI runs the same hooks plus the manual stage (whole-tree gitleaks and large files, zizmor).

Restart reads the session ID from `~/.claude/sessions/<pid>.json`, which Claude Code writes for itself (undocumented). If that changes, it posts a macOS notification instead of restarting.

`claude-resume` needs a Claude Code `SessionStart` hook that labels each hc terminal with the session it runs (`claude.session`, `claude.cwd`, `claude.transcript`, and `claude.shell`, the terminal's program PID). Mine is `claude/scripts/hc-session-label.sh` in claude-configs. A lost terminal comes back as a new shell with the labels intact, and the mod sends `claude --resume` to any idle shell whose PID differs from `claude.shell`. A shell that keeps the same PID after Claude exits for 30s is an exit on purpose, so the mod drops its labels. One gap: exit Claude while Herdr is closed, then reboot, and that session is resumed anyway.

`tickets` needs [`acli`](https://developer.atlassian.com/cloud/acli/) logged in (`acli jira auth login`) and `gh` logged in for PRs. Its Jira site, query and launch command are constants at the top of `mods/tickets/main.js`.

Keys in `tickets` (click it, or `pane.go` onto the layout block): `j`/`k` move, `enter` goes to its agent, `space` opens the row, `o` Jira, `p` PR, `y` copies the key, `s` starts an agent, `t` takes the suggested move (press again to confirm), `r` refreshes, `esc` hands the keyboard back.
