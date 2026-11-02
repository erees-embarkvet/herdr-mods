# herdr-mods

My mods and layouts for the [Herdr app](https://herdr.dev).

| Mod | Key | What it is |
|---|---|---|
| `board` | `cmd-shift-k` | Agents as cards in three groups: Needs you, Working, Done. Window, floating block or layout block. |
| `tickets` | `cmd-shift-j` | My Jira tickets with the agents on each, matched by ticket key in branch, folder, tab or space. Window (collapsible rows, corner resize grip) or layout block. |

| Layout | What it is |
|---|---|
| `board` | The focused agent's terminal, with the board floating over its top right. |
| `tickets` | Ticket columns on the left, the focused agent's terminal on the right. |

## Install

```sh
./install.sh
```

Symlinks `mods/*` and `layouts/*` into `~/.config/herdr-app` (or `$HERDR_APP_HOME`). Merge `keys.json` into Herdr's `keys.json` by hand.

`tickets` needs [`acli`](https://developer.atlassian.com/cloud/acli/) logged in (`acli jira auth login`). Its Jira site and query are constants at the top of `mods/tickets/main.js`.
