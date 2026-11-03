// My Jira tickets, each with the agents working on it: an agent belongs to a ticket
// when its branch, folder (its terminal's or its processes'), tab or space names the
// ticket's key. Done tickets show only while an agent on them is still open. Each
// ticket also shows its PR (from GitHub), its epic, whether someone else touched it
// since you last looked, and the status move its agents and PR suggest.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, panes, terminals, focused, run, theme, exec, shared, setShared, props, closeOverlay, openOverlay, nextCommand } from "herdr";

const SITE = "https://embarkvet.atlassian.net";
const JQL = "assignee = currentUser() AND (statusCategory != Done OR updated >= -30d) ORDER BY updated DESC";
const KEYS = /\b[A-Z][A-Z0-9]+-\d+\b/gi;
const STALE = 150000;
// A fetch that hasn't finished in this long is taken for dead.
const STUCK = 90000;
// What ▶ runs in the new tab.
const LAUNCH = (key) => ["dingus", "drive", key];
// Known statuses first, in board order; any others follow as they come.
const ORDER = ["To Do", "In Progress", "In Review"];
const PRIORITY = { Highest: 5, High: 4, Medium: 3, Low: 2, Lowest: 1 };
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// Issue type → theme color.
const TYPE = { Bug: "ansi9", Story: "ansi10", Task: "ansi12", "Sub-task": "ansi14", Subtask: "ansi14", Epic: "ansi13", Spike: "ansi11" };
// The window: its default and smallest size, and how far past the pointer it
// reaches while resizing (pointer moves only arrive inside the window).
const SIZE = { w: 400, h: 560 };
const MIN = { w: 300, h: 220 };
const REACH = 80;
const PR_QUERY = `query($q: String!) { search(query: $q, type: ISSUE, first: 100) { nodes { ... on PullRequest {
  number title url state isDraft headRefName reviewDecision repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }`;

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const top = (list) => list.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
const keysIn = (s) => (s ?? "").match(KEYS)?.map((k) => k.toUpperCase()) ?? [];
const firstLine = (r) => (r.stderr || r.stdout).trim().split("\n")[0];

function ago(at) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// Every key-shaped word in what the agent is working in, most specific first.
function keysOf(a, pane, cwds) {
  return [pane?.branch, ...(cwds ?? []), pane?.cwd, a.tab_name, a.space_name, a.title].flatMap(keysIn);
}

// The PR that says most about a ticket: an open one first, then merged, then closed.
function bestPr(list) {
  const rank = { OPEN: 3, MERGED: 2, CLOSED: 1 };
  return [...list].sort((x, y) => (rank[y.state] ?? 0) - (rank[x.state] ?? 0))[0] ?? null;
}

// The status move the ticket's PR and agents point to, or a note when there's no move.
function suggest(tk, mine, prs) {
  const open = prs.some((p) => p.state === "OPEN");
  const ready = prs.some((p) => p.state === "OPEN" && !p.draft);
  if (!tk.done && !open && prs.some((p) => p.state === "MERGED")) return { to: "Done", why: "Its PR is merged" };
  if (ready && (tk.category === "new" || tk.status === "In Progress")) return { to: "In Review", why: "Its PR is open for review" };
  if (tk.category === "new" && mine.length) return { to: "In Progress", why: "An agent is on it" };
  if (tk.done && mine.length) return { note: "agent open", why: "Done, but an agent on it is still open: clean it up?" };
  return null;
}

export default class Tickets extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    // Copies share one fetch: whichever finds the data stale refreshes it for all.
    cx.timer.every(30000, (cx) => {
      this.refresh(cx);
      this.scan(cx);
      cx.notify();
    });
    this.refresh(cx);
    this.scan(cx);
    // A layout copy gets the keyboard from pane.go.
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") this.handle.focus();
        cx.notify();
      }
    });
    // As a window, opening it again closes it instead. Herdr has no toggle: opening the
    // same key replaces the open window, so the old copy records when it closed, and a new
    // copy that opened at that moment knows it replaced one and closes itself too.
    const win = props()?.overlay;
    if (!win) return;
    this.handle.focus();
    this.opened = Date.now();
    cx.timer.after(250, () => {
      if (!this.replacing()) return;
      this.gone = true;
      closeOverlay(win);
    });
  }

  replacing() {
    return Math.abs((shared("tickets.closedAt") ?? 0) - this.opened) < 500;
  }

  async close() {
    if (props()?.overlay && !this.gone) setShared("tickets.closedAt", Date.now());
  }

  loading() {
    const at = shared("tickets.loading");
    return Boolean(at && Date.now() - at < STUCK);
  }

  refresh(cx, force = false) {
    const data = shared("tickets.data");
    if (this.loading() || (!force && data?.v === 3 && Date.now() - data.at < STALE)) return;
    setShared("tickets.loading", Date.now());
    cx.spawn(async (cx) => {
      try {
        const r = await exec("acli", ["jira", "workitem", "search", "--jql", JQL, "--fields", "key,summary,status,priority,issuetype", "--paginate", "--json"]);
        if (r.code !== 0) throw new Error(firstLine(r));
        const items = JSON.parse(r.stdout).map((i) => ({
          key: i.key,
          summary: i.fields.summary,
          status: i.fields.status?.name ?? "",
          category: i.fields.status?.statusCategory?.key ?? "",
          done: i.fields.status?.statusCategory?.key === "done",
          priority: i.fields.priority?.name ?? "",
          type: i.fields.issuetype?.name ?? "",
        }));
        const keys = items.map((i) => i.key);
        await Promise.all([this.fetchPrs(), this.fetchActivity(keys, data?.at)]);
        setShared("tickets.data", { v: 3, at: Date.now(), items });
        setShared("tickets.error", null);
        cx.notify();
        // Slow the first time (one call per ticket), so the list shows before it's done.
        await this.fetchParents(keys);
      } catch (e) {
        setShared("tickets.error", `acli: ${e.message ?? e}`);
      }
      setShared("tickets.loading", null);
      cx.notify();
    });
  }

  // My PRs touched in the last 30 days, each with the ticket keys its title or branch names.
  async fetchPrs() {
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    try {
      const r = await exec("gh", ["api", "graphql", "-f", `q=is:pr author:@me updated:>=${since}`, "-f", `query=${PR_QUERY}`]);
      if (r.code !== 0) throw new Error(firstLine(r));
      const prs = JSON.parse(r.stdout).data.search.nodes.filter((n) => n.url).map((n) => ({
        keys: [...new Set([...keysIn(n.title), ...keysIn(n.headRefName)])],
        title: n.title,
        url: n.url,
        number: n.number,
        repo: n.repository.nameWithOwner,
        state: n.state,
        draft: n.isDraft,
        review: n.reviewDecision,
        ci: n.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
      }));
      setShared("tickets.prs", prs);
      setShared("tickets.prError", null);
    } catch (e) {
      setShared("tickets.prError", `gh: ${e.message ?? e}`);
    }
  }

  // Tickets someone other than me changed since the last fetch get stamped now; a dot shows
  // until I look at them. Skipped on the first fetch, when there's no "since".
  async fetchActivity(keys, since) {
    if (!since || !keys.length) return;
    const mins = Math.min(10080, Math.ceil((Date.now() - since) / 60000) + 1);
    try {
      let me = shared("tickets.me");
      if (!me) {
        const a = await exec("acli", ["jira", "auth", "status"]);
        me = a.stdout.match(/Email:\s*(\S+)/)?.[1];
        if (!me) return;
        setShared("tickets.me", me);
      }
      const jql = `key in (${keys.join(",")}) AND updated >= -${mins}m AND issuekey not in updatedBy("${me}", "-${mins}m")`;
      const r = await exec("acli", ["jira", "workitem", "search", "--jql", jql, "--fields", "key", "--paginate", "--json"]);
      if (r.code !== 0) return;
      const hit = JSON.parse(r.stdout).map((i) => i.key);
      if (!hit.length) return;
      const now = Date.now();
      setShared("tickets.activity", { ...(shared("tickets.activity") ?? {}), ...Object.fromEntries(hit.map((k) => [k, now])) });
    } catch {
      // No dots this round.
    }
  }

  // Each ticket's parent (its epic), fetched once: search can't return it.
  async fetchParents(keys) {
    const known = shared("tickets.parents") ?? {};
    const todo = keys.filter((k) => !(k in known));
    const found = {};
    for (let i = 0; i < todo.length; i += 5) {
      await Promise.all(todo.slice(i, i + 5).map(async (k) => {
        try {
          const r = await exec("acli", ["jira", "workitem", "view", k, "--fields", "parent", "--json"]);
          if (r.code !== 0) return;
          const p = JSON.parse(r.stdout).fields?.parent;
          found[k] = p ? { key: p.key, summary: p.fields?.summary ?? "" } : null;
        } catch {
          // Try again next fetch.
        }
      }));
    }
    if (Object.keys(found).length) setShared("tickets.parents", { ...(shared("tickets.parents") ?? {}), ...found });
  }

  // A status move asks first: the first press arms it, a second within 4 s makes it.
  confirmMove(cx, key, to) {
    const a = this.arming;
    if (a && a.key === key && a.to === to && Date.now() - a.at < 4000) {
      this.arming = null;
      return this.transition(cx, key, to);
    }
    this.arming = { key, to, at: Date.now() };
    cx.timer.after(4000, (cx) => {
      if (this.arming?.key === key && Date.now() - this.arming.at >= 4000) this.arming = null;
      cx.notify();
    });
    cx.notify();
  }

  transition(cx, key, to) {
    this.moving = key;
    setShared("tickets.moveError", null);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("acli", ["jira", "workitem", "transition", "--key", key, "--status", to, "--yes"]);
        if (r.code !== 0) throw new Error(firstLine(r));
        this.seen(key);
      } catch (e) {
        setShared("tickets.moveError", `${key} → ${to}: ${e.message ?? e}`);
      }
      this.moving = null;
      this.refresh(cx, true);
      cx.notify();
    });
  }

  // An agent that moves into a worktree under a wrapper script (dingus) or by its own
  // worktree switch leaves its terminal's folder behind, so read its processes' folders.
  scan(cx) {
    const roots = new Map(terminals().filter((tm) => tm.pid).map((tm) => [tm.pid, tm.address]));
    cx.spawn(async (cx) => {
      try {
        const ps = await exec("ps", ["-A", "-o", "pid=,ppid="]);
        const parent = new Map(ps.stdout.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number)));
        const owner = (pid) => {
          for (let p = pid; p > 1; p = parent.get(p)) if (roots.has(p)) return roots.get(p);
          return null;
        };
        const kids = [...parent.keys()].filter((p) => !roots.has(p) && owner(p));
        if (!kids.length) return;
        // lsof exits nonzero when a process ended meanwhile; what it printed still holds.
        const r = await exec("lsof", ["-a", "-d", "cwd", "-Fpn", "-p", kids.join(",")]);
        const cwds = {};
        let addr = null;
        for (const l of r.stdout.split("\n")) {
          if (l[0] === "p") addr = owner(Number(l.slice(1)));
          else if (l[0] === "n" && addr) (cwds[addr] ??= new Set()).add(l.slice(1));
        }
        this.cwds = Object.fromEntries(Object.entries(cwds).map(([k, v]) => [k, [...v]]));
        cx.notify();
      } catch {
        // No ps or lsof: match on what Herdr knows.
      }
    });
  }

  toggle(name, id, fallback = false) {
    const set = { ...(shared(name) ?? {}) };
    set[id] = !(set[id] ?? fallback);
    setShared(name, set);
  }

  seen(key) {
    setShared("tickets.seen", { ...(shared("tickets.seen") ?? {}), [key]: Date.now() });
  }

  fresh(key) {
    return (shared("tickets.activity")?.[key] ?? 0) > (shared("tickets.seen")?.[key] ?? 0);
  }

  select(key) {
    this.sel = key;
    this.handle.focus();
  }

  openJira(cx, key) {
    this.seen(key);
    cx.open_url(`${SITE}/browse/${key}`);
  }

  launch(tk) {
    this.seen(tk.key);
    openOverlay({ mod: "tickets-launch", kind: "dialog", modal: true, width: 380, height: 440, props: { key: tk.key, summary: tk.summary, argv: LAUNCH(tk.key) } });
  }

  focusAgent(a) {
    run("pane.focus", { pane: a.pane });
    run("agent.focus", { terminal: a.address });
  }

  // The keyboard: j/k move, enter goes to its agent (or opens it), space opens it, o Jira,
  // p its PR, y copies the key, s starts an agent, t takes the suggested move, r refreshes.
  key(e, cx) {
    if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
    const v = this.view;
    if (!v) return;
    const i = v.order.indexOf(this.sel);
    const tk = v.byKey.get(this.sel);
    const k = e.key;
    if (k === "j" || k === "down") this.sel = v.order[Math.min(v.order.length - 1, i + 1)] ?? null;
    else if (k === "k" || k === "up") this.sel = v.order[Math.max(0, i - 1)] ?? v.order[0] ?? null;
    else if (k === "r") this.refresh(cx, true);
    else if (k === "escape" && this.arming) this.arming = null;
    else if (k === "escape") {
      this.sel = null;
      const p = focused()?.pane;
      if (p) run("pane.focus", { pane: p });
    } else if (!tk) return;
    else if (k === "enter") {
      const a = v.mine(tk)[0];
      if (a) this.focusAgent(a);
      else if (v.win) this.toggle("tickets.open", tk.key);
      this.seen(tk.key);
    } else if (k === "space" && v.win) {
      this.toggle("tickets.open", tk.key);
      this.seen(tk.key);
    } else if (k === "o") this.openJira(cx, tk.key);
    else if (k === "p") {
      const pr = bestPr(v.prs(tk));
      if (pr) cx.open_url(pr.url);
    } else if (k === "y") cx.write_to_clipboard(tk.key);
    else if (k === "s") this.launch(tk);
    else if (k === "t") {
      const s = suggest(tk, v.mine(tk), v.prs(tk));
      if (s?.to) this.confirmMove(cx, tk.key, s.to);
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  badge(t, status) {
    if (status === "working") return svg("mods/tickets/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    if (status === "blocked") return div().size(8).flex_none().rounded(4).bg(t.blocked).loop("opacity", { from: 0.4, to: 1, period: 1200 });
    if (status === "done") return div().size(8).flex_none().rounded(4).bg(t.done);
    return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  }

  button(t, id, label, tip, onClick) {
    return div()
      .id(id)
      .px(5)
      .flex_none()
      .rounded(4)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((e, cx) => {
        cx.stop_propagation();
        onClick(e, cx);
      })
      .child(label);
  }

  typeDot(t, tk) {
    return div().id(`tk-ty-${tk.key}`).size(7).flex_none().rounded(2).bg(t[TYPE[tk.type]] ?? t.dim).tooltip(tk.type || "Unknown type");
  }

  newDot(t, tk) {
    return this.fresh(tk.key) && div().id(`tk-new-${tk.key}`).size(6).flex_none().rounded(3).bg(t.accent)
      .tooltip("Someone else changed it since you last looked");
  }

  keyLink(t, key) {
    return div()
      .id(`tk-${key}`)
      .flex_none()
      .text_size(11.5)
      .font_semibold()
      .text_color(t.accent)
      .cursor_pointer()
      .hover((s) => s.underline())
      .tooltip("Open in Jira")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.openJira(cx, key);
      })
      .child(key);
  }

  prChip(t, pr) {
    if (!pr) return null;
    const [label, color] = pr.state === "MERGED" ? ["merged", t.ansi13 ?? t.accent]
      : pr.state === "CLOSED" ? ["closed", t.dim]
      : pr.draft ? ["draft", t.dim]
      : pr.review === "APPROVED" ? ["approved", t.done]
      : pr.review === "CHANGES_REQUESTED" ? ["changes", t.blocked]
      : ["open", t.accent];
    const ci = pr.state !== "OPEN" ? null
      : pr.ci === "SUCCESS" ? t.done
      : pr.ci === "FAILURE" || pr.ci === "ERROR" ? t.blocked
      : pr.ci ? t.working : null;
    return h_flex()
      .id(`tk-pr-${pr.url}`)
      .flex_none()
      .gap(4)
      .items_center()
      .px(5)
      .h(17)
      .rounded(4)
      .border(1)
      .border_color(color + "66")
      .text_size(10.5)
      .text_color(color)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(`${pr.repo}#${pr.number} · ${pr.title}${pr.ci ? ` · CI ${pr.ci.toLowerCase()}` : ""}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        cx.open_url(pr.url);
      })
      .when(Boolean(ci), (el) => el.child(div().size(6).rounded(3).bg(ci)))
      .child(label);
  }

  driftChip(t, tk, mine, prs) {
    const s = suggest(tk, mine, prs);
    if (!s) return null;
    const busy = this.moving === tk.key;
    const armed = s.to && this.arming?.key === tk.key && this.arming.to === s.to;
    const color = armed ? t.blocked : t.working;
    return div()
      .id(`tk-mv-${tk.key}`)
      .flex_none()
      .px(5)
      .h(17)
      .rounded(4)
      .border(1)
      .border_color(color + "88")
      .when(armed, (el) => el.bg(color + "22"))
      .text_size(10.5)
      .text_color(color)
      .cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .tooltip(armed ? `Click or press t again to move it to ${s.to}; esc cancels` : s.to ? `${s.why}: move it to ${s.to} (t)` : s.why)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (s.to) this.confirmMove(cx, tk.key, s.to);
        else if (mine[0]) this.focusAgent(mine[0]);
      })
      .child(busy ? "moving…" : armed ? `Move to ${s.to}?` : s.to ? `→ ${s.to}` : s.note);
  }

  // The chips under a ticket: its epic, PR, and suggested move.
  meta(t, tk, mine, prs, extra = []) {
    const epic = shared("tickets.parents")?.[tk.key];
    const pr = this.prChip(t, bestPr(prs));
    const drift = this.driftChip(t, tk, mine, prs);
    const words = [...extra, epic && `↳ ${epic.summary || epic.key}`].filter(Boolean).join(" · ");
    if (!pr && !drift && !words) return null;
    return h_flex().gap(6).items_center().min_w(0)
      .when(Boolean(pr), (el) => el.child(pr))
      .when(Boolean(drift), (el) => el.child(drift))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(words));
  }

  agentRow(t, a, shown, key = null) {
    const pic = icon(a.program, 14, t.foreground);
    const on = a.address === shown;
    const live = clean(a.title);
    const detail = /^\d+$/.test(a.tab_name) ? (live && live !== a.program?.name ? live : a.program?.name) : a.tab_name;
    return h_flex()
      .id(`tk-ag-${a.address}`)
      .h(28)
      .px(8)
      .gap(8)
      .rounded(6)
      .flex_none()
      .items_center()
      .text_size(12)
      .when(on, (el) => el.bg(t.selected))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => this.focusAgent(a))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().max_w(150).truncate().text_color(t.foreground).child(a.space_name || a.program?.name || a.address))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(detail ? `· ${detail}` : ""))
      .when(Boolean(key), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(key)))
      .child(this.badge(t, a.status));
  }

  // A window row: one line (key and summary) until opened, then the summary in full, its
  // chips and its agents.
  ticketRow(t, ticket, mine, prs, shown) {
    const open = Boolean(shared("tickets.open")?.[ticket.key]);
    const sel = this.sel === ticket.key;
    const st = top(mine);
    const pr = bestPr(prs);
    const dot = this.newDot(t, ticket);
    const meta = open && this.meta(t, ticket, mine, prs, [ticket.status, ticket.priority, ticket.type]);
    return v_flex()
      .flex_none()
      .rounded(7)
      .when(open, (el) => el.bg(t.surface).pb(6))
      .when(open || sel, (el) => el.border(1).border_color(sel ? t.accent : t.border))
      .child(h_flex()
        .id(`tk-row-${ticket.key}`)
        .h(30)
        .px(8)
        .gap(8)
        .rounded(7)
        .items_center()
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => {
          this.select(ticket.key);
          this.toggle("tickets.open", ticket.key);
          this.seen(ticket.key);
        })
        .child(svg(`mods/tickets/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
        .child(this.typeDot(t, ticket))
        .child(this.keyLink(t, ticket.key))
        .when(Boolean(dot), (el) => el.child(dot))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(mine.length ? t.foreground : t.muted).child(ticket.summary))
        .when(!open && Boolean(pr), (el) => el.child(this.prChip(t, pr)))
        .when(!open && this.arming?.key === ticket.key, (el) => el.child(this.driftChip(t, ticket, mine, prs)))
        .when(mine.length > 1, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(mine.length))))
        .child(this.button(t, `tk-go-${ticket.key}`, "▶", "Start an agent on it (s)", () => this.launch(ticket)))
        .when(Boolean(st), (el) => el.child(this.badge(t, st))))
      .when(open, (el) => el
        .child(v_flex().px(27).pt(2).pb(6).gap(5)
          .child(div().text_size(12.5).text_color(t.foreground).child(ticket.summary))
          .when(Boolean(meta), (el) => el.child(meta)))
        .when(mine.length > 0, (el) => el.child(v_flex().px(12).gap(1).children(mine.map((a) => this.agentRow(t, a, shown))))));
  }

  // A layout card: always open.
  card(t, ticket, mine, prs, shown) {
    const st = top(mine);
    const sel = this.sel === ticket.key;
    const dot = this.newDot(t, ticket);
    const meta = this.meta(t, ticket, mine, prs);
    return v_flex()
      .id(`tk-card-${ticket.key}`)
      .flex_none()
      .rounded(8)
      .bg(t.surface)
      .border(1)
      .border_color(sel ? t.accent : st === "blocked" ? t.blocked + "88" : t.border)
      .when(mine.length === 0 && !sel, (el) => el.opacity(0.6))
      .px(10)
      .py(8)
      .gap(5)
      .on_click(() => this.select(ticket.key))
      .child(h_flex().gap(8).items_center()
        .child(this.typeDot(t, ticket))
        .child(this.keyLink(t, ticket.key))
        .when(Boolean(dot), (el) => el.child(dot))
        .child(div().flex_1().text_size(11).text_color(t.dim).child(ticket.priority))
        .child(this.button(t, `tk-go-${ticket.key}`, "▶", "Start an agent on it (s)", () => this.launch(ticket)))
        .when(Boolean(st), (el) => el.child(this.badge(t, st))))
      .child(div().text_size(12.5).text_color(t.foreground).child(ticket.summary))
      .when(Boolean(meta), (el) => el.child(meta))
      .when(mine.length > 0, (el) => el.child(v_flex().mx(-4).gap(1).children(mine.map((a) => this.agentRow(t, a, shown)))));
  }

  render(cx) {
    const t = theme();
    const win = props()?.overlay;
    if (win && this.replacing()) return div();
    const data = shared("tickets.data");
    const error = shared("tickets.error");
    const prError = shared("tickets.prError");
    const allPrs = shared("tickets.prs") ?? [];
    const loading = this.loading();
    const shown = focused()?.agent;
    const byPane = new Map(panes().map((p) => [p.pane, p]));
    const tickets = data?.items ?? [];
    const known = new Set(tickets.map((tk) => tk.key));
    const projects = new Set(tickets.map((tk) => tk.key.split("-")[0]));

    const byKey = new Map();
    const other = [];
    for (const a of agents()) {
      const keys = keysOf(a, byPane.get(a.pane), this.cwds?.[a.address]);
      const key = keys.find((k) => known.has(k));
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), a]);
      else other.push({ a, key: keys.find((k) => projects.has(k.split("-")[0])) ?? null });
    }
    const mine = (tk) => byKey.get(tk.key) ?? [];
    const prs = (tk) => allPrs.filter((p) => p.keys.includes(tk.key));

    // Tickets that need you first, then busy ones, then by priority, newest key first.
    const urgency = (tk) => Math.max(0, ...mine(tk).map((a) => RANK[a.status] ?? 0));
    const num = (k) => Number(k.split("-")[1]);
    const sort = (list) => list.sort((x, y) => urgency(y) - urgency(x) || (PRIORITY[y.priority] ?? 0) - (PRIORITY[x.priority] ?? 0) || num(y.key) - num(x.key));
    const live = tickets.filter((tk) => !tk.done || mine(tk).length);
    const statuses = [...ORDER.filter((s) => live.some((tk) => tk.status === s)), ...new Set(live.map((tk) => tk.status).filter((s) => !ORDER.includes(s)))];
    const groups = (filter) => statuses
      .map((s) => ({ id: s, label: s, items: sort(live.filter((tk) => tk.status === s && filter(tk))) }))
      .filter((g) => g.items.length);

    const head = (label, count) => h_flex().gap(8).items_center()
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child(label))
      .child(div().text_size(11.5).text_color(t.dim).child(String(count)));

    const problem = shared("tickets.moveError") ?? error ?? prError;
    const status = problem ?? (loading ? "Refreshing…" : data ? `updated ${ago(data.at)}` : "");
    const toolbar = h_flex().px(12).h(34).flex_none().gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Jira · mine"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(problem ? t.blocked : t.dim).child(status))
      .child(this.button(t, "tk-refresh", "↻", "Refresh from Jira and GitHub (r)", (_e, cx) => this.refresh(cx, true)))
      .when(Boolean(win), (el) => el.child(this.button(t, "tk-close", "×", null, () => closeOverlay(win))));
    const empty = !data && div().p(12).text_size(12).text_color(t.dim).child(error ? "Couldn't reach Jira." : "Loading tickets…");

    // The window's list: as the window, or as a layout block with props { view: "list" }.
    const list = Boolean(win) || props()?.view === "list";
    const view = { win: list, mine, prs, byKey: new Map(tickets.map((tk) => [tk.key, tk])), order: [] };
    this.view = view;
    const keyed = (el) => el.track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx));

    if (list) return keyed(this.window(t, cx, { win, toolbar, empty, groups, mine, prs, other, shown, head, view }));

    // A layout block: one column per status (agentless tickets last), strays at the end.
    const cols = groups(() => true);
    view.order = cols.flatMap((g) => g.items.map((tk) => tk.key));
    const column = (id, body) => v_flex()
      .id(id)
      .flex_1()
      .min_w(0)
      .h_full()
      .rounded(10)
      .bg(t.chrome)
      .border(1)
      .border_color(t.border)
      .p(8)
      .gap(6)
      .overflow_y_scrollbar()
      .child(body);
    return keyed(v_flex()
      .id("tk-root")
      .size_full()
      .bg(t.canvas)
      .text_size(13)
      .child(toolbar)
      .when(Boolean(empty), (el) => el.child(empty))
      .child(h_flex().flex_1().min_h(0).p(10).gap(10)
        .children(cols.map((g) => column(`tk-col-${g.id}`, v_flex().gap(6)
          .child(head(g.label, g.items.length))
          .children(g.items.map((tk) => this.card(t, tk, mine(tk), prs(tk), shown))))))
        .when(other.length > 0, (el) => el.child(column("tk-col-other", v_flex().gap(4)
          .child(head("Other agents", other.length))
          .children(other.map(({ a, key }) => this.agentRow(t, a, shown, key))))))));
  }

  // The list: tickets with agents by status, then the agentless ones and stray agents,
  // each section foldable. As a window, its corner grip resizes it; as a block, it fills it.
  window(t, cx, { win, toolbar, empty, groups, mine, prs, other, shown, head, view }) {
    const folded = shared("tickets.fold") ?? {};
    const isFolded = (id, fallback) => folded[id] ?? fallback;
    const section = (id, label, count, fallback, body) => v_flex().flex_none().gap(2)
      .child(h_flex()
        .id(`tk-sec-${id}`)
        .h(26)
        .px(4)
        .gap(6)
        .items_center()
        .cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => this.toggle("tickets.fold", id, fallback))
        .child(svg(`mods/tickets/chevron-${isFolded(id, fallback) ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim))
        .child(head(label, count)))
      .when(!isFolded(id, fallback), (el) => el.children(body()));

    const working = groups((tk) => mine(tk).length > 0);
    const idle = groups((tk) => mine(tk).length === 0).flatMap((g) => g.items);
    view.order = [
      ...working.filter((g) => !isFolded(g.id, false)).flatMap((g) => g.items),
      ...(isFolded("none", true) ? [] : idle),
    ].map((tk) => tk.key);
    const sections = [
      ...working.map((g) => section(g.id, g.label, g.items.length, false, () => g.items.map((tk) => this.ticketRow(t, tk, mine(tk), prs(tk), shown)))),
      idle.length > 0 && section("none", "No agents", idle.length, true, () => idle.map((tk) => this.ticketRow(t, tk, [], prs(tk), shown))),
      other.length > 0 && section("other", "Other agents", other.length, false, () => other.map(({ a, key }) => this.agentRow(t, a, shown, key))),
    ].filter(Boolean);

    const rows = v_flex().id("tk-rows").flex_1().min_h(0).overflow_y_scrollbar().px(8).py(8).gap(10)
      .when(Boolean(empty), (el) => el.child(empty))
      .children(sections);
    if (!win) return v_flex().id("tk-list").size_full().text_size(13).child(toolbar).child(rows);

    const size = this.size ?? shared("tickets.size") ?? SIZE;
    const reach = this.drag ? REACH : 0;
    const content = v_flex()
      .w(size.w)
      .h(size.h)
      .text_size(13)
      .child(toolbar)
      .child(rows);

    const grip = div()
      .id("tk-grip")
      .absolute()
      .left(size.w - 16)
      .top(size.h - 16)
      .size(16)
      .cursor_nwse_resize()
      .text_size(11)
      .text_color(t.dim)
      .hover((s) => s.text_color(t.foreground))
      .flex()
      .items_center()
      .justify_center()
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        this.drag = { x: e.position.x, y: e.position.y, w: size.w, h: size.h };
        this.size = size;
        cx.notify();
      })
      .child("⌟");

    // While resizing, the window reaches REACH past its new corner so the pointer stays
    // inside it, where its moves arrive; the reach goes on release.
    const end = (cx) => {
      if (!this.drag) return;
      this.drag = null;
      setShared("tickets.size", this.size);
      cx.notify();
    };
    const zone = this.drag && div()
      .id("tk-resize")
      .absolute()
      .left(0)
      .top(0)
      .w(size.w + reach)
      .h(size.h + reach)
      .cursor_nwse_resize()
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        this.size = {
          w: Math.max(MIN.w, Math.round(d.w + e.position.x - d.x)),
          h: Math.max(MIN.h, Math.round(d.h + e.position.y - d.y)),
        };
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => end(cx))
      .on_hover((on, cx) => { if (!on) end(cx); });

    return div()
      .id("tk-win")
      .relative()
      .w(size.w + reach)
      .h(size.h + reach)
      .child(content)
      .child(grip)
      .when(Boolean(zone), (el) => el.child(zone));
  }
}
