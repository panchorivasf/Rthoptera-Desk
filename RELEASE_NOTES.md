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
- **STR (simplified temporal representation).** Finds the dominant frequency with
  a long analysis window, then draws the call as a "barcode" of pulses. It
  exports the STR vector (dominant frequency, plus the duration and amplitude of
  each pulse) to Excel.

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

## Loaded Audio

- The loaded files are now a list of names in a pane on the left of the window.
  Each name has a ✕ to close it, and a button closes all checked files. The pane
  is hidden by default. Drag its right edge to open or resize it.

## Interface

- Sharper, consistently sized info icons (ⓘ).

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
