# Rthoptera Desk 0.8.1

A small update to Preprocessing, plus two fixes in Temporal Analysis.

## Preprocessing

- **Noise padding.** *Edit audio > Noise padding* adds synthetic background noise
  before and after the recording, leaving room for a fade. The noise is matched to
  the recording's own: the target-free parts are found automatically (the quietest
  frames, so no selection is needed), and for every frequency bin the most common
  amplitude in those parts is reproduced with random phases. The joins are
  crossfaded. *Pad with noise* adds the padding; *Pad + fade* also fades in and
  out. Make sure no call is cut off at the very start or end. Padding shifts the
  timeline, so detections, envelope peaks and annotations are cleared, as for a
  trim. Narrow tonal lines (hum) come out about two bins wider than the original.
- **Fade in / fade out** with the length in **seconds** (default 1 s). Fades are
  applied last, after padding, so they shape the padded edges.
- Undo and the edit status line now include frequency drop, noise padding and fades.
  Saved filenames get `_noisepad`, `_fadein` and `_fadeout` tags.

## Temporal Analysis

- **Fix:** split mode (hold **S**, click a detection) could stay latched after the
  key was released. It now releases on focus loss, dialogs and other key presses.
  A split leaves a 1 ms gap between the two halves.
- The **Amplitude Detector** button now sits with its settings, and the Detection
  parameters boxes stack their controls in one column on narrower windows instead
  of overflowing.

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
