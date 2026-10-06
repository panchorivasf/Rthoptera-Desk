# Rthoptera Desk 0.7.2

Temporal Analysis gets an automatic noise-based detection threshold, import of
motifs and motif sequences, new dashboard rates, a Cancel button for heavy jobs
and new defaults. Edit audio moves its menus below the spectrogram.

## Temporal Analysis

- **Automatic detection threshold.** **Auto** (ticked by default) sets the
  Detection threshold from the background noise: the median of the quiet part of
  the envelope (below 25% of the peak) plus three times its spread. The box shows
  the value used, and the status line reports it ("noise ≈ 2.1% → threshold
  4.5%"). Typing a value in the box switches Auto off; tick it again to go back.
  It warns when the noise level is high, which usually means a single loud spike
  is setting the 100%.
- **The false-peak filter is gone.** The "False envelope peak Δ" setting, the
  "Remove False Envelope peaks" button and the filter step in Detect are removed,
  and Learn from Edits no longer fits Δ. Auto covers the same need more simply.
  Presets saved with the old Δ still load.
- **Import restores motifs and motif sequences.** Importing an Envelope peaks
  table now takes each peak's motif, and the motif sequences from the sequences
  sheet, straight from the file instead of re-deriving them from the gap settings,
  replacing what the app had. They stay until you edit Max pulse gap or Max motif
  gap, press Detect, or re-derive the pulse boundaries.
- **Dashboard.**
  - New **Pulse rate** and **Echeme rate** cards.
  - Every card that shows a mean now also shows its standard deviation
    ("0.52 ± 0.11"). Echeme rate is the mean of 1 / (onset-to-onset time).
  - The Summary sheet gains `pulse_rate_pps_mean`, `pulse_rate_pps_sd`,
    `echeme_rate_per_s` and `echeme_rate_per_s_sd`.
- **Motif sequences are drawn as a solid band** above the motif band, so they
  show on dim screens where the background shade alone was hard to see.
- **🗑 Drop unassigned peaks** deletes the peaks that belong to no pulse worth
  keeping (pulses with fewer peaks than Min envelope peaks/pulse), the same ones
  the exported tables already leave out. It can be undone.
- **New defaults.** Smooth 1 ms, envelope peak window 1 ms, envelope peak
  threshold 1%, detection threshold 5%, max envelope peak gap 8 ms, edge pad
  1 ms, max pulse gap 100 ms and max motif gap 350 ms.
- The top toolbar no longer shows the file name, which is already in the Loaded
  Audio list.

## Cancel for heavy jobs

**Fit to selection**, **Detect** and **Confirm & Compute Metrics** now show a
**Cancel** button on the progress overlay, and keep the window responsive while
they run. A cancelled fit changes nothing, and a cancelled metrics run clears its
partial tables so nothing half-made can be exported. Fitting over a whole minute
of peaks is still slow; selecting just the pulses you corrected keeps it light.

## Preprocessing

**Edit audio** now has the waveform and spectrogram on top and every menu below
them, side by side: Audio Info, Edit Audio (with Time selection, Trim, Bandpass
filter, Frequency drop and Downsample as columns) and Batch Edit.

## 📥 Which file do I download?

Pick the file that matches your operating system and processor.

### Windows

| File                                 | Use                                                     |
| ------------------------------------ | ------------------------------------------------------- |
| `Rthoptera.Desk_0.7.2_x64-setup.exe` | **Recommended** — standard installer, just double-click |
| `Rthoptera.Desk_0.7.2_x64_en-US.msi` | Alternative for managed/enterprise deployment           |

### macOS

| File                               | Use                         |
| ---------------------------------- | --------------------------- |
| `Rthoptera.Desk_0.7.2_aarch64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `Rthoptera.Desk_0.7.2_x64.dmg`     | Intel Macs                  |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. "Apple M…"
means Apple Silicon; "Intel" means the x64 build.

### Linux (x86_64)

| File                                  | Use                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- |
| `Rthoptera.Desk_0.7.2_amd64.AppImage` | **Recommended** — works on most distros. Run `chmod +x` then launch |
| `Rthoptera.Desk_0.7.2_amd64.deb`      | Debian, Ubuntu, Mint, etc.                                          |
| `Rthoptera.Desk-0.7.2-1.x86_64.rpm`   | Fedora, RHEL, openSUSE, etc.                                        |

> **Note:** Builds are currently 64-bit Intel/AMD (x86_64) for Windows and
> Linux, plus both Intel and Apple Silicon for macOS. ARM Linux and
> Windows-on-ARM are not yet supported.

_(The `*.app.tar.gz` files are used by the auto-updater and are not meant for
manual installation.)_
