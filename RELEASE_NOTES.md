# Rthoptera Desk 0.5.1

Two new modules: an annotator built around choosing a frequency band once per
species, and a tool for merging recordings end to end.

## Annotate

A new tab for labelling motifs, in which the frequency band is a per-species
decision rather than a per-box one.

Time and frequency are chosen where each can be measured honestly. Time comes
from the **waveform**, at sample resolution, with no window length smearing the
onsets. Frequency comes from the **power spectrum** of that span, where a window
long enough to resolve the carrier costs nothing because no time resolution is
needed of it. The **spectrogram** is where the resulting box is displayed, never
where it is drawn — a spectrogram is one fixed compromise between time and
frequency resolution, so a box dragged on it records that compromise as much as
it records the animal.

An amplitude threshold, so many dB below the peak of the spectrum, derives the
band automatically. The same threshold can be read two ways, and the choice is a
claim about the species rather than a display preference:

- **outer** — the outermost crossings anywhere in the search range. A species
  whose harmonics carry real energy gets a band that spans them, but so does a
  band that happens to catch a different animal calling in the same window.
- **around peak** — walk out from the carrier and stop at the first crossing
  each side. One lobe, with harmonics and unrelated neighbours excluded.

The two agree exactly on a single-lobed spectrum and differ only where there is
something else to find.

Locking the band freezes it across every later selection and every later
recording, which is what makes leaving *auto* on safe: without the lock, each
new selection silently rewrites the band you settled on. Bands save to
`<species>.band.json` and reload locked, so the edges reaching a training table
are one considered decision rather than hundreds of hand-drags of varying
steadiness. A band derived from the whole view is refused a place on disk — in a
recording holding a cricket and a katydid it is neither animal's band.

Selections carry a species name, are coloured per species, and can be renamed in
bulk. That last part is also how boxes drawn in Spectral Analysis, or imported
from a Raven table, get a real species attached.

**Detect in view** and **Detect in span** find motifs inside the band using
Rthoptera's own peak, train and motif grouping, measured on the band-limited
envelope — so a second species elsewhere in the spectrum cannot fuse its pulses
into these trains, which is the case no choice of gap parameters can untangle on
a full-band envelope. Re-running tops up rather than duplicating: a motif more
than half covered by an existing selection of the same species is skipped, and
overlap with a *different* species is not treated as a conflict.

Everything lands in the same selection list as before, so Ctrl+Z, the sidebar and
Raven export work unchanged.

## Merge

Concatenate loaded recordings, end to end, into one.

The merge list is explicit and reorderable, and each entry shows the offset at
which it will land. Sample rates are checked rather than assumed: appending
48 kHz audio to a 44.1 kHz recording without resampling replays it 8.8% slow and
drops every frequency in it by the same proportion. Where the carrier is the
diagnostic feature, that is a silent 8.8% error in the measurement the whole
analysis rests on. Merging refuses by default and resamples only when asked.

The resampler is a windowed sinc rather than plain interpolation, so a
downsample cannot fold ultrasonic content back into the band. Measured on a
96 → 48 kHz conversion: flat to 20 kHz, 111 dB down at 30 kHz, 125 dB down at
40 kHz. The transition spans roughly the top tenth of the new Nyquist, so
downsampling to a rate whose Nyquist lands close to the call is the one case
worth thinking about rather than accepting.

Centring and peak normalisation are optional and applied once at the end.
Normalising scales the whole concatenation to a single peak, so amplitudes are
no longer comparable *between* the source recordings — turn it off when that
comparison matters.

An optional silence gap can be inserted between pieces, never before the first
or after the last. The piece boundaries export as a Raven selection table, so
where each recording went stays on the record after the joins become invisible.

The merged recording enters the Loaded Audio library like any import and becomes
the active one, so Preprocessing, Spectral Analysis, Temporal Analysis and
Annotate all see it immediately.
