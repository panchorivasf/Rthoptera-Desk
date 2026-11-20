# Rthoptera Desk 0.9.4

Voice notes: find the stretches of the recording where someone speaks, transcribe
them, and cut them out or replace them with background noise.

## Voice notes (Preprocessing)

- **A new Voice notes pane** below Edit Audio. **Detect voice** scans the whole
  recording and marks the stretches of human voice in purple on the waveform. They are
  listed with their start and end, length and confidence. Click a time to select that
  stretch on the waveform, press the small play button on a row to listen to it alone,
  or remove a stretch from the list with the cross. **Sensitivity** (high, normal, low)
  and **min.** (the shortest stretch to report, 0.25 s by default) set how readily
  voices are accepted. Detection uses the Silero VAD model, which is bundled with the
  program, so it works offline.
- **Transcribe** writes out what is said in the stretches found (it is available once
  voice has been detected). It uses OpenAI's Whisper, run on your computer. Choose the
  **language** when you know it: automatic detection can be wrong for short notes. The
  text of each stretch can be edited, and the arrow beside a stretch transcribes just
  that one again. When the language, model, sensitivity or minimum length has changed
  since the last run, Transcribe starts again from scratch (detecting again if needed)
  and asks before it replaces text you edited.
- **Transcription model.** The Whisper model is not part of the installer. The
  **Transcription model** section downloads **tiny** (about 42 MB), **base** (about
  75 MB) or **small** (about 250 MB) once, from huggingface.co, and keeps it for later
  sessions. **Load from files…** uses files you already have (the encoder and merged
  decoder `.onnx` and `tokenizer.json`, chosen together). **Remove** deletes the stored
  model. After the download no internet is needed.
- **Vanish voice** replaces every listed stretch with background noise matched to the
  recording (length and timing stay), and **Delete voice** cuts them out. Each stretch
  is its own step in Undo. **Export .txt** and **Export .csv** save the times and
  transcripts.

## Fixes

- **Space in text boxes.** Pressing Space while typing in a multi-line text box (the
  transcripts, for example) started or stopped playback. It now types a space.

---

## 📖 Documentation

Read the [User Manual (PDF)](https://github.com/panchorivasf/Rthoptera-Desk/blob/main/Rthoptera_Desk_User_Manual_v0.9.4.pdf).
It is also attached to this release as `Rthoptera_Desk_User_Manual_v0.9.4.pdf`.

## 📥 Which file do I download?

Pick the file that matches your operating system and processor.

### Windows

| File                                 | Use                                                     |
| ------------------------------------ | ------------------------------------------------------- |
| `Rthoptera.Desk_0.9.4_x64-setup.exe` | **Recommended** — standard installer, just double-click |
| `Rthoptera.Desk_0.9.4_x64_en-US.msi` | Alternative for managed/enterprise deployment           |

### macOS

| File                               | Use                         |
| ---------------------------------- | --------------------------- |
| `Rthoptera.Desk_0.9.4_aarch64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `Rthoptera.Desk_0.9.4_x64.dmg`     | Intel Macs                  |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. "Apple M…"
means Apple Silicon; "Intel" means the x64 build.

### Linux (x86_64)

| File                                  | Use                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- |
| `Rthoptera.Desk_0.9.4_amd64.AppImage` | **Recommended** — works on most distros. Run `chmod +x` then launch |
| `Rthoptera.Desk_0.9.4_amd64.deb`      | Debian, Ubuntu, Mint, etc.                                          |
| `Rthoptera.Desk-0.9.4-1.x86_64.rpm`   | Fedora, RHEL, openSUSE, etc.                                        |

> **Note:** Builds are currently 64-bit Intel/AMD (x86_64) for Windows and
> Linux, plus both Intel and Apple Silicon for macOS. ARM Linux and
> Windows-on-ARM are not yet supported.

_(The `*.app.tar.gz` files are used by the auto-updater and are not meant for
manual installation.)_
