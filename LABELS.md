# hc label scheme

DRAFT. hc terminals are the one registry of the herd: what each terminal is,
what it's for, who launched it, and whether it needs you. Every tool (Herdr app
mods, dingus, dingus-con, hooks, Claude sessions) reads terminals and their
labels rather than keeping its own record.

## Native fields first

herdr-core already records some of this. Use those fields; labels only add
what they lack.

| Need | Native field | Notes |
|---|---|---|
| What's running | `status.app` (OSC 7501), `program` (app) | Set by the agent itself |
| Live activity | `status.msg` | Claude's own one-line "what I'm doing" |
| Needs you (permission) | `status.state == blocked` | Claude's prompts only |
| Who launched it | `parent` | Set by `hc run` from a terminal; the app shows sub-agents under it |
| Identity | `name` | Fixed at launch, `a-z 0-9 - _`, 1-32 chars |
| How it was launched | `template`, `argv` | |
| Where it is | `herdr.space`, `herdr.tab`, `where` | Herdr's labels |

## Rules

- **Namespaces.** `herd.*` is our common layer for every agent. `claude.*`,
  `dingus.*` hold per-kind detail. `herdr.*` and `where` belong to the Herdr
  app: read them, never write them.
- **One writer per key.** The tables below name it. Anyone may read.
- **Short, single-line values.** `key=` removes a label.
- **Labels outlive the program.** They survive keep-recovery and stay after
  the agent exits, so whoever sets a state label clears it.
- **Filter in hc where you can.** `hc ls --label k=v` and `hc events --label
  k=v` match exact values only, so keys meant for filtering take a small fixed
  set of values. Presence checks happen client-side.

## `herd.*`: what herdr-core doesn't record

| Key | Value | Written by | Purpose |
|---|---|---|---|
| `herd.task` | one line, e.g. `PIPE-123 fix gate` | the launcher, updated by the agent | What it's for: the overview line. `status.msg` says what it's doing right now |
| `herd.ticket` | Jira key | the launcher | Filtering, linking to Tickets |
| `herd.group` | name | the launcher | A set worked on together (replaces `dingus.fleet`) |
| `herd.needs` | `decision`, `review`, `input` | the agent | It's waiting on you for something Claude's status can't say. Cleared when answered |
| `herd.note` | one line | the agent, with `herd.needs` | What it needs, in a sentence |

**Needs attention** = `status.state == blocked` or `herd.needs` set. That one
rule drives alerts, the overview's sort order and `agent.next`.

## `claude.*`: Claude Code sessions

Written by the `hc-session-label.sh` SessionStart hook (claude-configs).

| Key | Purpose | Read by |
|---|---|---|
| `claude.session` | Session ID | claude-resume, `restart.sh` |
| `claude.cwd` | Folder to resume from | claude-resume, `restart.sh` |
| `claude.model` | Launch `--model`, which `--resume` drops | claude-resume, `restart.sh` |
| `claude.transcript` | Transcript path; resume skips empty sessions | claude-resume |
| `claude.shell` | Terminal PID; tells a lost terminal from `/exit`. Also written by claude-resume | claude-resume |

## `dingus.*`: dingus sessions

| Key | Written by | Change |
|---|---|---|
| `dingus.phase` | `herdr-report.sh` | Keep. Also set `herd.needs=decision` when blocked on you |
| `dingus.parked_until` | `herdr-report.sh` | Keep |
| `dingus.fleet` | dingus-con | Becomes `herd.group` |
| `dingus_id` | dingus-con | Rename `dingus.id` |
| `dingus.session` | dingus-con | Drop: read `claude.session` |

## Open questions

- Who clears `herd.*` when an agent exits and the terminal is back at a
  shell? A SessionEnd hook, or claude-resume's idle sweep alongside `claude.*`.
- Who sets `herd.task` for a pane you open by hand: a hook defaulting to the
  session title, or nobody until it matters?
- `parent` is empty for both fleet launchers today. dingus-con uses `hc run
  --no-parent` (a child ends with its parent unless `--outlive-parent`, and
  shows without a pane). Tickets uses the app's `space.new`/`tab.new`, which
  start no `hc run` and take no labels. Fine for top-level sessions; `parent`
  is for agent-launched helpers.
- Since `tab.new` can't set labels, should the session label itself at start
  (`dingus drive KEY` sets `herd.ticket`/`herd.task` on `$HC_TERMINAL_ID`)?
  That works the same whoever launches it.
- Do dingus phases deserve a generic `herd.stage` (plan, build, review,
  merged) for the overview, or are `herd.task` and `status.msg` enough?
