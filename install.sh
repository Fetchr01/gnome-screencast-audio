#!/bin/sh
# Asentaa palvelun käyttäjätasolle. Ei sudoa, ei kosketa /usr:iin.
set -eu

DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
KOHDE="$DATA/gnome-screencast-audio"
PALVELUT="$DATA/dbus-1/services"
LAHDE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

mkdir -p "$KOHDE" "$PALVELUT"
install -m 644 "$LAHDE/screencast-audio.js" "$KOHDE/screencast-audio.js"

# Käyttäjän palvelutiedosto voittaa /usr/share/dbus-1/services -version.
cat > "$PALVELUT/org.gnome.Shell.Screencast.service" <<EOF
[D-BUS Service]
Name=org.gnome.Shell.Screencast
Exec=/usr/bin/gjs -m $KOHDE/screencast-audio.js
EOF

# Käynnissä oleva palvelu omistaa D-Bus-nimen istunnon loppuun asti,
# joten vanha versio on lopetettava kerran. Seuraava nauhoitus käynnistää
# uuden. Hakasulut kuviossa estävät osumisen tähän skriptiin itseensä.
pkill -f "gnome-shell/org\.gnome\.Shell\.Screenc[a]st" 2>/dev/null || true
pkill -f "screencast-audi[o]\.js" 2>/dev/null || true
gdbus call --session --dest org.freedesktop.DBus --object-path / \
    --method org.freedesktop.DBus.ReloadConfig >/dev/null

echo "Asennettu: $KOHDE/screencast-audio.js"
echo "Kokeile: Print -> videotila -> tallenna. Tarkistus: gjs -m selftest.js"
