#!/usr/bin/env bash
# Symlinks this repo's mods and layouts into Herdr's home. Refuses to replace
# anything that isn't already a link. Keys in keys.json are merged by hand.
set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

link() {
  local src="$1" dst="$2"
  if [[ -L "$dst" ]]; then
    ln -sfn "$src" "$dst"
  elif [[ -e "$dst" ]]; then
    echo "skip: $dst exists and isn't a link" >&2
    return
  else
    ln -s "$src" "$dst"
  fi
  echo "linked: $dst"
}

mkdir -p "$home/mods" "$home/layouts"
for m in "$repo"/mods/*/; do link "${m%/}" "$home/mods/$(basename "$m")"; done
for f in "$repo"/layouts/*; do link "$f" "$home/layouts/$(basename "$f")"; done
echo "Merge keys.json into $home/keys.json by hand."
