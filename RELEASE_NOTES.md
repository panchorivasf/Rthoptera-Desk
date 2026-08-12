# Rthoptera Desk 0.3.0

Temperature regression for the summary tables, user-defined structure
selections, listening aids for ultrasonic song, undo for spectral
annotations, and fixes to the habitus PSD plot that affected any set of
recordings with mixed sample rates.

No exported column names changed in this release.

## Temperature regression

Insect song rates scale strongly with temperature, so measurements taken on
different days are not directly comparable. The summary tab can now express
every measurement at one chosen temperature.

For each metric, `value ~ temperature` is fitted by ordinary least squares
across all observations that carry a `temp_c`, and each observation is then
adjusted:

```
adjusted = observed + slope × (target − observed_temperature)
```

The target temperature is set in the toolbar (default 25 °C). Fitting needs
at least three recordings with temperatures — a slope through two points is
not a fit, and the panel says so rather than producing one.

The fit direction is deliberate: the quantity being adjusted is the one
regressed, not temperature. Inverting a `temperature ~ value` line divides by
the slope, which explodes for weakly thermal metrics.

Adjusted tables carry `target_temp_c`, `slope_per_C`, `intercept` and `r2`
alongside the adjusted values, so the strength of each fit is visible and a
weak one can be discarded. Recordings missing a temperature are named in the
panel instead of being silently dropped.

## Structure selections

The summary tab now takes user-defined selections — filters over the merged
rows, each producing its own statistics block, exported to its own sheet.
Selections can filter by position within a parent structure, so "the first
train of every motif" or "peaks 2–4" become comparable groups.

Selections survive a reset and can be edited and re-summarised; notes written
against a selection are never overwritten by a later edit. Statistics for the
unselected pool are labelled in the same `selection` column, so "everything"
behaves like a selection downstream.

## New peak-frequency spread columns

Four columns describe how a structure's peak frequency is distributed across
its own peaks, rather than reporting a single carrier:

`peak_freq_pmean_khz`, `peak_freq_psd_khz`, `peak_freq_pmin_khz` and
`peak_freq_pmax_khz`.

A species whose train sweeps in frequency and one that holds a steady carrier
can report the same `peak_freq_khz`; only these columns separate them. The
`p` marks "aggregated over peak rows", parallel to the `_tmean` suffix
meaning "aggregated over train rows".

## Listening to ultrasonic song

Two independent playback controls, both affecting **listening only** — stored
audio, measurements, exports and plots are untouched.

- **Speed %** — plays back at a fraction of real time. Slowing down lowers
  the pitch as a side effect, which is often enough to bring a song into
  hearing range.
- **Drop %** — lowers every frequency by a percentage while *keeping the
  tempo*. A 25% drop moves a 40 kHz peak to 30 kHz over the same 3 seconds.

The drop is a phase vocoder with identity phase locking (only spectral peaks
advance phase independently; their neighbours follow), then resampling.
Locking the peaks avoids the smearing a textbook vocoder produces when bins
belonging to one partial drift apart.

The same frequency drop is also available as a **destructive edit** in
Preprocessing, and as a **batch operation** across every loaded recording,
for when the shifted audio itself is what you want to keep.

## Undo for spectral annotations

Ctrl+Z in Spectral Analysis, mirroring the existing peak-editing undo in
Temporal Analysis. Every action that changes the annotation set snapshots
first, including the annotation numbering — undo a freshly drawn #7 and the
counter goes back to 7.

Snapshots are dropped when the underlying audio is edited or trimmed, rather
than restoring annotations onto audio they no longer describe.

Two other annotation changes:

- **Temporal only** mode ignores the vertical extent of the drag. Annotations
  span the whole frequency axis anyway, so this leaves only the time axis to
  aim at.
- **Jump to selection edge** (previous / next) steps the playhead through
  selection boundaries — trim handles in Preprocessing, annotation bounds in
  Spectral Analysis — landing on 0 or the file duration past the last edge.

## Habitus PSD plot — mixed sample rates

Combining recordings with different sample rates produced wrong results, and
this affected any set that was not uniform.

Spectra were being combined **by FFT bin index**, but bin *i* sits at a
different frequency for every sample rate, so unrelated frequencies were
averaged together. Each recording is now analysed on its own frequency grid
and resampled onto a shared one before averaging or normalising.

Two further fixes in the same area:

- The frequency axis defaulted to the **first** recording's Nyquist. With a
  44.1 kHz recording anywhere in the set, the axis silently redrew as 0–22 kHz
  and the figure looked zoomed in. It now defaults to the *lowest* Nyquist in
  the set.
- Requesting a range above the available data (0–48 kHz on 44.1 kHz audio)
  filled the contour with NaN and drew nothing. The axis and the data limit
  are now kept apart: the axis honours the request, and the contour simply
  ends where real data stops — which also makes the missing band visible
  rather than hiding it.

A note in the panel states the usable band up front when sample rates are
mixed.

## Oscillogram Zoom — scale bars and presets

- **Scale bar length** can be set explicitly per panel, in ms or s. Each panel
  keeps its own length, since zoom panels span very different durations;
  leave a panel on Auto for a bar about 20% of its width. Click a bar to
  target it, or apply to every panel at once.
- **Trace colour, trace width, font size and stroke width** are exposed in the
  sidebar.
- **Presets** export and import the sidebar settings as `.json` — panel
  ranges and type settings, but not the figure's content, since a preset is
  not tied to one recording. Files without the marker are still tried; only a
  present-and-wrong kind is refused.

Temporal Analysis parameter presets gained the same file export/import.

## Other changes

- Habitus plot: frequency tick spacing can be set explicitly (`0` keeps the
  automatic 6 ticks). Tick labels print enough decimals not to lie about the
  step — a step of 0.25 shows `0.25`, not `0.3`.
- Habitus and Oscillogram Zoom type sizes were raised, and the margins that
  hold rotated axis titles and tick labels were resized to match, which
  previously clipped at larger sizes.
- Oscillogram Stack scale-bar labels now default to 18 pt instead of 9 pt,
  which was unreadable at figure scale.
- Audio library: **Select all** and **Select none** buttons.
- Preprocessing has its own time selection, separate from the trim selection —
  it costs nothing to make and is cleared by a plain click on the waveform.
- A destructive frequency drop is always applied *after* the bandpass,
  whatever order the edits were made in — it moves every frequency, so
  running it first would leave the HP/LP cutoffs pointing at the wrong part
  of the signal.
- Fixed: a drag in Preprocessing silently creating annotations because the
  tool state carried over from another tab; the playback buffer being reused
  after the underlying samples changed; annotations and the time selection
  surviving an audio edit and pointing at the wrong sound.
