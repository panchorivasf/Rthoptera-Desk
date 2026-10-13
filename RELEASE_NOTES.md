# Rthoptera Desk 0.8.0

A large update to Temporal and Spectral Analysis, plus recording metadata, a
Preferences menu and a helper for uploading to xeno-canto. The headline: the
**Amplitude Detector** can now follow the local noise floor, so faint and loud
parts of a song are segmented in one pass, and pulses can be measured **without
envelope peaks**.

## Temporal Analysis

- **Amplitude Detector with a local noise floor.** *Detect local minima* finds the
  envelope's local minima within a window (*Floor win.*, ms), joins and smooths
  them, and draws the result as a bright green curve. Once it is on, the detector
  thresholds relative to that curve (Floor % becomes an offset above it), so
  reverberation under the loud parts no longer merges elements while the faint
  parts are still caught. The **X** switches it off. Changing the window rebuilds
  the curve.
- **Detection parameters take effect immediately.** After the first Detect, changing
  Smooth, the peak window and thresholds, or Auto re-runs detection after a short
  pause, with no overlay. The same goes for the Amplitude Detector settings, and
  for loading a preset. Like Detect, it re-derives the peaks, so manual peak edits
  are replaced.
- **Pulses without peaks.** *Import Pulses* reads the Pulses table of an export as
  Pulse selections. *Compute Metrics from Pulses* measures amplitude detections and
  drawn or imported pulses directly: pulses are grouped into motifs by Max pulse
  gap, with the same pulse and motif columns as the peaks path. Dynamic excursion
  and max amplitude come from the envelope sampled every 1 ms inside each pulse;
  temporal excursion and the per-peak columns are not calculated. Motif and motif
  sequence lines are drawn live above the pulses.
- **Renamed:** *Import Peaks*, *Compute Metrics from Peaks*, *Clear peaks* (which now
  keeps the envelope on screen), *Draw Selections*, *Clear draws*.
- **One Apply to Spectral Analysis**, whichever way the units were found; *Apply as*
  picks Pulse or Motif selections. If some detections are selected, only those are
  sent. Results stay out of the Annotate tab. **Apply motifs to Annotate** sends one
  selection per motif, labelled with the recording's Species and
  frequency-delimited by the power-spectrum threshold.
- **Selections on the plot.** Detections and drawn selections are a semitransparent
  fill above the envelope line, with thin edges. Shift+drag, Shift+click and
  Ctrl+click select several; **Delete** removes the whole selection.
- **Presets** now include the Amplitude Detector settings, and a built-in
  **Acrididae** preset (Smooth 50, Floor win. 50 ms) is added. Loading a preset
  recomputes the envelope straight away.
- **Pop-up notices** (bottom-right, fade after a few seconds) for problems that were
  only in the folded log: no peaks detected, no pulses with enough peaks, failed
  imports.
- **Detection parameters** reflowed: boxes are only as wide as they need, with two
  columns where it helps. The always-visible bar buttons are larger.

## Spectral Analysis

- A collapsible **Detection & selection tools** row now sits above the spectrogram
  (selection tools, import, selections list). Display options moved into drop-down
  menus in the playback bar (Spectrogram, Grid, Envelope & Floor, Show).
- The Amplitude Detector, the Time Axis zoom slider and the Frequency range
  sliders are gone from this tab. Scroll zooms time; Ctrl+scroll zooms frequency.
- **Fixed:** Ctrl+scroll could not zoom out near the edge of the frequency range.
- **Fixed:** the Excel export stayed disabled after *Spectral Metrics* (a leftover
  variable name). It is now **Export All (Excel)**, as in Temporal Analysis.

## Recording metadata (new)

A **Recording metadata** button replaces the specimen fields in the header. The
popup has a **Recording session** (country, locality, date, time, temperature,
elevation, optional latitude and longitude) and a **Specimen** (ID, species).

- **Extract from map** opens a Leaflet map (street or satellite) to pick the
  coordinates; elevation is looked up automatically, and also when you type
  coordinates yourself and leave the elevation empty. Needs an internet connection.
- **Remember** keeps entries for reuse; **Save to file / Load from file** writes
  both sections to one `.json` (older `specimen_metadata.json` files still load).
- Exported tables gain `rec_date`, `rec_time`, `latitude`, `longitude` and
  `elevation_m` columns.
- **Equipment** (recorder, microphone, accessories) is part of the session and is
  exported as `recorder`, `microphone` and `accessories` columns.
- **Preferences → Default metadata** keeps values you reuse: country, recordist,
  annotation author, license, and lists of recorders, microphones and accessories
  with a default for each. Country and the default equipment are filled into every
  newly loaded recording, equipment typed in a recording joins the lists, and the
  Xeno-canto helper and the Annotate export use the recordist, license and author.

## Xeno-canto upload helper (new)

In the Recording metadata popup: a step-by-step list of the fields on
xeno-canto's two-page upload form, in order, with a copy button beside each text
field and reminders for the choices made on the site. It does not send anything.

## Annotate

- Selections sent from Temporal Analysis for Spectral Analysis are hidden here.
- The spectrogram help text moved into an ⓘ icon (hover to peek, click to keep open).

## Interface

- New **Preferences** menu (Home, Language, **Text Size**, Version) replaces the
  title in the header; the "Loaded" badge is gone.
- Preprocessing opens with the whole recording in view.
- Wider, blue vertical scrollbars.

## Consistent names for the pulse-based complexity columns

The **Manual Echemes** table (on screen and in the exported sheet) now uses
`pci_syl`, `props_ent_syl` and `props_cv_syl`, the same names and calculation as
the Motifs table. **Summarize and Summary Analysis** rename the old `props_ent`,
`props_cv` and `pci` columns to their `_syl` names when a workbook is imported.
Scripts of your own that read the old Manual Echemes column names need updating.

## 📥 Which file do I download?

Pick the file that matches your operating system and processor.

### Windows

| File                                 | Use                                                     |
| ------------------------------------ | ------------------------------------------------------- |
| `Rthoptera.Desk_0.8.0_x64-setup.exe` | **Recommended** — standard installer, just double-click |
| `Rthoptera.Desk_0.8.0_x64_en-US.msi` | Alternative for managed/enterprise deployment           |

### macOS

| File                               | Use                         |
| ---------------------------------- | --------------------------- |
| `Rthoptera.Desk_0.8.0_aarch64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `Rthoptera.Desk_0.8.0_x64.dmg`     | Intel Macs                  |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. "Apple M…"
means Apple Silicon; "Intel" means the x64 build.

### Linux (x86_64)

| File                                  | Use                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- |
| `Rthoptera.Desk_0.8.0_amd64.AppImage` | **Recommended** — works on most distros. Run `chmod +x` then launch |
| `Rthoptera.Desk_0.8.0_amd64.deb`      | Debian, Ubuntu, Mint, etc.                                          |
| `Rthoptera.Desk-0.8.0-1.x86_64.rpm`   | Fedora, RHEL, openSUSE, etc.                                        |

> **Note:** Builds are currently 64-bit Intel/AMD (x86_64) for Windows and
> Linux, plus both Intel and Apple Silicon for macOS. ARM Linux and
> Windows-on-ARM are not yet supported.

_(The `*.app.tar.gz` files are used by the auto-updater and are not meant for
manual installation.)_
