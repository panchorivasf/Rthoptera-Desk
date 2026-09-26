# Rthoptera Desk 0.6.0

A Language menu, a Downsample option in Preprocessing, a linear/dB scale
choice for the Multiplot's spectrogram and power spectrum, and processing
spinners on every plotting and heavy-compute button that lacked one.

## Language menu

English, Español, Italiano and Português, chosen from the toolbar and
remembered between sessions. Every top-level tab, every panel heading and
every primary action button translates; tooltips and status/log messages are
still English-only and will follow in a later pass. Exported files are
unaffected — column headers and metric names (`peak_freq_khz`, `bw_20db_khz`,
and the rest) stay in English regardless of the interface language, so a
workbook opened by a collaborator, or re-imported later, reads the same
column names no matter who produced it.

## Downsample

Preprocessing gains a Downsample control, both on the single active recording
and as a batch operation across every checked recording in the Loaded Audio
library. The target rate is chosen from a list, each option showing its
Nyquist frequency in parentheses, and only rates below the recording's own
are offered.

An anti-aliasing low-pass runs before the rate is actually reduced — the same
requirement Merge's resampler already enforced when concatenating recordings
of different rates. Content the new rate cannot represent is removed rather
than folded back down into the audible band as aliasing. Batch downsampling
leaves an already-checked recording alone if it is already at or below the
chosen rate, rather than treating a mixed-rate batch as an error.

## Multiplot: dB / Linear scale

A Scale control next to the spectrogram's Colormap/Contrast/Brightness
settings, shared by the Power Spectrum curve and the spectrogram's colour
mapping so the two panels never disagree. dB is the previous, default
behaviour. Linear uses amplitude rather than power — a genuine linear
*power* scale puts anything more than about 20 dB below the loudest moment
under 1% brightness, which reads as a blank spectrogram for any real
recording; linear amplitude keeps meaningfully more of the signal visible
while remaining a true, non-logarithmic scale.

## Processing spinners

The busy-overlay spinner already used for peak detection and audio import
now also covers the Multiplot render, Oscillogram Stack/Zoom and Habitus
draw, batch bandpass filtering, spectral metrics computation, and the
Annotator's detect-in-view/detect-in-span. These were previously silent for
however long the computation took, which on a long or high-sample-rate
recording could freeze the window for several seconds with no sign of life.
Export buttons and other bounded, fast operations are unchanged.

## 📥 Which file do I download?

Pick the file that matches your operating system and processor.

### Windows
| File | Use |
|------|-----|
| `Rthoptera.Desk_0.6.0_x64-setup.exe` | **Recommended** — standard installer, just double-click |
| `Rthoptera.Desk_0.6.0_x64_en-US.msi` | Alternative for managed/enterprise deployment |

### macOS
| File | Use |
|------|-----|
| `Rthoptera.Desk_0.6.0_aarch64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `Rthoptera.Desk_0.6.0_x64.dmg` | Intel Macs |

Not sure which Mac you have? Click the  menu → **About This Mac**. "Apple M…"
means Apple Silicon; "Intel" means the x64 build.

### Linux (x86_64)
| File | Use |
|------|-----|
| `Rthoptera.Desk_0.6.0_amd64.AppImage` | **Recommended** — works on most distros. Run `chmod +x` then launch |
| `Rthoptera.Desk_0.6.0_amd64.deb` | Debian, Ubuntu, Mint, etc. |
| `Rthoptera.Desk-0.6.0-1.x86_64.rpm` | Fedora, RHEL, openSUSE, etc. |

> **Note:** Builds are currently 64-bit Intel/AMD (x86_64) for Windows and
> Linux, plus both Intel and Apple Silicon for macOS. ARM Linux and
> Windows-on-ARM are not yet supported.

*(The `*.app.tar.gz` files are used by the auto-updater and are not meant for
manual installation.)*
