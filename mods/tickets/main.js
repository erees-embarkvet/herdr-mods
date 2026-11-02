// My Jira tickets, each with the agents working on it: an agent belongs to a ticket
// when its branch, folder, tab or space names the ticket's key. Done tickets show
// only while an agent on them is still open.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, panes, focused, run, theme, exec, shared, setShared, props, closeOverlay } from "herdr";

const SITE = "https://embarkvet.atlassian.net";
const JQL = "assignee = currentUser() AND (statusCategory != Done OR updated >= -30d) ORDER BY updated DESC";
const KEYS = /\b[A-Z][A-Z0-9]+-\d+\b/gi;
const STALE = 150000;
// Known statuses first, in board order; any others follow as they come.
const ORDER = ["To Do", "In Progress", "In Review"];
const PRIORITY = { Highest: 5, High: 4, Medium: 3, Low: 2, Lowest: 1 };
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// The window: its default and smallest size, and how far past the pointer it
// reaches while resizing (pointer moves only arrive inside the window).
const SIZE = { w: 400, h: 560 };
const MIN = { w: 300, h: 220 };
const REACH = 80;

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const top = (list) => list.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);

// Every key-shaped word in what the agent is working in, most specific first.
function keysOf(a, pane) {
  return [pane?.branch, pane?.cwd, a.tab_name, a.space_name, a.title]
    .flatMap((s) => (s ?? "").match(KEYS) ?? [])
    .map((k) => k.toUpperCase());
}

export default class Tickets extends View {
  init(_props, cx) {
    // Copies share one fetch: whichever finds the data stale refreshes it for all.
    cx.timer.every(30000, (cx) => this.refresh(cx));
    this.refresh(cx);
    // As a window, opening it again closes it instead; see the board mod.
    const win = props()?.overlay;
    if (!win) return;
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

  refresh(cx, force = false) {
    const data = shared("tickets.data");
    if (!force && (this.loading || (data && data.v === 2 && Date.now() - data.at < STALE))) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("acli", ["jira", "workitem", "search", "--jql", JQL, "--fields", "key,summary,status,priority", "--paginate", "--json"]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
        const items = JSON.parse(r.stdout).map((i) => ({
          key: i.key,
          summary: i.fields.summary,
          status: i.fields.status?.name ?? "",
          done: i.fields.status?.statusCategory?.key === "done",
          priority: i.fields.priority?.name ?? "",
        }));
        setShared("tickets.data", { v: 2, at: Date.now(), items });
        setShared("tickets.error", null);
      } catch (e) {
        setShared("tickets.error", String(e.message ?? e));
      }
      this.loading = false;
      cx.notify();
    });
  }

  toggle(name, id, fallback = false) {
    const set = { ...(shared(name) ?? {}) };
    set[id] = !(set[id] ?? fallback);
    setShared(name, set);
  }

  badge(t, status) {
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    if (status === "blocked") return div().size(8).flex_none().rounded(4).bg(t.blocked).loop("opacity", { from: 0.4, to: 1, period: 1200 });
    if (status === "done") return div().size(8).flex_none().rounded(4).bg(t.done);
    return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  }

  button(t, id, label, tip, onClick) {
    return div()
      .id(id)
      .px(5)
      .rounded(4)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(onClick)
      .child(label);
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
        exec("open", [`${SITE}/browse/${key}`]);
      })
      .child(key);
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
      .on_click(() => {
        run("pane.focus", { pane: a.pane });
        run("agent.focus", { terminal: a.address });
      })
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().max_w(150).truncate().text_color(t.foreground).child(a.space_name || a.program?.name || a.address))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(detail ? `· ${detail}` : ""))
      .when(Boolean(key), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(key)))
      .child(this.badge(t, a.status));
  }

  // A window row: one line (key and summary) until opened, then the summary in full and its agents.
  ticketRow(t, ticket, mine, shown) {
    const open = Boolean(shared("tickets.open")?.[ticket.key]);
    const st = top(mine);
    return v_flex()
      .flex_none()
      .rounded(7)
      .when(open, (el) => el.bg(t.surface).border(1).border_color(t.border).pb(6))
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
        .on_click(() => this.toggle("tickets.open", ticket.key))
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
        .child(this.keyLink(t, ticket.key))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(mine.length ? t.foreground : t.muted).child(ticket.summary))
        .when(mine.length > 1, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(mine.length))))
        .when(Boolean(st), (el) => el.child(this.badge(t, st))))
      .when(open, (el) => el
        .child(v_flex().px(27).pt(2).pb(6).gap(4)
          .child(div().text_size(12.5).text_color(t.foreground).child(ticket.summary))
          .child(div().text_size(11).text_color(t.dim).child([ticket.status, ticket.priority].filter(Boolean).join(" · "))))
        .when(mine.length > 0, (el) => el.child(v_flex().px(12).gap(1).children(mine.map((a) => this.agentRow(t, a, shown))))));
  }

  // A layout card: always open.
  card(t, ticket, mine, shown) {
    const st = top(mine);
    return v_flex()
      .flex_none()
      .rounded(8)
      .bg(t.surface)
      .border(1)
      .border_color(st === "blocked" ? t.blocked + "88" : t.border)
      .when(mine.length === 0, (el) => el.opacity(0.6))
      .px(10)
      .py(8)
      .gap(5)
      .child(h_flex().gap(8).items_center()
        .child(this.keyLink(t, ticket.key))
        .child(div().flex_1().text_size(11).text_color(t.dim).child(ticket.priority))
        .when(Boolean(st), (el) => el.child(this.badge(t, st))))
      .child(div().text_size(12.5).text_color(t.foreground).child(ticket.summary))
      .when(mine.length > 0, (el) => el.child(v_flex().mx(-4).gap(1).children(mine.map((a) => this.agentRow(t, a, shown)))));
  }

  render(cx) {
    const t = theme();
    const win = props()?.overlay;
    if (win && this.replacing()) return div();
    const data = shared("tickets.data");
    const error = shared("tickets.error");
    const shown = focused()?.agent;
    const byPane = new Map(panes().map((p) => [p.pane, p]));
    const tickets = data?.items ?? [];
    const known = new Set(tickets.map((tk) => tk.key));
    const projects = new Set(tickets.map((tk) => tk.key.split("-")[0]));

    const byKey = new Map();
    const other = [];
    for (const a of agents()) {
      const keys = keysOf(a, byPane.get(a.pane));
      const key = keys.find((k) => known.has(k));
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), a]);
      else other.push({ a, key: keys.find((k) => projects.has(k.split("-")[0])) ?? null });
    }
    const mine = (tk) => byKey.get(tk.key) ?? [];

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

    const status = error ? `acli: ${error}` : this.loading ? "Refreshing…" : "";
    const toolbar = h_flex().px(12).h(34).flex_none().gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Jira · mine"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(error ? t.blocked : t.dim).child(status))
      .child(this.button(t, "tk-refresh", "↻", "Refresh from Jira", (_e, cx) => this.refresh(cx, true)))
      .when(Boolean(win), (el) => el.child(this.button(t, "tk-close", "×", null, () => closeOverlay(win))));
    const empty = !data && div().p(12).text_size(12).text_color(t.dim).child(error ? "Couldn't reach Jira." : "Loading tickets…");

    if (win) return this.window(t, cx, { toolbar, empty, groups, mine, other, shown, head });

    // A layout block: one column per status (agentless tickets last), strays at the end.
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
    return v_flex()
      .size_full()
      .bg(t.canvas)
      .text_size(13)
      .child(toolbar)
      .when(Boolean(empty), (el) => el.child(empty))
      .child(h_flex().flex_1().min_h(0).p(10).gap(10)
        .children(groups(() => true).map((g) => column(`tk-col-${g.id}`, v_flex().gap(6)
          .child(head(g.label, g.items.length))
          .children(g.items.map((tk) => this.card(t, tk, mine(tk), shown))))))
        .when(other.length > 0, (el) => el.child(column("tk-col-other", v_flex().gap(4)
          .child(head("Other agents", other.length))
          .children(other.map(({ a, key }) => this.agentRow(t, a, shown, key)))))));
  }

  // The window: tickets with agents by status, then the agentless ones and stray agents,
  // each section foldable. Its corner grip resizes it.
  window(t, cx, { toolbar, empty, groups, mine, other, shown, head }) {
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
        .child(svg(`mods/workspace-chrome/chevron-${isFolded(id, fallback) ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim))
        .child(head(label, count)))
      .when(!isFolded(id, fallback), (el) => el.children(body()));

    const working = groups((tk) => mine(tk).length > 0);
    const idle = groups((tk) => mine(tk).length === 0).flatMap((g) => g.items);
    const sections = [
      ...working.map((g) => section(g.id, g.label, g.items.length, false, () => g.items.map((tk) => this.ticketRow(t, tk, mine(tk), shown)))),
      idle.length > 0 && section("none", "No agents", idle.length, true, () => idle.map((tk) => this.ticketRow(t, tk, [], shown))),
      other.length > 0 && section("other", "Other agents", other.length, false, () => other.map(({ a, key }) => this.agentRow(t, a, shown, key))),
    ].filter(Boolean);

    const size = this.size ?? shared("tickets.size") ?? SIZE;
    const reach = this.drag ? REACH : 0;
    const content = v_flex()
      .w(size.w)
      .h(size.h)
      .text_size(13)
      .child(toolbar)
      .child(v_flex().id("tk-rows").flex_1().min_h(0).overflow_y_scrollbar().px(8).py(8).gap(10)
        .when(Boolean(empty), (el) => el.child(empty))
        .children(sections));

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
      .relative()
      .w(size.w + reach)
      .h(size.h + reach)
      .child(content)
      .child(grip)
      .when(Boolean(zone), (el) => el.child(zone));
  }
}
