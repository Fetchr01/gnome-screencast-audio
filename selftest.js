// Tarkistus: nauhoittaa kolme sekuntia ja katsoo, onko tiedostossa
// kuvan lisäksi ääniraita. Aja tämä GNOMEn päivityksen jälkeen.
//
//   gjs -m selftest.js
//
// Palvelu sitoo nauhoituksen kutsujaansa, joten aloitus ja lopetus on
// tehtävä samasta D-Bus-yhteydestä – pelkällä gdbus-kutsulla yhteys
// katkeaisi heti ja palvelu purkaisi putken kesken.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
const kohde = GLib.build_filenamev([GLib.get_tmp_dir(), 'screencast-audio-selftest']);

function kutsu(metodi, params) {
    return bus.call_sync('org.gnome.Shell.Screencast', '/org/gnome/Shell/Screencast',
        'org.gnome.Shell.Screencast', metodi, params,
        null, Gio.DBusCallFlags.NONE, 30000, null);
}

const [ok, tiedosto] = kutsu('Screencast',
    new GLib.Variant('(sa{sv})', [kohde, {framerate: GLib.Variant.new_int32(30)}])).deepUnpack();

if (!ok) {
    print('EI ONNISTU: nauhoitus ei käynnistynyt');
    imports.system.exit(1);
}

print(`nauhoitetaan 3 s -> ${tiedosto}`);
GLib.usleep(3 * 1000000);
kutsu('StopScreencast', null);
GLib.usleep(500000);          // muxerin viimeistely

const [, ulos] = GLib.spawn_command_line_sync(
    `gst-discoverer-1.0 ${GLib.shell_quote(tiedosto)}`);
const raportti = new TextDecoder().decode(ulos);
const kuva = /video/i.test(raportti);
const aani = /audio/i.test(raportti);

GLib.unlink(tiedosto);

print(`kuva: ${kuva ? 'on' : 'EI'}`);
print(`ääni: ${aani ? 'on' : 'EI'}`);
if (!aani)
    print('\nÄäni puuttuu. Katso lokit: journalctl --user -b | grep screencast-audio');
imports.system.exit(kuva && aani ? 0 : 1);
