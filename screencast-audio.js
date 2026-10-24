// GNOMEn oma ruutunauhoitus + äänet
//
// GNOME Shellin nauhoituspalvelu (Print-näppäimen videotila) tallentaa
// pelkkää kuvaa: sen GStreamer-linjat ovat muotoa
//   pipewiresrc ! enkooderi ! muxer ! filesink
// eikä palvelu ota vastaan mitään ääniasetusta.
//
// Tämä on sen käyttäjätason korvaaja. Se ei kopioi GNOMEn koodia vaan
// lukee alkuperäisen moduulin ajossa, vaihtaa siitä yhden kohdan –
// linjan kokoamisen – ja ajaa muuten täsmälleen samaa palvelua samalla
// D-Bus-nimellä. Siksi GNOMEn päivitykset, myös enkooderivalinnat ja
// korjaukset, tulevat mukaan itsestään. Kopioitu fork vanhenisi.
//
// Jos paikattava kohta joskus katoaa päivityksessä, ajetaan alkuperäinen
// sellaisenaan: nauhoitus toimii, ääni puuttuu, ja siitä tulee ilmoitus
// työpöydälle – hiljainen regressio olisi pahin vaihtoehto.
//
// Asennus ja poisto: install.sh ja uninstall.sh. Kumpikaan ei tarvitse
// sudoa eikä kosketa /usr:iin.
//
// Asetukset: ~/.config/gnome-screencast-audio.conf
//   jarjestelma=0   jättää järjestelmän äänet pois
//   mikki=0         jättää mikrofonin pois
// Oletuksena molemmat ovat mukana samassa raidassa.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const RESURSSI = '/usr/share/gnome-shell/org.gnome.Shell.Screencast.src.gresource';
const JUURI = 'resource:///org/gnome/Shell/Screencast/js';
const ASETUKSET = GLib.build_filenamev([GLib.get_user_config_dir(), 'gnome-screencast-audio.conf']);

Gio.Resource.load(RESURSSI)._register();

function komento(rivi) {
    try {
        const [, ulos] = GLib.spawn_command_line_sync(rivi);
        return new TextDecoder().decode(ulos).trim();
    } catch (e) {
        return '';
    }
}

function ilmoita(viesti) {
    console.warn(`screencast-audio: ${viesti}`);
    GLib.spawn_command_line_async(
        `notify-send -a "Screencast audio" "Ääni ei ole mukana" ${GLib.shell_quote(viesti)}`);
}

/* --- Asetukset ------------------------------------------------------
   Pieni tiedosto, ei skeemaa: rivit muotoa avain=0|1. Oletuksena
   molemmat äänet mukana. Puuttuva tiedosto tarkoittaa oletuksia. */
function asetus(avain) {
    try {
        const [ok, data] = GLib.file_get_contents(ASETUKSET);
        if (ok) {
            const rivi = new TextDecoder().decode(data).split('\n')
                .map(r => r.trim())
                .find(r => r.startsWith(`${avain}=`));
            if (rivi)
                return rivi.split('=')[1].trim() !== '0';
        }
    } catch (e) { /* oletus */ }
    return true;
}

/* --- Äänilähteet ----------------------------------------------------
   Järjestelmän äänet tulevat oletuskaiuttimen monitorista ja puhe
   oletusmikistä. Nimet kysytään ajossa, koska ne vaihtuvat kun
   kuulokkeet kytketään, ja tarkistetaan lähdelistalta ennen käyttöä:
   olematon laite kaataisi koko linjan, jolloin nauhoitus epäonnistuisi
   kokonaan. Parempi tallentaa vajaalla äänellä kuin ei ollenkaan. */
function lahteet() {
    const saatavilla = komento('pactl list short sources')
        .split('\n').map(r => r.split('\t')[1]);
    const kelpaa = n => n && saatavilla.includes(n);

    const sink = komento('pactl get-default-sink');
    const monitori = asetus('jarjestelma') ? `${sink}.monitor` : null;
    const mikki = asetus('mikki') ? komento('pactl get-default-source') : null;

    return {
        monitori: kelpaa(monitori) ? monitori : null,
        /* Mikki voi jo olla monitori (esim. "kuuntele itseäsi" -asetus),
           jolloin sama lähde tulisi mukaan kahdesti. */
        mikki: kelpaa(mikki) && mikki !== monitori ? mikki : null,
    };
}

function aanihaara(laite, kohde) {
    return `pulsesrc device="${laite}" provide-clock=false do-timestamp=true !
                audioconvert ! audioresample !
                audio/x-raw,rate=48000,channels=2 ! queue ! ${kohde}`;
}

/* --- Linjan kokoaminen ----------------------------------------------
   Alkuperäinen linja päättyy aina muxeriin. Se irrotetaan hännästä,
   kuva ohjataan siihen nimettynä ja rinnalle tulee ääni. Kaksi lähdettä
   yhdistetään audiomixerillä; yhdellä mikseri jätetään pois turhana.
   Pysäytys lähettää EOS:n koko putkelle, joten jokainen lähde lopettaa
   siististi ja tiedosto sulkeutuu ehjänä. */
globalThis.OMA_AANI_PIPELINE = (nodeId, kuvalinja, tiedosto) => {
    const lahde = `pipewiresrc path=${nodeId} do-timestamp=true keepalive-time=1000 resend-last=true`;
    const ilmanAanta = `${lahde} ! ${kuvalinja} ! filesink location="${tiedosto}"`;

    const osat = kuvalinja.split('!');
    const muxer = osat.pop().trim();
    const muxerNimi = muxer.split(/\s+/)[0];
    if (!['mp4mux', 'webmmux', 'matroskamux'].includes(muxerNimi))
        return ilmanAanta;                       // oma pipeline D-Busilta: ei kosketa

    const {monitori, mikki} = lahteet();
    if (!monitori && !mikki) {
        ilmoita('Äänilähdettä ei löytynyt, tallennetaan ilman ääntä.');
        return ilmanAanta;
    }

    const koodekki = muxerNimi === 'mp4mux' ? 'avenc_aac bitrate=192000' : 'opusenc bitrate=192000';
    let aani;
    if (monitori && mikki) {
        aani = `
        ${aanihaara(monitori, 'mix.')}
        ${aanihaara(mikki, 'mix.')}
        audiomixer name=mix ! audioconvert ! ${koodekki} ! queue ! mux.`;
    } else {
        aani = `
        ${aanihaara(monitori || mikki, `${koodekki} ! queue ! mux.`)}`;
    }

    return `
        ${lahde} !
        ${osat.join('!')} ! queue ! mux.
        ${aani}
        ${muxer} name=mux ! filesink location="${tiedosto}"`;
};

/* --- Paikattu moduuli -----------------------------------------------
   Alkuperäinen lähde luetaan resurssista, suhteelliset importit
   osoitetaan takaisin resurssiin ja linjan kokoava pätkä korvataan
   kutsulla yllä olevaan funktioon. */
const ALKU = 'const fullPipeline = `';
const LOPPU = 'filesink location="${this._filePath}"`;';

function paikattuModuuli() {
    const tiedosto = Gio.File.new_for_uri(`${JUURI}/screencastService.js`);
    const lahde = new TextDecoder().decode(tiedosto.load_contents(null)[1])
        .replaceAll("from './", `from '${JUURI}/`);

    const i = lahde.indexOf(ALKU);
    const j = lahde.indexOf(LOPPU, i);
    if (i < 0 || j < 0) {
        ilmoita('GNOMEn päivitys muutti nauhoituspalvelua, ääntä ei voitu lisätä.');
        return `${JUURI}/screencastService.js`;
    }

    const paikattu = lahde.slice(0, i) +
        'const fullPipeline = globalThis.OMA_AANI_PIPELINE(nodeId, finalPipelineString, this._filePath);' +
        lahde.slice(j + LOPPU.length);

    const hakemisto = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnome-screencast-audio']);
    GLib.mkdir_with_parents(hakemisto, 0o755);
    const polku = GLib.build_filenamev([hakemisto, 'screencastService.js']);
    GLib.file_set_contents(polku, paikattu);
    return Gio.File.new_for_path(polku).get_uri();
}

const {ScreencastService} = await import(paikattuModuuli());
const {DBusService} = await import(`${JUURI}/dbusService.js`);

if (ScreencastService.canScreencast()) {
    const palvelu = new DBusService('org.gnome.Shell.Screencast', new ScreencastService());
    await palvelu.runAsync();
}
