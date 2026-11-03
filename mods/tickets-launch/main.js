// Starts an agent on a ticket: in a new space at a folder you pick, or as a new tab in
// a space you already have. Opened by the tickets mod with props { key, summary, argv }.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, run, theme, props, closeOverlay, pickFolder, home } from "herdr";

const tilde = (p) => (p && p.startsWith(home()) ? "~" + p.slice(home().length) : p || "~");

export default class TicketsLaunch extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  close() {
    closeOverlay(props().overlay);
  }

  // The system folder picker sits over this dialog; it stays open (modal) until a choice.
  pickNew(cx) {
    const { key, argv } = props();
    this.picking = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Start" });
      if (folder) {
        run("space.new", { name: key, folder, argv });
        this.close();
        return;
      }
      this.picking = false;
      cx.notify();
    });
  }

  into(space) {
    const { key, argv } = props();
    run("tab.new", { space: space.id, name: key, argv });
    run("space.select", { id: space.id });
    this.close();
  }

  row(t, id, icon, label, detail, hint, onClick) {
    return h_flex()
      .id(id)
      .h(34)
      .px(9)
      .gap(10)
      .rounded(7)
      .flex_none()
      .items_center()
      .cursor_pointer()
      .hover((s) => s.bg(t.selected))
      .on_click(onClick)
      .child(icon)
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_color(t.foreground).child(label))
        .when(Boolean(detail), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(detail))))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(hint));
  }

  render(cx) {
    const t = theme();
    const { key = "", summary = "", argv = [] } = props() ?? {};
    const list = spaces().filter((s) => !s.machine);
    return v_flex()
      .id("tl")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return this.close();
        if (e.key === "n") return this.pickNew(cx);
        const n = /^[1-9]$/.test(e.key) ? list[Number(e.key) - 1] : null;
        if (n) this.into(n);
      })
      .size_full()
      .bg(t.popover)
      .p(6)
      .gap(2)
      .text_size(12.8)
      .child(v_flex().px(9).pt(4).pb(8).gap(2)
        .child(div().font_semibold().text_color(t.accent).child(`Start ${key}`))
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(summary ?? ""))
        .child(div().truncate().text_size(11).text_color(t.dim).font_family("monospace").child(`$ ${argv.join(" ")}`)))
      .child(this.row(t, "tl-new", svg("mods/tickets/folder-plus.svg").size(14).flex_none().text_color(t.foreground),
        this.picking ? "Picking a folder…" : "New workspace…", "A new space in a folder you pick", "n", (_e, cx) => this.pickNew(cx)))
      .child(div().h(1).mx(4).my(4).bg(t.border).flex_none())
      .child(div().px(9).pb(2).text_size(11).text_color(t.dim).child("Into a workspace"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(1)
        .children(list.map((s, i) => this.row(t, `tl-sp-${s.id}`,
          div().size(8).flex_none().rounded(4).bg(s.status ? t[s.status] ?? t.dim : t.border),
          s.name, [tilde(s.folder), s.branch].filter(Boolean).join(" · "), i < 9 ? String(i + 1) : "", () => this.into(s))))
        .when(list.length === 0, (el) => el.child(div().px(9).py(6).text_color(t.dim).child("No workspaces open"))));
  }
}
