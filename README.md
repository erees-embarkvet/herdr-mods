# herdr-mods

My mods and layouts for the [Herdr app](https://herdr.dev).

| Mod | Key | What it is |
|---|---|---|
| `board` | `cmd-shift-k` | Agents as cards in three groups: Needs you, Working, Done. Window, floating block or layout block. |
| `tickets` | `cmd-shift-j` | My Jira tickets with the agents on each, matched by ticket key in branch, folder, tab or space. Each shows its type, epic, PR (review and CI state), a dot when someone else changed it, and the status move its PR and agents suggest. ▶ starts an agent on it. Window (collapsible rows, corner resize grip), the same list as a layout block (`props: { "view": "list" }`), or a layout block with one column per status. |
| `tickets-launch` | — | The ▶ dialog: start `dingus drive <KEY>` in a new workspace (pick a folder) or as a tab in an open one. |

| Layout | What it is |
|---|---|
| `board` | The focused agent's terminal, with the board floating over its top right. |
| `tickets` | Herdr's main layout with the tickets list in place of the Spaces and Agents sidebar. |

## Install

```sh
./install.sh
```

Symlinks `mods/*` and `layouts/*` into `~/.config/herdr-app` (or `$HERDR_APP_HOME`). Merge `keys.json` into Herdr's `keys.json` by hand.

`tickets` needs [`acli`](https://developer.atlassian.com/cloud/acli/) logged in (`acli jira auth login`) and `gh` logged in for PRs. Its Jira site, query and launch command are constants at the top of `mods/tickets/main.js`.

Keys in `tickets` (click it, or `pane.go` onto the layout block): `j`/`k` move, `enter` goes to its agent, `space` opens the row, `o` Jira, `p` PR, `y` copies the key, `s` starts an agent, `t` takes the suggested move (press again to confirm), `r` refreshes, `esc` hands the keyboard back.
