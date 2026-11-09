// Resumes Claude Code sessions whose terminals were lost to a reboot or a core
// crash. Draws nothing: the layouts give it a zero-size block so it runs.
//
// A SessionStart hook (claude-configs: claude/scripts/hc-session-label.sh)
// labels each terminal running Claude with claude.session, claude.cwd and
// claude.shell (the terminal's program PID). A lost terminal comes back as a
// fresh shell with a new PID, and the labels stay. So an idle shell whose PID
// differs from claude.shell lost its Claude: resume it there.
//
// An idle shell with the same PID means Claude was exited on purpose. Once
// that has held for a while, drop the labels so a later reboot doesn't bring
// the session back. Herdr quits before the core's terminals die at shutdown,
// so this doesn't fire then.

import { View, div } from "gpui-kit";
import { terminals, hc, exec, notify } from "herdr";

const TICK_MS = 5000;
// Long enough for a resumed Claude to start and relabel its terminal.
const EXITED_MS = 30000;

const quote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

export default class ClaudeResume extends View {
  init(_props, cx) {
    this.exitedSince = {};
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
    this.tick(cx);
  }

  tick(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async () => {
      try {
        await this.sweep();
      } finally {
        this.busy = false;
      }
    });
  }

  async sweep() {
    const tagged = terminals().filter(
      // Local terminals only: remote addresses carry a machine/ prefix.
      (t) => t.state === "live" && t.labels?.["claude.session"] && !t.address.includes("/"),
    );
    const resumed = [];
    for (const { address } of tagged) {
      const r = await hc(["get", address, "--json"]);
      if (r.code !== 0) continue;
      const info = JSON.parse(r.stdout);
      const labels = info.labels ?? {};
      const fg = info.foreground;
      // The terminal's own program is in front, and it isn't Claude.
      const idle = (!fg || fg.pid === info.pid) && info.status?.app !== "claude-code";
      if (!idle || !labels["claude.session"]) {
        delete this.exitedSince[address];
        continue;
      }
      const sid = labels["claude.session"];
      const cwd = labels["claude.cwd"];
      if (String(info.pid) !== labels["claude.shell"]) {
        // Claim it first, so a resume that fails isn't retried every tick:
        // it reads as an exit and the labels go.
        await hc(["label", address, `claude.shell=${info.pid}`]);
        // A session nobody wrote to has no transcript and can't be resumed.
        const transcript = labels["claude.transcript"];
        if (transcript && (await exec("test", ["-f", transcript])).code !== 0) continue;
        const sent = await hc(["send", address, `cd ${quote(cwd)} && claude --resume ${sid}`]);
        if (sent.code === 0) resumed.push(address);
        continue;
      }
      const since = (this.exitedSince[address] ??= Date.now());
      if (Date.now() - since >= EXITED_MS) {
        await hc(["label", address, "claude.session=", "claude.cwd=", "claude.shell=", "claude.transcript="]);
        delete this.exitedSince[address];
      }
    }
    if (resumed.length) {
      notify({
        title: "Resumed Claude",
        body: `${resumed.length} session${resumed.length === 1 ? "" : "s"}: ${resumed.join(", ")}`,
        level: "info",
      });
    }
  }

  render() {
    return div();
  }
}
