# gnome-screencast-audio

GNOME's built-in screen recorder — the one behind the Print key, the one you
already use — records video only. This adds the audio: what the computer plays,
what the microphone hears, or both, in the same track. The recorder itself does
not change. Same key, same little UI, same files in `~/Videos/Screencasts`.

## Why there is no audio to begin with

The recorder is not an app. It is a small D-Bus service shipped with GNOME
Shell, and every one of its six GStreamer pipelines looks like this:

```
pipewiresrc ! encoder ! mp4mux|webmmux ! filesink
```

No audio source anywhere, and the service accepts only three options:
`pipeline`, `framerate` and `draw-cursor`. There is no GSettings schema either,
so there is no hidden switch to flip. It is a missing feature, not a setting.

## What this does instead of forking

A fork would copy `screencastService.js` and rot: it would miss upstream fixes
and drift until something breaks. This does not copy GNOME's code. It is a
replacement service that

1. reads GNOME's own module at runtime from its gresource,
2. replaces exactly one thing in it — the line that assembles the pipeline,
3. runs the rest of GNOME's service unchanged, under the same D-Bus name.

So GNOME's updates, including its hardware encoder selection and its bug fixes,
come along on their own. The only thing that can go stale is one marker string,
and if that ever disappears the service runs the original module untouched:
recording still works, audio is absent, and a desktop notification says so. A
silent regression would be the worst outcome, so it is the one case that is
loud.

A user-level D-Bus service file takes precedence over the one in `/usr/share`,
which is why none of this needs root and why removing two files undoes it.

## The pipeline

The muxer is detached from the tail of whichever pipeline GNOME picked, video is
routed into it by name, and the audio branches join alongside:

```
pipewiresrc ... ! <video as GNOME built it> ! queue ! mux.
pulsesrc device="<default sink>.monitor" ! audioconvert ! audioresample ! queue ! mix.
pulsesrc device="<default source>"       ! audioconvert ! audioresample ! queue ! mix.
audiomixer name=mix ! audioconvert ! avenc_aac|opusenc ! queue ! mux.
<muxer> name=mux ! filesink location="..."
```

The codec follows the container: AAC for mp4, Opus for webm. Device names are
resolved per recording, because they change when headphones are plugged in, and
each one is checked against the source list first — a device that no longer
exists would take the whole pipeline down with it, and recording without audio
beats not recording at all.

## Install

```
git clone https://github.com/Fetchr01/gnome-screencast-audio
cd gnome-screencast-audio
./install.sh
```

No root, nothing written outside `~/.local/share`. The next recording has sound;
no logout needed. To remove it, `./uninstall.sh` — GNOME's own service is back
immediately.

## Settings

`~/.config/gnome-screencast-audio.conf`, created by hand, both default to on:

```
jarjestelma=1    # system audio (the default sink's monitor)
mikki=1          # microphone (the default source)
```

Set either to `0` to leave it out. With both on they are mixed into one track.

## After a GNOME update

```
gjs -m selftest.js
```

Records three seconds of your screen into `/tmp`, checks that the file has both
a video and an audio stream, deletes it again, and tells you which one is
missing.

## Caveats

- GNOME Shell on Wayland. Written against 51.1; the patched marker has been
  stable across releases, but that is what `selftest.js` is for.
- If the process that started a recording dies mid-way (a shell crash), the mp4
  is left without its `moov` atom and will not play. That is GNOME's own
  behaviour on a vanished caller, not something this adds — stopping normally
  from the UI always finalises the file.
- `notify-send` is used for the one failure notification. Without it you get a
  journal line instead.
- Code comments are in Finnish.

## License

MIT
