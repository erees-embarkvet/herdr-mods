# AGENTS.md

- The Herdr mod API has no package. Its reference is written by the app into `~/.config/herdr-app/`: `AGENTS.md` (mods, layouts, overlays, commands), `herdr.d.ts`, `gpui-kit.d.ts`. Herdr's shipped mods in `~/.config/herdr-app/mods/` are the best examples.
- Shipped mods and layouts are replaced on every Herdr start. Copy what you need into this repo rather than pointing at their files.
- Check a mod with `herdr-app check <mod>` (renders it once, with no props), then `herdr-app status` for errors from live copies. Saving reloads mods in place, but not through the `install.sh` symlinks: after editing here, re-link (`ln -sfn <repo>/mods/<mod> ~/.config/herdr-app/mods/<mod>`) to reload.
- The running app is the user's own window. If you open a mod, switch layouts or take a `herdr-app shot`, put it back as it was: switching layouts also closes open windows.
- `tickets` moves Jira tickets with `acli jira workitem transition`. Never run that to test.
- `acli jira workitem search --fields` refuses `parent`, `updated`, `components` and more. Use `acli jira workitem view` for those.
