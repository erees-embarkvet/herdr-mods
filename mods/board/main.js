// Agents as cards in three columns: Needs you, Working, Done.
// Clicking a card shows that agent in the layout's agent block.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, focused, run, theme, setAgentOrder, placement, props, closeOverlay, shared, setShared } from "herdr";

// Done and idle share a column: looking at a done agent only turns it idle.
const COLUMNS = [
  { id: "blocked", label: "Needs you", has: (s) => s === "blocked" },
  { id: "working", label: "Working", has: (s) => s === "working" },
  { id: "done", label: "Done", has: (s) => s === "done" || s === "idle" },
];

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

export default class Board extends View {
  init(_props, cx) {
    // Each agent's last column and when it moved there (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    cx.timer.every(30000, (cx) => cx.notify());
    // As a window, opening it again (mod.open replaces the open one) closes it instead:
    // the old copy stamps when it closed, and a new copy opened within moments of that
    // stamp closes itself. Render hides it at once; the close waits a beat, since one
    // asked for while the window is still opening is ignored.
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
    return Math.abs((shared("board.closedAt") ?? 0) - this.opened) < 500;
  }

  async close() {
    if (props()?.overlay && !this.gone) setShared("board.closedAt", Date.now());
  }

  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const col = COLUMNS.find((c) => c.has(a.status))?.id;
      if (this.changed[a.address]?.s === col) continue;
      this.changed[a.address] = { s: col, at: now };
      dirty = true;
    }
    if (!dirty) return;
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  badge(t, status) {
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    if (status === "blocked") return div().size(8).flex_none().rounded(4).bg(t.blocked).loop("opacity", { from: 0.4, to: 1, period: 1200 });
    if (status === "done") return div().size(8).flex_none().rounded(4).bg(t.done);
    return div().size(8).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  }

  card(t, a, kids, shown, now) {
    const pic = icon(a.program, 16, t.foreground);
    const on = a.address === shown;
    const accent = t[a.status] ?? t.dim;
    const live = clean(a.title);
    const detail = /^\d+$/.test(a.tab_name) ? (live && live !== a.program?.name ? live : a.program?.name) : a.tab_name;
    const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
    const when = this.since(a);
    return h_flex()
      .id(`card-${a.address}`)
      .flex_none()
      .rounded(8)
      .overflow_hidden()
      .bg(on ? t.selected : t.surface)
      .border(1)
      .border_color(on ? t.accent : t.border)
      .cursor_pointer()
      .hover((s) => s.bg(on ? t.selected : t.hover))
      // pane.focus brings its space and tab up in any layout; agent.focus fills an agent block.
      .on_click(() => {
        run("pane.focus", { pane: a.pane });
        run("agent.focus", { terminal: a.address });
      })
      .child(div().w(3).h_full().flex_none().bg(a.status === "idle" ? t.border : accent))
      .child(v_flex().flex_1().min_w(0).px(10).py(8).gap(4)
        .child(h_flex().gap(8).items_center()
          .when(Boolean(pic), (el) => el.child(pic))
          .child(div().flex_1().min_w(0).truncate().font_medium().text_color(a.status === "idle" ? t.muted : t.foreground).child(a.space_name || a.program?.name || a.address))
          .child(this.badge(t, a.status)))
        .child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.dim)
          .child(div().flex_1().min_w(0).truncate().child(detail ?? ""))
          .when(kids > 0, (el) => el.child(div().flex_none().child(`${kids} sub`)))
          .when(Boolean(machine), (el) => el.child(div().flex_none().child(machine)))
          .when(Boolean(when), (el) => el.child(div().flex_none().child(duration(now - when))))));
  }

  render(cx) {
    const t = theme();
    const list = agents();
    const all = terminals();
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    const kids = (addr) => all.filter((k) => k.parent === addr && k.state === "live").length;

    // Newest change first within a column.
    const cols = COLUMNS.map((c) => ({
      ...c,
      cards: list.filter((a) => c.has(a.status)).sort((x, y) => this.since(y) - this.since(x) || y.seq - x.seq),
    }));
    setAgentOrder(cols.flatMap((c) => c.cards.map((a) => a.address)));

    const column = (c) => v_flex()
      .flex_1()
      .min_w(0)
      .h_full()
      .rounded(10)
      .bg(t.chrome)
      .border(1)
      .border_color(c.id === "blocked" && c.cards.length ? t.blocked + "66" : t.border)
      .child(h_flex().px(12).h(36).flex_none().gap(8).items_center()
        .child(div().size(8).rounded(4).bg(t[c.id] ?? t.dim))
        .child(div().text_size(12).font_semibold().text_color(t.foreground).child(c.label))
        .child(div().text_size(11.5).text_color(t.dim).child(String(c.cards.length))))
      .child(v_flex().id(`col-${c.id}`).flex_1().min_h(0).px(8).pb(8).gap(6).overflow_y_scrollbar()
        .children(c.cards.map((a) => this.card(t, a, kids(a.address), shown, now)))
        .when(c.cards.length === 0, (el) => el.child(div().px(4).py(6).text_size(11.5).text_color(t.dim).child("Nothing here"))));

    const section = (c, wide) => v_flex().gap(6).when(wide, (el) => el.w(240))
      .child(h_flex().px(2).gap(8).items_center()
        .child(div().size(8).rounded(4).bg(t[c.id] ?? t.dim))
        .child(div().text_size(12).font_semibold().text_color(t.foreground).child(c.label))
        .child(div().text_size(11.5).text_color(t.dim).child(String(c.cards.length))))
      .children(c.cards.map((a) => this.card(t, a, kids(a.address), shown, now)));

    // A window (mod.open board): rows under a title bar to drag it by, with a close button.
    const win = props()?.overlay;
    if (win && this.replacing()) return div();
    if (win) {
      return v_flex()
        .w_full()
        .text_size(13)
        .child(h_flex().px(12).h(32).flex_none().items_center().justify_between().border_b(1).border_color(t.border)
          .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
          .child(div()
            .id("board-close")
            .px(4)
            .rounded(4)
            .text_color(t.dim)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click(() => closeOverlay(win))
            .child("×")))
        .child(v_flex().id("board-rows").max_h(640).overflow_y_scrollbar().p(10).gap(12)
          .children(cols.map((c) => section(c, false))));
    }

    // Floating: no panel of its own (Herdr frames it) and sized to its content.
    // On a side edge the columns stack as rows; on the top or bottom they sit side by side.
    const float = placement();
    if (float) {
      return (float.vertical ? v_flex().w(300) : h_flex().items_start())
        .id("board-float")
        .max_h(640)
        .overflow_y_scrollbar()
        .p(10)
        .gap(12)
        .text_size(13)
        .children(cols.map((c) => section(c, !float.vertical)));
    }

    return h_flex()
      .size_full()
      .p(10)
      .gap(10)
      .bg(t.canvas)
      .text_size(13)
      .children(cols.map(column));
  }
}
