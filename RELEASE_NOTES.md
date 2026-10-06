# Rthoptera Desk 0.7.3

A new **Summary Analysis** tab in Summarize for comparing species — PCA, 3D PCA,
radar plots, which variables separate species, a leave-one-out identification
test, and species profiles and a knowledge base to identify unknown recordings —
with temperature adjustment. Also clearer names for the mean-frequency columns.

## Summary Analysis (Summarize → Summary Analysis)

Reads the tables merged on the Summary tab, so run **Merge & Summarize** first.
Each recording (or each specimen) is one observation, described by the mean of
every chosen variable; the species comes from the species tag. Pick the variables
(a **Suggested set** gives about ten indicators) and the species to show, then
**Run analysis**.

- **PCA biplot.** Z-scored variables, species centroids, 1σ / 1.5σ / 2σ covariance
  ellipses, variable loadings, any two of the first three PCs. Click a point to
  write its recording name beside it.
- **3D PCA.** Drag to rotate, wheel to zoom, ellipsoid outlines per species.
  Hover a point for its recording ID, click to pin it, or show all IDs. **HTML**
  saves an interactive copy as one self-contained page that needs no internet.
- **Radar plot.** Each variable scaled 0–1 across the observations; species mean
  with a ±1 SD band.
- **Which variables separate the species?** A ranking by η² and F from a one-way
  ANOVA, plus how much each variable depends on temperature.
- **Leave-one-out test.** Each observation is classified from the profiles of all
  the others with two methods — Mahalanobis (each species' own variance) and LDA
  (pooled covariance) — reporting the share correct, the share in the top 3,
  per-species hit rates and the most frequent mix-ups. It can leave out the whole
  specimen instead of one recording.
- **Compare recordings or species.** Tick 2 to 6 recordings, or species means, and
  see a radar (each variable as a share of the largest value, so it works with
  just two recordings) and a table of the real values and their ratio.
- **Species profiles and knowledge base.** *Extract species profiles* gives, for
  each species, the mean, spread and covariance of the chosen variables.
  *Save to knowledge base* writes a `.kb.json` file (added to a loaded one when the
  variables match), species can be renamed inside it, and the file keeps the
  names you gave. *Compare with knowledge base* ranks the closest species for each
  recording, and for all of them pooled, by LDA and Mahalanobis, with how many
  variables fall within each species' mean ± 2 SD, and a radar of the unknown
  against its three closest species.
- **Temperature.** *Adjust for temperature* fits a slope for every variable within
  species and moves each value to a reference temperature before the analyses.
  A knowledge base keeps its reference temperature and slopes, and comparisons
  adjust the unknown with them.
- **Names.** Edit the name of any recording or species, or re-assign a recording to
  another species; giving two species one name merges them.
- **Settings.** **Save settings** and **Load settings** keep the variables,
  species, edited names, temperature options, plot options and comparison picks
  as a `.json` file. **Reset analysis** starts again from scratch.
- Exports: PNG and SVG for the plots, and a CSV of scores, loadings and variable
  relevance. Species names in the legends are shown in full.

## Clearer column names

The mean-frequency and mean-spectrum columns now say what they average over and
keep the unit last:
- Motif rows: the mean over the motif's pulses is `…_pulse_mean…`, for example
  `peak_freq_pulse_mean_khz` (was `peak_freq_khz_tmean`) and
  `spec_signal_pulse_mean_ms` (was `spec_signal_ms_tmean`).
- Pulse and motif rows: the aggregates over envelope peaks are
  `peak_freq_envpeak_mean_khz`, `_envpeak_sd_khz`, `_envpeak_min_khz` and
  `_envpeak_max_khz` (were `peak_freq_pmean_khz`, `_psd_`, `_pmin_`, `_pmax_`).

Workbooks exported with the old names still import into Summarize; the columns are
renamed on the way in. Scripts of your own that read the old names need updating.

## 📥 Which file do I download?

Pick the file that matches your operating system and processor.

### Windows

| File                                 | Use                                                     |
| ------------------------------------ | ------------------------------------------------------- |
| `Rthoptera.Desk_0.7.3_x64-setup.exe` | **Recommended** — standard installer, just double-click |
| `Rthoptera.Desk_0.7.3_x64_en-US.msi` | Alternative for managed/enterprise deployment           |

### macOS

| File                               | Use                         |
| ---------------------------------- | --------------------------- |
| `Rthoptera.Desk_0.7.3_aarch64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `Rthoptera.Desk_0.7.3_x64.dmg`     | Intel Macs                  |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. "Apple M…"
means Apple Silicon; "Intel" means the x64 build.

### Linux (x86_64)

| File                                  | Use                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- |
| `Rthoptera.Desk_0.7.3_amd64.AppImage` | **Recommended** — works on most distros. Run `chmod +x` then launch |
| `Rthoptera.Desk_0.7.3_amd64.deb`      | Debian, Ubuntu, Mint, etc.                                          |
| `Rthoptera.Desk-0.7.3-1.x86_64.rpm`   | Fedora, RHEL, openSUSE, etc.                                        |

> **Note:** Builds are currently 64-bit Intel/AMD (x86_64) for Windows and
> Linux, plus both Intel and Apple Silicon for macOS. ARM Linux and
> Windows-on-ARM are not yet supported.

_(The `*.app.tar.gz` files are used by the auto-updater and are not meant for
manual installation.)_
