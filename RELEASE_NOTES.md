# Rthoptera Desk 0.7.0

A selections layer for Temporal Analysis (amplitude detections and manual
annotations you can merge, split and export), collapsible panels so the
envelope and spectrogram get more room, and batch editing plus Raven export in
the Annotation tab.

## Temporal Analysis

### Selections layer

- **Amplitude Detector** — a simple threshold detector (floor %, minimum
  duration, minimum gap) run on the envelope. It produces its own editable
  detections, independent of envelope-peak detection.
- **✏ Annotate** — drag on the plot to draw your own temporal selection. Each
  one carries a label, a unit (envelope peak, pulse, echeme, motif sequence or
  other) and, for pulses, its maximum amplitude.
- **Edit in place** — drag a selection's edges to resize it, click to select it,
  Del to delete it.
- **Merge** — Ctrl/Shift-click several detections (in the list, or Ctrl-click on
  the plot) and press **Merge** or Ctrl+M. They become one selection from the
  first start to the last end.
- **Split** — hold **S** and click inside a selection. A red guide shows where
  the cut will fall, and both halves are left selected so you can undo or
  re-merge.
- **Manual Echemes** — pulse annotations cluster into echemes using the same
  maximum pulse gap as the automatic pipeline, and everything exports together.

### Collapsible panels

The parameter, editing and selection boxes are grouped into three rows, each with
a ▾/▸ button. Rows start collapsed, so the envelope and spectrogram panes take
the whole window; open a row when you need it. **Parameter Presets** moved into a
menu beside the Detection parameters title, and **Learn from Edits** now sits
inside **Detect & Apply**. Descriptions that used to take up space are now ⓘ
icons — click one to read it.

## Annotation tab

- **Motifs only.** The Envelope peak gap setting is gone; the Annotator groups
  pulses with a fixed internal gap, and **Pulse gap** is the one setting that
  splits one motif from the next (explained in its ⓘ).
- **Batch edit.** Tick any number of selections (shift-click for a range, or
  "all") and delete them, relabel them, or apply the current band to them in one
  step. Every batch action can be undone.
- **Numbering restarts** whenever the table is emptied or new audio is loaded.
- **Export** to a Raven selection table (`.txt`), a Raven table with
  Begin File / File Offset columns, or a generic CSV (seconds and Hz); optionally
  only the ticked selections.
- The panels below the power spectrum are no longer cut off: the tab scrolls, the
  lower boxes wrap, and the readout/actions and detection/selection rows can be
  collapsed.

## Loaded Audio

The Loaded Audio pane at the bottom of the window now has a ▾/▸ button to fold it
away, and remembers whether you left it open.

## 📥 Which file do I download?

Pick the file that matches your operating system and processor.

### Windows

| File                                 | Use                                                     |
| ------------------------------------ | ------------------------------------------------------- |
| `Rthoptera.Desk_0.7.0_x64-setup.exe` | **Recommended** — standard installer, just double-click |
| `Rthoptera.Desk_0.7.0_x64_en-US.msi` | Alternative for managed/enterprise deployment           |

### macOS

| File                               | Use                         |
| ---------------------------------- | --------------------------- |
| `Rthoptera.Desk_0.7.0_aarch64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `Rthoptera.Desk_0.7.0_x64.dmg`     | Intel Macs                  |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. "Apple M…"
means Apple Silicon; "Intel" means the x64 build.

### Linux (x86_64)

| File                                  | Use                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- |
| `Rthoptera.Desk_0.7.0_amd64.AppImage` | **Recommended** — works on most distros. Run `chmod +x` then launch |
| `Rthoptera.Desk_0.7.0_amd64.deb`      | Debian, Ubuntu, Mint, etc.                                          |
| `Rthoptera.Desk-0.7.0-1.x86_64.rpm`   | Fedora, RHEL, openSUSE, etc.                                        |

> **Note:** Builds are currently 64-bit Intel/AMD (x86_64) for Windows and
> Linux, plus both Intel and Apple Silicon for macOS. ARM Linux and
> Windows-on-ARM are not yet supported.

_(The `*.app.tar.gz` files are used by the auto-updater and are not meant for
manual installation.)_
