# Rthoptera Desk 0.8.0

A reworked Annotation tab (a simpler motif detector, edge editing, batch edits and
Xeno-canto export), Merge folded into Preprocessing, a more compact Spectral
Analysis layout, and a round of fixes to downsampling, presets and metadata.

## Annotation tab

- **Simpler motif detector.** Detection now thresholds the band-limited envelope,
  merges stretches separated by less than the gap, and drops anything shorter
  than a minimum duration. The settings are **Smooth ms**, **Threshold %**,
  **Gap ms** and **Min dur ms**; the envelope-peak settings are gone.
- **Edit boxes by their edges.** Drag the left or right edge of any box on the
  spectrogram to change its start or end. Ctrl+Z undoes the drag.
- **Batch edit.** Tick any number of selections (shift-click for a range, or
  "all") and delete them, relabel them, or apply the current band to them.
- **Rename a species** now has its own text box for the new name.
- **Chronological numbering.** The number shown for a selection is its place in
  time order and updates on its own when you add, delete or resize. Internal ids
  never change, so undo and batch ticks stay correct.
- **Export** to a Raven selection table (with or without Begin File / File
  Offset), a generic CSV, or a **Xeno-canto annotation set (.json)**. The XC
  number is read from the file name (for example `XC1180460`) and falls back to
  what you type. Annotator, sound type, sex, life stage and remarks are optional
  and apply to the whole export.
- **New layout.** The power spectrum is a tall panel on the left third, with the
  readout/actions and detection/selection menus beside it. Both menus fold away.

## Preprocessing

- **Merge is now inside Preprocessing**, as a second sub-tab next to Edit audio.
  The separate Merge tab is gone.
- Descriptive text is behind ⓘ icons, and the panels and Edit Audio sub-menus
  have ▾/▸ buttons.
- **Downsample** now rescales the spectrogram's frequency axis to the new
  Nyquist instead of leaving an empty band above it.
- A downsample adds a tag with the new sampling rate to the saved file name
  (for example `_96dsp`), and a full-band filter on a downsampled recording no
  longer gets a false `lpf` tag.

## Home page

The intro sentence is gone. **Load Audio** and a **Quick Guide** button sit under
the title; the Quick Guide shows the description of each tab, now including
Annotate.

## Spectral Analysis

The display and detection settings that used to sit in a left column are now side
by side below the spectrogram, folded away with one ▾/▸ button. The log starts
collapsed.

## Temporal Analysis

- The arch-detection settings and edge pad now regroup pulses immediately, like
  the other grouping settings.
- Confirm & Compute Metrics explains why when no pulses survive the grouping,
  with the typical peak spacing, instead of showing a table of zeros.
- Editing Specimen ID, Species, Country, Locality or Temp now updates the
  results tables and the summary straight away.
- Exported presets are suggested as `<species>_temp_preset.json`.

## Citation

The README now asks users to cite the Rthoptera paper (Rivas et al. 2025,
*Methods in Ecology and Evolution*, https://doi.org/10.1111/2041-210X.70045).

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
