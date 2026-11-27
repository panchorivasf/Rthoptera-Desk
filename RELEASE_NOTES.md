# Rthoptera Desk 0.9.6

Compare the spectra of labelled sounds across recordings: the Multi-Mean Spectra tab can now
build one mean spectrum for each label, pooled from selection tables, with a viewer for
labelling the selections and colour-blind-safe palettes for the figure.

## Multi-Mean Spectra: label classes from selection tables

- **A new mode**, chosen from the **Mode** menu at the top of the tab, draws one mean spectrum
  for each label class. For example, compare the opening and closing strokes, or the calling
  and courtship songs, across several males. The brushing mode keeps working, with the
  improvements below.
- **Import tables…** reads one or several selection tables at once: Raven `.txt`, CSV/TSV, or
  Excel `.xlsx` (every sheet with begin and end columns, so the Pulse and Motif sheets of a
  Temporal Analysis export load directly). Each row is tied to a loaded recording by the
  table's **Begin File** column or by the table's file name, and a drop-down chooses another
  recording. Tables may come from different recordings, even at different sampling rates.
- **Decide which tables to use.** Each table can be switched on or off. A table whose
  selections each enclose several selections of another table (motifs over syllables,
  echemes over pulses) is marked as a grouping level, and selections repeated between tables
  are pointed out, so the same sound is not counted twice.
- **Label the selections** from a column of the tables, by typing in the list, or for many
  picked rows at once. Classes can be hidden, renamed or merged.
- **How a class spectrum is made:** each selection's mean spectrum is normalised to 1, the
  spectra are averaged frequency by frequency, and the result is normalised again. An
  optional ±1 SD band shows the spread. Classes are drawn as lines (the default) or as
  filled areas.

## A selection viewer for labelling

- Above the spectra, the **waveform or envelope** of the recording, with every selection on a
  label track under it, in its class colour. Each table has its own rows; overlapping
  selections get rows of their own. Hover over a bar to see its label, table and times.
- **Zoom in time** by dragging across a stretch, with the wheel or with **+**/**−**;
  **⤢ Selection** zooms to the current selection and **Fit** shows the whole recording.
- **Label from the keyboard:** `←`/`→` step through the selections, `Space` plays one, and
  `1`–`9` give it the label of that class and move on to the next.

## Figure and exports

- **Waveform above the spectra** puts the stretch shown in the viewer, coloured by class,
  above the spectra in the figure and its PNG/SVG export.
- **Colour-blind-safe palettes** for the class colours: Okabe–Ito (the default), Paul Tol's
  Bright, Vibrant and Muted, and viridis. Every colour is shown with its name and hex code,
  so a figure can be described and reproduced exactly. **Apply to all classes** recolours
  the whole figure with one palette.
- **Download spectra (CSV)** gives, for each class, the mean, the SD and the number of
  selections at each frequency. **Download labelled table** saves all the selections with
  their labels as one Raven table, which can be imported again to continue later.

## Multi-Mean Spectra: brushed stretches of one wave

- **Zoom in time** on the oscillogram: the wheel zooms around the pointer, the new **Time
  zoom** buttons (**+**, **−**, **⤢ Sel**, **Fit**) do the same from the panel, and
  `Shift`+wheel or Alt-drag pans. Double-click shows the whole wave again. Brushing works at
  any zoom, so short strokes can be picked precisely.
- **One colour per label.** Selections with the same label share a colour, and their spectra
  are pooled into one: the mean of the selections' spectra. The legend shows how many were
  pooled, e.g. *opening (n=3)*, and the CSV has one column per label.
- **Rename a selection** by clicking its label in the list. It takes the colour of its new
  label and is pooled with it.

## Other changes

- The **plot title** of Multi-Mean Spectra accepts Markdown, so a scientific name can be set
  in italics: `*Chorthippus tatrae*, male 3`. `**bold**` works too.

- The **User Manual** describes the new mode and the brushing changes (section 10.6). Sections 10.5 (Habitus) and 10.6
  (Multi-Mean Spectra) described each other's tab; they are now correct.

---

## 📖 Documentation

Read the [User Manual (PDF)](https://github.com/panchorivasf/Rthoptera-Desk/blob/main/Rthoptera_Desk_User_Manual_v0.9.6.pdf).
It is also attached to this release as `Rthoptera_Desk_User_Manual_v0.9.6.pdf`.

## 📥 Which file do I download?

Pick the file that matches your operating system and processor.

### Windows

| File                                 | Use                                                     |
| ------------------------------------ | ------------------------------------------------------- |
| `Rthoptera.Desk_0.9.6_x64-setup.exe` | **Recommended** — standard installer, just double-click |
| `Rthoptera.Desk_0.9.6_x64_en-US.msi` | Alternative for managed/enterprise deployment           |

### macOS

| File                               | Use                         |
| ---------------------------------- | --------------------------- |
| `Rthoptera.Desk_0.9.6_aarch64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `Rthoptera.Desk_0.9.6_x64.dmg`     | Intel Macs                  |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. "Apple M…"
means Apple Silicon; "Intel" means the x64 build.

### Linux (x86_64)

| File                                  | Use                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- |
| `Rthoptera.Desk_0.9.6_amd64.AppImage` | **Recommended** — works on most distros. Run `chmod +x` then launch |
| `Rthoptera.Desk_0.9.6_amd64.deb`      | Debian, Ubuntu, Mint, etc.                                          |
| `Rthoptera.Desk-0.9.6-1.x86_64.rpm`   | Fedora, RHEL, openSUSE, etc.                                        |

> **Note:** Builds are currently 64-bit Intel/AMD (x86_64) for Windows and
> Linux, plus both Intel and Apple Silicon for macOS. ARM Linux and
> Windows-on-ARM are not yet supported.

_(The `*.app.tar.gz` files are used by the auto-updater and are not meant for
manual installation.)_
