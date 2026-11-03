# Rthoptera Desk 0.9.0

Three new modules (Custom Workflow, Clustering, STR), a reworked Edit audio pane in
Preprocessing, and a Loaded Audio list on the left of the window.

## New modules

- **Custom Workflow.** Press **Record Workflow** (top right), work as usual, then
  press it again to stop. Name the workflow ("Workflow 1" by default) and tick the
  metrics to keep: only the ticked metrics are calculated and exported when the
  workflow is replayed, not every default metric of Temporal and Spectral Analysis.
- **Clustering.** Groups the selected recordings by sound with Google Perch
  embeddings, without the traditional metrics. Load your own Perch `.onnx` file
  (it runs offline). Selections are used when present, otherwise 5 s windows.
  The number of clusters is chosen automatically (agglomerative clustering,
  silhouette score). Results appear in an interactive 3D map (PCA, UMAP or
  t-SNE) that can be coloured by cluster, recording, sample rate or species.
  Clicking a point shows its spectrogram. Clusters can be written back as
  selection labels and exported to Excel.
- **STR (Simplified Temporal Representation).** Finds the dominant frequency with
  a long analysis window, then draws the song as a barcode of its pulses (bar
  width = duration, bar height = amplitude, spaces = silent gaps).
  - Compute it from the checked recordings, or build it from the Pulses sheet of
    a Temporal Analysis export, with no audio needed. A table's motifs become the
    echemes.
  - The **STR vector** holds the dominant frequency, then each pulse's duration,
    amplitude and the gap to the next pulse.
  - The **STR fingerprint** turns the barcode into 52 numbers, always in the same
    order: rate, duty cycle, echeme values, histograms of pulse durations and
    onset-to-onset intervals, and the amplitude and duration shape along the
    echeme. Its length doesn't depend on the number of pulses, so songs can be
    compared and pooled.
  - The **Representative STR** pools every loaded STR into one consensus song
    per species. Time is expressed as a proportion of each echeme (period or
    duration), so faster and slower renditions line up. The tempo is kept
    apart as the median period with its quartiles. Each 1% of the echeme
    shows how many renditions have sound there and how loud it is. Echemes
    with different pulse counts blend instead of being discarded.
    Continuous trills fall back to the pulse cycle.
  - The Excel export includes an `STR_fingerprint` sheet. Summarize reads it as
    a new **STR** table, which can be ticked in Summary Analysis for the PCA,
    the leave-one-out test and the species knowledge base.

## Preprocessing

- **Vanish** replaces the time selection with noise matched to the recording's own
  background, so the length stays the same. **Delete** cuts the selection out and
  joins the two sides, and the **Delete** key does the same. If either one can't
  act (no selection, Trim mode open, selection inside the noise padding), a
  message now says why.
- **Fix DC Offset**, single file or selected files. The waveform has a centre line
  and suggests the fix when the recording is noticeably off centre.
- **Normalize** is now in *Edit audio*.
- **Per-tool batch.** The separate Batch Edit pane is gone. Every tool except Time
  selection and Trim has *Apply to current file* and *Apply to selected files*.
  The second button is available when more than one file is checked.
- *Noise padding* has a Fade in/out toggle, and *Fade* has Fade in / Fade out
  checkboxes (both on by default).
- *Downsample* rates are shown in kHz with a whole-number Nyquist frequency, in a
  narrower menu.
- **Undo Edit** and **Save Edited Audio** sit in the *Edit audio* title bar. Reset
  buttons have their own row, and all tools fit in one row on wide windows.
- Audio info (duration, sample rate, Nyquist, channels) moved into the playback
  bar.
- **Cursors:** the I-beam is the default over the waveform and spectrogram. A
  ↔ cursor appears while dragging out a selection or over its edges, and
  dragging an edge resizes the selection. The hand appears only inside a
  selection, which can be dragged to move it.
- The waveform opens taller (140 px).

## Temporal Analysis

- **Pulse level measured in the audio.** The envelope still finds and times the
  pulses, but each pulse's level is now measured in the audio samples between
  its start and end. It is given relative to the **median pulse** of the same
  recording, so one click, a louder neighbour, recorder gain or microphone
  distance no longer shifts it. The values don't depend on the *Smooth* setting.
  - New **Pulses** columns: `rms_db_rel` (pulse RMS vs. the median pulse, dB),
    `peak_db_rel` (pulse peak vs. the median peak, dB), `crest_db` (peak ÷ RMS
    within the pulse, dB) and `peak_dbfs` (absolute peak, a clipping check).
  - New **Motifs** columns: `level_sd_db` and `level_range_db`, the spread and
    the range of the motif's pulse levels.
  - `mean_amp` and `max_amp` are still exported for compatibility. They are scaled
    to the recording's single loudest moment, so one loud event lowers them all.
    Prefer the new columns for comparisons.
  - Summary Analysis's suggested variable set now includes `level_sd_db`.
    Summarize and Summary Analysis ignore `peak_dbfs`.
- **Detection parameters.** The **Amplitude Detector** button moved to the
  top bar, to the right of **Detect envelope peaks**. The number boxes are
  narrower. *Onset thr. (%)* was removed; old presets that set it load without
  it.
- **Amplitude Detector threshold on the plot.** A dashed line marks the
  *Floor %* level: a detection is any stretch where the envelope rises above
  it. With the local noise floor on, it becomes a curve, the floor plus
  Floor %. It follows the box as you type.
- **Clear pulses** (next to *Clear peaks*) deletes the amplitude detections and the
  drawn or imported Pulse selections in one step, plus any metrics computed from
  them. Other selections and envelope peaks stay, and Ctrl+Z restores it.
- **Editing tools between the plots.** The Edit Mode and Envelope peak Actions
  boxes are now one narrow strip of centered buttons, without titles, between
  the envelope and the spectrogram. The **Selections** and **Manual Echemes**
  boxes moved to the bottom of the module, below the tables.
- **Merge** moved from the Selections box to the editing strip, next to
  **Select**. It now works on both kinds of selection: with two or more envelope
  peaks selected it joins them into one pulse (this replaces the **Join**
  button, which was removed), and with two or more detections or drawn
  selections it merges them into one. Ctrl+M still merges detections.
- **Clear selection** was renamed **Deselect**, and it now clears the envelope
  peak selection and the selected detection or drawn selection together.
- **Reset boundaries** was removed. Use Undo (Ctrl+Z) to step back from boundary
  edits.

## Summarize

- **Summary plots replace the summary table.** Pick a table and a variable to see
  one bar chart per measurement: mean ± SD for **All rows**, for each
  **individual** (Specimen ID) or for each **species**. Tick or untick groups to
  show, filter the variables, and optionally show values corrected to a common
  temperature. The numbers are still available under *Numbers as a table*.
- **Temperature response** starts collapsed, since it is not the main output.
- **Corrections on the file cards win.** A Specimen ID, Species, Country or
  Locality typed on a card (or pasted as metadata) now overrides the value in the
  file's rows. Fixing a typo such as CHAO35 → CHA035 merges the two specimens.
- **Only song measurements are summarized.** Recording metadata (latitude,
  longitude, elevation, date, time, recorder, microphone) and the spectral
  settings (`spec_signal_ms`, `spec_res_hz`, `spec_bin_hz`) are no longer treated
  as variables, in Summarize or in Summary Analysis.

## Summary Analysis

- **New layout.** The PCA biplot and the 3D PCA sit side by side in one section.
  Variable importance sits to the right of the radar profiles. The Compare table
  sits to the right of its radar, no taller than it, with its own scrollbar.
  Every section has a ▾ button to fold it.
- **Radial labels** checkbox on both radars (Radar profiles and Compare): each
  variable name is turned along its spoke, so long or many names no longer
  overlap.
- **PCA biplot labels** are spread so they don't overlap each other or sit
  behind the axis labels, with leader lines where a label had to move. A new
  menu shows only the 5, 10, 15 or 20 longest arrows.
- **3D PCA** draws a species ellipsoid from 3 recordings (was 4), matching the
  2D plot.
- **All spectral / all temporal** checkboxes in *Variables and species* tick or
  untick every spectral (frequencies, bandwidths, Q, spec_*) or temporal
  variable at once, across all tables.
- **Variable importance** can be saved as a figure (PNG or SVG): a ranked bar
  chart of η² with F for each variable.
- **Compare recordings or species** has a **Table (Excel)** button. It saves
  the comparison table with each item's mean, SD and number of recordings in
  separate columns, at full precision, plus the ratio column.
- **STR rep.** table: the species representatives from the STR module, one row
  per species, so the species themselves are the observations. Use it to
  describe and compare species (radar, Compare, PCA, Compare with knowledge
  base). The leave-one-out test and species profiles need several recordings
  per species and explain this instead of running.

## Loaded Audio

- The loaded files are now a list of names in a pane on the left of the window.
  Each name has a ✕ to close it, and a button closes all checked files. The pane
  is hidden by default. Drag its right edge to open or resize it.

## Interface

- Sharper, consistently sized info icons (ⓘ).

## 📖 Documentation

Read the [User Manual (PDF)](https://github.com/panchorivasf/Rthoptera-Desk/blob/main/Rthoptera_Desk_User_Manual_v0.9.0.pdf).
It is also attached to this release as `Rthoptera_Desk_User_Manual_v0.9.0.pdf`.

## 📥 Which file do I download?

Pick the file that matches your operating system and processor.

### Windows

| File                                 | Use                                                     |
| ------------------------------------ | ------------------------------------------------------- |
| `Rthoptera.Desk_0.9.0_x64-setup.exe` | **Recommended** — standard installer, just double-click |
| `Rthoptera.Desk_0.9.0_x64_en-US.msi` | Alternative for managed/enterprise deployment           |

### macOS

| File                               | Use                         |
| ---------------------------------- | --------------------------- |
| `Rthoptera.Desk_0.9.0_aarch64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `Rthoptera.Desk_0.9.0_x64.dmg`     | Intel Macs                  |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. "Apple M…"
means Apple Silicon; "Intel" means the x64 build.

### Linux (x86_64)

| File                                  | Use                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- |
| `Rthoptera.Desk_0.9.0_amd64.AppImage` | **Recommended** — works on most distros. Run `chmod +x` then launch |
| `Rthoptera.Desk_0.9.0_amd64.deb`      | Debian, Ubuntu, Mint, etc.                                          |
| `Rthoptera.Desk-0.9.0-1.x86_64.rpm`   | Fedora, RHEL, openSUSE, etc.                                        |

> **Note:** Builds are currently 64-bit Intel/AMD (x86_64) for Windows and
> Linux, plus both Intel and Apple Silicon for macOS. ARM Linux and
> Windows-on-ARM are not yet supported.

_(The `*.app.tar.gz` files are used by the auto-updater and are not meant for
manual installation.)_
