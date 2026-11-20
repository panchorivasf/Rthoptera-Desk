# Rthoptera Desk 0.9.3

An FFT filter (a graphical equaliser on the power spectrum) with presets and microphone
correction, selectable roll-off for the band-pass filter, deletion of padded noise,
Delete around selection, and fixes to selection dragging and slow playback.

## Preprocessing

- **FFT filter.** A new **FFT filter…** button in Edit audio opens an editor with the
  power spectrum of the whole file or of the time selection. Click the curve to add a
  point, drag points up or down to amplify or attenuate a band, and delete points with
  Delete or the point box. A frequency range (From / To) zooms the editor on any band.
  The gain axis is fixed, so zooming in frequency does not move the 0 dB line. The
  filter can be applied to the whole file or to the selection only (the edges are
  blended over 5 ms), and the result is part of the edit chain: Undo Edit and
  **Remove applied filter** take it away.
- **FFT filter presets.** Save the current curve under a name, load it later, or delete
  it. **Export file…** and **Import file…** move a preset to another computer as a
  `.json`. A preset loaded on a recording with a lower sampling rate drops the points
  above its Nyquist frequency.
- **Microphone correction.** **Import response curve…** reads a microphone's frequency
  response (a text or CSV table of frequency and level in dB), inverts it and places it
  in the editor as a gain curve. The curve is smoothed (none to 1 octave), limited by
  **max boost** and **max cut** (12 dB by default) and simplified to a few points
  (**detail**), and is referenced to a chosen frequency or to its median. The response
  is drawn as a dashed line over the spectrum. **Rebuild** redoes it with new settings;
  **Clear curve** hides the response.
- **Band-pass roll-off.** A new **Slope** box sets how steeply the band-pass filter
  falls beyond the cut-off: 12, 24 (default), 48, 72 or 96 dB per octave. The cut-off
  is the −6 dB point. The status line shows the slope when it is not 24.
- **Band-pass cut-offs in kHz.** The High-pass and Low-pass boxes now take kHz (step
  0.5), as the rest of the program does.
- **Delete around selection.** A new button deletes everything outside the selection
  (the part before it and the part after it). Undo restores both cuts in one step.
- **Noise padding can be deleted.** The noise added by Noise padding can now be selected
  and deleted like any other part of the recording. Deleting padded noise shortens the
  padding instead of cutting the recording.

## Fixes

- **Selections stopping short of the recording's edges.** Dragging a selection past the
  start or end of the waveform could stop at an arbitrary place. The drag now continues
  while the pointer is outside the plot and reaches the edge.
- **Playback at speeds other than 100%** stopped at random in Preprocessing. Playback
  now resumes when the audio engine is interrupted and restarts from the right place
  when a stop is not at the end. Please report it if it still happens.
- **Grouping parameters of Temporal Analysis** now apply to the pulses made by the
  Amplitude Detector, not only to those made from envelope peaks.

## Temporal Analysis

- The **Amplitude Detector** pane now sits under **Peak Detection** in two rows, and
  its **Clear detections** button is gone: **Clear pulses** in the main pane does the
  same.

---

# Rthoptera Desk 0.9.2

A vertical navigation bar for the waveform and spectrogram, and the local floor curve
now follows its window setting.

## Waveform and spectrogram

- **Vertical navigation bar.** When you zoom in vertically, a thin bar appears on the
  right edge of the plot. It shows the visible slice of the amplitude range
  (waveform) or the frequency range (spectrogram). Drag the thumb, or click the
  track, to move up and down. The bar is hidden when the plot is fully zoomed out.
- **Vertical pan of the waveform.** Zoomed in on amplitude, the waveform can now be
  moved up and down (it used to scale around zero only). The reset button (↺)
  recentres it. The playhead and annotation overlays do not follow the vertical pan.

## Temporal Analysis

- **Local floor window updates live.** Changing **Floor win. (ms)** now redraws the
  local floor curve about half a second after you stop typing (Enter or leaving the
  field also applies it). Before, the curve stayed at the default until a detection
  had run. The log reports the number of minima for the new window.

---

# Rthoptera Desk 0.9.1

Drag-and-drop loading, zoom buttons and a real oscillogram when you zoom in, shortcuts
you can change, one shared threshold and a local noise floor for both detectors in
Temporal Analysis, and PERMANOVA and clustering in Summary Analysis.

## Loading audio

- **Drag and drop.** Drop audio files (WAV, MP3, FLAC, OGG, AIFF) anywhere on the
  window: the landing page, the Loaded Audio list or any tab. A highlight shows
  while you drag. Other file types are ignored, with a message in the log.

## Waveform and spectrogram (Preprocessing, Temporal Analysis, Spectral Analysis)

- **A true oscillogram when zoomed in.** Once a pixel column holds only a few
  samples, the waveform is drawn as the samples joined by a line (with a dot on
  each sample when they are far apart), instead of min/max bars that looked like
  bins. The shortest window is now about 24 samples (it was 5 ms).
- **Zoom buttons.** Magnifier buttons with + and − in the headers of both plots:
  Time and Amplitude on the waveform, Time and Frequency on the spectrogram. Each
  plot also has a reset button (↺) that shows everything. The amplitude zoom of the
  waveform is new.
- **Waveform at full scale (0 dBFS)** checkbox: fixes the height of the trace at full
  scale, so Vanish or Normalize visibly change it.
- **Spectral resolution on the fly.** **Right Ctrl + Right Shift + ↑ / ↓** steps the
  FFT size up (finer frequency resolution) or down (finer time resolution) and redraws
  the spectrogram. The log shows the new FFT size and the Hz per bin.

## Preferences

- **Keyboard shortcuts…** lists the actions that have a shortcut: spectral
  resolution up and down, play / pause, the Select, Annotate and Pan tools, and zoom
  in and out for time, frequency and amplitude (no key by default). Click one, press
  the new combination, done. Left and right Ctrl, Shift and Alt are told apart.
  Giving a combination that is already used moves it to the new action. Clear,
  Default and *Reset all to defaults* are available, and the choices are kept on this
  computer.
- The new buttons, labels and dialog are translated into Spanish, Italian and
  Portuguese.

## Temporal Analysis

- **Local floor pane.** The local noise floor moved out of the Amplitude Detector into
  its own pane, and both detectors can use it.
  - **Threshold (%)** is now a single setting for both detectors, in this pane. It
    replaces *Floor %* (Amplitude Detector), *Detection thr. (%)* and
    *Envelope peak threshold (%)* (peak detection). Peak prominence uses the same
    value. Default **2.5 %**.
  - The floor is computed automatically when audio is selected, and rebuilt when the
    envelope or the **Floor win. (ms)** (default **10 ms**) changes. The
    **Detect local minima** button and the ✕ were removed.
  - **Use in Amplitude Detector** and **Use in Peak Detection**, both ticked by
    default. With a box ticked, that detector's threshold is an offset above the
    floor curve instead of a fixed level. Untick it to go back to a fixed level.
  - **Auto** (noise-based threshold) is now off by default, and it is not used while
    the floor is applied to peak detection.
- **Peak Detection pane** (was *Envelope peak Detection*). *Smooth* now defaults to
  **2 ms**, and *Envelope peak window* was renamed **Peak Detection Window (ms)**,
  default **3 ms**.
- **Grouping:** *Max envelope peak gap* defaults to **15 ms**.
- **Amplitude Detector:** *Min gap* defaults to **10 ms**.
- **Fitting to hand-corrected peaks** (*Fit to selection* with *incl. envelope peak
  detection*) now searches the shared threshold only.
- **Presets.** The preset fields changed: saved presets still load, but their old
  *Floor %*, *Detection thr.* and *Envelope peak threshold* values are no longer
  used, and one saved with "Use in Peak Detection" unticked loads it unticked. The
  built-in Acrididae preset is unchanged.

## Summary Analysis

- **Do the species differ? (PERMANOVA).** A global test on the same data as the PCA
  (pseudo-F, R², permuted p), a dispersion check (PERMDISP) so that differences in
  spread are not mistaken for differences in position, and every pair of species with
  Holm-corrected p. By default the recordings of one specimen are shuffled together.
  The number of permutations is 999, 9999 or 49999, and a fixed seed makes the p-values
  reproducible.
- **Clustering (k-means, DBSCAN, hierarchical).** Groups the observations without
  using the species names, with silhouette widths for k = 2–8, a k-distance plot to
  suggest DBSCAN's eps, Ward / average / complete / single linkage with a dendrogram,
  and a clusters × species table with the adjusted Rand index. It describes the data;
  it is not a test.
- **Point labels.** Choose what the labels on the PCA points show: name, species,
  specimen, country, locality, date and temperature, in any combination.
- **Temperature adjustment** now applies only to the variables that are temperature
  dependent in orthopterans: pulse, motif and echeme duration, gap, period and rate,
  duty cycle and peak frequency. Counts, levels, entropy and complexity indices are
  left alone.
- **N behind each mean.** The Compare table shows the number of specimens and rows
  behind every mean, and its Excel export has `n recordings`, `n specimens` and
  `n rows` columns.

## 📖 Documentation

Read the [User Manual (PDF)](https://github.com/panchorivasf/Rthoptera-Desk/blob/main/Rthoptera_Desk_User_Manual_v0.9.1.pdf).
It is also attached to this release as `Rthoptera_Desk_User_Manual_v0.9.1.pdf`.

## 📥 Which file do I download?

Pick the file that matches your operating system and processor.

### Windows

| File                                 | Use                                                     |
| ------------------------------------ | ------------------------------------------------------- |
| `Rthoptera.Desk_0.9.1_x64-setup.exe` | **Recommended** — standard installer, just double-click |
| `Rthoptera.Desk_0.9.1_x64_en-US.msi` | Alternative for managed/enterprise deployment           |

### macOS

| File                               | Use                         |
| ---------------------------------- | --------------------------- |
| `Rthoptera.Desk_0.9.1_aarch64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `Rthoptera.Desk_0.9.1_x64.dmg`     | Intel Macs                  |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. "Apple M…"
means Apple Silicon; "Intel" means the x64 build.

### Linux (x86_64)

| File                                  | Use                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- |
| `Rthoptera.Desk_0.9.1_amd64.AppImage` | **Recommended** — works on most distros. Run `chmod +x` then launch |
| `Rthoptera.Desk_0.9.1_amd64.deb`      | Debian, Ubuntu, Mint, etc.                                          |
| `Rthoptera.Desk-0.9.1-1.x86_64.rpm`   | Fedora, RHEL, openSUSE, etc.                                        |

> **Note:** Builds are currently 64-bit Intel/AMD (x86_64) for Windows and
> Linux, plus both Intel and Apple Silicon for macOS. ARM Linux and
> Windows-on-ARM are not yet supported.

_(The `*.app.tar.gz` files are used by the auto-updater and are not meant for
manual installation.)_
