#!/bin/sh
# Poistaa palvelun. GNOMEn alkuperäinen palaa käyttöön heti.
set -eu

DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
rm -rf "$DATA/gnome-screencast-audio"
rm -f "$DATA/dbus-1/services/org.gnome.Shell.Screencast.service"
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/gnome-screencast-audio"

pkill -f "screencast-audi[o]\.js" 2>/dev/null || true
gdbus call --session --dest org.freedesktop.DBus --object-path / \
    --method org.freedesktop.DBus.ReloadConfig >/dev/null

echo "Poistettu. Asetustiedosto jäi: ${XDG_CONFIG_HOME:-$HOME/.config}/gnome-screencast-audio.conf"
