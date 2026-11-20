# Rthoptera Desk 0.9.5

Metadata from the field, two ways: speak it into the recording, or import the records
saved by the new Rthoptera Field phone app. The manual has been revised throughout.

## Voice Notes Protocol: metadata from spoken notes

- **Read as metadata…** is a new button in the Voice notes pane. Say the metadata at the
  start of a recording, each field as a label followed by its value (date, time,
  latitude, longitude, elevation, temperature, country, locality, recorder, microphone,
  accessories, specimen, species), then transcribe it. The notes are read into a review
  table where you can correct any value before it is applied to the Recording metadata
  form, to the active recording, the checked recordings or all of them. Labels work in
  English and Spanish. Numbers are said one digit at a time, with *minus* and *point*.
- **Place and elevation from the coordinates.** When coordinates are read, the country,
  locality and elevation that were not spoken are looked up from them (OpenStreetMap or
  BigDataCloud for the place, Open-Meteo or OpenTopoData for the elevation). Only the
  coordinates are sent, and the lookup can be switched off.
- **Check on map…** shows the point on a street or satellite map. Click to move it: the
  coordinates, elevation and place update together.

## Import Field records

- **📱 Import Field records…** in Recording metadata reads the records saved by the
  Rthoptera Field iPhone app (the `.zip` it shares, or the `.json`, several at once). It
  shows the satellite picture and plays the voice note, can open a sound recorded in the
  phone, and writes the site metadata into the matching recordings.
- **Each recording is paired with the nearest mark in time.** In the app's *Metadata
  Only* mode a single tap saves a mark: the instant, the place and the conditions. Desk
  pairs every loaded recording with the mark inside it, or the closest one within the
  tolerance (2 min to 3 h, 15 min by default). Records from *Record with Phone* carry the
  real start and end of the recording.
- **The time of a recording** is read from its AudioMoth or WAV header, from a date and
  time in its file name, or from its file date. You choose the source, or leave it on
  automatic. The clock difference between the recorder and the phone is corrected, and
  an extra clock shift handles a difference found later.

## Other changes

- The buttons at the bottom of the Recording metadata window wrap onto a second line
  instead of leaving the window, and the Xeno-canto button is shortened.
- A recording saved with **Save Edited Audio As…** keeps the time information of its
  source.
- The **User Manual** covers the new features (sections 5.4 and 6.6), lists what changed
  in each recent version, and has been revised in wording throughout.

---

## 📖 Documentation

Read the [User Manual (PDF)](https://github.com/panchorivasf/Rthoptera-Desk/blob/main/Rthoptera_Desk_User_Manual_v0.9.5.pdf).
It is also attached to this release as `Rthoptera_Desk_User_Manual_v0.9.5.pdf`.

## 📥 Which file do I download?

Pick the file that matches your operating system and processor.

### Windows

| File                                 | Use                                                     |
| ------------------------------------ | ------------------------------------------------------- |
| `Rthoptera.Desk_0.9.5_x64-setup.exe` | **Recommended** — standard installer, just double-click |
| `Rthoptera.Desk_0.9.5_x64_en-US.msi` | Alternative for managed/enterprise deployment           |

### macOS

| File                               | Use                         |
| ---------------------------------- | --------------------------- |
| `Rthoptera.Desk_0.9.5_aarch64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `Rthoptera.Desk_0.9.5_x64.dmg`     | Intel Macs                  |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. "Apple M…"
means Apple Silicon; "Intel" means the x64 build.

### Linux (x86_64)

| File                                  | Use                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- |
| `Rthoptera.Desk_0.9.5_amd64.AppImage` | **Recommended** — works on most distros. Run `chmod +x` then launch |
| `Rthoptera.Desk_0.9.5_amd64.deb`      | Debian, Ubuntu, Mint, etc.                                          |
| `Rthoptera.Desk-0.9.5-1.x86_64.rpm`   | Fedora, RHEL, openSUSE, etc.                                        |

> **Note:** Builds are currently 64-bit Intel/AMD (x86_64) for Windows and
> Linux, plus both Intel and Apple Silicon for macOS. ARM Linux and
> Windows-on-ARM are not yet supported.

_(The `*.app.tar.gz` files are used by the auto-updater and are not meant for
manual installation.)_
