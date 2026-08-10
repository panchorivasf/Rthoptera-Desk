# Rthoptera Desk 0.2.0

A large update to the temporal and spectral analysis modules. **Some exported
column names have changed** — see *Breaking changes* below before running old
analysis scripts against new exports.

## Breaking changes

Existing spreadsheets are unaffected, but scripts that read columns by name
will need updating.

| Old column | New column | Note |
|---|---|---|
| `pci` | `pci_syl` | Values are identical; only the name changed |
| `pci_mean`, `pci_sd` | `pci_syl_mean`, `pci_syl_sd` | Plus new `pci_agn_mean`, `pci_agn_sd` |
| `props_ent`, `props_cv` | `props_ent_syl`, `props_cv_syl` | Plus the `_agn` pair |
| `spec_win_ms` | `spec_signal_ms`, `spec_res_hz`, `spec_bin_hz` | See *Spectral resolution* |

Spectral analysis windows are now set as a **frequency resolution in Hz**
instead of a duration in milliseconds. Presets saved with the old
millisecond fields are converted automatically when loaded.

## Pattern Complexity Index — now two variants

The PCI is computed twice on every motif, so the two can be compared directly:

- **PCI-syl** (`pci_syl`) — the original index. Divides the motif at train
  boundaries (train duration, gap, train duration, …).
- **PCI-agn** (`pci_agn`) — new. Divides the motif at every peak, using only
  inter-peak intervals and no train information at all.

PCI-syl inherits whatever grouping parameters produced the trains; PCI-agn
cannot. If the two turn out to be strongly correlated across a dataset, the
train segmentation is adding assumptions rather than information.

PCI-syl reproduces the previous `pci` values exactly.

## Spectral resolution set in Hz, per level

Windows were previously specified in milliseconds, which gives a *different*
frequency resolution at different sample rates — a 2 ms request produced
344.53 Hz bins at 44.1 kHz but 375 Hz at 48 kHz. Resolution is now requested
directly in Hz and is sample-rate independent.

A new **Spectral Parameters** panel holds three settings:

| Level | Default |
|---|---|
| Peak frequency resolution | 1500 Hz |
| Train frequency resolution | 50 Hz |
| Motif frequency resolution | 10 Hz |

Three columns replace `spec_win_ms` and say plainly what happened:
`spec_signal_ms` (real audio per transform), `spec_res_hz` (the resolution
actually achieved — the column to check is constant when comparing
recordings), and `spec_bin_hz` (bin spacing after zero-padding, i.e.
interpolation density, not resolution).

Where peaks sit closer together than the requested resolution needs, the
frame is limited by its neighbours and the row honestly reports the coarser
resolution it achieved. Confirm now warns when this happens and names the
setting at which all peaks would share one frequency axis.

## Motif-level spectra

Motif rows now carry the spectrum twice:

- `spec_*` — one transform over the whole motif span at the motif resolution.
- `spec_*_tmean` — the mean of the motif's train rows.

The first resolves structure the shorter train window cannot; the second
contains no inter-train silence. Disagreement between them is informative.

## Statistics report

The **Export Text Report** button now produces a full temporal report instead
of only the spectral-detection summary. Every statistic is given as
`mean ± SD [min–max]`, under headings for Peaks, Trains and Motifs, covering
peak period, peaks per train, train rate, trains per motif, train duration,
train period, train gaps, dynamic and temporal excursion, motif duration,
period and duty cycle, motif peak frequency, −20 dB and −10 dB bandwidth, and
both PCI variants. The previous spectral-detection paragraphs are kept and
appended when those measurements exist.

The reported peak period is now measured **within trains only**. The
`peak_period_ms` column is built from the flattened peak list, so the last
peak of every train carries the inter-train interval; averaging it directly
mixed pulse periods with train gaps.

## New columns

- `country` and `temp_c` — tagged per recording in the toolbar and written to
  every exported table. Temperature is free text so `22.5`, `~23` or blank all
  work. Country is also stored in the specimen metadata `.json`; temperature
  is not, since it varies between recordings of the same specimen.
- `train_period_ms` and `motif_period_s` — forward-looking, onset to next
  onset, blank on the last element.
- `source_file` — the originating audio file, on every export, for
  traceability.
- `freq_spread` — standard deviation of peak carrier frequency across a
  train's peaks.

## Other changes

- The app version is shown in the toolbar, read from the build itself.
- Switching the active recording now clears the previous recording's
  selections, detections, measurements, peaks, trains, motifs, undo history
  and fitted parameters, which previously carried over and could be exported
  under the wrong file name.
- Closing the last audio file clears the dashboard.
- Progress indicators during peak detection, spectrogram rendering, metric
  computation, spreadsheet export and batch audio saving.
- Undo (Ctrl+Z) for peak editing.
- "Fit to selection" learns detection *and* grouping parameters from a few
  hand-corrected trains; envelope smoothing stays user-defined and is never
  fitted.
- Parameter presets can be saved to and loaded from a file through the normal
  file dialog.
- Detected peaks can be imported back from a saved Excel table.
- The envelope is drawn as soon as a file loads, rather than waiting for
  Detect Peaks.
- The Temporal Analysis tab is reorganised into labelled parameter panels.
- Shorter, consistent export filename suffixes (`n0`, `2hpf`, `temp`, `spec`,
  `det`, `meas`, `peak`, `train`, `motif`, `summ`, `raven`, `meta`).
- False-peak filtering now detects *runs* of low-amplitude peaks between
  larger ones, and no longer drops legitimate quiet peaks that split a train.
- Trains can be split on the amplitude arc, cutting at the middle of the
  valley between arcs.
- Fixed: missing values in `peak_period_ms`; peak spectra whose frame could
  overrun a neighbouring pulse; the parameter panel jumping to a second row
  after Apply; the envelope distorting on window resize.
- Removed unused TensorFlow.js and Chart.js bundles, reducing the frontend
  from 4.8 MB to under 1 MB.
