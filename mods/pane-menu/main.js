// Terminal right-click menu: Herdr's pane items (copied from the shipped `menu`),
// plus Restart Claude for Claude Code terminals. A layout picks it with
// "terminal_menu": "pane-menu". Props { tab: "pane", target: { pane, terminal }, overlay }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args, icon];
// a command "restart" runs restart.sh detached, since the menu closes first.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, keys, terminals, panes, spaces, exec, home } from "herdr";

const SCRIPT = `${home()}/.config/herdr-app/mods/pane-menu/restart.sh`;

function items(p) {
  const tg = p?.target ?? {};
  const all = terminals();
  const term = all.find((t) => t.address === tg.terminal);
  // A kept sub-agent can go back under its parent, still running.
  const parent = term?.parent && all.find((t) => t.address === term.parent);
  // Once they go to the program, Shift+right-click still opens this menu.
  const toProgram = term?.labels?.["herdr.right-click"] === "program";
  const claude = term?.agent === "claude-code" || term?.program?.key === "claude";
  return [
    ["Split right", "pane.split", { direction: "right", pane: tg.pane }, "panel-right"],
    ["Split down", "pane.split", { direction: "down", pane: tg.pane }, "panel-right"],
    ["Zoom", "pane.zoom", { pane: tg.pane }, "square"],
    ...(term
      ? [
          toProgram
            ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }, "terminal"]
            : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }, "terminal"],
        ]
      : []),
    ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }, "terminal"]] : []),
    ...(claude
      ? [
          ["Restart Claude", "restart", { mode: "exit", terminal: term.address, pane: tg.pane }, "rotate-ccw"],
          ["Force restart Claude", "restart", { mode: "force", terminal: term.address, pane: tg.pane }, "rotate-ccw"],
        ]
      : []),
    ["Close pane", "pane.close", { pane: tg.pane }, "x"],
  ];
}

// Where to reopen a Claude that ends with its terminal: the pane's space, as its tab's name.
function restart({ mode, terminal, pane }) {
  const tab = panes().find((p) => p.pane === pane)?.tab;
  const space = spaces().find((s) => (s.tabs ?? []).some((c) => c.id === tab));
  const name = space?.tabs.find((c) => c.id === tab)?.name ?? "claude";
  if (mode === "exit") run("pane.focus", { pane });
  exec("/bin/sh", ["-c", 'nohup "$0" "$@" >/dev/null 2>&1 &', SCRIPT, mode, terminal, space?.id ?? "", name]);
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class PaneMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    const it = items(props())[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    if (it[1] === "restart") restart(it[2]);
    else run(it[1], it[2]);
  }

  render(cx) {
    const t = theme();
    const list = items(props());
    return v_flex()
      .id("pane-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && it[1] !== list[i - 1][1] && (it[1] === "pane.close" || it[1] === "restart"), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(
              h_flex()
                .id(`mi-${i}`)
                .h(31)
                .px(8)
                .gap(9)
                .rounded(7)
                .items_center()
                .justify_between()
                .text_color(t.foreground)
                .when(i === this.at, (el) => el.bg(t.selected))
                .hover((s) => s.bg(t.hover))
                .on_click(() => this.choose(i))
                .child(svg(`mods/pane-menu/${it[3]}.svg`).size(14).flex_none().text_color(t.muted))
                .child(div().flex_1().child(it[0]))
                .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2]))),
            ),
        ),
      );
  }
}
