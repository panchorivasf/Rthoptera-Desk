# Rthoptera Desk 0.5.0

A new plotting module — the Auto-coded Oscillogram — which carries frequency
information in the colour of a waveform, so you can see at a glance where in a
long recording a chosen band is sounding.

## Auto-coded Oscillogram

An implementation of Brizio, C. (2023). Colour Enhanced Time/Pressure Envelope
(CETPE), a novel on-screen rendering of digital sound. *Rivista Italiana di
Acustica*, 48(2), 63-71. Found under **Plotting → Auto-coded Osc.**

A spectrogram shows time, frequency and pressure by mapping pressure to colour.
This shows the same three domains the other way round: time and pressure are
the oscillogram, and colour carries the frequency. The result keeps an
oscillogram's readability while marking exactly where user-chosen frequency
bands rise above a threshold — the parts of an unsupervised recording worth
looking at, found without reading a spectrogram.

Two renderings:

- **2-colour** — one frequency range, drawn in a contrasting colour wherever
  any bin in it reaches the pressure threshold.
- **Multicolour** — the range is split into 6, 12 or 24 uniform bands, each
  mapped to one bit of the 24-bit RGB triplet. Every band over the threshold
  raises its bit and the colour is their OR, so reddish, greenish and bluish
  hues mean the upper, middle and lower thirds of the frequency window.

Parameters follow the paper: a frequency range bottom and top, a pressure
threshold, and an optional overall pressure range that excludes the loudest or
feeblest parts of the recording. The threshold is in dBFS rather than raw
sample values, so it means the same thing across bit depths and recorders. FFT
size and overlap are exposed, and changing the threshold recolours instantly
without re-analysing.

The figure stacks a reference oscillogram and spectrogram above the coloured
one, with a band-to-colour legend and a caption stating every parameter used.
It exports to SVG and PNG, and the sidebar settings save to a reusable .json
preset.

Time resolution is the spectrogram's rather than the waveform's. That is
inherent to the technique, not a shortcut.

## Finding, hearing and measuring the marked regions

- **Zoom** on the time axis: drag to zoom to a range, wheel to zoom about the
  cursor, Shift+wheel to pan, double-click for the whole recording. Zooming
  buys real resolution rather than magnification — the drawn columns and the
  spectrogram are both recomputed for the visible slice.
- **Playback** from the playhead, with a position line across all three panels
  and speed as a percentage of real time.
- **An activity light** that lights while the playhead is over a coloured
  column, and names the bands sounding there.
- **Coloured regions export** to CSV: every contiguous marked stretch as a time
  interval with the bands that marked it, so what you can see can also be acted
  on.

## Ultrasonic playback no longer aliases

A recording sampled well above the sound card's rate has to be resampled before
it can play. The browser audio engine does that by interpolation with no
anti-alias filter, so everything above the output Nyquist folded back down into
the audible band — a 250 kHz recording of a 42 kHz song came out as harsh noise
instead of the near-silence it should be.

Playback in this module now low-passes before resampling, as any audio editor
does. The cutoff follows the Speed setting, because speed is what decides where
a frequency ends up: slowed down, the whole ultrasonic band lands under the
output Nyquist and passes untouched, which is how you listen to it. The
transport bar states the cutoff whenever one is in force.

This affects listening only. Analysis, colours, measurements and every export
use the untouched recording.
