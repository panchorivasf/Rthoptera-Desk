// ═══════════════════════════════════════════════════════════════════
      // STATE
      // ═══════════════════════════════════════════════════════════════════
      const $ = (id) => document.getElementById(id);
      let rawSamples = null,
        sampleRate = 1,
        duration = 0,
        peakAmp = 1;
      let audioBuffer = null,
        audioCtx = null,
        sourceNode = null;
      // ── Non-destructive editing ─────────────────────────────────────────
      // origSamples/origSampleRate hold the pristine decoded mono signal. All
      // edits are stored as an ordered chain and re-applied from the original,
      // so they compose predictably and any one can be cleared without
      // re-importing. audioEdits entries: {type:"trim", t0, t1} (seconds, on the
      // ORIGINAL timeline) or {type:"bandpass", hp, lp} (Hz).
      let origSamples = null,
        origSampleRate = 1;
      let audioEdits = [];
      let envelope = null,
        zcrArr = null,
        specCentroid = null;
      let spectrogramData = null;
      let annotations = [],
        nextAid = 1,
        selAid = null;
      let detections = [],
        detMeasurements = [];
      let viewStart = 0,
        viewDur = 10;
      let fvMin = 0,
        fvMax = 0;
      let specContrast = 60,
        specBright = 0;
      let playPos = 0,
        isPlaying = false,
        playT0 = 0,
        playOff = 0,
        raf = null;
      // Rate the CURRENT playback was started at. Captured per start rather
      // than read live, so changing the speed box mid-playback cannot
      // corrupt the elapsed-time arithmetic (see onPlaySpeedChange).
      let playRate = 1;
      // Playback-only frequency drop (see refreshPlaybackDropBuffer). Declared
      // up here with the rest of the playback state because
      // rebuildAudioFromEdits invalidates it, and that runs well before the
      // playback section is reached on first evaluation.
      let _pbBuffer = null; // AudioBuffer with the drop baked in, or null
      let _pbDropPct = 0; // the percentage currently baked into _pbBuffer
      // Annotate is the default tool: drawing selections is the main job of
      // the Spectral Analysis tab, so it is ready without a first click.
      let activeTool = "annotate";
      // Which tab the shared waveform/spectrogram viewer is parked in. The
      // subtree is the same either way (one set of canvas IDs, one render
      // pipeline — see _placeSharedViewer), but its BEHAVIOUR is not: in
      // "preprocess" the viewer is a plain transport — annotations and
      // detections are neither drawn nor hit-tested, and a click only moves
      // the playhead. Trim handles are unaffected; they are Preprocessing's
      // own selection and are handled before any of this.
      let viewerMode = "analyzer"; // "analyzer" | "preprocess"
      // Preprocessing's own time selection: {t0, t1} in seconds, or null.
      // Distinct from the trim selection — this one costs nothing to make
      // (no mode to enter), marks a stretch of time to look at or jump
      // around, and never edits the audio. A plain click clears it.
      let ppSel = null;
      let ppDrag = null; // {anchor, startX, moved} while dragging one out
      let drawing = null;
      // Visual trim: when trimMode is on, two draggable handles (trimSel.t0/t1,
      // in seconds on the ORIGINAL timeline) define the region to KEEP. Nothing
      // is cut until the user confirms.
      let trimMode = false;
      let trimSel = { t0: 0, t1: 0 };
      // "t0" | "t1" (resizing a handle) | "move" (dragging the whole kept
      // region) | "new" (dragging out a brand-new selection from empty
      // space) | null.
      let trimDrag = null;
      let trimHadPrior = false; // a trim already existed when entering trim mode
      // "move" drag: selection + duration at mousedown, so the region
      // translates by exactly the mouse delta instead of drifting.
      let trimMoveStartT = 0;
      let trimMoveStartT0 = 0;
      let trimMoveStartT1 = 0;
      // "new" drag: the anchor point the selection is being dragged out
      // from, the pre-drag selection (restored if it turns out to be just a
      // click, not a real drag), and enough to tell the two apart.
      let trimNewAnchor = 0;
      let trimPreDragSel = { t0: 0, t1: 0 };
      let trimDidDragNew = false;
      let trimDragStartX = 0;
      // Per base-filename counter for "Save active selection" (_1, _2, …) —
      // resets only on a full page reload, so repeated saves in one session
      // never repeat a suffix even across multiple trim-mode visits.
      let trimSaveCounters = {};
      // Pan state
      let panState = null; // {startX, startViewStart} for hand tool

      // ═══════════════════════════════════════════════════════════════════
      // LOGGING
      // ═══════════════════════════════════════════════════════════════════
      function log(msg, cls = "") {
        const el = $("log");
        const line =
          "[" +
          new Date().toLocaleTimeString("en-US", { hour12: false }) +
          "] " +
          msg;
        // Fall back to the console if the on-screen log panel isn't present, so a
        // missing element can never break the rest of the app.
        if (!el) {
          console.log(line);
          return;
        }
        const p = document.createElement("p");
        if (cls) p.className = cls;
        p.textContent = line;
        el.appendChild(p);
        el.scrollTop = el.scrollHeight;
      }

      // ═══════════════════════════════════════════════════════════════════
      // BUSY OVERLAY
      // ═══════════════════════════════════════════════════════════════════
      // Everything here runs on the UI thread, so a long job freezes the
      // window and the app looks hung. The overlay says otherwise and, just as
      // importantly, swallows the clicks that get aimed at a frozen window.
      //
      // Call `frac` with a number to show real progress, or omit it to leave
      // the bar sweeping when there is no measurable fraction to report.
      function busySet(label, frac) {
        const l = $("busyLabel");
        if (l && label != null) l.textContent = label;
        const track = $("busyTrack"),
          bar = $("busyBar");
        if (!track || !bar) return;
        if (frac == null) {
          track.classList.add("indet");
          bar.style.width = "";
        } else {
          track.classList.remove("indet");
          bar.style.width = Math.max(0, Math.min(1, frac)) * 100 + "%";
        }
      }

      // One requestAnimationFrame only schedules the next frame; the work
      // would start before it is painted. The second resolves after the paint
      // has actually happened, so the overlay is on screen before we block.
      function busyPaint() {
        return new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
      }

      // Yield inside a loop so an in-progress bar can repaint. A single frame
      // is enough here — the overlay is already up.
      function busyTick() {
        return new Promise((r) => requestAnimationFrame(r));
      }

      let _busyDepth = 0;
      async function withBusy(label, fn) {
        _busyDepth++;
        const ov = $("busyOverlay");
        if (ov) ov.classList.add("show");
        busySet(label, null);
        await busyPaint();
        try {
          return await fn(busySet);
        } finally {
          // Nested calls must not tear the overlay down early.
          if (--_busyDepth <= 0) {
            _busyDepth = 0;
            if (ov) ov.classList.remove("show");
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // PANEL VISIBILITY + RESIZE
      // ═══════════════════════════════════════════════════════════════════
      function setWaveHeight(h) {
        h = parseInt(h);
        $("wWrap").style.height = h + "px";
        $("waveHeightLbl").textContent = h + "px";
        render();
      }
      function setSpecHeight(h) {
        h = parseInt(h);
        $("sWrap").style.height = h + "px";
        $("freqAxisWrap").style.height = h + "px";
        $("specHeightLbl").textContent = h + "px";
        render();
      }
      function onPanelVis() {
        const showW = $("showWave").checked;
        const showS = $("showSpec").checked;
        $("wavePanel").style.display = showW ? "flex" : "none";
        $("dragWS").style.display = showW && showS ? "block" : "none";
        $("specPanel").style.display = showS ? "flex" : "none";
        render();
      }

      // Drag-to-resize handles
      function initDragHandles() {
        setupDrag("dragWS", "wave");
        setupDrag("dragSB", "spec");
      }
      function setupDrag(handleId, target) {
        const handle = $(handleId);
        let startY, startH;
        handle.addEventListener("mousedown", (e) => {
          e.preventDefault();
          startY = e.clientY;
          if (target === "wave") startH = $("wWrap").clientHeight;
          else startH = $("sWrap").clientHeight;
          document.body.style.cursor = "ns-resize";
          const onMove = (ev) => {
            const dy = ev.clientY - startY;
            const newH = Math.max(30, startH + dy);
            if (target === "wave") {
              $("wWrap").style.height = newH + "px";
              $("waveHeightSlider").value = Math.min(300, Math.max(40, newH));
              $("waveHeightLbl").textContent = newH + "px";
            } else {
              $("sWrap").style.height = newH + "px";
              $("freqAxisWrap").style.height = newH + "px";
              $("specHeightSlider").value = Math.min(500, Math.max(60, newH));
              $("specHeightLbl").textContent = newH + "px";
            }
            render();
          };
          const onUp = () => {
            document.body.style.cursor = "";
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
      }

      // ═══════════════════════════════════════════════════════════════════
      // AUDIO LOADING
      // ═══════════════════════════════════════════════════════════════════
      let currentAudioFileName = "";
      // Manually-entered specimen tag for the active recording — carried
      // into every exported table (Peaks/Trains/Motifs/Spectral) as their
      // first column, and used by Summarize to count individuals correctly
      // instead of guessing from file names.
      let currentSpecimenId = "";
      function setCurrentSpecimenId(v) {
        currentSpecimenId = v;
        const entry = audioLibrary.find((e) => e.id === audioLibActiveId);
        if (entry) entry.specimenId = v;
      }
      // Same idea as Specimen ID: manually tagged per recording, carried
      // into every exported table right after Specimen ID.
      let currentSpecies = "";
      function setCurrentSpecies(v) {
        currentSpecies = v;
        const entry = audioLibrary.find((e) => e.id === audioLibActiveId);
        if (entry) entry.species = v;
      }
      // Country sits above locality in the geographic hierarchy, so it is
      // ordered before it everywhere: the toolbar, the metadata file and the
      // export columns.
      let currentCountry = "";
      // Fallback only. In the packaged app the version is read from Tauri,
      // which takes it from tauri.conf.json — so the number on screen is the
      // one the installer was actually built with and cannot drift from it.
      // This literal is what a plain browser (no Tauri) shows instead, and is
      // the one place in src/ that has to be bumped alongside the three build
      // files.
      const APP_VERSION_FALLBACK = "0.2.0";

      async function showAppVersion() {
        const el = $("appVersion");
        if (!el) return;
        let v = APP_VERSION_FALLBACK;
        try {
          if (window.__TAURI__?.app?.getVersion)
            v = await window.__TAURI__.app.getVersion();
        } catch (e) {
          // Permission or API missing — the fallback is still correct enough
          // to identify the build, so this is not worth surfacing.
        }
        el.textContent = "v" + v;
        el.title = "Rthoptera Desk version " + v;
      }

      function setCurrentCountry(v) {
        currentCountry = v;
        const entry = audioLibrary.find((e) => e.id === audioLibActiveId);
        if (entry) entry.country = v;
      }
      let currentLocality = "";
      function setCurrentLocality(v) {
        currentLocality = v;
        const entry = audioLibrary.find((e) => e.id === audioLibActiveId);
        if (entry) entry.locality = v;
      }
      // Air temperature at the time of recording. Free text rather than a
      // number input: stridulation rate is strongly temperature-dependent, so
      // this has to survive being written as "22.5", "~23" or left blank, and
      // it is exported verbatim for the analyst to interpret.
      let currentTempC = "";
      function setCurrentTempC(v) {
        currentTempC = v;
        const entry = audioLibrary.find((e) => e.id === audioLibActiveId);
        if (entry) entry.tempC = v;
      }

      // Save/load Specimen ID + Species + Locality as a standalone .json —
      // meant to live alongside a folder of recordings from the same
      // specimen, so it's typed once and reloaded for every other file
      // instead of retyped per recording.
      function saveRecordingMetadata() {
        if (!audioLibActiveId) {
          log("Load audio first.", "warn");
          return;
        }
        // Deliberately no source_file: this file is written once and loaded
        // onto every other recording of the same specimen, so naming one
        // recording inside it would be a lie for all the others.
        const meta = {
          specimen_id: currentSpecimenId,
          species: currentSpecies,
          country: currentCountry,
          locality: currentLocality,
        };
        try {
          dlFile(
            "specimen_metadata.json",
            JSON.stringify(meta, null, 2),
            "application/json",
          );
          log("Saved specimen metadata.", "ok");
        } catch (e) {
          log("Metadata export failed: " + e.message, "err");
        }
      }

      async function loadRecordingMetadata(file) {
        if (!file) return;
        if (!audioLibActiveId) {
          log("Load audio first.", "warn");
          return;
        }
        try {
          const text = await file.text();
          const meta = JSON.parse(text);
          const spec = String(meta.specimen_id ?? meta.specimenId ?? "");
          const sp = String(meta.species ?? "");
          const cty = String(meta.country ?? "");
          const loc = String(meta.locality ?? "");
          setCurrentSpecimenId(spec);
          setCurrentSpecies(sp);
          setCurrentCountry(cty);
          setCurrentLocality(loc);
          const specInput = $("specimenIdInput");
          if (specInput) specInput.value = spec;
          const speciesInput = $("speciesInput");
          if (speciesInput) speciesInput.value = sp;
          const localityInput = $("localityInput");
          if (localityInput) localityInput.value = loc;
          const countryInput = $("countryInput");
          if (countryInput) countryInput.value = cty;
          log('Loaded specimen metadata from "' + file.name + '".', "ok");
        } catch (e) {
          log("Could not read metadata file: " + e.message, "err");
        }
      }
      let currentAudioFileFolder = "";
      // Folder the most recent import came from — the default destination
      // batch-saving offers, so re-exporting after an edit round-trip
      // doesn't make you hunt for the folder again.
      let lastImportFolder = "";

      function getFolderFromPath(path) {
        if (!path) return "";
        const sep = path.lastIndexOf("\\") >= 0 ? "\\" : "/";
        const idx = path.lastIndexOf(sep);
        return idx >= 0 ? path.slice(0, idx) : "";
      }
      function getFilenameFromPath(path) {
        if (!path) return "";
        const sep = path.lastIndexOf("\\") >= 0 ? "\\" : "/";
        const idx = path.lastIndexOf(sep);
        return idx >= 0 ? path.slice(idx + 1) : path;
      }

      // decodeAudioData silently resamples to the AudioContext's own sample
      // rate (usually the OS output device default) unless the context is
      // created at the file's native rate — otherwise a 96kHz recording
      // quietly becomes 48kHz and its real Nyquist gets cut in half. Every
      // import (single or multi-file) goes through this one function so the
      // fix, and the mono-mixdown, only ever happen in one place.
      async function decodeAudioFileNative(file) {
        return decodeAudioBytes(await file.arrayBuffer());
      }
      // Same decode, taking raw bytes directly — used by the native Tauri
      // file-open path (see openAudioFilesNative), which reads bytes via
      // fs.readFile instead of a browser File object.
      async function decodeAudioBytes(ab) {
        let nativeSr = 0;
        try {
          nativeSr = readWavSampleRate(ab);
        } catch (ex) {}
        let tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
        let decoded;
        try {
          decoded = await tmpCtx.decodeAudioData(ab.slice(0));
        } finally {
          tmpCtx.close();
        }
        const detectedSr = nativeSr || decoded.sampleRate;
        if (detectedSr === decoded.sampleRate || detectedSr <= 0) return decoded;
        try {
          const tmpCtx2 = new (
            window.AudioContext || window.webkitAudioContext
          )({ sampleRate: detectedSr });
          try {
            const finalBuf = await tmpCtx2.decodeAudioData(ab.slice(0));
            tmpCtx2.close();
            return finalBuf;
          } catch (ex) {
            tmpCtx2.close();
            return decoded;
          }
        } catch (ex) {
          return decoded;
        }
      }

      // Shared tail of every import path (native Tauri dialog OR the HTML
      // file-input fallback): decode → mono-mix → add to the library. Every
      // pane (Analyzer, Peaks, Multiplot, Osc. Stack/Zoom, Habitus) reads
      // from the shared `audioLibrary`, so this is the single place new
      // recordings enter it.
      async function _ingestDecodedAudio(displayName, folder, decoded) {
        const len = decoded.length,
          nch = decoded.numberOfChannels;
        const mono = new Float32Array(len);
        for (let c = 0; c < nch; c++) {
          const ch = decoded.getChannelData(c);
          for (let i = 0; i < len; i++) mono[i] += ch[i];
        }
        if (nch > 1) for (let i = 0; i < len; i++) mono[i] /= nch;

        if (folder) lastImportFolder = folder;
        const entry = addAudioToLibrary(displayName, folder, mono, decoded.sampleRate);
        log(
          'Decoded "' + displayName + '": ' +
            len.toLocaleString() + " samples @ " + decoded.sampleRate +
            " Hz, Nyquist=" + fmtHz(decoded.sampleRate / 2),
          "ok",
        );
        return entry;
      }

      // Preferred import path on desktop: Tauri's native Rust-side file
      // dialog + fs read. This is the fix for Windows occasionally handing
      // back an 8.3 short alias (e.g. "POLYCL~2.WAV") for the real file
      // name — that corruption comes from the WEBVIEW's own HTML file-input
      // machinery (a Chromium/WebView2 quirk with certain long/complex
      // names), which the native dialog never goes through at all: its
      // path comes straight from the OS, so the name is always correct.
      async function openAudioFilesNative() {
        // Falling back to the HTML file input is precisely what reintroduces
        // the 8.3 short-name corruption this function exists to avoid, so it
        // must never happen quietly — name the API that's missing, because
        // "the file is called POLYCL~2.WAV" looks like an app bug rather
        // than a skipped code path unless the log says otherwise.
        let missingApi = "";
        if (!window.__TAURI__) missingApi = "window.__TAURI__";
        else if (
          !window.__TAURI__.dialog ||
          typeof window.__TAURI__.dialog.open !== "function"
        )
          missingApi = "dialog.open";
        else if (
          !window.__TAURI__.fs ||
          typeof window.__TAURI__.fs.readFile !== "function"
        )
          missingApi = "fs.readFile";
        if (missingApi) {
          log(
            "Native file dialog unavailable (" +
              missingApi +
              " missing) — using the browser file picker instead, which can " +
              "report long names as 8.3 short aliases (e.g. POLYCL~2.WAV).",
            "warn",
          );
          return false; // caller falls back to the HTML file input
        }
        let selected;
        try {
          selected = await window.__TAURI__.dialog.open({
            multiple: true,
            filters: [
              {
                name: "Audio",
                extensions: ["wav", "mp3", "flac", "ogg", "aiff", "aif"],
              },
            ],
          });
        } catch (e) {
          log(
            "Native file dialog failed (" +
              e.message +
              ") — using the browser file picker instead, which can report " +
              "long names as 8.3 short aliases (e.g. POLYCL~2.WAV).",
            "warn",
          );
          return false;
        }
        if (!selected) return true; // user cancelled — handled, don't fall back
        const paths = Array.isArray(selected) ? selected : [selected];

        await withBusy("Loading audio…", async (progress) => {
          let firstEntry = null;
          for (let i = 0; i < paths.length; i++) {
            const path = paths[i];
            const displayName = getFilenameFromPath(path) || path;
            progress(
              paths.length > 1
                ? "Loading " + (i + 1) + "/" + paths.length + " — " + displayName
                : "Loading " + displayName + "…",
              i / paths.length,
            );
            await busyTick();
            log("Loading: " + displayName, "info");
            try {
              const bytes = await window.__TAURI__.fs.readFile(path);
              const ab = bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
              );
              const decoded = await decodeAudioBytes(ab);
              const entry = await _ingestDecodedAudio(
                displayName,
                getFolderFromPath(path),
                decoded,
              );
              if (!firstEntry) firstEntry = entry;
            } catch (err) {
              log(
                'Decode error ("' + displayName + '"): ' + err.message,
                "err",
              );
            }
          }
          if (firstEntry) {
            progress("Preparing views…", 1);
            await busyTick();
            selectLibraryAudio(firstEntry.id);
          }
        });
        return true;
      }

      // Wired to the toolbar's 📂 Audio button: try the native dialog first
      // (correct file names, see openAudioFilesNative), and only fall back
      // to the plain HTML file input outside Tauri (e.g. a browser build).
      async function pickAudioFiles() {
        const handled = await openAudioFilesNative();
        if (!handled) $("audioFile").click();
      }

      // Fallback import path (non-Tauri / browser). File.name here IS
      // trustworthy — the short-name quirk above is specific to Tauri's
      // desktop webview, not plain browser file inputs.
      $("audioFile").onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = "";
        if (!files.length) return;

        await withBusy("Loading audio…", async (progress) => {
          let firstEntry = null;
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const srcPath = f.path || f.webkitRelativePath || "";
            const displayName = getFilenameFromPath(srcPath) || f.name;
            progress(
              files.length > 1
                ? "Loading " + (i + 1) + "/" + files.length + " — " + displayName
                : "Loading " + displayName + "…",
              i / files.length,
            );
            await busyTick();
            log("Loading: " + displayName, "info");
            let decoded;
            try {
              decoded = await decodeAudioFileNative(f);
            } catch (err) {
              log(
                'Decode error ("' + displayName + '"): ' + err.message,
                "err",
              );
              continue;
            }
            const entry = await _ingestDecodedAudio(
              displayName,
              getFolderFromPath(srcPath),
              decoded,
            );
            if (!firstEntry) firstEntry = entry;
          }

          // Activate the first newly-imported file as the Analyzer's working
          // audio, exactly like selecting it from the Loaded Audio panel.
          if (firstEntry) {
            progress("Preparing views…", 1);
            await busyTick();
            selectLibraryAudio(firstEntry.id);
          }
        });
      };

      // Re-derive rawSamples, duration, audioBuffer, peakAmp from origSamples +
      // the ordered audioEdits chain, then refresh every downstream consumer.
      // Both the Temporal and Spectral panes read these globals live, so this is
      // the single choke-point that keeps them in sync after any edit.
      function rebuildAudioFromEdits(opts) {
        opts = opts || {};
        if (!origSamples) return;
        let sig = origSamples;
        let sr = origSampleRate;
        // Apply edits in order. Trim slices on the current timeline; bandpass
        // filters in place. Order matters and is preserved by the chain.
        for (const ed of audioEdits) {
          if (ed.type === "trim") {
            const i0 = Math.max(0, Math.floor(ed.t0 * sr));
            const i1 = Math.min(sig.length, Math.ceil(ed.t1 * sr));
            if (i1 > i0) sig = sig.slice(i0, i1);
          } else if (ed.type === "bandpass") {
            sig = applyBandpass(sig, sr, ed.hp, ed.lp);
          }
        }
        // Frequency drop runs last, whatever order the chain is in: it moves
        // every frequency, so applying it before the bandpass would leave the
        // HP/LP cutoffs pointing at the wrong part of the signal. Applied
        // last, the cutoffs still mean what the user typed against the
        // original audio.
        const fd = audioEdits.find((e) => e.type === "freqdrop");
        if (fd && fd.pct > 0) sig = applyFreqDrop(sig, fd.pct);

        rawSamples = sig instanceof Float32Array ? sig : Float32Array.from(sig);
        sampleRate = sr;
        duration = rawSamples.length / sr;
        peakAmp = 0;
        for (let i = 0; i < rawSamples.length; i++) {
          const v = Math.abs(rawSamples[i]);
          if (v > peakAmp) peakAmp = v;
        }
        if (!(peakAmp > 0)) peakAmp = 1;

        // Rebuild a playable AudioBuffer for the playback engine.
        try {
          if (!audioCtx)
            audioCtx = new (window.AudioContext ||
              window.webkitAudioContext)();
          const buf = audioCtx.createBuffer(1, rawSamples.length, sr);
          buf.copyToChannel(rawSamples, 0);
          audioBuffer = buf;
          // The dropped playback buffer was rendered from the PREVIOUS
          // samples; drop it and re-render if the setting is still on.
          _pbBuffer = null;
          _pbDropPct = 0;
          if (typeof refreshPlaybackDropBuffer === "function")
            refreshPlaybackDropBuffer();
        } catch (e) {
          // Playback buffer is non-critical; analysis still works without it.
          log("Could not rebuild playback buffer: " + e.message, "warn");
        }

        // ── Sidebar/info + dependent UI ──────────────────────────────────
        const nyq = sampleRate / 2;
        $("infoDur").textContent = duration.toFixed(3) + " s";
        $("infoSr").textContent = sampleRate.toLocaleString() + " Hz";
        $("infoNyq").textContent = fmtHz(nyq);
        $("plotT0").value = "0";
        $("plotT1").value = duration.toFixed(4);
        $("plotF0").value = "0";
        $("plotF1").value = Math.round(nyq);
        updateAutoWL();

        if (opts.resetView) {
          fvMin = 0;
          fvMax = nyq;
          $("fMinSlider").value = 0;
          $("fMaxSlider").value = 1000;
          $("fMinLbl").textContent = fmtHz(0);
          $("fMaxLbl").textContent = fmtHz(nyq);
          viewDur = Math.min(duration, 5);
          viewStart = 0;
          $("zoomSlider").value = 50;
        } else {
          // Keep the view in-bounds after a trim shortened the signal.
          viewDur = Math.min(viewDur, duration) || duration;
          viewStart = Math.max(0, Math.min(viewStart, duration - viewDur));
        }

        $("btnPlay").disabled = false;
        $("btnStop").disabled = false;
        $("btnPrevEdge").disabled = false;
        $("btnNextEdge").disabled = false;
        $("btnRaven").disabled = false;
        $("btnXlsxSel").disabled = false;
        $("btnPkDetect").disabled = false;
        if (typeof onMeasResChange === "function") onMeasResChange();
        $("statusBadge").textContent = "Loaded";
        $("statusBadge").className = "badge ok";
        if (typeof updateEditPanelState === "function") updateEditPanelState();

        // ── Downstream analysis recompute (same chain as initial load) ────
        computeEnvelope();
        computeZCR();
        computeSpectralCentroid();
        computeSpectrogram();
        onThresh();
        render();
        renderMinimap();

        // Temporal Analysis works on its own envelope, built at the smoothing
        // set in that pane. Build it here rather than inside Detect Peaks, so
        // the trace is on screen as soon as audio is loaded — you can see what
        // you are about to detect on, and peaks can be imported from a saved
        // table without running detection first.
        pkRefreshEnvelope();
      }

      // Rebuild the Temporal Analysis envelope from the current audio and the
      // current smoothing, then redraw. Existing peaks are left alone: this is
      // also the hook for the Smoothing box, where the peaks on screen should
      // survive a change of trace.
      function pkRefreshEnvelope() {
        if (!rawSamples) {
          pkEnv = null;
          return;
        }
        const smoothMs = Math.max(0.5, parseFloat($("pkSmooth")?.value) || 1);
        pkEnv = pkComputeEnv(smoothMs);
        if (typeof pkDrawEnvelope === "function") pkDrawEnvelope();
      }

      // ═══════════════════════════════════════════════════════════════════
      // AUDIO EDITS — Trim & Bandpass
      // ═══════════════════════════════════════════════════════════════════
      // Zero-phase IIR bandpass: a cascade of one high-pass and one low-pass
      // 2nd-order Butterworth biquad, each run forward then backward
      // (filtfilt-style) so the result has NO phase distortion — important
      // because stridulation timing/envelope metrics must not be smeared.
      // hp=0 disables the high-pass; lp>=Nyquist disables the low-pass.
      function _biquadCoeffs(type, f0, sr, Q) {
        const w0 = (2 * Math.PI * f0) / sr;
        const cw = Math.cos(w0),
          sw = Math.sin(w0);
        const alpha = sw / (2 * Q);
        let b0, b1, b2, a0, a1, a2;
        if (type === "hp") {
          b0 = (1 + cw) / 2;
          b1 = -(1 + cw);
          b2 = (1 + cw) / 2;
        } else {
          // lp
          b0 = (1 - cw) / 2;
          b1 = 1 - cw;
          b2 = (1 - cw) / 2;
        }
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        return {
          b0: b0 / a0,
          b1: b1 / a0,
          b2: b2 / a0,
          a1: a1 / a0,
          a2: a2 / a0,
        };
      }
      function _biquadForward(x, c) {
        const y = new Float32Array(x.length);
        let x1 = 0,
          x2 = 0,
          y1 = 0,
          y2 = 0;
        for (let i = 0; i < x.length; i++) {
          const xi = x[i];
          const yi =
            c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
          x2 = x1;
          x1 = xi;
          y2 = y1;
          y1 = yi;
          y[i] = yi;
        }
        return y;
      }
      function _filtfilt(x, c) {
        // forward
        let y = _biquadForward(x, c);
        // reverse
        y.reverse();
        y = _biquadForward(y, c);
        y.reverse();
        return y;
      }
      // Returns a NEW Float32Array; never mutates the input.
      function applyBandpass(sig, sr, hpHz, lpHz) {
        const nyq = sr / 2;
        let out = Float32Array.from(sig);
        const Q = Math.SQRT1_2; // Butterworth (maximally flat) per stage
        if (hpHz && hpHz > 0 && hpHz < nyq) {
          out = _filtfilt(out, _biquadCoeffs("hp", hpHz, sr, Q));
        }
        if (lpHz && lpHz > 0 && lpHz < nyq) {
          out = _filtfilt(out, _biquadCoeffs("lp", lpHz, sr, Q));
        }
        return out;
      }

      function peakAbs(samples) {
        let p = 0;
        for (let i = 0; i < samples.length; i++) {
          const v = Math.abs(samples[i]);
          if (v > p) p = v;
        }
        return p || 1;
      }

      // Peak-normalizes sig so its max absolute sample sits at `target`
      // (linear, 0–1). Pass target = 10**(dB/20) to normalize to a dBFS level.
      function applyNormalize(sig, target) {
        const gain = target / peakAbs(sig);
        const out = new Float32Array(sig.length);
        for (let i = 0; i < sig.length; i++) out[i] = sig[i] * gain;
        return out;
      }

      // ── Edit chain helpers ──────────────────────────────────────────────
      // ── Frequency drop (pitch shift, duration preserved) ────────────────
      // Scales every frequency in the signal by `ratio` without changing how
      // long the recording is — a 25% drop moves a 40 kHz peak to 30 kHz over
      // the same 3 seconds. Two stages: a phase vocoder time-scales by
      // `ratio` (pitch untouched), then linear-interpolation resampling
      // stretches back to the original length, which is what actually moves
      // the frequencies.
      //
      // The vocoder uses identity phase locking: only spectral PEAKS are
      // advanced by their own instantaneous frequency, and each peak's
      // neighbouring bins are carried rigidly with it. Advancing every bin
      // independently (the textbook phase vocoder) lets bins belonging to one
      // partial drift apart, and they then partly cancel on overlap-add —
      // measured here as ~3 dB of level loss on a harmonic stack, which
      // locking recovers.
      function _ifft(re, im, n) {
        for (let i = 0; i < n; i++) im[i] = -im[i];
        fft(re, im, n);
        for (let i = 0; i < n; i++) {
          re[i] /= n;
          im[i] = -im[i] / n;
        }
      }
      function _princarg(x) {
        return x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
      }

      const PV_FRAME = 1024;
      const PV_HOP = 256; // synthesis hop; Hann at 75% overlap is COLA

      function _pvTimeScale(x, alpha) {
        const N = PV_FRAME,
          Hs = PV_HOP,
          H = N / 2;
        const Ha = Hs / alpha; // fractional analysis hop is expected
        const nFrames = Math.max(1, Math.floor((x.length - N) / Ha) + 1);
        const outLen = Math.ceil(nFrames * Hs) + N;
        const out = new Float64Array(outLen),
          wsum = new Float64Array(outLen);
        const w = new Float64Array(N);
        for (let i = 0; i < N; i++)
          w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
        const lastPhase = new Float64Array(H + 1),
          sumPhase = new Float64Array(H + 1);
        const re = new Float64Array(N),
          im = new Float64Array(N);
        const mag = new Float64Array(H + 1),
          anaPh = new Float64Array(H + 1);
        const expct = (2 * Math.PI * Ha) / N;
        const peaks = [];

        for (let m = 0; m < nFrames; m++) {
          const ta = Math.round(m * Ha);
          for (let i = 0; i < N; i++) {
            const s = ta + i;
            re[i] = (s < x.length ? x[s] : 0) * w[i];
            im[i] = 0;
          }
          fft(re, im, N);
          for (let k = 0; k <= H; k++) {
            mag[k] = Math.hypot(re[k], im[k]);
            anaPh[k] = Math.atan2(im[k], re[k]);
          }
          peaks.length = 0;
          for (let k = 2; k <= H - 2; k++) {
            if (
              mag[k] > mag[k - 1] &&
              mag[k] > mag[k + 1] &&
              mag[k] > mag[k - 2] &&
              mag[k] > mag[k + 2]
            )
              peaks.push(k);
          }
          if (!peaks.length) peaks.push(0);
          for (const k of peaks) {
            const dp = _princarg(anaPh[k] - lastPhase[k] - k * expct);
            sumPhase[k] += Hs * ((k * 2 * Math.PI) / N + dp / Ha);
          }
          // Each bin follows its nearest peak, keeping the partial rigid.
          let pi = 0;
          for (let k = 0; k <= H; k++) {
            while (
              pi + 1 < peaks.length &&
              Math.abs(peaks[pi + 1] - k) < Math.abs(peaks[pi] - k)
            )
              pi++;
            const p = peaks[pi];
            const ph =
              k === p ? sumPhase[p] : sumPhase[p] + (anaPh[k] - anaPh[p]);
            if (k !== p) sumPhase[k] = ph;
            re[k] = mag[k] * Math.cos(ph);
            im[k] = mag[k] * Math.sin(ph);
          }
          for (let k = 0; k <= H; k++) lastPhase[k] = anaPh[k];
          // Hermitian-mirror the upper half so the inverse transform is real.
          for (let k = 1; k < H; k++) {
            re[N - k] = re[k];
            im[N - k] = -im[k];
          }
          im[0] = 0;
          im[H] = 0;
          _ifft(re, im, N);
          const ts = Math.round(m * Hs);
          for (let i = 0; i < N; i++) {
            if (ts + i >= outLen) break;
            out[ts + i] += re[i] * w[i];
            wsum[ts + i] += w[i] * w[i];
          }
        }
        for (let i = 0; i < outLen; i++)
          if (wsum[i] > 1e-8) out[i] /= wsum[i];
        return out;
      }

      function _resampleLinear(x, step, outLen) {
        const out = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const p = i * step,
            i0 = Math.floor(p);
          if (i0 + 1 >= x.length) {
            out[i] = x.length ? x[x.length - 1] : 0;
            continue;
          }
          const fr = p - i0;
          out[i] = x[i0] * (1 - fr) + x[i0 + 1] * fr;
        }
        return out;
      }

      // pct = percentage to drop, e.g. 25 -> every frequency × 0.75.
      function applyFreqDrop(sig, pct) {
        const ratio = 1 - pct / 100;
        if (!(ratio > 0) || Math.abs(ratio - 1) < 1e-6)
          return sig instanceof Float32Array ? sig : Float32Array.from(sig);
        if (sig.length < PV_FRAME * 2)
          return sig instanceof Float32Array ? sig : Float32Array.from(sig);
        return _resampleLinear(_pvTimeScale(sig, ratio), ratio, sig.length);
      }

      function audioHasEdit(type) {
        return audioEdits.some((e) => e.type === type);
      }
      // Trim is expressed on the ORIGINAL timeline so it stays stable even if
      // other edits reorder; we only ever keep a single trim (last wins).
      function setTrimEdit(t0, t1) {
        audioEdits = audioEdits.filter((e) => e.type !== "trim");
        // Trim is applied first so subsequent edits act on the trimmed signal.
        audioEdits.unshift({ type: "trim", t0, t1 });
      }
      function setBandpassEdit(hp, lp) {
        audioEdits = audioEdits.filter((e) => e.type !== "bandpass");
        audioEdits.push({ type: "bandpass", hp, lp });
      }
      function setFreqDropEdit(pct) {
        audioEdits = audioEdits.filter((e) => e.type !== "freqdrop");
        audioEdits.push({ type: "freqdrop", pct });
      }

      // ── UI actions ──────────────────────────────────────────────────────
      // ── Interactive (visual) trim ───────────────────────────────────────
      // Pixel tolerance for grabbing a handle.
      const TRIM_GRAB_PX = 7;
      // Returns "t0" | "t1" if x (canvas px) is within tolerance of a handle.
      function trimHandleHit(x) {
        if (!trimMode) return null;
        const W = getVizWidth();
        const xa = ((trimSel.t0 - viewStart) / viewDur) * W;
        const xb = ((trimSel.t1 - viewStart) / viewDur) * W;
        const da = Math.abs(x - xa),
          db = Math.abs(x - xb);
        if (da <= TRIM_GRAB_PX && da <= db) return "t0";
        if (db <= TRIM_GRAB_PX) return "t1";
        return null;
      }
      function updateTrimReadout() {
        const r = $("trimReadout");
        if (r)
          r.textContent =
            "Keep " +
            trimSel.t0.toFixed(3) +
            "–" +
            trimSel.t1.toFixed(3) +
            " s  (" +
            (trimSel.t1 - trimSel.t0).toFixed(3) +
            " s)";
        // Mirror the duration into the typed-duration box, unless the user
        // is actively typing in it (would fight their keystrokes otherwise).
        const di = $("trimDurationInput");
        if (di && document.activeElement !== di)
          di.value = (trimSel.t1 - trimSel.t0).toFixed(3);
      }

      // Typing a duration resizes the selection from its current start,
      // shifting the start back only if the requested length doesn't fit
      // after it.
      function setTrimDuration(v) {
        if (!trimMode) return;
        const d = parseFloat(v);
        if (!isFinite(d) || d <= 0) return;
        const origDur = origSamples.length / origSampleRate;
        const dur = Math.min(d, origDur);
        let t0 = trimSel.t0;
        if (t0 + dur > origDur) t0 = Math.max(0, origDur - dur);
        trimSel.t0 = t0;
        trimSel.t1 = t0 + dur;
        updateTrimReadout();
        render();
      }

      // Exports the CURRENT active selection (trimSel, on the original
      // timeline minus any non-trim edits already applied) as a standalone
      // .wav — independent of Confirm Trim, so you can pull out several
      // clips from one recording without repeatedly re-trimming the
      // working audio. Auto-numbered (_1, _2, …) so repeated saves from the
      // same file never collide; the save dialog still lets you rename.
      async function saveActiveTrimSelection() {
        if (!trimMode || !rawSamples) {
          log("Enter trim mode and drag out a selection first.", "warn");
          return;
        }
        const t0 = Math.max(0, Math.min(trimSel.t0, duration));
        const t1 = Math.max(0, Math.min(trimSel.t1, duration));
        if (t1 - t0 < 1e-4) {
          log(
            "Selection is empty — drag out a region on the waveform/spectrogram first.",
            "warn",
          );
          return;
        }
        const i0 = Math.max(0, Math.floor(t0 * sampleRate));
        const i1 = Math.min(rawSamples.length, Math.ceil(t1 * sampleRate));
        if (i1 <= i0) return;
        const slice = Float32Array.from(rawSamples.subarray(i0, i1));
        const base = (currentAudioFileName || "recording").replace(
          /\.[^/.]+$/,
          "",
        );
        const n = (trimSaveCounters[base] || 0) + 1;
        trimSaveCounters[base] = n;
        const fname = base + "_" + n + ".wav";
        try {
          const bytes = _buildWav(slice, sampleRate);
          await dlFile(fname, bytes, "audio/wav", { exactName: true });
          log(
            'Saved selection "' + fname + '" (' + (t1 - t0).toFixed(3) + " s)",
            "ok",
          );
        } catch (e) {
          log("Selection export failed: " + e.message, "err");
        }
      }

      // Enter visual trim mode. We first strip any existing trim so the handles
      // are positioned against the FULL original signal, then show the whole
      // file and place handles at the previous trim bounds (or the edges).
      function enterTrimMode() {
        if (!origSamples) {
          log("Load audio first", "warn");
          return;
        }
        if (trimMode) return;
        const prev = audioEdits.find((e) => e.type === "trim");
        const origDur = origSamples.length / origSampleRate;
        trimHadPrior = !!prev;
        // Temporarily remove the trim so the view shows the original timeline.
        if (prev) {
          audioEdits = audioEdits.filter((e) => e.type !== "trim");
          rebuildAudioFromEdits({ resetView: true });
        }
        trimSel.t0 = prev ? Math.max(0, prev.t0) : 0;
        trimSel.t1 = prev ? Math.min(origDur, prev.t1) : origDur;
        trimMode = true;
        trimDrag = null;
        // Show the entire file so both handles are reachable.
        viewStart = 0;
        viewDur = duration;
        if ($("zoomSlider")) $("zoomSlider").value = 0;
        // Switch to the select tool so other tools don't fight the handles.
        setTool("select");
        $("trimControls").style.display = "";
        $("btnEnterTrim").style.display = "none";
        updateTrimReadout();
        updateEditPanelState();
        log(
          "Trim mode — drag out a selection (or an edge/the middle of one), then Confirm Trim.",
          "info",
        );
        render();
      }

      function confirmTrim() {
        if (!trimMode) return;
        const origDur = origSamples.length / origSampleRate;
        let t0 = Math.max(0, Math.min(trimSel.t0, origDur));
        let t1 = Math.max(0, Math.min(trimSel.t1, origDur));
        if (t1 - t0 < 1e-4) {
          log("Trim range is empty — move the handles apart.", "warn");
          return;
        }
        const hadWork =
          (detections && detections.length) ||
          (typeof pkPeaks !== "undefined" && pkPeaks && pkPeaks.length) ||
          (annotations && annotations.length);
        // If a trim already existed, the in-memory peaks/detections live on the
        // PREVIOUSLY trimmed timeline, so they can't be reliably remapped across
        // a fresh original-timeline cut — clear them. With no prior trim, the
        // times match the original timeline and we keep whatever falls inside.
        const canRemap = hadWork && !trimHadPrior;
        if (hadWork && !canRemap) clearTimeDependentWork();
        setTrimEdit(t0, t1);
        exitTrimUi();
        rebuildAudioFromEdits({ resetView: true });
        if (canRemap) remapTimeDependentWork(t0, t1);
        trimHadPrior = false;
        log("Trimmed to " + t0.toFixed(3) + "–" + t1.toFixed(3) + " s", "ok");
      }

      // Leave trim mode without cutting. Re-applies any pre-existing trim that
      // was temporarily removed on entry.
      function cancelTrim() {
        if (!trimMode) return;
        exitTrimUi();
        rebuildAudioFromEdits({ resetView: true });
        log("Trim cancelled", "info");
      }

      function exitTrimUi() {
        trimMode = false;
        trimDrag = null;
        trimHadPrior = false;
        const tc = $("trimControls");
        if (tc) tc.style.display = "none";
        const be = $("btnEnterTrim");
        if (be) be.style.display = "";
        $("waveI").style.cursor = "default";
        $("specI").style.cursor = "default";
      }

      function clearTrim() {
        if (!audioHasEdit("trim")) return;
        if (trimMode) exitTrimUi();
        audioEdits = audioEdits.filter((e) => e.type !== "trim");
        clearTimeDependentWork();
        rebuildAudioFromEdits({ resetView: true });
        log("Trim removed", "ok");
      }
      function applyBandpassEdit() {
        if (!origSamples) {
          log("Load audio first", "warn");
          return;
        }
        const nyq = sampleRate / 2;
        let hp = parseFloat($("editHp").value);
        let lp = parseFloat($("editLp").value);
        if (!isFinite(hp) || hp < 0) hp = 0;
        if (!isFinite(lp) || lp <= 0) lp = nyq;
        lp = Math.min(lp, nyq);
        if (hp > 0 && lp < nyq && hp >= lp) {
          log("High-pass must be below low-pass.", "warn");
          return;
        }
        if (!(hp > 0) && lp >= nyq) {
          log("No passband change (HP=0, LP=Nyquist).", "warn");
          return;
        }
        setBandpassEdit(hp, lp);
        rebuildAudioFromEdits({ resetView: false });
        log(
          "Bandpass: " +
            (hp > 0 ? fmtHz(hp) : "DC") +
            " – " +
            (lp < nyq ? fmtHz(lp) : "Nyquist"),
          "ok",
        );
      }
      function clearBandpass() {
        if (!audioHasEdit("bandpass")) return;
        audioEdits = audioEdits.filter((e) => e.type !== "bandpass");
        $("editHp").value = "0";
        $("editLp").value = Math.round(sampleRate / 2);
        rebuildAudioFromEdits({ resetView: false });
        log("Bandpass removed", "ok");
      }

      async function applyFreqDropEdit() {
        if (!origSamples) {
          log("Load audio first", "warn");
          return;
        }
        const pct = parseFloat($("editFreqDrop").value);
        if (!isFinite(pct) || pct <= 0 || pct >= 100) {
          log("Frequency drop must be between 0 and 100%.", "warn");
          return;
        }
        setFreqDropEdit(pct);
        await withBusy("Dropping frequencies…", async () => {
          await busyTick();
          rebuildAudioFromEdits({ resetView: false });
        });
        log(
          `Frequency drop ${pct}% — every frequency × ${(1 - pct / 100).toFixed(3)}, duration unchanged.`,
          "ok",
        );
      }
      function clearFreqDrop() {
        if (!audioHasEdit("freqdrop")) return;
        audioEdits = audioEdits.filter((e) => e.type !== "freqdrop");
        rebuildAudioFromEdits({ resetView: false });
        log("Frequency drop removed", "ok");
      }

      // Trim changes the timeline, invalidating peak detections, measurement
      // detections, and imported annotations. Clear them so stale times don't
      // point at the wrong audio.
      function clearTimeDependentWork() {
        if (typeof pkPeaks !== "undefined") {
          pkPeaks = [];
          pkTrains = [];
          pkMotifs = [];
          if (typeof pkConfirmed !== "undefined") pkConfirmed = false;
          if (typeof pkEnv !== "undefined") pkEnv = null;
          const pr = $("pkResults");
          if (pr) pr.style.display = "none";
          const ps = $("pkStatus");
          if (ps)
            ps.textContent =
              "Audio edited — set parameters and click Detect Peaks";
        }
        detections = [];
        detMeasurements = [];
        annotations = [];
        selAid = null;
        // Its times refer to the pre-edit timeline.
        ppSel = null;
        if (typeof updatePpSelReadout === "function") updatePpSelReadout();
        if (typeof pkAppliedAnnotationIds !== "undefined") pkAppliedAnnotationIds = [];
        // Snapshots hold times on the pre-edit timeline — restoring them onto
        // the edited audio would put annotations over the wrong sound.
        if (typeof annotResetUndo === "function") annotResetUndo();
        if (typeof refreshAnnotList === "function") refreshAnnotList();
        const sx = $("btnSaveSpectralExcel");
        if (sx) sx.disabled = true;
        const trA = $("btnExportTextReport");
        if (trA) trA.disabled = true;
        const cb = $("btnComputeSpectral");
        if (cb) cb.disabled = true;
      }

      // After a trim that keeps the block [t0, t1] (seconds, original timeline),
      // remap existing work into the trimmed timeline instead of discarding it:
      //   • annotations / detections overlapping the block are clipped and shifted
      //   • peaks inside the block are shifted; their sample idx/amp are refreshed
      //     against the freshly-recomputed peak envelope
      // MUST be called AFTER rebuildAudioFromEdits() so sampleRate/rawSamples are
      // already the trimmed signal.
      function remapTimeDependentWork(t0, t1) {
        const eps = 1e-9;
        // Everything below is re-timed onto the trimmed timeline; the undo
        // snapshots still hold the old times, so they are dropped rather
        // than left to restore annotations onto the wrong audio. The time
        // selection goes for the same reason — after a cut it would point at
        // a stretch the user never selected.
        if (typeof annotResetUndo === "function") annotResetUndo();
        ppSel = null;
        if (typeof updatePpSelReadout === "function") updatePpSelReadout();
        // ── Annotations ──────────────────────────────────────────────────
        if (annotations && annotations.length) {
          annotations = annotations
            .filter((a) => a.end > t0 + eps && a.start < t1 - eps)
            .map((a) => ({
              ...a,
              start: Math.max(0, a.start - t0),
              end: Math.min(t1 - t0, a.end - t0),
            }));
          if (selAid != null && !annotations.some((a) => a.id === selAid))
            selAid = null;
          if (typeof refreshAnnotList === "function") refreshAnnotList();
        }
        // ── Spectral-analysis detections ─────────────────────────────────
        if (detections && detections.length) {
          detections = detections
            .filter((d) => d.end > t0 + eps && d.start < t1 - eps)
            .map((d) => ({
              ...d,
              start: Math.max(0, d.start - t0),
              end: Math.min(t1 - t0, d.end - t0),
            }));
          // Measurements were computed on the old timeline; recompute if any
          // detections survive, else drop them.
          detMeasurements = [];
          if (detections.length && typeof computeMeasurements === "function") {
            computeMeasurements();
          }
          const cb = $("btnComputeSpectral");
          if (cb) cb.disabled = !detections.length;
          if (!detections.length) {
            const sx = $("btnSaveSpectralExcel");
            if (sx) sx.disabled = true;
            const trB = $("btnExportTextReport");
            if (trB) trB.disabled = true;
          }
        }
        // ── Temporal-analysis peaks ──────────────────────────────────────
        if (typeof pkPeaks !== "undefined" && pkPeaks && pkPeaks.length) {
          // Recompute the peak-pane envelope on the trimmed signal so peak
          // amplitudes/indices can be refreshed.
          let env = null;
          try {
            const smoothMs = parseFloat($("pkSmooth")?.value) || 0.1;
            if (typeof pkComputeEnv === "function") env = pkComputeEnv(smoothMs);
          } catch (e) {}
          pkEnv = env;
          const n = rawSamples ? rawSamples.length : 0;
          const kept = [];
          pkPeaks.forEach((p) => {
            if (p.time >= t0 - eps && p.time <= t1 + eps) {
              const nt = p.time - t0;
              const idx = Math.max(0, Math.min(n - 1, Math.round(nt * sampleRate)));
              kept.push({
                ...p,
                time: nt,
                idx,
                amp: env ? env[idx] : p.amp,
              });
            }
          });
          // The last surviving peak necessarily ends its train.
          if (kept.length) kept[kept.length - 1].splitAfter = true;
          pkPeaks = kept;
          // Segmentation was frozen on the old peak set; it remains valid for the
          // kept subset, but metrics must be recomputed — require a re-Confirm.
          if (typeof pkConfirmed !== "undefined") pkConfirmed = false;
          const pr = $("pkResults");
          if (pr) pr.style.display = "none";
          const ps = $("pkStatus");
          if (ps)
            ps.textContent = pkPeaks.length
              ? pkPeaks.length +
                " peaks kept after trim — click Confirm to recompute metrics"
              : "Audio trimmed — set parameters and click Detect Peaks";
          if (typeof pkLiveUpdate === "function" && pkPeaks.length) {
            pkLiveUpdate("trimmed");
          } else if (typeof pkDrawEnvelope === "function") {
            pkDrawEnvelope();
          }
          const applyBtn = $("btnPkApplySpectral");
          if (applyBtn) applyBtn.disabled = !pkPeaks.length;
        }
      }

      // Reset the Edit Audio panel inputs to defaults for a freshly loaded file.
      function resetEditUiForNewFile() {
        const nyq = origSampleRate / 2;
        if (trimMode) exitTrimUi();
        if ($("editHp")) $("editHp").value = "0";
        if ($("editLp")) $("editLp").value = Math.round(nyq);
      }

      // Enable edit controls + reflect which edits are active.
      function updateEditPanelState() {
        const has = !!origSamples;
        [
          "btnEnterTrim",
          "btnClearTrim",
          "editHp",
          "editLp",
          "btnApplyBandpass",
          "btnClearBandpass",
          "editFreqDrop",
          "btnApplyFreqDrop",
          "btnClearFreqDrop",
          "btnSaveEditedAudio",
        ].forEach((id) => {
          const el = $(id);
          if (el) el.disabled = !has;
        });
        // Trim Reset only meaningful when a trim is applied.
        const ct = $("btnClearTrim");
        if (ct) ct.disabled = !has || !audioHasEdit("trim");
        // Same for the frequency-drop Reset.
        const cf = $("btnClearFreqDrop");
        if (cf) cf.disabled = !has || !audioHasEdit("freqdrop");
        const st = $("editStatus");
        if (st) {
          if (!has) {
            st.textContent = "Load audio to enable editing.";
          } else if (trimMode) {
            st.textContent =
              "Trim mode active — drag out a selection, then confirm.";
          } else {
            const parts = [];
            const tr = audioEdits.find((e) => e.type === "trim");
            if (tr)
              parts.push(
                "trim " + tr.t0.toFixed(3) + "–" + tr.t1.toFixed(3) + "s",
              );
            const fdEd = audioEdits.find((e) => e.type === "freqdrop");
            if (fdEd) parts.push("freq drop " + fdEd.pct + "%");
            const bp = audioEdits.find((e) => e.type === "bandpass");
            if (bp)
              parts.push(
                "bandpass " +
                  (bp.hp > 0 ? fmtHz(bp.hp) : "DC") +
                  "–" +
                  (bp.lp < origSampleRate / 2 ? fmtHz(bp.lp) : "Nyq"),
              );
            st.textContent = parts.length
              ? "Active: " + parts.join(" · ")
              : "No edits applied.";
          }
        }
        const undoBtn = $("btnUndoEdit");
        if (undoBtn) {
          const last = audioEdits[audioEdits.length - 1];
          undoBtn.disabled = !has || !last;
          undoBtn.title = last
            ? "Undo " + (last.type === "trim" ? "trim" : "bandpass filter")
            : "Nothing to undo.";
        }
      }

      // Reverts the most recently applied/changed edit (trim or bandpass —
      // whichever is last in the chain), by delegating to that edit's own
      // "remove" function so behaviour (incl. clearing time-dependent work
      // on a trim) matches clicking its Reset button exactly. Calling this
      // repeatedly walks the chain back to the untouched original.
      function undoLastAudioEdit() {
        if (!audioEdits.length) {
          log("Nothing to undo.", "warn");
          return;
        }
        const last = audioEdits[audioEdits.length - 1];
        if (last.type === "trim") clearTrim();
        else if (last.type === "bandpass") clearBandpass();
      }

      // ═══════════════════════════════════════════════════════════════════
      // AUDIO LIBRARY — in-memory tray of loaded/edited audio buffers, shown
      // in the bottom panel. Importing a file always adds an entry; "Save
      // Edited Audio As…" snapshots the CURRENT (post-edit) audio under a
      // new name without touching the original. Clicking an entry makes it
      // the active working audio, following the same reset path as a fresh
      // file import (origSamples/audioEdits reset, then rebuild).
      // ═══════════════════════════════════════════════════════════════════
      let audioLibrary = []; // { id, name, folder, samples, rate, dur, addedAt }
      let audioLibNextId = 1;
      let audioLibActiveId = null;
      let audioLibCols = parseInt(localStorage.getItem("rt_audiolib_cols"), 10) || 5;
      let audioLibRows = parseInt(localStorage.getItem("rt_audiolib_rows"), 10) || 2;
      let audioLibBatchSelected = new Set(); // entry ids checked for batch edit

      function addAudioToLibrary(name, folder, samples, rate) {
        const entry = {
          id: audioLibNextId++,
          name,
          folder: folder || "",
          // Defensive copy: later edits build new arrays via origSamples, but
          // this guarantees the stored snapshot can never be aliased/mutated.
          samples: Float32Array.from(samples),
          rate,
          dur: samples.length / rate,
          addedAt: Date.now(),
          editTags: [], // e.g. ["1hpf", "n0"] — filled in by batch edits, used to build the default save-as filename
          specimenId: "", // manually tagged; see setCurrentSpecimenId
          species: "", // manually tagged; see setCurrentSpecies
          country: "", // manually tagged; see setCurrentCountry
          locality: "", // manually tagged; see setCurrentLocality
          tempC: "", // manually tagged; see setCurrentTempC
        };
        audioLibrary.push(entry);
        audioLibActiveId = entry.id;
        renderAudioLibraryPanel();
        return entry;
      }

      function removeAudioFromLibrary(id) {
        const wasActive = audioLibActiveId === id;
        audioLibrary = audioLibrary.filter((e) => e.id !== id);
        audioLibBatchSelected.delete(id);
        // Also reset when the last recording goes, regardless of which entry
        // was active. Closing a non-active file can empty the library if the
        // active id is already stale, and then nothing would clear the panels
        // even though there is no audio left.
        if (wasActive || !audioLibrary.length) {
          audioLibActiveId = null;
          // The recording every view was showing is gone — nothing is
          // active anymore, so blank everything instead of leaving stale
          // waveform/spectrogram/temporal data on screen for a file that no
          // longer exists. (Deleting a NON-active entry doesn't touch any
          // of this — whatever's currently open is still valid.)
          resetToNoAudio();
        }
        renderAudioLibraryPanel();
      }

      // Drops all per-recording state and blanks every view that shows it —
      // Preprocessing's info panel + waveform/spectrogram viewer, Spectral
      // Analysis (annotations/detections/measurements), and Temporal
      // Analysis (envelope/peaks/tables) — back to their empty "no audio"
      // state. Used when the active Loaded Audio entry is deleted.
      // Everything that describes ONE recording: selections, detections,
      // measurements, peaks, trains, motifs, and the fitted parameters derived
      // from them. None of it is meaningful against different audio, so it is
      // cleared both when the last file closes AND when the active file
      // changes — switching used to leave the previous recording's peaks and
      // selections on screen, where they would be drawn over the new envelope
      // and exported under the new file's name.
      //
      // Deliberately NOT cleared here: sampleRate/duration and the recording
      // tags, which the caller sets for the incoming file; and the detection
      // and spectral PARAMETERS, which are settings the user chose and expects
      // to carry from one recording to the next.
      function clearRecordingAnalysis() {
        annotations = [];
        nextAid = 1;
        selAid = null;
        ppSel = null;
        if (typeof updatePpSelReadout === "function") updatePpSelReadout();
        // Same reasoning as pkResetUndo below: these snapshots describe the
        // recording just left, not the one coming in.
        annotResetUndo();
        detections = [];
        clearMeasurements();
        spectrogramData = null;

        pkEnv = null;
        pkPeaks = [];
        // Undo snapshots describe peaks from the recording just left —
        // pressing Ctrl+Z afterwards would restore them onto other audio.
        pkResetUndo();
        // Fitted parameters belong to that recording too, and Apply would
        // otherwise still be armed with them.
        pkFitBest = null;
        spectralMetricsRows = null;
        pkViewStart = 0;
        pkViewEnd = null;
        pkPeakData = [];
        pkTrainData = [];
        pkMotifData = [];
        pkMotifSeqData = [];
        pkSummaryData = null;
        pkSelection.clear();
        pkConfirmed = false;
        if ($("pkTableHead")) $("pkTableHead").innerHTML = "";
        if ($("pkTableBody")) $("pkTableBody").innerHTML = "";
        if ($("pkStatus")) $("pkStatus").textContent = "";
        if ($("pkResults")) $("pkResults").style.display = "none";
        ["pkFitStatus", "pkPresetStatus"].forEach((id) => {
          const el = $(id);
          if (el) el.textContent = "";
        });
        // Unlocked by detection / confirm / fitting, so they stay live against
        // the next recording unless turned off here.
        [
          "btnPkConfirm",
          "btnPkApplySpectral",
          "btnPkFilterFalse",
          "btnPkUndo",
          "btnPkFitApply",
          "btnSaveSpectralExcel",
          "btnExportTextReport",
        ].forEach((id) => {
          const el = $(id);
          if (el) el.disabled = true;
        });
        refreshAnnotList();
      }

      function resetToNoAudio() {
        if (isPlaying) stopPb();
        if (trimMode) exitTrimUi();

        rawSamples = null;
        origSamples = null;
        sampleRate = 1;
        origSampleRate = 1;
        duration = 0;
        peakAmp = 1;
        audioBuffer = null;
        audioEdits = [];
        envelope = null;
        zcrArr = null;
        specCentroid = null;
        spectrogramData = null;
        currentAudioFileName = "";
        currentAudioFileFolder = "";
        currentSpecimenId = "";
        currentSpecies = "";
        currentCountry = "";
        currentLocality = "";
        currentTempC = "";

        clearRecordingAnalysis();

        $("fileLabel").textContent = "no file";
        $("statusBadge").textContent = "No file";
        $("statusBadge").className = "badge warn";
        ["infoDur", "infoSr", "infoNyq", "infoCh"].forEach((id) => {
          const el = $(id);
          if (el) el.textContent = "—";
        });
        const specInput = $("specimenIdInput");
        if (specInput) specInput.value = "";
        const speciesInput = $("speciesInput");
        if (speciesInput) speciesInput.value = "";
        const localityInput = $("localityInput");
        if (localityInput) localityInput.value = "";
        const countryInput = $("countryInput");
        if (countryInput) countryInput.value = "";
        const metaGroup = $("recordingMetaGroup");
        if (metaGroup) metaGroup.style.display = "none";

        [
          "btnPlay",
          "btnStop",
          "btnPrevEdge",
          "btnNextEdge",
          "btnRaven",
          "btnXlsxSel",
          "btnPkDetect",
          "btnEnterTrim",
          "btnClearTrim",
          "editHp",
          "editLp",
          "btnApplyBandpass",
          "btnClearBandpass",
          "editFreqDrop",
          "btnApplyFreqDrop",
          "btnClearFreqDrop",
          "btnSaveEditedAudio",
          "btnUndoEdit",
          "btnComputeSpectral",
        ].forEach((id) => {
          const el = $(id);
          if (el) el.disabled = true;
        });
        if ($("editStatus"))
          $("editStatus").textContent = "Load audio to enable editing.";

        updateEditPanelState();
        render();
        renderMinimap();
        if (typeof pkDrawEnvelope === "function") pkDrawEnvelope();
      }

      // Makes a stored entry the active working audio — mirrors the tail of
      // the file-import handler (origSamples/audioEdits reset, then the
      // shared rebuild + UI-reset chain) so behaviour matches a fresh import.
      function selectLibraryAudio(id) {
        const entry = audioLibrary.find((e) => e.id === id);
        if (!entry) return;
        // Nothing from the outgoing recording survives the switch.
        clearRecordingAnalysis();
        audioLibActiveId = id;

        currentAudioFileName = entry.name;
        currentAudioFileFolder = entry.folder || "";
        $("fileLabel").textContent =
          entry.name.length > 24 ? entry.name.slice(0, 22) + "…" : entry.name;
        currentSpecimenId = entry.specimenId || "";
        const specInput = $("specimenIdInput");
        if (specInput) specInput.value = currentSpecimenId;
        currentSpecies = entry.species || "";
        const speciesInput = $("speciesInput");
        if (speciesInput) speciesInput.value = currentSpecies;
        currentCountry = entry.country || "";
        const countryInput = $("countryInput");
        if (countryInput) countryInput.value = currentCountry;
        currentLocality = entry.locality || "";
        const localityInput = $("localityInput");
        if (localityInput) localityInput.value = currentLocality;
        currentTempC = entry.tempC || "";
        const tempInput = $("tempCInput");
        if (tempInput) tempInput.value = currentTempC;
        const metaGroup = $("recordingMetaGroup");
        if (metaGroup) metaGroup.style.display = "flex";

        origSamples = entry.samples;
        origSampleRate = entry.rate;
        audioEdits = [];
        $("infoCh").textContent = 1; // library entries are already mono-mixed
        $("pkStatus").textContent =
          "Audio loaded — set parameters and click Detect Peaks";

        resetEditUiForNewFile();
        rebuildAudioFromEdits({ resetView: true });
        renderAudioLibraryPanel();
        // First audio ever loaded this session — leave the landing screen
        // for the working app. Later switches (picking a different Loaded
        // Audio entry) don't yank the user off whatever tab they're on,
        // since landing is already gone by then.
        const landing = $("mainview-landing");
        if (landing && landing.style.display !== "none") {
          switchMainTab("preprocess", $("maintab-preprocess"));
        }
        log('Switched to "' + entry.name + '"', "ok");
      }

      function toggleAudioLibSettings() {
        const row = $("audioLibSettingsRow");
        row.style.display = row.style.display === "none" ? "flex" : "none";
      }

      function setAudioLibGrid() {
        const c = Math.max(
          1,
          Math.min(10, parseInt($("audioLibColsInput").value, 10) || 5),
        );
        const r = Math.max(
          1,
          Math.min(6, parseInt($("audioLibRowsInput").value, 10) || 2),
        );
        audioLibCols = c;
        audioLibRows = r;
        localStorage.setItem("rt_audiolib_cols", c);
        localStorage.setItem("rt_audiolib_rows", r);
        renderAudioLibraryPanel();
      }

      function renderAudioLibraryPanel() {
        $("audioLibColsInput").value = audioLibCols;
        $("audioLibRowsInput").value = audioLibRows;
        $("audioLibCount").textContent = audioLibrary.length
          ? "(" + audioLibrary.length + ")"
          : "";

        const grid = $("audioLibGrid");
        const cellH = 42;
        grid.style.gridTemplateColumns =
          "repeat(" + audioLibCols + ", minmax(90px, 1fr))";
        grid.style.gridAutoRows = cellH + "px";
        grid.style.maxHeight = audioLibRows * (cellH + 4) + "px";
        grid.innerHTML = "";

        if (!audioLibrary.length) {
          const d = document.createElement("div");
          d.style.cssText =
            "grid-column:1/-1;color:var(--txt2);font-size:11px;padding:4px 0";
          d.textContent = "Import an audio file to see it here.";
          grid.appendChild(d);
          audioLibBatchSelected.clear();
          updateBatchEditStatus();
          return;
        }

        audioLibrary.forEach((entry) => {
          const cell = document.createElement("div");
          cell.className =
            "alib-cell" + (entry.id === audioLibActiveId ? " active" : "");
          cell.title =
            entry.name +
            " — " +
            entry.dur.toFixed(2) +
            "s @ " +
            entry.rate +
            " Hz";

          const chk = document.createElement("input");
          chk.type = "checkbox";
          chk.className = "alib-chk";
          chk.checked = audioLibBatchSelected.has(entry.id);
          chk.title = "Select for batch edit";
          chk.onclick = (ev) => ev.stopPropagation();
          chk.onchange = () => {
            if (chk.checked) audioLibBatchSelected.add(entry.id);
            else audioLibBatchSelected.delete(entry.id);
            updateBatchEditStatus();
          };

          const xBtn = document.createElement("button");
          xBtn.className = "alib-x";
          xBtn.textContent = "×";
          xBtn.title = "Remove from Loaded Audio";
          xBtn.onclick = (ev) => {
            ev.stopPropagation();
            removeAudioFromLibrary(entry.id);
          };

          const dlBtn = document.createElement("button");
          dlBtn.className = "alib-dl";
          dlBtn.textContent = "⬇";
          dlBtn.title = "Export as WAV to disk";
          dlBtn.onclick = (ev) => {
            ev.stopPropagation();
            exportLibraryEntry(entry.id);
          };

          const nameEl = document.createElement("div");
          nameEl.className = "alib-name";
          nameEl.textContent = entry.name;

          const metaEl = document.createElement("div");
          metaEl.className = "alib-meta";
          metaEl.textContent =
            entry.dur.toFixed(2) + "s · " + (entry.rate / 1000).toFixed(1) + "kHz";

          cell.appendChild(chk);
          cell.appendChild(xBtn);
          cell.appendChild(dlBtn);
          cell.appendChild(nameEl);
          cell.appendChild(metaEl);
          cell.onclick = () => selectLibraryAudio(entry.id);
          grid.appendChild(cell);
        });
        // Drop batch selections for entries that no longer exist (removed).
        const liveIds = new Set(audioLibrary.map((e) => e.id));
        for (const id of audioLibBatchSelected) if (!liveIds.has(id)) audioLibBatchSelected.delete(id);
        updateBatchEditStatus();

        // Other panes (Osc. Stack/Zoom, Habitus) each keep their own
        // "pick from Loaded Audio" checklist in sync with this one library
        // — refresh them here so a fresh import/removal shows up everywhere
        // without each pane re-polling.
        if (typeof oscRenderLibPicker === "function") oscRenderLibPicker();
        if (typeof ozRenderLibPicker === "function") ozRenderLibPicker();
        if (typeof habRenderLibPicker === "function") habRenderLibPicker();
      }

      // ── Batch edit: apply one filter to every checked Loaded Audio entry ──
      function updateBatchEditStatus() {
        const n = audioLibBatchSelected.size;
        const btn = $("btnBatchBandpass");
        const nBtn = $("btnBatchNormalize");
        const fBtn = $("btnBatchFreqDrop");
        const sBtn = $("btnBatchSave");
        const label = $("batchSelCount");
        if (btn) btn.disabled = n === 0;
        if (nBtn) nBtn.disabled = n === 0;
        if (fBtn) fBtn.disabled = n === 0;
        if (sBtn) sBtn.disabled = n === 0;
        if (label) label.textContent = n ? n + " selected" : "";
        // The Loaded Audio panel carries its own copy of the Select
        // all/Clear selection pair, since that panel is where the
        // checkboxes actually are and it stays visible on every tab (the
        // Batch Edit pair above only shows in Preprocessing). Both drive
        // batchSelectAllLibrary, so the two stay in step by construction.
        const libN = audioLibrary.length;
        const selAll = $("btnAudioLibSelAll");
        const selNone = $("btnAudioLibSelNone");
        const libLabel = $("audioLibSelCount");
        if (selAll) selAll.disabled = !libN || n === libN;
        if (selNone) selNone.disabled = n === 0;
        if (libLabel) libLabel.textContent = n ? n + " checked" : "";
        // Habitus draws straight from this same selection, so its own
        // "what's checked" readout + Draw-button state must track every
        // individual checkbox click too, not just full library re-renders.
        if (typeof habRenderLibPicker === "function") habRenderLibPicker();
      }

      function batchSelectAllLibrary(on) {
        audioLibBatchSelected = on ? new Set(audioLibrary.map((e) => e.id)) : new Set();
        renderAudioLibraryPanel();
      }

      // Filters every checked entry's stored samples in place (mirrors
      // applyBandpass, but writes straight into the library rather than
      // going through the single-active-file edit chain). If the active
      // entry is among the selection, its live view is refreshed too.
      function applyBatchBandpass() {
        if (!audioLibBatchSelected.size) return;
        let hp = parseFloat($("batchHp").value);
        let lp = parseFloat($("batchLp").value);
        if (!isFinite(hp) || hp < 0) hp = 0;
        if (!isFinite(lp) || lp <= 0) lp = 0; // 0 -> per-entry Nyquist, resolved below

        let touchedActive = false;
        let count = 0;
        audioLibrary.forEach((entry) => {
          if (!audioLibBatchSelected.has(entry.id)) return;
          const nyq = entry.rate / 2;
          const entryLp = lp > 0 ? Math.min(lp, nyq) : nyq;
          if (!(hp > 0) && entryLp >= nyq) return; // no-op passband, skip
          if (hp > 0 && entryLp <= hp) {
            log(`Skipped "${entry.name}": high-pass must be below low-pass.`, "warn");
            return;
          }
          entry.samples = applyBandpass(entry.samples, entry.rate, hp, entryLp);
          // Replace any previous bandpass tags rather than piling up stale ones.
          entry.editTags = entry.editTags.filter((t) => !/(hpf|lpf)$/.test(t));
          if (hp > 0) entry.editTags.push(freqSuffixLabel(hp) + "hpf");
          if (entryLp < nyq) entry.editTags.push(freqSuffixLabel(entryLp) + "lpf");
          count++;
          if (entry.id === audioLibActiveId) touchedActive = true;
        });

        if (!count) {
          log("Batch filter: nothing to apply.", "warn");
          return;
        }

        // Refresh the Analyzer's working audio if it was one of the filtered
        // entries, so the on-screen view matches what's now stored.
        if (touchedActive) selectLibraryAudio(audioLibActiveId);

        renderAudioLibraryPanel();
        log(
          `Batch bandpass applied to ${count} recording(s): ` +
            (hp > 0 ? fmtHz(hp) : "DC") + " – " + (lp > 0 ? fmtHz(lp) : "Nyquist"),
          "ok",
        );
      }

      // Peak-normalizes every checked entry independently, each to the same
      // target dBFS level, in place. Same "batch touches the library
      // directly" model as applyBatchBandpass.
      function applyBatchNormalize() {
        if (!audioLibBatchSelected.size) return;
        let targetDb = parseFloat($("batchNormDb").value);
        if (!isFinite(targetDb)) targetDb = 0;
        targetDb = Math.min(0, targetDb); // normalizing above full scale would just clip
        const target = Math.pow(10, targetDb / 20);

        let touchedActive = false;
        let count = 0;
        audioLibrary.forEach((entry) => {
          if (!audioLibBatchSelected.has(entry.id)) return;
          entry.samples = applyNormalize(entry.samples, target);
          // Replace any previous normalize tag rather than piling up stale
          // ones. The pattern matches the old "norm…" spelling too, so a file
          // tagged by an earlier version doesn't end up carrying both.
          entry.editTags = entry.editTags.filter(
            (t) => !/^(?:norm|n)-?[\d.]+(?:dbfs)?$/.test(t),
          );
          entry.editTags.push("n" + targetDb);
          count++;
          if (entry.id === audioLibActiveId) touchedActive = true;
        });

        if (!count) {
          log("Batch normalize: nothing to apply.", "warn");
          return;
        }

        if (touchedActive) selectLibraryAudio(audioLibActiveId);

        renderAudioLibraryPanel();
        log(`Batch peak-normalize applied to ${count} recording(s), each to ${targetDb} dBFS.`, "ok");
      }

      async function applyBatchFreqDrop() {
        if (!audioLibBatchSelected.size) return;
        const pct = parseFloat($("batchFreqDrop").value);
        if (!isFinite(pct) || pct <= 0 || pct >= 100) {
          log("Frequency drop must be between 0 and 100%.", "warn");
          return;
        }
        const targets = audioLibrary.filter((e) =>
          audioLibBatchSelected.has(e.id),
        );
        let touchedActive = false;
        let count = 0;
        await withBusy("Dropping frequencies…", async (progress) => {
          for (let i = 0; i < targets.length; i++) {
            const entry = targets[i];
            progress(
              `${entry.name} (${i + 1}/${targets.length})…`,
              i / targets.length,
            );
            await busyTick();
            entry.samples = applyFreqDrop(entry.samples, pct);
            // Replace any previous drop tag rather than stacking them — the
            // samples already carry the earlier shift, so the tag has to
            // describe the last operation, not a history.
            entry.editTags = entry.editTags.filter(
              (t) => !/^fd-?[\d.]+$/.test(t),
            );
            entry.editTags.push("fd" + pct);
            count++;
            if (entry.id === audioLibActiveId) touchedActive = true;
          }
        });
        if (!count) {
          log("Batch frequency drop: nothing to apply.", "warn");
          return;
        }
        if (touchedActive) selectLibraryAudio(audioLibActiveId);
        renderAudioLibraryPanel();
        log(
          `Frequency drop ${pct}% applied to ${count} recording(s) (duration unchanged).`,
          "ok",
        );
      }

      // ── Save Edited Audio As… modal ─────────────────────────────────────
      // Cutoff for a filename tag: kHz with the unit left implied, so a 2 kHz
      // high-pass tags as "2hpf" rather than "2khzhpf". Two decimals is 10 Hz
      // resolution — finer than any filter anyone sets here — and trailing
      // zeros drop out, so round numbers stay round.
      function freqSuffixLabel(hz) {
        return String(Math.round((hz / 1000) * 100) / 100);
      }

      // Builds a descriptive suffix from the active edit chain — e.g. a 1kHz
      // high-pass plus a trim becomes "_1hpf_trimmed". Edits are not
      // mutually exclusive: each applicable one appends its own tag.
      function defaultEditSuffix() {
        const parts = [];
        const bp = audioEdits.find((e) => e.type === "bandpass");
        if (bp) {
          const nyq = origSampleRate / 2;
          if (bp.hp > 0) parts.push(freqSuffixLabel(bp.hp) + "hpf");
          if (bp.lp < nyq) parts.push(freqSuffixLabel(bp.lp) + "lpf");
        }
        if (audioEdits.some((e) => e.type === "trim")) parts.push("trimmed");
        return parts.length ? "_" + parts.join("_") : "_copy";
      }

      function openSaveEditedAudioModal() {
        if (!rawSamples) {
          log("Load audio first", "warn");
          return;
        }
        const base = (currentAudioFileName || "audio").replace(/\.[^/.]+$/, "");
        $("saveAudioNameInput").value = base + defaultEditSuffix();
        $("saveAudioModalOverlay").classList.add("show");
        setTimeout(() => {
          const inp = $("saveAudioNameInput");
          inp.focus();
          inp.select();
        }, 0);
      }

      function closeSaveEditedAudioModal() {
        $("saveAudioModalOverlay").classList.remove("show");
      }

      function confirmSaveEditedAudio(alsoExport) {
        const name = ($("saveAudioNameInput").value || "").trim();
        if (!name) {
          alert("Enter a name for the saved audio.");
          return;
        }
        addAudioToLibrary(name, currentAudioFileFolder, rawSamples, sampleRate);
        if (alsoExport) exportAudioToDisk(name, rawSamples, sampleRate);
        closeSaveEditedAudioModal();
        log('Saved edited audio as "' + name + '" in the Loaded Audio panel', "ok");
      }

      // ── WAV export (16-bit PCM, mono) ───────────────────────────────────
      function _buildWav(samples, rate) {
        const numSamples = samples.length;
        const dataSize = numSamples * 2;
        const buf = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buf);
        let o = 0;
        const writeStr = (s) => {
          for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
          o += s.length;
        };
        writeStr("RIFF");
        view.setUint32(o, 36 + dataSize, true);
        o += 4;
        writeStr("WAVE");
        writeStr("fmt ");
        view.setUint32(o, 16, true);
        o += 4; // PCM fmt chunk size
        view.setUint16(o, 1, true);
        o += 2; // audio format = PCM
        view.setUint16(o, 1, true);
        o += 2; // channels = 1 (mono)
        view.setUint32(o, rate, true);
        o += 4;
        view.setUint32(o, rate * 2, true);
        o += 4; // byte rate
        view.setUint16(o, 2, true);
        o += 2; // block align
        view.setUint16(o, 16, true);
        o += 2; // bits per sample
        writeStr("data");
        view.setUint32(o, dataSize, true);
        o += 4;
        for (let i = 0; i < numSamples; i++) {
          const s = Math.max(-1, Math.min(1, samples[i]));
          view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          o += 2;
        }
        return new Uint8Array(buf);
      }

      function exportAudioToDisk(name, samples, rate) {
        try {
          const bytes = _buildWav(samples, rate);
          const fname = /\.wav$/i.test(name) ? name : name + ".wav";
          // exactName: `name` here is already the specific filename the
          // caller intends (typed in "Save Edited Audio As…", or a Loaded
          // Audio entry's own stored name) — without this, dlFile's
          // "rename to match the currently active recording" intercept
          // would silently overwrite it with whatever's currently loaded,
          // which is exactly the bug where a saved file ends up named
          // after the WRONG (active) recording instead of what was typed.
          dlFile(fname, bytes, "audio/wav", { exactName: true });
          log('Exporting "' + fname + '" to disk…', "ok");
        } catch (e) {
          log("Audio export failed: " + e.message, "err");
        }
      }

      function exportLibraryEntry(id) {
        const entry = audioLibrary.find((e) => e.id === id);
        if (!entry) return;
        exportAudioToDisk(entry.name, entry.samples, entry.rate);
      }

      // Original base name + whatever batch edits were applied (see
      // applyBatchBandpass/applyBatchNormalize) — e.g. "call_A" with a
      // 1kHz high-pass and 0dBFS normalize becomes "call_A_1hpf_n0.wav".
      // Untouched entries just keep their original name.
      function defaultBatchFilename(entry) {
        const base = entry.name.replace(/\.[^/.]+$/, "");
        const suffix = entry.editTags.length ? "_" + entry.editTags.join("_") : "";
        return base + suffix + ".wav";
      }

      // Writes every checked Loaded Audio entry to disk under its default
      // edited name, in one folder — picked once, defaulting to wherever
      // the most recent import came from.
      async function saveSelectedLibraryFiles() {
        if (!audioLibBatchSelected.size) {
          log("Check at least one loaded recording first.", "warn");
          return;
        }
        const entries = audioLibrary.filter((e) => audioLibBatchSelected.has(e.id));

        if (
          window.__TAURI__ &&
          window.__TAURI__.dialog &&
          typeof window.__TAURI__.dialog.open === "function" &&
          window.__TAURI__.fs &&
          typeof window.__TAURI__.fs.writeFile === "function"
        ) {
          const folder = await window.__TAURI__.dialog.open({
            directory: true,
            defaultPath: lastImportFolder || undefined,
            title: "Choose a folder to save the edited files",
          });
          if (!folder) {
            log("Batch save cancelled by user", "info");
            return;
          }
          lastImportFolder = folder;
          const sep = folder.includes("\\") ? "\\" : "/";

          // Folder is already chosen, so from here on it is all app work —
          // WAV encoding plus a disk write per file.
          const count = await withBusy(
            "Saving edited audio…",
            async (progress) => {
              let n = 0;
              for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                const fname = defaultBatchFilename(entry);
                progress(
                  "Saving " + (i + 1) + "/" + entries.length + " — " + fname,
                  i / entries.length,
                );
                await busyTick();
                try {
                  const bytes = _buildWav(entry.samples, entry.rate);
                  await window.__TAURI__.fs.writeFile(
                    `${folder}${sep}${fname}`,
                    bytes,
                  );
                  n++;
                } catch (e) {
                  log(`Failed to save "${fname}": ${e.message}`, "err");
                }
              }
              return n;
            },
          );
          log(`Saved ${count}/${entries.length} file(s) to ${folder}`, "ok");
        } else {
          // Browser fallback: no folder picker available, so trigger one
          // download per file (goes to the browser's default location).
          console.warn("Tauri desktop save APIs unavailable; falling back to browser downloads.");
          await withBusy("Saving edited audio…", async (progress) => {
            for (let i = 0; i < entries.length; i++) {
              const entry = entries[i];
              const fname = defaultBatchFilename(entry);
              progress(
                "Saving " + (i + 1) + "/" + entries.length + " — " + fname,
                i / entries.length,
              );
              await busyTick();
              const bytes = _buildWav(entry.samples, entry.rate);
              const blob = new Blob([bytes], { type: "audio/wav" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = fname;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              await new Promise((r) => setTimeout(r, 150)); // avoid the browser blocking rapid downloads
            }
          });
          log(`Downloaded ${entries.length} file(s) (no folder picker in this environment).`, "ok");
        }
      }

      function readWavSampleRate(ab) {
        const v = new DataView(ab);
        const riff = String.fromCharCode(
          v.getUint8(0),
          v.getUint8(1),
          v.getUint8(2),
          v.getUint8(3),
        );
        if (riff !== "RIFF") return 0;
        const wave = String.fromCharCode(
          v.getUint8(8),
          v.getUint8(9),
          v.getUint8(10),
          v.getUint8(11),
        );
        if (wave !== "WAVE") return 0;
        return v.getUint32(24, true);
      }
      function fmtHz(hz) {
        if (hz >= 1e6) return (hz / 1e6).toFixed(3) + " MHz";
        // Always report in kHz with 3-decimal precision (e.g. 4.000 kHz, 12.345 kHz).
        return (hz / 1000).toFixed(3) + " kHz";
      }

      // ═══════════════════════════════════════════════════════════════════
      // DSP
      // ═══════════════════════════════════════════════════════════════════
      function computeEnvelope() {
        const wMs = Math.max(0.5, parseFloat($("envWin").value) || 1);
        const half = Math.max(1, Math.round((sampleRate * wMs) / 2000));
        const n = rawSamples.length;
        envelope = new Float32Array(n);
        let ss = 0;
        for (let i = 0; i < Math.min(half, n); i++)
          ss += rawSamples[i] * rawSamples[i];
        for (let i = 0; i < n; i++) {
          const addIdx = i + half,
            remIdx = i - half - 1;
          if (addIdx < n) ss += rawSamples[addIdx] * rawSamples[addIdx];
          if (remIdx >= 0) ss -= rawSamples[remIdx] * rawSamples[remIdx];
          const winLen = Math.min(i + half, n - 1) - Math.max(i - half, 0) + 1;
          envelope[i] = Math.sqrt(Math.max(0, ss / winLen));
        }
      }
      function computeZCR() {
        const wSamp = Math.max(1, Math.round(sampleRate * 0.01));
        const n = rawSamples.length;
        zcrArr = new Float32Array(n);
        for (let i = 0; i < n; i += wSamp) {
          let z = 0;
          const end = Math.min(i + wSamp, n);
          for (let j = i + 1; j < end; j++)
            if (rawSamples[j] * rawSamples[j - 1] < 0) z++;
          const r = z / wSamp;
          for (let j = i; j < end; j++) zcrArr[j] = r;
        }
      }
      function computeSpectralCentroid() {
        const fftN = parseInt($("fftSize").value) || 128;
        const hop = Math.round(sampleRate * 0.01);
        const n = rawSamples.length;
        specCentroid = new Float32Array(n);
        const win = hannWin(fftN);
        const nFrames = Math.max(1, Math.floor((n - fftN) / hop) + 1);
        for (let fr = 0; fr < nFrames; fr++) {
          const off = fr * hop,
            re = new Float32Array(fftN),
            im = new Float32Array(fftN);
          for (let i = 0; i < fftN && off + i < n; i++)
            re[i] = rawSamples[off + i] * win[i];
          fft(re, im, fftN);
          let num = 0,
            den = 0;
          for (let i = 1; i < fftN / 2; i++) {
            const m = re[i] * re[i] + im[i] * im[i];
            num += ((i * sampleRate) / fftN) * m;
            den += m;
          }
          const c = den > 1e-20 ? num / den / sampleRate : 0;
          const end = Math.min(off + hop, n);
          for (let i = off; i < end; i++) specCentroid[i] = c;
        }
      }
      function computeSpectrogram() {
        const fftN = parseInt($("fftSize").value) || 128;
        const hop = Math.max(1, fftN >> 2);
        const n = rawSamples.length;
        const nFrames = Math.max(1, Math.floor((n - fftN) / hop) + 1);
        const nBins = fftN >> 1;
        const data = new Float32Array(nFrames * nBins);
        const logData = new Float32Array(nFrames * nBins);
        const win = hannWin(fftN);
        let maxPow = 1e-30;
        for (let fr = 0; fr < nFrames; fr++) {
          const off = fr * hop,
            re = new Float32Array(fftN),
            im = new Float32Array(fftN);
          for (let i = 0; i < fftN && off + i < n; i++)
            re[i] = rawSamples[off + i] * win[i];
          fft(re, im, fftN);
          const base = fr * nBins;
          for (let b = 0; b < nBins; b++) {
            const p = re[b] * re[b] + im[b] * im[b];
            data[base + b] = p;
            if (p > maxPow) maxPow = p;
          }
        }
        const logMax = 10 * Math.log10(maxPow + 1e-30);
        for (let i = 0; i < nFrames * nBins; i++)
          logData[i] = 10 * Math.log10(data[i] + 1e-30);
        spectrogramData = {
          frames: nFrames,
          bins: nBins,
          hop,
          fftN,
          data,
          logData,
          maxPow,
          logMax,
        };
        log(
          "Spectrogram " +
            nFrames +
            "×" +
            nBins +
            " bins, fftN=" +
            fftN +
            ", Nyq=" +
            fmtHz(sampleRate / 2),
        );
      }
      function hannWin(n) {
        const w = new Float32Array(n);
        for (let i = 0; i < n; i++)
          w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
        return w;
      }
      function fft(re, im, n) {
        for (let i = 1, j = 0; i < n; i++) {
          let bit = n >> 1;
          for (; j & bit; bit >>= 1) j ^= bit;
          j ^= bit;
          if (i < j) {
            let t = re[i];
            re[i] = re[j];
            re[j] = t;
            t = im[i];
            im[i] = im[j];
            im[j] = t;
          }
        }
        for (let len = 2; len <= n; len <<= 1) {
          const ang = (-2 * Math.PI) / len,
            wr = Math.cos(ang),
            wi = Math.sin(ang);
          for (let i = 0; i < n; i += len) {
            let cr = 1,
              ci = 0;
            for (let j = 0; j < len / 2; j++) {
              const ur = re[i + j],
                ui = im[i + j],
                vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci,
                vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
              re[i + j] = ur + vr;
              im[i + j] = ui + vi;
              re[i + j + len / 2] = ur - vr;
              im[i + j + len / 2] = ui - vi;
              const ncr = cr * wr - ci * wi;
              ci = cr * wi + ci * wr;
              cr = ncr;
            }
          }
        }
      }
      function recomputeEnv() {
        if (rawSamples) {
          computeEnvelope();
          render();
        }
      }
      // Changing the FFT size re-runs a transform over the whole recording, so
      // on a long file this blocks for seconds with no sign of life.
      async function reprocessSpec() {
        if (!rawSamples) return;
        await withBusy("Rendering spectrogram…", async (progress) => {
          progress("Computing spectrogram…", 0.1);
          await busyTick();
          computeSpectrogram();
          progress("Computing spectral centroid…", 0.7);
          await busyTick();
          computeSpectralCentroid();
          progress("Drawing…", 0.9);
          await busyTick();
          render();
          renderMinimap();
        });
      }

      // ═══════════════════════════════════════════════════════════════════
      // VIEW CONTROLS
      // ═══════════════════════════════════════════════════════════════════
      function onZoom(v) {
        if (!rawSamples) return;
        const t = v / 100,
          minD = 0.005,
          maxD = Math.min(duration, 600);
        viewDur = Math.exp(Math.log(minD) * (1 - t) + Math.log(maxD) * t);
        viewDur = Math.min(viewDur, duration);
        viewStart = Math.max(0, Math.min(viewStart, duration - viewDur));
        $("zoomVal").textContent = viewDur.toFixed(4) + "s";
        render();
        renderMinimap();
      }
      function setViewStart(vs) {
        viewStart = Math.max(0, Math.min(vs, Math.max(0, duration - viewDur)));
        render();
        renderMinimap();
      }
      function onFreqSlider() {
        if (!rawSamples) return;
        const nyq = sampleRate / 2;
        const lo = (parseInt($("fMinSlider").value) / 1000) * nyq;
        const hi = (parseInt($("fMaxSlider").value) / 1000) * nyq;
        if (hi > lo + nyq * 0.005) {
          fvMin = lo;
          fvMax = hi;
        }
        $("fMinLbl").textContent = fmtHz(fvMin);
        $("fMaxLbl").textContent = fmtHz(fvMax);
        render();
      }
      function resetFreq() {
        if (!rawSamples) return;
        fvMin = 0;
        fvMax = sampleRate / 2;
        $("fMinSlider").value = 0;
        $("fMaxSlider").value = 1000;
        $("fMinLbl").textContent = fmtHz(0);
        $("fMaxLbl").textContent = fmtHz(fvMax);
        render();
      }
      function onContrast() {
        specContrast = parseFloat($("contSlider").value) || 60;
        specBright = parseFloat($("brightSlider").value) || 0;
        $("contLbl").textContent = specContrast.toFixed(0);
        $("brightLbl").textContent = specBright.toFixed(0);
        render();
      }
      function onThresh() {
        const pct = parseFloat($("threshPct").value) || 5;
        $("threshPct2").value = pct;
        if (rawSamples)
          $("threshAbs").textContent = ((peakAmp * pct) / 100).toFixed(5);
        render();
      }
      function syncThresh(v) {
        $("threshPct").value = v;
        onThresh();
      }

      // ═══════════════════════════════════════════════════════════════════
      // COLORMAPS — accurate perceptual lookup tables (16-stop keyframes)
      // ═══════════════════════════════════════════════════════════════════

      // Inferno: black→purple→red→orange→yellow→white
      const _INFERNO = [
        [0, 0, 4],
        [40, 11, 84],
        [101, 21, 110],
        [159, 42, 99],
        [212, 72, 66],
        [245, 125, 21],
        [250, 193, 39],
        [252, 255, 164],
      ];
      // Viridis: deep purple→blue→teal→green→yellow
      const _VIRIDIS = [
        [68, 1, 84],
        [72, 40, 120],
        [62, 83, 160],
        [49, 120, 172],
        [38, 153, 168],
        [31, 186, 135],
        [74, 214, 83],
        [160, 239, 33],
        [253, 231, 37],
      ];
      // Hot: black→red→orange→yellow→white
      const _HOT = [
        [0, 0, 0],
        [128, 0, 0],
        [255, 0, 0],
        [255, 128, 0],
        [255, 255, 0],
        [255, 255, 255],
      ];
      // Cyan-Magenta: dark→cyan→white→magenta (good for bioacoustics)
      const _CYAN = [
        [0, 0, 0],
        [0, 64, 128],
        [0, 180, 200],
        [100, 220, 255],
        [255, 255, 255],
        [255, 160, 200],
        [200, 0, 180],
        [80, 0, 80],
      ];

      function lerpCmap(t, stops) {
        t = Math.max(0, Math.min(1, t));
        const n = stops.length - 1;
        const pos = t * n;
        const i = Math.min(n - 1, Math.floor(pos));
        const f = pos - i;
        const a = stops[i],
          b = stops[i + 1];
        return [
          Math.round(a[0] + (b[0] - a[0]) * f),
          Math.round(a[1] + (b[1] - a[1]) * f),
          Math.round(a[2] + (b[2] - a[2]) * f),
        ];
      }

      function cmap(t, m) {
        if (m === "inferno") return lerpCmap(t, _INFERNO);
        if (m === "viridis") return lerpCmap(t, _VIRIDIS);
        if (m === "hot") return lerpCmap(t, _HOT);
        if (m === "cyan") return lerpCmap(t, _CYAN);
        // gray (inverted: signal=dark on white background)
        const v = Math.round(Math.max(0, Math.min(1, 1 - t)) * 255);
        return [v, v, v];
      }

      // ═══════════════════════════════════════════════════════════════════
      // RENDERING — KEY FIX: both canvases use SAME width reference
      // The waveform canvas width = sWrap.clientWidth (NOT wWrap, they differ by sidebar etc.)
      // We force wWrap to match sWrap exactly via JS after layout
      // ═══════════════════════════════════════════════════════════════════
      function getVizWidth() {
        // Both waveform and spectrogram must render with identical pixel widths
        // Use sWrap as the canonical width (spectrogram is the primary view)
        return $("sWrap").clientWidth;
      }

      function render() {
        // Sync waveform wrapper width to spectrogram wrapper width for pixel-perfect alignment
        const W = getVizWidth();
        if (W > 0) {
          $("wWrap").style.width = W + "px";
        }
        renderWave();
        renderSpec();
        renderMinimap();
      }

      function renderWave() {
        const wrap = $("wWrap");
        const W = wrap.clientWidth,
          H = wrap.clientHeight;
        if (W <= 0 || H <= 0) return;
        // Resize canvases to actual pixel dimensions (fixes blurriness on HiDPI too)
        const c = $("waveC");
        c.width = W;
        c.height = H;
        const ic = $("waveI");
        ic.width = W;
        ic.height = H;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#0d1117";
        ctx.fillRect(0, 0, W, H);
        if (!rawSamples) {
          ctx.fillStyle = "#444";
          ctx.font = "12px Consolas,monospace";
          ctx.textAlign = "center";
          ctx.fillText("Open audio — up to 250kHz Nyquist", W / 2, H / 2);
          return;
        }
        const si = Math.floor(viewStart * sampleRate);
        const ei = Math.min(
          rawSamples.length,
          Math.ceil((viewStart + viewDur) * sampleRate),
        );
        const spp = (ei - si) / W,
          mid = H / 2;
        const thr = (peakAmp * parseFloat($("threshPct").value)) / 100;
        if (peakAmp > 0) {
          const ty = mid * (1 - thr / peakAmp);
          ctx.strokeStyle = "rgba(210,153,34,.45)";
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, ty);
          ctx.lineTo(W, ty);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, H - ty);
          ctx.lineTo(W, H - ty);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.beginPath();
        for (let x = 0; x < W; x++) {
          const s = Math.floor(si + x * spp),
            e = Math.min(rawSamples.length, s + Math.max(1, Math.ceil(spp)));
          let mn = 0,
            mx = 0;
          for (let i = s; i < e; i++) {
            const v = rawSamples[i];
            if (v > mx) mx = v;
            if (v < mn) mn = v;
          }
          ctx.moveTo(x + 0.5, mid * (1 - mx / peakAmp));
          ctx.lineTo(x + 0.5, mid * (1 - mn / peakAmp));
        }
        ctx.strokeStyle = "#388bfd";
        ctx.lineWidth = 1;
        ctx.stroke();
        if ($("showEnv").checked && envelope) {
          ctx.beginPath();
          for (let x = 0; x < W; x++) {
            const s = Math.min(envelope.length - 1, Math.floor(si + x * spp));
            const y = mid * (1 - envelope[s] / peakAmp);
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.strokeStyle = "rgba(137,87,229,.85)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.beginPath();
          for (let x = 0; x < W; x++) {
            const s = Math.min(envelope.length - 1, Math.floor(si + x * spp));
            const y = mid * (1 + envelope[s] / peakAmp);
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.strokeStyle = "rgba(137,87,229,.85)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        const ic2 = ic.getContext("2d");
        ic2.clearRect(0, 0, W, H);
        drawOverlay(ic2, W, H, "wave");
        // playhead
        const px = ((playPos - viewStart) / viewDur) * W;
        if (px >= 0 && px <= W) {
          ic2.strokeStyle = "rgba(88,166,255,.9)";
          ic2.lineWidth = 2;
          ic2.beginPath();
          ic2.moveTo(px, 0);
          ic2.lineTo(px, H);
          ic2.stroke();
        }
        if (drawing && drawing.src === "wave")
          drawBox(ic2, drawing, W, H, "wave");
      }

      function renderSpec() {
        const wrap = $("sWrap");
        const W = wrap.clientWidth,
          H = wrap.clientHeight;
        if (W <= 0 || H <= 0) return;
        const sc = $("specC");
        sc.width = W;
        sc.height = H;
        const ic = $("specI");
        ic.width = W;
        ic.height = H;
        const ctx = sc.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);

        // Always draw spectrogram pixels when data available and checkbox on
        if (spectrogramData && $("showSpec").checked) {
          const { frames, bins, hop, logData, logMax } = spectrogramData;
          const nyq = sampleRate / 2;
          const bLo = Math.max(0, Math.floor((fvMin / nyq) * bins));
          const bHi = Math.min(bins - 1, Math.ceil((fvMax / nyq) * bins));
          if (bHi > bLo) {
            const bRange = bHi - bLo;
            const dBfloor = logMax - specContrast;
            const sf = Math.floor((viewStart * sampleRate) / hop);
            const ef = Math.min(
              frames - 1,
              Math.ceil(((viewStart + viewDur) * sampleRate) / hop),
            );
            const framesVis = Math.max(1, ef - sf + 1);
            const img = ctx.createImageData(W, H);
            const cm = $("cmap").value;
            for (let x = 0; x < W; x++) {
              const fr = sf + Math.round((x / W) * framesVis);
              if (fr < 0 || fr >= frames) continue;
              const base = fr * bins;
              for (let y = 0; y < H; y++) {
                const b = Math.round(bLo + (1 - y / H) * bRange);
                if (b < 0 || b >= bins) continue;
                const dB = logData[base + b];
                const t = Math.max(
                  0,
                  Math.min(1, (dB - dBfloor) / specContrast),
                );
                const [r, g, bl] = cmap(t, cm);
                const ii = (y * W + x) * 4;
                img.data[ii] = r;
                img.data[ii + 1] = g;
                img.data[ii + 2] = bl;
                img.data[ii + 3] = 255;
              }
            }
            ctx.putImageData(img, 0, 0);
            drawFreqAxis(H);
          }
        } else if (!$("showSpec").checked) {
          // Show placeholder text when spectrogram hidden but panel visible
          ctx.fillStyle = "#1a1f27";
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = "#444";
          ctx.font = "12px Consolas,monospace";
          ctx.textAlign = "center";
          ctx.fillText("Spectrogram hidden", W / 2, H / 2);
        }

        // ALWAYS draw overlays (annotations/detections/playhead) regardless of spectrogram visibility
        const ic2 = ic.getContext("2d");
        ic2.clearRect(0, 0, W, H);
        if (rawSamples) {
          drawOverlay(ic2, W, H, "spec");
          const px = ((playPos - viewStart) / viewDur) * W;
          if (px >= 0 && px <= W) {
            ic2.strokeStyle = "rgba(88,166,255,.9)";
            ic2.lineWidth = 2;
            ic2.beginPath();
            ic2.moveTo(px, 0);
            ic2.lineTo(px, H);
            ic2.stroke();
          }
        }
        if (drawing && drawing.src === "spec")
          drawBox(ic2, drawing, W, H, "spec");
      }

      function drawFreqAxis(specH) {
        // Freq axis canvas is a sibling of sWrap, same height
        const fc = $("freqAxisC");
        const fw = 46;
        fc.width = fw;
        fc.height = specH;
        $("freqAxisWrap").style.height = specH + "px";
        const ctx = fc.getContext("2d");
        ctx.fillStyle = "#0a0e14";
        ctx.fillRect(0, 0, fw, specH);
        ctx.font = "10px Consolas,monospace";
        ctx.fillStyle = "rgba(139,148,158,.9)";
        const range = fvMax - fvMin,
          rough = Math.max(3, Math.floor(specH / 30));
        const step = niceTick(range / rough);
        const first = Math.ceil(fvMin / step) * step;
        for (let f = first; f <= fvMax; f += step) {
          const y = specH * (1 - (f - fvMin) / range);
          ctx.beginPath();
          ctx.strokeStyle = "rgba(139,148,158,.5)";
          ctx.lineWidth = 1;
          ctx.moveTo(0, y);
          ctx.lineTo(7, y);
          ctx.stroke();
          const lbl =
            f >= 1000
              ? (f / 1000).toFixed(f % 1000 === 0 ? 0 : 1) + "k"
              : f.toFixed(0);
          ctx.fillText(lbl, 9, y + 3);
          // Gridline on spectrogram canvas
          const sc = $("specC"),
            sctx = sc.getContext("2d");
          sctx.strokeStyle = "rgba(60,66,74,.5)";
          sctx.setLineDash([2, 5]);
          sctx.lineWidth = 1;
          sctx.beginPath();
          sctx.moveTo(0, y);
          sctx.lineTo(sc.width, y);
          sctx.stroke();
          sctx.setLineDash([]);
        }
      }

      function drawOverlay(ctx, W, H, src) {
        function tx(t) {
          return ((t - viewStart) / viewDur) * W;
        }
        function fy(f) {
          return H * (1 - (f - fvMin) / (fvMax - fvMin));
        }
        // Preprocessing shows the signal only — annotations and detections
        // belong to Spectral Analysis. (The showAnnots/showDets checkboxes
        // live in the sidebar, which is hidden there, so they cannot be the
        // gate on their own.)
        const showWork = viewerMode !== "preprocess";
        if (showWork && $("showAnnots").checked) {
          annotations.forEach((a) => {
            const x1 = tx(a.start),
              x2 = tx(a.end);
            if (x2 < 0 || x1 > W) return;
            const sel = a.id === selAid;
            if (src === "spec") {
              const y1 = fy(a.fHi),
                y2 = fy(a.fLo);
              const cx1 = Math.max(0, x1),
                cx2 = Math.min(W, x2),
                cy1 = Math.max(0, y1),
                cy2 = Math.min(H, y2);
              ctx.globalAlpha = 0.18;
              ctx.fillStyle = sel ? "#aaffaa" : "#3fb950";
              ctx.fillRect(cx1, cy1, cx2 - cx1, cy2 - cy1);
              ctx.globalAlpha = 1;
              ctx.strokeStyle = sel ? "#88ff88" : "#3fb950";
              ctx.lineWidth = sel ? 2 : 1.5;
              ctx.setLineDash([]);
              ctx.strokeRect(cx1, cy1, cx2 - cx1, cy2 - cy1);
              if (cx2 - cx1 > 28) {
                ctx.font = "10px Consolas,monospace";
                ctx.fillStyle = sel ? "#aaffaa" : "#3fb950";
                ctx.fillText("#" + a.id, cx1 + 3, cy1 + 11);
              }
            } else {
              ctx.globalAlpha = 0.2;
              ctx.fillStyle = sel ? "#aaffaa" : "#3fb950";
              ctx.fillRect(
                Math.max(0, x1),
                0,
                Math.min(W, x2) - Math.max(0, x1),
                H,
              );
              ctx.globalAlpha = 1;
              ctx.strokeStyle = sel ? "#88ff88" : "#3fb950";
              ctx.lineWidth = sel ? 2 : 1.5;
              ctx.setLineDash([]);
              if (x1 >= 0 && x1 <= W) {
                ctx.beginPath();
                ctx.moveTo(x1, 0);
                ctx.lineTo(x1, H);
                ctx.stroke();
              }
              if (x2 >= 0 && x2 <= W) {
                ctx.beginPath();
                ctx.moveTo(x2, 0);
                ctx.lineTo(x2, H);
                ctx.stroke();
              }
            }
          });
        }
        if (showWork && $("showDets").checked) {
          detections.forEach((d) => {
            const x1 = tx(d.start),
              x2 = tx(d.end);
            if (x2 < 0 || x1 > W) return;
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = "#f78166";
            ctx.fillRect(
              Math.max(0, x1),
              0,
              Math.min(W, x2) - Math.max(0, x1),
              H,
            );
            ctx.globalAlpha = 1;
            ctx.strokeStyle = "#f78166";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            if (x1 >= 0 && x1 <= W) {
              ctx.beginPath();
              ctx.moveTo(x1, 0);
              ctx.lineTo(x1, H);
              ctx.stroke();
            }
            if (x2 >= 0 && x2 <= W) {
              ctx.beginPath();
              ctx.moveTo(x2, 0);
              ctx.lineTo(x2, H);
              ctx.stroke();
            }
            ctx.setLineDash([]);
          });
        }

        // ── Preprocessing time selection ─────────────────────────────────
        // Drawn under the trim handles so trim always reads on top when both
        // are present. Blue, to stay clearly distinct from trim's amber and
        // from Spectral Analysis's green selections.
        if (viewerMode === "preprocess" && ppSel && ppSel.t1 > ppSel.t0) {
          const xa = tx(ppSel.t0),
            xb = tx(ppSel.t1);
          const ca = Math.max(0, xa),
            cb = Math.min(W, xb);
          if (cb > ca) {
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = "#58a6ff";
            ctx.fillRect(ca, 0, cb - ca, H);
            ctx.globalAlpha = 1;
          }
          ctx.strokeStyle = "#58a6ff";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          [xa, xb].forEach((x) => {
            if (x < 0 || x > W) return;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
          });
        }

        // ── Visual trim handles ──────────────────────────────────────────
        if (trimMode) {
          const xa = tx(trimSel.t0),
            xb = tx(trimSel.t1);
          // Shade the regions that will be discarded (outside [t0, t1]).
          ctx.fillStyle = "rgba(220,60,60,0.28)";
          if (xa > 0) ctx.fillRect(0, 0, Math.min(xa, W), H);
          if (xb < W) ctx.fillRect(Math.max(0, xb), 0, W - Math.max(0, xb), H);
          // Handle bars.
          const drawHandle = (x, which) => {
            if (x < -4 || x > W + 4) return;
            const active = trimDrag === which;
            ctx.strokeStyle = active ? "#ffd633" : "#ffa657";
            ctx.lineWidth = active ? 3 : 2;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
            // Grab tab in the vertical middle.
            ctx.fillStyle = active ? "#ffd633" : "#ffa657";
            ctx.fillRect(x - 4, H / 2 - 14, 8, 28);
            ctx.fillStyle = "#1a1f27";
            for (let gy = -6; gy <= 6; gy += 4) {
              ctx.fillRect(x - 1.5, H / 2 + gy, 3, 1.5);
            }
          };
          drawHandle(xa, "t0");
          drawHandle(xb, "t1");
          // Off-screen indicators: if a handle is outside the view, draw a small
          // arrow at the edge pointing toward it.
          ctx.fillStyle = "#ffa657";
          const arrow = (atRight, label) => {
            const y = 12;
            const x = atRight ? W - 10 : 10;
            ctx.beginPath();
            if (atRight) {
              ctx.moveTo(x, y - 5);
              ctx.lineTo(x + 7, y);
              ctx.lineTo(x, y + 5);
            } else {
              ctx.moveTo(x, y - 5);
              ctx.lineTo(x - 7, y);
              ctx.lineTo(x, y + 5);
            }
            ctx.closePath();
            ctx.fill();
            ctx.font = "9px Consolas,monospace";
            ctx.fillText(label, atRight ? x - 22 : x + 4, y + 3);
          };
          if (xa < 0) arrow(false, "start");
          else if (xa > W) arrow(true, "start");
          if (xb < 0) arrow(false, "end");
          else if (xb > W) arrow(true, "end");
        }
      }

      function drawBox(ctx, d, W, H, src) {
        const x1 = Math.min(d.x0, d.x1),
          x2 = Math.max(d.x0, d.x1);
        // Full-height preview whenever the resulting annotation will span the
        // whole frequency axis — on the waveform always, and on the
        // spectrogram when "Temporal only" is on — so the rubber band shows
        // what is actually about to be created.
        const fullBand = src !== "spec" || annotTemporalOnly();
        const y1 = fullBand ? 0 : Math.min(d.y0, d.y1);
        const y2 = fullBand ? H : Math.max(d.y0, d.y1);
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = "#ffcc00";
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#ffcc00";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);
      }

      function niceTick(rough) {
        const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-9))));
        const n = rough / mag;
        return n < 1.5 ? mag : n < 3.5 ? 2 * mag : n < 7.5 ? 5 * mag : 10 * mag;
      }

      // ═══════════════════════════════════════════════════════════════════
      // MINIMAP / OVERVIEW
      // ═══════════════════════════════════════════════════════════════════
      function renderMinimap() {
        const wrap = $("minimapWrap");
        const W = wrap.clientWidth,
          H = wrap.clientHeight;
        if (W <= 0) return;
        const c = $("minimapC");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#0a0e14";
        ctx.fillRect(0, 0, W, H);
        if (!rawSamples) {
          // Nothing loaded — clear any stale overview from a since-deleted
          // recording instead of leaving it on screen.
          const win = $("minimapWindow");
          if (win) win.style.display = "none";
          return;
        }
        const winEl = $("minimapWindow");
        if (winEl) winEl.style.display = "";
        // Draw waveform overview
        const n = rawSamples.length,
          spp = n / W;
        ctx.beginPath();
        const mid = H / 2;
        for (let x = 0; x < W; x++) {
          const s = Math.floor(x * spp),
            e = Math.min(n, s + Math.max(1, Math.ceil(spp)));
          let mn = 0,
            mx = 0;
          for (let i = s; i < e; i++) {
            const v = rawSamples[i];
            if (v > mx) mx = v;
            if (v < mn) mn = v;
          }
          ctx.moveTo(x + 0.5, mid * (1 - mx / peakAmp));
          ctx.lineTo(x + 0.5, mid * (1 - mn / peakAmp));
        }
        ctx.strokeStyle = "rgba(56,139,253,.6)";
        ctx.lineWidth = 1;
        ctx.stroke();
        // Draw annotations on minimap — skipped in Preprocessing for the
        // same reason as the main overlay.
        if (viewerMode !== "preprocess") {
          annotations.forEach((a) => {
            const x1 = (a.start / duration) * W,
              x2 = (a.end / duration) * W;
            ctx.fillStyle = "rgba(63,185,80,.5)";
            ctx.fillRect(x1, 0, x2 - x1, H);
          });
          detections.forEach((d) => {
            const x1 = (d.start / duration) * W,
              x2 = (d.end / duration) * W;
            ctx.fillStyle = "rgba(247,129,102,.4)";
            ctx.fillRect(x1, 0, x2 - x1, H);
          });
        }
        // Update view window indicator
        const xStart = (viewStart / duration) * W;
        const xWidth = (viewDur / duration) * W;
        const win = $("minimapWindow");
        win.style.left = xStart + "px";
        win.style.width = Math.max(4, xWidth) + "px";
      }

      function initMinimap() {
        const wrap = $("minimapWrap");
        let dragging = false,
          dragOffsetX = 0;
        const getT = (e) => {
          const rect = wrap.getBoundingClientRect();
          return ((e.clientX - rect.left) / rect.width) * duration;
        };
        const win = $("minimapWindow");
        win.addEventListener("mousedown", (e) => {
          e.preventDefault();
          dragging = true;
          const rect = win.getBoundingClientRect();
          dragOffsetX = e.clientX - rect.left;
        });
        wrap.addEventListener("mousedown", (e) => {
          if (e.target === win) return;
          // Click to center view
          const t = getT(e);
          setViewStart(t - viewDur / 2);
        });
        document.addEventListener("mousemove", (e) => {
          if (!dragging) return;
          const rect = wrap.getBoundingClientRect();
          const xInWrap = e.clientX - rect.left - dragOffsetX;
          const t = (xInWrap / rect.width) * duration;
          setViewStart(t);
        });
        document.addEventListener("mouseup", () => {
          dragging = false;
        });
      }

      // ═══════════════════════════════════════════════════════════════════
      // TOOL & POINTER HANDLING
      // ═══════════════════════════════════════════════════════════════════
      // "Temporal only" annotation mode: the drag's vertical extent is
      // ignored and the annotation covers 0–Nyquist, so a time-only
      // selection can be dragged anywhere on the spectrogram without
      // having to reach the top and bottom edges.
      function annotTemporalOnly() {
        const el = $("annotTemporal");
        return !!(el && el.checked);
      }

      function setTool(t) {
        activeTool = t;
        $("toolSelect").classList.toggle("atool", t === "select");
        $("toolAnnot").classList.toggle("atool", t === "annotate");
        $("toolPan").classList.toggle("atool", t === "pan");
        const cursor =
          t === "pan" ? "grab" : t === "annotate" ? "crosshair" : "default";
        $("waveI").style.cursor = cursor;
        $("specI").style.cursor = cursor;
      }
      // True while Spectral Analysis is the visible tab. Ctrl+Z is claimed by
      // both this module and Temporal Analysis's peak undo, so each defers to
      // the other based on which tab the user is actually looking at.
      function isAnalyzerTabActive() {
        const t = $("maintab-analyzer");
        return !!(t && t.classList.contains("active"));
      }

      document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")
          return;
        if (
          (e.key === "z" || e.key === "Z") &&
          (e.ctrlKey || e.metaKey) &&
          !e.shiftKey &&
          !e.altKey &&
          isAnalyzerTabActive()
        ) {
          undoAnnot();
          e.preventDefault();
          return;
        }
        // Space is a transport key and works wherever the viewer is; the
        // rest act on selections and would otherwise fire invisibly from
        // Preprocessing (or Temporal Analysis), silently switching the tool
        // or deleting a selection the user cannot see.
        if (e.key === " ") {
          e.preventDefault();
          togglePlay();
          return;
        }
        if (!isAnalyzerTabActive()) return;
        if (e.key === "s" || e.key === "S") setTool("select");
        if (e.key === "a" || e.key === "A") setTool("annotate");
        if (e.key === "h" || e.key === "H") setTool("pan");
        if ((e.key === "Delete" || e.key === "Backspace") && selAid !== null) {
          deleteAnnot(selAid);
          selAid = null;
          render();
        }
      });

      function makePointer(canvasId, src) {
        const c = $(canvasId);
        c.style.position = "absolute";
        c.style.top = "0";
        c.style.left = "0";
        c.style.width = "100%";
        c.style.height = "100%";

        c.addEventListener("mousemove", (e) => {
          if (!rawSamples) return;
          const { t, f } = pixToTF(e.offsetX, e.offsetY, src);
          $("cursorInfo").textContent = "t=" + t.toFixed(5) + "s  " + fmtHz(f);
          if (trimMode) {
            if (trimDrag === "t0" || trimDrag === "t1") {
              // Resizing one edge from its handle; keep t0 < t1 with a small min gap.
              const minGap = 0.001;
              let nt = Math.max(0, Math.min(duration, t));
              if (trimDrag === "t0")
                trimSel.t0 = Math.min(nt, trimSel.t1 - minGap);
              else trimSel.t1 = Math.max(nt, trimSel.t0 + minGap);
              trimSel.t0 = Math.max(0, trimSel.t0);
              trimSel.t1 = Math.min(duration, trimSel.t1);
              updateTrimReadout();
              render();
            } else if (trimDrag === "move") {
              // Dragging the whole kept region — same duration, shifted by
              // exactly the mouse delta, clamped to stay in bounds.
              const dt = t - trimMoveStartT;
              let nt0 = trimMoveStartT0 + dt;
              let nt1 = trimMoveStartT1 + dt;
              if (nt0 < 0) {
                nt1 -= nt0;
                nt0 = 0;
              }
              if (nt1 > duration) {
                nt0 -= nt1 - duration;
                nt1 = duration;
              }
              trimSel.t0 = Math.max(0, nt0);
              trimSel.t1 = Math.min(duration, nt1);
              updateTrimReadout();
              c.style.cursor = "grabbing";
              render();
            } else if (trimDrag === "new") {
              // Dragging out a brand-new selection from an empty-space click.
              if (Math.abs(e.offsetX - trimDragStartX) > 3) trimDidDragNew = true;
              const nt = Math.max(0, Math.min(duration, t));
              trimSel.t0 = Math.min(trimNewAnchor, nt);
              trimSel.t1 = Math.max(trimNewAnchor, nt);
              updateTrimReadout();
              c.style.cursor = "crosshair";
              render();
            } else {
              // Hover feedback: resize cursor near a handle, grab hand over
              // the kept region, crosshair over empty space (drag to select).
              c.style.cursor =
                trimHandleHit(e.offsetX) !== null
                  ? "ew-resize"
                  : t > trimSel.t0 && t < trimSel.t1
                    ? "grab"
                    : "crosshair";
            }
            return; // trim mode suppresses other tools
          }
          if (ppDrag) {
            // Button released off-canvas: mouseup never reached us, so the
            // drag would otherwise keep tracking the pointer unpressed.
            if (e.buttons === 0) {
              ppDrag = null;
              return;
            }
            // 3px of slop so a click with a shaky hand stays a click.
            if (Math.abs(e.offsetX - ppDrag.startX) > 3) ppDrag.moved = true;
            if (ppDrag.moved) {
              const nt = Math.max(0, Math.min(duration, t));
              ppSel = {
                t0: Math.min(ppDrag.anchor, nt),
                t1: Math.max(ppDrag.anchor, nt),
              };
              updatePpSelReadout();
              render();
            }
            return;
          }
          if (activeTool === "annotate" && drawing) {
            drawing.x1 = e.offsetX;
            drawing.y1 = e.offsetY;
            render();
          }
          if (activeTool === "pan" && panState) {
            const W = getVizWidth();
            const dx = e.offsetX - panState.startX;
            const dtPerPx = viewDur / W;
            setViewStart(panState.startViewStart - dx * dtPerPx);
            c.style.cursor = "grabbing";
          }
        });
        c.addEventListener("mouseleave", () => {
          $("cursorInfo").textContent = "";
        });
        c.addEventListener("mousedown", (e) => {
          if (!rawSamples || e.button !== 0) return;
          if (trimMode) {
            const { t } = pixToTF(e.offsetX, e.offsetY, src);
            const ct = Math.max(0, Math.min(duration, t));
            // 1) Grab a handle only if the click is genuinely near a VISIBLE one.
            const which = trimHandleHit(e.offsetX);
            if (which !== null) {
              trimDrag = which;
              c.style.cursor = "ew-resize";
              render();
              return;
            }
            // 2) Inside the kept region — drag the whole selection around.
            if (ct > trimSel.t0 && ct < trimSel.t1) {
              trimDrag = "move";
              trimMoveStartT = ct;
              trimMoveStartT0 = trimSel.t0;
              trimMoveStartT1 = trimSel.t1;
              c.style.cursor = "grabbing";
              return;
            }
            // 3) Empty space — drag out a brand-new selection from here.
            trimDrag = "new";
            trimNewAnchor = ct;
            trimPreDragSel = { t0: trimSel.t0, t1: trimSel.t1 };
            trimDidDragNew = false;
            trimDragStartX = e.offsetX;
            trimSel.t0 = ct;
            trimSel.t1 = ct;
            c.style.cursor = "crosshair";
            updateTrimReadout();
            render();
            return;
          }
          // Preprocessing: the viewer is a transport, not an editor. No
          // annotate, no pan tool, no annotation hit-test. A click places the
          // playhead; a drag pulls out a time selection. Both start the same
          // way — which one it turns out to be is settled on mouseup by
          // whether the pointer actually moved. Reached only when trim mode
          // is off, since that branch returns above.
          if (viewerMode === "preprocess") {
            const { t } = pixToTF(e.offsetX, e.offsetY, src);
            ppDrag = { anchor: t, startX: e.offsetX, moved: false };
            seekTo(t);
            return;
          }
          if (activeTool === "annotate") {
            drawing = {
              src,
              x0: e.offsetX,
              y0: e.offsetY,
              x1: e.offsetX,
              y1: e.offsetY,
            };
          } else if (activeTool === "pan") {
            panState = { startX: e.offsetX, startViewStart: viewStart };
            c.style.cursor = "grabbing";
          } else {
            // select
            const hit = hitTest(e, src);
            if (hit !== null) {
              selAid = hit;
              refreshAnnotList();
              render();
            } else {
              selAid = null;
              refreshAnnotList();
              const { t } = pixToTF(e.offsetX, e.offsetY, src);
              // Via seekTo so the pause happens BEFORE the new position is
              // set: pausePb() advances playPos by the elapsed time, so the
              // old order (set, then pause) landed the playhead past the
              // click while playing — and past it by the speed multiplier
              // once playback is not at 100%.
              seekTo(t);
            }
          }
        });
        c.addEventListener("mouseup", (e) => {
          if (trimMode) {
            // A "new" drag that never actually moved was just a click on
            // empty space — restore whatever selection existed before it,
            // instead of collapsing to a zero-length one.
            if (trimDrag === "new" && !trimDidDragNew) {
              trimSel.t0 = trimPreDragSel.t0;
              trimSel.t1 = trimPreDragSel.t1;
              updateTrimReadout();
            }
            trimDrag = null;
            const { t } = pixToTF(e.offsetX, e.offsetY, src);
            c.style.cursor =
              trimHandleHit(e.offsetX) !== null
                ? "ew-resize"
                : t > trimSel.t0 && t < trimSel.t1
                  ? "grab"
                  : "crosshair";
            render();
            return;
          }
          // Preprocessing: settle the gesture. A drag leaves the time
          // selection it pulled out; a plain click clears any existing one
          // (the playhead was already placed on mousedown). Returning early
          // also stops the pan branch below from stomping the seek cursor
          // when the tool left over from Spectral Analysis is Pan.
          if (viewerMode === "preprocess") {
            if (ppDrag && !ppDrag.moved) {
              ppSel = null;
              updatePpSelReadout();
              render();
            }
            ppDrag = null;
            return;
          }
          if (activeTool === "pan") {
            panState = null;
            c.style.cursor = "grab";
            return;
          }
          if (!drawing) return;
          const { t: t1, f: f1 } = pixToTF(e.offsetX, e.offsetY, src);
          const { t: t0, f: f0 } = pixToTF(drawing.x0, drawing.y0, src);
          const tLo = Math.min(t0, t1),
            tHi = Math.max(t0, t1);
          const fLo = Math.min(f0, f1),
            fHi = Math.max(f0, f1);
          if (tHi - tLo > 0.0005) {
            annotSnapshot("draw annotation");
            const nyq = sampleRate / 2;
            // When drawn on waveform, freq covers full range (0–Nyquist).
            // On the spectrogram, use the drawn freq bounds — unless
            // "Temporal only" is on, in which case the vertical drag is
            // ignored and the annotation spans the whole frequency axis, so
            // the user only has to aim at the time axis.
            const fullBand = src === "wave" || annotTemporalOnly();
            const aFlo = fullBand ? 0 : Math.max(0, fLo);
            const aFhi = fullBand ? nyq : Math.min(nyq, fHi);
            const a = {
              id: nextAid++,
              start: tLo,
              end: tHi,
              fLo: aFlo,
              fHi: aFhi,
              label: "stridulation",
            };
            annotations.push(a);
            selAid = a.id;
            refreshAnnotList();
            log(
              "Annotation #" +
                a.id +
                ": " +
                tLo.toFixed(4) +
                "–" +
                tHi.toFixed(4) +
                "s, " +
                fmtHz(a.fLo) +
                "–" +
                fmtHz(a.fHi),
              "ok",
            );
          }
          drawing = null;
          render();
        });
        // Wheel: time zoom (plain) or freq zoom (Ctrl + spec only)
        c.addEventListener(
          "wheel",
          (e) => {
            e.preventDefault();
            if (!rawSamples) return;
            if (e.ctrlKey && src === "spec") {
              const nyq = sampleRate / 2;
              const { f } = pixToTF(e.offsetX, e.offsetY, src);
              const range = fvMax - fvMin,
                factor = e.deltaY > 0 ? 1.3 : 0.77;
              const nr = Math.min(nyq, Math.max(nyq * 0.005, range * factor));
              fvMin = Math.max(0, f - nr / 2);
              fvMax = Math.min(nyq, f + nr / 2);
              if (fvMin < 0) {
                fvMax = Math.min(nyq, nr);
                fvMin = 0;
              }
              if (fvMax > nyq) {
                fvMin = Math.max(0, nyq - nr);
                fvMax = nyq;
              }
              $("fMinSlider").value = Math.round((fvMin / nyq) * 1000);
              $("fMaxSlider").value = Math.round((fvMax / nyq) * 1000);
              $("fMinLbl").textContent = fmtHz(fvMin);
              $("fMaxLbl").textContent = fmtHz(fvMax);
            } else {
              const W = getVizWidth();
              const { t: tc } = pixToTF(e.offsetX, e.offsetY, src);
              const factor = e.deltaY > 0 ? 1.3 : 0.77;
              viewDur = Math.min(duration, Math.max(0.005, viewDur * factor));
              viewStart = Math.max(
                0,
                Math.min(tc - (viewDur * e.offsetX) / W, duration - viewDur),
              );
              $("zoomSlider").value = Math.round(
                (100 * (Math.log(viewDur) - Math.log(0.005))) /
                  (Math.log(Math.min(duration, 600)) - Math.log(0.005)),
              );
              $("zoomVal").textContent = viewDur.toFixed(4) + "s";
            }
            render();
          },
          { passive: false },
        );
      }

      function pixToTF(x, y, src) {
        const W = getVizWidth();
        const H = $(src === "wave" ? "wWrap" : "sWrap").clientHeight;
        const t = viewStart + (x / W) * viewDur;
        const f =
          src === "spec" ? fvMin + (1 - y / H) * (fvMax - fvMin) : fvMax;
        return { t: Math.max(0, Math.min(duration, t)), f: Math.max(0, f) };
      }
      function hitTest(e, src) {
        const W = getVizWidth();
        const H = $(src === "wave" ? "wWrap" : "sWrap").clientHeight;
        function tx(t) {
          return ((t - viewStart) / viewDur) * W;
        }
        function fy(f) {
          return H * (1 - (f - fvMin) / (fvMax - fvMin));
        }
        for (let i = annotations.length - 1; i >= 0; i--) {
          const a = annotations[i];
          const x1 = tx(a.start),
            x2 = tx(a.end);
          if (src === "spec") {
            const y1 = fy(a.fHi),
              y2 = fy(a.fLo);
            if (
              e.offsetX >= x1 &&
              e.offsetX <= x2 &&
              e.offsetY >= y1 &&
              e.offsetY <= y2
            )
              return a.id;
          } else {
            if (e.offsetX >= x1 && e.offsetX <= x2) return a.id;
          }
        }
        return null;
      }

      // ═══════════════════════════════════════════════════════════════════
      // ANNOTATION MANAGEMENT
      // ═══════════════════════════════════════════════════════════════════

      // ── Undo ───────────────────────────────────────────────────────────
      // Snapshot-based, mirroring the Temporal Analysis peak undo
      // (pkSnapshot/pkUndo). Every action that changes the annotation set
      // stores the state as it was BEFORE the change.
      //
      // nextAid is part of the snapshot, and that is what makes the
      // numbering reset: undo a freshly drawn #7 and the counter goes back
      // to 7, so the next box you draw is #7 again instead of #8 leaving a
      // permanent hole in the sequence.
      //
      // Detections/measurements ride along only so that undoing "Clear
      // Spectrogram" — the one action here that also wipes them — puts back
      // everything it removed rather than half of it.
      const ANNOT_UNDO_LIMIT = 40;
      let annotUndoStack = [];

      function annotSnapshot(label) {
        annotUndoStack.push({
          label,
          annotations: annotations.map((a) => ({ ...a })),
          nextAid,
          selAid,
          detections: detections.map((d) => ({ ...d })),
          detMeasurements: detMeasurements.slice(),
          pkAppliedAnnotationIds:
            typeof pkAppliedAnnotationIds !== "undefined"
              ? pkAppliedAnnotationIds.slice()
              : [],
        });
        if (annotUndoStack.length > ANNOT_UNDO_LIMIT) annotUndoStack.shift();
        annotUpdateUndoButton();
      }

      // Wipe the history when the annotations are replaced wholesale — after
      // loading different audio or trimming the timeline, the old snapshots
      // describe times that no longer point at the same sound.
      function annotResetUndo() {
        annotUndoStack = [];
        annotUpdateUndoButton();
      }

      function annotUpdateUndoButton() {
        const b = $("btnAnnotUndo");
        if (!b) return;
        b.disabled = !annotUndoStack.length;
        b.title = annotUndoStack.length
          ? "Undo: " +
            annotUndoStack[annotUndoStack.length - 1].label +
            "  (Ctrl+Z)  ·  " +
            annotUndoStack.length +
            " step(s) available"
          : "Nothing to undo (Ctrl+Z)";
      }

      function undoAnnot() {
        const snap = annotUndoStack.pop();
        if (!snap) {
          log("Nothing to undo", "warn");
          return;
        }
        annotations = snap.annotations;
        nextAid = snap.nextAid;
        selAid = snap.selAid;
        detections = snap.detections;
        detMeasurements = snap.detMeasurements;
        if (typeof pkAppliedAnnotationIds !== "undefined")
          pkAppliedAnnotationIds = snap.pkAppliedAnnotationIds;
        // refreshAnnotList() clears spectralMetricsRows, which is correct
        // here: metrics computed against the post-change annotations no
        // longer describe the restored ones and must be recomputed.
        refreshAnnotList();
        $("detBadge").textContent = detections.length
          ? "(" + detections.length + ")"
          : "";
        $("detCount").textContent = detMeasurements.length
          ? detMeasurements.length + " units measured"
          : detections.length
            ? detections.length + " detections"
            : "";
        $("btnExport").disabled = !detections.length;
        const _exMeasU = $("btnExportMeas");
        if (detMeasurements.length) {
          renderMeasTable();
          if (_exMeasU) _exMeasU.disabled = false;
          $("btnClearMeas").disabled = false;
        } else {
          $("measHead").innerHTML = "";
          $("measBody").innerHTML = "";
          $("summaryCards").style.display = "none";
          if (_exMeasU) _exMeasU.disabled = true;
          $("btnClearMeas").disabled = true;
        }
        annotUpdateUndoButton();
        log("Undo: " + snap.label, "ok");
        render();
        renderMinimap();
        // Force redraw so the restored overlay is immediately visible.
        setTimeout(render, 50);
      }

      function deleteAnnot(id) {
        if (!annotations.some((a) => a.id === id)) return;
        annotSnapshot("delete annotation #" + id);
        annotations = annotations.filter((a) => a.id !== id);
        refreshAnnotList();
        render();
      }
      function clearAllAnnotations() {
        const hasAnnots = annotations.length > 0;
        const hasDets = detections.length > 0;
        if (!hasAnnots && !hasDets) return;
        const msg =
          hasAnnots && hasDets
            ? `Delete all ${annotations.length} annotations and ${detections.length} detections?`
            : hasAnnots
              ? `Delete all ${annotations.length} annotations?`
              : `Delete all ${detections.length} detections?`;
        if (!confirm(msg)) return;
        annotSnapshot("clear spectrogram");
        annotations = [];
        detections = [];
        detMeasurements = [];
        spectralMetricsRows = null;
        selAid = null;
        nextAid = 1; // restart selection numbering, incl. for later "Apply to Spectral Analysis"
        $("btnExport").disabled = true;
        $("detCount").textContent = "";
        $("detBadge").textContent = "";
        $("measHead").innerHTML = "";
        $("measBody").innerHTML = "";
        $("summaryCards").style.display = "none";
        $("btnSaveSpectralExcel").disabled = true;
        $("btnExportTextReport").disabled = true;
        const _exMeasA = $("btnExportMeas");
        if (_exMeasA) _exMeasA.disabled = true;
        $("btnClearMeas").disabled = true;
        $("btnComputeSpectral").disabled = true;
        refreshAnnotList();
        render();
        renderMinimap();
        // Force redraw to ensure cleared selections are immediately visible
        setTimeout(render, 50);
      }
      function refreshAnnotList() {
        const ul = $("annotList");
        ul.innerHTML = "";
        $("aBadge").textContent = annotations.length
          ? "(" + annotations.length + ")"
          : "";
        const _compute = $("btnComputeSpectral");
        const _save = $("btnSaveSpectralExcel");
        const _report = $("btnExportTextReport");
        const enabled = rawSamples && annotations.length;
        if (_compute) _compute.disabled = !enabled;
        if (_save) _save.disabled = true;
        if (_report) _report.disabled = true;
        spectralMetricsRows = null;
        if (!annotations.length) {
          const d = document.createElement("div");
          d.style.cssText = "color:var(--txt2);font-size:11px;padding:3px 0";
          d.textContent = "None. Use ✏ Annotate tool.";
          ul.appendChild(d);
          return;
        }
        [...annotations]
          .sort((a, b) => a.start - b.start)
          .forEach((a) => {
            const row = document.createElement("div");
            row.className = "arow" + (a.id === selAid ? " sel" : "");
            row.innerHTML =
              '<span style="color:var(--txt3)">#' +
              a.id +
              "</span>" +
              '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' +
              a.start.toFixed(4) +
              "–" +
              a.end.toFixed(4) +
              's">' +
              a.start.toFixed(3) +
              "–" +
              a.end.toFixed(3) +
              "s</span>" +
              '<span style="color:var(--txt2)">' +
              ((a.end - a.start) * 1000).toFixed(1) +
              "ms</span>" +
              '<button class="xbtn" onclick="event.stopPropagation();deleteAnnot(' +
              a.id +
              ')" title="Delete">×</button>';
            row.addEventListener("click", () => {
              selAid = a.id;
              viewStart = Math.max(
                0,
                Math.min(a.start - (a.end - a.start) * 0.5, duration - viewDur),
              );
              refreshAnnotList();
              render();
            });
            ul.appendChild(row);
          });
      }

      // ═══════════════════════════════════════════════════════════════════
      // TEXT SELECTIONS IMPORT / EXPORT
      // ═══════════════════════════════════════════════════════════════════
      $("SelectionsFile").onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const txt = await f.text();
        const rows = parseSelections(txt);
        let added = 0;
        if (rows.length) annotSnapshot("import selections");
        rows.forEach((r) => {
          if (
            !annotations.find(
              (x) =>
                Math.abs(x.start - r.start) < 1e-6 &&
                Math.abs(x.end - r.end) < 1e-6,
            )
          ) {
            annotations.push({ ...r, id: nextAid++ });
            added++;
          }
        });
        log("Imported " + added + " annotations", "ok");
        refreshAnnotList();
        render();
      };
      function parseSelections(txt) {
        const lines = txt.trim().split("\n");
        if (lines.length < 2) return [];
        const sep = lines[0].includes("\t") ? "\t" : ",";
        const hdr = lines[0].split(sep).map((h) => h.trim().toLowerCase());
        const bi = hdr.findIndex(
          (h) =>
            h.includes("beg time") ||
            h === "begin time (s)" ||
            h === "begin time",
        );
        const ei = hdr.findIndex(
          (h) =>
            h.includes("end time") || h === "end time (s)" || h === "end time",
        );
        const li = hdr.findIndex((h) => h.includes("low freq"));
        const hi2 = hdr.findIndex((h) => h.includes("high freq"));
        if (bi < 0 || ei < 0) {
          log("Column not found: " + hdr.join(", "), "err");
          return [];
        }
        const nyq = rawSamples ? sampleRate / 2 : 20000;
        return lines
          .slice(1)
          .map((l) => {
            const c = l.split(sep);
            return {
              start: parseFloat(c[bi]),
              end: parseFloat(c[ei]),
              fLo: li >= 0 ? parseFloat(c[li]) || 0 : 0,
              fHi: hi2 >= 0 ? parseFloat(c[hi2]) || nyq : nyq,
              label: "stridulation",
            };
          })
          .filter(
            (a) => isFinite(a.start) && isFinite(a.end) && a.end > a.start,
          );
      }
      // ═══════════════════════════════════════════════════════════════════
      // EXCEL SELECTION IMPORT (Train / Motif table → selections)
      // ═══════════════════════════════════════════════════════════════════
      $("xlsxSelFile").onchange = async (e) => {
        const f = e.target.files[0];
        e.target.value = ""; // allow re-selecting the same file later
        if (!f) return;
        let workbook;
        try {
          const buf = new Uint8Array(await f.arrayBuffer());
          workbook = await _readXlsx(buf);
        } catch (err) {
          log("Could not read Excel file: " + err.message, "err");
          return;
        }
        const sheetNames = Object.keys(workbook);
        if (!sheetNames.length) {
          log("No sheets found in workbook", "err");
          return;
        }

        // Identify which sheets look like Train / Motif tables (by their columns).
        const classify = (name) => {
          const rows = workbook[name];
          if (!rows || !rows.length) return null;
          const cols = Object.keys(rows[0]).map((c) => c.toLowerCase());
          const has = (a, b) => cols.includes(a) && cols.includes(b);
          if (has("train_start", "train_end")) return "train";
          if (has("motif_start", "motif_end")) return "motif";
          return null;
        };
        const candidates = sheetNames
          .map((n) => ({ name: n, kind: classify(n) }))
          .filter((s) => s.kind);

        if (!candidates.length) {
          log(
            "No Train or Motif table found (need train_start/train_end or motif_start/motif_end columns).",
            "err",
          );
          return;
        }

        let chosen;
        if (candidates.length === 1) {
          chosen = candidates[0];
        } else {
          chosen = await _pickSheetDialog(candidates);
          if (!chosen) {
            log("Import cancelled", "warn");
            return;
          }
        }
        _importXlsxSelections(workbook[chosen.name], chosen.kind, chosen.name);
      };

      // Modal asking which table (Train vs Motif) to import.
      function _pickSheetDialog(candidates) {
        return new Promise((resolve) => {
          const msg = document.createElement("div");
          msg.style.cssText =
            "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);" +
            "background:var(--bg2);border:1px solid var(--border2);border-radius:6px;" +
            "padding:18px 24px;z-index:9999;font-size:13px;color:var(--txt);" +
            "box-shadow:0 4px 24px #0008;min-width:320px;text-align:center";
          let btns = "";
          candidates.forEach((c, i) => {
            const lbl =
              (c.kind === "train" ? "Train table" : "Motif table") +
              " — \u201c" +
              c.name +
              "\u201d";
            btns +=
              "<button data-i='" +
              i +
              "' class='" +
              (i === 0 ? "pri" : "") +
              "' style='font-size:12px;padding:5px 14px;margin:4px'>" +
              lbl +
              "</button>";
          });
          msg.innerHTML =
            "<div style='margin-bottom:6px;font-weight:600'>Import as selections</div>" +
            "<div style='color:var(--txt2);font-size:11px;margin-bottom:14px'>This workbook has more than one selectable table. Which one?</div>" +
            "<div style='display:flex;flex-direction:column;align-items:stretch'>" +
            btns +
            "</div>" +
            "<button id='_xsCancel' style='font-size:12px;padding:4px 12px;margin-top:10px'>Cancel</button>";
          document.body.appendChild(msg);
          msg.querySelectorAll("button[data-i]").forEach((b) => {
            b.onclick = () => {
              document.body.removeChild(msg);
              resolve(candidates[+b.dataset.i]);
            };
          });
          msg.querySelector("#_xsCancel").onclick = () => {
            document.body.removeChild(msg);
            resolve(null);
          };
        });
      }

      // Turn rows of a Train/Motif table into annotations.
      function _importXlsxSelections(rows, kind, sheetName) {
        const startKey = kind === "train" ? "train_start" : "motif_start";
        const endKey = kind === "train" ? "train_end" : "motif_end";
        // tolerant key lookup (case-insensitive)
        const realKey = (row, want) =>
          Object.keys(row).find((k) => k.toLowerCase() === want);
        const nyq = rawSamples ? sampleRate / 2 : 20000;
        let added = 0,
          skipped = 0;
        if (rows.length) annotSnapshot("import " + kind + " selections");
        rows.forEach((row) => {
          const sk = realKey(row, startKey),
            ek = realKey(row, endKey);
          const start = parseFloat(row[sk]),
            end = parseFloat(row[ek]);
          if (!isFinite(start) || !isFinite(end) || end <= start) {
            skipped++;
            return;
          }
          const dup = annotations.find(
            (x) =>
              Math.abs(x.start - start) < 1e-6 && Math.abs(x.end - end) < 1e-6,
          );
          if (dup) {
            skipped++;
            return;
          }
          const idCol = kind === "train" ? "train_id" : "motif_id";
          const ik = realKey(row, idCol);
          const label =
            kind === "train"
              ? "train" + (ik ? " " + row[ik] : "")
              : "motif" + (ik ? " " + row[ik] : "");
          annotations.push({
            start,
            end,
            fLo: 0,
            fHi: nyq,
            label,
            id: nextAid++,
          });
          added++;
        });
        log(
          "Imported " +
            added +
            " " +
            kind +
            " selections from \u201c" +
            sheetName +
            "\u201d" +
            (skipped ? " (" + skipped + " skipped)" : ""),
          "ok",
        );
        refreshAnnotList();
        render();
        renderMinimap();
        // The imported rows land as Spectral Analysis selections (annotations),
        // so surface that tab — otherwise triggering this from any other tab
        // (e.g. Temporal Analysis) silently updates a view nobody is looking
        // at and looks like the button did nothing.
        switchMainTab("analyzer", $("maintab-analyzer"));
        setTimeout(render, 50);
      }

      // ── Self-contained XLSX reader (no dependencies) ─────────────────────
      // Returns { sheetName: [ {col: value, ...}, ... ] }. Handles stored and
      // DEFLATE-compressed ZIP entries, shared strings, and inline strings.
      async function _readXlsx(bytes) {
        const files = await _unzip(bytes);
        const dec = new TextDecoder("utf-8");
        const getText = (path) =>
          files[path] ? dec.decode(files[path]) : null;

        // Map sheet name → target path via workbook.xml + rels.
        const wbXml = getText("xl/workbook.xml");
        if (!wbXml) throw new Error("not a valid xlsx (missing workbook.xml)");
        const relsXml = getText("xl/_rels/workbook.xml.rels") || "";
        const relMap = {}; // rId → target
        for (const m of relsXml.matchAll(
          /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g,
        )) {
          relMap[m[1]] = m[2];
        }
        // Also handle attribute order variations.
        for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
          const attrs = m[1];
          const id = (attrs.match(/Id="([^"]+)"/) || [])[1];
          const tgt = (attrs.match(/Target="([^"]+)"/) || [])[1];
          if (id && tgt && !(id in relMap)) relMap[id] = tgt;
        }

        // Shared strings (optional).
        const sst = [];
        const sstXml = getText("xl/sharedStrings.xml");
        if (sstXml) {
          // The self-closing form is matched FIRST and on purpose. Cells refer
          // to shared strings by index, so an entry that fails to match is not
          // merely lost — every later index shifts down by one and the whole
          // table reads as someone else's text. "<si\b[^>]*>" would happily
          // treat "<si/>" as an opening tag and then swallow everything up to
          // the next "</si>", which is exactly how that shift happens.
          for (const si of sstXml.matchAll(
            /<si\b[^>]*?\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g,
          )) {
            if (si[1] === undefined) {
              sst.push("");
              continue;
            }
            // concatenate all <t> runs inside this <si>
            let s = "";
            for (const t of si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
              s += _xmlUnesc(t[1]);
            sst.push(s);
          }
        }

        const sheets = {};
        for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
          const attrs = m[1];
          const name = _xmlUnesc(
            (attrs.match(/name="([^"]*)"/) || [])[1] || "Sheet",
          );
          const rid = (attrs.match(/r:id="([^"]+)"/) ||
            attrs.match(/id="([^"]+)"/) ||
            [])[1];
          let target = relMap[rid];
          if (!target) continue;
          if (!target.startsWith("/"))
            target = "xl/" + target.replace(/^\.\//, "");
          else target = target.slice(1);
          const sheetXml = getText(target);
          if (!sheetXml) continue;
          sheets[name] = _parseSheet(sheetXml, sst);
        }
        return sheets;
      }

      function _parseSheet(xml, sst) {
        // Collect cells as {col-letter, rowNum, value}.
        const cells = [];
        let maxRow = 0;
        // Same hazard one level up: an entirely empty row is written as
        // <row r="5"/>, which as an "opening" tag would swallow the row after
        // it. Matched and skipped explicitly instead — an empty row has no
        // cells to contribute anyway.
        for (const rm of xml.matchAll(
          /<row\b[^>]*?\/>|<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g,
        )) {
          if (rm[1] === undefined) continue;
          const rNum = +rm[1];
          if (rNum > maxRow) maxRow = rNum;
          // The attribute group MUST be lazy. Greedy, "[^>]*" swallows the
          // trailing slash of an empty cell written as <c r="B2"/>, which
          // leaves the "\/>" branch unmatchable; the match then falls into the
          // ">...</c>" branch and runs on to the NEXT cell's "</c>", eating it
          // whole. The blank cell reads as empty (correct by luck) and the
          // column after it disappears from the row entirely.
          //
          // That is not a corner case: exports written without a temperature
          // have an empty temp_c, so specimen_id — the very next column — was
          // read as blank in every row of the file, while species and locality
          // two columns further on were fine. Lazy matching lets "\/>" win on
          // a self-closing cell, which is what the alternation intended.
          for (const cm of rm[2].matchAll(
            /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
          )) {
            const attrs = cm[1];
            const inner = cm[2] || "";
            const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
            const type = (attrs.match(/t="([^"]+)"/) || [])[1];
            let val = "";
            if (type === "s") {
              const v = (inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
              val = v != null ? (sst[+v] != null ? sst[+v] : "") : "";
            } else if (type === "inlineStr") {
              let s = "";
              for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
                s += _xmlUnesc(t[1]);
              val = s;
            } else if (type === "str") {
              val = _xmlUnesc(
                (inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1] || "",
              );
            } else {
              // number / general
              const v = (inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
              val = v != null ? v : "";
            }
            // Whether the cell was written as TEXT matters downstream: a
            // specimen id of "0012" is a label, not the number 12.
            if (ref)
              cells.push({
                col: ref,
                row: rNum,
                val,
                text: type === "s" || type === "inlineStr" || type === "str",
              });
          }
        }
        if (!cells.length) return [];
        // Header from row 1; map column letters → header names.
        const headerCells = cells
          .filter((c) => c.row === 1)
          .sort((a, b) => _colNum(a.col) - _colNum(b.col));
        const colName = {};
        headerCells.forEach((c) => {
          // Header text is normalised before it becomes a key. A stray space,
          // a non-breaking space pasted in from a document, or a leading BOM
          // is invisible in Excel but makes "specimen_id " a different column
          // from "specimen_id" to every lookup downstream — the tag would then
          // be reported as missing from a file that plainly shows it.
          colName[c.col] = _normHeader(c.val);
        });
        const out = [];
        for (let r = 2; r <= maxRow; r++) {
          const rowCells = cells.filter((c) => c.row === r);
          if (!rowCells.length) continue;
          const obj = {};
          let any = false;
          headerCells.forEach((hc) => {
            const cell = rowCells.find((c) => c.col === hc.col);
            const raw = cell ? cell.val : "";
            // Two columns can carry the same header — a workbook re-saved with
            // a column re-added beside the original, or one hand-edited copy
            // pasted next to another. Iterating in column order, the later one
            // used to win outright, so a blank duplicate silently erased a
            // populated first column for every row in the file. Keep whichever
            // occurrence actually holds something.
            if (colName[hc.col] in obj && (raw === "" || raw === null)) return;
            // Numeric coercion, but never at the cost of what the cell said.
            //
            // A cell Excel marked as text keeps its string form unless the
            // number round-trips back to exactly the same characters. That is
            // what protects zero-padded specimen ids ("0012" is an animal, not
            // 12), ids that read as exponents ("1e3"), decimals written with a
            // trailing zero ("1.50"), and "0x1A", which Number() happily turns
            // into 26. Cells written as numbers are coerced unconditionally —
            // they round-trip by construction, so measurements are unaffected.
            let num = raw;
            if (raw !== "" && raw !== null && !isNaN(raw)) {
              const n = Number(raw);
              if (!(cell && cell.text) || String(n) === String(raw).trim())
                num = n;
            }
            obj[colName[hc.col]] = num;
            if (raw !== "") any = true;
          });
          if (any) out.push(obj);
        }
        return out;
      }
      function _colNum(letters) {
        let n = 0;
        for (let i = 0; i < letters.length; i++)
          n = n * 26 + (letters.charCodeAt(i) - 64);
        return n;
      }
      // Column header → the key it becomes on every parsed row. Strips a
      // leading BOM, folds the space-like characters that survive a copy-paste
      // out of Word or a web page (non-breaking, figure and narrow no-break
      // spaces) into ordinary spaces, then trims. Case is left alone: lookups
      // that need it compare case-insensitively, and the header is still shown
      // to the user as they wrote it.
      function _normHeader(s) {
        return String(s == null ? "" : s)
          .replace(/^\uFEFF/, "")
          .replace(/[\u00A0\u2007\u202F\u200B]/g, " ")
          .trim();
      }

      function _xmlUnesc(s) {
        return String(s == null ? "" : s)
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
          .replace(/&amp;/g, "&");
      }

      // ── Minimal ZIP reader (stored + DEFLATE via DecompressionStream) ─────
      async function _unzip(bytes) {
        const dv = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        // Find End Of Central Directory (search backwards for signature 0x06054b50).
        let eocd = -1;
        for (let i = bytes.length - 22; i >= 0; i--) {
          if (dv.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
          }
        }
        if (eocd < 0) throw new Error("not a zip/xlsx file");
        const cdCount = dv.getUint16(eocd + 10, true);
        let cdOffset = dv.getUint32(eocd + 16, true);

        const out = {};
        let p = cdOffset;
        for (let k = 0; k < cdCount; k++) {
          if (dv.getUint32(p, true) !== 0x02014b50) break;
          const method = dv.getUint16(p + 10, true);
          const compSize = dv.getUint32(p + 20, true);
          const nameLen = dv.getUint16(p + 28, true);
          const extraLen = dv.getUint16(p + 30, true);
          const commLen = dv.getUint16(p + 32, true);
          const lho = dv.getUint32(p + 42, true);
          const name = new TextDecoder().decode(
            bytes.subarray(p + 46, p + 46 + nameLen),
          );
          // Local header: recompute data offset (name+extra lengths can differ).
          const lNameLen = dv.getUint16(lho + 26, true);
          const lExtraLen = dv.getUint16(lho + 28, true);
          const dataStart = lho + 30 + lNameLen + lExtraLen;
          const comp = bytes.subarray(dataStart, dataStart + compSize);
          let data;
          if (method === 0) {
            data = comp.slice();
          } else if (method === 8) {
            data = await _inflateRaw(comp);
          } else {
            throw new Error(
              "unsupported zip compression method " + method + " in " + name,
            );
          }
          out[name] = data;
          p += 46 + nameLen + extraLen + commLen;
        }
        return out;
      }
      async function _inflateRaw(comp) {
        if (typeof DecompressionStream === "undefined")
          throw new Error(
            "this browser can't decompress .xlsx (DecompressionStream unavailable)",
          );
        const ds = new DecompressionStream("deflate-raw");
        const stream = new Response(comp).body.pipeThrough(ds);
        const ab = await new Response(stream).arrayBuffer();
        return new Uint8Array(ab);
      }

      function exportAnnotations() {
        if (!annotations.length) {
          log("No annotations", "warn");
          return;
        }
        const sorted = [...annotations].sort((a, b) => a.start - b.start);
        let txt =
          "Selection\tView\tChannel\tBegin Time (s)\tEnd Time (s)\tLow Freq (Hz)\tHigh Freq (Hz)\tAnnotation\n";
        sorted.forEach((a, i) => {
          txt +=
            i +
            1 +
            "\tSpectrogram 1\t1\t" +
            a.start.toFixed(6) +
            "\t" +
            a.end.toFixed(6) +
            "\t" +
            a.fLo.toFixed(2) +
            "\t" +
            a.fHi.toFixed(2) +
            "\t" +
            a.label +
            "\n";
        });
        dlFile("annotations_raven.txt", txt, "text/plain");
        log("Exported " + sorted.length + " annotations", "ok");
      }

      // ═══════════════════════════════════════════════════════════════════
      // AMPLITUDE DETECTOR
      // ═══════════════════════════════════════════════════════════════════
      function runAmpDetector() {
        if (!rawSamples) {
          log("Load audio first", "warn");
          return;
        }
        const thr = (peakAmp * parseFloat($("threshPct").value)) / 100;
        const minDurSamp = Math.round(
          (parseFloat($("minDurMs").value) / 1000) * sampleRate,
        );
        const minGapSamp = Math.round(
          (parseFloat($("minGapMs").value) / 1000) * sampleRate,
        );
        const n = envelope.length,
          mask = new Uint8Array(n);
        for (let i = 0; i < n; i++) mask[i] = envelope[i] >= thr ? 1 : 0;
        const segs = [];
        let inSeg = false,
          ss = 0;
        for (let i = 0; i < n; i++) {
          if (!inSeg && mask[i]) {
            inSeg = true;
            ss = i;
          } else if (inSeg && !mask[i]) {
            segs.push({ s: ss, e: i });
            inSeg = false;
          }
        }
        if (inSeg) segs.push({ s: ss, e: n - 1 });
        const merged = [];
        segs.forEach((seg) => {
          if (merged.length && seg.s - merged[merged.length - 1].e < minGapSamp)
            merged[merged.length - 1].e = seg.e;
          else merged.push({ ...seg });
        });
        detections = merged
          .filter((s) => s.e - s.s >= minDurSamp)
          .map((s) => ({ start: s.s / sampleRate, end: s.e / sampleRate }));
        log("Amplitude detector: " + detections.length + " units", "ok");
        $("detCount").textContent = detections.length + " detections";
        $("detBadge").textContent = "(" + detections.length + ")";
        $("btnExport").disabled = false;
        if (detections.length) {
          // Show the detections on the spectrogram immediately. Defer ALL
          // spectral computation until the user clicks "Spectral Metrics".
          // Clear any stale measurements so nothing looks pre-computed.
          detMeasurements = [];
          spectralMetricsRows = null;
          $("measHead").innerHTML = "";
          $("measBody").innerHTML = "";
          $("summaryCards").style.display = "none";
          const computeBtn = $("btnComputeSpectral");
          if (computeBtn) computeBtn.disabled = false;
          const clearMeasBtn = $("btnClearMeas");
          if (clearMeasBtn) clearMeasBtn.disabled = true;
          // No metrics yet -> keep Save Excel disabled until Spectral Metrics runs.
          const saveExcel = $("btnSaveSpectralExcel");
          if (saveExcel) saveExcel.disabled = true;
          const reportBtn = $("btnExportTextReport");
          if (reportBtn) reportBtn.disabled = true;
        }
        render();
        renderMinimap();
        switchMainTab("analyzer", $("maintab-analyzer"));
        switchTab("detect", document.querySelector(".tab"));
        // Force redraw after tab switch/layout
        setTimeout(render, 50);
      }

      // ═══════════════════════════════════════════════════════════════════
      // MEASUREMENTS
      // ═══════════════════════════════════════════════════════════════════
      // Choose the FFT size for MEASUREMENTS based on the target frequency
      // resolution (Hz), independent of the display spectrogram. Frequency
      // resolution of an FFT is sampleRate/fftN, so we pick the smallest power of
      // two with fftN >= sampleRate/targetRes. Capped to keep it responsive.
      function measFftSize() {
        const targetRes = Math.max(1, parseFloat($("measFreqRes").value) || 10);
        const need = sampleRate / targetRes;
        let fftN = 256;
        while (fftN < need && fftN < 1048576) fftN <<= 1;
        return fftN;
      }
      function onMeasResChange() {
        if (rawSamples) {
          const fftN = measFftSize();
          $("measResInfo").textContent =
            "≈ " + (sampleRate / fftN).toFixed(2) + " Hz (FFT " + fftN + ")";
        }
        if (detections.length && rawSamples) computeMeasurements();
      }

      // Compute spectral metrics for every selection (annotation) and export the
      // combined table (selection fields + spectral fields) as an Excel workbook.
      let spectralMetricsRows = null;

      function exportSelectionSpectra() {
        return saveSpectralMetricsExcel();
      }

      function computeUnifiedSpectralMetrics() {
        if (annotations && annotations.length) {
          computeSelectionSpectralMetrics();
          return;
        }
        if (detections && detections.length) {
          // Compute measurements from the amplitude detections now (this is the
          // step that was deferred from runAmpDetector).
          computeMeasurements();
          const saveBtn = $("btnSaveSpectralExcel");
          if (saveBtn) saveBtn.disabled = false;
          const reportBtn = $("btnExportTextReport");
          if (reportBtn) reportBtn.disabled = false;
          log(
            "Computed measurements from detections; see Measurements pane.",
            "ok",
          );
          return;
        }
        log(
          "No selections or detections available to compute spectral metrics.",
          "warn",
        );
      }

      function computeSelectionSpectralMetrics() {
        if (!rawSamples) {
          log("Load audio first", "warn");
          return;
        }
        if (!annotations.length) {
          log(
            "No selections to analyse — import or draw selections first.",
            "warn",
          );
          return;
        }

        const sorted = [...annotations].sort((a, b) => a.start - b.start);
        // Compute per-selection spectral metrics and mirror them into the
        // measurements table so the Detections & measurements pane always shows
        // the results regardless of how selections were created.
        spectralMetricsRows = sorted.map((a, i) => {
          const m = computeSpectralMetrics(a.start, a.end);
          const prev = i > 0 ? sorted[i - 1] : null;
          return {
            source_file: pkSourceFile(),
            temp_c: currentTempC,
            specimen_id: currentSpecimenId,
            species: currentSpecies,
            country: currentCountry,
            locality: currentLocality,
            selection: i + 1,
            label: a.label || "",
            start: Math.round(a.start * 1e6) / 1e6,
            end: Math.round(a.end * 1e6) / 1e6,
            dur_ms: Math.round((a.end - a.start) * 1e5) / 1e2,
            gap_ms: prev ? Math.round((a.start - prev.end) * 1e5) / 1e2 : null,
            sel_low_freq_khz: Math.round(((a.fLo || 0) / 1000) * 1e3) / 1e3,
            sel_high_freq_khz: Math.round(((a.fHi || 0) / 1000) * 1e3) / 1e3,
            peak_freq_khz: m.peak_freq_khz,
            freq_min_20db_khz: m.freq_min_khz,
            freq_max_20db_khz: m.freq_max_khz,
            bw_20db_khz: m.bw_20db_khz,
            bw_10db_khz: m.bw_10db_khz,
            spec_centroid_khz: m.spec_centroid_khz,
            iq_bw_khz: m.iq_bw_khz,
            spec_entropy: m.spec_entropy,
            spec_flatness: m.spec_flatness,
            q_3db: m.q_3db,
            q_10db: m.q_10db,
            q_20db: m.q_20db,
          };
        });

        // Mirror into the measurement table format so the user sees results in
        // the Measurements pane (same columns as amplitude-detection measurements).
        detMeasurements = spectralMetricsRows.map((r, idx) => ({
          n: idx + 1,
          start: r.start,
          end: r.end,
          dur_ms: r.dur_ms,
          gap_ms: r.gap_ms,
          peak_freq_khz: r.peak_freq_khz,
          freq_min_khz: r.freq_min_20db_khz,
          freq_max_khz: r.freq_max_20db_khz,
          bw_20db_khz: r.bw_20db_khz,
          bw_10db_khz: r.bw_10db_khz,
          spec_centroid_khz: r.spec_centroid_khz,
          iq_bw_khz: r.iq_bw_khz,
          spec_entropy: r.spec_entropy,
          spec_flatness: r.spec_flatness,
          q_3db: r.q_3db,
          q_10db: r.q_10db,
          q_20db: r.q_20db,
        }));

        renderMeasTable();

        const saveBtn = $("btnSaveSpectralExcel");
        if (saveBtn) saveBtn.disabled = false;
        const reportBtn = $("btnExportTextReport");
        if (reportBtn) reportBtn.disabled = false;
        log(
          "Computed spectral metrics for " +
            spectralMetricsRows.length +
            " selections. See Measurements pane; Save Excel when ready.",
          "ok",
        );
      }

      async function saveSpectralMetricsExcel() {
        if (!rawSamples) {
          log("Load audio first", "warn");
          return;
        }
        if (
          !annotations.length &&
          !(detMeasurements && detMeasurements.length)
        ) {
          log(
            "No selections or detections to export — import or detect first.",
            "warn",
          );
          return;
        }
        if (
          !spectralMetricsRows &&
          !(detMeasurements && detMeasurements.length)
        ) {
          log("Compute spectral metrics before saving.", "warn");
          return;
        }

        // Heavy part (summary statistics + XML/ZIP) runs behind the overlay;
        // the save dialog afterwards does not, since that is the user's time,
        // not the app's.
        let built = null;
        try {
          built = await withBusy(
            "Building spectral workbook…",
            async (progress) => {
          const fftN = measFftSize();
          // Choose the canonical rows source: prefer spectralMetricsRows (selections)
          // otherwise fall back to detMeasurements (amplitude-detection results).
          const rows =
            spectralMetricsRows && spectralMetricsRows.length
              ? spectralMetricsRows
              : detMeasurements && detMeasurements.length
                ? detMeasurements
                : [];
          const meta = [
            {
              source_file: pkSourceFile(),
              temp_c: currentTempC,
              specimen_id: currentSpecimenId,
              species: currentSpecies,
              country: currentCountry,
              locality: currentLocality,
              generated: new Date().toISOString(),
              n_selections: rows.length,
              sample_rate_hz: sampleRate,
              measure_fft: fftN,
              freq_resolution_hz: Math.round((sampleRate / fftN) * 1e3) / 1e3,
            },
          ];

          // Build a summary sheet with mean, SD, min, max and N for numeric fields.
          const numericKeys = rows.length
            ? Object.keys(rows[0]).filter((k) => typeof rows[0][k] === "number")
            : [];
          const summary = numericKeys.map((k) => {
            const vals = rows
              .map((r) => r[k])
              .filter((v) => typeof v === "number" && isFinite(v));
            const n = vals.length;
            const mean = n ? vals.reduce((s, v) => s + v, 0) / n : 0;
            const sd = n
              ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
              : 0;
            const mn = n ? Math.min(...vals) : 0;
            const mx = n ? Math.max(...vals) : 0;
            return { metric: k, n: n, mean: mean, sd: sd, min: mn, max: mx };
          });

              progress("Serialising " + rows.length + " rows…", 0.5);
              await busyTick();
              return {
                bytes: _buildXlsx([
                  ["Spectral_Analysis", rows],
                  ["Summary", summary],
                  ["Info", meta],
                ]),
                nRows: rows.length,
              };
            },
          );
        } catch (e) {
          log("Spectral export failed: " + e.message, "err");
          return;
        }
        try {
          const stamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, "-");
          await dlFile(
            "spec_" + stamp + ".xlsx",
            built.bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
          log("Saved spectral analysis for " + built.nRows + " rows", "ok");
        } catch (e) {
          log("Spectral export failed: " + e.message, "err");
        }
      }

      // Compute fixed-resolution spectral metrics for a single time window
      // [start,end] (seconds). Returns an object of spectral features in kHz, or
      // null if audio isn't loaded. Used by both the measurement table and the
      // per-selection spectral export, so the maths lives in exactly one place.
      // Smallest transform we will ever use. Below this the spectrum is too
      // coarse to say anything, even about a single pulse.
      const SPEC_MIN_FFT = 64;
      // Analysis window, in samples, that delivers a requested frequency
      // resolution. Resolution is 1/T, so T = 1/R — and because this is an
      // exact sample count rather than a power of two, the SAME requested
      // resolution gives the same real resolution at 44.1, 48 or 96 kHz.
      // Rounding T up to a power of two was what made those rates disagree.
      function pkFrameForRes(resHz) {
        return Math.max(
          2,
          Math.round(sampleRate / Math.max(0.1, resHz)),
        );
      }

      // Zero-padding factor. The analysis window sets the real resolution; the
      // transform is padded past it so the spectrum is read off a grid finer
      // than the lobes it is measuring. Bin spacing lands near R/4, which
      // keeps threshold-crossing measures like bw_20db from being quantised
      // by the grid.
      const SPEC_PAD_FACTOR = 4;

      // Spectral metrics over [start,end] (seconds).
      //
      // Pass targetResHz to pin the analysis window to a frequency resolution.
      // That is the sample-rate-independent way to make rows comparable: every
      // row is measured over the same DURATION of signal, whatever the file's
      // sample rate. Without it the window follows the span, which is only
      // sensible for a one-off look at a single selection.
      function computeSpectralMetrics(start, end, targetResHz) {
        if (!rawSamples) return null;
        const n = rawSamples.length;
        const s0 = Math.max(0, Math.round(start * sampleRate));
        const s1 = Math.min(n, Math.round(end * sampleRate));
        const span = Math.max(1, s1 - s0);

        // frameSamp — how much signal goes into one transform (sets the real
        // resolution).  fftN — the padded transform length (sets bin spacing).
        let frameSamp, fftN;
        if (targetResHz) {
          frameSamp = Math.min(span, pkFrameForRes(targetResHz));
          fftN = SPEC_MIN_FFT;
          const want = frameSamp * SPEC_PAD_FACTOR;
          while (fftN < want && fftN < 65536) fftN <<= 1;
        } else {
          fftN = measFftSize();
          while (fftN > SPEC_MIN_FFT && fftN > span) fftN >>= 1;
          frameSamp = Math.min(span, fftN);
        }
        const bins = fftN >> 1;
        const binHz = sampleRate / fftN;
        const win = hannWin(frameSamp);
        const hop = Math.max(1, frameSamp >> 2);
        const khz3 = (hz) => Math.round((hz / 1000) * 1000) / 1000;

        const spec = new Float32Array(bins);
        let frames = 0;
        const re = new Float32Array(fftN),
          im = new Float32Array(fftN);

        // One frame: frameSamp windowed samples, centred in a zero-filled
        // buffer of fftN. Never reads beyond [a, a+frameSamp), so a frame can
        // not pull in a neighbouring pulse the way widening the window did.
        const addFrame = (a) => {
          re.fill(0);
          im.fill(0);
          const off = (fftN - frameSamp) >> 1;
          for (let i = 0; i < frameSamp; i++) {
            const si = a + i;
            if (si >= 0 && si < n) re[off + i] = rawSamples[si] * win[i];
          }
          fft(re, im, fftN);
          for (let b = 0; b < bins; b++)
            spec[b] += re[b] * re[b] + im[b] * im[b];
          frames++;
        };

        if (span > frameSamp) {
          // Longer than one window: Welch-average across it.
          for (let off = s0; off + frameSamp <= s1; off += hop) addFrame(off);
          if (frames === 0) addFrame(s1 - frameSamp);
        } else {
          addFrame(s0);
        }
        if (frames > 1) for (let b = 0; b < bins; b++) spec[b] /= frames;

        // Peak bin + parabolic sub-bin refinement
        let peakBin = 0,
          peakPow = 0;
        for (let b = 0; b < bins; b++)
          if (spec[b] > peakPow) {
            peakPow = spec[b];
            peakBin = b;
          }
        let peakBinInterp = peakBin;
        if (peakBin > 0 && peakBin < bins - 1) {
          const ym1 = Math.log(spec[peakBin - 1] + 1e-30);
          const y0 = Math.log(spec[peakBin] + 1e-30);
          const yp1 = Math.log(spec[peakBin + 1] + 1e-30);
          const denom = ym1 - 2 * y0 + yp1;
          if (denom !== 0) {
            let delta = (0.5 * (ym1 - yp1)) / denom;
            if (delta > 0.5) delta = 0.5;
            else if (delta < -0.5) delta = -0.5;
            peakBinInterp = peakBin + delta;
          }
        }
        const peakFreq = peakBinInterp * binHz;

        const pow20 = peakPow * 0.01;
        let bLo20 = peakBin,
          bHi20 = peakBin;
        for (let b = peakBin; b >= 0; b--) {
          if (spec[b] < pow20) {
            bLo20 = b;
            break;
          }
        }
        for (let b = peakBin; b < bins; b++) {
          if (spec[b] < pow20) {
            bHi20 = b;
            break;
          }
        }
        const freqMin20 = bLo20 * binHz,
          freqMax20 = bHi20 * binHz;

        let snum = 0,
          sden = 0;
        for (let b = 0; b < bins; b++) {
          snum += b * binHz * spec[b];
          sden += spec[b];
        }
        const specCent = sden > 0 ? snum / sden : peakFreq;

        // Shape of the power spectrum treated as a distribution over
        // frequency, weighted by power: the 2nd, 3rd and 4th central moments
        // about the centroid.
        //   spread    — spectral standard deviation, in kHz
        //   skewness  — 0 symmetric, >0 tail toward high frequency
        //   kurtosis  — RAW, so 3 is Gaussian; higher means a sharper peak
        //               with heavier tails
        // These are computed over the whole spectrum, the standard definition.
        // That makes them sensitive to the noise floor: broadband background
        // widens the spread and flattens the kurtosis, so they compare cleanly
        // only between windows of the same length. spec_res_hz on every row is
        // what tells you whether two rows are comparable.
        let m2 = 0,
          m3 = 0,
          m4 = 0;
        if (sden > 0) {
          for (let b = 0; b < bins; b++) {
            const d = b * binHz - specCent;
            const w = spec[b] / sden;
            const d2 = d * d;
            m2 += w * d2;
            m3 += w * d2 * d;
            m4 += w * d2 * d2;
          }
        }
        const specSpread = Math.sqrt(Math.max(0, m2));
        const specSkew = specSpread > 0 ? m3 / (specSpread ** 3) : null;
        const specKurt = specSpread > 0 ? m4 / (specSpread ** 4) : null;

        let ent = 0;
        if (sden > 0)
          for (let b = 0; b < bins; b++) {
            const p = spec[b] / sden;
            if (p > 1e-12) ent -= p * Math.log2(p);
          }
        const entNorm = ent / Math.log2(bins);

        let logSum = 0,
          linSum = 0,
          nz = 0;
        for (let b = 0; b < bins; b++)
          if (spec[b] > 0) {
            logSum += Math.log(spec[b]);
            linSum += spec[b];
            nz++;
          }
        const geoMean = nz > 0 ? Math.exp(logSum / nz) : 0;
        const ariMean = nz > 0 ? linSum / nz : 0;
        const flatness = ariMean > 0 ? geoMean / ariMean : 0;

        const pow10 = peakPow * 0.1;
        let bLo10 = peakBin,
          bHi10 = peakBin;
        for (let b = peakBin; b >= 0; b--) {
          if (spec[b] < pow10) {
            bLo10 = b;
            break;
          }
        }
        for (let b = peakBin; b < bins; b++) {
          if (spec[b] < pow10) {
            bHi10 = b;
            break;
          }
        }
        const bw10 = (bHi10 - bLo10) * binHz;

        // -3dB (half-power) bandwidth, for Q-factor. Power ratio for -3dB is
        // 10^(-3/10) ≈ 0.5012, distinct from the amplitude-domain "half" of 0.5.
        const pow3 = peakPow * Math.pow(10, -3 / 10);
        let bLo3 = peakBin,
          bHi3 = peakBin;
        for (let b = peakBin; b >= 0; b--) {
          if (spec[b] < pow3) {
            bLo3 = b;
            break;
          }
        }
        for (let b = peakBin; b < bins; b++) {
          if (spec[b] < pow3) {
            bHi3 = b;
            break;
          }
        }
        const bw3 = (bHi3 - bLo3) * binHz;

        // Q-factor = peak frequency / bandwidth, at each of three standard
        // bandwidth definitions. Null when the bandwidth collapsed to 0 bins
        // (e.g. a single-bin peak at a coarse FFT size).
        const qAt = (bwHz) => (bwHz > 0 ? peakFreq / bwHz : null);
        const q3db = qAt(bw3);
        const q10db = qAt(bw10);
        const q20db = qAt(freqMax20 - freqMin20);

        let cumPow = 0,
          q25b = 0,
          q75b = bins - 1,
          f25 = false,
          f75 = false;
        for (let b = 0; b < bins; b++) {
          cumPow += spec[b];
          if (!f25 && cumPow >= sden * 0.25) {
            q25b = b;
            f25 = true;
          }
          if (!f75 && cumPow >= sden * 0.75) {
            q75b = b;
            f75 = true;
          }
        }
        const iqBw = (q75b - q25b) * binHz;

        return {
          // Signal in one transform. This is what sets the real resolution,
          // and it is the number to check when comparing recordings.
          spec_signal_ms: Math.round((frameSamp / sampleRate) * 1e5) / 1e2,
          // Real resolution, 1/T. Independent of sample rate.
          spec_res_hz: Math.round((sampleRate / frameSamp) * 100) / 100,
          // Bin spacing after zero-padding — interpolation density, NOT
          // resolution. Finer than spec_res_hz by roughly SPEC_PAD_FACTOR.
          spec_bin_hz: Math.round(binHz * 100) / 100,
          peak_freq_khz: khz3(peakFreq),
          freq_min_khz: khz3(freqMin20),
          freq_max_khz: khz3(freqMax20),
          bw_20db_khz: khz3(freqMax20 - freqMin20),
          bw_10db_khz: khz3(bw10),
          spec_centroid_khz: khz3(specCent),
          spec_spread_khz: khz3(specSpread),
          spec_skew: specSkew !== null ? Math.round(specSkew * 1e4) / 1e4 : null,
          spec_kurt: specKurt !== null ? Math.round(specKurt * 1e4) / 1e4 : null,
          iq_bw_khz: khz3(iqBw),
          spec_entropy: Math.round(entNorm * 1e4) / 1e4,
          spec_flatness: Math.round(flatness * 1e4) / 1e4,
          q_3db: q3db !== null ? Math.round(q3db * 100) / 100 : null,
          q_10db: q10db !== null ? Math.round(q10db * 100) / 100 : null,
          q_20db: q20db !== null ? Math.round(q20db * 100) / 100 : null,
        };
      }

      function computeMeasurements() {
        if (!detections.length || !rawSamples) return;
        const fftN = measFftSize();
        const binHz = sampleRate / fftN;
        $("measResInfo").textContent =
          "≈ " + binHz.toFixed(2) + " Hz (FFT " + fftN + ")";

        detMeasurements = detections.map((d, idx) => {
          const tDur = d.end - d.start;
          const gap = idx > 0 ? d.start - detections[idx - 1].end : null;
          const m = computeSpectralMetrics(d.start, d.end);
          return {
            source_file: pkSourceFile(),
            temp_c: currentTempC,
            specimen_id: currentSpecimenId,
            species: currentSpecies,
            country: currentCountry,
            locality: currentLocality,
            n: idx + 1,
            start: d.start,
            end: d.end,
            dur_ms: tDur * 1000,
            gap_ms: gap !== null ? gap * 1000 : null,
            ...m,
          };
        });
        renderMeasTable();
      }

      // Display names and decimal places for the measurements preview. This
      // map is presentation only — the table's COLUMNS come from the keys the
      // rows actually carry (see _measColumns), so a newly added metric shows
      // up in the preview whether or not it is registered here. Anything
      // missing falls back to a humanised key and its raw value.
      const MEAS_COL_META = {
        n: { lbl: "#" },
        selection: { lbl: "#" },
        source_file: { lbl: "Source file" },
        temp_c: { lbl: "Temp (°C)" },
        specimen_id: { lbl: "Specimen" },
        species: { lbl: "Species" },
        country: { lbl: "Country" },
        locality: { lbl: "Locality" },
        label: { lbl: "Label" },
        start: { lbl: "Start (s)", dec: 4 },
        end: { lbl: "End (s)", dec: 4 },
        dur_ms: { lbl: "Dur (ms)", dec: 2 },
        gap_ms: { lbl: "Gap (ms)", dec: 2 },
        sel_low_freq_khz: { lbl: "Sel Low (kHz)", dec: 3 },
        sel_high_freq_khz: { lbl: "Sel High (kHz)", dec: 3 },
        peak_freq_khz: { lbl: "Peak Freq (kHz)", dec: 3 },
        freq_min_khz: { lbl: "Freq Min -20dB (kHz)", dec: 3 },
        freq_max_khz: { lbl: "Freq Max -20dB (kHz)", dec: 3 },
        freq_min_20db_khz: { lbl: "Freq Min -20dB (kHz)", dec: 3 },
        freq_max_20db_khz: { lbl: "Freq Max -20dB (kHz)", dec: 3 },
        bw_20db_khz: { lbl: "BW -20dB (kHz)", dec: 3 },
        bw_10db_khz: { lbl: "BW -10dB (kHz)", dec: 3 },
        q_3db: { lbl: "Q -3dB", dec: 2 },
        q_10db: { lbl: "Q -10dB", dec: 2 },
        q_20db: { lbl: "Q -20dB", dec: 2 },
        spec_centroid_khz: { lbl: "Centroid (kHz)", dec: 3 },
        iq_bw_khz: { lbl: "IQ BW (kHz)", dec: 3 },
        spec_entropy: { lbl: "Entropy", dec: 4 },
        spec_flatness: { lbl: "Flatness", dec: 4 },
      };

      // The rows the preview shows. Deliberately the SAME choice
      // saveSpectralMetricsExcel makes, so what is on screen is what lands in
      // the workbook — the preview used to render detMeasurements only, which
      // drops the metadata, label and selection-bounds columns that the
      // export carries.
      function _measTableRows() {
        return spectralMetricsRows && spectralMetricsRows.length
          ? spectralMetricsRows
          : detMeasurements && detMeasurements.length
            ? detMeasurements
            : [];
      }

      // Union of keys across rows, in first-seen order, so a field present on
      // only some rows still gets a column and the order matches the export's.
      function _measColumns(rows) {
        const seen = [];
        const set = new Set();
        rows.forEach((r) =>
          Object.keys(r).forEach((k) => {
            if (!set.has(k)) {
              set.add(k);
              seen.push(k);
            }
          }),
        );
        return seen.map((k) => {
          const meta = MEAS_COL_META[k] || {};
          return {
            k,
            dec: meta.dec,
            lbl:
              meta.lbl ||
              k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          };
        });
      }

      function _fmtMeasCell(v, dec) {
        if (v === null || v === undefined || v === "") return "—";
        if (typeof v === "number")
          return isFinite(v) ? (dec == null ? String(v) : v.toFixed(dec)) : "—";
        return String(v);
      }

      function renderMeasTable() {
        const rows = _measTableRows();
        if (!rows.length) return;
        const cols = _measColumns(rows);
        const thead = $("measHead");
        thead.innerHTML = "";
        cols.forEach((c) => {
          const th = document.createElement("th");
          th.textContent = c.lbl;
          thead.appendChild(th);
        });
        const tbody = $("measBody");
        tbody.innerHTML = "";
        rows.forEach((m) => {
          const tr = document.createElement("tr");
          cols.forEach((c) => {
            const td = document.createElement("td");
            td.textContent = _fmtMeasCell(m[c.k], c.dec);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        const durs = detMeasurements.map((m) => m.dur_ms);
        const gaps = detMeasurements
          .map((m) => m.gap_ms)
          .filter((v) => v !== null);
        const peaks = detMeasurements.map((m) => m.peak_freq_khz);
        const fmins = detMeasurements.map((m) => m.freq_min_khz);
        const fmaxs = detMeasurements.map((m) => m.freq_max_khz);
        const ents = detMeasurements.map((m) => m.spec_entropy);
        const q3s = detMeasurements
          .map((m) => m.q_3db)
          .filter((v) => v !== null && v !== undefined);
        function mean(a) {
          return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
        }
        function sd(a) {
          const m = mean(a);
          return a.length
            ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)
            : 0;
        }
        function mn(a) {
          return a.length ? Math.min(...a) : 0;
        }
        function mx(a) {
          return a.length ? Math.max(...a) : 0;
        }
        const cards = [
          { lbl: "N detections", v: detMeasurements.length, fmt: (v) => v },
          { lbl: "Mean dur (ms)", v: mean(durs), fmt: (v) => v.toFixed(2) },
          { lbl: "SD dur (ms)", v: sd(durs), fmt: (v) => v.toFixed(2) },
          { lbl: "Min dur (ms)", v: mn(durs), fmt: (v) => v.toFixed(2) },
          { lbl: "Max dur (ms)", v: mx(durs), fmt: (v) => v.toFixed(2) },
          {
            lbl: "Mean gap (ms)",
            v: mean(gaps),
            fmt: (v) => (gaps.length ? v.toFixed(2) : "—"),
          },
          {
            lbl: "Mean peak freq (kHz)",
            v: mean(peaks),
            fmt: (v) => v.toFixed(3),
          },
          { lbl: "SD peak freq (kHz)", v: sd(peaks), fmt: (v) => v.toFixed(3) },
          {
            lbl: "Mean Q -3dB",
            v: mean(q3s),
            fmt: (v) => (q3s.length ? v.toFixed(2) : "—"),
          },
          {
            lbl: "SD Q -3dB",
            v: sd(q3s),
            fmt: (v) => (q3s.length ? v.toFixed(2) : "—"),
          },
          {
            lbl: "Min freq -20dB (kHz)",
            v: mn(fmins),
            fmt: (v) => v.toFixed(3),
          },
          {
            lbl: "Max freq -20dB (kHz)",
            v: mx(fmaxs),
            fmt: (v) => v.toFixed(3),
          },
          { lbl: "Mean Sp. Entropy", v: mean(ents), fmt: (v) => v.toFixed(4) },
          { lbl: "SD Sp. Entropy", v: sd(ents), fmt: (v) => v.toFixed(4) },
        ];
        const sg = $("sumGrid");
        sg.innerHTML = "";
        cards.forEach((c) => {
          const d = document.createElement("div");
          d.className = "scard";
          d.innerHTML =
            '<div class="sv">' +
            c.fmt(c.v) +
            '</div><div class="sl">' +
            c.lbl +
            "</div>";
          sg.appendChild(d);
        });
        $("summaryCards").style.display = "block";
        const _exMeasR = $("btnExportMeas");
        if (_exMeasR) _exMeasR.disabled = false;
        $("btnClearMeas").disabled = false;
        $("detCount").textContent = detMeasurements.length + " units measured";
      }
      function clearMeasurements() {
        detMeasurements = [];
        spectralMetricsRows = null;
        $("measHead").innerHTML = "";
        $("measBody").innerHTML = "";
        $("summaryCards").style.display = "none";
        const _exMeasC = $("btnExportMeas");
        if (_exMeasC) _exMeasC.disabled = true;
        $("btnClearMeas").disabled = true;
        $("btnSaveSpectralExcel").disabled = true;
        $("btnExportTextReport").disabled = true;
        const computeBtn = $("btnComputeSpectral");
        if (computeBtn) computeBtn.disabled = !annotations.length;
        $("detCount").textContent = detections.length
          ? detections.length + " detections"
          : "";
        render();
        renderMinimap();
        // Force redraw to ensure cleared measurements are immediately visible
        setTimeout(render, 50);
      }
      function exportMeasTable() {
        if (!detMeasurements.length) return;
        const cols = [
          "n",
          "start",
          "end",
          "dur_ms",
          "gap_ms",
          "peak_freq_khz",
          "freq_min_khz",
          "freq_max_khz",
          "bw_20db_khz",
          "bw_10db_khz",
          "spec_centroid_khz",
          "iq_bw_khz",
          "spec_entropy",
          "spec_flatness",
        ];
        let csv = cols.join(",") + "\n";
        detMeasurements.forEach((m) => {
          csv +=
            cols
              .map((k) => {
                const v = m[k];
                return v === null
                  ? "NA"
                  : typeof v === "number"
                    ? v.toFixed(6)
                    : v;
              })
              .join(",") + "\n";
        });
        dlFile("rthoptera_measurements.csv", csv, "text/csv");
        log("Exported measurement CSV", "ok");
      }
      function exportDetections() {
        if (!detections.length) return;
        const nyq = rawSamples ? sampleRate / 2 : 20000;
        let txt =
          "Selection\tView\tChannel\tBegin Time (s)\tEnd Time (s)\tLow Freq (Hz)\tHigh Freq (Hz)\tAnnotation\n";
        detections.forEach((d, i) => {
          txt +=
            i +
            1 +
            "\tSpectrogram 1\t1\t" +
            d.start.toFixed(6) +
            "\t" +
            d.end.toFixed(6) +
            "\t0\t" +
            nyq.toFixed(1) +
            "\tstridulation\n";
        });
        dlFile("detections.txt", txt, "text/plain");
        log("Exported " + detections.length + " detections", "ok");
      }
      async function dlFile(defaultFilename, content, mimeType, opts) {
        try {
          const extension = defaultFilename.split(".").pop();
          let finalDefaultPath = defaultFilename;

          // exactName: skip the "rename to match the loaded audio" intercept
          // below — used where the caller has already built a specific,
          // meaningful filename (e.g. a numbered trim-selection export) that
          // must not be collapsed back down to the bare audio file name.
          if (!opts?.exactName && currentAudioFileName) {
            const baseAudioName = currentAudioFileName.replace(/\.[^/.]+$/, "");

            // Smart intercept: match the appendix to what the original export
            // called it.
            //
            // Matched as whole underscore-delimited TOKENS, not bare
            // substrings: "specimen_metadata.json" starts with "spec" but is
            // not a spectral export, and tagging it as one would rename a
            // specimen's metadata after somebody else's analysis.
            //
            // The results tables are all emitted as "Rthoptera_<table>_data",
            // so they are matched on that whole shape rather than on the table
            // word alone — a locality called "Peak District" would otherwise
            // tag a cross-recording summary as a peak table.
            const stem = defaultFilename.replace(/\.[^/.]+$/, "");
            const table = stem.match(
              /(^|_)(peak|train|motif|motseq|summ)_data(_|$)/i,
            );
            let appendix = "";
            if (/(^|_)spec(_|$)/i.test(stem)) appendix = "_spec";
            else if (/(^|_)temp(_|$)/i.test(stem)) appendix = "_temp";
            else if (/(^|_)det(ections)?(_|$)/i.test(stem)) appendix = "_det";
            else if (/(^|_)meas(urements?)?(_|$)/i.test(stem))
              appendix = "_meas";
            else if (table) appendix = "_" + table[2].toLowerCase();
            else if (/(^|_)summ(ary)?(_|$)/i.test(stem)) appendix = "_summ";
            else if (/(^|_)raven(_|$)/i.test(stem)) appendix = "_raven";
            else if (/(^|_)meta(data)?(_|$)/i.test(stem)) appendix = "_meta";

            const outputName = `${baseAudioName}${appendix}.${extension}`;
            if (currentAudioFileFolder) {
              const sep = currentAudioFileFolder.includes("\\") ? "\\" : "/";
              finalDefaultPath = `${currentAudioFileFolder}${sep}${outputName}`;
            } else {
              finalDefaultPath = outputName;
            }
          } else if (opts?.exactName && currentAudioFileFolder) {
            const sep = currentAudioFileFolder.includes("\\") ? "\\" : "/";
            finalDefaultPath = `${currentAudioFileFolder}${sep}${defaultFilename}`;
          }

          // Use Tauri APIs when available (desktop), otherwise fallback to browser download
          if (hasDesktopSaveApi()) {
            const filePath = await window.__TAURI__.dialog.save({
              filters: [{ name: mimeType, extensions: [extension] }],
              defaultPath: finalDefaultPath,
            });

            if (!filePath) {
              log("Export cancelled by user", "info");
              return;
            }

            const isBinary =
              content instanceof Uint8Array ||
              content instanceof ArrayBuffer ||
              ArrayBuffer.isView(content);

            if (isBinary) {
              const binaryData =
                content instanceof Uint8Array
                  ? content
                  : new Uint8Array(content);
              await window.__TAURI__.fs.writeFile(filePath, binaryData);
            } else {
              await window.__TAURI__.fs.writeTextFile(filePath, content);
            }

            log("Successfully saved to: " + filePath, "ok");
          } else {
            console.warn(
              "Tauri desktop save APIs unavailable; falling back to browser download.",
            );
            let blob;
            if (
              content instanceof Uint8Array ||
              content instanceof ArrayBuffer ||
              ArrayBuffer.isView(content)
            ) {
              const arr =
                content instanceof Uint8Array
                  ? content
                  : new Uint8Array(content);
              blob = new Blob([arr], {
                type: mimeType || "application/octet-stream",
              });
            } else {
              blob = new Blob([content], { type: mimeType || "text/plain" });
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = finalDefaultPath;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            log("Browser download started: " + finalDefaultPath, "ok");
          }
        } catch (err) {
          console.error("Desktop file export failed:", err);
          log("Export failed: " + err, "error");
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // PLAYBACK
      // ═══════════════════════════════════════════════════════════════════
      // ── Playback-only frequency drop ───────────────────────────────────
      // The same pitch shift as the Preprocessing edit, but rendered into a
      // SEPARATE buffer that only the playback engine ever sees — rawSamples,
      // every measurement, every export and every plot keep the real
      // frequencies. Duration is preserved by the shift, so the playhead
      // arithmetic below needs no adjustment; only Speed % scales time.
      function playbackDropPct() {
        const el = $("playFreqDrop");
        const v = el ? parseFloat(el.value) : 0;
        return isFinite(v) && v > 0 && v < 100 ? v : 0;
      }

      // Rendered eagerly whenever the setting or the audio changes, so
      // startPb() stays synchronous and just picks a buffer.
      async function refreshPlaybackDropBuffer() {
        const pct = playbackDropPct();
        if (!pct || !rawSamples || !rawSamples.length) {
          _pbBuffer = null;
          _pbDropPct = 0;
          if (isPlaying) {
            pausePb();
            startPb();
          }
          return;
        }
        if (_pbBuffer && _pbDropPct === pct) return;
        await withBusy("Preparing playback…", async () => {
          await busyTick();
          const shifted = applyFreqDrop(rawSamples, pct);
          try {
            if (!audioCtx)
              audioCtx = new (window.AudioContext ||
                window.webkitAudioContext)();
            const buf = audioCtx.createBuffer(
              1,
              shifted.length,
              sampleRate,
            );
            buf.copyToChannel(shifted, 0);
            _pbBuffer = buf;
            _pbDropPct = pct;
          } catch (e) {
            _pbBuffer = null;
            _pbDropPct = 0;
            log("Could not prepare dropped playback: " + e.message, "warn");
          }
        });
        // Swap it in mid-playback rather than waiting for the next press.
        if (isPlaying) {
          pausePb();
          startPb();
        }
      }

      function onPlayDropChange() {
        refreshPlaybackDropBuffer();
      }

      // Playback speed as a fraction of real time, from the "Speed %" box.
      // Web Audio resamples rather than time-stretches, so slowing down also
      // drops the pitch — which is the point for ultrasonic insect song.
      function currentPlayRate() {
        const el = $("playSpeed");
        const pct = el ? parseFloat(el.value) : 100;
        if (!isFinite(pct) || pct <= 0) return 1;
        return Math.min(400, Math.max(5, pct)) / 100;
      }

      // Restart from the current position so the elapsed-time arithmetic
      // below stays exact — playRate is captured per playback, not read live.
      function onPlaySpeedChange() {
        if (isPlaying) {
          pausePb();
          startPb();
        }
      }

      function togglePlay() {
        if (!audioBuffer) return;
        isPlaying ? pausePb() : startPb();
      }
      function startPb() {
        if (!audioCtx)
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();
        if (sourceNode)
          try {
            sourceNode.stop();
          } catch (e) {}
        sourceNode = audioCtx.createBufferSource();
        // The dropped buffer when one is ready, the real audio otherwise —
        // so a press during the (~200 ms) render just plays undropped rather
        // than failing.
        sourceNode.buffer = _pbBuffer || audioBuffer;
        playRate = currentPlayRate();
        sourceNode.playbackRate.value = playRate;
        sourceNode.connect(audioCtx.destination);
        playOff = playPos;
        playT0 = audioCtx.currentTime;
        sourceNode.start(0, Math.max(0, playOff));
        sourceNode.onended = () => {
          if (isPlaying) stopPb();
        };
        isPlaying = true;
        $("btnPlay").textContent = "⏸ Pause";
        raf = requestAnimationFrame(animPH);
      }
      function pausePb() {
        if (sourceNode)
          try {
            sourceNode.stop();
          } catch (e) {}
        // Wall-clock elapsed × rate = audio consumed.
        playPos += (audioCtx.currentTime - playT0) * playRate;
        isPlaying = false;
        $("btnPlay").textContent = "▶ Play";
        cancelAnimationFrame(raf);
      }
      function stopPb() {
        if (sourceNode)
          try {
            sourceNode.stop();
          } catch (e) {}
        playPos = 0;
        isPlaying = false;
        $("btnPlay").textContent = "▶ Play";
        cancelAnimationFrame(raf);
        $("timeDisp").textContent = "0.000 s";
        render();
      }
      // ── Seek / jump to selection edges ─────────────────────────────────
      // "Selection" means whatever is being selected in the tab you are in:
      // the trim handles while trim mode is open (Preprocessing's own
      // selection), otherwise the Spectral Analysis annotation bounds. Both
      // reduce to a sorted list of edge times.
      function selectionEdges() {
        // The recording's own start and end are always stops, so stepping
        // past the first or last selection edge lands on 0 / duration rather
        // than refusing to move.
        const es = [0, duration];
        // Trim handles are global — they show wherever the viewer is parked.
        if (trimMode) es.push(trimSel.t0, trimSel.t1);
        if (viewerMode === "preprocess") {
          if (ppSel) es.push(ppSel.t0, ppSel.t1);
        } else {
          // Annotations are Spectral Analysis's selections and are neither
          // drawn nor jumpable in Preprocessing.
          annotations.forEach((a) => es.push(a.start, a.end));
        }
        const sorted = es
          .filter((t) => isFinite(t) && t >= 0 && t <= duration)
          .sort((a, b) => a - b);
        // Collapse coincident stops (a selection edge sitting on 0, two
        // annotations meeting) so one press does not need two.
        const out = [];
        for (const t of sorted) {
          if (!out.length || t - out[out.length - 1] > 1e-6) out.push(t);
        }
        return out;
      }

      function updatePpSelReadout() {
        const el = $("ppSelReadout");
        const btn = $("btnClearPpSel");
        const has = !!(ppSel && ppSel.t1 > ppSel.t0);
        if (el)
          el.textContent = has
            ? `${ppSel.t0.toFixed(3)}–${ppSel.t1.toFixed(3)} s  (${(ppSel.t1 - ppSel.t0).toFixed(3)} s)`
            : "No selection";
        if (btn) btn.disabled = !has;
      }

      function clearPpSel() {
        ppSel = null;
        updatePpSelReadout();
        render();
      }

      function seekTo(t) {
        // pausePb() advances playPos by the elapsed time, so it has to run
        // BEFORE the new position is set, not after.
        const wasPlaying = isPlaying;
        if (wasPlaying) pausePb();
        playPos = Math.max(0, Math.min(duration, t));
        $("timeDisp").textContent = playPos.toFixed(3) + " s";
        // Recentre only if the target fell outside the current view.
        if (playPos < viewStart || playPos > viewStart + viewDur) {
          viewStart = Math.max(
            0,
            Math.min(playPos - viewDur / 2, Math.max(0, duration - viewDur)),
          );
        }
        if (wasPlaying) startPb();
        render();
      }

      function jumpEdge(dir) {
        if (!rawSamples) return;
        const edges = selectionEdges();
        if (!edges.length) return;
        // Strict comparison with a small tolerance, so repeated presses walk
        // the list instead of sticking on the edge already landed on.
        const eps = 1e-4;
        let target = null;
        if (dir > 0) {
          for (const t of edges)
            if (t > playPos + eps) {
              target = t;
              break;
            }
        } else {
          for (let i = edges.length - 1; i >= 0; i--)
            if (edges[i] < playPos - eps) {
              target = edges[i];
              break;
            }
        }
        // Unreachable in practice — 0 and duration are always in the list, so
        // the only way to find nothing ahead is to already be at the end.
        if (target === null) return;
        seekTo(target);
      }

      function animPH() {
        if (!isPlaying) return;
        playPos = playOff + (audioCtx.currentTime - playT0) * playRate;
        if (playPos >= duration) {
          stopPb();
          return;
        }
        $("timeDisp").textContent = playPos.toFixed(3) + " s";
        if (playPos > viewStart + viewDur * 0.88) {
          viewStart = playPos - viewDur * 0.12;
          viewStart = Math.max(0, Math.min(viewStart, duration - viewDur));
        }
        render();
        raf = requestAnimationFrame(animPH);
      }

      // ═══════════════════════════════════════════════════════════════════
      // HIGH-RESOLUTION RTHOPTERA-STYLE MULTIPLOT
      // Layout (left→right, top→bottom):
      //   [Y-label] [Waveform panel         ] [gap]
      //   [Y-label] [Spectrogram panel      ] [Mean Power Spectrum]
      //             [X-axis / Time label    ]
      // ═══════════════════════════════════════════════════════════════════
      let _plotCanvas = null;

      function plotUseView() {
        $("plotT0").value = viewStart.toFixed(4);
        $("plotT1").value = (viewStart + viewDur).toFixed(4);
        updateAutoWL();
      }
      function plotUseFreqView() {
        $("plotF0").value = Math.round(fvMin);
        $("plotF1").value = Math.round(fvMax);
      }

      // Wire up the override checkbox
      document.addEventListener("DOMContentLoaded", () => {
        const cb = $("plotManualFft");
        if (cb)
          cb.addEventListener("change", () => {
            $("plotFft").disabled = !cb.checked;
          });
        // Update auto WL whenever time range changes
        ["plotT0", "plotT1"].forEach((id) => {
          const el = $(id);
          if (el) el.addEventListener("input", updateAutoWL);
        });
        // Fill opacity live label
        const opSlider = $("plotPsFillOpacity");
        if (opSlider)
          opSlider.addEventListener("input", () => {
            $("plotPsFillOpacityLbl").textContent = parseFloat(
              opSlider.value,
            ).toFixed(2);
          });
      });

      function updateAutoWL() {
        if (!rawSamples) return;
        const t0 = parseFloat($("plotT0").value) || 0;
        const t1 = parseFloat($("plotT1").value) || t0 + 1;
        const D = Math.max(0.001, t1 - t0);
        const k = 0.002; // 20×10⁻⁴ = 0.002
        const wlRaw = sampleRate * Math.sqrt(D) * k;
        // Round to nearest power of 2 (or next power of 2)
        const wlPow2 = nextPow2(Math.round(wlRaw));
        $("plotWlAuto").textContent = `${wlPow2} (raw: ${wlRaw.toFixed(0)})`;
      }
      function nextPow2(n) {
        let p = 1;
        while (p < n) p <<= 1;
        return p;
      }

      // ─── Color utilities ────────────────────────────────────────────────
      function _hexToRgb(hex) {
        hex = hex.replace("#", "");
        if (hex.length === 3)
          hex = hex
            .split("")
            .map((c) => c + c)
            .join("");
        const n = parseInt(hex, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
      function _colorIsLight(hex) {
        const [r, g, b] = _hexToRgb(hex);
        // Perceived luminance
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
      }
      // WCAG relative luminance of one sRGB triple.
      function _relLum(r, g, b) {
        const f = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      }
      // Mean relative luminance of a region that has ALREADY been drawn, for
      // text that has to sit on top of it. Sampling the rendered pixels
      // rather than reasoning about a background color is what makes this
      // work over a colormap, an inverted spectrogram, or loud signal —
      // none of which any single setting describes.
      // Returns null when the pixels cannot be read; the caller then keeps
      // whatever static color it would have used.
      function _regionLuminance(ctx, x, y, w, h) {
        const x0 = Math.max(0, Math.floor(x)),
          y0 = Math.max(0, Math.floor(y));
        const x1 = Math.min(ctx.canvas.width, Math.ceil(x + w)),
          y1 = Math.min(ctx.canvas.height, Math.ceil(y + h));
        if (x1 <= x0 || y1 <= y0) return null;
        let d;
        try {
          d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        } catch (e) {
          return null;
        }
        let sum = 0,
          n = 0;
        // Every 4th pixel — plenty for a mean, and keeps the read cheap at
        // high DPI where the sampled box is a few thousand pixels.
        for (let i = 0; i < d.length; i += 16) {
          sum += _relLum(d[i], d[i + 1], d[i + 2]);
          n++;
        }
        return n ? sum / n : null;
      }
      // Ink for text drawn over a ground of the given relative luminance.
      // Candidates are ordered by how the figure already looks, and the
      // first to clear the WCAG AA body-text ratio (4.5:1) wins — so a light
      // spectrogram keeps today's soft grey, while a dark one switches to
      // near-white. A binary light/dark test is not enough: a mid-tone
      // ground leaves BOTH extremes weak, and there the best of them is
      // taken rather than a fixed one.
      const STAMP_INKS = [
        "#555555",
        "#e6edf3",
        "#111111",
        "#ffffff",
        "#000000",
      ];
      function _pickInk(lum) {
        const ratio = (hex) => {
          const [r, g, b] = _hexToRgb(hex);
          const l = _relLum(r, g, b);
          return (Math.max(l, lum) + 0.05) / (Math.min(l, lum) + 0.05);
        };
        let best = STAMP_INKS[0],
          bestRatio = 0;
        for (const c of STAMP_INKS) {
          const r = ratio(c);
          if (r >= 4.5) return c;
          if (r > bestRatio) {
            bestRatio = r;
            best = c;
          }
        }
        return best;
      }

      async function renderPlot() {
        if (!rawSamples) {
          alert("Load audio first");
          return;
        }
        $("plotStatus").textContent = "Initialising…";
        await yieldUI();

        // ── Parameters ──────────────────────────────────────────────────
        const pxW = parseInt($("plotW").value) || 1800;
        const pxH = parseInt($("plotH").value) || 900;
        const dpr = parseInt($("plotDpi").value) || 2;
        // Colors — read directly from pickers
        const figBg = $("plotFigBg").value || "#ffffff";
        const fgColor = $("plotFgColor").value || "#111111";
        const waveBg = $("plotWaveBg").value || "#ffffff";
        const waveLineColor = $("plotWaveColor").value || "#000000";
        const psBg = $("plotPsBg").value || "#ffffff";
        const psFillColor = $("plotPsFillColor").value || "#000000";
        const psLineColor = psFillColor; // line uses same color as fill
        const psFillOp = parseFloat($("plotPsFillOpacity").value);
        const specBgColor = $("plotSpecBg").value || "#ffffff";
        const invertSpec = $("plotInvertSpec").checked;
        // Derive whether fg is light or dark for gridlines
        const bgIsLight = _colorIsLight(figBg);
        const GRID = bgIsLight ? "rgba(0,0,0,0.10)" : "rgba(80,95,110,0.35)";
        const FG2 = bgIsLight ? "#555555" : "#8b949e";
        const font = $("plotFont").value || "Arial,sans-serif";
        const cm = $("plotCmap").value;
        const contrast = parseFloat($("plotContrast").value) || 60;
        const bright = parseFloat($("plotBright").value) || 0;
        const noiseFloor = parseFloat($("plotNoiseFloor").value) || -50;
        const t0 = Math.max(0, parseFloat($("plotT0").value) || 0);
        const t1 = Math.min(
          duration,
          parseFloat($("plotT1").value) || Math.min(duration, t0 + viewDur),
        );
        const f0 = Math.max(0, parseFloat($("plotF0").value) || 0);
        const f1 = Math.min(
          sampleRate / 2,
          parseFloat($("plotF1").value) || sampleRate / 2,
        );
        const showAnnots = false; // removed from UI
        const showDets = false; // removed from UI
        const showWave = $("plotShowWave").checked;
        const showEnvP = false; // removed from UI
        const title = $("plotTitle").value.trim();
        const specRatio = Math.max(
          1,
          parseFloat($("plotSpecRatio").value) || 3,
        );
        const overlapFrac = parseFloat($("plotOverlap").value) || 0.875;
        const psPxW = parseInt($("plotPsWidth").value) || 160;
        const legendSizePt = parseFloat($("plotLegendSize").value) || 18;
        const tickSizePt = parseFloat($("plotTickSize").value) || 16;
        const timeUnitPref = $("plotTimeUnit").value || "auto"; // 'auto'|'s'|'ms'
        const timeStepPref = $("plotTimeStep").value || "auto"; // 'auto'|seconds
        const freqStepPref = $("plotFreqStep").value || "auto"; // 'auto'|'10000'|'5000'|'2000'

        // ── FFT size: Rthoptera formula with 200% zero padding ──────────
        const D = Math.max(0.001, t1 - t0);
        const k = 0.002;
        const wlRaw = sampleRate * Math.sqrt(D) * k;
        const wlBase = nextPow2(Math.round(wlRaw)); // base window length (samples of actual data)
        // zero-pad by 200% → total FFT size = 3× base (round to next power of 2)
        const fftN = nextPow2(wlBase * 3);
        const actualFftN = $("plotManualFft").checked
          ? parseInt($("plotFft").value) || fftN
          : fftN;
        const hop = Math.max(1, Math.round(wlBase * (1 - overlapFrac)));
        $("plotStatus").textContent =
          `WL=${wlBase} → FFT=${actualFftN} (×3 zero-pad), hop=${hop}…`;
        await yieldUI();

        // ── Extract segment ─────────────────────────────────────────────
        const s0 = Math.floor(t0 * sampleRate),
          s1 = Math.min(rawSamples.length, Math.ceil(t1 * sampleRate));
        const seg = rawSamples.slice(s0, s1);
        const segLen = seg.length;
        const nyq = sampleRate / 2;
        // Envelope for waveform panel
        const envSeg = envelope ? envelope.slice(s0, s1) : null;

        // ── Spectrogram computation ──────────────────────────────────────
        const nBins = actualFftN >> 1;
        const bLo = Math.max(0, Math.floor((f0 / nyq) * nBins));
        const bHi = Math.min(nBins - 1, Math.ceil((f1 / nyq) * nBins));
        const bRange = Math.max(1, bHi - bLo);
        const nFrames = Math.max(1, Math.floor((segLen - wlBase) / hop) + 1);
        // Hann window over wlBase, zero-padded to actualFftN
        const win = hannWin(wlBase);
        const specData = new Float32Array(nFrames * bRange); // log10 power
        const meanPsLinear = new Float32Array(bRange); // mean linear power for PS panel
        let globalMaxLog = -Infinity;

        for (let fr = 0; fr < nFrames; fr++) {
          const off = fr * hop;
          const re = new Float32Array(actualFftN),
            im = new Float32Array(actualFftN);
          // Copy wlBase samples with Hann window; rest stays 0 (zero padding)
          for (let i = 0; i < wlBase && off + i < segLen; i++)
            re[i] = seg[off + i] * win[i];
          fft(re, im, actualFftN);
          const base = fr * bRange;
          for (let b = 0; b < bRange; b++) {
            const bi = bLo + b;
            const p = re[bi] * re[bi] + im[bi] * im[bi];
            meanPsLinear[b] += p;
            const lg = 10 * Math.log10(p + 1e-30);
            specData[base + b] = lg;
            if (lg > globalMaxLog) globalMaxLog = lg;
          }
          if (fr % 300 === 0) {
            $("plotStatus").textContent = `Spec frame ${fr}/${nFrames}…`;
            await yieldUI();
          }
        }
        // Finalise mean PS
        for (let b = 0; b < bRange; b++) meanPsLinear[b] /= nFrames;
        let maxPS = 0;
        for (let b = 0; b < bRange; b++)
          if (meanPsLinear[b] > maxPS) maxPS = meanPsLinear[b];
        if (maxPS < 1e-40) maxPS = 1;

        $("plotStatus").textContent = "Rendering figure…";
        await yieldUI();

        // ── Layout math (all in output px = logical × dpr) ──────────────
        const TW = pxW * dpr,
          TH = pxH * dpr;
        const D2 = dpr; // shorthand
        // Margins
        const ML = Math.round(64 * D2); // left (Y axis labels)
        const MB = Math.round(48 * D2); // bottom (X axis)
        const MT = Math.round((title ? 36 : 14) * D2); // top
        const MR = Math.round(12 * D2); // right outer gap
        const GAP_X = Math.round(6 * D2); // gap between spec and PS
        const GAP_Y = Math.round(4 * D2); // gap between waveform and spec
        const psW = psPxW * D2; // power spectrum panel width
        // Available region
        const availW = TW - ML - MR - GAP_X - psW; // shared x region for waveform+spec
        const availH = TH - MT - MB - (showWave ? GAP_Y : 0);
        // Distribute height
        const waveH = showWave ? Math.round(availH / (specRatio + 1)) : 0;
        const specH = availH - (showWave ? waveH + GAP_Y : 0);
        const specW = availW;
        // Top-left corners
        const waveTop = MT;
        const specTop = MT + (showWave ? waveH + GAP_Y : 0);
        const psLeft = ML + specW + GAP_X;

        // ── Canvas ──────────────────────────────────────────────────────
        const oc = document.createElement("canvas");
        oc.width = TW;
        oc.height = TH;
        const ctx = oc.getContext("2d");
        const BG = figBg;
        const FG = fgColor;
        const FS = Math.round(tickSizePt * D2);
        const FSL = Math.round(legendSizePt * D2);
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, TW, TH);
        ctx.font = `${FS}px ${font}`;

        // ─── helper lambdas ────────────────────────────────────────────
        const tRange = t1 - t0,
          fRange = f1 - f0;
        function TX(t) {
          return ML + ((t - t0) / tRange) * specW;
        }
        function FY_spec(f) {
          return specTop + specH - ((f - f0) / fRange) * specH;
        }
        function FY_ps(f) {
          return specTop + specH - ((f - f0) / fRange) * specH;
        } // same Y scale

        // ─── SPECTROGRAM pixels ─────────────────────────────────────────
        // Parse specBgColor into [r,g,b] for blending with noise floor
        const _sbRGB = _hexToRgb(specBgColor);
        const dBfloor = globalMaxLog - contrast;
        // Effective contrast: invert direction so higher value = tighter window = more vivid
        const effectiveContrast = Math.max(1, 130 - contrast);
        const imgSpec = ctx.createImageData(specW, specH);
        for (let x = 0; x < specW; x++) {
          const fr = Math.min(
            nFrames - 1,
            Math.round((x / specW) * (nFrames - 1)),
          );
          const base = fr * bRange;
          for (let y = 0; y < specH; y++) {
            const b = Math.min(
              bRange - 1,
              Math.round((1 - y / specH) * (bRange - 1)),
            );
            let dB = specData[base + b];
            // Track whether this pixel is at or below the noise floor
            const atFloor = dB <= noiseFloor;
            if (atFloor) dB = noiseFloor;
            // Use inverted contrast so higher value = narrower window = more vivid
            const effFloor = globalMaxLog - effectiveContrast;
            let tn = Math.max(
              0,
              Math.min(1, (dB - effFloor) / effectiveContrast),
            );
            // Brightness: positive = brighter (add positive offset to tn)
            tn = Math.max(0, Math.min(1, tn + bright / 30));
            let [r, g, bl] = cmap(tn, cm);
            // Invert colormap if requested (black-over-white publication mode)
            if (invertSpec) {
              r = 255 - r;
              g = 255 - g;
              bl = 255 - bl;
            }
            // Apply specBgColor to pixels at/below the noise floor (regardless of tn)
            if (atFloor || tn < 0.01) {
              r = _sbRGB[0];
              g = _sbRGB[1];
              bl = _sbRGB[2];
            }
            const ii = (y * specW + x) * 4;
            imgSpec.data[ii] = r;
            imgSpec.data[ii + 1] = g;
            imgSpec.data[ii + 2] = bl;
            imgSpec.data[ii + 3] = 255;
          }
        }
        ctx.putImageData(imgSpec, ML, specTop);

        // ─── WAVEFORM panel ─────────────────────────────────────────────
        if (showWave && waveH > 0) {
          ctx.fillStyle = waveBg;
          ctx.fillRect(ML, waveTop, specW, waveH);
          let wPeak = 0;
          for (let i = 0; i < seg.length; i++) {
            const v = Math.abs(seg[i]);
            if (v > wPeak) wPeak = v;
          }
          if (wPeak < 1e-10) wPeak = 1;
          const midW = waveTop + waveH / 2;
          ctx.beginPath();
          for (let x = 0; x < specW; x++) {
            const s = Math.floor((x / specW) * seg.length);
            const e = Math.min(
              seg.length,
              s + Math.max(1, Math.ceil(seg.length / specW)),
            );
            let mn = 0,
              mx = 0;
            for (let i = s; i < e; i++) {
              const v = seg[i];
              if (v > mx) mx = v;
              if (v < mn) mn = v;
            }
            ctx.moveTo(ML + x + 0.5, midW - ((mx / wPeak) * waveH) / 2);
            ctx.lineTo(ML + x + 0.5, midW - ((mn / wPeak) * waveH) / 2);
          }
          ctx.strokeStyle = waveLineColor;
          ctx.lineWidth = D2 * 0.8;
          ctx.stroke();
          // Envelope
          if (showEnvP && envSeg) {
            ctx.beginPath();
            for (let x = 0; x < specW; x++) {
              const s = Math.min(
                envSeg.length - 1,
                Math.floor((x / specW) * envSeg.length),
              );
              const v = envSeg[s] / wPeak;
              const y = midW - (v * waveH) / 2;
              x === 0 ? ctx.moveTo(ML + x, y) : ctx.lineTo(ML + x, y);
            }
            ctx.strokeStyle = envColor;
            ctx.lineWidth = D2 * 1.5;
            ctx.stroke();
            ctx.beginPath();
            for (let x = 0; x < specW; x++) {
              const s = Math.min(
                envSeg.length - 1,
                Math.floor((x / specW) * envSeg.length),
              );
              const v = envSeg[s] / wPeak;
              const y = midW + (v * waveH) / 2;
              x === 0 ? ctx.moveTo(ML + x, y) : ctx.lineTo(ML + x, y);
            }
            ctx.strokeStyle = envColor;
            ctx.lineWidth = D2 * 1.5;
            ctx.stroke();
          }
          // Zero line
          ctx.strokeStyle = GRID;
          ctx.lineWidth = D2 * 0.5;
          ctx.setLineDash([2 * D2, 3 * D2]);
          ctx.beginPath();
          ctx.moveTo(ML, midW);
          ctx.lineTo(ML + specW, midW);
          ctx.stroke();
          ctx.setLineDash([]);
          // Border
          ctx.strokeStyle = FG;
          ctx.lineWidth = D2;
          ctx.strokeRect(ML, waveTop, specW, waveH);
          // Y label
          ctx.save();
          ctx.translate(Math.round(14 * D2), waveTop + waveH / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `${FSL}px ${font}`;
          ctx.fillStyle = FG;
          ctx.fillText("Amplitude", 0, 0);
          ctx.restore();
        }

        // ─── POWER SPECTRUM panel (right, shares freq Y axis) ───────────
        {
          ctx.fillStyle = psBg;
          ctx.fillRect(psLeft, specTop, psW, specH);
          // psPad: usable width with right-padding so curve/fill never touch the frame
          const psPad = Math.round(psW * 0.88);
          // Curve
          ctx.beginPath();
          for (let b = 0; b < bRange; b++) {
            const f = f0 + ((b + 0.5) / bRange) * fRange;
            const y = FY_ps(f);
            const pNorm = meanPsLinear[b] / maxPS;
            const x = psLeft + pNorm * psPad;
            b === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.strokeStyle = psLineColor;
          ctx.lineWidth = D2 * 1.5;
          ctx.stroke();
          // Fill under curve — parse fill color and apply opacity
          const _fillRgb = _hexToRgb(psFillColor);
          const fillRgba = `rgba(${_fillRgb[0]},${_fillRgb[1]},${_fillRgb[2]},${psFillOp})`;
          ctx.beginPath();
          ctx.moveTo(psLeft, FY_ps(f1)); // start top-left
          for (let b = bRange - 1; b >= 0; b--) {
            const f = f0 + ((b + 0.5) / bRange) * fRange;
            const y = FY_ps(f);
            const pNorm = meanPsLinear[b] / maxPS;
            const x = psLeft + pNorm * psPad;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(psLeft, FY_ps(f0)); // bottom-left
          ctx.closePath();
          ctx.fillStyle = fillRgba;
          ctx.fill();
          // X ticks — skip 0 (collides with spec labels), add inner padding so curve/fill don't touch the right frame
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.font = `${FS}px ${font}`;
          [0.5, 1].forEach((v) => {
            const x = psLeft + v * psPad;
            ctx.strokeStyle = FG;
            ctx.lineWidth = D2 * 0.8;
            ctx.beginPath();
            ctx.moveTo(x, specTop + specH);
            ctx.lineTo(x, specTop + specH + 4 * D2);
            ctx.stroke();
            ctx.fillStyle = FG;
            ctx.fillText(v.toFixed(1), x, specTop + specH + 5 * D2);
          });
          // PS X label
          ctx.save();
          ctx.translate(
            psLeft + psW / 2,
            specTop + specH + Math.round(26 * D2),
          );
          ctx.textAlign = "center";
          ctx.font = `${FSL}px ${font}`;
          ctx.fillStyle = FG;
          ctx.fillText("Relative Power", 0, 0);
          ctx.restore();
          // PS Y label (right side)
          ctx.save();
          ctx.translate(
            psLeft + psW + Math.round(24 * D2),
            specTop + specH / 2,
          );
          ctx.rotate(Math.PI / 2);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `${FSL}px ${font}`;
          ctx.fillStyle = FG;
          ctx.fillText("Frequency (kHz)", 0, 0);
          ctx.restore();
          // Border
          ctx.strokeStyle = FG;
          ctx.lineWidth = D2;
          ctx.strokeRect(psLeft, specTop, psW, specH);
        }

        // ─── SHARED AXES ────────────────────────────────────────────────
        // Spectrogram border
        ctx.strokeStyle = FG;
        ctx.lineWidth = D2;
        ctx.strokeRect(ML, specTop, specW, specH);

        // Time ticks (shared X, drawn once below spectrogram)
        const useMs =
          timeUnitPref === "ms" || (timeUnitPref === "auto" && tRange < 5);
        const tStep =
          timeStepPref === "auto"
            ? niceTick(tRange / Math.max(4, Math.floor(specW / (70 * D2))))
            : parseFloat(timeStepPref);
        const tFirst = t0; // labels always start from 0 (elapsed from t0)
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.font = `${FS}px ${font}`;
        for (let t = tFirst; t <= t1 + tStep * 0.01; t += tStep) {
          const x = TX(t);
          if (x < ML || x > ML + specW) continue;
          // Gridline through both spec and (if shown) waveform
          ctx.strokeStyle = GRID;
          ctx.lineWidth = D2 * 0.5;
          ctx.setLineDash([3 * D2, 4 * D2]);
          ctx.beginPath();
          ctx.moveTo(x, showWave ? waveTop : specTop);
          ctx.lineTo(x, specTop + specH);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = FG;
          ctx.lineWidth = D2;
          ctx.beginPath();
          ctx.moveTo(x, specTop + specH);
          ctx.lineTo(x, specTop + specH + 5 * D2);
          ctx.stroke();
          let lbl;
          const elapsed = t - t0; // always 0-based labels
          // Bare numbers — the axis title below carries the unit, so
          // repeating it on every tick is redundant.
          if (useMs) {
            lbl = String(Math.round(elapsed * 1000));
          } else {
            const dec =
              tStep >= 1 ? 0 : tStep >= 0.1 ? 1 : tStep >= 0.01 ? 2 : 3;
            lbl = elapsed.toFixed(dec);
          }
          ctx.fillStyle = FG;
          ctx.fillText(lbl, x, specTop + specH + 7 * D2);
        }
        // Time axis label
        ctx.font = `${FSL}px ${font}`;
        ctx.textAlign = "center";
        ctx.fillStyle = FG;
        ctx.fillText(
          useMs ? "Time (ms)" : "Time (s)",
          ML + specW / 2,
          specTop + specH + Math.round(28 * D2),
        );

        // Frequency ticks (shared Y, on spectrogram left side)
        // freqStepPref: 'auto' = niceTick algorithm; fixed values in Hz
        const fStep =
          freqStepPref === "auto"
            ? niceTick(fRange / Math.max(4, Math.floor(specH / (40 * D2))))
            : parseInt(freqStepPref);
        const fFirst = Math.ceil(f0 / fStep) * fStep;
        // Ticks are labelled in kHz as bare numbers (the axis title carries
        // the unit). Decimals follow the step so a 500 Hz step reads
        // 0.5 / 1.0 / 1.5 instead of collapsing to 0 / 1 / 2.
        const fKhzDec = Math.max(
          0,
          Math.min(3, Math.ceil(-Math.log10(fStep / 1000))),
        );
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.font = `${FS}px ${font}`;
        for (let f = fFirst; f <= f1 + fStep * 0.01; f += fStep) {
          const y = FY_spec(f);
          if (y < specTop || y > specTop + specH) continue;
          // Gridline
          ctx.strokeStyle = GRID;
          ctx.lineWidth = D2 * 0.5;
          ctx.setLineDash([3 * D2, 4 * D2]);
          ctx.beginPath();
          ctx.moveTo(ML, y);
          ctx.lineTo(ML + specW, y);
          ctx.stroke();
          // Same gridline on PS panel
          ctx.beginPath();
          ctx.moveTo(psLeft, y);
          ctx.lineTo(psLeft + psW, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = FG;
          ctx.lineWidth = D2;
          ctx.beginPath();
          ctx.moveTo(ML, y);
          ctx.lineTo(ML - 5 * D2, y);
          ctx.stroke();
          const lbl = (f / 1000).toFixed(fKhzDec);
          ctx.fillStyle = FG;
          ctx.fillText(lbl, ML - 8 * D2, y);
        }
        // Freq axis label (left, rotated)
        ctx.save();
        ctx.translate(Math.round(14 * D2), specTop + specH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${FSL}px ${font}`;
        ctx.fillStyle = FG;
        ctx.fillText("Frequency (kHz)", 0, 0);
        ctx.restore();

        // ─── ANNOTATIONS & DETECTIONS ───────────────────────────────────
        function drawSelSpec(tS, tE, fLo2, fHi2, color, dash) {
          const x1 = Math.max(ML, TX(tS)),
            x2 = Math.min(ML + specW, TX(tE));
          if (x2 <= x1) return;
          const y1 = Math.max(specTop, FY_spec(fHi2)),
            y2 = Math.min(specTop + specH, FY_spec(fLo2));
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = color;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5 * D2;
          ctx.setLineDash(dash || []);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.setLineDash([]);
          if (showWave && waveH > 0) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5 * D2;
            ctx.setLineDash(dash || []);
            ctx.beginPath();
            ctx.moveTo(x1, waveTop);
            ctx.lineTo(x1, waveTop + waveH);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x2, waveTop);
            ctx.lineTo(x2, waveTop + waveH);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        if (showAnnots)
          annotations.forEach((a) =>
            drawSelSpec(a.start, a.end, a.fLo, a.fHi, "#3fb950"),
          );
        if (showDets)
          detections.forEach((d) =>
            drawSelSpec(d.start, d.end, f0, f1, "#f78166", [4 * D2, 3 * D2]),
          );

        // ─── TITLE ──────────────────────────────────────────────────────
        if (title) {
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `bold ${Math.round(14 * D2)}px ${font}`;
          ctx.fillStyle = FG;
          ctx.fillText(title, TW / 2, Math.round(MT * 0.5));
        }

        // ─── PARAMETER ANNOTATION (small text bottom-right) ─────────────
        if ($("plotShowParamStamp").checked) {
          const info = `WL=${wlBase}  FFT=${actualFftN}  hop=${hop}  SR=${sampleRate} Hz`;
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.font = `${Math.round(9 * D2)}px ${font}`;
          // This text sits INSIDE the spectrogram, so it must contrast with
          // what is painted there — plotSpecBg, the colormap, Invert — not
          // with the figure background that FG2 is derived from. A white
          // figure with a black spectrogram used to put dark grey on black
          // and the stamp vanished. Measure the box the text will occupy,
          // read the pixels already under it, and pick ink accordingly.
          const stampX = ML + specW,
            stampY = specTop + specH - 3 * D2;
          const stampW = ctx.measureText(info).width;
          const stampH = Math.round(12 * D2);
          const behindLum = _regionLuminance(
            ctx,
            stampX - stampW,
            stampY - stampH,
            stampW,
            stampH,
          );
          // null = pixels unreadable, so keep the old static choice.
          ctx.fillStyle = behindLum === null ? FG2 : _pickInk(behindLum);
          ctx.fillText(info, stampX, stampY);
        }

        // ── Show preview ────────────────────────────────────────────────
        const prev = $("plotPreviewC");
        prev.width = oc.width;
        prev.height = oc.height;
        prev.getContext("2d").drawImage(oc, 0, 0);
        _plotCanvas = oc;
        $("btnDownloadPlot").disabled = false;
        const mp = ((oc.width * oc.height * 4) / 1024 / 1024).toFixed(1);
        $("plotStatus").textContent =
          `${oc.width}×${oc.height} px | WL=${wlBase} FFT=${actualFftN} hop=${hop} | ${mp} MB uncompressed`;
      }

      function hasDesktopSaveApi() {
        return Boolean(
          window.__TAURI__ &&
          window.__TAURI__.dialog &&
          typeof window.__TAURI__.dialog.save === "function" &&
          window.__TAURI__.fs &&
          typeof window.__TAURI__.fs.writeFile === "function" &&
          typeof window.__TAURI__.fs.writeTextFile === "function",
        );
      }

      async function downloadPlot() {
        if (!_plotCanvas) {
          alert("Render a preview first.");
          return;
        }

        // Fallback if no file is explicitly loaded yet
        let baseName = "Rthoptera_plot";

        if (currentAudioFileName) {
          // Strips trailing extension (e.g., "myfile.wav" -> "myfile")
          baseName = currentAudioFileName.replace(/\.[^/.]+$/, "");
        }

        try {
          const dataUrl = _plotCanvas.toDataURL("image/png");

          if (hasDesktopSaveApi()) {
            const filePath = await window.__TAURI__.dialog.save({
              filters: [{ name: "Image", extensions: ["png"] }],
              defaultPath: currentAudioFileFolder
                ? `${currentAudioFileFolder}${currentAudioFileFolder.includes("\\") ? "\\" : "/"}${baseName}_multiplot.png`
                : `${baseName}_multiplot.png`,
            });

            if (!filePath) {
              log("Export cancelled by user", "info");
              return;
            }

            const base64Data = dataUrl.split(",")[1];
            const binaryString = atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

            await window.__TAURI__.fs.writeFile(filePath, bytes);
            alert("Image saved successfully!");
          } else {
            console.warn(
              "Tauri desktop save APIs unavailable; falling back to browser download.",
            );
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${baseName}_multiplot.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            alert("Browser download started.");
          }
        } catch (err) {
          console.error("PNG export failed:", err);
          alert("Failed to save image: " + err);
        }
      }

      function yieldUI() {
        return new Promise((r) => setTimeout(r, 0));
      }

      // ═══════════════════════════════════════════════════════════════════
      // TABS
      // ═══════════════════════════════════════════════════════════════════
      function switchTab(name, el) {
        // Scope to the sub-tab container only — never touch main tabs
        const container = el ? el.closest(".tabs") : null;
        if (container) {
          container
            .querySelectorAll(".tab")
            .forEach((t) => t.classList.remove("active"));
        }
        // Deactivate all .tc panels (sub-tab content)
        document
          .querySelectorAll(".tc")
          .forEach((t) => t.classList.remove("active"));
        if (el) el.classList.add("active");
        const tc = $("tab-" + name);
        if (tc) tc.classList.add("active");
      }

      // ═══════════════════════════════════════════════════════════════════
      // MAIN VIEW TABS (Analyzer / Export Plot)
      // ═══════════════════════════════════════════════════════════════════
      // "Plotting" is a parent tab holding Multiplot/Osc. Stack/Osc.
      // Zoom/Habitus as sub-tabs (see switchPlotSubtab below). Remembers
      // the last sub-tab so re-entering "Plotting" doesn't reset it.
      let plotActiveSubtab = "plot";

      function switchMainTab(name, el) {
        // Landing has no tab button of its own — activating any real tab
        // (via a click, or programmatically on first audio load) retires it
        // for good.
        const landing = $("mainview-landing");
        if (landing) landing.style.display = "none";
        ["preprocess", "peaks", "analyzer", "plotting", "summarize"].forEach(
          (n) => {
            const t = $("maintab-" + n);
            if (t) t.classList.toggle("active", n === name);
          },
        );
        const pp = $("mainview-preprocess");
        const a = $("mainview-analyzer");
        const k = $("mainview-peaks");
        const plotBar = $("plotSubtabBar");
        const sb = $("sidebar");
        const sm = $("mainview-summarize");
        if (pp) pp.style.display = name === "preprocess" ? "flex" : "none";
        if (a) a.style.display = name === "analyzer" ? "flex" : "none";
        if (k) k.style.display = name === "peaks" ? "flex" : "none";
        if (plotBar) plotBar.style.display = name === "plotting" ? "flex" : "none";
        if (sm) sm.style.display = name === "summarize" ? "flex" : "none";
        ["plot", "oscstack", "osczoom", "habitus"].forEach((n) => {
          const v = $("mainview-" + n);
          if (v) v.style.display = name === "plotting" && n === plotActiveSubtab ? "flex" : "none";
        });
        // Sidebar (Time Axis / Frequency Axis / Spectrogram display
        // settings) is only relevant for the Analyzer's own visualization.
        if (sb) sb.style.display = name === "analyzer" ? "flex" : "none";
        _placeSharedViewer(name);
        if (name === "peaks")
          setTimeout(() => {
            if (pkEnv) pkDrawEnvelope();
          }, 50);
        if (name === "analyzer" || name === "preprocess")
          setTimeout(() => {
            render();
          }, 50);
        // Entering Plotting re-activates whichever sub-tab was last shown,
        // which also re-fires that sub-tab's library-picker refresh below.
        if (name === "plotting") switchPlotSubtab(plotActiveSubtab);
      }

      // Physically moves the shared waveform/spectrogram viewer (one DOM
      // subtree, one set of canvas IDs — see #waveSpecViewer in index.html)
      // between its home in Spectral Analysis and Preprocessing's slot, so
      // Preprocessing can preview filters/normalization/trim on the same
      // render pipeline without duplicating any canvases or IDs. The
      // detection/annotation/tool controls in its transport bar only make
      // sense in Spectral Analysis, so they're hidden elsewhere.
      function _placeSharedViewer(name) {
        const viewer = $("waveSpecViewer");
        if (!viewer) return;
        const targetSlot =
          name === "preprocess" ? $("preprocessViewerSlot") : $("analyzerViewerSlot");
        if (targetSlot && viewer.parentElement !== targetSlot) {
          targetSlot.appendChild(viewer);
        }
        const analyzerOnly = $("analyzerOnlyControls");
        if (analyzerOnly)
          analyzerOnly.style.display = name === "analyzer" ? "contents" : "none";

        // Hiding the tool buttons is not enough on its own: activeTool keeps
        // whatever it was (Annotate by default), so without this a drag in
        // Preprocessing would quietly create selections. viewerMode gates the
        // behaviour instead of the chrome.
        viewerMode = name === "preprocess" ? "preprocess" : "analyzer";
        if (viewerMode === "preprocess") {
          // One unambiguous affordance: click to place the playhead.
          const wi = $("waveI"),
            si = $("specI");
          if (wi) wi.style.cursor = "text";
          if (si) si.style.cursor = "text";
          // Drop any in-flight annotate/pan gesture. selAid is deliberately
          // left alone: the highlight is not drawn here anyway, and clearing
          // it would mean calling refreshAnnotList(), which invalidates
          // computed spectral metrics on every tab switch.
          drawing = null;
          panState = null;
          ppDrag = null;
          updatePpSelReadout();
        } else {
          ppDrag = null;
          setTool(activeTool); // restores the tool's own cursor
        }
      }

      // Brings back the landing/guide view. Unlike the real tabs, landing
      // has no maintab- button of its own, so it just deactivates whichever
      // tab is currently active and re-shows the landing pane in its place.
      function goHome() {
        const landing = $("mainview-landing");
        if (landing) landing.style.display = "flex";
        ["preprocess", "peaks", "analyzer", "plotting", "summarize"].forEach(
          (n) => {
            const t = $("maintab-" + n);
            if (t) t.classList.remove("active");
          },
        );
        const pp = $("mainview-preprocess");
        const a = $("mainview-analyzer");
        const k = $("mainview-peaks");
        const plotBar = $("plotSubtabBar");
        const sb = $("sidebar");
        const sm = $("mainview-summarize");
        if (pp) pp.style.display = "none";
        if (a) a.style.display = "none";
        if (k) k.style.display = "none";
        if (plotBar) plotBar.style.display = "none";
        if (sb) sb.style.display = "none";
        if (sm) sm.style.display = "none";
        ["plot", "oscstack", "osczoom", "habitus"].forEach((n) => {
          const v = $("mainview-" + n);
          if (v) v.style.display = "none";
        });
        _placeSharedViewer("home"); // parks the viewer back in analyzerViewerSlot
      }

      function switchPlotSubtab(name, el) {
        plotActiveSubtab = name;
        ["plot", "oscstack", "osczoom", "habitus"].forEach((n) => {
          const t = $("plotsubtab-" + n);
          if (t) t.classList.toggle("active", n === name);
          const v = $("mainview-" + n);
          if (v) v.style.display = n === name ? "flex" : "none";
        });
        // Each library-backed picker only re-renders on library changes;
        // catch it up here too, in case audio was imported on another tab.
        if (name === "oscstack" && typeof oscRenderLibPicker === "function") oscRenderLibPicker();
        if (name === "osczoom" && typeof ozRenderLibPicker === "function") ozRenderLibPicker();
        if (name === "habitus" && typeof habRenderLibPicker === "function") habRenderLibPicker();
      }

      // ═══════════════════════════════════════════════════════════════════
      // PLOT PRESETS  (localStorage — keys: strid_preset_N)
      // ═══════════════════════════════════════════════════════════════════
      const PRESET_FIELDS = [
        "plotW",
        "plotH",
        "plotDpi",
        "plotSpecRatio",
        "plotPsWidth",
        "plotT0",
        "plotT1",
        "plotF0",
        "plotF1",
        "plotTimeUnit",
        "plotTimeStep",
        "plotFreqStep",
        "plotManualFft",
        "plotFft",
        "plotOverlap",
        "plotCmap",
        "plotContrast",
        "plotBright",
        "plotNoiseFloor",
        "plotShowWave",
        "plotWaveColor",
        "plotWaveBg",
        "plotPsFillColor",
        "plotPsFillOpacity",
        "plotPsBg",
        "plotSpecBg",
        "plotInvertSpec",
        "plotFigBg",
        "plotFgColor",
        "plotFont",
        "plotTitle",
        "plotLegendSize",
        "plotTickSize",
        "plotShowParamStamp",
      ];

      function _presetKey(n) {
        return "strid_preset_" + n;
      }

      function _capturePreset() {
        const data = {};
        PRESET_FIELDS.forEach((id) => {
          const el = $(id);
          if (!el) return;
          if (el.type === "checkbox") data[id] = el.checked;
          else data[id] = el.value;
        });
        return data;
      }

      function _applyPreset(data) {
        PRESET_FIELDS.forEach((id) => {
          const el = $(id);
          if (!el || !(id in data)) return;
          if (el.type === "checkbox") el.checked = data[id];
          else el.value = data[id];
        });
        // update opacity label
        const op = $("plotPsFillOpacity"),
          lb = $("plotPsFillOpacityLbl");
        if (op && lb) lb.textContent = parseFloat(op.value).toFixed(2);
        // enable/disable FFT select
        const manFft = $("plotManualFft"),
          fftSel = $("plotFft");
        if (manFft && fftSel) fftSel.disabled = !manFft.checked;
      }

      function _refreshPresetLabels() {
        // Preset names are now visible from the dropdown — update option text
        const sel = $("presetSelect");
        if (!sel) return;
        for (let i = 1; i <= 10; i++) {
          try {
            const raw = localStorage.getItem(_presetKey(i));
            const d = raw ? JSON.parse(raw) : null;
            const opt = sel.querySelector(`option[value="${i}"]`);
            if (opt)
              opt.textContent =
                d && d._name ? `${i}: ${d._name}` : `Preset ${i}`;
          } catch (e) {}
        }
      }

      function savePreset() {
        const sel = $("presetSelect");
        const n = sel ? sel.value : "";
        if (!n) {
          $("presetStatus").textContent = "Select a preset slot first.";
          return;
        }
        const data = _capturePreset();
        // Ask for an optional name
        const nm = prompt(`Name for Preset ${n} (optional):`, data._name || "");
        if (nm === null) return; // cancelled
        data._name = nm.trim() || `Preset ${n}`;
        try {
          localStorage.setItem(_presetKey(n), JSON.stringify(data));
          $("presetStatus").textContent = `✔ Saved as "${data._name}"`;
          _refreshPresetLabels();
        } catch (e) {
          $("presetStatus").textContent = "Storage error: " + e.message;
        }
      }

      function loadPreset() {
        const sel = $("presetSelect");
        const n = sel ? sel.value : "";
        if (!n) {
          $("presetStatus").textContent = "Select a preset slot first.";
          return;
        }
        try {
          const raw = localStorage.getItem(_presetKey(n));
          if (!raw) {
            $("presetStatus").textContent = `Preset ${n} is empty.`;
            return;
          }
          const data = JSON.parse(raw);
          _applyPreset(data);
          $("presetStatus").textContent =
            `✔ Loaded "${data._name || "Preset " + n}"`;
        } catch (e) {
          $("presetStatus").textContent = "Load error: " + e.message;
        }
      }

      function clearPreset() {
        const sel = $("presetSelect");
        const n = sel ? sel.value : "";
        if (!n) {
          $("presetStatus").textContent = "Select a preset slot first.";
          return;
        }
        if (!confirm(`Clear Preset ${n}?`)) return;
        try {
          localStorage.removeItem(_presetKey(n));
          $("presetStatus").textContent = `Preset ${n} cleared.`;
          _refreshPresetLabels();
        } catch (e) {
          $("presetStatus").textContent = "Error: " + e.message;
        }
      }

      // ── Preset files (.json) ───────────────────────────────────────────
      // The ten slots above live in localStorage, which is per-install: a
      // preset there cannot travel with a dataset, go into version control,
      // or survive the webview's storage being cleared. Export/Import write
      // the same captured object to a real file, so the settings behind a
      // figure can be kept beside the recordings and handed to someone else.
      //
      // Export takes the LIVE toolbar state rather than a saved slot, so
      // getting a file out never costs a slot; Import applies straight to the
      // toolbar, mirroring Load. Save it into a slot afterwards if it should
      // stick.
      const PRESET_FILE_KIND = "rthoptera.multiplot.preset";
      const PRESET_FILE_VERSION = 1;

      function _presetFileStatus(msg, isErr) {
        const el = $("presetStatus");
        if (el) {
          el.textContent = msg;
          el.style.color = isErr ? "var(--red)" : "var(--txt3)";
        }
        log(msg, isErr ? "err" : "ok");
      }

      // Filters a parsed file down to entries this build can actually apply.
      // Everything is checked against the live control rather than trusted:
      // a preset written by a different version (or edited by hand) can name
      // fields that no longer exist, or carry a value that is not one of a
      // dropdown's options — assigning those would silently blank the control
      // instead of failing loudly.
      function _sanitizePresetData(data) {
        const known = new Set(PRESET_FIELDS);
        const clean = {};
        const invalid = [];
        const clamped = [];
        let unknown = 0;

        Object.keys(data).forEach((k) => {
          // Keys starting with "_" are file metadata (_kind/_version/…), not
          // settings, so they are not counted as unrecognized.
          if (!k.startsWith("_") && !known.has(k)) unknown++;
        });

        PRESET_FIELDS.forEach((id) => {
          if (!(id in data)) return;
          const el = $(id);
          if (!el) return;
          const v = data[id];
          if (el.type === "checkbox") {
            if (typeof v !== "boolean") {
              invalid.push(id);
              return;
            }
            clean[id] = v;
          } else if (el.tagName === "SELECT") {
            const want = String(v);
            if (!Array.from(el.options).some((o) => o.value === want)) {
              invalid.push(id);
              return;
            }
            clean[id] = want;
          } else if (el.type === "number" || el.type === "range") {
            // A blank number field is a real state, not corruption — the
            // plot falls back to a default for it — so it round-trips as
            // blank rather than being reported invalid.
            if (typeof v === "string" && v.trim() === "") {
              clean[id] = "";
              return;
            }
            const num = parseFloat(v);
            if (!isFinite(num)) {
              invalid.push(id);
              return;
            }
            // Honour the control's own bounds — a hand-edited width of
            // 999999 would otherwise try to allocate a canvas that cannot
            // be drawn.
            const lo = el.min === "" ? -Infinity : parseFloat(el.min);
            const hi = el.max === "" ? Infinity : parseFloat(el.max);
            const fixed = Math.min(
              isFinite(hi) ? hi : Infinity,
              Math.max(isFinite(lo) ? lo : -Infinity, num),
            );
            if (fixed !== num) clamped.push(id);
            clean[id] = String(fixed);
          } else if (el.type === "color") {
            // Anything a color input cannot parse is silently coerced to
            // black, so reject it here instead of letting a typo repaint
            // the figure.
            if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v.trim())) {
              invalid.push(id);
              return;
            }
            clean[id] = v.trim().toLowerCase();
          } else {
            if (v === null || typeof v === "object") {
              invalid.push(id);
              return;
            }
            clean[id] = String(v);
          }
        });
        return { clean, invalid, clamped, unknown };
      }

      async function exportPresetFile() {
        const data = _capturePreset();
        const title = ($("plotTitle")?.value || "").trim();
        const payload = {
          _kind: PRESET_FILE_KIND,
          _version: PRESET_FILE_VERSION,
          _app: "Rthoptera Desktop",
          _savedAt: new Date().toISOString(),
          _name: title || "Multiplot preset",
          ...data,
        };
        // exactName: a preset describes plot settings, not one recording, so
        // it must not be renamed after the loaded audio file.
        await dlFile(
          "rthoptera_multiplot_preset.json",
          JSON.stringify(payload, null, 2),
          "application/json",
          { exactName: true },
        );
      }

      async function importPresetFile(fileList) {
        const file = fileList && fileList[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          if (!data || typeof data !== "object" || Array.isArray(data)) {
            _presetFileStatus("Not a preset file (expected a JSON object).", true);
            return;
          }
          // Only reject on a kind that is present and wrong — files without
          // the marker (hand-written, or from before it existed) are still
          // tried, and fall out below if they carry nothing usable.
          if (data._kind && data._kind !== PRESET_FILE_KIND) {
            _presetFileStatus(
              `Not a Multiplot preset (file says "${data._kind}").`,
              true,
            );
            return;
          }
          const { clean, invalid, clamped, unknown } = _sanitizePresetData(data);
          const n = Object.keys(clean).length;
          if (!n) {
            _presetFileStatus("No recognizable Multiplot settings in that file.", true);
            return;
          }
          // Not auto-rendered, matching slot Load: the Multiplot only ever
          // redraws when the user clicks Render.
          _applyPreset(clean);
          const notes = [];
          if (unknown) notes.push(`${unknown} unknown setting(s) ignored`);
          if (invalid.length)
            notes.push(`${invalid.length} skipped (${invalid.join(", ")})`);
          if (clamped.length)
            notes.push(`${clamped.length} clamped to range (${clamped.join(", ")})`);
          _presetFileStatus(
            `✔ Loaded "${data._name || file.name}" — ${n} setting(s)` +
              (notes.length ? "; " + notes.join("; ") : ""),
          );
        } catch (e) {
          _presetFileStatus("Could not read preset: " + e.message, true);
        } finally {
          // Let the same file be picked twice in a row (change fires only on
          // a different value otherwise).
          const inp = $("presetFile");
          if (inp) inp.value = "";
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // INIT
      // ═══════════════════════════════════════════════════════════════════
      window.addEventListener("resize", () => {
        if (rawSamples) render();
        else renderMinimap();
      });
      window.addEventListener("load", () => {
        // Main tab state is left alone here: the Landing view (see
        // mainview-landing in index.html) is shown by default and only
        // retired once a real tab is activated (by click, or by the first
        // audio import — see switchMainTab).
        makePointer("waveI", "wave");
        makePointer("specI", "spec");
        // Applies the default tool's button highlight and canvas cursor —
        // the markup carries the highlight, but only setTool sets the cursor.
        setTool(activeTool);
        initDragHandles();
        initMinimap();
        pkWatchCanvasResize();
        showAppVersion();
        _refreshPresetLabels();
        if (typeof _pkRefreshPresetLabels === "function")
          _pkRefreshPresetLabels();
        // initialise the fill-opacity label
        const op = $("plotPsFillOpacity"),
          lb = $("plotPsFillOpacityLbl");
        if (op && lb) {
          op.addEventListener("input", () => {
            lb.textContent = parseFloat(op.value).toFixed(2);
          });
        }
        // enable/disable FFT override
        const manFft = $("plotManualFft"),
          fftSel = $("plotFft");
        if (manFft && fftSel) {
          manFft.addEventListener("change", () => {
            fftSel.disabled = !manFft.checked;
          });
        }
        setTimeout(() => {
          const wc = $("waveC"),
            ww = $("wWrap");
          wc.width = ww.clientWidth;
          wc.height = ww.clientHeight;
          const ctx = wc.getContext("2d");
          ctx.fillStyle = "#0d1117";
          ctx.fillRect(0, 0, wc.width, wc.height);
          ctx.fillStyle = "#444";
          ctx.font = "12px Consolas,monospace";
          ctx.textAlign = "center";
          ctx.fillText(
            "Open audio file — up to 250kHz Nyquist supported",
            wc.width / 2,
            wc.height / 2,
          );
          const sc = $("specC"),
            sw = $("sWrap");
          sc.width = sw.clientWidth;
          sc.height = sw.clientHeight;
          const sc2 = sc.getContext("2d");
          sc2.fillStyle = "#000";
          sc2.fillRect(0, 0, sc.width, sc.height);
        }, 100);
      });

      // ═══════════════════════════════════════════════════════════════════
      // TEMPORAL ANALYSIS
      // ═══════════════════════════════════════════════════════════════════
      let pkEnv = null;
      let pkPeaks = [];
      let pkTrains = [];
      let pkMotifs = [];
      let pkMotifSeqs = [];
      // ids of annotations most recently pushed by pkApplyDetectionsToSpectral
      // — tracked so a re-apply after editing detections REPLACES them
      // (correct edits + chronological renumbering) instead of piling up
      // stale duplicates alongside freshly-numbered ones.
      let pkAppliedAnnotationIds = [];
      let pkPeakData = [];
      let pkTrainData = [];
      let pkMotifData = [];
      let pkMotifSeqData = [];
      let pkSummaryData = null;
      let pkCurrentTable = "peak";
      let pkConfirmed = false;
      let pkLastMouseTime = null;
      // Zoom/pan state
      let pkViewStart = 0; // seconds
      let pkViewEnd = null; // null = full duration
      let pkAmpScale = 1; // vertical amplitude magnification (1 = full 0..1 range)
      let pkIsDragging = false;
      let pkDragStartX = 0;
      let pkDragStartViewStart = 0;
      // Manual editing state
      let pkEditMode = "select"; // 'select' | 'add'
      let pkDidDrag = false; // distinguishes a pan from a click
      let pkHoverTime = null; // for add-mode preview guide
      // Train segmentation is FROZEN after detection: each peak carries a boolean
      // `splitAfter` meaning "a train boundary follows this peak". All manual edits
      // toggle these flags locally — the grouping algorithm never re-runs.
      const pkSelection = new Set(); // selected peak objects (references)
      let pkBand = null; // {x0,y0,x1,y1} rubber-band in canvas px
      let pkDidBand = false; // suppress the click after a band drag

      // Wire motif-seq checkbox + live regrouping of trains/motifs/sequences.
      document.addEventListener("DOMContentLoaded", () => {
        // Recompute trains -> motifs -> sequences from the FROZEN peak
        // segmentation and redraw immediately, with no need to re-run Detect
        // Peaks. Only fires once peaks already exist.
        const regroup = (note) => {
          if (pkPeaks && pkPeaks.length) pkLiveUpdate(note);
        };
        const cb = $("pkMotifSeq");
        if (cb)
          cb.addEventListener("change", () => {
            $("pkMotifSeqRow").style.display = cb.checked ? "" : "none";
            regroup("motif sequences");
          });
        [
          ["pkMaxTrainGap", "max train gap"],
          ["pkMinPeaks", "min peaks/train"],
          ["pkMaxMotifGap", "max motif gap"],
        ].forEach(([id, note]) => {
          const el = $(id);
          if (el) el.addEventListener("input", () => regroup(note));
        });
        // "Max peak gap" / "Max amp diff" (the Train Grouping panel) drive
        // peak-to-train segmentation itself, one level below the trio above.
        // Re-derive splitAfter for ALL peaks from the new threshold — this
        // never adds, removes, or moves a peak (manually added/removed peaks
        // stay exactly as they are), it only redraws train boundaries around
        // the peaks that already exist. Any hand-toggled split/merge/assign
        // is a boundary edit too, so a threshold change here supersedes it,
        // same as it does at detection time.
        const regroupBoundaries = (note) => {
          if (pkPeaks && pkPeaks.length) {
            pkInitBoundaries();
            pkLiveUpdate(note);
          }
        };
        [
          ["pkMaxGap", "max peak gap"],
          ["pkMaxDiff", "max amp diff"],
        ].forEach(([id, note]) => {
          const el = $(id);
          if (el) el.addEventListener("input", () => regroupBoundaries(note));
        });
      });

      // ── Envelope computation ────────────────────────────────────────────
      function pkComputeEnv(smoothMs) {
        if (!rawSamples) return null;
        const half = Math.max(1, Math.round((sampleRate * smoothMs) / 2000));
        const n = rawSamples.length;
        const env = new Float32Array(n);
        let ss = 0;
        for (let i = 0; i < Math.min(half, n); i++)
          ss += rawSamples[i] * rawSamples[i];
        for (let i = 0; i < n; i++) {
          const ai = i + half,
            ri = i - half - 1;
          if (ai < n) ss += rawSamples[ai] * rawSamples[ai];
          if (ri >= 0) ss -= rawSamples[ri] * rawSamples[ri];
          const wl = Math.min(i + half, n - 1) - Math.max(i - half, 0) + 1;
          env[i] = Math.sqrt(Math.max(0, ss / wl));
        }
        // Normalise 0–1
        let mx = 0;
        for (let i = 0; i < n; i++) if (env[i] > mx) mx = env[i];
        if (mx > 1e-10) for (let i = 0; i < n; i++) env[i] /= mx;
        return env;
      }

      // Outward-scan cap for pkProminenceAt, in samples (~5s worth at a
      // typical 44.1kHz recording). Real bioacoustic envelopes find their
      // true valley/wall long before this; it only bounds the pathological
      // case of a long, near-monotonic stretch (e.g. a slowly decaying
      // train tail) so a single call can't degrade toward O(n) — once a dip
      // this deep has been scanned without finding a taller point, the
      // measured prominence already exceeds any realistic percentage
      // threshold, so capping here doesn't change real outcomes.
      const PK_PROMINENCE_SCAN_CAP = 220500;

      // True topographic prominence of the local maximum `cv` at `idx`: walk
      // outward in each direction tracking the lowest point crossed, until
      // hitting a strictly taller sample (the "wall") or the signal edge.
      // Prominence = cv minus the HIGHER of the two sides' lowest points —
      // i.e. the shallower of the two dips is what actually limits how much
      // this peak stands out (matches scipy.signal.peak_prominences).
      function pkProminenceAt(env, idx, cv, cap) {
        const n = env.length;
        let leftMin = cv;
        let j = idx - 1,
          steps = 0;
        while (j >= 0 && steps < cap) {
          if (env[j] > cv) break;
          if (env[j] < leftMin) leftMin = env[j];
          j--;
          steps++;
        }
        let rightMin = cv;
        j = idx + 1;
        steps = 0;
        while (j < n && steps < cap) {
          if (env[j] > cv) break;
          if (env[j] < rightMin) rightMin = env[j];
          j++;
          steps++;
        }
        return cv - Math.max(leftMin, rightMin);
      }

      // ── Local peak detection ────────────────────────────────────────────
      // detThrPct  : strong floor — peaks above this are always accepted ("seeds").
      // linkThrPct : optional lower floor (hysteresis). Weak peaks whose amplitude is
      //              between linkThr and detThr are accepted ONLY if they fall within
      //              `linkMs` of an accepted (strong) peak. This recovers the quiet
      //              onset/offset peaks of a train while rejecting isolated inter-train
      //              noise of the same height. Pass null to disable.
      function pkFindPeaks(
        env,
        winMs,
        peakThrPct,
        detThrPct,
        linkThrPct,
        linkMs,
      ) {
        const winSamp = Math.max(1, Math.round((sampleRate * winMs) / 1000));
        const peakThr = peakThrPct / 100;
        const detThr = detThrPct / 100;
        const linkThr =
          linkThrPct != null && linkThrPct < detThrPct
            ? linkThrPct / 100
            : null;
        const floor = linkThr != null ? linkThr : detThr;
        const linkSamp = Math.max(
          1,
          Math.round((sampleRate * (linkMs || 0)) / 1000),
        );
        const n = env.length;

        // Pass 1 — collect every prominent local maximum above the lowest floor.
        // Plateau-aware: a flat or flat-topped maximum is detected ONCE and the
        // marker is placed at the centre of the flat top. After emitting a peak we
        // jump past its plateau so a single broad top can't spawn several peaks.
        const cands = [];
        let i = winSamp;
        while (i < n - winSamp) {
          const cv = env[i];
          if (cv < floor) {
            i++;
            continue;
          }

          // Is i the start of a maximal run of equal values (the plateau top)?
          // First require that nothing in the window strictly exceeds cv. This
          // ±winSamp check is purely about peak WIDTH/spacing — confirming i is
          // locally the tallest point so closely-packed samples don't each
          // register as their own peak — and is intentionally decoupled from
          // prominence (see below), which needs to look arbitrarily far out.
          let isMax = true;
          for (let j = i - winSamp; j <= i + winSamp; j++) {
            if (env[j] > cv) {
              isMax = false;
              break;
            }
          }
          if (!isMax) {
            i++;
            continue;
          }

          // Extend across the flat top. Real envelopes are never exactly flat, so
          // treat samples within a small tolerance of the peak value as "on the top".
          // Tolerance scales with the peak height (and a tiny absolute floor) so it
          // works for both tall and faint plateaus.
          const flatTol = Math.max(cv * 0.02, 1e-6);
          let pStart = i,
            pEnd = i;
          while (
            pEnd + 1 < n &&
            env[pEnd + 1] >= cv - flatTol &&
            env[pEnd + 1] <= cv
          )
            pEnd++;
          // also extend left across equal-height samples already scanned
          while (
            pStart - 1 >= 0 &&
            env[pStart - 1] >= cv - flatTol &&
            env[pStart - 1] <= cv
          )
            pStart--;

          // Confirm it's a genuine top: the samples just outside the flat run must
          // not be higher (they can't be, given isMax), and TRUE prominence must
          // hold — measured by walking outward until a taller point (or the
          // signal edge) is found on each side, not just within ±winSamp. A
          // narrow window here was the actual bug: it under-measured prominence
          // for peaks with a gradual approach (missing genuine train-onset
          // peaks) while over-crediting tiny noise wiggles sitting close to a
          // strong peak (spurious detections in quiet trailing tails).
          const centre = Math.round((pStart + pEnd) / 2);
          if (pkProminenceAt(env, centre, cv, PK_PROMINENCE_SCAN_CAP) >= peakThr) {
            cands.push({
              idx: centre,
              time: centre / sampleRate,
              amp: cv,
              strong: cv >= detThr,
            });
          }
          // Skip past the plateau AND its window so the same top isn't re-detected.
          i = pEnd + winSamp + 1;
        }

        if (linkThr == null) {
          return cands.map((c) => ({ idx: c.idx, time: c.time, amp: c.amp }));
        }

        // Pass 2 — keep weak candidates only if linked (within linkSamp) to a strong one.
        const peaks = [];
        for (let k = 0; k < cands.length; k++) {
          const c = cands[k];
          if (c.strong) {
            peaks.push({ idx: c.idx, time: c.time, amp: c.amp });
            continue;
          }
          let linked = false;
          for (let j = k - 1; j >= 0; j--) {
            if (c.idx - cands[j].idx > linkSamp) break;
            if (cands[j].strong) {
              linked = true;
              break;
            }
          }
          if (!linked) {
            for (let j = k + 1; j < cands.length; j++) {
              if (cands[j].idx - c.idx > linkSamp) break;
              if (cands[j].strong) {
                linked = true;
                break;
              }
            }
          }
          if (linked) peaks.push({ idx: c.idx, time: c.time, amp: c.amp });
        }
        return peaks;
      }

      // ── Arch (valley) train splitting ───────────────────────────────────
      // Some species run their trains back to back: the silence between two
      // trains is no longer than the spacing between peaks inside one, so the
      // gap rule can never separate them. What still separates them by eye is
      // the ARCH — amplitude climbs to a crest, falls away, climbs again — and
      // the boundary is the VALLEY between two crests.
      //
      // This is a SECOND pass, applied to the trains the gap rule has already
      // produced. A train the gap rule got right, holding a single arch, has
      // no qualifying valley and passes through untouched.
      //
      // Everything works on the peak contour — the line through the peak tops,
      // indexed by peak rather than by sample. That is the curve the eye
      // actually follows, and it is far cheaper and quieter than the envelope.
      //
      // Two properties matter, and both are places the previous slope-based
      // arch splitter went wrong:
      //   • The cut lands at the MIDDLE of the valley floor, not at the point
      //     where the descent first passes some threshold. Cutting on the
      //     falling limb hands the tail of each train to the next one.
      //   • Valley depth is measured as a FRACTION of the adjacent crests, so
      //     a quiet train and a loud one are judged alike. An absolute slope
      //     or drop is either unreachable in quiet passages or tripped by
      //     jitter in loud ones.

      // Peaks within this fraction of a train's amplitude range count as "the
      // same level" and merge into one basin — valley floors are rarely a
      // single peak wide.
      const PK_VALLEY_FLAT_TOL = 0.05;
      // Under this many peaks a train cannot hold two arches worth splitting.
      const PK_VALLEY_MIN_PEAKS = 5;
      // Depth at which a valley is unmistakable. Used only to seed the
      // automatic minimum-duration estimate, never as the user's threshold.
      const PK_VALLEY_CLEAR_DEPTH = 0.6;
      // Automatic minimum train duration, as a fraction of the median duration
      // the unmistakable valleys produce.
      const PK_VALLEY_DUR_FRAC = 0.5;

      // Candidate valleys inside one train: flat-bottomed local minima, each
      // scored by how deep it sits relative to the crests immediately beside
      // it. Returns [{mid, depth}] where `mid` is the index to cut after.
      function pkTrainValleys(train) {
        const n = train.length;
        if (n < PK_VALLEY_MIN_PEAKS) return [];
        const amps = train.map((p) => p.amp);
        let lo = Infinity,
          hi = -Infinity;
        for (const a of amps) {
          if (a < lo) lo = a;
          if (a > hi) hi = a;
        }
        const tol = (hi - lo) * PK_VALLEY_FLAT_TOL;

        // Basins: interior floors walled in by a clearly higher peak on each
        // side. Seeded on a true local minimum, then widened across peaks
        // within tol of the bottom on EITHER side.
        //
        // The two-sided widening is load-bearing. A one-sided "keep going
        // while the next peak is no higher than the running minimum" test is
        // satisfied by any descent, so a basin swallows the whole falling limb
        // from the crest down and its midpoint lands halfway down the slope —
        // reintroducing the very mid-slope cut this rewrite exists to avoid.
        const basins = [];
        for (let m = 1; m < n - 1; m++) {
          if (!(amps[m] < amps[m - 1] && amps[m] <= amps[m + 1])) continue;
          const mn = amps[m];
          let s = m,
            e = m;
          while (s - 1 >= 1 && Math.abs(amps[s - 1] - mn) <= tol) s--;
          while (e + 1 <= n - 2 && Math.abs(amps[e + 1] - mn) <= tol) e++;
          if (amps[s - 1] > mn + tol && amps[e + 1] > mn + tol) {
            if (basins.length && basins[basins.length - 1].e >= s) continue;
            basins.push({ s, e, mn });
            m = e;
          }
        }

        // Depth against the ADJACENT crest on each side, not the train's
        // overall maximum: in a run of arches of unequal height, measuring
        // against a distant tall arch would inflate every valley beside a
        // short one.
        return basins.map((b, j) => {
          const lStart = j > 0 ? basins[j - 1].e + 1 : 0;
          const rEnd = j < basins.length - 1 ? basins[j + 1].s - 1 : n - 1;
          let lMax = 0;
          for (let k = lStart; k < b.s; k++) if (amps[k] > lMax) lMax = amps[k];
          let rMax = 0;
          for (let k = b.e + 1; k <= rEnd; k++)
            if (amps[k] > rMax) rMax = amps[k];
          const crest = Math.min(lMax, rMax);
          // Where to cut. For a floor several peaks wide, its middle.
          //
          // For a floor exactly ONE peak wide the midpoint rule always hands
          // that peak to the train on its left, even when it sits much closer
          // in time to the one on its right. That misassigns the peak, and it
          // also drops the boundary into the NARROWER of the two gaps, where
          // train edge padding then makes the two trains overlap. So a lone
          // valley peak goes to whichever side its nearest peak is on — which
          // is the same thing as putting the cut in the wider gap.
          let mid = Math.floor((b.s + b.e) / 2);
          if (b.s === b.e) {
            const m = b.s;
            const toLeft = train[m].time - train[m - 1].time;
            const toRight = train[m + 1].time - train[m].time;
            // Move it only when the right side is MEANINGFULLY closer. Peak
            // times carry floating-point noise, and a bare `<` flips the
            // assignment on differences of ~1e-17 — which is no difference at
            // all. On a genuine tie the peak stays left, as it always did.
            if (toLeft - toRight > (toLeft + toRight) * 1e-6) mid = m - 1;
          }
          return { mid, depth: crest > 0 ? 1 - b.mn / crest : 0 };
        });
      }

      // Accept valleys deepest-first, refusing any cut that would leave a
      // segment shorter than minDurSec. Deepest-first is what makes this
      // stable: the real inter-train valleys are claimed before shallow
      // within-train modulation gets a chance at the same stretch.
      function pkAcceptValleys(train, cands, minDepth, minDurSec) {
        const n = train.length;
        const bounds = [-1, n - 1]; // sorted last-peak index of each segment
        const cuts = [];
        const ranked = cands
          .filter((c) => c.depth >= minDepth)
          .sort((a, b) => b.depth - a.depth);
        for (const c of ranked) {
          let li = 0;
          while (li + 1 < bounds.length && bounds[li + 1] < c.mid) li++;
          const loB = bounds[li],
            hiB = bounds[li + 1];
          if (c.mid <= loB || c.mid >= hiB) continue; // stretch already cut
          if (minDurSec > 0) {
            const leftDur = train[c.mid].time - train[loB + 1].time;
            const rightDur = train[hiB].time - train[c.mid + 1].time;
            if (leftDur < minDurSec || rightDur < minDurSec) continue;
          }
          bounds.splice(li + 1, 0, c.mid);
          cuts.push(c.mid);
        }
        return cuts.sort((a, b) => a - b);
      }

      function pkCutTrain(train, cuts) {
        const out = [];
        let start = 0;
        for (const c of cuts) {
          out.push(train.slice(start, c + 1));
          start = c + 1;
        }
        out.push(train.slice(start));
        return out;
      }

      // minDurMs null ⇒ derive it from the recording itself: take the trains
      // the unmistakable valleys carve out, and call half their median
      // duration the shortest believable train. This is the "average train
      // duration" guard, without asking for a number that differs per species.
      function pkSplitByValleys(trains, minDepthPct, minDurMs) {
        const minDepth = minDepthPct / 100;
        const cands = trains.map(pkTrainValleys);
        let minDurSec = minDurMs != null ? minDurMs / 1000 : null;
        if (minDurSec == null) {
          const durs = [];
          trains.forEach((t, i) => {
            const cuts = pkAcceptValleys(t, cands[i], PK_VALLEY_CLEAR_DEPTH, 0);
            pkCutTrain(t, cuts).forEach((seg) => {
              if (seg.length) durs.push(seg[seg.length - 1].time - seg[0].time);
            });
          });
          durs.sort((a, b) => a - b);
          const med = durs.length
            ? durs[Math.floor(durs.length / 2)]
            : 0;
          minDurSec = med * PK_VALLEY_DUR_FRAC;
        }
        const out = [];
        trains.forEach((t, i) => {
          pkCutTrain(t, pkAcceptValleys(t, cands[i], minDepth, minDurSec)).forEach(
            (seg) => {
              if (seg.length) out.push(seg);
            },
          );
        });
        return out;
      }

      // ── Group peaks into trains ─────────────────────────────────────────
      // Pass 1 is the gap/amplitude-drop rule and always runs. Pass 2 is the
      // arch splitter, and only subdivides what pass 1 produced — it can add
      // boundaries, never remove one the gap rule found.
      function pkGroupTrains(
        peaks,
        maxGapMs,
        maxDiffPct,
        archEnable,
        archDepthPct,
        archMinDurMs,
      ) {
        if (!peaks.length) return [];
        const maxGap = maxGapMs / 1000;
        const maxDiff = maxDiffPct != null ? maxDiffPct / 100 : null;

        const trains = [];
        let cur = [peaks[0]];
        for (let i = 1; i < peaks.length; i++) {
          const prev = peaks[i - 1],
            curr = peaks[i];
          const ampDrop =
            maxDiff != null &&
            prev.amp > curr.amp &&
            prev.amp - curr.amp > maxDiff;
          if (curr.time - prev.time > maxGap || ampDrop) {
            trains.push(cur);
            cur = [curr];
          } else cur.push(curr);
        }
        if (cur.length) trains.push(cur);

        return archEnable
          ? pkSplitByValleys(trains, archDepthPct, archMinDurMs)
          : trains;
      }

      // ── Group trains into motifs ────────────────────────────────────────
      // Edge padding (seconds) added to EACH side of every train (and thus
      // every motif/sequence) to account for the offset between a peak's true
      // acoustic onset and its amplitude maximum. Read live from the UI;
      // default 0.5 ms per side. Falls back to 0.5 ms if the input is absent.
      function pkTrainPadSec() {
        const ms = parseFloat($("pkTrainPad")?.value);
        return (isFinite(ms) && ms >= 0 ? ms : 0.5) / 1000;
      }
      // Clamp a time (seconds) to the valid signal range [0, duration].
      function pkClampT(t) {
        const d = duration || Infinity;
        return Math.max(0, Math.min(d, t));
      }

      function pkGroupMotifs(trains, maxTrainGapMs) {
        if (!trains.length) return [];
        const maxGap = maxTrainGapMs / 1000;
        const motifs = [];
        let cur = [trains[0]];
        for (let i = 1; i < trains.length; i++) {
          const prevEnd = trains[i - 1][trains[i - 1].length - 1].time;
          const currStart = trains[i][0].time;
          if (currStart - prevEnd > maxGap) {
            motifs.push(cur);
            cur = [trains[i]];
          } else {
            cur.push(trains[i]);
          }
        }
        if (cur.length) motifs.push(cur);
        return motifs;
      }

      // ── Group motifs into motif sequences ──────────────────────────────
      function pkGroupMotifSeqs(motifs, maxMotifGapMs) {
        if (!motifs.length) return [];
        const maxGap = maxMotifGapMs / 1000;
        const seqs = [];
        let cur = [motifs[0]];
        for (let i = 1; i < motifs.length; i++) {
          const prevEnd =
            motifs[i - 1][motifs[i - 1].length - 1][
              motifs[i - 1][motifs[i - 1].length - 1].length - 1
            ].time;
          const currStart = motifs[i][0][0].time;
          if (currStart - prevEnd > maxGap) {
            seqs.push(cur);
            cur = [motifs[i]];
          } else cur.push(motifs[i]);
        }
        if (cur.length) seqs.push(cur);
        return seqs;
      }

      // ── Temporal Analysis parameter presets (localStorage) ──────────────────
      // Stored under keys strid_pk_preset_1 .. _10. Each value is a JSON object
      // mapping field id → value/checked, plus an optional _name.
      const PK_PRESET_FIELDS = [
        "pkSmooth",
        "pkWin",
        "pkThresh",
        "pkDetThr",
        "pkLinkThr",
        "pkFalseDiff",
        "pkSpecResPeak",
        "pkSpecResTrain",
        "pkSpecResMotif",
        "pkMaxGap",
        "pkMaxDiff",
        "pkMinPeaks",
        "pkArchEnable",
        "pkArchDepth",
        "pkArchMinDur",
        "pkMaxTrainGap",
        "pkMotifSeq",
        "pkMaxMotifGap",
      ];
      function _pkPresetKey(n) {
        return "strid_pk_preset_" + n;
      }
      function _pkPresetStatus(msg, isErr) {
        const el = $("pkPresetStatus");
        if (el) {
          el.textContent = msg || "";
          el.style.color = isErr ? "#f85149" : "var(--txt3)";
        }
      }
      function _pkPresetAvailable() {
        try {
          localStorage.setItem("__pk_test__", "1");
          localStorage.removeItem("__pk_test__");
          return true;
        } catch (e) {
          return false;
        }
      }
      function _pkCapture() {
        const data = {};
        PK_PRESET_FIELDS.forEach((id) => {
          const el = $(id);
          if (!el) return;
          data[id] = el.type === "checkbox" ? el.checked : el.value;
        });
        return data;
      }
      function _pkApply(data) {
        // Presets saved before the field was renamed carry the old key. Map it
        // across on read so an existing slot doesn't silently lose its Δ.
        if ("pkFakeDiff" in data && !("pkFalseDiff" in data))
          data = { ...data, pkFalseDiff: data.pkFakeDiff };
        // Spectral windows used to be stored as durations. Convert an old
        // preset's milliseconds into the resolution it was really asking for,
        // so a saved parameter set keeps meaning the same thing.
        if ("pkSpecWin" in data && !("pkSpecResPeak" in data))
          data = {
            ...data,
            pkSpecResPeak: String(
              Math.round(1000 / Math.max(0.1, parseFloat(data.pkSpecWin) || 0.667)),
            ),
          };
        if ("pkSpecTrainWin" in data && !("pkSpecResTrain" in data))
          data = {
            ...data,
            pkSpecResTrain: String(
              Math.round(
                1000 / Math.max(1, parseFloat(data.pkSpecTrainWin) || 20),
              ),
            ),
          };
        PK_PRESET_FIELDS.forEach((id) => {
          const el = $(id);
          if (!el || !(id in data)) return;
          if (el.type === "checkbox") el.checked = !!data[id];
          else el.value = data[id];
        });
      }
      function _pkRefreshPresetLabels() {
        const sel = $("pkPresetSelect");
        if (!sel) return;
        for (let i = 1; i <= 10; i++) {
          let label = "Preset " + i;
          try {
            const raw = localStorage.getItem(_pkPresetKey(i));
            if (raw) {
              const d = JSON.parse(raw);
              label = d && d._name ? i + ": " + d._name : "Preset " + i + " ✓";
            }
          } catch (e) {}
          const opt = sel.querySelector('option[value="' + i + '"]');
          if (opt) opt.textContent = label;
        }
      }
      function pkPresetSave() {
        if (!_pkPresetAvailable()) {
          _pkPresetStatus(
            "Storage unavailable (open the file locally to use presets).",
            true,
          );
          return;
        }
        const sel = $("pkPresetSelect");
        let n = sel ? sel.value : "";
        if (!n) {
          // pick the first empty slot automatically
          for (let i = 1; i <= 10; i++) {
            if (!localStorage.getItem(_pkPresetKey(i))) {
              n = String(i);
              break;
            }
          }
          if (!n) {
            _pkPresetStatus(
              "All 10 slots are full — pick one to overwrite.",
              true,
            );
            return;
          }
          if (sel) sel.value = n;
        }
        const existing = (() => {
          try {
            return JSON.parse(localStorage.getItem(_pkPresetKey(n)) || "null");
          } catch (e) {
            return null;
          }
        })();
        const nm = prompt(
          "Name for Preset " + n + " (optional):",
          (existing && existing._name) || "",
        );
        if (nm === null) return; // cancelled
        const data = _pkCapture();
        data._name = nm.trim() || "Preset " + n;
        try {
          localStorage.setItem(_pkPresetKey(n), JSON.stringify(data));
          _pkRefreshPresetLabels();
          if (sel) sel.value = n;
          _pkPresetStatus('✔ Saved "' + data._name + '" to slot ' + n);
        } catch (e) {
          _pkPresetStatus("Save error: " + e.message, true);
        }
      }
      function pkPresetLoad() {
        if (!_pkPresetAvailable()) {
          _pkPresetStatus(
            "Storage unavailable (open the file locally to use presets).",
            true,
          );
          return;
        }
        const sel = $("pkPresetSelect");
        const n = sel ? sel.value : "";
        if (!n) {
          _pkPresetStatus("Select a preset slot first.", true);
          return;
        }
        let raw;
        try {
          raw = localStorage.getItem(_pkPresetKey(n));
        } catch (e) {
          _pkPresetStatus("Load error: " + e.message, true);
          return;
        }
        if (!raw) {
          _pkPresetStatus("Preset " + n + " is empty.", true);
          return;
        }
        try {
          const data = JSON.parse(raw);
          _pkApply(data);
          _pkPresetStatus(
            '✔ Loaded "' +
              (data._name || "Preset " + n) +
              '" — click Detect Peaks to apply.',
          );
        } catch (e) {
          _pkPresetStatus("Load error: " + e.message, true);
        }
      }
      function pkPresetDelete() {
        const sel = $("pkPresetSelect");
        const n = sel ? sel.value : "";
        if (!n) {
          _pkPresetStatus("Select a preset slot first.", true);
          return;
        }
        if (!localStorage.getItem(_pkPresetKey(n))) {
          _pkPresetStatus("Preset " + n + " is already empty.", true);
          return;
        }
        if (!confirm("Delete Preset " + n + "?")) return;
        try {
          localStorage.removeItem(_pkPresetKey(n));
          _pkRefreshPresetLabels();
          _pkPresetStatus("Preset " + n + " deleted.");
        } catch (e) {
          _pkPresetStatus("Delete error: " + e.message, true);
        }
      }

      // ── Presets as files ────────────────────────────────────────────────
      // The ten slots live in this machine's local storage. That is fine for
      // day-to-day work but cannot be copied to another computer, handed to a
      // collaborator, or kept in a project folder beside the recordings it
      // belongs to. A .json file does all three.
      const PK_PRESET_FILE_TYPE = "rthoptera-temporal-preset";

      async function pkPresetExportFile() {
        const sel = $("pkPresetSelect");
        let suggested = "";
        if (sel && sel.value) {
          try {
            const d = JSON.parse(
              localStorage.getItem(_pkPresetKey(sel.value)) || "null",
            );
            if (d && d._name) suggested = d._name;
          } catch (e) {}
        }
        const data = _pkCapture();
        data._type = PK_PRESET_FILE_TYPE;
        data._version = 1;
        data._name = suggested || "temporal preset";
        data._saved = new Date().toISOString();

        // No JS prompt for the name: dlFile opens the OS save dialog, where
        // the folder can be browsed and the filename edited directly. Asking
        // twice for the same thing is just an extra step to dismiss.
        const stem =
          data._name.replace(/[^\w.-]+/g, "_").toLowerCase() || "temporal_preset";
        try {
          // exactName: a preset describes a parameter set, not a recording, so
          // it has to escape dlFile's rename-after-the-loaded-audio intercept
          // — otherwise every preset would be saved under the name of whatever
          // WAV happened to be open.
          await dlFile(
            stem + "_preset.json",
            JSON.stringify(data, null, 2),
            "application/json",
            { exactName: true },
          );
          _pkPresetStatus("Preset exported.");
        } catch (e) {
          _pkPresetStatus("Export failed: " + e.message, true);
        }
      }

      async function pkPresetImportFile(file) {
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          // Accept anything carrying recognisable parameter fields, so a
          // preset hand-edited or produced by an older build still loads; only
          // reject a file with nothing usable in it at all.
          const known = PK_PRESET_FIELDS.filter((id) => id in data);
          const legacy = "pkFakeDiff" in data;
          if (!known.length && !legacy)
            throw new Error("no Temporal Analysis parameters in this file");
          _pkApply(data);
          _pkPresetStatus(
            'Loaded ' +
              (known.length + (legacy && !known.includes("pkFalseDiff") ? 1 : 0)) +
              " parameter(s)" +
              (data._name ? ' from "' + data._name + '"' : "") +
              ". Not stored in a slot — use 💾 Save to keep it.",
          );
        } catch (e) {
          _pkPresetStatus("Could not read preset: " + e.message, true);
        }
      }

      // ── Shared parameter + grouping helpers ─────────────────────────────
      function pkReadParams() {
        const maxDiffRaw = $("pkMaxDiff").value.trim();
        const linkRaw = $("pkLinkThr").value.trim();
        return {
          smoothMs: Math.max(0.5, parseFloat($("pkSmooth").value) || 1),
          winMs: Math.max(0.05, parseFloat($("pkWin").value) || 5),
          peakThr: parseFloat($("pkThresh").value) || 0.5,
          detThr: parseFloat($("pkDetThr").value) || 15,
          linkThr: linkRaw === "" ? null : parseFloat(linkRaw),
          maxGapMs: parseFloat($("pkMaxGap").value) || 10,
          maxDiff: maxDiffRaw === "" ? null : parseFloat(maxDiffRaw),
          archEnable: $("pkArchEnable").checked,
          archDepth: parseFloat($("pkArchDepth").value) || 40,
          // Blank ⇒ derive the shortest believable train from the recording.
          archMinDur:
            $("pkArchMinDur").value.trim() === ""
              ? null
              : parseFloat($("pkArchMinDur").value),
          maxTrainGapMs: parseFloat($("pkMaxTrainGap").value) || 300,
          minPeaks: parseInt($("pkMinPeaks").value) || 3,
          useMotifSeq: $("pkMotifSeq").checked,
          maxMotifGapMs: parseFloat($("pkMaxMotifGap").value) || 800,
        };
      }

      // ── Stage 1: fit grouping parameters to hand-corrected trains ───────
      // The boundaries you have already fixed by hand ARE the training target.
      // pkInitBoundaries freezes the algorithm into splitAfter flags and every
      // manual edit only moves those flags, so the current state of a selected
      // span is already a labelled example — no separate annotation step.
      //
      // Only the GROUPING parameters are fitted: Max peak gap, Max amp diff,
      // and the arch splitter's on/off + valley depth + min train. Peak
      // DETECTION is held fixed. It decides which peaks exist, so refitting it
      // would move the target and the reference at the same time, and would
      // mean recomputing the envelope once per candidate.
      let pkFitBest = null;

      // The span to train on: the peaks you selected, else whatever is on
      // screen. Selection is the deliberate choice; the visible range is the
      // convenient fallback.
      function pkFitWindow() {
        const idxs = pkSelectionIndices();
        if (idxs.length >= 2)
          return {
            lo: idxs[0],
            hi: idxs[idxs.length - 1],
            source: "selection",
          };
        const t0 = pkViewStart;
        const t1 = pkViewEnd == null ? duration : pkViewEnd;
        let lo = -1,
          hi = -1;
        pkPeaks.forEach((p, i) => {
          if (p.time >= t0 && p.time <= t1) {
            if (lo < 0) lo = i;
            hi = i;
          }
        });
        return lo < 0 ? null : { lo, hi, source: "visible range" };
      }

      // Boundaries are compared as TIMES, not peak indices, so a score stays
      // meaningful even if the peak set later shifts under it.
      function pkRefBoundaries(lo, hi) {
        const out = [];
        for (let i = lo; i < hi; i++)
          if (pkPeaks[i].splitAfter)
            out.push((pkPeaks[i].time + pkPeaks[i + 1].time) / 2);
        return out;
      }
      function pkTrainBoundaryTimes(trains) {
        const out = [];
        for (let i = 0; i + 1 < trains.length; i++) {
          const a = trains[i][trains[i].length - 1];
          const b = trains[i + 1][0];
          out.push((a.time + b.time) / 2);
        }
        return out;
      }

      // F1 over greedily matched boundaries. Both empty is a perfect score —
      // predicting no boundary where none was marked is correct, not a miss.
      function pkMatchF1(ref, pred, tol) {
        if (!ref.length && !pred.length) return 1;
        const used = new Array(pred.length).fill(false);
        let tp = 0;
        for (const r of ref) {
          let best = -1,
            bestD = tol;
          for (let j = 0; j < pred.length; j++) {
            if (used[j]) continue;
            const d = Math.abs(pred[j] - r);
            if (d <= bestD) {
              bestD = d;
              best = j;
            }
          }
          if (best >= 0) {
            used[best] = true;
            tp++;
          }
        }
        if (!tp) return 0;
        return (2 * tp) / (2 * tp + (pred.length - tp) + (ref.length - tp));
      }

      // ── Amplitude-shape agreement ────────────────────────────────────────
      // How well a train's amplitudes form ONE arc. Find the crest, then total
      // every move that contradicts a single rise-then-fall — a dip before the
      // crest, a climb after it — as a share of the profile's total movement.
      // 1 means a clean arc; a train holding two arches scores well below.
      //
      // Note this measures unimodality, not "must rise then fall": a train
      // that only decays is still one arc, and correctly scores 1. What it
      // punishes is UNDER-splitting, where two arches sit in one train.
      function pkArcUnimodality(train) {
        const n = train.length;
        if (n < 3) return 1;
        let imax = 0;
        for (let i = 1; i < n; i++)
          if (train[i].amp > train[imax].amp) imax = i;
        let viol = 0,
          tv = 0;
        for (let i = 0; i + 1 < n; i++) {
          const d = train[i + 1].amp - train[i].amp;
          tv += Math.abs(d);
          if (i < imax ? d < 0 : d > 0) viol += Math.abs(d);
        }
        return tv > 0 ? 1 - viol / tv : 1;
      }

      // Shape + size summary of a segmentation, for comparing a candidate's
      // behaviour against the hand-corrected trains.
      function pkSegStats(trains) {
        const durs = [];
        let wsum = 0,
          w = 0;
        trains.forEach((t) => {
          if (t.length < 2) return;
          durs.push(t[t.length - 1].time - t[0].time);
          wsum += pkArcUnimodality(t) * t.length;
          w += t.length;
        });
        durs.sort((a, b) => a - b);
        return {
          medDur: durs.length ? durs[Math.floor(durs.length / 2)] : 0,
          arc: w ? wsum / w : 1,
        };
      }

      // Unimodality alone would happily reward chopping every arc into
      // fragments — each fragment is trivially one arc. Pairing it with
      // agreement on median train DURATION closes that off from both sides:
      // over-splitting shortens the trains, under-splitting wrecks the arcs.
      function pkShapePenalty(st, refStats) {
        const durTerm =
          refStats.medDur > 0 && st.medDur > 0
            ? Math.abs(Math.log(st.medDur / refStats.medDur))
            : 2;
        return durTerm + (1 - st.arc);
      }

      // Every threshold strictly between two observed values behaves
      // identically, so the midpoints between consecutive observed values
      // enumerate every distinct behaviour a threshold can have — a complete
      // search over far fewer candidates than an arbitrary numeric grid.
      function pkCandidateThresholds(values, cap) {
        const u = [...new Set(values)].sort((a, b) => a - b);
        if (!u.length) return [];
        const out = [u[0] * 0.5];
        for (let i = 0; i + 1 < u.length; i++) out.push((u[i] + u[i + 1]) / 2);
        out.push(u[u.length - 1] * 1.5);
        if (out.length <= cap) return out;
        const step = (out.length - 1) / (cap - 1);
        const thin = [];
        for (let i = 0; i < cap; i++) thin.push(out[Math.round(i * step)]);
        return [...new Set(thin)];
      }

      const PK_FIT_DEPTHS = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];

      // Exhaustive over the candidate grid. Pass 1 (gap + amp drop) depends
      // only on the first two parameters, so it is computed once per pair and
      // the arch variants are layered on top of the result.
      //
      // Scores against SEVERAL reference sets in one sweep and returns the
      // best for each. Leave-one-out needs a fit per held-out boundary, and
      // those fits differ only in scoring — the regrouping is identical. Doing
      // them as separate sweeps made leave-one-out cost 19× the fit itself
      // (9.2s on a 500-peak span); folded in here it is close to free.
      //
      // Ties are broken toward the CENTRE of each parameter's candidate range.
      // With only a handful of boundaries many settings score identically, and
      // the ones sitting on a cliff edge are the ones that break on the next
      // recording.
      async function pkFitSearch(peaks, refSets, tol, minRefDurSec, onProgress) {
        const gaps = pkCandidateThresholds(
          peaks.slice(1).map((p, i) => p.time - peaks[i].time),
          30,
        );
        const drops = [];
        for (let i = 1; i < peaks.length; i++) {
          const d = peaks[i - 1].amp - peaks[i].amp;
          if (d > 0) drops.push(d);
        }
        const diffs = [null, ...pkCandidateThresholds(drops, 15)];
        // A guard longer than the shortest reference train would veto a cut
        // the reference says is correct, so cap the candidates below it.
        const minDurs = [null, 0];
        if (minRefDurSec > 0)
          minDurs.push(minRefDurSec * 500, minRefDurSec * 900); // ms
        const mid = (i, n) => (n < 2 ? 0 : Math.abs(i - (n - 1) / 2) / (n - 1));

        const bests = refSets.map(() => null);
        // Settings that tie with the leader on the real reference set (index
        // 0). The labels cannot separate these, so amplitude shape does it
        // afterwards — see pkFitEvaluate.
        const ties = [];
        const offer = (cen, params, pred) => {
          refSets.forEach((ref, si) => {
            const f1 = pkMatchF1(ref, pred, tol);
            const b = bests[si];
            const better = !b || f1 > b.f1 + 1e-9;
            if (better || (f1 > b.f1 - 1e-9 && cen < b.cen))
              bests[si] = { f1, cen, params, pred };
            if (si === 0) {
              if (better) {
                ties.length = 0;
                ties.push({ cen, params });
              } else if (
                f1 > bests[0].f1 - 1e-9 &&
                ties.length < PK_FIT_MAX_TIES
              )
                ties.push({ cen, params });
            }
          });
        };

        for (let gi = 0; gi < gaps.length; gi++) {
          const g = gaps[gi];
          diffs.forEach((d, di) => {
            const gapMs = g * 1000;
            const diffPct = d == null ? null : d * 100;
            const base = pkGroupTrains(peaks, gapMs, diffPct, false, 0, null);
            const cen0 = mid(gi, gaps.length) + mid(di, diffs.length);
            offer(
              cen0,
              {
                maxGapMs: gapMs,
                maxDiff: diffPct,
                archEnable: false,
                archDepth: 40,
                archMinDur: null,
              },
              pkTrainBoundaryTimes(base),
            );
            PK_FIT_DEPTHS.forEach((dep, pi) => {
              minDurs.forEach((md, mi) => {
                offer(
                  cen0 +
                    mid(pi, PK_FIT_DEPTHS.length) +
                    mid(mi, minDurs.length),
                  {
                    maxGapMs: gapMs,
                    maxDiff: diffPct,
                    archEnable: true,
                    archDepth: dep,
                    archMinDur: md,
                  },
                  pkTrainBoundaryTimes(pkSplitByValleys(base, dep, md)),
                );
              });
            });
          });
          // Yield every few gap values so the bar moves. Too often and the
          // frame waits dominate the search; too rarely and it looks stuck.
          if (onProgress && (gi % 4 === 3 || gi === gaps.length - 1)) {
            onProgress((gi + 1) / gaps.length);
            await busyTick();
          }
        }
        return { bests, ties };
      }

      // ── Stage 2: fit peak-DETECTION parameters ───────────────────────────
      // Stage 1 takes the peak set as given and only decides where to cut it.
      // This decides the peak set itself, learning from the peaks you kept,
      // added and deleted by hand — edits Stage 1 is blind to.
      //
      // Smoothing is deliberately NOT fitted. It is yours to set, and it is
      // also the one parameter whose change forces the whole envelope to be
      // recomputed; holding it fixed means the envelope is computed once and
      // every candidate only re-runs peak finding.
      //
      // Detection runs on a padded SLICE of the envelope rather than the whole
      // recording — hundreds of candidates over millions of samples would take
      // minutes, over a few thousand it is instant. The padding gives the
      // prominence walk somewhere to go before it hits an artificial edge.
      const PK_FIT_SLICE_PAD_S = 0.05;

      // F1 over greedily matched peak TIMES. Same shape as the boundary match,
      // but the tolerance is much tighter: two peaks a whole spacing apart are
      // different peaks, not a near miss.
      function pkPeakMatchF1(refTimes, predTimes, tol) {
        if (!refTimes.length && !predTimes.length) return 1;
        const used = new Array(predTimes.length).fill(false);
        let tp = 0;
        for (const r of refTimes) {
          let best = -1,
            bestD = tol;
          for (let j = 0; j < predTimes.length; j++) {
            if (used[j]) continue;
            const d = Math.abs(predTimes[j] - r);
            if (d <= bestD) {
              bestD = d;
              best = j;
            }
          }
          if (best >= 0) {
            used[best] = true;
            tp++;
          }
        }
        if (!tp) return 0;
        return (
          (2 * tp) /
          (2 * tp + (predTimes.length - tp) + (refTimes.length - tp))
        );
      }

      // Search detection settings against the peaks you kept. Δ (false-peak)
      // is applied as post-processing on an already-detected list, so it sits
      // in the innermost loop and costs no extra detection passes.
      async function pkFitDetection(refPeaks, t0, t1, maxGapMs, onProgress) {
        const spac = refPeaks
          .slice(1)
          .map((p, i) => p.time - refPeaks[i].time)
          .sort((a, b) => a - b);
        const medSpac = spac.length ? spac[Math.floor(spac.length / 2)] : 0.002;
        const tol = Math.max(medSpac * 0.25, 0.0002);
        const refTimes = refPeaks.map((p) => p.time);

        const pad = PK_FIT_SLICE_PAD_S;
        const lo = Math.max(0, Math.floor((t0 - pad) * sampleRate));
        const hi = Math.min(pkEnv.length, Math.ceil((t1 + pad) * sampleRate));
        const slice = pkEnv.subarray(lo, hi);
        const offsetSec = lo / sampleRate;
        const silenceFloor = pkPercentile(pkEnv, 5);

        // Peak window caps how close two peaks may be, so scale the candidates
        // to the spacing actually present rather than to arbitrary numbers.
        const msSpac = medSpac * 1000;
        const winCands = [...new Set(
          [0.05, 0.12, 0.25, 0.4].map((f) =>
            Math.max(0.1, Math.round(msSpac * f * 100) / 100),
          ),
        )];
        const promCands = [0.1, 0.25, 0.5, 1, 2, 4];
        // Detection threshold: thresholds between observed reference
        // amplitudes enumerate the distinct behaviours, same trick as Stage 1.
        const detCands = pkCandidateThresholds(
          refPeaks.map((p) => p.amp),
          10,
        ).map((v) => v * 100);
        const falseCands = [null, 5, 15, 30];

        let best = null;
        let done = 0;
        const total = winCands.length * promCands.length * detCands.length;
        for (const winMs of winCands) {
          for (const peakThr of promCands) {
            for (const detThr of detCands) {
              // Onset threshold only means anything below the detection bar.
              for (const linkThr of [null, detThr * 0.5, detThr * 0.25]) {
                const found = pkFindPeaks(
                  slice,
                  winMs,
                  peakThr,
                  detThr,
                  linkThr,
                  maxGapMs,
                );
                const shifted = found
                  .map((p) => ({ time: p.time + offsetSec, amp: p.amp }))
                  .filter((p) => p.time >= t0 && p.time <= t1);
                for (const falseDiff of falseCands) {
                  const kept = pkWithoutFalsePeaks(
                    shifted,
                    silenceFloor,
                    falseDiff,
                  );
                  const f1 = pkPeakMatchF1(
                    refTimes,
                    kept.map((p) => p.time),
                    tol,
                  );
                  if (!best || f1 > best.f1 + 1e-9) {
                    best = {
                      f1,
                      peaks: kept,
                      params: {
                        winMs,
                        peakThr,
                        detThr,
                        linkThr,
                        falseDiff,
                      },
                    };
                  }
                }
              }
              done++;
            }
          }
          if (onProgress) {
            onProgress(done / total);
            await busyTick();
          }
        }
        return best;
      }

      // Hold out one reference boundary at a time, refit without it, and ask
      // whether the fit puts it back. This is the number that says whether the
      // training score is real or memorised — with a handful of boundaries the
      // training score is nearly always 100%, and on its own means little.
      const PK_FIT_MAX_FOLDS = 12;
      // Ceiling on how many tied settings get the whole-recording shape check.
      const PK_FIT_MAX_TIES = 120;

      async function pkFitEvaluate(
        peaks,
        ref,
        tol,
        minRefDurSec,
        allPeaks,
        onProgress,
      ) {
        let foldOf = [];
        if (ref.length >= 2) {
          foldOf = ref.map((_, j) => j);
          if (foldOf.length > PK_FIT_MAX_FOLDS) {
            const step = (foldOf.length - 1) / (PK_FIT_MAX_FOLDS - 1);
            foldOf = Array.from({ length: PK_FIT_MAX_FOLDS }, (_, i) =>
              Math.round(i * step),
            );
            foldOf = [...new Set(foldOf)];
          }
        }
        const sets = [
          ref,
          ...foldOf.map((j) => ref.filter((_, k) => k !== j)),
        ];
        const { bests, ties } = await pkFitSearch(
          peaks,
          sets,
          tol,
          minRefDurSec,
          onProgress,
        );
        let loo = null;
        if (foldOf.length) {
          let hit = 0;
          foldOf.forEach((j, i) => {
            const b = bests[i + 1];
            if (b && b.pred.some((t) => Math.abs(t - ref[j]) <= tol)) hit++;
          });
          loo = { hit, total: foldOf.length };
        }

        // ── Amplitude tie-break ──────────────────────────────────────────
        // Boundary times alone cannot separate settings that produce the same
        // cuts inside the training window, yet those settings can behave very
        // differently over the REST of the recording — which is the part that
        // matters and the part with no labels on it.
        //
        // So among the tied settings, prefer the one whose trains most
        // resemble the hand-corrected ones across the whole file: same kind of
        // amplitude arc, same rough duration. This is the only place peak
        // amplitude enters the fit, and it is deliberately a tie-break — it
        // can never override a setting that matches your boundaries better.
        let shape = null;
        if (allPeaks && allPeaks.length && ties.length > 1) {
          const refTrains = [];
          let seg = [peaks[0]];
          const refSet = new Set(ref);
          for (let i = 1; i < peaks.length; i++) {
            const bt = (peaks[i - 1].time + peaks[i].time) / 2;
            if (refSet.has(bt)) {
              refTrains.push(seg);
              seg = [peaks[i]];
            } else seg.push(peaks[i]);
          }
          refTrains.push(seg);
          const refStats = pkSegStats(refTrains);

          let pick = null;
          for (const c of ties) {
            const p = c.params;
            const st = pkSegStats(
              pkGroupTrains(
                allPeaks,
                p.maxGapMs,
                p.maxDiff,
                p.archEnable,
                p.archDepth,
                p.archMinDur,
              ),
            );
            const pen = pkShapePenalty(st, refStats);
            if (!pick || pen < pick.pen - 1e-9 ||
                (pen < pick.pen + 1e-9 && c.cen < pick.cen))
              pick = { pen, cen: c.cen, params: p, arc: st.arc };
          }
          if (pick) {
            shape = {
              considered: ties.length,
              arc: pick.arc,
              refArc: refStats.arc,
              changed:
                JSON.stringify(pick.params) !==
                JSON.stringify(bests[0].params),
            };
            bests[0] = { ...bests[0], params: pick.params };
          }
        }
        return { best: bests[0], loo, shape };
      }

      function _pkFitStatus(msg, cls) {
        const el = $("pkFitStatus");
        if (!el) return;
        el.textContent = msg || "";
        el.style.color =
          cls === "err"
            ? "#f85149"
            : cls === "warn"
              ? "#d29922"
              : "var(--txt3)";
      }

      async function pkFitGrouping() {
        pkFitBest = null;
        const applyBtn = $("btnPkFitApply");
        if (applyBtn) applyBtn.disabled = true;
        if (!pkPeaks.length) {
          _pkFitStatus("Detect peaks first.", "err");
          return;
        }
        const win = pkFitWindow();
        if (!win || win.hi - win.lo < 2) {
          _pkFitStatus(
            "Select the peaks of the trains you corrected (or zoom to them).",
            "err",
          );
          return;
        }
        const peaks = pkPeaks.slice(win.lo, win.hi + 1);
        const ref = pkRefBoundaries(win.lo, win.hi);
        if (!ref.length) {
          _pkFitStatus(
            "No train boundaries inside that span — nothing to learn from.",
            "err",
          );
          return;
        }

        // Match tolerance: half the median peak spacing. Tight enough that a
        // boundary in the wrong gap counts as wrong, loose enough to survive
        // a cut landing one peak either side of the reference.
        const spac = peaks
          .slice(1)
          .map((p, i) => p.time - peaks[i].time)
          .sort((a, b) => a - b);
        const tol = spac.length ? spac[Math.floor(spac.length / 2)] / 2 : 0.001;

        // Shortest reference train in the span, used to cap the min-train
        // guard candidates.
        let minRefDur = Infinity,
          segStart = 0;
        const refIdx = [];
        for (let i = win.lo; i < win.hi; i++)
          if (pkPeaks[i].splitAfter) refIdx.push(i - win.lo);
        [...refIdx, peaks.length - 1].forEach((end) => {
          minRefDur = Math.min(
            minRefDur,
            peaks[end].time - peaks[segStart].time,
          );
          segStart = end + 1;
        });
        if (!isFinite(minRefDur)) minRefDur = 0;

        const alsoDetect = !!$("pkFitDetect")?.checked;

        const fitted = await withBusy("Fitting…", async (progress) => {
          // Stage 2 first, if asked: the peak set it settles on is what
          // Stage 1 then gets grouped. Fitting grouping against the OLD peaks
          // and detection against the new ones would leave the two disagreeing.
          let det = null;
          let detRejected = false;
          let workPeaks = peaks;
          if (alsoDetect) {
            const d = await pkFitDetection(
              peaks,
              peaks[0].time,
              peaks[peaks.length - 1].time,
              parseFloat($("pkMaxGap").value) || 10,
              (f) =>
                progress(
                  "Fitting peak detection… " + Math.round(f * 100) + "%",
                  f * 0.5,
                ),
            );
            // Adopt the detection fit only if it produced a usable peak set.
            // Keeping its parameters after rejecting its peaks would write
            // settings into the panels that the grouping fit never saw, and
            // that find almost nothing when Apply re-runs detection.
            if (d && d.peaks.length >= 3) {
              det = d;
              workPeaks = d.peaks;
            } else if (d) detRejected = true;
          }
          const ev = await pkFitEvaluate(
            workPeaks,
            ref,
            tol,
            minRefDur,
            alsoDetect ? null : pkPeaks,
            (f) =>
              progress(
                "Fitting grouping… " + Math.round(f * 100) + "%",
                alsoDetect ? 0.5 + f * 0.5 : f,
              ),
          );
          return { ...ev, det, detRejected };
        });

        const { best, loo, shape, det, detRejected } = fitted;
        if (!best) {
          _pkFitStatus("Search produced no candidate.", "err");
          return;
        }
        if (det) best.params = { ...best.params, detection: det.params };
        pkFitBest = best;
        if (applyBtn) applyBtn.disabled = false;

        const p = best.params;
        const bits = [];
        if (det)
          bits.push(
            "peaks " +
              (det.f1 * 100).toFixed(0) +
              "% (win " +
              det.params.winMs +
              "ms, prom " +
              det.params.peakThr +
              "%, det " +
              det.params.detThr.toFixed(1) +
              "%, onset " +
              (det.params.linkThr == null
                ? "off"
                : det.params.linkThr.toFixed(1) + "%") +
              ", Δ " +
              (det.params.falseDiff == null
                ? "off"
                : det.params.falseDiff + "%") +
              ")",
          );
        bits.push(
          "gap " + p.maxGapMs.toFixed(1) + "ms",
          "amp diff " + (p.maxDiff == null ? "off" : p.maxDiff.toFixed(1) + "%"),
          p.archEnable
            ? "arch " +
              p.archDepth +
              "% / " +
              (p.archMinDur == null ? "auto" : p.archMinDur.toFixed(0) + "ms")
            : "arch off",
        );
        const trainPct = (best.f1 * 100).toFixed(0);
        let msg =
          ref.length +
          " boundaries from " +
          win.source +
          " → " +
          bits.join(", ") +
          " · fit " +
          trainPct +
          "%";
        let cls = "";
        if (loo) {
          msg += " · held-out " + loo.hit + "/" + loo.total;
          if (loo.hit < loo.total) cls = "warn";
        }
        if (shape) {
          msg +=
            " · arc " +
            (shape.arc * 100).toFixed(0) +
            "% vs " +
            (shape.refArc * 100).toFixed(0) +
            "% ref" +
            (shape.changed
              ? " (chosen from " + shape.considered + " tied on shape)"
              : "");
        }
        if (ref.length < 9) {
          msg += " · only " + ref.length + " boundaries — check on more";
          cls = cls || "warn";
        }
        // Say plainly which half was fitted: with the box unticked, Apply
        // changes grouping only, and that is easy to mistake for a fault.
        if (detRejected) {
          msg += " · detection fit found too few peaks — grouping only";
          cls = "warn";
        } else if (!det) {
          msg += " · grouping only (tick “incl. peak detection” to fit that too)";
        }
        _pkFitStatus(msg, cls);
      }

      // Writes the fitted values into the parameter inputs and re-applies them
      // across the WHOLE recording. Manual edits are replaced — boundary edits
      // always, and peak edits too when detection was part of the fit. That is
      // the point: the parameters now reproduce them without the hand work.
      async function pkFitApply() {
        if (!pkFitBest) return;
        const p = pkFitBest.params;
        $("pkMaxGap").value = String(Math.round(p.maxGapMs * 10) / 10);
        $("pkMaxDiff").value =
          p.maxDiff == null ? "" : String(Math.round(p.maxDiff * 10) / 10);
        $("pkArchEnable").checked = p.archEnable;
        $("pkArchDepth").value = String(p.archDepth);
        $("pkArchMinDur").value =
          p.archMinDur == null ? "" : String(Math.round(p.archMinDur));

        if (p.detection) {
          const d = p.detection;
          $("pkWin").value = String(d.winMs);
          $("pkThresh").value = String(d.peakThr);
          $("pkDetThr").value = String(Math.round(d.detThr * 100) / 100);
          $("pkLinkThr").value =
            d.linkThr == null ? "" : String(Math.round(d.linkThr * 100) / 100);
          $("pkFalseDiff").value =
            d.falseDiff == null ? "" : String(d.falseDiff);
          // Detection changed, so the peak list itself has to be rebuilt —
          // re-freezing boundaries over the old peaks would be meaningless.
          // Smoothing is untouched, so the envelope comes out identical.
          await pkDetect();
          _pkFitStatus(
            "Applied. Peaks re-detected and boundaries regrouped — manual edits replaced.",
            "",
          );
          return;
        }

        pkInitBoundaries();
        pkLiveUpdate("fitted parameters applied to the whole recording");
        _pkFitStatus("Applied. Manual boundary edits were replaced.", "");
      }

      // ── Frozen segmentation ─────────────────────────────────────────────
      // Build trains by walking the peaks and cutting wherever splitAfter is set.
      // This is purely local: it never consults the grouping algorithm, so editing
      // one boundary can never change any other boundary.
      function pkBuildTrains() {
        const trains = [];
        if (!pkPeaks.length) return trains;
        let cur = [pkPeaks[0]];
        for (let i = 1; i < pkPeaks.length; i++) {
          if (pkPeaks[i - 1].splitAfter) {
            trains.push(cur);
            cur = [pkPeaks[i]];
          } else cur.push(pkPeaks[i]);
        }
        trains.push(cur);
        return trains;
      }

      // Run the detection algorithm ONCE and freeze its segmentation into flags.
      function pkInitBoundaries() {
        const P = pkReadParams();
        const rawTrains = pkGroupTrains(
          pkPeaks,
          P.maxGapMs,
          P.maxDiff,
          P.archEnable,
          P.archDepth,
          P.archMinDur,
        );
        pkPeaks.forEach((p) => {
          p.splitAfter = false;
        });
        rawTrains.forEach((tr, ti) => {
          if (ti < rawTrains.length - 1) tr[tr.length - 1].splitAfter = true; // boundary after each train
        });
      }

      // Recompute trains/motifs from the FROZEN segmentation (no algorithm).
      function pkComputeGroups() {
        const P = pkReadParams();
        const trains = pkBuildTrains().filter((t) => t.length >= P.minPeaks);
        const motifs = pkGroupMotifs(trains, P.maxTrainGapMs);
        const motifSeqs = P.useMotifSeq
          ? pkGroupMotifSeqs(motifs, P.maxMotifGapMs)
          : [];
        return { P, trains, motifs, motifSeqs };
      }

      // Regroup, redraw, and report counts after a manual edit.
      function pkLiveUpdate(note) {
        const { trains, motifs } = pkComputeGroups();
        if (pkConfirmed) {
          $("pkStatus").textContent =
            pkPeaks.length +
            " peaks → " +
            trains.length +
            " trains → " +
            motifs.length +
            " motifs" +
            (note ? "  (" + note + ")" : "") +
            " · click Confirm to recompute metrics";
        } else {
          $("pkStatus").textContent =
            pkPeaks.length +
            " peaks → " +
            trains.length +
            " trains → " +
            motifs.length +
            " motifs" +
            (note ? "  (" + note + ")" : "");
        }
        const applyBtn = $("btnPkApplySpectral");
        if (applyBtn) applyBtn.disabled = !pkPeaks.length;
        const falseBtn = $("btnPkFilterFalse");
        if (falseBtn) falseBtn.disabled = !pkPeaks.length;
        pkUpdateSelectionButtons();
        pkDrawEnvelope();
      }

      // Approximate percentile of a large array via a fixed-bin histogram —
      // O(n), avoids sorting a possibly multi-million-sample envelope just
      // to find a robust "silence floor" reference.
      function pkPercentile(arr, pct) {
        const NB = 1000;
        const hist = new Uint32Array(NB);
        const n = arr.length;
        for (let i = 0; i < n; i++) {
          let b = Math.floor(arr[i] * NB);
          if (b < 0) b = 0;
          else if (b >= NB) b = NB - 1;
          hist[b]++;
        }
        const target = Math.max(1, Math.round((n * pct) / 100));
        let cum = 0;
        for (let b = 0; b < NB; b++) {
          cum += hist[b];
          if (cum >= target) return b / NB;
        }
        return 1;
      }

      // ── False-peak filter ────────────────────────────────────────────────
      // Removes peaks that are only technically local maxima — they clear the
      // prominence check on their own tiny dip — but sit at the bottom of the
      // envelope between clearly taller real peaks. That covers a single low
      // bump between two pulses and, just as often, a run of several bumps at
      // much the same near-floor level.
      //
      // A peak is dropped only when BOTH conditions hold, and requiring both
      // is the whole point of the rule:
      //   • Near the floor on its own is not enough. The quiet onset and
      //     offset peaks that open and close a real train live down there
      //     too, and dropping them on that basis alone tore trains apart at
      //     their own edges — the hole left behind exceeded Max peak gap, so
      //     one train came out as two or three.
      //   • Below both neighbours on its own is not enough either. A genuine
      //     dip inside a loud train can be deeper than Δ while sitting
      //     nowhere near the floor.
      //
      // Near-floor peaks are grouped into RUNS and each run is judged as a
      // unit against the taller peaks flanking the whole run. Judging peak by
      // peak against immediate neighbours is what let clusters survive: every
      // member of a run has another run member for a neighbour, so no drop is
      // ever measured across that pair and the run shields itself.
      // The rule itself, as pure index arithmetic: [start,end] index pairs of
      // near-floor runs that sit more than `thr` below the peaks flanking the
      // whole run. Shared by the live filter and by the parameter fitter, so
      // the two can never drift apart.
      function pkFalsePeakRuns(peaks, silenceFloor, thr) {
        const nearFloor = (p) => p.amp - silenceFloor <= thr;
        const doomed = [];
        for (let i = 0; i < peaks.length; ) {
          if (!nearFloor(peaks[i])) {
            i++;
            continue;
          }
          let end = i;
          while (end + 1 < peaks.length && nearFloor(peaks[end + 1])) end++;
          // Compare the flankers against the run's TALLEST member: the run has
          // to sit below them as a whole, so one member standing clear of the
          // threshold keeps the entire run.
          let runMax = peaks[i].amp;
          for (let k = i + 1; k <= end; k++)
            if (peaks[k].amp > runMax) runMax = peaks[k].amp;
          const left = peaks[i - 1];
          const right = peaks[end + 1];
          // A missing flanker means the run opens or closes the recording —
          // nothing shows it sits BETWEEN real peaks, so leave it alone.
          if (
            left &&
            right &&
            left.amp - runMax > thr &&
            right.amp - runMax > thr
          )
            doomed.push([i, end]);
          i = end + 1;
        }
        return doomed;
      }

      // Same rule, applied functionally: returns a NEW array with the false
      // peaks gone. Used by the fitter, which must try Δ values without
      // touching pkPeaks or the DOM.
      function pkWithoutFalsePeaks(peaks, silenceFloor, falseDiffPct) {
        if (!(falseDiffPct > 0)) return peaks;
        const doomed = pkFalsePeakRuns(peaks, silenceFloor, falseDiffPct / 100);
        if (!doomed.length) return peaks;
        const drop = new Uint8Array(peaks.length);
        doomed.forEach(([s, e]) => {
          for (let k = s; k <= e; k++) drop[k] = 1;
        });
        return peaks.filter((_, i) => !drop[i]);
      }

      function pkFilterFalsePeaks(silent) {
        if (!pkPeaks.length || !pkEnv) {
          if (!silent) pkLiveUpdate("no peaks to filter");
          return 0;
        }
        const raw = $("pkFalseDiff") ? $("pkFalseDiff").value.trim() : "";
        const falseDiffPct = raw === "" ? null : parseFloat(raw);
        if (falseDiffPct == null || !(falseDiffPct > 0)) {
          if (!silent) pkLiveUpdate("false-peak filter is off");
          return 0;
        }
        const silenceFloor = pkPercentile(pkEnv, 5); // 5th percentile ≈ background level
        const thr = falseDiffPct / 100;
        const maxGapMs = parseFloat($("pkMaxGap")?.value) || 10;
        const doomed = pkFalsePeakRuns(pkPeaks, silenceFloor, thr);
        if (!silent && doomed.length) pkSnapshot("remove false peaks");

        let removed = 0;
        for (let d = doomed.length - 1; d >= 0; d--) {
          const [s, e] = doomed[d];
          const left = pkPeaks[s - 1];
          const right = pkPeaks[e + 1];
          for (let k = s; k <= e; k++) {
            const p = pkPeaks[k];
            pkSelection.delete(p);
            // A boundary that sat on a dropped peak has to outlive it.
            if (left) left.splitAfter = left.splitAfter || p.splitAfter;
          }
          // Closing the hole can leave the survivors further apart than a
          // train tolerates — that IS a train boundary, so mark it.
          if (left && right && (right.time - left.time) * 1000 > maxGapMs)
            left.splitAfter = true;
          pkPeaks.splice(s, e - s + 1);
          removed += e - s + 1;
        }
        if (!silent) {
          pkLiveUpdate(
            removed +
              " false peak(s) removed (floor≈" +
              (silenceFloor * 100).toFixed(2) +
              "%)",
          );
        }
        return removed;
      }

      // ── Import a saved Peaks table ──────────────────────────────────────
      // The exported Peaks sheet carries peak_time, peak_amp and train_id —
      // everything needed to restore a hand-curated result: the peaks, and a
      // train boundary wherever train_id changes. Undo only lasts a session;
      // this survives a restart, a different machine, or a colleague.
      //
      // Boundaries come straight from the file. The grouping algorithm is NOT
      // consulted — re-deriving them would throw away the very hand edits the
      // table was exported to preserve.
      async function pkImportPeaksFile(file) {
        if (!file) return;
        if (!rawSamples) {
          log("Load the matching audio before importing peaks.", "warn");
          return;
        }
        let workbook;
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          workbook = await _readXlsx(buf);
        } catch (err) {
          log("Could not read Excel file: " + err.message, "err");
          return;
        }

        // Find the sheet that looks like a Peaks table, by columns not name,
        // so a renamed sheet still works.
        const key = (row, want) =>
          Object.keys(row).find((k) => k.toLowerCase() === want);
        let rows = null;
        for (const name of Object.keys(workbook)) {
          const r = workbook[name];
          if (r && r.length && key(r[0], "peak_time")) {
            rows = r;
            break;
          }
        }
        if (!rows) {
          log(
            "No Peaks table in that workbook (need a peak_time column).",
            "err",
          );
          return;
        }

        const tK = key(rows[0], "peak_time"),
          aK = key(rows[0], "peak_amp"),
          trK = key(rows[0], "train_id"),
          moK = key(rows[0], "motif_id");

        const parsed = [];
        let skipped = 0,
          outside = 0;
        rows.forEach((r) => {
          const t = parseFloat(r[tK]);
          if (!isFinite(t) || t < 0) {
            skipped++;
            return;
          }
          if (t > duration) {
            outside++;
            return;
          }
          const a = aK != null ? parseFloat(r[aK]) : NaN;
          parsed.push({
            time: t,
            amp: isFinite(a) ? a : null,
            train: trK != null ? String(r[trK] ?? "") : "",
            motif: moK != null ? String(r[moK] ?? "") : "",
          });
        });
        if (!parsed.length) {
          log("No usable rows in that Peaks table.", "err");
          return;
        }
        // A table from a different recording is the likely cause of peaks
        // landing past the end, so say so rather than silently dropping them.
        if (outside) {
          log(
            outside +
              " peak(s) fall past the end of this " +
              duration.toFixed(2) +
              "s recording — is this table from a different file?",
            "warn",
          );
        }
        parsed.sort((x, y) => x.time - y.time);

        // The trace has to exist before anything can be drawn on it, and the
        // user may never have pressed Detect on this file.
        if (!pkEnv) pkRefreshEnvelope();

        const n = pkEnv ? pkEnv.length : 0;
        pkPeaks = parsed.map((p, i) => {
          const idx = Math.max(
            0,
            Math.min(n - 1, Math.round(p.time * sampleRate)),
          );
          const next = parsed[i + 1];
          return {
            idx,
            time: p.time,
            amp: p.amp != null ? p.amp : pkEnv ? pkEnv[idx] : 0,
            // Boundary wherever the train (or motif) label changes.
            splitAfter: !!next && (next.train !== p.train || next.motif !== p.motif),
          };
        });

        pkConfirmed = false;
        $("pkResults").style.display = "none";
        pkClearSelection();
        pkResetUndo();
        pkViewStart = 0;
        pkViewEnd = null;

        const trains = pkBuildTrains();
        $("pkStatus").textContent =
          pkPeaks.length +
          " peaks imported → " +
          trains.length +
          " trains (boundaries from the file)" +
          (skipped ? " · " + skipped + " unreadable row(s) skipped" : "") +
          (outside ? " · " + outside + " outside the recording" : "");
        $("btnPkConfirm").disabled = pkPeaks.length === 0;
        const applyBtn = $("btnPkApplySpectral");
        if (applyBtn) applyBtn.disabled = pkPeaks.length === 0;
        const falseBtn = $("btnPkFilterFalse");
        if (falseBtn) falseBtn.disabled = !pkPeaks.length;
        pkDrawEnvelope();
        log(
          "Imported " + pkPeaks.length + ' peaks from "' + file.name + '".',
          "ok",
        );
      }

      // ── Main detect ─────────────────────────────────────────────────────
      // The envelope pass alone touches every sample in the recording, so on a
      // long file this blocks for seconds. Staged behind the busy overlay, with
      // a yield between stages so each label is actually painted.
      async function pkDetect() {
        if (!rawSamples) {
          log("Load audio first", "warn");
          return;
        }
        return withBusy("Detecting peaks…", (progress) =>
          _pkDetectStages(progress),
        );
      }

      async function _pkDetectStages(progress) {
        pkConfirmed = false;
        $("pkResults").style.display = "none";

        const P = pkReadParams();

        progress("Computing envelope…", 0.05);
        await busyTick();
        pkEnv = pkComputeEnv(P.smoothMs);

        progress("Finding peaks…", 0.4);
        await busyTick();
        const rawPeaks = pkFindPeaks(
          pkEnv,
          P.winMs,
          P.peakThr,
          P.detThr,
          P.linkThr,
          P.maxGapMs,
        );
        pkPeaks = rawPeaks;

        progress("Grouping trains…", 0.8);
        await busyTick();
        pkResetUndo();
        // Strip near-floor "false" peaks before boundaries are ever drawn from
        // this set, so trains/motifs are built on the cleaned list.
        const falseRemoved = pkFilterFalsePeaks(true);
        pkClearSelection();
        // Reset view to full on new detection
        pkViewStart = 0;
        pkViewEnd = null;
        $("pkCanvas").style.cursor =
          pkEditMode === "add" ? "copy" : "crosshair";

        // Run the grouping algorithm ONCE and freeze it. From here on, only manual
        // edits change boundaries — the algorithm is not consulted again.
        pkInitBoundaries();
        const filtered = pkBuildTrains().filter((t) => t.length >= P.minPeaks);
        const rawMotifs = pkGroupMotifs(filtered, P.maxTrainGapMs);

        $("pkStatus").textContent =
          rawPeaks.length +
          " peaks" +
          (falseRemoved ? " (" + falseRemoved + " false removed)" : "") +
          " → " +
          filtered.length +
          " trains → " +
          rawMotifs.length +
          " motifs";
        $("btnPkConfirm").disabled = rawPeaks.length === 0;
        const applyBtn = $("btnPkApplySpectral");
        if (applyBtn) applyBtn.disabled = rawPeaks.length === 0;

        pkDrawEnvelope();
      }

      // pkDrawEnvelope sizes the canvas backing store from its CSS box, so
      // any change to that box leaves the previous bitmap stretched across the
      // new size until something redraws. A long status message reflowing the
      // panels above was enough to do it, and so was resizing the window —
      // the window handler never touched this canvas.
      //
      // Watch the element itself rather than the window, so a layout change
      // from ANY cause is caught: panels wrapping, a tab switch, a dragged
      // splitter. Writing canvas.width/height only touches the backing store,
      // not the CSS box, so redrawing cannot re-trigger the observer — the
      // size comparison guards against it regardless.
      function pkWatchCanvasResize() {
        const c = $("pkCanvas");
        if (!c || typeof ResizeObserver === "undefined") return;
        let lastW = 0,
          lastH = 0;
        new ResizeObserver(() => {
          const w = c.offsetWidth,
            h = c.offsetHeight;
          if (!w || !h || (w === lastW && h === lastH)) return;
          lastW = w;
          lastH = h;
          pkDrawEnvelope();
        }).observe(c);
      }

      // ── Draw envelope canvas ────────────────────────────────────────────
      function pkDrawEnvelope() {
        const canvas = $("pkCanvas");
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.offsetWidth || 800;
        const H = canvas.offsetHeight || 160;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        ctx.fillStyle = "#0d1117";
        ctx.fillRect(0, 0, W, H);
        if (!pkEnv) {
          // No envelope (nothing loaded) — also clear the synced mini
          // spectrogram and nav/overview bar below, which otherwise keep
          // showing whatever was drawn for the last-loaded recording since
          // they're normally only redrawn further down in this function.
          pkDrawSpectrogram(0, 0, 0, 0);
          pkDrawNav();
          return;
        }

        const n = pkEnv.length;
        const dur = n / sampleRate;
        const vStart = pkViewStart;
        const vEnd = pkViewEnd !== null ? pkViewEnd : dur;
        const vDur = Math.max(0.001, vEnd - vStart);

        const padT = 12,
          padB = 20,
          padL = 36,
          padR = 8;
        const pw = W - padL - padR;
        const ph = H - padT - padB;

        // Recompute groupings from current pkPeaks (+ manual overrides)
        const { P, trains, motifs, motifSeqs } = pkComputeGroups();
        const useMotifSeq = P.useMotifSeq;

        // Map time → x within view window
        const tX = (t) => padL + ((t - vStart) / vDur) * pw;
        // Amplitude → y, with vertical magnification (pkAmpScale). Values above the
        // visible ceiling clamp to the top edge so faint peaks can be magnified
        // without tall peaks overflowing the plot.
        const aY = (a) => Math.max(padT, padT + ph - a * pkAmpScale * ph);
        const inView = (t) => t >= vStart - 0.01 && t <= vEnd + 0.01;
        const pad = pkTrainPadSec(); // grow drawn spans to match padded extents

        // Motif sequence spans
        motifSeqs.forEach((seq) => {
          const allP = seq.flat(2);
          const t0 = pkClampT(allP[0].time - pad),
            t1 = pkClampT(allP[allP.length - 1].time + pad);
          if (t1 < vStart || t0 > vEnd) return;
          const x0 = Math.max(padL, tX(t0)),
            x1 = Math.min(padL + pw, tX(t1));
          ctx.fillStyle = "rgba(255,50,50,0.08)";
          ctx.fillRect(x0, padT, x1 - x0, ph);
        });

        // Motif spans
        motifs.forEach((motif) => {
          const allP = motif.flat();
          const t0 = pkClampT(allP[0].time - pad),
            t1 = pkClampT(allP[allP.length - 1].time + pad);
          if (t1 < vStart || t0 > vEnd) return;
          const x0 = Math.max(padL, tX(t0)),
            x1 = Math.min(padL + pw, tX(t1));
          ctx.fillStyle = "rgba(0,114,178,0.13)";
          ctx.fillRect(x0, padT, x1 - x0, ph);
          ctx.fillStyle = "#0072B2";
          ctx.fillRect(x0, padT, x1 - x0, 3);
        });

        // Train spans
        trains.forEach((train) => {
          const t0 = pkClampT(train[0].time - pad),
            t1 = pkClampT(train[train.length - 1].time + pad);
          if (t1 < vStart || t0 > vEnd) return;
          const x0 = Math.max(padL, tX(t0)),
            x1 = Math.min(padL + pw, tX(t1));
          ctx.fillStyle = "rgba(0,158,115,0.15)";
          ctx.fillRect(x0, padT + 4, x1 - x0, ph - 4);
          ctx.fillStyle = "#009E73";
          ctx.fillRect(x0, padT + 4, x1 - x0, 3);
        });

        // Envelope line — only samples in view
        const iStart = Math.max(0, Math.floor(vStart * sampleRate));
        const iEnd = Math.min(n - 1, Math.ceil(vEnd * sampleRate));
        const step = Math.max(1, Math.floor((iEnd - iStart) / (pw * 2)));
        ctx.beginPath();
        ctx.strokeStyle = "#c8d0d8";
        ctx.lineWidth = 1;
        let first = true;
        for (let i = iStart; i <= iEnd; i += step) {
          const t = i / sampleRate;
          const x = tX(t),
            y = aY(pkEnv[i]);
          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Peak markers (auto = orange dot; manual = cyan ring with white core)
        const hasSel = pkSelection.size > 0;
        pkPeaks.forEach((p) => {
          if (!inView(p.time)) return;
          const x = tX(p.time),
            y = aY(p.amp);
          const selected = hasSel && pkSelection.has(p);
          if (selected) {
            // Yellow halo behind selected peaks
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(241,196,15,0.30)";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.strokeStyle = "#f1c40f";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          if (p.manual) {
            ctx.beginPath();
            ctx.arc(x, y, 4.5, 0, Math.PI * 2);
            ctx.strokeStyle = "#56d4dd";
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x, y, 1.6, 0, Math.PI * 2);
            ctx.fillStyle = "#e6edf3";
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = "#D55E00";
            ctx.fill();
          }
        });

        // Rubber-band selection rectangle
        if (pkBand) {
          const bx = Math.min(pkBand.x0, pkBand.x1),
            by = Math.min(pkBand.y0, pkBand.y1);
          const bw = Math.abs(pkBand.x1 - pkBand.x0),
            bh = Math.abs(pkBand.y1 - pkBand.y0);
          ctx.save();
          ctx.fillStyle = "rgba(241,196,15,0.12)";
          ctx.fillRect(bx, by, bw, bh);
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = "#f1c40f";
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, by, bw, bh);
          ctx.restore();
        }

        // Add-mode hover preview: vertical guide + hollow marker snapped to the envelope
        if (
          pkEditMode === "add" &&
          pkHoverTime !== null &&
          inView(pkHoverTime)
        ) {
          const hi = Math.max(
            0,
            Math.min(n - 1, Math.round(pkHoverTime * sampleRate)),
          );
          const x = tX(pkHoverTime),
            y = aY(pkEnv[hi]);
          ctx.save();
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = "rgba(86,212,221,0.55)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, padT);
          ctx.lineTo(x, padT + ph);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(x, y, 4.5, 0, Math.PI * 2);
          ctx.strokeStyle = "#56d4dd";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        }

        // Y axis — ticks span the currently-visible amplitude range [0 .. 1/scale]
        ctx.fillStyle = "#8b949e";
        ctx.font = "9px monospace";
        ctx.textAlign = "right";
        const aMaxVisible = 1 / pkAmpScale; // amplitude at the top edge
        const yRaw = aMaxVisible / 4; // aim for ~4 gridlines
        const yMag = Math.pow(10, Math.floor(Math.log10(yRaw)));
        const yCand = [1, 2, 2.5, 5, 10].map((v) => v * yMag);
        const yStep = yCand.find((v) => v >= yRaw) || yRaw;
        for (let v = 0; v <= aMaxVisible + yStep * 0.01; v += yStep) {
          const y = aY(v);
          if (y < padT - 1) break;
          ctx.fillText(
            v < 1 ? v.toFixed(yStep < 0.1 ? 3 : 2) : v.toFixed(1),
            padL - 4,
            y + 3,
          );
          ctx.strokeStyle = "rgba(255,255,255,0.05)";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(padL, y);
          ctx.lineTo(padL + pw, y);
          ctx.stroke();
        }

        // Time axis — smart step based on view duration
        ctx.textAlign = "center";
        ctx.fillStyle = "#8b949e";
        const nTicks = Math.max(4, Math.floor(pw / 60));
        const rawStep = vDur / nTicks;
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500].map(
          (v) => (v * mag) / 10,
        );
        const tStep = candidates.find((v) => v >= rawStep) || rawStep;
        const useMs = vDur < 1;
        const tFirst = Math.ceil(vStart / tStep) * tStep;
        for (let t = tFirst; t <= vEnd + tStep * 0.01; t += tStep) {
          const x = tX(t);
          if (x < padL || x > padL + pw) continue;
          const lbl = useMs
            ? Math.round((t - vStart) * 1000) + "ms"
            : t - vStart >= 0
              ? (t - vStart).toFixed(tStep < 0.1 ? 3 : tStep < 1 ? 2 : 1) + "s"
              : "";
          ctx.fillText(lbl, x, H - padB + 11);
          ctx.strokeStyle = "rgba(255,255,255,0.05)";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(x, padT);
          ctx.lineTo(x, padT + ph);
          ctx.stroke();
        }

        // View info
        const vi = $("pkViewInfo");
        if (vi)
          vi.textContent =
            vDur < 1
              ? (vDur * 1000).toFixed(1) + " ms shown"
              : vDur.toFixed(3) + " s shown";

        // Store canvas geometry for click/drag handling
        canvas._pkGeo = {
          padL,
          padR,
          padT,
          padB,
          pw,
          ph,
          W,
          H,
          n,
          dpr,
          vStart,
          vEnd,
          vDur,
          ampScale: pkAmpScale,
        };

        // Draw the synced spectrogram and navigation bar
        pkDrawSpectrogram(vStart, vEnd, padL, padR);
        pkDrawNav();
      }

      // ── Small synced spectrogram (shares the envelope's X view + padding) ──
      function pkDrawSpectrogram(vStart, vEnd, padL, padR) {
        const wrap = $("pkSpecWrap");
        const canvas = $("pkSpecCanvas");
        if (!wrap || !canvas) return;
        const show = $("pkShowSpec") ? $("pkShowSpec").checked : true;
        wrap.style.display = show ? "" : "none";
        if (!show) return;
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.offsetWidth || 800;
        const H = canvas.offsetHeight || 80;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        if (!spectrogramData) {
          ctx.fillStyle = "#555";
          ctx.font = "10px monospace";
          ctx.textAlign = "center";
          ctx.fillText("spectrogram unavailable", W / 2, H / 2);
          return;
        }
        const { frames, bins, hop, logData, logMax } = spectrogramData;
        const x0 = padL;
        const x1 = W - padR;
        const pw = Math.max(1, x1 - x0);
        const ph = H;
        // Map the visible time window to spectrogram frame columns.
        const f0 = Math.max(0, (vStart * sampleRate) / hop);
        const f1 = Math.min(frames - 1, (vEnd * sampleRate) / hop);
        const floorDb = logMax - 70; // dynamic range window
        // putImageData always writes raw DEVICE pixels — unlike every other
        // draw call here, it ignores ctx.setTransform(dpr,...). Sizing/
        // placing it in CSS pixels (as this used to) squeezed the whole
        // raster into the top-left 1/dpr of the canvas on any HiDPI
        // display, badly desyncing it from the envelope's time axis above.
        // Build and place it in device pixels instead.
        const iw = Math.max(1, Math.round(pw * dpr));
        const img = ctx.createImageData(iw, Math.max(1, Math.round(ph * dpr)));
        const data = img.data;
        const ih = img.height;
        for (let px = 0; px < iw; px++) {
          const frac = (px + 0.5) / iw;
          const fr = Math.min(
            frames - 1,
            Math.max(0, Math.round(f0 + frac * (f1 - f0))),
          );
          const base = fr * bins;
          for (let py = 0; py < ih; py++) {
            // low freq at bottom: bin index grows upward
            const b = Math.min(bins - 1, Math.floor((1 - py / ih) * bins));
            let v = (logData[base + b] - floorDb) / (logMax - floorDb);
            if (v < 0) v = 0;
            else if (v > 1) v = 1;
            // simple magma-ish ramp
            const r = Math.min(255, v * 255 * 1.4);
            const g = Math.min(255, Math.max(0, (v - 0.3) * 255 * 1.3));
            const bl = Math.min(
              255,
              Math.max(0, (v - 0.6) * 255 * 1.6) + v * 60,
            );
            const idx = (py * iw + px) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = bl;
            data[idx + 3] = 255;
          }
        }
        ctx.putImageData(img, Math.round(padL * dpr), 0);
        // Left axis labels (kHz)
        ctx.fillStyle = "#8b949e";
        ctx.font = "9px monospace";
        ctx.textAlign = "right";
        const nyq = sampleRate / 2;
        [0, 0.5, 1].forEach((fr2) => {
          const y = ph - fr2 * ph;
          ctx.fillText(
            ((nyq * fr2) / 1000).toFixed(1),
            padL - 3,
            Math.min(ph - 2, Math.max(8, y + 3)),
          );
        });
      }

      // ── Navigation/overview bar (full-duration envelope + view window) ──
      function pkDrawNav() {
        const canvas = $("pkNavCanvas");
        const winEl = $("pkNavWindow");
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.offsetWidth || 800;
        const H = canvas.offsetHeight || 34;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#0a0e14";
        ctx.fillRect(0, 0, W, H);
        if (!pkEnv) {
          if (winEl) winEl.style.display = "none";
          return;
        }
        if (winEl) winEl.style.display = "";
        const n = pkEnv.length,
          dur = n / sampleRate;
        // envelope overview (max per pixel column)
        let envMax = 1e-9;
        for (let i = 0; i < n; i++) if (pkEnv[i] > envMax) envMax = pkEnv[i];
        ctx.strokeStyle = "rgba(86,212,221,.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const spp = n / W;
        for (let x = 0; x < W; x++) {
          const s = Math.floor(x * spp),
            e = Math.min(n, s + Math.max(1, Math.ceil(spp)));
          let mx = 0;
          for (let i = s; i < e; i++) if (pkEnv[i] > mx) mx = pkEnv[i];
          const y = H - (mx / envMax) * (H - 2) - 1;
          if (x === 0) ctx.moveTo(x + 0.5, y);
          else ctx.lineTo(x + 0.5, y);
        }
        ctx.stroke();
        // view window indicator
        const vStart = pkViewStart;
        const vEnd = pkViewEnd !== null ? pkViewEnd : dur;
        if (winEl) {
          winEl.style.left = (vStart / dur) * W + "px";
          winEl.style.width = Math.max(3, ((vEnd - vStart) / dur) * W) + "px";
        }
      }

      // ── Zoom/pan helpers ────────────────────────────────────────────────
      function pkZoom(factor) {
        if (!pkEnv) return;
        const dur = pkEnv.length / sampleRate;
        const vEnd = pkViewEnd !== null ? pkViewEnd : dur;
        const vDur = vEnd - pkViewStart;
        const center = pkViewStart + vDur / 2;
        const newDur = Math.max(0.01, Math.min(dur, vDur / factor));
        pkViewStart = Math.max(0, center - newDur / 2);
        pkViewEnd = Math.min(dur, pkViewStart + newDur);
        pkDrawEnvelope();
      }

      function pkZoomReset() {
        pkViewStart = 0;
        pkViewEnd = null;
        pkDrawEnvelope();
      }

      // ── Amplitude (Y) zoom ──────────────────────────────────────────────
      function pkAmpZoom(factor) {
        pkAmpScale = Math.max(1, Math.min(200, pkAmpScale * factor));
        _pkUpdateAmpInfo();
        pkDrawEnvelope();
      }
      function pkAmpReset() {
        pkAmpScale = 1;
        _pkUpdateAmpInfo();
        pkDrawEnvelope();
      }
      function _pkUpdateAmpInfo() {
        const el = $("pkAmpInfo");
        if (el)
          el.textContent =
            (pkAmpScale < 10 ? pkAmpScale.toFixed(1) : Math.round(pkAmpScale)) +
            "×";
      }

      function pkPanBy(deltaSec) {
        if (!pkEnv) return;
        const dur = pkEnv.length / sampleRate;
        const vEnd = pkViewEnd !== null ? pkViewEnd : dur;
        const vDur = vEnd - pkViewStart;
        let ns = pkViewStart + deltaSec;
        ns = Math.max(0, Math.min(dur - vDur, ns));
        pkViewStart = ns;
        pkViewEnd = ns + vDur;
        pkDrawEnvelope();
      }

      // ── Navigation bar interaction (click/drag to move view window) ──────
      (function () {
        const nav = $("pkNavWrap");
        if (!nav) return;
        let dragging = false;
        const navSeek = (clientX) => {
          if (!pkEnv) return;
          const rect = nav.getBoundingClientRect();
          const dur = pkEnv.length / sampleRate;
          const vDur = (pkViewEnd !== null ? pkViewEnd : dur) - pkViewStart;
          let frac = (clientX - rect.left) / rect.width;
          frac = Math.max(0, Math.min(1, frac));
          // center the current window on the click point
          let ns = frac * dur - vDur / 2;
          ns = Math.max(0, Math.min(dur - vDur, ns));
          pkViewStart = ns;
          pkViewEnd = ns + vDur;
          pkDrawEnvelope();
        };
        nav.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          dragging = true;
          navSeek(e.clientX);
          e.preventDefault();
        });
        document.addEventListener("mousemove", (e) => {
          // Same stuck-drag guard as the envelope pan: if the button was
          // released outside the window, this self-heals instead of the
          // nav bar tracking the cursor forever.
          if (dragging && !(e.buttons & 1)) {
            dragging = false;
            return;
          }
          if (dragging) navSeek(e.clientX);
        });
        document.addEventListener("mouseup", () => {
          dragging = false;
        });
      })();

      // Wheel to zoom
      $("pkCanvas").addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          if (!pkEnv) return;
          // Shift+scroll → amplitude (Y) zoom
          if (e.shiftKey) {
            pkAmpZoom(e.deltaY < 0 ? 1.25 : 1 / 1.25);
            return;
          }
          const canvas = $("pkCanvas");
          const geo = canvas._pkGeo;
          if (!geo) return;
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          // Fraction of view where mouse is
          const frac = Math.max(0, Math.min(1, (mx - geo.padL) / geo.pw));
          const dur = pkEnv.length / sampleRate;
          const vEnd = pkViewEnd !== null ? pkViewEnd : dur;
          const vDur = vEnd - pkViewStart;
          const tAtMouse = pkViewStart + frac * vDur;
          const factor = e.deltaY < 0 ? 1.5 : 1 / 1.5;
          const newDur = Math.max(0.005, Math.min(dur, vDur / factor));
          pkViewStart = Math.max(0, tAtMouse - frac * newDur);
          pkViewEnd = Math.min(dur, pkViewStart + newDur);
          pkDrawEnvelope();
        },
        { passive: false },
      );

      // ── Geometry / hit-test helpers ─────────────────────────────────────
      // Map a clientX to a time within the current view; null if outside plot area.
      function pkClientXToTime(clientX) {
        const canvas = $("pkCanvas");
        const geo = canvas._pkGeo;
        if (!geo) return null;
        const rect = canvas.getBoundingClientRect();
        const mx = clientX - rect.left;
        const frac = (mx - geo.padL) / geo.pw;
        if (frac < 0 || frac > 1) return null;
        return geo.vStart + frac * geo.vDur;
      }
      // Index of the nearest peak to a pointer event (within HIT px), or -1.
      function pkNearestPeak(clientX, clientY, HIT = 8) {
        const canvas = $("pkCanvas");
        const geo = canvas._pkGeo;
        if (!geo) return -1;
        const rect = canvas.getBoundingClientRect();
        const mx = clientX - rect.left,
          my = clientY - rect.top;
        let closest = -1,
          bestD = Infinity;
        pkPeaks.forEach((p, i) => {
          if (p.time < geo.vStart || p.time > geo.vEnd) return;
          const px = geo.padL + ((p.time - geo.vStart) / geo.vDur) * geo.pw;
          const py = Math.max(
            geo.padT,
            geo.padT + geo.ph - p.amp * (geo.ampScale || 1) * geo.ph,
          );
          const d = Math.hypot(mx - px, my - py);
          if (d < HIT && d < bestD) {
            bestD = d;
            closest = i;
          }
        });
        return closest;
      }

      // ── Add a peak, snapped to the nearest envelope local-max around `time` ──
      function pkAddPeakAt(time) {
        if (!pkEnv) return;
        const n = pkEnv.length;
        const center = Math.max(
          0,
          Math.min(n - 1, Math.round(time * sampleRate)),
        );

        // Snap to the LOCAL maximum closest to the click. We climb uphill from the
        // click toward whichever side rises, which lands on the tip of the feature
        // under the cursor — even a faint, broad plateau — instead of grabbing the
        // tallest sample in a fixed window (which could jump onto a taller neighbour).
        const searchR = Math.max(2, Math.round((sampleRate * 1.0) / 1000)); // ±1 ms search
        let best = center;
        // Hill-climb from the click position.
        let moved = true,
          guard = 0;
        while (moved && guard++ < searchR * 2) {
          moved = false;
          if (best > 0 && pkEnv[best - 1] > pkEnv[best]) {
            best--;
            moved = true;
          } else if (best < n - 1 && pkEnv[best + 1] > pkEnv[best]) {
            best++;
            moved = true;
          }
        }
        // On a flat plateau, centre the marker on the middle of the flat top.
        if (best > 0 && best < n - 1) {
          let l = best,
            r = best;
          while (l > 0 && pkEnv[l - 1] === pkEnv[best]) l--;
          while (r < n - 1 && pkEnv[r + 1] === pkEnv[best]) r++;
          best = Math.round((l + r) / 2);
        }

        // Reject only if there's ALREADY a peak essentially at this snapped tip.
        // Use a tight tolerance so faint peaks next to tall ones still commit.
        const minSep = Math.max(1, Math.round((sampleRate * 0.15) / 1000)); // 0.15 ms
        const dup = pkPeaks.find((p) => Math.abs(p.idx - best) < minSep);
        if (dup) {
          pkLiveUpdate(
            "a peak already exists here (@ " +
              (dup.time * 1000).toFixed(2) +
              " ms)",
          );
          return;
        }

        const np = {
          idx: best,
          time: best / sampleRate,
          amp: pkEnv[best],
          manual: true,
          splitAfter: false,
        };
        pkSnapshot("add peak");
        // Insert keeping pkPeaks sorted by time
        let lo = 0;
        while (lo < pkPeaks.length && pkPeaks[lo].time < np.time) lo++;
        const leftPeer = lo > 0 ? pkPeaks[lo - 1] : null;
        const rightPeer = lo < pkPeaks.length ? pkPeaks[lo] : null;
        // Merge into whichever neighbouring train(s) fall within the gap
        // threshold — independently on each side. If both sides are within
        // threshold, the new peak bridges the two trains into one; if only
        // one side is, it joins just that train; if neither is, it stands
        // alone as its own single-peak train.
        const maxGapMs = parseFloat($("pkMaxGap")?.value) || 10;
        if (leftPeer) {
          const leftGapMs = (np.time - leftPeer.time) * 1000;
          leftPeer.splitAfter = leftGapMs > maxGapMs;
        }
        if (rightPeer) {
          const rightGapMs = (rightPeer.time - np.time) * 1000;
          np.splitAfter = rightGapMs > maxGapMs;
        }
        pkPeaks.splice(lo, 0, np);
        // Selecting the new peak (and only it) makes it obvious what was
        // just added and where it landed.
        pkSelection.clear();
        pkSelection.add(np);
        pkLiveUpdate(
          "peak added @ " +
            (np.time * 1000).toFixed(2) +
            " ms (amp " +
            np.amp.toFixed(3) +
            ")",
        );
      }

      // ── Boundary edits — all purely local toggles of splitAfter flags ─────
      // The gap to the LEFT of peak i is owned by pkPeaks[i-1].splitAfter.
      // The gap to the RIGHT of peak i is owned by pkPeaks[i].splitAfter.

      // Merge: clear one boundary, touch nothing else.
      // ── Undo for peak + boundary edits ──────────────────────────────────
      // Snapshots the whole peak list before each edit. Snapshots are stored as
      // typed arrays rather than cloned objects: a long recording carries tens
      // of thousands of peaks, and forty snapshots of forty thousand small
      // objects would be hundreds of megabytes, where this is a few hundred
      // kilobytes each.
      //
      // The selection is captured as INDICES and restored with the peaks, so
      // undo puts back what was highlighted before the edit, not an empty
      // selection or a set of dead object references.
      const PK_UNDO_LIMIT = 40;
      let pkUndoStack = [];

      function pkSnapshot(label) {
        const n = pkPeaks.length;
        const snap = {
          label,
          n,
          idx: new Int32Array(n),
          time: new Float64Array(n),
          amp: new Float32Array(n),
          flags: new Uint8Array(n),
          sel: [],
        };
        for (let i = 0; i < n; i++) {
          const p = pkPeaks[i];
          snap.idx[i] = p.idx == null ? -1 : p.idx;
          snap.time[i] = p.time;
          snap.amp[i] = p.amp;
          snap.flags[i] = (p.splitAfter ? 1 : 0) | (p.manual ? 2 : 0);
          if (pkSelection.has(p)) snap.sel.push(i);
        }
        pkUndoStack.push(snap);
        if (pkUndoStack.length > PK_UNDO_LIMIT) pkUndoStack.shift();
        pkUpdateUndoButton();
      }

      // Wipe the history when the peak list is replaced wholesale — after a
      // fresh detection or a reset, the old snapshots describe peaks that no
      // longer relate to what is on screen.
      function pkResetUndo() {
        pkUndoStack = [];
        pkUpdateUndoButton();
      }

      function pkUpdateUndoButton() {
        const b = $("btnPkUndo");
        if (!b) return;
        b.disabled = !pkUndoStack.length;
        b.title = pkUndoStack.length
          ? "Undo: " +
            pkUndoStack[pkUndoStack.length - 1].label +
            "  (Ctrl+Z)  ·  " +
            pkUndoStack.length +
            " step(s) available"
          : "Nothing to undo (Ctrl+Z)";
      }

      function pkUndo() {
        const snap = pkUndoStack.pop();
        if (!snap) {
          pkLiveUpdate("nothing to undo");
          return;
        }
        pkPeaks = new Array(snap.n);
        for (let i = 0; i < snap.n; i++) {
          const p = {
            idx: snap.idx[i] < 0 ? null : snap.idx[i],
            time: snap.time[i],
            amp: snap.amp[i],
            splitAfter: !!(snap.flags[i] & 1),
          };
          if (snap.flags[i] & 2) p.manual = true;
          pkPeaks[i] = p;
        }
        pkSelection.clear();
        snap.sel.forEach((i) => {
          if (pkPeaks[i]) pkSelection.add(pkPeaks[i]);
        });
        pkUpdateUndoButton();
        pkLiveUpdate("undo: " + snap.label);
      }

      function pkMerge(i, dir) {
        const p = pkPeaks[i];
        if (!p) return;
        if (dir === "right") {
          if (i + 1 >= pkPeaks.length) {
            pkLiveUpdate("no peak to the right");
            return;
          }
          pkSnapshot("merge right");
          p.splitAfter = false;
          pkLiveUpdate("merged right");
        } else {
          if (i - 1 < 0) {
            pkLiveUpdate("no peak to the left");
            return;
          }
          pkSnapshot("merge left");
          pkPeaks[i - 1].splitAfter = false;
          pkLiveUpdate("merged left");
        }
      }

      // Split: set one boundary, touch nothing else.
      function pkSplitLeft(i) {
        if (i - 1 < 0) {
          pkLiveUpdate("no peak to the left");
          return;
        }
        pkSnapshot("split left");
        pkPeaks[i - 1].splitAfter = true;
        pkLiveUpdate("split left");
      }
      function pkSplitRight(i) {
        if (i + 1 >= pkPeaks.length) {
          pkLiveUpdate("no peak to the right");
          return;
        }
        pkSnapshot("split right");
        pkPeaks[i].splitAfter = true;
        pkLiveUpdate("split right");
      }

      // Assign: move this single peak into the neighbouring train. Only the two
      // gaps immediately around this peak change — nothing downstream is touched.
      // Left  = join the left gap, cut the right gap  → peak ends the left train.
      // Right = cut the left gap, join the right gap  → peak starts the right train.
      function pkAssign(i, dir) {
        const p = pkPeaks[i];
        if (!p) return;
        if (dir === "left") {
          if (i - 1 < 0) {
            pkLiveUpdate("no train to the left");
            return;
          }
          pkSnapshot("assign left");
          pkPeaks[i - 1].splitAfter = false; // join with left
          if (i + 1 < pkPeaks.length) pkPeaks[i].splitAfter = true; // end the train here
          pkLiveUpdate("assigned to left train");
        } else {
          if (i + 1 >= pkPeaks.length) {
            pkLiveUpdate("no train to the right");
            return;
          }
          pkSnapshot("assign right");
          if (i - 1 >= 0) pkPeaks[i - 1].splitAfter = true; // cut from left
          pkPeaks[i].splitAfter = false; // join with right
          pkLiveUpdate("assigned to right train");
        }
      }

      // Remove a peak. The two gaps around it collapse into one; a boundary is
      // preserved if either side had one, so trains never accidentally merge.
      // The collapsed gap can also end up wider than the train-grouping
      // threshold on its own — even if neither original half-gap was flagged
      // — so re-check against it and split there too if needed.
      function pkRemovePeak(i) {
        const p = pkPeaks[i];
        if (!p) return;
        pkSnapshot("remove peak");
        if (pkSelection.has(p)) pkSelection.delete(p);
        const prev = pkPeaks[i - 1];
        const next = pkPeaks[i + 1];
        if (prev) {
          prev.splitAfter = prev.splitAfter || p.splitAfter;
          const maxGapMs = parseFloat($("pkMaxGap")?.value) || 10;
          if (next && (next.time - prev.time) * 1000 > maxGapMs) {
            prev.splitAfter = true;
          }
        }
        pkPeaks.splice(i, 1);
        pkLiveUpdate("peak removed");
      }

      // Re-run the detection algorithm's segmentation and re-freeze it, discarding
      // manual boundary edits (added/removed peaks are kept). Wired to the
      // "Reset boundaries" button.
      function pkClearOverrides() {
        if (!pkPeaks.length) {
          pkLiveUpdate("nothing to reset");
          return;
        }
        pkSnapshot("reset boundaries");
        pkInitBoundaries();
        pkLiveUpdate("boundaries reset to detected");
      }

      // ── Multi-selection + bulk boundary edits ───────────────────────────
      // Selection stores peak object references (stable across boundary edits).
      function pkClearSelection() {
        pkSelection.clear();
        pkUpdateSelectionButtons();
      }
      function pkAssignSelection(dir) {
        const idxs = pkSelectionIndices();
        if (!idxs.length) return;
        if (idxs.length === 1) {
          pkAssign(idxs[0], dir);
        } else {
          pkBulkAssign(dir);
        }
      }
      function pkMergeSelection(dir) {
        const idxs = pkSelectionIndices();
        if (idxs.length !== 1) return;
        pkMerge(idxs[0], dir);
      }
      function pkSplitSelection(dir) {
        const idxs = pkSelectionIndices();
        if (idxs.length !== 1) return;
        if (dir === "left") pkSplitLeft(idxs[0]);
        else pkSplitRight(idxs[0]);
      }
      function pkRemoveSelected() {
        const idxs = pkSelectionIndices();
        if (!idxs.length) return;
        if (idxs.length === 1) pkRemovePeak(idxs[0]);
        else pkBulkRemove();
      }
      function pkClearSelectionAction() {
        pkClearSelection();
        pkLiveUpdate("selection cleared");
      }
      function pkUpdateSelectionButtons() {
        const idxs = pkSelectionIndices();
        const count = idxs.length;
        const single = count === 1;
        const hasSel = count > 0;
        const peakIdx = single ? idxs[0] : -1;
        const hasPrev = single && peakIdx > 0;
        const hasNext = single && peakIdx < pkPeaks.length - 1;
        const leftSplit = hasPrev ? pkPeaks[peakIdx - 1].splitAfter : null;
        const rightSplit = single ? pkPeaks[peakIdx].splitAfter : null;
        const assignLeft =
          hasSel && (single ? hasPrev : count > 1 && idxs[0] > 0);
        const assignRight =
          hasSel &&
          (single
            ? hasNext
            : count > 1 && idxs[count - 1] < pkPeaks.length - 1);
        const mergeLeft = single && hasPrev && leftSplit === true;
        const mergeRight = single && hasNext && rightSplit === true;
        const splitLeft = single && hasPrev && leftSplit === false;
        const splitRight = single && hasNext && rightSplit === false;
        const isolate = count > 1;
        const join = count > 1;
        const remove = hasSel;
        const clear = hasSel;

        const setState = (id, state) => {
          const el = $(id);
          if (el) el.disabled = !state;
        };
        setState("btnPkAssignLeft", assignLeft);
        setState("btnPkAssignRight", assignRight);
        setState("btnPkMergeLeft", mergeLeft);
        setState("btnPkMergeRight", mergeRight);
        setState("btnPkSplitLeft", splitLeft);
        setState("btnPkSplitRight", splitRight);
        setState("btnPkBulkIsolate", isolate);
        setState("btnPkBulkJoin", join);
        setState("btnPkRemoveSel", remove);
        setState("btnPkClearSelection", clear);
      }
      // Sorted array-indices of the currently-selected peaks (drops any stale refs).
      function pkSelectionIndices() {
        const idxs = [];
        pkPeaks.forEach((p, i) => {
          if (pkSelection.has(p)) idxs.push(i);
        });
        return idxs;
      }
      // Bulk ops act on the contiguous span [lo..hi] from the first to the last
      // selected peak — natural for a box selection. Every change is local to that
      // span and the two gaps bordering it; nothing else is touched.
      function pkBulkAssign(dir) {
        const idxs = pkSelectionIndices();
        if (idxs.length < 2) return;
        const lo = idxs[0],
          hi = idxs[idxs.length - 1];
        pkSnapshot("assign " + idxs.length + " peaks");
        for (let i = lo; i < hi; i++) pkPeaks[i].splitAfter = false; // join the block internally
        if (dir === "right") {
          if (hi < pkPeaks.length - 1) pkPeaks[hi].splitAfter = false; // merge into right train
          if (lo > 0) pkPeaks[lo - 1].splitAfter = true; // detach from the left
          pkLiveUpdate(idxs.length + " peaks → right train");
        } else {
          if (lo > 0) pkPeaks[lo - 1].splitAfter = false; // merge into left train
          if (hi < pkPeaks.length - 1) pkPeaks[hi].splitAfter = true; // detach from the right
          pkLiveUpdate(idxs.length + " peaks → left train");
        }
      }
      function pkBulkIsolate() {
        // make the selection its own train
        const idxs = pkSelectionIndices();
        if (idxs.length < 2) return;
        const lo = idxs[0],
          hi = idxs[idxs.length - 1];
        pkSnapshot("isolate " + idxs.length + " peaks");
        for (let i = lo; i < hi; i++) pkPeaks[i].splitAfter = false;
        if (lo > 0) pkPeaks[lo - 1].splitAfter = true;
        if (hi < pkPeaks.length - 1) pkPeaks[hi].splitAfter = true;
        pkLiveUpdate("selection isolated as one train");
      }
      function pkBulkJoin() {
        // join gaps within the selection, leave both ends alone
        const idxs = pkSelectionIndices();
        if (idxs.length < 2) return;
        const lo = idxs[0],
          hi = idxs[idxs.length - 1];
        pkSnapshot("join selection");
        for (let i = lo; i < hi; i++) pkPeaks[i].splitAfter = false;
        pkLiveUpdate("joined within selection");
      }
      function pkBulkRemove() {
        const idxs = pkSelectionIndices();
        if (!idxs.length) return;
        pkSnapshot("remove " + idxs.length + " peak(s)");
        const maxGapMs = parseFloat($("pkMaxGap")?.value) || 10;
        // Remove from the end so earlier indices stay valid; preserve boundaries,
        // and split if the collapsed gap now exceeds the train threshold even
        // when neither original half-gap was flagged (same fix as pkRemovePeak).
        for (let k = idxs.length - 1; k >= 0; k--) {
          const i = idxs[k];
          const prev = pkPeaks[i - 1];
          const next = pkPeaks[i + 1];
          if (prev) {
            prev.splitAfter = prev.splitAfter || pkPeaks[i].splitAfter;
            if (next && (next.time - prev.time) * 1000 > maxGapMs) {
              prev.splitAfter = true;
            }
          }
          pkPeaks.splice(i, 1);
        }
        const n = idxs.length;
        pkClearSelection();
        pkLiveUpdate(n + " peaks removed");
      }

      // ── Edit-mode toggle ────────────────────────────────────────────────
      function pkSetMode(mode) {
        pkEditMode = mode;
        $("btnPkModeSelect").className = mode === "select" ? "pri" : "";
        $("btnPkModeAdd").className = mode === "add" ? "pri" : "";
        $("pkEditHint").textContent =
          mode === "add"
            ? "Add mode · click on the plot to add a peak (snaps to the envelope) · drag still pans"
            : "Select mode · click selects a peak · shift-drag to box-select (or shift-click) · use the panel for actions · Del to delete selection";
        const canvas = $("pkCanvas");
        if (pkEnv) canvas.style.cursor = mode === "add" ? "copy" : "crosshair";
        pkHoverTime = null;
        pkDrawEnvelope();
      }

      // ── Mouse down: shift = rubber-band select; otherwise pan ────────────
      $("pkCanvas").addEventListener("mousedown", (e) => {
        if (!pkEnv || e.button !== 0) return;
        const canvas = $("pkCanvas");
        const rect = canvas.getBoundingClientRect();
        if (e.shiftKey && pkEditMode === "select") {
          // Begin a rubber-band selection in canvas pixel coords.
          pkBand = {
            x0: e.clientX - rect.left,
            y0: e.clientY - rect.top,
            x1: e.clientX - rect.left,
            y1: e.clientY - rect.top,
          };
          pkDidBand = false;
          canvas.style.cursor = "crosshair";
          return;
        }
        pkIsDragging = true;
        pkDidDrag = false;
        pkDragStartX = e.clientX;
        pkDragStartViewStart = pkViewStart;
        canvas.style.cursor = "grabbing";
      });

      let pkHoverRaf = null;
      document.addEventListener("mousemove", (e) => {
        const canvas = $("pkCanvas");
        const geo = canvas._pkGeo;
        // If the mouse button was released outside the window/webview, no
        // "mouseup" ever reaches us to clear the drag/band state, and the
        // pan or rubber-band would otherwise keep tracking the cursor
        // forever. e.buttons reflects what's ACTUALLY held right now, so
        // use it to self-heal instead of relying solely on mouseup.
        if ((pkIsDragging || pkBand) && !(e.buttons & 1)) {
          pkIsDragging = false;
          pkBand = null;
          canvas.style.cursor = pkEditMode === "add" ? "copy" : "crosshair";
        }
        const rect = canvas.getBoundingClientRect();
        pkLastMouseTime =
          geo &&
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
            ? pkClientXToTime(e.clientX)
            : null;
        // Rubber-band selection in progress
        if (pkBand && geo) {
          const rect = canvas.getBoundingClientRect();
          pkBand.x1 = e.clientX - rect.left;
          pkBand.y1 = e.clientY - rect.top;
          if (
            Math.abs(pkBand.x1 - pkBand.x0) > 3 ||
            Math.abs(pkBand.y1 - pkBand.y0) > 3
          )
            pkDidBand = true;
          pkDrawEnvelope();
          return;
        }
        if (pkIsDragging && pkEnv && geo) {
          const dx = e.clientX - pkDragStartX;
          if (Math.abs(dx) > 3) pkDidDrag = true;
          const secPerPx = geo.vDur / geo.pw;
          const delta = -dx * secPerPx;
          const dur = pkEnv.length / sampleRate;
          const vDur = (pkViewEnd !== null ? pkViewEnd : dur) - pkViewStart;
          let ns = pkDragStartViewStart + delta;
          ns = Math.max(0, Math.min(dur - vDur, ns));
          pkViewStart = ns;
          pkViewEnd = ns + vDur;
          pkDrawEnvelope();
          return;
        }
        // Add-mode hover preview (throttled to one redraw per frame)
        if (pkEditMode === "add" && pkEnv && geo && !pkIsDragging) {
          const t = pkClientXToTime(e.clientX);
          if (t !== pkHoverTime) {
            pkHoverTime = t;
            if (!pkHoverRaf)
              pkHoverRaf = requestAnimationFrame(() => {
                pkHoverRaf = null;
                pkDrawEnvelope();
              });
          }
        }
      });

      $("pkCanvas").addEventListener("mouseleave", () => {
        pkLastMouseTime = null;
        if (pkEditMode === "add" && pkHoverTime !== null) {
          pkHoverTime = null;
          pkDrawEnvelope();
        }
      });

      document.addEventListener("mouseup", () => {
        const canvas = $("pkCanvas");
        // Finish a rubber-band selection
        if (pkBand) {
          const geo = canvas._pkGeo;
          if (pkDidBand && geo) {
            const xMin = Math.min(pkBand.x0, pkBand.x1),
              xMax = Math.max(pkBand.x0, pkBand.x1);
            const yMin = Math.min(pkBand.y0, pkBand.y1),
              yMax = Math.max(pkBand.y0, pkBand.y1);
            pkPeaks.forEach((p) => {
              if (p.time < geo.vStart || p.time > geo.vEnd) return;
              const px = geo.padL + ((p.time - geo.vStart) / geo.vDur) * geo.pw;
              const py = Math.max(
                geo.padT,
                geo.padT + geo.ph - p.amp * (geo.ampScale || 1) * geo.ph,
              );
              if (px >= xMin && px <= xMax && py >= yMin && py <= yMax)
                pkSelection.add(p);
            });
          }
          pkBand = null;
          canvas.style.cursor = pkEditMode === "add" ? "copy" : "crosshair";
          pkLiveUpdate(
            pkSelection.size
              ? pkSelection.size + " selected (use panel for actions)"
              : null,
          );
          return;
        }
        if (pkIsDragging) {
          pkIsDragging = false;
          canvas.style.cursor = pkEditMode === "add" ? "copy" : "crosshair";
        }
      });

      // ── Click: add / shift-toggle select / remove ───────────────────────
      $("pkCanvas").addEventListener("click", (e) => {
        if (!pkEnv) return;
        if (pkDidBand) {
          pkDidBand = false;
          return;
        } // it was a band-select, not a click
        if (pkDidDrag) {
          pkDidDrag = false;
          return;
        } // it was a pan, not a click
        if (pkEditMode === "add") {
          const t = pkClientXToTime(e.clientX);
          if (t !== null) pkAddPeakAt(t);
          return;
        }
        if (!pkPeaks.length) return;
        const idx = pkNearestPeak(e.clientX, e.clientY, 8);
        // Shift-click toggles a single peak in/out of the selection.
        if (e.shiftKey) {
          if (idx >= 0) {
            const p = pkPeaks[idx];
            if (pkSelection.has(p)) pkSelection.delete(p);
            else pkSelection.add(p);
            pkLiveUpdate(
              pkSelection.size
                ? pkSelection.size + " selected"
                : "selection cleared",
            );
          }
          return;
        }
        if (idx >= 0) {
          const p = pkPeaks[idx];
          pkSelection.clear();
          pkSelection.add(p);
          pkLiveUpdate("peak selected");
          return;
        }
        if (pkSelection.size) {
          pkClearSelection();
          pkLiveUpdate("selection cleared");
        }
      });

      // ── Keyboard shortcuts for Temporal Analysis ─────────────────────────
      function pkHideMenu() {}
      document.addEventListener("keydown", (e) => {
        const active = document.activeElement;
        const isTyping =
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.tagName === "SELECT" ||
            active.isContentEditable);
        // Ctrl+Z / Cmd+Z — undo the last peak or boundary edit. Guarded on
        // pkEnv so it only fires once Temporal Analysis has something to edit,
        // and skipped while a text field has focus so it does not steal undo
        // from whatever the user is typing in.
        if (
          (e.key === "z" || e.key === "Z") &&
          (e.ctrlKey || e.metaKey) &&
          !e.shiftKey &&
          !e.altKey &&
          !isTyping &&
          !isAnalyzerTabActive() &&
          pkEnv
        ) {
          pkUndo();
          e.preventDefault();
          return;
        }
        if ((e.key === "+" || e.key === "Add") && !isTyping && pkEnv) {
          if (pkLastMouseTime !== null) {
            pkAddPeakAt(pkLastMouseTime);
            e.preventDefault();
          }
          return;
        }
        if (
          (e.key === "Delete" ||
            e.key === "Del" ||
            e.code === "NumpadSubtract" ||
            e.key === "Subtract") &&
          !isTyping &&
          pkSelection.size
        ) {
          pkBulkRemove();
          e.preventDefault();
          return;
        }
        // ── Boundary-edit shortcuts (Temporal Analysis) ──────────────────
        // Shift+←/→ = Split left/right · ←/→ = Assign left/right ·
        // Ctrl+←/→ = Merge left/right · Ctrl+M = Join selection.
        if (!isTyping && pkEnv && pkSelection.size) {
          const isLeft = e.key === "ArrowLeft";
          const isRight = e.key === "ArrowRight";
          if ((isLeft || isRight) && e.shiftKey && !e.ctrlKey && !e.altKey) {
            pkSplitSelection(isLeft ? "left" : "right");
            e.preventDefault();
            return;
          }
          if ((isLeft || isRight) && e.ctrlKey && !e.shiftKey && !e.altKey) {
            pkMergeSelection(isLeft ? "left" : "right");
            e.preventDefault();
            return;
          }
          if ((isLeft || isRight) && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            pkAssignSelection(isLeft ? "left" : "right");
            e.preventDefault();
            return;
          }
          if (
            e.key.toLowerCase() === "m" &&
            e.ctrlKey &&
            !e.shiftKey &&
            !e.altKey
          ) {
            pkBulkJoin();
            e.preventDefault();
            return;
          }
        }
        // Alt+←/→ = pan the view left/right — unlike the boundary-edit
        // arrow combos above, this doesn't need a selection.
        if (!isTyping && pkEnv) {
          const isLeft = e.key === "ArrowLeft";
          const isRight = e.key === "ArrowRight";
          if ((isLeft || isRight) && e.altKey && !e.ctrlKey && !e.shiftKey) {
            pkPanView(isLeft ? -1 : 1);
            e.preventDefault();
          }
        }
      });

      // Shifts the current view window by a fraction of its own duration,
      // clamped to the signal's bounds — same math as dragging the envelope.
      function pkPanView(dir) {
        const dur = pkEnv.length / sampleRate;
        const vEnd = pkViewEnd !== null ? pkViewEnd : dur;
        const vDur = vEnd - pkViewStart;
        const step = vDur * 0.2 * dir;
        let ns = Math.max(0, Math.min(dur - vDur, pkViewStart + step));
        pkViewStart = ns;
        pkViewEnd = ns + vDur;
        pkDrawEnvelope();
      }

      // ── Confirm & compute metrics ───────────────────────────────────────
      // A peak's amplitude should always be set at creation, but this is a
      // safety net: fall back to re-reading it straight from the envelope
      // at the peak's sample index if it's ever missing/invalid, so a
      // stale/malformed peak object can never blank out an export instead
      // of just reporting a real number.
      // Name of the audio these numbers came from. Every exported row carries
      // it so a table can always be traced back to its recording — filenames
      // get renamed and workbooks get merged, and specimen_id is typed by hand
      // and often left blank.
      function pkSourceFile() {
        return currentAudioFileName || "";
      }

      function _pkAmpOf(p) {
        if (typeof p.amp === "number" && isFinite(p.amp)) return p.amp;
        return pkEnv && p.idx != null ? pkEnv[p.idx] : null;
      }

      // Spectral columns for train- and motif-level rows. These spans are long
      // enough for the whole measure set, unlike a single pulse.
      function pkSpecCols(m) {
        if (!m)
          return {
            peak_freq_khz: null,
            bw_20db_khz: null,
            bw_10db_khz: null,
            spec_centroid_khz: null,
            spec_spread_khz: null,
            spec_skew: null,
            spec_kurt: null,
            spec_entropy: null,
            spec_flatness: null,
            q_20db: null,
            spec_signal_ms: null,
            spec_res_hz: null,
            spec_bin_hz: null,
          };
        return {
          peak_freq_khz: m.peak_freq_khz,
          bw_20db_khz: m.bw_20db_khz,
          bw_10db_khz: m.bw_10db_khz,
          spec_centroid_khz: m.spec_centroid_khz,
          spec_spread_khz: m.spec_spread_khz,
          spec_skew: m.spec_skew,
          spec_kurt: m.spec_kurt,
          spec_entropy: m.spec_entropy,
          spec_flatness: m.spec_flatness,
          q_20db: m.q_20db,
          spec_signal_ms: m.spec_signal_ms,
          spec_res_hz: m.spec_res_hz,
          spec_bin_hz: m.spec_bin_hz,
        };
      }

      // Motif rows carry the spectrum TWICE, because the two answers differ
      // and both are wanted.
      //
      //   spec_*        — one transform over the whole motif span, at the
      //                   motif resolution. The long window resolves fine
      //                   structure the shorter train window cannot, but its
      //                   frames also cross the silence between trains, so on
      //                   a low duty cycle some frames are pure background and
      //                   entropy and flatness read high.
      //   spec_*_tmean  — the mean of the motif's train rows. Every number is
      //                   anchored to actual signal, at the train resolution.
      //
      // Disagreement between them is informative: it means the motif is not
      // spectrally uniform across its trains, or the background is loud.
      const PK_SPEC_MEAN_KEYS = [
        "peak_freq_khz",
        "bw_20db_khz",
        "bw_10db_khz",
        "spec_centroid_khz",
        "spec_spread_khz",
        "spec_skew",
        "spec_kurt",
        "spec_entropy",
        "spec_flatness",
        "q_20db",
        "spec_signal_ms",
        "spec_res_hz",
        "spec_bin_hz",
        "freq_spread",
      ];

      function pkMotifSpecMeans(motifId) {
        const rows = pkTrainData.filter((r) => r.motif_id === motifId);
        const out = {};
        PK_SPEC_MEAN_KEYS.forEach((k) => {
          const v = rows
            .map((r) => r[k])
            .filter((x) => typeof x === "number" && isFinite(x));
          const val = v.length
            ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1e4) / 1e4
            : null;
          // freq_spread has no direct counterpart — it is the scatter of peak
          // carriers within a train, which a single transform cannot report —
          // so it keeps its plain name. Everything else is suffixed to sit
          // beside the motif's own measurement without colliding.
          out[k === "freq_spread" ? k : k + "_tmean"] = val;
        });
        return out;
      }

      // ── Peak-level spectra ──────────────────────────────────────────────
      // Two separate things, and conflating them was the bug.
      //
      // The TRANSFORM LENGTH comes from "Peak spec win (ms)" and nothing else.
      // It fixes the bin grid, so every peak — in this recording and in every
      // other recording measured with the same preset — is described on the
      // same frequency axis. Deriving it from the data (the tightest pair of
      // peaks, say) makes columns comparable inside one file and meaningless
      // between files, because a dense recording and a sparse one would end up
      // on different grids.
      //
      // The signal is capped at half the distance to each neighbouring peak,
      // so adjacent pulses never enter the same frame.
      //
      // That cap is also a hard limit on resolution, and it is a physical one:
      // resolution is 1/T, so a peak with only 0.7 ms of clear space around it
      // cannot be resolved finer than ~1400 Hz no matter what is requested.
      // Zero-padding interpolates the curve, it does not add information. So
      // the requested resolution is a TARGET, spec_res_hz reports what each
      // peak actually achieved, and rows only sit on a common frequency axis
      // if the target is coarse enough for every peak to reach it.
      function pkPeakHalfWindow(peaks, i, want) {
        const p = peaks[i];
        let half = want;
        if (i > 0) half = Math.min(half, (p.time - peaks[i - 1].time) / 2);
        if (i + 1 < peaks.length)
          half = Math.min(half, (peaks[i + 1].time - p.time) / 2);
        // Floor of a few samples, only so a transform is possible at all. It
        // used to be half of SPEC_MIN_FFT, which at a coarse target (1500 Hz
        // wants 0.67 ms) is LONGER than the requested window — the floor would
        // then have widened the frame past the neighbouring pulse, defeating
        // the cap above. Padding now supplies the transform length, so this
        // can stay small and let the cap decide.
        const minHalf = 4 / sampleRate;
        return Math.max(half, minHalf);
      }

      // Target frequency resolution per level, in Hz. Set in Hz rather than
      // milliseconds because that is what has to be held constant to compare
      // recordings, and it stays the same number whatever the sample rate.
      function pkPeakSpecRes() {
        return Math.max(1, parseFloat($("pkSpecResPeak")?.value) || 1500);
      }
      function pkTrainSpecRes() {
        return Math.max(1, parseFloat($("pkSpecResTrain")?.value) || 50);
      }
      function pkMotifSpecRes() {
        return Math.max(1, parseFloat($("pkSpecResMotif")?.value) || 10);
      }

      function pkPeakSpectrum(peaks, i, resHz) {
        // Requested resolution implies a duration; the neighbours may allow
        // less, and then the row simply reports the coarser resolution it
        // actually got via spec_res_hz.
        const want = sampleRate / pkFrameForRes(resHz) / 2;
        const half = pkPeakHalfWindow(peaks, i, want);
        const t = peaks[i].time;
        return computeSpectralMetrics(
          pkClampT(t - half),
          pkClampT(t + half),
          resHz,
        );
      }

      // Confirm now runs one FFT per peak on top of the temporal maths, which
      // on a long recording is thousands of transforms — far too slow to hold
      // the UI thread without saying anything.
      async function pkConfirm() {
        if (!pkPeaks.length) return;
        return withBusy("Computing metrics\u2026", (progress) =>
          _pkConfirmStages(progress),
        );
      }

      async function _pkConfirmStages(progress) {
        const maxTrainGapMs = parseFloat($("pkMaxTrainGap").value) || 300;
        const minPeaks = parseInt($("pkMinPeaks").value) || 3;
        const useMotifSeq = $("pkMotifSeq").checked;
        const maxMotifGapMs = parseFloat($("pkMaxMotifGap").value) || 800;

        // Trains come straight from the frozen segmentation — same as what's drawn.
        const trains = pkBuildTrains().filter((t) => t.length >= minPeaks);
        const motifs = pkGroupMotifs(trains, maxTrainGapMs);
        const motifSeqs = useMotifSeq
          ? pkGroupMotifSeqs(motifs, maxMotifGapMs)
          : [];

        progress("Peak spectra\u2026", 0.1);
        await busyTick();
        // ── Build peak_data ──────────────────────────────────────────────
        // Period is the interval to the NEXT peak, measured straight through
        // train and motif boundaries.
        //
        // It used to be measured BACKWARDS and only within a train, which left
        // the first peak of every train blank — so every extra train cost
        // another missing value, and arch splitting produces a lot more trains
        // than the gap rule alone did. Forwards and un-segmented, exactly one
        // peak in the table has no successor: the last one.
        const flat = [];
        motifs.forEach((motif, mi) => {
          motif.forEach((train, ti) => {
            train.forEach((p, pi) => flat.push({ p, mi, ti, pi }));
          });
        });
        // One short FFT per peak. Only the measures that survive a frame this
        // short are reported: entropy and flatness need many bins to mean
        // anything and would just be noise dressed as data.
        const allPeaks = flat.map((e) => e.p);
        const peakRes = pkPeakSpecRes();
        // Peak carrier frequencies, kept so the train pass can report how much
        // they vary within a train (freq_spread).
        const peakFreqOf = new Map();
        pkPeakData = flat.map((e, k) => {
          const next = k + 1 < flat.length ? flat[k + 1].p : null;
          const period = next ? next.time - e.p.time : null;
          const sm = pkPeakSpectrum(allPeaks, k, peakRes) || {};
          if (sm.peak_freq_khz != null) peakFreqOf.set(e.p, sm.peak_freq_khz);
          return {
            source_file: pkSourceFile(),
            temp_c: currentTempC,
            specimen_id: currentSpecimenId,
            species: currentSpecies,
            country: currentCountry,
            locality: currentLocality,
            motif_id: e.mi + 1,
            train_id: e.ti + 1,
            peak_id: e.pi + 1,
            peak_time: round4(e.p.time),
            peak_period_ms: period !== null ? round4(period * 1000) : null,
            peak_amp: round4(_pkAmpOf(e.p)),
            peak_freq_khz: sm.peak_freq_khz ?? null,
            bw_20db_khz: sm.bw_20db_khz ?? null,
            spec_centroid_khz: sm.spec_centroid_khz ?? null,
            spec_spread_khz: sm.spec_spread_khz ?? null,
            spec_skew: sm.spec_skew ?? null,
            spec_kurt: sm.spec_kurt ?? null,
            q_20db: sm.q_20db ?? null,
            spec_signal_ms: sm.spec_signal_ms ?? null,
            spec_res_hz: sm.spec_res_hz ?? null,
            spec_bin_hz: sm.spec_bin_hz ?? null,
          };
        });

        progress("Train metrics\u2026", 0.6);
        await busyTick();
        // ── Build train_data ─────────────────────────────────────────────
        pkTrainData = [];
        // Same split as for peaks: the transform length comes from "Train
        // spec win (ms)", not from the shortest train in this recording, so
        // train rows line up across recordings. A train shorter than the
        // transform is zero-padded; a longer one is Welch-averaged.
        const trainRes = pkTrainSpecRes();

        // Sample standard deviation (n-1). One pulse cannot support a spread,
        // so that reports null rather than a misleading zero.
        const sd = (v) => {
          if (v.length < 2) return null;
          const mu = v.reduce((a, b) => a + b, 0) / v.length;
          const q = v.reduce((a, b) => a + (b - mu) * (b - mu), 0);
          return Math.sqrt(q / (v.length - 1));
        };

        // ── Carrier-frequency statistics over constituent pulses ───────────
        // Distinct from the peak_freq_khz already on these rows, which is the
        // dominant frequency of ONE transform over the whole train/motif span.
        // These describe the DISTRIBUTION of the per-pulse carriers inside the
        // structure: where they sit on average, how far they drift, and the
        // extremes reached. A species whose train sweeps in frequency and one
        // whose train holds a steady carrier can report the same
        // peak_freq_khz; only these columns separate them.
        //
        // The p- prefix marks "aggregated over peak rows", parallel to the
        // _tmean suffix meaning "aggregated over train rows".
        const pkFreqCols = (peaksIn) => {
          const f = peaksIn
            .map((pk) => peakFreqOf.get(pk))
            .filter((v) => typeof v === "number" && isFinite(v));
          if (!f.length)
            return {
              peak_freq_pmean_khz: null,
              peak_freq_psd_khz: null,
              peak_freq_pmin_khz: null,
              peak_freq_pmax_khz: null,
            };
          const s = sd(f);
          return {
            peak_freq_pmean_khz: round4(
              f.reduce((a, b) => a + b, 0) / f.length,
            ),
            peak_freq_psd_khz: s === null ? null : round4(s),
            peak_freq_pmin_khz: round4(Math.min(...f)),
            peak_freq_pmax_khz: round4(Math.max(...f)),
          };
        };

        motifs.forEach((motif, mi) => {
          motif.forEach((train, ti) => {
            const times = train.map((p) => p.time);
            const amps = train.map((p) => _pkAmpOf(p) ?? 0);
            const pad = pkTrainPadSec();
            const rawStart = times[0],
              rawEnd = times[times.length - 1];
            const peakSpan = rawEnd - rawStart; // span of peak maxima
            const start = pkClampT(rawStart - pad), // padded train edges
              end = pkClampT(rawEnd + pad);
            const dur = end - start; // padded duration
            const nPeaks = train.length;
            // Pulse (peak) rate stays tied to the peak maxima, not the
            // padded edges, so onset padding never dilutes this diagnostic.
            const rate = peakSpan > 0 ? round4((nPeaks - 1) / peakSpan) : 0;
            const meanAmp = round4(amps.reduce((s, v) => s + v, 0) / nPeaks);
            // Temporal Excursion: sum of |diff(inter-peak intervals in ms)|
            const periods = [];
            for (let i = 1; i < nPeaks; i++)
              periods.push((times[i] - times[i - 1]) * 1000);
            const temExc = round4(
              periods.length > 1
                ? periods
                    .slice(1)
                    .reduce((s, v, i) => s + Math.abs(v - periods[i]), 0)
                : 0,
            );
            // Dynamic Excursion: sum of |diff(amps)|
            const dynExc = round4(
              amps.length > 1
                ? amps
                    .slice(1)
                    .reduce((s, v, i) => s + Math.abs(v - amps[i]), 0)
                : 0,
            );
            // Gap to next train
            const nextTrain = motif[ti + 1];
            const gap = nextTrain
              ? round4(pkClampT(nextTrain[0].time - pad) - end)
              : null;
            pkTrainData.push({
              source_file: pkSourceFile(),
              temp_c: currentTempC,
              specimen_id: currentSpecimenId,
              species: currentSpecies,
              country: currentCountry,
              locality: currentLocality,
              motif_id: mi + 1,
              train_id: ti + 1,
              train_start: round4(start),
              train_end: round4(end),
              train_dur_ms: round4(dur * 1000),
              n_peaks: nPeaks,
              peak_rate_pps: rate, // peaks per second — "Hz" is reserved for spectral frequency
              mean_amp: meanAmp,
              tem_exc: temExc,
              dyn_exc: dynExc,
              train_gap_ms: gap !== null ? round4(gap * 1000) : null,
              // Onset to the next train's onset, within this motif. Null on
              // the motif's last train — the interval to the next motif's
              // first train is a motif period, not a train period.
              train_period_ms:
                gap !== null
                  ? round4(
                      (pkClampT(nextTrain[0].time - pad) - start) * 1000,
                    )
                  : null,
              ...pkSpecCols(computeSpectralMetrics(start, end, trainRes)),
              ...pkFreqCols(train),
              // Historical name for peak_freq_psd_khz, kept so workbooks and
              // scripts written against older exports keep working. Same
              // number: how much the per-peak carrier moves across this train.
              // Large values mean the train's own bandwidth is driven by drift
              // between pulses rather than the width of any one pulse.
              freq_spread: (() => {
                const f = train
                  .map((pk) => peakFreqOf.get(pk))
                  .filter((v) => typeof v === "number" && isFinite(v));
                const v = sd(f);
                return v === null ? null : round4(v);
              })(),
            });
          });
        });

        progress("Motif metrics\u2026", 0.85);
        await busyTick();
        // ── Build motif_data ─────────────────────────────────────────────
        pkMotifData = [];
        const motifRes = pkMotifSpecRes();
        motifs.forEach((motif, mi) => {
          const allPeaks = motif.flat();
          const pad = pkTrainPadSec();
          const rawMStart = allPeaks[0].time;
          const rawMEnd = allPeaks[allPeaks.length - 1].time;
          const mSpan = rawMEnd - rawMStart; // raw extent of peak maxima
          const mStart = pkClampT(rawMStart - pad), // padded motif edges
            mEnd = pkClampT(rawMEnd + pad);
          const mDur = mEnd - mStart; // padded duration
          const nTrains = motif.length;
          // Train rate tied to raw peak span, not the padded edges.
          const trainRate = mSpan > 0 ? round4((nTrains - 1) / mSpan) : 0;
          // Duty cycle: sum(train_dur) / motif_dur
          const myTrains = pkTrainData.filter((t) => t.motif_id === mi + 1);
          const sumDur = myTrains.reduce((s, t) => s + t.train_dur_ms, 0);
          const dutyCycle = mDur > 0 ? round4((sumDur / 1000 / mDur) * 100) : 0;
          const temExcMean = round4(mean(myTrains.map((t) => t.tem_exc)));
          const dynExcMean = round4(mean(myTrains.map((t) => t.dyn_exc)));
          // PCI-syl — the motif divided at TRAIN boundaries: each train's
          // duration, then the gap that follows it. This is the original
          // index. It describes the syllable pattern, but it also inherits
          // whatever grouping parameters produced those trains.
          const propsSyl = [];
          myTrains.forEach((t, i) => {
            propsSyl.push(t.train_dur_ms / 1000 / mDur);
            if (t.train_gap_ms !== null && i < myTrains.length - 1)
              propsSyl.push(t.train_gap_ms / 1000 / mDur);
          });
          const syl = pkPatternComplexity(propsSyl, nTrains, mDur);

          // PCI-agn — the same motif divided at EVERY PEAK: the intervals
          // between consecutive peaks, with no notion of where one train ends
          // and the next begins. Nothing about the grouping enters it, so it
          // is a behaviour-agnostic description of the same motif and can be
          // compared against PCI-syl to test whether train segmentation adds
          // information or only adds assumptions.
          const propsAgn = [];
          for (let i = 1; i < allPeaks.length; i++)
            propsAgn.push((allPeaks[i].time - allPeaks[i - 1].time) / mDur);
          const agn = pkPatternComplexity(propsAgn, allPeaks.length, mDur);
          // Gap to next motif
          const nextMotif = motifs[mi + 1];
          const mGap = nextMotif
            ? round4(pkClampT(nextMotif[0][0].time - pad) - mEnd)
            : null;
          // Onset to the next motif's onset. Null on the last motif.
          const mPeriod = nextMotif
            ? round4(pkClampT(nextMotif[0][0].time - pad) - mStart)
            : null;
          pkMotifData.push({
            source_file: pkSourceFile(),
            temp_c: currentTempC,
            specimen_id: currentSpecimenId,
            species: currentSpecies,
            country: currentCountry,
            locality: currentLocality,
            motif_id: mi + 1,
            motif_start: round4(mStart),
            motif_end: round4(mEnd),
            motif_dur_s: round4(mDur),
            motif_gap_s: mGap,
            motif_period_s: mPeriod,
            n_trains: nTrains,
            train_rate_tps: trainRate, // trains per second — "Hz" is reserved for spectral frequency
            duty_cycle_pct: dutyCycle,
            tem_exc_mean: temExcMean,
            dyn_exc_mean: dynExcMean,
            props_ent_syl: syl.ent,
            props_cv_syl: syl.cv,
            pci_syl: syl.pci,
            props_ent_agn: agn.ent,
            props_cv_agn: agn.cv,
            pci_agn: agn.pci,
            // The motif's own spectrum, at the motif resolution — a long
            // window Welch-averaged across the span, silences included.
            ...pkSpecCols(computeSpectralMetrics(mStart, mEnd, motifRes)),
            ...pkMotifSpecMeans(mi + 1),
            // Pooled over every pulse in the motif, not averaged over its
            // trains: a motif whose trains each hold a steady but different
            // carrier has a small freq_spread (each train is tight) and a
            // large peak_freq_psd_khz (the motif as a whole is not).
            ...pkFreqCols(allPeaks),
          });
        });

        // ── Build motif sequence data ────────────────────────────────────
        pkMotifSeqData = [];
        if (useMotifSeq) {
          motifSeqs.forEach((seq, si) => {
            const allPeaks = seq.flat(2);
            const pad = pkTrainPadSec();
            const sStart = pkClampT(allPeaks[0].time - pad),
              sEnd = pkClampT(allPeaks[allPeaks.length - 1].time + pad);
            const nextSeq = motifSeqs[si + 1];
            const sGap = nextSeq
              ? round4(pkClampT(nextSeq[0][0][0].time - pad) - sEnd)
              : null;
            pkMotifSeqData.push({
              source_file: pkSourceFile(),
              temp_c: currentTempC,
              specimen_id: currentSpecimenId,
              species: currentSpecies,
              country: currentCountry,
              locality: currentLocality,
              seq_id: si + 1,
              seq_start: round4(sStart),
              seq_end: round4(sEnd),
              seq_dur_s: round4(sEnd - sStart),
              seq_gap_s: sGap,
              n_motifs: seq.length,
            });
          });
        }

        // ── Build summary ────────────────────────────────────────────────
        pkSummaryData = {
          source_file: pkSourceFile(),
          temp_c: currentTempC,
          specimen_id: currentSpecimenId,
          species: currentSpecies,
          country: currentCountry,
          locality: currentLocality,
          n_peaks: pkPeakData.length,
          n_trains: pkTrainData.length,
          n_motifs: pkMotifData.length,
          pci_syl_mean: round4(mean(pkMotifData.map((m) => m.pci_syl))),
          pci_syl_sd: round4(sd(pkMotifData.map((m) => m.pci_syl))),
          pci_agn_mean: round4(mean(pkMotifData.map((m) => m.pci_agn))),
          pci_agn_sd: round4(sd(pkMotifData.map((m) => m.pci_agn))),
          duty_cycle_mean: round4(
            mean(pkMotifData.map((m) => m.duty_cycle_pct)),
          ),
          duty_cycle_sd: round4(sd(pkMotifData.map((m) => m.duty_cycle_pct))),
          motif_dur_mean: round4(mean(pkMotifData.map((m) => m.motif_dur_s))),
          motif_dur_sd: round4(sd(pkMotifData.map((m) => m.motif_dur_s))),
          n_trains_per_motif_mean: round4(
            mean(pkMotifData.map((m) => m.n_trains)),
          ),
          n_trains_per_motif_sd: round4(sd(pkMotifData.map((m) => m.n_trains))),
          train_dur_mean: round4(mean(pkTrainData.map((t) => t.train_dur_ms))),
          train_dur_sd: round4(sd(pkTrainData.map((t) => t.train_dur_ms))),
          train_gap_mean: round4(
            mean(
              pkTrainData
                .filter((t) => t.train_gap_ms !== null)
                .map((t) => t.train_gap_ms),
            ),
          ),
          train_gap_sd: round4(
            sd(
              pkTrainData
                .filter((t) => t.train_gap_ms !== null)
                .map((t) => t.train_gap_ms),
            ),
          ),
          peaks_per_train_mean: round4(mean(pkTrainData.map((t) => t.n_peaks))),
          peaks_per_train_sd: round4(sd(pkTrainData.map((t) => t.n_peaks))),
          peak_rate_mean: round4(mean(pkTrainData.map((t) => t.peak_rate_pps))),
          peak_rate_sd: round4(sd(pkTrainData.map((t) => t.peak_rate_pps))),
          tem_exc_mean: round4(mean(pkTrainData.map((t) => t.tem_exc))),
          tem_exc_sd: round4(sd(pkTrainData.map((t) => t.tem_exc))),
          dyn_exc_mean: round4(mean(pkTrainData.map((t) => t.dyn_exc))),
          dyn_exc_sd: round4(sd(pkTrainData.map((t) => t.dyn_exc))),
        };

        pkConfirmed = true;
        $("btnPkConfirm").disabled = false;
        // The report is now mostly temporal, so confirming unlocks it — it
        // used to be reachable only through the spectral measurement paths.
        if ($("btnExportTextReport")) $("btnExportTextReport").disabled = false;
        $("pkResults").style.display = "";
        $("pkTabBtnMotSeq").style.display = useMotifSeq ? "" : "none";
        pkShowTable("peak");
        pkRenderSummaryCards();
        // Peaks packed closer than the requested resolution needs are limited
        // by their neighbours, and those rows are NOT on the same frequency
        // axis as the rest. Say so plainly, with the number to fall back to,
        // rather than leaving it to be discovered in the spreadsheet.
        const achieved = pkPeakData
          .map((r) => r.spec_res_hz)
          .filter((v) => v != null);
        const wantRes = pkPeakSpecRes();
        const worst = achieved.length ? Math.max(...achieved) : 0;
        const short = achieved.filter((v) => v > wantRes * 1.01).length;
        let resNote = "";
        if (short) {
          resNote =
            " | ⚠ " +
            short +
            "/" +
            achieved.length +
            " peaks too close together for " +
            Math.round(wantRes) +
            " Hz (coarsest " +
            Math.round(worst) +
            " Hz) — use " +
            Math.ceil(worst / 50) * 50 +
            " Hz for one common axis";
        }
        $("pkStatus").textContent =
          "✓ " +
          pkPeakData.length +
          " peaks | " +
          pkTrainData.length +
          " trains | " +
          pkMotifData.length +
          " motifs" +
          resNote;
        pkDrawEnvelope();
      }

      // ── Helpers ──────────────────────────────────────────────────────────
      // Pattern Complexity Index.
      //
      // `props` are the segments a motif divides into, each as a fraction of
      // the motif's duration; `count` is how many elements that division
      // produced. Entropy rewards many comparable segments, CV rewards them
      // being uneven, sqrt(count) rewards there being more of them, and the
      // sqrt(dur) denominator stops a long motif scoring high merely for being
      // long.
      //
      // The SCORING is shared between both variants; only the DIVISION differs
      // — which is exactly the thing being tested. PCI-syl divides the motif
      // at train boundaries, PCI-agn at every peak. Keeping one formula means
      // a difference between the two columns can only come from the division.
      //
      // Note this deliberately does not bail out on an empty `props`: the
      // count term alone is still a defined score, and PCI-syl has to
      // reproduce the earlier single-PCI numbers exactly.
      function pkPatternComplexity(props, count, durSec) {
        const p = props.filter(
          (v) => typeof v === "number" && isFinite(v) && v > 0,
        );
        const m = mean(p);
        const cv = m > 0 ? sd(p) / m : 0;
        const ent = -p.reduce((s, v) => s + v * Math.log(v), 0);
        return {
          ent: round4(ent),
          cv: round4(cv),
          pci: round4((ent * cv + Math.sqrt(count)) / (Math.sqrt(durSec) + 1)),
        };
      }

      function round4(v) {
        return v !== null && isFinite(v) ? +v.toFixed(4) : null;
      }
      function mean(a) {
        return a.length ? a.reduce((s, v) => s + (v || 0), 0) / a.length : 0;
      }
      function sd(a) {
        const m = mean(a);
        return a.length > 1
          ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1))
          : 0;
      }

      // ── Table rendering ──────────────────────────────────────────────────
      function pkShowTable(which) {
        pkCurrentTable = which;
        ["peak", "train", "motif", "motseq", "summ"].forEach((t) => {
          const btn = $("pkTabBtn" + t.charAt(0).toUpperCase() + t.slice(1));
          if (btn) btn.className = t === which ? "pri" : "";
        });
        // Fix button IDs
        $("pkTabBtnPeak").className = which === "peak" ? "pri" : "";
        $("pkTabBtnTrain").className = which === "train" ? "pri" : "";
        $("pkTabBtnMotif").className = which === "motif" ? "pri" : "";
        $("pkTabBtnMotSeq").className = which === "motseq" ? "pri" : "";
        $("pkTabBtnSumm").className = which === "summ" ? "pri" : "";

        const dataMap = {
          peak: pkPeakData,
          train: pkTrainData,
          motif: pkMotifData,
          motseq: pkMotifSeqData,
          summ: pkSummaryData ? [pkSummaryData] : [],
        };
        const data = dataMap[which] || [];
        if (!data.length) return;
        const cols = Object.keys(data[0]);
        const head = $("pkTableHead");
        head.innerHTML = "";
        cols.forEach((c) => {
          const th = document.createElement("th");
          th.textContent = c;
          head.appendChild(th);
        });
        const body = $("pkTableBody");
        body.innerHTML = "";
        data.forEach((row) => {
          const tr = document.createElement("tr");
          cols.forEach((c) => {
            const td = document.createElement("td");
            td.textContent =
              row[c] !== null && row[c] !== undefined ? row[c] : "—";
            tr.appendChild(td);
          });
          body.appendChild(tr);
        });
      }

      function pkRenderSummaryCards() {
        if (!pkSummaryData) return;
        const cards = [
          { lbl: "Peaks", v: pkSummaryData.n_peaks },
          { lbl: "Trains", v: pkSummaryData.n_trains },
          { lbl: "Motifs", v: pkSummaryData.n_motifs },
          { lbl: "PCI-syl (mean)", v: pkSummaryData.pci_syl_mean },
          { lbl: "PCI-agn (mean)", v: pkSummaryData.pci_agn_mean },
          { lbl: "Duty cycle %", v: pkSummaryData.duty_cycle_mean },
          { lbl: "Peak rate (peaks/s)", v: pkSummaryData.peak_rate_mean },
          { lbl: "Tem. Exc.", v: pkSummaryData.tem_exc_mean },
          { lbl: "Dyn. Exc.", v: pkSummaryData.dyn_exc_mean },
        ];
        const sg = $("pkSummCards");
        sg.innerHTML = "";
        sg.style.cssText =
          "display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:6px";
        cards.forEach((c) => {
          const d = document.createElement("div");
          d.className = "scard";
          d.innerHTML =
            '<div class="sv">' +
            c.v +
            '</div><div class="sl">' +
            c.lbl +
            "</div>";
          sg.appendChild(d);
        });
      }

      // ── Export ───────────────────────────────────────────────────────────
      function pkExportCurrent() {
        const dataMap = {
          peak: pkPeakData,
          train: pkTrainData,
          motif: pkMotifData,
          motseq: pkMotifSeqData,
          summ: pkSummaryData ? [pkSummaryData] : [],
        };
        const data = dataMap[pkCurrentTable] || [];
        if (!data.length) return;
        const cols = Object.keys(data[0]);
        let csv = cols.join(",") + "\n";
        data.forEach((row) => {
          csv +=
            cols
              .map((c) =>
                row[c] !== null && row[c] !== undefined ? row[c] : "",
              )
              .join(",") + "\n";
        });
        dlFile("Rthoptera_" + pkCurrentTable + "_data.csv", csv, "text/csv");
      }

      // Export every results table into ONE .xlsx workbook (one sheet per table).
      // Self-contained: builds the OOXML + ZIP by hand, no external library, works
      // fully offline.
      async function pkExportAll() {
        const sheets = [
          ["Peaks", pkPeakData],
          ["Trains", pkTrainData],
          ["Motifs", pkMotifData],
          ["MotifSeqs", pkMotifSeqData],
          ["Summary", pkSummaryData ? [pkSummaryData] : []],
        ].filter(([, data]) => data && data.length);

        if (!sheets.length) {
          log("Nothing to export — run Confirm & Compute first.", "warn");
          return;
        }

        // A Peaks sheet routinely runs to tens of thousands of rows, and the
        // whole workbook is serialised to XML and zipped on this thread.
        //
        // The save DIALOG is deliberately left outside the overlay: at that
        // point the app is waiting on the user, not working, and a spinner
        // sitting over a file picker reads as a hang.
        let bytes;
        try {
          bytes = await withBusy(
            "Building Excel workbook…",
            async (progress) => {
              progress("Building " + sheets.length + " sheets…", 0.3);
              await busyTick();
              return _buildXlsx(sheets);
            },
          );
        } catch (e) {
          log("Excel export failed: " + e.message, "warn");
          return;
        }
        try {
          const stamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, "-");
          await dlFile(
            "Rthoptera_temp_" + stamp + ".xlsx",
            bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
          log("Exported " + sheets.length + " sheets to Excel workbook", "ok");
        } catch (e) {
          log("Excel export failed: " + e.message, "warn");
        }
      }

      // ── Minimal XLSX writer (OOXML + stored-ZIP, no dependencies) ─────────
      function _xmlEsc(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");
      }
      function _colRef(c) {
        // 0-based column index → A, B, ... AA, AB ...
        let s = "";
        c++;
        while (c > 0) {
          const m = (c - 1) % 26;
          s = String.fromCharCode(65 + m) + s;
          c = (c - m - 1) / 26;
        }
        return s;
      }
      // Build a worksheet XML from an array of row-objects.
      function _sheetXml(data) {
        const cols = Object.keys(data[0]);
        let rows = "";
        // Header row
        rows += '<row r="1">';
        cols.forEach((c, ci) => {
          rows +=
            '<c r="' +
            _colRef(ci) +
            '1" t="inlineStr"><is><t xml:space="preserve">' +
            _xmlEsc(c) +
            "</t></is></c>";
        });
        rows += "</row>";
        // Data rows
        data.forEach((row, ri) => {
          const r = ri + 2;
          rows += '<row r="' + r + '">';
          cols.forEach((c, ci) => {
            const v = row[c];
            const ref = _colRef(ci) + r;
            if (v && typeof v === "object" && typeof v.__xlFormula === "string") {
              // A live formula rather than a literal. No cached <v> is
              // written, so Excel computes it on open — see fullCalcOnLoad
              // in _buildXlsx, without which the cells can read blank until
              // something forces a recalculation.
              rows +=
                '<c r="' + ref + '"><f>' + _xmlEsc(v.__xlFormula) + "</f></c>";
            } else if (v === null || v === undefined || v === "") {
              // empty cell — omit value
              rows += '<c r="' + ref + '"/>';
            } else if (typeof v === "number" && isFinite(v)) {
              rows += '<c r="' + ref + '"><v>' + v + "</v></c>";
            } else {
              rows +=
                '<c r="' +
                ref +
                '" t="inlineStr"><is><t xml:space="preserve">' +
                _xmlEsc(v) +
                "</t></is></c>";
            }
          });
          rows += "</row>";
        });
        return (
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          "<sheetData>" +
          rows +
          "</sheetData></worksheet>"
        );
      }
      function _buildXlsx(sheets) {
        // sheets: array of [name, dataArray]. Excel sheet names ≤31 chars, unique.
        const used = {};
        const names = sheets.map(([name]) => {
          let nm =
            String(name)
              .slice(0, 31)
              .replace(/[\\/?*\[\]:]/g, "_") || "Sheet";
          let base = nm,
            k = 1;
          while (used[nm.toLowerCase()]) {
            nm = base.slice(0, 28) + "_" + k++;
          }
          used[nm.toLowerCase()] = true;
          return nm;
        });

        const files = {};
        files["[Content_Types].xml"] =
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          sheets
            .map(
              (_, i) =>
                '<Override PartName="/xl/worksheets/sheet' +
                (i + 1) +
                '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
            )
            .join("") +
          "</Types>";

        files["_rels/.rels"] =
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>";

        files["xl/workbook.xml"] =
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          "<sheets>" +
          names
            .map(
              (nm, i) =>
                '<sheet name="' +
                _xmlEsc(nm) +
                '" sheetId="' +
                (i + 1) +
                '" r:id="rId' +
                (i + 1) +
                '"/>',
            )
            .join("") +
          "</sheets>" +
          // Formula cells are written without a cached result, so Excel has
          // to be told to calculate the whole book when it opens it.
          '<calcPr calcId="0" fullCalcOnLoad="1"/>' +
          "</workbook>";

        files["xl/_rels/workbook.xml.rels"] =
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets
            .map(
              (_, i) =>
                '<Relationship Id="rId' +
                (i + 1) +
                '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
                (i + 1) +
                '.xml"/>',
            )
            .join("") +
          "</Relationships>";

        sheets.forEach(([, data], i) => {
          files["xl/worksheets/sheet" + (i + 1) + ".xml"] = _sheetXml(data);
        });

        return _zipStore(files);
      }

      // ── Minimal ZIP writer: "stored" (no compression). Valid .zip/.xlsx ────
      function _zipStore(files) {
        const enc = new TextEncoder();
        const entries = [];
        for (const name in files)
          entries.push({ name, data: enc.encode(files[name]) });

        // CRC-32
        const crcTable =
          _zipStore._crc ||
          (_zipStore._crc = (() => {
            const t = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
              let c = n;
              for (let k = 0; k < 8; k++)
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
              t[n] = c >>> 0;
            }
            return t;
          })());
        const crc32 = (buf) => {
          let c = 0xffffffff;
          for (let i = 0; i < buf.length; i++)
            c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
          return (c ^ 0xffffffff) >>> 0;
        };

        const chunks = [];
        const central = [];
        let offset = 0;
        const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
        const u32 = (n) => [
          n & 0xff,
          (n >>> 8) & 0xff,
          (n >>> 16) & 0xff,
          (n >>> 24) & 0xff,
        ];

        entries.forEach((e) => {
          const nameBytes = enc.encode(e.name);
          const crc = crc32(e.data);
          const size = e.data.length;
          // Local file header
          const lh = [].concat(
            u32(0x04034b50),
            u16(20),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            u32(crc),
            u32(size),
            u32(size),
            u16(nameBytes.length),
            u16(0),
          );
          const lhBuf = new Uint8Array(lh);
          chunks.push(lhBuf, nameBytes, e.data);
          // Central directory record
          const cd = [].concat(
            u32(0x02014b50),
            u16(20),
            u16(20),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            u32(crc),
            u32(size),
            u32(size),
            u16(nameBytes.length),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            u32(0),
            u32(offset),
          );
          central.push({ rec: new Uint8Array(cd), name: nameBytes });
          offset += lhBuf.length + nameBytes.length + e.data.length;
        });

        const cdStart = offset;
        let cdSize = 0;
        central.forEach((c) => {
          chunks.push(c.rec, c.name);
          cdSize += c.rec.length + c.name.length;
        });
        // End of central directory
        const eocd = [].concat(
          u32(0x06054b50),
          u16(0),
          u16(0),
          u16(entries.length),
          u16(entries.length),
          u32(cdSize),
          u32(cdStart),
          u16(0),
        );
        chunks.push(new Uint8Array(eocd));

        // Concatenate
        let total = 0;
        chunks.forEach((c) => (total += c.length));
        const out = new Uint8Array(total);
        let p = 0;
        chunks.forEach((c) => {
          out.set(c, p);
          p += c.length;
        });
        return out;
      }

      // ── Minimal DOCX writer (OOXML + stored-ZIP, reuses _zipStore) ────────
      function _buildDocxDocumentXml(title, paragraphs) {
        let body =
          '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr>' +
          '<w:t xml:space="preserve">' +
          _xmlEsc(title) +
          "</w:t></w:r></w:p>" +
          "<w:p/>";
        // A paragraph is either a plain string or { text, bold } for a
        // section heading. Strings must keep working: summSaveReport re-reads
        // the user-editable textarea and passes nothing but strings.
        paragraphs.forEach((p) => {
          const text = typeof p === "string" ? p : p.text;
          const bold = typeof p === "object" && p.bold;
          body +=
            '<w:p><w:pPr><w:spacing w:before="' +
            (bold ? "240" : "0") +
            '" w:after="' +
            (bold ? "80" : "200") +
            '"/></w:pPr><w:r>' +
            (bold ? "<w:rPr><w:b/></w:rPr>" : "") +
            '<w:t xml:space="preserve">' +
            _xmlEsc(text) +
            "</w:t></w:r></w:p>";
        });
        return (
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          "<w:body>" +
          body +
          "<w:sectPr/></w:body></w:document>"
        );
      }
      function _buildDocx(title, paragraphs) {
        const files = {};
        files["[Content_Types].xml"] =
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          "</Types>";
        files["_rels/.rels"] =
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          "</Relationships>";
        files["word/document.xml"] = _buildDocxDocumentXml(title, paragraphs);
        return _zipStore(files);
      }

      // "24.03 ± 0.86 [22.66–25.86] ms" — mean, SD and range in one string.
      //
      // Nulls are dropped first, and this matters: train_gap_ms,
      // train_period_ms, motif_gap_s and motif_period_s are all null on their
      // last element by design, and the shared mean() coerces null to 0, which
      // would drag every one of those statistics low.
      //
      // Returns null when nothing is left, so the caller omits the line rather
      // than printing "0.00 ± 0.00".
      function _statStr(vals, digits, unit) {
        const v = vals.filter((x) => typeof x === "number" && isFinite(x));
        if (!v.length) return null;
        const lo = Math.min(...v),
          hi = Math.max(...v);
        const u = unit ? " " + unit : "";
        return (
          mean(v).toFixed(digits) +
          " ± " +
          sd(v).toFixed(digits) +
          " [" +
          lo.toFixed(digits) +
          "–" +
          hi.toFixed(digits) +
          "]" +
          u
        );
      }

      // Inter-peak intervals WITHIN each train.
      //
      // The peak_period_ms column cannot be averaged directly: it is built
      // from the globally flattened peak list, so the last peak of every train
      // carries the inter-train interval instead of a pulse period. Averaging
      // it would blend pulse periods with train gaps and inflate the result.
      // Regrouping by (motif_id, train_id) and dropping each train's last peak
      // leaves only genuine within-train periods.
      function _pkWithinTrainPeriods() {
        const byTrain = new Map();
        pkPeakData.forEach((r) => {
          const k = r.motif_id + "/" + r.train_id;
          if (!byTrain.has(k)) byTrain.set(k, []);
          byTrain.get(k).push(r);
        });
        const out = [];
        byTrain.forEach((rows) => {
          for (let i = 0; i < rows.length - 1; i++) {
            const v = rows[i].peak_period_ms;
            if (typeof v === "number" && isFinite(v)) out.push(v);
          }
        });
        return out;
      }

      // Turns the confirmed temporal analysis into a statistics report: one
      // bold heading per level, then one line per metric as
      // mean ± SD [min–max]. The spectral-detection narrative that used to
      // be the whole report is kept and appended when those measurements exist.
      function buildTextReportParagraphs() {
        const paras = [];
        const col = (rows, k) => rows.map((r) => r[k]);

        if (pkConfirmed && pkPeakData.length) {
          const fname = currentAudioFileName || "recording";
          paras.push(
            "Temporal analysis of " +
              fname +
              " over " +
              (duration ? duration.toFixed(2) + " s" : "an unknown duration") +
              ": " +
              pkPeakData.length +
              " peaks in " +
              pkTrainData.length +
              " trains and " +
              pkMotifData.length +
              " motifs. Values are mean ± SD [min–max].",
          );

          // Each entry: [label, values, decimals, unit]. Lines with no valid
          // data are skipped rather than printed as zeros.
          const section = (title, rows) => {
            const lines = rows
              .map(([lbl, vals, d, unit]) => {
                const st = _statStr(vals, d, unit);
                return st ? lbl + ": " + st : null;
              })
              .filter(Boolean);
            if (!lines.length) return;
            paras.push({ text: title, bold: true });
            lines.forEach((l) => paras.push(l));
          };

          section("Peaks", [
            ["Peak period (within train)", _pkWithinTrainPeriods(), 2, "ms"],
            ["Peaks per train", col(pkTrainData, "n_peaks"), 1, null],
          ]);

          section("Trains", [
            ["Train rate", col(pkMotifData, "train_rate_tps"), 2, "trains/s"],
            ["Trains per motif", col(pkMotifData, "n_trains"), 1, null],
            ["Train duration", col(pkTrainData, "train_dur_ms"), 2, "ms"],
            ["Train period", col(pkTrainData, "train_period_ms"), 2, "ms"],
            ["Train gap", col(pkTrainData, "train_gap_ms"), 2, "ms"],
            ["Dynamic excursion (DE)", col(pkTrainData, "dyn_exc"), 3, null],
            ["Temporal excursion (TE)", col(pkTrainData, "tem_exc"), 2, null],
          ]);

          section("Motifs", [
            ["Motif duration", col(pkMotifData, "motif_dur_s"), 3, "s"],
            ["Motif period", col(pkMotifData, "motif_period_s"), 3, "s"],
            ["Duty cycle", col(pkMotifData, "duty_cycle_pct"), 1, "%"],
            // The motif's OWN transform, not the _tmean average of its trains.
            ["Peak frequency", col(pkMotifData, "peak_freq_khz"), 3, "kHz"],
            ["Bandwidth at -20 dB", col(pkMotifData, "bw_20db_khz"), 3, "kHz"],
            ["Bandwidth at -10 dB", col(pkMotifData, "bw_10db_khz"), 3, "kHz"],
            ["PCI-agn", col(pkMotifData, "pci_agn"), 3, null],
            ["PCI-syl", col(pkMotifData, "pci_syl"), 3, null],
          ]);
        }

        // The original spectral-detection narrative, unchanged, kept so
        // nothing that worked before this report was rewritten is lost.
        if (detMeasurements && detMeasurements.length) {
          const n = detMeasurements.length;
          const nums = (k) =>
            detMeasurements
              .map((m) => m[k])
              .filter((v) => typeof v === "number" && isFinite(v));
          const pm = (a, d) =>
            a.length ? mean(a).toFixed(d) + " ± " + sd(a).toFixed(d) : null;

          const durs = nums("dur_ms"),
            peaks = nums("peak_freq_khz"),
            bw20 = nums("bw_20db_khz"),
            bw10 = nums("bw_10db_khz"),
            q3 = nums("q_3db"),
            ent = nums("spec_entropy"),
            cent = nums("spec_centroid_khz");

          paras.push({ text: "Measured selections", bold: true });
          paras.push(
            "The measurements table held " +
              n +
              " measured sound " +
              (n === 1 ? "unit" : "units") +
              ".",
          );
          const bits = [];
          if (peaks.length)
            bits.push("a peak frequency of " + pm(peaks, 3) + " kHz");
          if (durs.length) bits.push("a duration of " + pm(durs, 2) + " ms");
          if (bits.length)
            paras.push("The average sound unit had " + bits.join("; ") + ".");

          const bwBits = [];
          if (bw20.length)
            bwBits.push("-20 dB bandwidth of " + pm(bw20, 3) + " kHz");
          if (bw10.length)
            bwBits.push("-10 dB bandwidth of " + pm(bw10, 3) + " kHz");
          if (bwBits.length)
            paras.push(
              "Bandwidth measured a mean " + bwBits.join(" and a mean ") + ".",
            );
          if (q3.length)
            paras.push("The average Q-factor at -3 dB was " + pm(q3, 2) + ".");

          const shapeBits = [];
          if (cent.length)
            shapeBits.push("a spectral centroid of " + pm(cent, 3) + " kHz");
          if (ent.length)
            shapeBits.push("a spectral entropy of " + pm(ent, 4));
          if (shapeBits.length)
            paras.push(
              "On average, sound units had " + shapeBits.join(" and ") + ".",
            );
        }

        return paras.length ? paras : null;
      }

      function exportTextReport() {
        if (!rawSamples) {
          log("Load audio first", "warn");
          return;
        }
        const paragraphs = buildTextReportParagraphs();
        if (!paragraphs || !paragraphs.length) {
          log(
            "Run Detect Peaks and Confirm (or compute spectral metrics) before exporting a report.",
            "warn",
          );
          return;
        }
        try {
          const fname = currentAudioFileName || "recording";
          const bytes = _buildDocx("Analysis Report — " + fname, paragraphs);
          // Built here rather than left to dlFile's rename intercept: that
          // maps a stem containing "spec" to the bare "_spec" marker used by
          // the workbooks, which would collide with the Excel export. Naming
          // it explicitly (with exactName) keeps the report distinct while
          // still matching the "<audio>_<marker>" convention — and
          // _summRecordingKey still cuts at "_spec", so it groups with the
          // other exports from the same recording.
          const base = fname.replace(/\.[^/.]+$/, "");
          dlFile(
            base + "_spec_report.docx",
            bytes,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            { exactName: true },
          );
          log("Saved text report", "ok");
        } catch (e) {
          log("Text report export failed: " + e.message, "err");
        }
      }

      // ── Measurement-column glossary (Explain Metrics modal) ────────────────
      const METRIC_GLOSSARY = [
        {
          lbl: "#",
          desc: "Sequential index of the measured unit (selection or detection), in chronological order.",
        },
        {
          lbl: "Start (s)",
          desc: "Start time of the unit, in seconds from the beginning of the recording.",
        },
        {
          lbl: "End (s)",
          desc: "End time of the unit, in seconds from the beginning of the recording.",
        },
        {
          lbl: "Dur (ms)",
          desc: "Duration of the unit, in milliseconds (End − Start).",
        },
        {
          lbl: "Gap (ms)",
          desc: "Silence gap since the end of the previous unit, in milliseconds. Blank for the first unit.",
        },
        {
          lbl: "Peak Freq (kHz)",
          desc: "Frequency with the highest power in the unit's averaged power spectrum, refined by parabolic interpolation between adjacent FFT bins.",
        },
        {
          lbl: "Freq Min -20dB (kHz)",
          desc: "Lowest frequency at which spectral power is still within 20 dB of the peak.",
        },
        {
          lbl: "Freq Max -20dB (kHz)",
          desc: "Highest frequency at which spectral power is still within 20 dB of the peak.",
        },
        {
          lbl: "BW -20dB (kHz)",
          desc: "Bandwidth spanning the -20 dB power threshold around the peak (Freq Max − Freq Min at -20 dB) — brackets most of the signal's energy.",
        },
        {
          lbl: "BW -10dB (kHz)",
          desc: "Narrower bandwidth spanning the -10 dB power threshold around the peak, closer to the energy core of the signal than the -20 dB bandwidth.",
        },
        {
          lbl: "Q -3dB",
          desc: "Quality factor at the half-power (-3 dB) bandwidth: peak frequency divided by the -3 dB bandwidth. Higher Q means a narrower, more tonal spectral peak; lower Q means a broader, noisier one.",
        },
        {
          lbl: "Q -10dB",
          desc: "Quality factor using the -10 dB bandwidth instead of -3 dB — a wider bandwidth definition, so typically lower than Q -3dB for the same signal.",
        },
        {
          lbl: "Q -20dB",
          desc: "Quality factor using the -20 dB bandwidth — the widest of the three, and typically the lowest Q value.",
        },
        {
          lbl: "Centroid (kHz)",
          desc: "Power-weighted mean frequency of the spectrum, the spectral \"center of mass\". Can differ from the peak frequency when the spectrum is asymmetric.",
        },
        {
          lbl: "IQ BW (kHz)",
          desc: "Inter-quartile bandwidth: the frequency span between the 25th and 75th percentile of cumulative spectral power — a robust measure of spectral spread.",
        },
        {
          lbl: "Entropy",
          desc: "Normalized Shannon entropy of the power spectrum (0–1). Low values indicate a tonal, concentrated spectrum; high values indicate a noisy, flat spectrum.",
        },
        {
          lbl: "Flatness",
          desc: "Ratio of the geometric to arithmetic mean of the spectrum (0–1). Near 0 for tonal signals with a sharp peak, near 1 for white-noise-like signals.",
        },
      ];

      function openMetricsExplainer() {
        const body = $("metricsModalBody");
        body.innerHTML = "";
        const dl = document.createElement("dl");
        METRIC_GLOSSARY.forEach((m) => {
          const dt = document.createElement("dt");
          dt.textContent = m.lbl;
          const dd = document.createElement("dd");
          dd.textContent = m.desc;
          dl.appendChild(dt);
          dl.appendChild(dd);
        });
        body.appendChild(dl);
        $("metricsModalOverlay").classList.add("show");
      }

      function closeMetricsExplainer() {
        $("metricsModalOverlay").classList.remove("show");
      }

      document.addEventListener("keydown", (ev) => {
        if (ev.key !== "Escape") return;
        if ($("metricsModalOverlay").classList.contains("show")) closeMetricsExplainer();
        if ($("saveAudioModalOverlay").classList.contains("show")) closeSaveEditedAudioModal();
      });

      function downloadMetricsExplainerDocx() {
        try {
          const paragraphs = METRIC_GLOSSARY.map((m) => m.lbl + " — " + m.desc);
          const bytes = _buildDocx(
            "Rthoptera — Measurement Columns Explained",
            paragraphs,
          );
          dlFile(
            "measurement_columns_explained.docx",
            bytes,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          );
          log("Saved metrics explainer", "ok");
        } catch (e) {
          log("Explainer export failed: " + e.message, "err");
        }
      }

      function pkClear() {
        pkEnv = null;
        pkPeaks = [];
        pkTrains = [];
        pkMotifs = [];
        pkPeakData = [];
        pkTrainData = [];
        pkMotifData = [];
        pkMotifSeqData = [];
        pkSummaryData = null;
        pkConfirmed = false;
        pkHoverTime = null;
        pkClearSelection();
        pkBand = null;
        if (typeof pkHideMenu === "function") pkHideMenu();
        $("pkResults").style.display = "none";
        $("btnPkConfirm").disabled = true;
        const applyBtn = $("btnPkApplySpectral");
        if (applyBtn) applyBtn.disabled = true;
        $("pkStatus").textContent = "Cleared";
        const canvas = $("pkCanvas");
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#0d1117";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      function pkApplyDetectionsToSpectral() {
        if (!rawSamples) {
          log("Load audio first", "warn");
          return;
        }
        if (!pkPeaks.length) {
          log("No peak detections to apply", "warn");
          return;
        }

        const kind = $("pkApplySelectionType")?.value || "train";
        const minPeaks = parseInt($("pkMinPeaks").value) || 3;
        const trains = pkBuildTrains().filter((t) => t.length >= minPeaks);
        if (!trains.length) {
          log(
            "No train selections available for current peak settings.",
            "warn",
          );
          return;
        }

        const selections =
          kind === "motif"
            ? pkGroupMotifs(trains, parseFloat($("pkMaxTrainGap").value) || 300)
            : trains;
        if (!selections.length) {
          log(
            "No " +
              kind +
              " selections could be built from current detections.",
            "warn",
          );
          return;
        }

        annotSnapshot("apply " + kind + " selections");

        // Replace whatever this function added last time — otherwise
        // editing detections (splitting/joining/deleting peaks) and
        // re-applying just piles fresh, correctly-numbered selections on
        // top of the stale ones from before the edit, instead of updating
        // them. Selections created some other way (manual drag-select)
        // are untouched since only previously-applied ids are removed.
        if (pkAppliedAnnotationIds.length) {
          const stale = new Set(pkAppliedAnnotationIds);
          annotations = annotations.filter((a) => !stale.has(a.id));
          pkAppliedAnnotationIds = [];
        }

        const nyq = rawSamples ? sampleRate / 2 : 20000;
        let added = 0,
          skipped = 0;
        const addedIds = [];
        const pad = pkTrainPadSec();
        selections.forEach((selection, i) => {
          // selection is a train (array of peaks) or, for kind="motif", a
          // motif (array of trains). Resolve the first/last PEAK either way,
          // then pad each edge to match the padded train/motif extent.
          const isMotif = Array.isArray(selection[0]);
          const firstPeak = isMotif ? selection[0][0] : selection[0];
          const lastGroup = selection[selection.length - 1];
          const lastPeak = isMotif
            ? lastGroup[lastGroup.length - 1]
            : lastGroup;
          const start = pkClampT(firstPeak.time - pad);
          const end = pkClampT(lastPeak.time + pad);
          if (
            annotations.find(
              (x) =>
                Math.abs(x.start - start) < 1e-6 &&
                Math.abs(x.end - end) < 1e-6,
            )
          ) {
            skipped++;
            return;
          }
          const aid = nextAid++;
          annotations.push({
            start,
            end,
            fLo: 0,
            fHi: nyq,
            label: kind + " " + (i + 1),
            id: aid,
          });
          addedIds.push(aid);
          added++;
        });

        pkAppliedAnnotationIds = addedIds.slice();

        if (addedIds.length) {
          selAid = addedIds[addedIds.length - 1];
          const a = annotations.find((x) => x.id === selAid);
          if (a) {
            const selDur = Math.max(0.05, a.end - a.start);
            const targetDur = Math.min(
              duration,
              Math.max(viewDur, selDur * 1.5),
            );
            const centerStart = a.start - (targetDur - (a.end - a.start)) / 2;
            viewDur = targetDur;
            viewStart = Math.max(0, Math.min(centerStart, duration - viewDur));
          }
        }

        // Rebuild the selection list UI; this also enables the Spectral
        // Metrics button (btnComputeSpectral) now that selections exist, so the
        // user can compute spectral metrics on the imported selections.
        refreshAnnotList();
        render();
        renderMinimap();
        switchMainTab("analyzer", $("maintab-analyzer"));
        setTool("select");
        // Force redraw after tab switch/layout
        setTimeout(render, 50);

        if (added) {
          log(
            "Applied " +
              added +
              " " +
              kind +
              " selections to Spectral Analysis" +
              (skipped ? " (" + skipped + " skipped)" : ""),
            "ok",
          );
        } else {
          log(
            "No new " + kind + " selections were added to Spectral Analysis.",
            "warn",
          );
        }
      }

      // Enable Detect Peaks button when audio loads
      // (hooked into existing load pipeline via a small addition)

      // Sync the Loaded Audio panel's settings inputs with any persisted
      // grid size on first load.
      renderAudioLibraryPanel();

      // ═══════════════════════════════════════════════════════════════════
      // SUMMARIZE — merge several Temporal/Spectral Analysis .xlsx exports
      // (own recording or several individuals) into one workbook, pool
      // stats across them, and draft a plain-language report. Works purely
      // off the imported files; no audio needs to be loaded. Reuses the
      // shared _readXlsx / _buildXlsx / _buildDocx / dlFile helpers.
      // ═══════════════════════════════════════════════════════════════════
      let summFilesData = []; // [{id, name, specimenId, fromData, sheets: {peaks:[],trains:[],...}}]
      let summNextFileId = 1;
      // Holds {specimenId, species, country, locality} copied from one file box via
      // "📋 Copy metadata", so it can be pasted into others — cuts down on
      // retyping the same tags across many files from one field trip.
      let summMetaClipboard = null;
      let summMerged = null; // {peaks:[],trains:[],motifs:[],motseq:[],spectral:[]}
      let summStatsRows = null; // [{selection, category, specimenId, metric, n, mean, sd, min, max}]
      // Kept from the last merge so a selection can be edited and re-summarized
      // without re-reading every workbook.
      let summIndividuals = [];
      let summNRecordings = 0;
      // User-defined structure selections and the rows each one last matched.
      let summSelections = []; // [{id, name, level, positions, filters}]
      let summNextSelId = 1;
      let summSelResults = []; // [{sel, cat, rows, nGroups, nBefore, err}]
      // Set once the user types in the report box, so re-summarizing after a
      // selection edit never overwrites their own wording.
      let summReportEdited = false;
      // The label the pooled (unselected) stats carry in the `selection`
      // column, so "everything" is a selection like any other downstream.
      const SUMM_SEL_ALL = "All rows";

      const SUMM_CATS = ["peaks", "trains", "motifs", "motseq", "spectral"];
      const SUMM_LABEL = {
        peaks: "Peaks",
        trains: "Trains",
        motifs: "Motifs",
        motseq: "MotifSeqs",
        spectral: "Spectral",
      };
      const SUMM_SHEET_NAME = {
        peaks: "Peaks",
        trains: "Trains",
        motifs: "Motifs",
        motseq: "MotifSeqs",
        spectral: "Spectral_Analysis",
      };

      // Identify which of the 5 known table kinds a sheet holds — first by
      // its name (matches Rthoptera's own export sheet names), falling back
      // to its columns so renamed/re-saved sheets still classify correctly.
      // "Summary"/"Info" sheets from source files are intentionally skipped:
      // the merged Summary is recomputed fresh from the pooled raw rows.
      function _summClassifySheet(name, rows) {
        const nm = name.toLowerCase();
        if (nm.includes("motifseq")) return "motseq";
        if (nm.includes("motif")) return "motifs";
        if (nm.includes("train")) return "trains";
        if (nm.includes("peak")) return "peaks";
        if (nm.includes("spectral")) return "spectral";
        if (nm === "summary" || nm === "info") return null;
        if (!rows || !rows.length) return null;
        const cols = Object.keys(rows[0]).map((c) => c.toLowerCase());
        const has = (...ks) => ks.every((k) => cols.includes(k));
        if (has("motif_start", "motif_end")) return "motifs";
        if (has("train_start", "train_end")) return "trains";
        if (cols.includes("peak_time")) return "peaks";
        if (
          cols.some(
            (c) =>
              c.includes("peak_freq") ||
              c.includes("bandwidth") ||
              c.includes("bw_20db") ||
              c.includes("spec_centroid"),
          )
        )
          return "spectral";
        return null;
      }

      // Scan every sheet in the workbook (not just the classified ones — the
      // per-file Info/Summary sheets carry it too) for the first non-empty
      // value of the given tag column (specimen_id / species / locality).
      // Rthoptera's exports tag every row with whatever was entered in the
      // toolbar for that recording; this recovers it so files group by the
      // real tag instead of guessing from the file name.
      //
      // Returns {value, why}. `why` distinguishes the two ways this comes back
      // empty — no such column anywhere, versus a column that is present but
      // blank — because the file list can only say something useful about a
      // missing tag if it knows which happened. "Not found" sent a user
      // hunting for a column that was sitting right there, empty.
      function _summFindTagField(workbook, fieldName) {
        const want = _normHeader(fieldName).toLowerCase();
        let sawColumn = false;
        for (const sn of Object.keys(workbook)) {
          const rows = workbook[sn];
          if (!rows || !rows.length) continue;
          // Keyed off each row rather than the first one alone. Rows are built
          // from the header list so they normally agree, but a workbook that
          // has been merged or hand-edited need not be uniform, and the tag is
          // worth finding wherever it actually sits.
          for (const row of rows) {
            const key = Object.keys(row).find(
              (k) => _normHeader(k).toLowerCase() === want,
            );
            if (key === undefined) continue;
            sawColumn = true;
            const v = row[key];
            if (v !== null && v !== undefined && String(v).trim() !== "") {
              return { value: String(v).trim(), why: "found" };
            }
          }
        }
        return { value: "", why: sawColumn ? "blank" : "missing" };
      }

      // Headers that look like they were MEANT to be the tag column but do not
      // match it — "Specimen ID", "specimenID", "specimen". Compared on letters
      // and digits alone, so spacing, punctuation and case all fall away. Used
      // only to make the warning specific; nothing is matched automatically,
      // because silently accepting a column the user did not name is how a
      // whole field season ends up pooled under the wrong animal.
      function _summNearMissHeaders(workbook, fieldName) {
        // A header is only "not a near miss" if the LOOKUP would have taken
        // it. Judging that by the squashed form instead would throw away the
        // commonest case of all — "Specimen ID" squashes to the same letters
        // as "specimen_id" while the lookup rejects it, which is precisely the
        // header the user needs to be told about.
        const exact = (s) => _normHeader(s).toLowerCase();
        const squash = (s) => exact(s).replace(/[^a-z0-9]/g, "");
        const want = squash(fieldName);
        const seen = new Set();
        Object.keys(workbook).forEach((sn) => {
          const rows = workbook[sn];
          if (!rows || !rows.length) return;
          Object.keys(rows[0]).forEach((k) => {
            if (exact(k) === exact(fieldName)) return;
            const sq = squash(k);
            if (!sq) return;
            if (sq === want || sq.includes(want) || want.includes(sq))
              seen.add(_normHeader(k));
          });
        });
        return [...seen];
      }

      // Rthoptera's own exports always keep the original audio file name as
      // a prefix and append a fixed marker for what the export is — the
      // Temporal Analysis workbook gets "_temp", Spectral Analysis exports
      // get "_spec" (users sometimes rename theirs further, e.g.
      // "..._spec_trains.xlsx", to tell apart repeated exports for different
      // selection sets). Cut at the first such marker to recover the shared
      // prefix, so several exports from the same audio file collapse into ONE
      // recording instead of being counted once per file.
      //
      // Both spellings are matched: workbooks exported before the markers were
      // shortened carry "_temporal_analysis" / "_spectral_analysis", and must
      // still group with newer ones from the same recording.
      //
      // The lookahead is what keeps this honest — without it "_spec" would
      // also fire inside a word like "..._specimen_notes", truncating a name
      // that has no marker in it at all.
      function _summRecordingKey(filename) {
        const base = filename.replace(/\.[^/.]+$/, "");
        const m = base.match(
          /_temp(?:oral_analysis)?(?=_|$)|_spec(?:tral_analysis)?(?=_|$)/i,
        );
        return (m ? base.slice(0, m.index) : base).toLowerCase();
      }

      // Columns that must never be averaged, regressed or used to predict a
      // temperature. Covers the metadata tags (specimen_id/species/
      // locality/source_file), every *_id column (motif_id/train_id/
      // peak_id/seq_id — these are categorical row numbers, not counts),
      // the plain running-index columns ("selection", "n"), and the columns
      // that record WHERE something sits rather than what it sounds like.
      function _summIsCategoricalKey(k) {
        const kl = k.toLowerCase();
        if (
          kl === "source_file" ||
          kl === "temp_c" ||
          kl === "source_workbook" ||
          kl === "specimen_id" ||
          kl === "species" ||
          kl === "country" ||
          kl === "locality" ||
          kl === "selection" ||
          kl === "n" ||
          // Bookkeeping stamped onto selected rows: which position the
          // structure held inside its parent, and how many siblings it had.
          // Averaging them would report the mean ordinal of the selection,
          // which says nothing about the animal.
          kl === "sel_position" ||
          kl === "sel_group_n" ||
          // Position in the recording, not a property of the song. Averaging
          // these reports when the recorder happened to be started: roll ten
          // seconds earlier and every one of them shifts while the song is
          // identical. Excluded from the temperature fits for the same
          // reason — a lead-in time that drifts across a warming afternoon
          // correlates with temperature without being caused by it, and
          // would otherwise qualify as a thermometer.
          //
          // They stay in the per-level tables, which is where they earn
          // their place: locating a row back in the audio, and rebuilding
          // annotations from a saved table on import (_importXlsxSelections
          // reads train_start/train_end, and sheet classification keys off
          // their presence).
          kl === "peak_time" ||
          kl === "train_start" ||
          kl === "train_end" ||
          kl === "motif_start" ||
          kl === "motif_end"
        )
          return true;
        if (/_id$/.test(kl)) return true;
        // Bookkeeping on the rows the derived levels build: where a gap or a
        // syllable sits in the recording (same reasoning as the structure
        // extents above — it locates the row, it is not a property of it), and
        // which members it spans, written "1-2". Their LENGTHS are separate
        // columns (gap_ms, syl_dur_ms, …) and are averaged normally.
        if (/^(gap|syl|grp)_(start|end|between|members)$/.test(kl)) return true;
        return false;
      }

      async function summAddFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        for (const f of files) {
          try {
            const buf = new Uint8Array(await f.arrayBuffer());
            const workbook = await _readXlsx(buf);
            const sheets = {};
            Object.keys(workbook).forEach((sn) => {
              const kind = _summClassifySheet(sn, workbook[sn]);
              if (kind)
                sheets[kind] = (sheets[kind] || []).concat(workbook[sn]);
            });
            if (!Object.keys(sheets).length) {
              log(
                '"' +
                  f.name +
                  '": no recognizable Peaks/Trains/Motifs/Spectral table found — skipped.',
                "warn",
              );
              continue;
            }
            const idTag = _summFindTagField(workbook, "specimen_id");
            const fromFile = idTag.value;
            const speciesFromFile = _summFindTagField(workbook, "species").value;
            const countryFromFile = _summFindTagField(workbook, "country").value;
            const localityFromFile = _summFindTagField(workbook, "locality")
              .value;
            const idNear = _summNearMissHeaders(workbook, "specimen_id");
            const recordingKey = _summRecordingKey(f.name);
            summFilesData.push({
              id: summNextFileId++,
              name: f.name,
              recordingKey,
              // Prefer the Specimen ID tagged in the file's own data; fall
              // back to the shared recording key (original audio file name,
              // export markers stripped) when the column is missing/blank,
              // so multiple exports of the same recording default to the
              // same specimen too — editable below either way.
              specimenId: fromFile || recordingKey,
              fromData: !!fromFile,
              // Why the tag had to be guessed, for the warning on the card.
              idWhy: idTag.why,
              // The headers actually present, so a near-miss ("Specimen ID",
              // "specimenid") can be named in the warning instead of leaving
              // the user to guess what the file calls its column.
              idNear,
              species: speciesFromFile,
              country: countryFromFile,
              locality: localityFromFile,
              sheets,
            });
            // Say it out loud too. A tooltip is only found by someone who
            // already suspects something is wrong, and pooling under a guessed
            // specimen id quietly merges or splits animals.
            if (!fromFile)
              log(
                '"' +
                  f.name +
                  '": ' +
                  (idTag.why === "blank"
                    ? "specimen_id column is present but empty"
                    : "no specimen_id column found") +
                  " — using the file name instead" +
                  (idNear.length ? " (file has: " + idNear.join(", ") + ")" : "") +
                  ".",
                "warn",
              );
          } catch (err) {
            log('Could not read "' + f.name + '": ' + err.message, "err");
          }
        }
        summRenderFileList();
      }

      // What the ⚠ beside "Specimen ID" actually means for this file. The old
      // wording said "not found" for every failure, which is wrong half the
      // time and unactionable the other half: a blank column and a column
      // under another name need different things done to them.
      function _summIdTagTitle(f) {
        if (f.fromData) return "Read from the specimen_id column in this file.";
        const near =
          f.idNear && f.idNear.length
            ? "\n\nThis file does have: " +
              f.idNear.join(", ") +
              ".\nRename it to specimen_id in the workbook if that is the tag."
            : "";
        if (f.idWhy === "blank")
          return (
            "This file HAS a specimen_id column, but every row of it is empty.\n" +
            "Guessed from the file name instead — edit if wrong." +
            near
          );
        return (
          "No specimen_id column in any sheet of this file.\n" +
          "Guessed from the file name instead — edit if wrong." +
          near
        );
      }

      function summRenderFileList() {
        const wrap = $("summFileList");
        if (!summFilesData.length) {
          wrap.innerHTML =
            '<div style="color:var(--txt2);font-size:11px">No files added yet.</div>';
          $("btnSummClear").disabled = true;
          $("btnSummRun").disabled = true;
          return;
        }
        wrap.innerHTML = "";
        const keyCounts = {};
        summFilesData.forEach((f) => {
          keyCounts[f.recordingKey] = (keyCounts[f.recordingKey] || 0) + 1;
        });
        summFilesData.forEach((f) => {
          const kinds = Object.keys(f.sheets)
            .map((k) => SUMM_LABEL[k] || k)
            .join(", ");
          const siblings = keyCounts[f.recordingKey] - 1;
          const row = document.createElement("div");
          row.style.cssText =
            "display:flex;flex-direction:column;gap:2px;padding:5px;border:1px solid var(--border);border-radius:4px;background:var(--bg3)";
          row.innerHTML =
            '<div style="display:flex;align-items:center;gap:5px">' +
            '<span style="flex:1;font-size:11px;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' +
            f.name.replace(/"/g, "&quot;") +
            '">' +
            f.name +
            "</span>" +
            '<button data-remove="' +
            f.id +
            '" style="font-size:10px;padding:1px 6px">✕</button>' +
            "</div>" +
            (siblings
              ? '<div style="color:var(--txt3);font-size:10px">🔗 same recording as ' +
                siblings +
                " other file" +
                (siblings === 1 ? "" : "s") +
                "</div>"
              : "") +
            '<div style="display:flex;align-items:center;gap:4px">' +
            '<button data-copymeta="' +
            f.id +
            '" title="Copy this file\'s Specimen ID/Species/Locality" style="font-size:10px;padding:1px 6px;flex:1">📋 Copy metadata</button>' +
            '<button data-pastemeta="' +
            f.id +
            '" title="Paste the previously copied Specimen ID/Species/Locality here"' +
            (summMetaClipboard ? "" : " disabled") +
            ' style="font-size:10px;padding:1px 6px;flex:1">📥 Paste metadata</button>' +
            "</div>" +
            '<div style="display:flex;align-items:center;gap:4px">' +
            '<span style="color:var(--txt2);font-size:10px" title="' +
            _summIdTagTitle(f).replace(/"/g, "&quot;") +
            '">🏷 Specimen ID' +
            (f.fromData ? "" : " ⚠") +
            "</span>" +
            '<input data-indiv="' +
            f.id +
            '" type="text" value="' +
            f.specimenId.replace(/"/g, "&quot;") +
            '" style="flex:1;font-size:11px;padding:1px 4px" />' +
            "</div>" +
            '<div style="display:flex;align-items:center;gap:4px">' +
            '<span style="color:var(--txt2);font-size:10px;width:56px">Species</span>' +
            '<input data-species="' +
            f.id +
            '" type="text" value="' +
            (f.species || "").replace(/"/g, "&quot;") +
            '" style="flex:1;font-size:11px;padding:1px 4px" />' +
            "</div>" +
            '<div style="display:flex;align-items:center;gap:4px">' +
            '<span style="color:var(--txt2);font-size:10px;width:56px">Country</span>' +
            '<input data-country="' +
            f.id +
            '" type="text" value="' +
            (f.country || "").replace(/"/g, "&quot;") +
            '" style="flex:1;font-size:11px;padding:1px 4px" />' +
            "</div>" +
            '<div style="display:flex;align-items:center;gap:4px">' +
            '<span style="color:var(--txt2);font-size:10px;width:56px">Locality</span>' +
            '<input data-locality="' +
            f.id +
            '" type="text" value="' +
            (f.locality || "").replace(/"/g, "&quot;") +
            '" style="flex:1;font-size:11px;padding:1px 4px" />' +
            "</div>" +
            '<div style="color:var(--txt2);font-size:10px">' +
            (kinds || "no recognizable tables") +
            "</div>";
          wrap.appendChild(row);
        });
        wrap.querySelectorAll("[data-remove]").forEach((b) => {
          b.onclick = () => {
            const id = +b.dataset.remove;
            summFilesData = summFilesData.filter((f) => f.id !== id);
            summRenderFileList();
          };
        });
        wrap.querySelectorAll("[data-copymeta]").forEach((b) => {
          b.onclick = () => {
            const id = +b.dataset.copymeta;
            const f = summFilesData.find((x) => x.id === id);
            if (!f) return;
            summMetaClipboard = {
              specimenId: f.specimenId,
              species: f.species,
              country: f.country,
              locality: f.locality,
            };
            log(
              'Copied metadata from "' + f.name + '" — paste it onto other files.',
              "ok",
            );
            summRenderFileList();
          };
        });
        wrap.querySelectorAll("[data-pastemeta]").forEach((b) => {
          b.onclick = () => {
            if (!summMetaClipboard) return;
            const id = +b.dataset.pastemeta;
            const f = summFilesData.find((x) => x.id === id);
            if (!f) return;
            f.specimenId = summMetaClipboard.specimenId;
            f.fromData = true;
            f.species = summMetaClipboard.species;
            f.country = summMetaClipboard.country;
            f.locality = summMetaClipboard.locality;
            summRenderFileList();
          };
        });
        wrap.querySelectorAll("[data-indiv]").forEach((inp) => {
          inp.oninput = () => {
            const id = +inp.dataset.indiv;
            const f = summFilesData.find((x) => x.id === id);
            if (f) {
              // Manual edit is authoritative from here on — stop flagging it
              // as a filename guess even if the box is cleared back to blank.
              f.specimenId = inp.value.trim() || f.recordingKey;
              f.fromData = true;
            }
          };
        });
        wrap.querySelectorAll("[data-species]").forEach((inp) => {
          inp.oninput = () => {
            const id = +inp.dataset.species;
            const f = summFilesData.find((x) => x.id === id);
            if (f) f.species = inp.value.trim();
          };
        });
        wrap.querySelectorAll("[data-country]").forEach((inp) => {
          inp.oninput = () => {
            const id = +inp.dataset.country;
            const f = summFilesData.find((x) => x.id === id);
            if (f) f.country = inp.value.trim();
          };
        });
        wrap.querySelectorAll("[data-locality]").forEach((inp) => {
          inp.oninput = () => {
            const id = +inp.dataset.locality;
            const f = summFilesData.find((x) => x.id === id);
            if (f) f.locality = inp.value.trim();
          };
        });
        $("btnSummClear").disabled = false;
        $("btnSummRun").disabled = false;
      }

      function summClearFiles() {
        summFilesData = [];
        summRenderFileList();
        summResetResults();
      }

      // ── Structure selection panel ───────────────────────────────────────
      // The selections themselves survive a reset — they are the user's
      // analysis design, not a result of it, and are meant to be reused as
      // new recordings are added to the merge.
      function summAddSelection() {
        const id = summNextSelId++;
        summSelections.push({
          id,
          name: "Selection " + id,
          level: "train_in_motif",
          positions: "1",
          filters: "",
          // Only read by the chunk levels: a disyllabic species pairs trains
          // two at a time, from the first one.
          chunkSize: 2,
          chunkOffset: 0,
        });
        summRenderSelections();
        summComputeStats();
      }

      function summRemoveSelection(id) {
        summSelections = summSelections.filter((s) => s.id !== id);
        summRenderSelections();
        summComputeStats();
      }

      // Typing in a box re-summarizes, but must NOT rebuild the cards — the
      // input being typed into would be replaced mid-keystroke and lose focus.
      // summComputeStats only refreshes the notes, so the DOM the user is
      // editing survives. Debounced because every keystroke otherwise
      // re-groups every merged row, and the merged tables run to thousands of
      // rows on a decent field season.
      let _summSelTimer = null;
      function summSelectionsChanged() {
        clearTimeout(_summSelTimer);
        _summSelTimer = setTimeout(() => summComputeStats(), 250);
      }

      // The "matched N of M" line on each card, by selection id. Held aside so
      // it can be rewritten in place without touching the inputs around it.
      let _summSelNotes = new Map();

      function summRenderSelections() {
        const wrap = $("summSelList");
        if (!wrap) return;
        _summSelNotes = new Map();
        wrap.innerHTML = "";
        if (!summSelections.length) {
          wrap.innerHTML =
            '<div style="color:var(--txt2);font-size:11px">No selections yet — everything is summarized together.</div>';
          return;
        }
        summSelections.forEach((sel) => {
          const card = document.createElement("div");
          card.style.cssText =
            "display:flex;flex-direction:column;gap:4px;padding:5px;border:1px solid var(--border);border-radius:4px;background:var(--bg3)";

          const head = document.createElement("div");
          head.style.cssText = "display:flex;align-items:center;gap:4px";
          const nameIn = document.createElement("input");
          nameIn.type = "text";
          nameIn.value = sel.name;
          nameIn.placeholder = "Name (used for the sheet and the report)";
          nameIn.style.cssText = "flex:1;font-size:11px;min-width:0";
          nameIn.oninput = () => {
            sel.name = nameIn.value;
            summSelectionsChanged();
          };
          const del = document.createElement("button");
          del.textContent = "✕";
          del.style.cssText = "font-size:10px;padding:1px 6px";
          del.onclick = () => summRemoveSelection(sel.id);
          head.appendChild(nameIn);
          head.appendChild(del);
          card.appendChild(head);

          const lvlSel = document.createElement("select");
          lvlSel.style.cssText = "font-size:11px;width:100%";
          // Split so the sound and the silence between it are visibly two
          // different things to select, rather than ten sibling entries in one
          // list where the gap levels read as more structure levels.
          const lvlGroups = [
            ["Structures", (l) => !l.gap && !l.chunk],
            ["Gaps between structures", (l) => !!l.gap],
            ["Runs of structures (syllables)", (l) => !!l.chunk],
          ];
          lvlGroups.forEach(([groupLabel, want]) => {
            const og = document.createElement("optgroup");
            og.label = groupLabel;
            Object.keys(SUMM_SEL_LEVELS).forEach((k) => {
              if (!want(SUMM_SEL_LEVELS[k])) return;
              const o = document.createElement("option");
              o.value = k;
              o.textContent = SUMM_SEL_LEVELS[k].label;
              if (k === sel.level) o.selected = true;
              og.appendChild(o);
            });
            if (og.children.length) lvlSel.appendChild(og);
          });
          lvlSel.onchange = () => {
            sel.level = lvlSel.value;
            // The positions box means something different on a gap level, so
            // its hints are rewritten in place rather than waiting for the
            // next full render (which would take the focused input with it).
            applyPosHints();
            summSelectionsChanged();
          };
          card.appendChild(lvlSel);

          // Run size / phase, shown only for the chunk levels. Placed above
          // the positions box because it defines what a "position" counts.
          const runRow = document.createElement("div");
          runRow.style.cssText = "display:flex;align-items:center;gap:4px";
          const runLbl = document.createElement("span");
          runLbl.style.cssText = "color:var(--txt2);font-size:11px";
          const runSize = document.createElement("input");
          runSize.type = "number";
          runSize.min = "2";
          runSize.step = "1";
          runSize.value = sel.chunkSize == null ? 2 : sel.chunkSize;
          runSize.style.cssText = "width:42px;font-size:11px";
          runSize.title =
            "How many consecutive structures make one unit.\n" +
            "2 for a disyllabic species (trains 1+2, 3+4, 5+6 …),\n" +
            "3 for a trisyllabic one.";
          const runOffLbl = document.createElement("span");
          runOffLbl.textContent = "skipping";
          runOffLbl.style.cssText = "color:var(--txt2);font-size:11px";
          const runOff = document.createElement("input");
          runOff.type = "number";
          runOff.min = "0";
          runOff.step = "1";
          runOff.value = sel.chunkOffset == null ? 0 : sel.chunkOffset;
          runOff.style.cssText = "width:42px;font-size:11px";
          runOff.title =
            "How many structures to skip before the first run starts.\n" +
            "Leave at 0 unless the species opens with a lead-in stroke that\n" +
            "is not part of the first syllable — then set 1 so the pairing\n" +
            "runs 2+3, 4+5, … instead of 1+2, 3+4, …";
          runSize.oninput = () => {
            sel.chunkSize = runSize.value;
            summSelectionsChanged();
          };
          runOff.oninput = () => {
            sel.chunkOffset = runOff.value;
            summSelectionsChanged();
          };
          runRow.appendChild(runLbl);
          runRow.appendChild(runSize);
          runRow.appendChild(runOffLbl);
          runRow.appendChild(runOff);
          card.appendChild(runRow);

          const posRow = document.createElement("div");
          posRow.style.cssText = "display:flex;align-items:center;gap:4px";
          const posLbl = document.createElement("span");
          posLbl.style.cssText = "color:var(--txt2);font-size:11px";
          const posIn = document.createElement("input");
          posIn.type = "text";
          posIn.value = sel.positions;
          posIn.style.cssText = "flex:1;font-size:11px;min-width:0";
          // Rewrites the label, placeholder and tooltip for whichever level is
          // currently chosen. Defined here so the level's onchange above can
          // call it; called once below for the initial state.
          function applyPosHints() {
            const lvl = SUMM_SEL_LEVELS[sel.level];
            runRow.style.display = lvl && lvl.chunk ? "flex" : "none";
            if (lvl && lvl.chunk) {
              runLbl.textContent = "runs of";
              runOffLbl.textContent = lvl.chunk.of + "s, skipping";
              posLbl.textContent = "at";
              posIn.placeholder = "all · 1 · odd · 1-3 · -1";
              posIn.title =
                `Which ${lvl.unit}, counted from 1 inside each ${lvl.parent}.\n` +
                `Runs are formed first, then numbered: with runs of 2, ${lvl.unit} 2\n` +
                `is made of ${lvl.chunk.of}s 3 and 4.\n\n` +
                `all or blank     every ${lvl.unit} (the usual choice)\n` +
                "1            only the first\n" +
                "odd, even    every other one\n" +
                "1-3 / 2-n    a range, n meaning the last\n" +
                "-1           the last\n" +
                "first, last, every 2 from 1";
              return;
            }
            if (lvl && lvl.gap) {
              posLbl.textContent = "gap";
              posIn.placeholder = "1-2, 3-4, 5-6 · odd · first · -1";
              posIn.title =
                `Which gap, counted from 1 inside each ${lvl.parent}.\n` +
                `A ${lvl.parent} holding k ${lvl.gap.of}s has k-1 gaps;\n` +
                `gap i lies between ${lvl.gap.of} i and ${lvl.gap.of} i+1.\n\n` +
                "1-2          the gap between the 1st and 2nd\n" +
                "1-2, 3-4, 5-6    those three gaps (the intra-syllable set)\n" +
                "odd / even   every other gap — odd is the same set as above\n" +
                "3            gap 3, i.e. between the 3rd and 4th\n" +
                "2..4 / 2..n  a RANGE of gaps (note the two dots)\n" +
                "-1           the last gap\n" +
                "first, last, every 2 from 1\n" +
                "all or blank     every gap";
              return;
            }
            posLbl.textContent = "at";
            posIn.placeholder = "1,3,5 · first · odd · 2-n · -1";
            posIn.title =
              "Position inside the parent structure, counted from 1.\n" +
              "3            the third\n" +
              "1,3,5        a list\n" +
              "2-4 / 2-n    a range, n meaning the last\n" +
              "-1           the last, -2 the one before it\n" +
              "first, last, odd, even\n" +
              "every 2 from 1   every second, starting at the first\n" +
              "all or blank     no positional restriction";
          }
          applyPosHints();
          posIn.oninput = () => {
            sel.positions = posIn.value;
            summSelectionsChanged();
          };
          posRow.appendChild(posLbl);
          posRow.appendChild(posIn);
          card.appendChild(posRow);

          const fltIn = document.createElement("input");
          fltIn.type = "text";
          fltIn.value = sel.filters;
          fltIn.placeholder = "where… n_peaks >= 3; train_dur_ms > 20";
          fltIn.title =
            "Optional conditions on the measured columns, separated by ';'.\n" +
            "Use >, >=, <, <=, = and != — for example n_peaks >= 3.\n" +
            "Conditions narrow the rows the positions already picked; they\n" +
            "never change which position a structure holds.\n\n" +
            "On a gap level the condition is read against the structure the\n" +
            "gap follows, with all of its columns — so both train_gap_ms > 5\n" +
            "and n_peaks >= 3 work.";
          fltIn.style.cssText = "font-size:11px;width:100%;box-sizing:border-box";
          fltIn.oninput = () => {
            sel.filters = fltIn.value;
            summSelectionsChanged();
          };
          card.appendChild(fltIn);

          const note = document.createElement("div");
          note.style.cssText = "font-size:10px;line-height:1.3";
          _summSelNotes.set(sel.id, note);
          card.appendChild(note);
          wrap.appendChild(card);
        });
        summUpdateSelNotes();
      }

      // Rewrite each card's status line from the last resolved results.
      // Separate from summRenderSelections so it can run on every keystroke
      // without rebuilding the inputs.
      function summUpdateSelNotes() {
        if (!_summSelNotes.size) return;
        // Resolve here only when nothing has resolved them yet (the panel is
        // being drawn outside a summarize pass); summComputeStats resolves
        // first and stores per-selection stats on the results, which
        // re-resolving would throw away.
        const inSync =
          summSelResults.length === summSelections.length &&
          summSelResults.every((r, i) => r.sel === summSelections[i]);
        const resolved = !summMerged
          ? []
          : inSync
            ? summSelResults
            : summResolveSelections();
        summSelections.forEach((sel, i) => {
          const note = _summSelNotes.get(sel.id);
          if (!note) return;
          const res = resolved[i];
          if (!summMerged) {
            note.style.color = "var(--txt3)";
            note.textContent = "Merge & Summarize to see what this matches.";
          } else if (!res || !res.ok) {
            note.style.color = "#e06c75";
            note.textContent = (res && res.err) || "Could not read this rule.";
          } else if (!res.rows.length) {
            note.style.color = "var(--txt3)";
            note.textContent =
              res.note ||
              "Matched nothing — " +
                summSelDescribe(sel, res) +
                " selects no rows.";
          } else {
            note.style.color = "var(--txt2)";
            const lvl = SUMM_SEL_LEVELS[sel.level];
            note.textContent =
              res.rows.length +
              " of " +
              res.nBefore +
              " " +
              lvl.unit +
              "s, across " +
              res.nGroups +
              " " +
              lvl.parent +
              (res.nGroups === 1 ? "" : "s") +
              "." +
              // Never let an incomplete run vanish quietly — the reader needs
              // to know a tail was left out before quoting the mean.
              (res.dropped
                ? " " +
                  res.dropped +
                  " " +
                  lvl.chunk.of +
                  (res.dropped === 1 ? "" : "s") +
                  " left over (no complete run)."
                : "");
          }
        });
      }

      function summResetResults() {
        summMerged = null;
        summStatsRows = null;
        summSelResults = [];
        summIndividuals = [];
        summNRecordings = 0;
        summReportEdited = false;
        summRenderSelections();
        $("summCards").innerHTML =
          '<div style="color:var(--txt2);font-size:11px">Add files and click Merge &amp; Summarize to see pooled counts and per-metric mean ± SD here.</div>';
        $("summTableHead").innerHTML = "";
        $("summTableBody").innerHTML = "";
        $("summReportText").value = "";
        $("summStatus").textContent = "";
        $("btnSummSaveXlsx").disabled = true;
        $("btnSummSaveReport").disabled = true;
      }

      function summRun() {
        if (!summFilesData.length) {
          log("Add at least one Excel file first.", "warn");
          return;
        }
        // Several files (Temporal Analysis, Spectral Analysis exported per
        // selection set, etc.) commonly cover the SAME recording — count
        // distinct recording keys, not files, or re-importing Trains and
        // Motifs spectral exports for one audio file would look like 2+
        // recordings.
        const nRecordings = new Set(
          summFilesData.map((f) => f.recordingKey),
        ).size;
        // A row's own tag value (specimen_id/species/locality, tagged at
        // export time) wins; only fall back to this file's editable field
        // when the column is missing or blank — the "fill it in here" path.
        const TAG_FIELDS = [
          ["specimen_id", "specimenId"],
          ["species", "species"],
          ["country", "country"],
          ["locality", "locality"],
        ];
        const merged = { peaks: [], trains: [], motifs: [], motseq: [], spectral: [] };
        summFilesData.forEach((f) => {
          SUMM_CATS.forEach((cat) => {
            const rows = f.sheets[cat];
            if (!rows || !rows.length) return;
            rows.forEach((r) => {
              const rest = Object.assign({}, r);
              const tags = {};
              TAG_FIELDS.forEach(([col, fileField]) => {
                const rowKey = Object.keys(rest).find(
                  (k) => k.toLowerCase() === col,
                );
                const rowVal = rowKey ? String(rest[rowKey] ?? "").trim() : "";
                if (rowKey) delete rest[rowKey];
                tags[col] = rowVal || f[fileField] || "";
              });
              merged[cat].push(
                Object.assign(
                  {
                    specimen_id: tags.specimen_id,
                    species: tags.species,
                    country: tags.country,
                    locality: tags.locality,
                    // The WORKBOOK this row was read from. Distinct from
                    // source_file, which the exports now carry and which names
                    // the AUDIO. Keeping them apart matters because `rest` is
                    // merged over these defaults: a row from a newer export
                    // would otherwise overwrite this with its audio filename,
                    // and one column would mean the workbook for old files and
                    // the recording for new ones.
                    source_workbook: f.name,
                  },
                  rest,
                ),
              );
            });
          });
        });
        summMerged = merged;

        // Individuals are counted from the actual per-row specimen_id
        // (post fallback above), not guessed from file names — this is
        // what makes the count correct even when several files share one
        // specimen, or a Specimen ID was corrected in the file list.
        const individuals = [
          ...new Set(
            SUMM_CATS.flatMap((cat) => merged[cat].map((r) => r.specimen_id)).filter(
              (v) => v,
            ),
          ),
        ];
        summIndividuals = individuals;
        summNRecordings = nRecordings;
        summReportEdited = false;
        summComputeStats();

        $("btnSummSaveXlsx").disabled = false;
        $("btnSummSaveReport").disabled = false;
        $("summStatus").textContent =
          summFilesData.length +
          " file(s) → " +
          nRecordings +
          " recording(s), " +
          merged.peaks.length +
          " peaks, " +
          merged.trains.length +
          " trains, " +
          merged.motifs.length +
          " motifs merged.";
        log(
          "Summarize: merged " + summFilesData.length + " file(s).",
          "ok",
        );
      }

      // Everything downstream of the merge: pooled stats, one stats block per
      // structure selection, then the cards, table and drafted report. Split
      // out of summRun so editing a selection re-summarizes in place instead
      // of forcing every workbook to be read again.
      function summComputeStats() {
        if (!summMerged) return;
        const stats = [];
        SUMM_CATS.forEach((cat) => {
          stats.push(
            ..._summStatsBlock(
              summMerged[cat],
              SUMM_LABEL[cat],
              summIndividuals,
              SUMM_SEL_ALL,
            ),
          );
        });
        summResolveSelections().forEach((res) => {
          if (!res.ok || !res.rows.length) return;
          // Kept on the result rather than looked up later by name: two
          // selections may legitimately carry the same name, and filtering
          // the pooled list by that name would give each of them the other's
          // rows as well.
          res.stats = _summStatsBlock(
            res.rows,
            SUMM_LABEL[res.cat],
            summIndividuals,
            res.sel.name,
          );
          stats.push(...res.stats);
        });

        // Each selection is refitted on its own rows rather than borrowing the
        // pooled slope — the same reasoning the workbook's per-selection
        // temperature sheets use: opening and closing strokes need not respond
        // to temperature at the same rate.
        const adjT = _summAdjTarget();
        if (adjT !== null) {
          SUMM_CATS.forEach((cat) =>
            _summAttachAdjusted(
              stats,
              summMerged[cat],
              SUMM_LABEL[cat],
              summIndividuals,
              SUMM_SEL_ALL,
              adjT,
            ),
          );
          summSelResults.forEach((res) => {
            if (!res.ok || !res.rows.length) return;
            _summAttachAdjusted(
              stats,
              res.rows,
              SUMM_LABEL[res.cat],
              summIndividuals,
              res.sel.name,
              adjT,
            );
          });
        }
        summStatsRows = stats;

        summUpdateTempNote();
        summRenderCards(summMerged, summIndividuals, summNRecordings);
        summRenderTable(stats);
        summUpdateSelNotes();
        // Re-drafting on every selection edit would throw away the user's own
        // wording, so the draft is only (re)written while the box is still
        // untouched. A fresh merge clears the flag and drafts again.
        if (!summReportEdited)
          $("summReportText").value = summBuildReportParagraphs(
            summMerged,
            summIndividuals,
            summNRecordings,
          ).join("\n\n");
      }

      function summRenderCards(merged, individuals, nRecordings) {
        const speciesN = new Set(
          SUMM_CATS.flatMap((cat) => merged[cat].map((r) => r.species)).filter(
            (v) => v,
          ),
        ).size;
        const localityN = new Set(
          SUMM_CATS.flatMap((cat) => merged[cat].map((r) => r.locality)).filter(
            (v) => v,
          ),
        ).size;
        const cards = [
          { lbl: "Recordings", v: nRecordings },
          { lbl: "Individuals", v: individuals.length },
          { lbl: "Peaks", v: merged.peaks.length },
          { lbl: "Trains", v: merged.trains.length },
          { lbl: "Motifs", v: merged.motifs.length },
        ];
        if (speciesN) cards.push({ lbl: "Species", v: speciesN });
        if (localityN) cards.push({ lbl: "Localities", v: localityN });
        if (merged.motseq.length)
          cards.push({ lbl: "Motif Seqs", v: merged.motseq.length });
        if (merged.spectral.length)
          cards.push({ lbl: "Spectral rows", v: merged.spectral.length });
        const pooledMean = (cat, key, digits) => {
          const row = summStatsRows.find(
            (s) =>
              s.selection === SUMM_SEL_ALL &&
              s.category === SUMM_LABEL[cat] &&
              s.specimen_id === "ALL" &&
              s.metric === key,
          );
          return row ? row.mean.toFixed(digits) + " ± " + row.sd.toFixed(digits) : null;
        };
        const rate = pooledMean("trains", "peak_rate_pps", 2);
        if (rate) cards.push({ lbl: "Peak rate (peaks/s)", v: rate });
        const pf = pooledMean("spectral", "peak_freq_khz", 3);
        if (pf) cards.push({ lbl: "Peak freq (kHz)", v: pf });
        const bw = pooledMean("spectral", "bw_20db_khz", 3);
        if (bw) cards.push({ lbl: "BW -20dB (kHz)", v: bw });

        const el = $("summCards");
        el.innerHTML = "";
        el.style.cssText =
          "display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:4px";
        cards.forEach((c) => {
          const d = document.createElement("div");
          d.className = "scard";
          d.innerHTML =
            '<div class="sv">' + c.v + '</div><div class="sl">' + c.lbl + "</div>";
          el.appendChild(d);
        });
      }

      function summRenderTable(stats) {
        const head = $("summTableHead");
        const body = $("summTableBody");
        const cols = [
          "selection",
          "category",
          "specimen_id",
          "metric",
          "n",
          "mean",
          "sd",
          "min",
          "max",
        ];
        const labels = {
          selection: "Selection",
          category: "Category",
          specimen_id: "Specimen ID",
          metric: "Metric",
          n: "N",
          mean: "Mean",
          sd: "SD",
          min: "Min",
          max: "Max",
        };
        // The corrected columns appear only when the correction is on AND
        // something was actually fitted, so an empty pair of columns never
        // implies a fit that did not happen. adj_n is shown beside them
        // because it is usually smaller than N — recordings without a
        // temperature cannot be corrected and drop out.
        const adjT = _summAdjTarget();
        if (adjT !== null && (stats || []).some((s) => s.adj_mean != null)) {
          cols.push("adj_n", "adj_mean", "adj_sd");
          labels.adj_n = "N @" + adjT + "°C";
          labels.adj_mean = "Mean @" + adjT + "°C";
          labels.adj_sd = "SD @" + adjT + "°C";
        }
        head.innerHTML = "";
        cols.forEach((c) => {
          const th = document.createElement("th");
          th.textContent = labels[c];
          head.appendChild(th);
        });
        body.innerHTML = "";
        if (!stats || !stats.length) return;
        stats.forEach((row) => {
          const tr = document.createElement("tr");
          cols.forEach((c) => {
            const td = document.createElement("td");
            td.textContent =
              row[c] !== null && row[c] !== undefined ? row[c] : "—";
            tr.appendChild(td);
          });
          body.appendChild(tr);
        });
      }

      // Cross-recording narrative — pooled headline stats first, then a
      // one-liner per individual (only if more than one is present).
      function summBuildReportParagraphs(merged, individuals, nRecordings) {
        const paras = [];
        const nInd = individuals.length;
        paras.push(
          "This summary pools " +
            nRecordings +
            " recording" +
            (nRecordings === 1 ? "" : "s") +
            (nInd > 1 ? " from " + nInd + " individuals" : "") +
            ", totaling " +
            merged.peaks.length +
            " peaks across " +
            merged.trains.length +
            " trains and " +
            merged.motifs.length +
            " motifs.",
        );

        // Stated up front, and unconditionally, because a song description
        // without the temperature it was measured at is not interpretable —
        // rates and periods in these animals move with it. The per-recording
        // lines below repeat it individually, but they only appear once more
        // than one recording is merged, so this is what covers the single
        // recording case.
        {
          const temps = summTempsAvailable(merged);
          const noTemp = summRecordingsMissingTemp(merged).size;
          if (temps.length === 1 && !noTemp) {
            paras.push("All recordings were made at " + temps[0] + " °C.");
          } else if (temps.length) {
            paras.push(
              "Recording temperatures ranged from " +
                temps[0] +
                " to " +
                temps[temps.length - 1] +
                " °C (" +
                temps.join(", ") +
                ")" +
                (noTemp
                  ? "; " +
                    noTemp +
                    " recording" +
                    (noTemp === 1 ? " carries" : "s carry") +
                    " no temperature"
                  : "") +
                ".",
            );
          } else {
            paras.push(
              "No recording temperature was noted, so the values below cannot " +
                "be compared against measurements made at another temperature.",
            );
          }
        }

        const statFor = (cat, key) =>
          summStatsRows.find(
            (s) =>
              s.selection === SUMM_SEL_ALL &&
              s.category === SUMM_LABEL[cat] &&
              s.specimen_id === "ALL" &&
              s.metric === key,
          );
        // Observed value first, always. The corrected one follows in brackets
        // where a fit exists, so a reader can see both and the report can
        // never quote a corrected number without saying it is corrected.
        const adjT = _summAdjTarget();
        const pm = (s, d) => {
          if (!s) return null;
          const base = s.mean.toFixed(d) + " ± " + s.sd.toFixed(d);
          if (adjT === null || s.adj_mean == null) return base;
          return (
            base +
            " [" +
            s.adj_mean.toFixed(d) +
            " ± " +
            s.adj_sd.toFixed(d) +
            " at " +
            adjT +
            " °C]"
          );
        };

        // Stated before any number is quoted. A corrected value that appears
        // without its target temperature, its method and the range it was
        // fitted over is not reportable, and this paragraph is what makes the
        // bracketed figures downstream mean something on the page.
        if (adjT !== null) {
          const temps = summTempsAvailable(merged);
          const anyAdj = (summStatsRows || []).some((s) => s.adj_mean != null);
          if (!anyAdj) {
            paras.push(
              "Temperature correction to " +
                adjT +
                " °C was requested but no metric could be fitted" +
                (temps.length < 2
                  ? " — a slope needs recordings at two or more temperatures, and " +
                    (temps.length === 1
                      ? "only " + temps[0] + " °C is present"
                      : "none carry a temperature")
                  : " to the temperatures available (" +
                    temps.join(", ") +
                    " °C)") +
                ". All values below are as observed.",
            );
          } else {
            const lo = temps[0];
            const hi = temps[temps.length - 1];
            paras.push(
              "Values are given as observed, followed in brackets by the same " +
                "measurement expressed at " +
                adjT +
                " °C. The correction fits each metric against recording " +
                "temperature by least squares, one observation per recording, " +
                "and shifts every value along that line. Only metrics whose " +
                "thermal response is statistically supported (r² ≥ 0.25 and " +
                "significant at p < 0.05) are corrected; the rest carry no " +
                "bracketed figure, and the workbook's Temp_Regression sheet " +
                "gives the slope and r² behind each one. Recordings were made " +
                "between " +
                lo +
                " and " +
                hi +
                " °C" +
                (adjT < lo || adjT > hi
                  ? ", so " +
                    adjT +
                    " °C lies outside the range actually observed and the " +
                    "corrected values are extrapolations"
                  : "") +
                ". Only observations carrying a temperature contribute to the " +
                "corrected figures, so their N can be smaller than the " +
                "observed N.",
            );
          }
        }

        // "Peak frequency" in the conventional sense: the maximum of the
        // structure's own power spectrum. peak_freq_pmean_khz — the mean of
        // the per-PEAK carriers — is the fallback for workbooks exported
        // before the spectral columns were added to the temporal tables, and
        // is a different quantity, so it is only used when the real one is
        // absent rather than mixed in beside it.
        const pfStat = (cat) =>
          statFor(cat, "peak_freq_khz") || statFor(cat, "peak_freq_pmean_khz");

        const rate = statFor("trains", "peak_rate_pps");
        const meanAmp = statFor("trains", "mean_amp");
        const trainDur = statFor("trains", "train_dur_ms");
        const trainGap = statFor("trains", "train_gap_ms");
        const trainPf = pfStat("trains");
        const trainBw = statFor("trains", "bw_20db_khz");
        const bits = [];
        if (rate)
          bits.push("a mean peak rate of " + pm(rate, 2) + " peaks/s");
        if (trainDur)
          bits.push("a mean train duration of " + pm(trainDur, 1) + " ms");
        if (meanAmp)
          bits.push("a mean amplitude of " + pm(meanAmp, 3) + " (normalized)");
        if (trainGap)
          bits.push("a mean gap between trains of " + pm(trainGap, 1) + " ms");
        if (trainPf)
          bits.push("a mean peak frequency of " + pm(trainPf, 3) + " kHz");
        if (trainBw)
          bits.push("a mean -20 dB bandwidth of " + pm(trainBw, 3) + " kHz");
        if (bits.length)
          paras.push(
            "Across all trains, recordings showed " + bits.join("; ") + ".",
          );

        if (merged.motifs.length) {
          const mDur = statFor("motifs", "motif_dur_s");
          const mGap = statFor("motifs", "motif_gap_s");
          const duty = statFor("motifs", "duty_cycle_pct");
          // Workbooks exported before the index was split carry a single
          // "pci" column; treat it as the syllable-based one, which is what
          // it was.
          const pciSyl =
            statFor("motifs", "pci_syl") || statFor("motifs", "pci");
          const pciAgn = statFor("motifs", "pci_agn");
          const temExc = statFor("motifs", "tem_exc_mean");
          const dynExc = statFor("motifs", "dyn_exc_mean");
          const mbits = [];
          if (mDur) mbits.push("a mean duration of " + pm(mDur, 2) + " s");
          if (mGap)
            mbits.push(
              "a mean gap between motifs of " + pm(mGap, 2) + " s",
            );
          if (duty) mbits.push("a mean duty cycle of " + pm(duty, 1) + " %");
          if (pciSyl)
            mbits.push(
              "a mean syllable-based Pattern Complexity Index (PCI-syl) of " +
                pm(pciSyl, 3),
            );
          if (pciAgn)
            mbits.push(
              "a mean behaviour-agnostic Pattern Complexity Index (PCI-agn) of " +
                pm(pciAgn, 3),
            );
          if (temExc)
            mbits.push("a mean temporal excursion of " + pm(temExc, 2));
          if (dynExc)
            mbits.push("a mean dynamic excursion of " + pm(dynExc, 2));
          const mPf = pfStat("motifs");
          const mBw = statFor("motifs", "bw_20db_khz");
          if (mPf)
            mbits.push("a mean peak frequency of " + pm(mPf, 3) + " kHz");
          if (mBw)
            mbits.push("a mean -20 dB bandwidth of " + pm(mBw, 3) + " kHz");
          if (mbits.length)
            paras.push(
              "Across all motifs (n=" +
                merged.motifs.length +
                "), recordings showed " +
                mbits.join("; ") +
                ".",
            );
        }

        if (merged.spectral.length) {
          const pf = statFor("spectral", "peak_freq_khz");
          const bw20 = statFor("spectral", "bw_20db_khz");
          const cent = statFor("spectral", "spec_centroid_khz");
          const sbits = [];
          if (pf) sbits.push("a peak frequency of " + pm(pf, 3) + " kHz");
          if (bw20)
            sbits.push("a -20 dB bandwidth of " + pm(bw20, 3) + " kHz");
          if (cent)
            sbits.push("a spectral centroid of " + pm(cent, 3) + " kHz");
          if (sbits.length)
            paras.push(
              "Pooled spectral measurements (n=" +
                merged.spectral.length +
                ") had " +
                sbits.join("; ") +
                ".",
            );
        }

        if (nInd > 1) {
          individuals.forEach((ind) => {
            const indRows = merged.trains.filter((r) => r.specimen_id === ind);
            if (!indRows.length) return;
            const indStat = (metric) =>
              summStatsRows.find(
                (s) =>
                  s.selection === SUMM_SEL_ALL &&
                  s.category === "Trains" &&
                  s.specimen_id === ind &&
                  s.metric === metric,
              );
            const s = indStat("peak_rate_pps");
            const pf = indStat("peak_freq_khz") || indStat("peak_freq_pmean_khz");
            const ibits = [];
            if (s) ibits.push("mean peak rate " + pm(s, 2) + " peaks/s");
            if (pf) ibits.push("mean peak frequency " + pm(pf, 3) + " kHz");
            if (ibits.length)
              paras.push(
                ind +
                  ": " +
                  indRows.length +
                  " trains, " +
                  ibits.join(", ") +
                  ".",
              );
          });
        }

        // One line per recording. Temperature belongs here and nowhere else:
        // it is a property of the recording, so a per-specimen line cannot
        // state it once an animal has been recorded twice at different
        // temperatures. Values are as observed — the whole point of naming a
        // recording's temperature is to show the conditions the raw numbers
        // came from, which a corrected figure would erase.
        const recKeys = [];
        const recOf = new Map();
        merged.trains.forEach((r) => {
          const k = _summRecKey(r);
          if (!recOf.has(k)) {
            recOf.set(k, []);
            recKeys.push(k);
          }
          recOf.get(k).push(r);
        });
        if (recKeys.length > 1) {
          recKeys.forEach((k) => {
            const rows = recOf.get(k);
            const rate = _summMeanSd(rows, "peak_rate_pps");
            const pf =
              _summMeanSd(rows, "peak_freq_khz") ||
              _summMeanSd(rows, "peak_freq_pmean_khz");
            const temps = [
              ...new Set(
                rows
                  .map((r) => parseFloat(r.temp_c))
                  .filter((t) => isFinite(t)),
              ),
            ];
            const spec = rows[0].specimen_id;
            const rbits = [];
            if (temps.length)
              rbits.push(
                "recorded at " +
                  temps.join(", ") +
                  " °C",
              );
            rbits.push(rows.length + " trains");
            if (rate)
              rbits.push(
                "mean peak rate " +
                  rate.mean.toFixed(2) +
                  " ± " +
                  rate.sd.toFixed(2) +
                  " peaks/s",
              );
            if (pf)
              rbits.push(
                "mean peak frequency " +
                  pf.mean.toFixed(3) +
                  " ± " +
                  pf.sd.toFixed(3) +
                  " kHz",
              );
            paras.push(
              k +
                (spec ? " (" + spec + ")" : "") +
                ": " +
                rbits.join(", ") +
                (temps.length ? "" : "; no temperature recorded") +
                ".",
            );
          });
        }

        // One paragraph per structure selection. Stated as a rule plus its
        // headline numbers, because "the first train of each echeme" only
        // means something in a paper if the rule that produced it is on the
        // page beside the values.
        summSelResults.forEach((res) => {
          if (!res.ok || !res.rows.length) return;
          const lvl = SUMM_SEL_LEVELS[res.sel.level];
          const selStat = (key) =>
            summStatsRows.find(
              (s) =>
                s.selection === res.sel.name &&
                s.specimen_id === "ALL" &&
                s.metric === key,
            );
          // Which metrics are worth naming depends on the structure; these
          // are the same headline measures the pooled paragraphs use. Gap
          // levels name only their gap measures — every candidate is listed
          // because selStat drops the ones this level does not carry.
          const wanted = lvl.chunk
            ? [
                [lvl.chunk.prefix + "_dur_" + lvl.chunk.outSuffix, "a mean duration of", lvl.chunk.outSuffix, 1],
                [lvl.chunk.prefix + "_sound_" + lvl.chunk.outSuffix, "of which sound", lvl.chunk.outSuffix, 1],
                [lvl.chunk.prefix + "_silence_" + lvl.chunk.outSuffix, "and silence", lvl.chunk.outSuffix, 1],
                [lvl.chunk.prefix + "_duty_pct", "a mean duty cycle of", "%", 1],
                [lvl.chunk.prefix + "_gap_" + lvl.chunk.outSuffix, "a mean gap to the next of", lvl.chunk.outSuffix, 1],
                [lvl.chunk.prefix + "_period_" + lvl.chunk.outSuffix, "a mean period of", lvl.chunk.outSuffix, 1],
                [lvl.chunk.prefix + "_n_peaks", "a mean of", "peaks", 1],
                [lvl.chunk.prefix + "_peak_freq_pmean_khz", "a mean carrier frequency of", "kHz", 3],
              ]
            : lvl.gap
            ? [
                ["train_gap_ms", "a mean gap of", "ms", 1],
                ["train_period_ms", "a mean train period of", "ms", 1],
                ["peak_period_ms", "a mean interval of", "ms", 2],
                ["motif_gap_s", "a mean gap of", "s", 2],
                ["motif_period_s", "a mean echeme period of", "s", 2],
                ["seq_gap_s", "a mean gap of", "s", 2],
              ]
            : res.cat === "trains"
              ? [
                  ["train_dur_ms", "a mean duration of", "ms", 1],
                  ["peak_rate_pps", "a mean peak rate of", "peaks/s", 2],
                  ["train_gap_ms", "a mean gap to the next train of", "ms", 1],
                  ["peak_freq_pmean_khz", "a mean carrier frequency of", "kHz", 3],
                ]
              : res.cat === "motifs"
                ? [
                    ["motif_dur_s", "a mean duration of", "s", 2],
                    ["n_trains", "a mean of", "trains", 1],
                    ["duty_cycle_pct", "a mean duty cycle of", "%", 1],
                    ["peak_freq_pmean_khz", "a mean carrier frequency of", "kHz", 3],
                  ]
                : res.cat === "peaks"
                  ? [
                      ["peak_period_ms", "a mean period of", "ms", 2],
                      ["peak_freq_khz", "a mean carrier frequency of", "kHz", 3],
                      ["peak_amp", "a mean amplitude of", "(normalized)", 3],
                    ]
                  : [
                      ["seq_dur_s", "a mean duration of", "s", 2],
                      ["n_motifs", "a mean of", "motifs", 1],
                    ];
          const bits = [];
          wanted.forEach(([key, lead, unit, d]) => {
            const s = selStat(key);
            if (s) bits.push(lead + " " + pm(s, d) + " " + unit);
          });
          paras.push(
            '"' +
              res.sel.name +
              '" selects ' +
              summSelDescribe(res.sel, res) +
              " (" +
              res.rows.length +
              " of " +
              res.nBefore +
              " " +
              // A gap selection is drawn from the gaps, not from the structure
              // rows they were derived from, and the count must say so — "5 of
              // 8 trains rows" would be the wrong denominator named twice over.
              (lvl.gap || lvl.chunk
                ? lvl.unit + "s"
                : SUMM_LABEL[res.cat].toLowerCase() + " rows") +
              ", across " +
              res.nGroups +
              " " +
              lvl.parent +
              (res.nGroups === 1 ? "" : "s") +
              ")" +
              (bits.length ? ", showing " + bits.join("; ") : "") +
              ".",
          );
        });

        return paras;
      }

      // "<species>_<locality>", all lowercase and filesystem-safe — shared by
      // the merged workbook and the text report so both exports are tagged
      // with what was actually pooled. Falls back to "multi_..." when the
      // files span more than one value, or "unknown_..." when the tag was
      // never filled in anywhere.
      function _summFilenameStub() {
        const speciesSet = new Set(
          SUMM_CATS.flatMap((cat) => summMerged[cat].map((r) => r.species)).filter(
            Boolean,
          ),
        );
        const localitySet = new Set(
          SUMM_CATS.flatMap((cat) => summMerged[cat].map((r) => r.locality)).filter(
            Boolean,
          ),
        );
        const speciesTag =
          speciesSet.size === 1
            ? [...speciesSet][0]
            : speciesSet.size > 1
              ? "multi_species"
              : "unknown_species";
        const localityTag =
          localitySet.size === 1
            ? [...localitySet][0]
            : localitySet.size > 1
              ? "multi_locality"
              : "unknown_locality";
        const safe = (s) =>
          String(s)
            .trim()
            .toLowerCase()
            .replace(/[\\/:*?"<>|]+/g, "")
            .replace(/\s+/g, "_");
        return safe(speciesTag) + "_" + safe(localityTag);
      }

      // YYYYMMDD_HHMM from the machine's local clock (not UTC), so the
      // stamp matches the time the user actually saved at.
      function _summStamp() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return (
          now.getFullYear() +
          pad(now.getMonth() + 1) +
          pad(now.getDate()) +
          "_" +
          pad(now.getHours()) +
          pad(now.getMinutes())
        );
      }

      // ── Publication-ready strings (Excel formulas, not baked text) ──────
      // The Summary and per-selection stats sheets carry their mean/sd/min/max
      // under exactly those names, so the shared builder below can find them.
      // The two extra columns are live formulas, not frozen text, so editing a
      // value updates the string.
      // ── Temperature-corrected companions to the statistics ──────────────
      // The target temperature used to matter only at workbook-save time, so
      // the checkbox looked inert and, worse, the text report and the workbook
      // could quote different numbers for the same merge without either saying
      // which. These three feed one adjusted mean/SD alongside every observed
      // one, so the table and the report read from the same place the
      // Temp_Regression sheet does.

      // The target, or null when the correction is off or the box is empty.
      function _summAdjTarget() {
        const on = $("summRegressOn") && $("summRegressOn").checked;
        if (!on) return null;
        const t = parseFloat($("summRegressTemp") && $("summRegressTemp").value);
        return isFinite(t) ? t : null;
      }

      // Copies of `rows` with every fitted metric expressed at targetT.
      //
      // Rows with no temperature are dropped rather than passed through
      // unchanged: leaving them in would mix raw and corrected values in one
      // mean, which is the exact error the correction exists to remove. That
      // makes the adjusted N smaller than the observed N whenever some
      // recordings lack a reading, and the report says so.
      //
      // Metrics with no usable fit are simply absent from the copies, so they
      // report an observed value and no adjusted one instead of an
      // unadjusted number dressed up as corrected.
      function _summAdjustRows(rows, targetT) {
        if (!rows || !rows.length) return [];
        const keys = new Set();
        rows.forEach((r) =>
          Object.keys(r).forEach((k) => {
            if (!_summIsCategoricalKey(k)) keys.add(k);
          }),
        );
        const fits = new Map();
        keys.forEach((k) => {
          const fit = _summFitTemp(
            _summByRecording(rows, k).map(({ t, v }) => ({ t, v })),
          );
          // A line can be drawn through almost anything; that does not make it
          // a thermal response. Without this gate a flat metric such as
          // bandwidth acquires a zero slope, and the report prints
          // "2.600 [2.600 at 25 °C]" — a corrected figure identical to the
          // observed one, which reads as though temperature had been
          // accounted for when nothing was. Same significance test the song
          // thermometer uses, for the same reason.
          if (fit && _tempCalibUsable(fit.r2, fit.n)) fits.set(k, fit);
        });
        if (!fits.size) return [];
        const out = [];
        rows.forEach((r) => {
          const t = parseFloat(r.temp_c);
          if (!isFinite(t)) return;
          const o = {};
          Object.keys(r).forEach((k) => {
            if (_summIsCategoricalKey(k)) o[k] = r[k];
          });
          fits.forEach((fit, k) => {
            const v = r[k];
            if (typeof v === "number" && isFinite(v))
              o[k] = v + fit.slope * (targetT - t);
          });
          out.push(o);
        });
        return out;
      }

      // Stamp adj_mean/adj_sd onto the statistics for one (selection,
      // category) block, matched per specimen and per metric so the per-animal
      // rows are corrected too — not just the pooled ones.
      function _summAttachAdjusted(
        statsRows,
        rows,
        catLabel,
        individuals,
        selection,
        targetT,
      ) {
        const adjRows = _summAdjustRows(rows, targetT);
        if (!adjRows.length) return;
        const byKey = new Map();
        _summStatsBlock(adjRows, catLabel, individuals, selection).forEach((a) =>
          byKey.set(a.specimen_id + "" + a.metric, a),
        );
        statsRows.forEach((s) => {
          if (s.selection !== selection || s.category !== catLabel) return;
          const a = byKey.get(s.specimen_id + "" + s.metric);
          if (!a) return;
          s.adj_mean = a.mean;
          s.adj_sd = a.sd;
          s.adj_n = a.n;
        });
      }

      function _summWithFormulaCols(stats) {
        return _withFormulaCols(stats, ["mean", "sd", "min", "max"]);
      }

      // Spreadsheet column letter for a key, from its position in the row
      // object — the same order _buildXlsx writes the header in.
      function _colLetterOf(row, key) {
        let n = Object.keys(row).indexOf(key) + 1;
        if (n <= 0) return null;
        let s = "";
        while (n > 0) {
          s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
          n = Math.floor((n - 1) / 26);
        }
        return s;
      }

      // Same pair of columns for the temperature sheet, whose adjusted
      // mean/sd/min/max sit in different columns. Addressed by KEY, not by
      // letter: letters are positions, so inserting a column anywhere to
      // their left silently repointed these formulas at whatever slid into
      // D–G. Resolving the letter from the key at write time means the sheet
      // can gain columns without the formulas quietly going wrong.
      function _withFormulaCols(rows, [mKey, sKey, loKey, hiKey]) {
        if (!rows.length) return rows;
        const mCol = _colLetterOf(rows[0], mKey),
          sCol = _colLetterOf(rows[0], sKey),
          loCol = _colLetterOf(rows[0], loKey),
          hiCol = _colLetterOf(rows[0], hiKey);
        // A renamed key would otherwise produce "TEXT($null2,...)" in every
        // cell; better to ship the sheet without the two convenience columns.
        if (!mCol || !sCol || !loCol || !hiCol) {
          log(
            "Could not locate the mean/sd/min/max columns for the LaTeX and " +
              "Word columns; they have been left out of this sheet.",
            "warn",
          );
          return rows;
        }
        return rows.map((r, i) => {
          const row = i + 2; // +1 for the header, +1 because Excel is 1-based
          // Column letters absolute ($F) and rows relative, which is what
          // makes these survive being filled down or copied sideways.
          const t = (col) => `TEXT($${col}${row},"0.00")`;
          const tail = `" ["&${t(loCol)}&"-"&${t(hiCol)}&"]"`;
          return Object.assign({}, r, {
            // \pm in LaTeX; UNICHAR(177) is the ± glyph for Word.
            // The _xlfn. prefix is REQUIRED in the stored XML for functions
            // added after the original ECMA-376 set (UNICHAR arrived in Excel
            // 2013). Written bare, Excel does not resolve it as a built-in,
            // treats it as an unknown defined name, and tags it with the
            // implicit-intersection "@" — which then fails to compute. Excel
            // hides the prefix, so the formula bar still reads UNICHAR(177).
            latex: { __xlFormula: `${t(mCol)}&"$\\pm$"&${t(sCol)}&${tail}` },
            word: { __xlFormula: `${t(mCol)}&_xlfn.UNICHAR(177)&${t(sCol)}&${tail}` },
          });
        });
      }

      // ── Structure selections ────────────────────────────────────────────
      // Pooled means answer "what does this species do on average". They
      // cannot answer "what does the OPENING stroke do", because opening and
      // closing strokes sit in the same Trains table and average together.
      //
      // A selection names a subset of structures by their POSITION inside the
      // parent structure — the first train of every echeme, the odd-numbered
      // trains, the last train — optionally narrowed further by conditions on
      // the measured columns. Each selection is then summarized with exactly
      // the same statistics as the pooled data, so the two are comparable.
      //
      // Positions are resolved per parent, per recording. "Train 1" means the
      // first train of each echeme in each recording, not the first row of the
      // merged sheet.
      const SUMM_SEL_LEVELS = {
        train_in_motif: {
          cat: "trains",
          label: "Trains within each echeme (motif)",
          group: ["_rec", "motif_id"],
          order: ["train_id"],
          unit: "train",
          parent: "echeme",
        },
        train_in_rec: {
          cat: "trains",
          label: "Trains within each recording",
          group: ["_rec"],
          order: ["motif_id", "train_id"],
          unit: "train",
          parent: "recording",
        },
        peak_in_train: {
          cat: "peaks",
          label: "Peaks within each train",
          group: ["_rec", "motif_id", "train_id"],
          order: ["peak_id"],
          unit: "peak",
          parent: "train",
        },
        peak_in_motif: {
          cat: "peaks",
          label: "Peaks within each echeme (motif)",
          group: ["_rec", "motif_id"],
          order: ["train_id", "peak_id"],
          unit: "peak",
          parent: "echeme",
        },
        motif_in_rec: {
          cat: "motifs",
          label: "Echemes (motifs) within each recording",
          group: ["_rec"],
          order: ["motif_id"],
          unit: "echeme",
          parent: "recording",
        },
        motseq_in_rec: {
          cat: "motseq",
          label: "Motif sequences within each recording",
          group: ["_rec"],
          order: ["seq_id"],
          unit: "motif sequence",
          parent: "recording",
        },

        // ── Gap levels ────────────────────────────────────────────────────
        // The silences, addressed in their own right. A gap is not a
        // structure, so it cannot be selected by the levels above: asking for
        // "the gap between trains 1 and 2" there means selecting TRAIN 1 and
        // then knowing that its train_gap_ms happens to be the gap that
        // follows it. That works, but the selection is labelled as being about
        // trains, its mean duration and peak rate come along for the ride, and
        // "1-2" typed in the positions box silently reads as the range 1..2.
        //
        // On a gap level the unit IS the gap. Within a parent holding k
        // structures there are k-1 gaps; gap i sits between structures i and
        // i+1, so positions address the pair the way it is written on paper.
        // "1-2, 3-4, 5-6" (or simply "odd") is then the intra-syllable set,
        // and "even" its inter-syllable complement.
        //
        // Dropping each group's last structure is what makes the arithmetic
        // honest, and it matters most for peaks: peak_period_ms comes from the
        // globally flattened peak list, so the last peak of every train
        // carries the interval to the NEXT TRAIN rather than a pulse period.
        // Selecting peak gaps within a train never sees those rows, so the
        // mean is a pulse period throughout — the same correction
        // _pkWithinTrainPeriods makes for the single-recording report.
        gap_train_in_motif: {
          cat: "trains",
          label: "Gaps between trains within each echeme (motif)",
          group: ["_rec", "motif_id"],
          order: ["train_id"],
          unit: "gap",
          parent: "echeme",
          gap: {
            of: "train",
            metrics: ["train_gap_ms", "train_period_ms"],
            from: "train_end",
            to: "train_start",
          },
        },
        gap_peak_in_train: {
          cat: "peaks",
          label: "Intervals between peaks within each train",
          group: ["_rec", "motif_id", "train_id"],
          order: ["peak_id"],
          unit: "interval",
          parent: "train",
          gap: {
            of: "peak",
            metrics: ["peak_period_ms"],
            from: "peak_time",
            to: "peak_time",
          },
        },
        gap_motif_in_rec: {
          cat: "motifs",
          label: "Gaps between echemes (motifs) within each recording",
          group: ["_rec"],
          order: ["motif_id"],
          unit: "gap",
          parent: "recording",
          gap: {
            of: "echeme",
            metrics: ["motif_gap_s", "motif_period_s"],
            from: "motif_end",
            to: "motif_start",
          },
        },
        gap_motseq_in_rec: {
          cat: "motseq",
          label: "Gaps between motif sequences within each recording",
          group: ["_rec"],
          order: ["seq_id"],
          unit: "gap",
          parent: "recording",
          gap: {
            of: "motif sequence",
            metrics: ["seq_gap_s"],
            from: "seq_end",
            to: "seq_start",
          },
        },

        // ── Chunk levels ──────────────────────────────────────────────────
        // A syllable in a disyllabic species is not a train and not a gap: it
        // is a fixed run of consecutive trains taken as one sound, measured
        // from the first one's onset to the last one's offset. Selecting
        // "trains 1 and 2" cannot express it, because that yields two rows
        // whose durations average to a train duration; the syllable's duration
        // is the SPAN, silence in the middle included.
        //
        // So these levels partition each parent into consecutive runs of `size`
        // structures and emit one row per run. Positions then number the
        // syllables, not the trains: "1" is the first syllable of each echeme,
        // "odd" every other one.
        //
        // A run must be complete. A motif of 5 trains read in pairs yields two
        // syllables and one leftover train, and that train is dropped rather
        // than emitted as a one-train syllable — its "duration" would be a
        // train duration with no interior silence, biasing the mean downward
        // by exactly the thing the level exists to measure. The count of
        // dropped members is reported on the card so the loss is never silent.
        syl_train_in_motif: {
          cat: "trains",
          label: "Syllables (runs of trains) within each echeme (motif)",
          group: ["_rec", "motif_id"],
          order: ["train_id"],
          unit: "syllable",
          parent: "echeme",
          chunk: {
            of: "train",
            prefix: "syl",
            start: "train_start",
            end: "train_end",
            // Member duration, and what to multiply it by to reach seconds —
            // extents are in seconds but train_dur_ms is not.
            memberDur: "train_dur_ms",
            memberDurToSec: 0.001,
            // Emitted durations are seconds × outScale, labelled outSuffix.
            outScale: 1000,
            outSuffix: "ms",
            // Exact aggregations only. Each of these is already a sum over its
            // own train (a peak count, an excursion), so summing over the
            // trains of a syllable is the same quantity one level up.
            sum: ["n_peaks", "tem_exc", "dyn_exc"],
            // Intensive quantities, averaged with each train weighted by its
            // duration — the longer stroke should count for more in a
            // syllable's carrier frequency than a brief one.
            wmean: [
              "mean_amp",
              "peak_freq_khz",
              "peak_freq_pmean_khz",
              "bw_20db_khz",
              "bw_10db_khz",
              "spec_centroid_khz",
              "q_20db",
            ],
            // Extremes aggregate exactly.
            min: ["peak_freq_pmin_khz"],
            max: ["peak_freq_pmax_khz"],
            // Peaks per second across the whole syllable, interior silence
            // included — deliberately not the mean of the trains' own rates,
            // which would describe the strokes rather than the syllable.
            rateFrom: "n_peaks",
            rateName: "peak_rate_pps",
          },
        },
        syl_motif_in_rec: {
          cat: "motifs",
          label: "Groups of echemes (motifs) within each recording",
          group: ["_rec"],
          order: ["motif_id"],
          unit: "group",
          parent: "recording",
          chunk: {
            of: "echeme",
            prefix: "grp",
            start: "motif_start",
            end: "motif_end",
            memberDur: "motif_dur_s",
            memberDurToSec: 1,
            outScale: 1,
            outSuffix: "s",
            sum: ["n_trains"],
            wmean: [
              "duty_cycle_pct",
              "peak_freq_khz",
              "peak_freq_pmean_khz",
              "bw_20db_khz",
              "spec_centroid_khz",
              "pci_syl",
              "pci_agn",
            ],
            min: ["peak_freq_pmin_khz"],
            max: ["peak_freq_pmax_khz"],
            rateFrom: "n_trains",
            rateName: "train_rate_tps",
          },
        },
      };

      // Which recording a merged row came from. source_file names the AUDIO
      // and is what should group structures; source_workbook is the fallback
      // for exports predating that column, where one workbook is one
      // recording anyway.
      function _summRecKey(r) {
        return String(r.source_file || r.source_workbook || "(unnamed)");
      }

      // Position spec → a predicate over (position, siblingCount), both
      // 1-based. Comma-separated terms are OR-ed, so "1,3,5" and "odd" and
      // "every 2 from 1" are three ways to write the same thing.
      //
      //   3            the third
      //   1,3,5        an explicit list
      //   2-4          an inclusive range
      //   2-n          from the second to the last
      //   -1           the last; -2 the second-to-last
      //   first, last  the obvious
      //   odd, even    by parity of position
      //   every 2 from 1   every second, starting at the first
      //   all or blank     no positional restriction
      //
      // pairMode is set for the gap levels, where positions number the gaps
      // and a gap is naturally named after the two structures it separates.
      // There "1-2" is the gap between structures 1 and 2 — one gap, gap 1 —
      // rather than the range 1..2. Ranges are still available on those
      // levels, spelled with ".." ("1..4" is the first four gaps), and a
      // hyphenated non-consecutive pair is rejected rather than guessed at.
      function _summParsePositions(spec, pairMode) {
        const raw = String(spec == null ? "" : spec).trim();
        const allOf = { ok: true, label: "all", test: () => true };
        if (!raw || /^(all|\*)$/i.test(raw)) return allOf;
        const parts = raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s);
        const tests = [];
        for (const part of parts) {
          const p = part.toLowerCase();
          let m;
          if (p === "first") {
            tests.push((i) => i === 1);
          } else if (p === "last") {
            tests.push((i, n) => i === n);
          } else if (p === "odd") {
            tests.push((i) => i % 2 === 1);
          } else if (p === "even") {
            tests.push((i) => i % 2 === 0);
          } else if ((m = p.match(/^every\s+(\d+)(?:\s+from\s+(\d+))?$/))) {
            const k = parseInt(m[1], 10);
            const s = m[2] ? parseInt(m[2], 10) : 1;
            if (k < 1 || s < 1)
              return {
                ok: false,
                err: `"${part}": the step and the starting position must be 1 or more.`,
              };
            tests.push((i) => i >= s && (i - s) % k === 0);
          } else if (
            (m = p.match(/^(\d+)\s*(-|\.\.|–)\s*(\d+|n|last|end)$/))
          ) {
            const a = parseInt(m[1], 10);
            const sep = m[2];
            const rhs = m[3];
            if (a < 1)
              return { ok: false, err: `"${part}": positions start at 1.` };
            if (!/^\d+$/.test(rhs)) {
              // "2-n" / "2..last": open-ended, a range under either spelling.
              tests.push((i, n) => i >= a && i <= n);
            } else if (pairMode && sep === "-") {
              const b = parseInt(rhs, 10);
              if (b !== a + 1)
                return {
                  ok: false,
                  err: `"${part}": on a gap level "a-b" names the gap between two CONSECUTIVE structures, like 1-2 or 3-4. For a range of gaps write ${a}..${rhs}.`,
                };
              tests.push((i) => i === a);
            } else {
              const b = parseInt(rhs, 10);
              if (b < a)
                return {
                  ok: false,
                  err: `"${part}": the range ends before it starts.`,
                };
              tests.push((i) => i >= a && i <= b);
            }
          } else if ((m = p.match(/^-(\d+)$/))) {
            const k = parseInt(m[1], 10);
            if (k < 1)
              return {
                ok: false,
                err: `"${part}": counting back from the end starts at -1.`,
              };
            tests.push((i, n) => i === n - k + 1);
          } else if ((m = p.match(/^(\d+)$/))) {
            const k = parseInt(m[1], 10);
            if (k < 1)
              return { ok: false, err: `"${part}": positions start at 1.` };
            tests.push((i) => i === k);
          } else {
            return {
              ok: false,
              err: `Could not read "${part}". Try a number, a list like 1,3,5, a range like 2-4 or 2-n, -1 for the last, or one of first/last/odd/even/every 2 from 1.`,
            };
          }
        }
        if (!tests.length) return allOf;
        return {
          ok: true,
          label: parts.join(", "),
          test: (i, n) => tests.some((t) => t(i, n)),
        };
      }

      // Longest first: ">=" must be recognised before ">", "<>" before "<",
      // "!=" and "==" before "=". Scanning left to right with this order is
      // what makes "n_peaks>=3" parse as (n_peaks) (>=) (3).
      const SUMM_FILTER_OPS = [
        [">=", (a, b) => a >= b],
        ["<=", (a, b) => a <= b],
        ["!=", (a, b) => a !== b],
        ["<>", (a, b) => a !== b],
        ["==", (a, b) => a === b],
        [">", (a, b) => a > b],
        ["<", (a, b) => a < b],
        ["=", (a, b) => a === b],
      ];

      // Conditions on the measured columns, one per line (or separated by
      // ";"), e.g. "n_peaks >= 3" or "species = Neoconocephalus". Equality and
      // inequality also accept text; the ordering operators require a number.
      function _summParseFilters(text) {
        const lines = String(text || "")
          .split(/[\n;]+/)
          .map((s) => s.trim())
          .filter((s) => s);
        const out = [];
        for (const line of lines) {
          let found = null;
          for (let i = 0; i < line.length && !found; i++)
            for (const [sym, fn] of SUMM_FILTER_OPS)
              if (line.startsWith(sym, i)) {
                found = { sym, fn, at: i };
                break;
              }
          if (!found)
            return {
              ok: false,
              err: `Could not read the condition "${line}" — expected something like "n_peaks >= 3".`,
            };
          const key = line.slice(0, found.at).trim();
          const rhs = line.slice(found.at + found.sym.length).trim();
          if (!key || !rhs)
            return { ok: false, err: `The condition "${line}" is incomplete.` };
          const isNum = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(rhs);
          if (!isNum && !/^(=|==|!=|<>)$/.test(found.sym))
            return {
              ok: false,
              err: `"${line}": ${found.sym} needs a number on the right.`,
            };
          out.push({
            key,
            sym: found.sym,
            fn: found.fn,
            num: parseFloat(rhs),
            rhs,
            isNum,
            text: line,
          });
        }
        return { ok: true, filters: out, label: out.map((f) => f.text).join("; ") };
      }

      // A row must satisfy every condition. A row that does not carry the
      // column at all fails rather than passes: workbooks of different vintages
      // sit in the same merged table, and silently admitting the ones that
      // predate a column would mix filtered and unfiltered rows in one mean.
      function _summRowPasses(row, filters) {
        for (const f of filters) {
          let rk = f.key in row ? f.key : undefined;
          if (rk === undefined) {
            const kl = f.key.toLowerCase();
            rk = Object.keys(row).find((x) => x.toLowerCase() === kl);
          }
          if (rk === undefined) return false;
          const v = row[rk];
          if (f.isNum) {
            if (typeof v !== "number" || !isFinite(v)) return false;
            if (!f.fn(v, f.num)) return false;
          } else {
            const eq =
              String(v ?? "").trim().toLowerCase() === f.rhs.toLowerCase();
            if (f.sym === "=" || f.sym === "==" ? !eq : eq) return false;
          }
        }
        return true;
      }

      // Resolve one selection against the merged tables.
      //
      // Position first, conditions second, and the order is deliberate: with
      // conditions applied first, "train 1" would mean "the first train that
      // survived filtering", which for a filter like train_dur_ms > 20 quietly
      // promotes a second or third train into the first position. Positions
      // therefore always refer to the structure's real place in the song.
      //
      // The derived levels run the same machinery over the same structure
      // rows — the grouping and the ordering are what define which gaps and
      // runs exist at all — but positions count gaps or syllables rather than
      // structures, and what comes out is a row built by _summGapRow or
      // _summChunkRow.
      function summApplySelection(merged, sel) {
        const lvl = SUMM_SEL_LEVELS[sel.level];
        if (!lvl) return { ok: false, err: "Unknown structure level." };
        const pos = _summParsePositions(sel.positions, !!lvl.gap);
        if (!pos.ok) return { ok: false, err: pos.err, cat: lvl.cat };
        const flt = _summParseFilters(sel.filters);
        if (!flt.ok) return { ok: false, err: flt.err, cat: lvl.cat };

        const all = (merged && merged[lvl.cat]) || [];
        const base = {
          ok: true,
          cat: lvl.cat,
          lvl,
          pos,
          flt,
          // Recomputed below for the derived levels, where the population is
          // the gaps between these rows, or the complete runs formed from
          // them, rather than the rows themselves.
          nBefore: all.length,
        };
        if (!all.length)
          return Object.assign({ rows: [], nGroups: 0 }, base, {
            note: `No ${SUMM_LABEL[lvl.cat]} rows were merged.`,
          });

        const groups = new Map();
        all.forEach((r, i) => {
          // The parts are joined on U+0001, a character no filename or id can
          // contain, so ("rec1", 12) and ("rec11", 2) stay distinct groups.
          const key = lvl.group
            .map((g) => (g === "_rec" ? _summRecKey(r) : String(r[g] ?? "")))
            .join("");
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push({ r, i });
        });

        // Rows missing an index column sort last and keep their original file
        // order, so a workbook without motif_id still produces one ordered
        // group per recording instead of dropping out of the selection.
        const idx = (r, k) => {
          const v = parseFloat(r[k]);
          return isFinite(v) ? v : Infinity;
        };
        const rows = [];
        let nGapsTotal = 0;
        // Parents that enclose no gap at all are not part of the population a
        // gap selection is drawn from, so they are left out of the "across N
        // echemes" count as well as out of the rows.
        let nGapGroups = 0;
        // Chunk levels: the run size, and how many leading members to skip
        // before the first run starts (a species with a lead-in stroke pairs
        // from the second train on). Defaulted here rather than at creation so
        // selections made before these levels existed still resolve.
        const chunkSize = Math.max(2, Math.round(+sel.chunkSize || 2));
        const chunkOffset = Math.max(0, Math.round(+sel.chunkOffset || 0));
        let nChunksTotal = 0;
        let nChunkGroups = 0;
        let nDropped = 0;
        groups.forEach((g) => {
          g.sort((a, b) => {
            for (const k of lvl.order) {
              const d = idx(a.r, k) - idx(b.r, k);
              if (d) return d;
            }
            return a.i - b.i;
          });
          if (lvl.gap) {
            // k structures enclose k-1 gaps, so a parent holding a single
            // structure contributes none.
            const nGaps = g.length - 1;
            if (nGaps < 1) return;
            nGapsTotal += nGaps;
            nGapGroups++;
            for (let i = 1; i <= nGaps; i++) {
              const prev = g[i - 1].r;
              if (!pos.test(i, nGaps)) continue;
              // Conditions are read against the structure the gap FOLLOWS,
              // with all of its columns — that row is where the gap's own
              // measure lives (train_gap_ms and friends are stored on it), so
              // both "gaps longer than 5 ms" and "gaps that follow a train of
              // at least 3 peaks" work, and neither needs the gap row to carry
              // columns it has no business carrying.
              if (flt.filters.length && !_summRowPasses(prev, flt.filters))
                continue;
              rows.push(_summGapRow(lvl, prev, g[i].r, i, nGaps));
            }
            return;
          }
          if (lvl.chunk) {
            const avail = g.length - chunkOffset;
            const nChunks = avail > 0 ? Math.floor(avail / chunkSize) : 0;
            // Everything the runs do not cover: the skipped lead-in and the
            // incomplete tail.
            nDropped += g.length - nChunks * chunkSize;
            if (nChunks < 1) return;
            nChunkGroups++;
            nChunksTotal += nChunks;
            // Materialised up front because a run's gap and period are
            // measured to the NEXT run, which has to exist before the current
            // one can be written.
            const runs = [];
            for (let c = 0; c < nChunks; c++)
              runs.push(
                g
                  .slice(chunkOffset + c * chunkSize, chunkOffset + (c + 1) * chunkSize)
                  .map((e) => e.r),
              );
            runs.forEach((members, c) => {
              const i = c + 1;
              if (!pos.test(i, nChunks)) return;
              const row = _summChunkRow(lvl, members, runs[c + 1] || null, i, nChunks);
              // Conditions see the syllable's own measures laid over the full
              // columns of its FIRST member, so "syl_dur_ms > 30" and
              // "n_peaks >= 3" both work. The syllable wins on a name clash,
              // since that is the level being selected.
              if (
                flt.filters.length &&
                !_summRowPasses(Object.assign({}, members[0], row), flt.filters)
              )
                return;
              rows.push(row);
            });
            return;
          }
          const n = g.length;
          g.forEach((e, i) => {
            if (!pos.test(i + 1, n)) return;
            if (flt.filters.length && !_summRowPasses(e.r, flt.filters)) return;
            rows.push(
              Object.assign({ sel_position: i + 1, sel_group_n: n }, e.r),
            );
          });
        });
        if (lvl.gap) base.nBefore = nGapsTotal;
        if (lvl.chunk) {
          base.nBefore = nChunksTotal;
          base.dropped = nDropped;
          base.chunkSize = chunkSize;
          base.chunkOffset = chunkOffset;
        }
        return Object.assign(
          {
            rows,
            nGroups: lvl.gap
              ? nGapGroups
              : lvl.chunk
                ? nChunkGroups
                : groups.size,
          },
          base,
        );
      }

      // One row describing the gap between two consecutive structures.
      //
      // Deliberately NOT a copy of the preceding structure with extra columns.
      // Only the gap measures are carried across as numbers: a table of gaps
      // that also held train_dur_ms and peak_rate_pps would report a mean
      // duration for "the intra-syllable gaps", which is the duration of the
      // trains that happen to precede them and answers a question nobody
      // asked. Everything else kept is categorical — the tags, the ids and the
      // extents — so it locates the gap without ever entering a mean.
      function _summGapRow(lvl, prev, next, i, nGaps) {
        const out = {
          sel_position: i,
          sel_group_n: nGaps,
          gap_between: i + "-" + (i + 1),
        };
        // The preceding structure's own start/end are replaced by the gap's,
        // below — carrying both would put two different meanings of "where"
        // in one row.
        const extents = new Set([lvl.gap.from, lvl.gap.to]);
        Object.keys(prev).forEach((k) => {
          if (_summIsCategoricalKey(k) && !extents.has(k.toLowerCase()))
            out[k] = prev[k];
        });
        const from = _summNum(prev, lvl.gap.from);
        const to = _summNum(next, lvl.gap.to);
        if (from !== null) out.gap_start = from;
        if (to !== null) out.gap_end = to;
        lvl.gap.metrics.forEach((k) => {
          const v = _summPick(prev, k);
          if (v !== undefined) out[k] = v;
        });
        return out;
      }

      // Case-insensitive column read, for merged workbooks of different
      // vintages that do not agree on header case.
      function _summPick(row, key) {
        if (key in row) return row[key];
        const kl = key.toLowerCase();
        const rk = Object.keys(row).find((x) => x.toLowerCase() === kl);
        return rk === undefined ? undefined : row[rk];
      }
      function _summNum(row, key) {
        const v = _summPick(row, key);
        return typeof v === "number" && isFinite(v) ? v : null;
      }

      // One row describing a run of consecutive structures taken as a single
      // sound — the syllable of a disyllabic species being two trains.
      //
      // The duration is the SPAN, first member's onset to last member's
      // offset, which is the whole reason the level exists: it includes the
      // silence between the strokes, where summing the members' own durations
      // would not. That silence is reported separately too, so a syllable can
      // be described as sound + interior gap without going back to the trains.
      //
      // Only aggregations that are exact or explicitly weighted are carried
      // across (see the level's sum/wmean/min/max lists). Columns outside
      // those lists are dropped rather than averaged blindly: a mean of two
      // spectral entropies or of two frequency SDs is not the entropy or the
      // SD of the pair, and emitting one would put a number in the table that
      // reads like a measurement but is not.
      function _summChunkRow(lvl, members, nextMembers, i, nChunks) {
        const c = lvl.chunk;
        const first = members[0];
        const last = members[members.length - 1];
        const P = c.prefix;
        const U = c.outSuffix;
        const out = {
          sel_position: i,
          sel_group_n: nChunks,
          [P + "_members"]: members
            .map((r) => _summPick(r, lvl.order[0]) ?? "?")
            .join("-"),
        };
        // Tags, ids and the like come from the first member; its own extents
        // are replaced by the run's.
        const extents = new Set([c.start, c.end]);
        Object.keys(first).forEach((k) => {
          if (_summIsCategoricalKey(k) && !extents.has(k.toLowerCase()))
            out[k] = first[k];
        });

        const t0 = _summNum(first, c.start);
        const t1 = _summNum(last, c.end);
        if (t0 !== null) out[P + "_start"] = t0;
        if (t1 !== null) out[P + "_end"] = t1;
        out[P + "_n_" + c.of.replace(/\s+/g, "_") + "s"] = members.length;

        const span = t0 !== null && t1 !== null ? t1 - t0 : null;
        if (span !== null) out[P + "_dur_" + U] = round4(span * c.outScale);

        // Sound vs silence inside the run.
        const durs = members.map((r) => _summNum(r, c.memberDur));
        if (durs.every((v) => v !== null)) {
          const soundSec = durs.reduce((s, v) => s + v, 0) * c.memberDurToSec;
          out[P + "_sound_" + U] = round4(soundSec * c.outScale);
          if (span !== null) {
            out[P + "_silence_" + U] = round4((span - soundSec) * c.outScale);
            if (span > 0)
              out[P + "_duty_pct"] = round4((soundSec / span) * 100);
          }
        }

        // Gap and period to the next run in the same parent. Null on the last
        // run, exactly as the structure tables treat their own last row.
        if (nextMembers && t1 !== null) {
          const n0 = _summNum(nextMembers[0], c.start);
          if (n0 !== null) {
            out[P + "_gap_" + U] = round4((n0 - t1) * c.outScale);
            if (t0 !== null)
              out[P + "_period_" + U] = round4((n0 - t0) * c.outScale);
          }
        }

        (c.sum || []).forEach((k) => {
          const vals = members.map((r) => _summNum(r, k));
          if (vals.every((v) => v !== null))
            out[P + "_" + k] = round4(vals.reduce((s, v) => s + v, 0));
        });
        (c.min || []).forEach((k) => {
          const vals = members.map((r) => _summNum(r, k)).filter((v) => v !== null);
          if (vals.length) out[P + "_" + k] = round4(Math.min(...vals));
        });
        (c.max || []).forEach((k) => {
          const vals = members.map((r) => _summNum(r, k)).filter((v) => v !== null);
          if (vals.length) out[P + "_" + k] = round4(Math.max(...vals));
        });
        (c.wmean || []).forEach((k) => {
          let num = 0;
          let den = 0;
          members.forEach((r, mi) => {
            const v = _summNum(r, k);
            const w = durs[mi];
            if (v === null || w === null || w <= 0) return;
            num += v * w;
            den += w;
          });
          if (den > 0) out[P + "_" + k] = round4(num / den);
        });
        if (c.rateFrom && span > 0) {
          const tot = members.map((r) => _summNum(r, c.rateFrom));
          if (tot.every((v) => v !== null))
            out[P + "_" + c.rateName] = round4(
              tot.reduce((s, v) => s + v, 0) / span,
            );
        }
        return out;
      }

      // Mean / SD / min / max for every numeric column, pooled and then per
      // specimen. The one place these statistics are defined — the pooled
      // summary and every selection go through it, so they cannot drift.
      // SD uses the population divisor (n), matching what the summary has
      // always reported.
      // Mean and SD of one column over an arbitrary row subset — the
      // per-recording lines group by recording, which is not one of the
      // groupings _summStatsBlock produces. Population divisor (n), matching
      // it exactly so the two never disagree on the same numbers.
      function _summMeanSd(rows, key) {
        const vals = (rows || [])
          .map((r) => r[key])
          .filter((v) => typeof v === "number" && isFinite(v));
        if (!vals.length) return null;
        const n = vals.length;
        const mean = vals.reduce((s, v) => s + v, 0) / n;
        const sd =
          n > 1
            ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
            : 0;
        return { n, mean, sd };
      }

      function _summStatsBlock(rows, catLabel, individuals, selection) {
        const out = [];
        if (!rows || !rows.length) return out;
        const keys = new Set();
        rows.forEach((r) =>
          Object.keys(r).forEach((k) => {
            if (!_summIsCategoricalKey(k)) keys.add(k);
          }),
        );
        const groups =
          individuals.length > 1 ? ["ALL", ...individuals] : ["ALL"];
        groups.forEach((grp) => {
          const subset =
            grp === "ALL" ? rows : rows.filter((r) => r.specimen_id === grp);
          if (!subset.length) return;
          keys.forEach((k) => {
            const vals = subset
              .map((r) => r[k])
              .filter((v) => typeof v === "number" && isFinite(v));
            if (!vals.length) return;
            const n = vals.length;
            const mean = vals.reduce((s, v) => s + v, 0) / n;
            const sd =
              n > 1
                ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
                : 0;
            out.push({
              selection,
              category: catLabel,
              specimen_id: grp,
              metric: k,
              n,
              mean: round4(mean),
              sd: round4(sd),
              min: round4(Math.min(...vals)),
              max: round4(Math.max(...vals)),
            });
          });
        });
        return out;
      }

      // Human-readable one-liner for a resolved selection — reused by the
      // side panel, the status line and the drafted report, so the wording
      // the user reads on screen is the wording that reaches the paper.
      function summSelDescribe(sel, res) {
        const lvl = SUMM_SEL_LEVELS[sel.level];
        if (!lvl) return "";
        const where =
          res && res.flt && res.flt.filters.length
            ? ` with ${res.flt.label}`
            : "";
        const named = res && res.pos && res.pos.label !== "all";
        // "gaps between trains 1-2, 3-4, 5-6 of each echeme" — the phrasing a
        // reader would use, so the rule reads the same on screen and on paper.
        if (lvl.chunk) {
          // The run size and phase ARE the definition here: "syllables of 2
          // trains" says what a syllable is, and without it the numbers cannot
          // be interpreted, let alone reproduced.
          const k = (res && res.chunkSize) || 2;
          const off = (res && res.chunkOffset) || 0;
          const which = named
            ? `${lvl.unit}s at position ${res.pos.label}`
            : `all ${lvl.unit}s`;
          const skip = off
            ? `, after skipping the first ${off} ${lvl.chunk.of}${off === 1 ? "" : "s"}`
            : "";
          return `${which} of each ${lvl.parent}, each one a run of ${k} consecutive ${lvl.chunk.of}s${skip}${where}`;
        }
        const which = lvl.gap
          ? named
            ? `gaps between ${lvl.gap.of}s ${res.pos.label}`
            : `all gaps between ${lvl.gap.of}s`
          : named
            ? `${lvl.unit}s at position ${res.pos.label}`
            : `all ${lvl.unit}s`;
        return `${which} of each ${lvl.parent}${where}`;
      }

      // Sheet-name stem for a selection. _buildXlsx already truncates to 31
      // characters and de-duplicates, but it does that AFTER the suffixes are
      // appended — so the stem is clipped short enough here that
      // "<stem>_TempReg" still fits and two selections do not collide only in
      // the part that gets cut off.
      function _summSelSheetStem(name) {
        const safe =
          String(name || "")
            .replace(/[^A-Za-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 18) || "Selection";
        return "Sel_" + safe;
      }

      // _sheetXml takes its column list from the FIRST row, so rows whose keys
      // differ (workbooks of different vintages merged together) would lose
      // whatever the first row happens not to carry. Give every row the union
      // of the keys, in first-seen order, before writing a sheet.
      function _summUniformRows(rows) {
        const cols = [];
        const seen = new Set();
        rows.forEach((r) =>
          Object.keys(r).forEach((k) => {
            if (!seen.has(k)) {
              seen.add(k);
              cols.push(k);
            }
          }),
        );
        return rows.map((r) => {
          const out = {};
          cols.forEach((c) => {
            out[c] = c in r ? r[c] : null;
          });
          return out;
        });
      }

      // Every selection resolved against the current merge, in panel order.
      function summResolveSelections() {
        summSelResults = summSelections.map((sel) => {
          const res = summApplySelection(summMerged, sel);
          return Object.assign({ sel }, res);
        });
        return summSelResults;
      }

      // ── Temperature regression ──────────────────────────────────────────
      // Insect song rates scale strongly with temperature, so measurements
      // taken on different days are not directly comparable. For each metric
      // we fit value = intercept + slope × temperature by ordinary least
      // squares across all observations that carry a temperature, then express
      // every observation at one chosen temperature:
      //     adjusted = observed + slope × (target − observed_temperature)
      // which removes the thermal component while leaving the residual
      // (individual) variation intact.
      // One observation per recording, not per row.
      //
      // Temperature is a property of the RECORDING: every train in a file
      // carries that file's single reading. Fitting on raw rows counts one
      // measurement many times over — fifty trains from one recording are
      // fifty copies of one observation, not fifty observations — and lets a
      // long recording outweigh a short one purely on row count.
      //
      // It skews the two gates in opposite directions at once. n is inflated,
      // so the significance test in _tempCalibUsable passes almost anything
      // (500 rows from 10 recordings is judged against the critical |r| for
      // n=500). Meanwhile r² is deflated, because the denominator carries the
      // train-to-train scatter within each recording that temperature cannot
      // explain, so real thermal responses can fail TEMP_CALIB_MIN_R2.
      //
      // Collapsing to a mean per recording makes n the number of recordings,
      // which is what both gates already assume they are being handed.
      function _summByRecording(rows, k) {
        const groups = new Map();
        rows.forEach((r) => {
          const t = parseFloat(r.temp_c);
          const v = r[k];
          if (!isFinite(t) || typeof v !== "number" || !isFinite(v)) return;
          const key = _summRecKey(r);
          // The first reading wins; a recording carries one temperature, so
          // later rows repeat it rather than adding information.
          if (!groups.has(key)) groups.set(key, { t, vals: [] });
          groups.get(key).vals.push(v);
        });
        const out = [];
        groups.forEach((g, key) =>
          out.push({
            rec: key,
            t: g.t,
            v: g.vals.reduce((a, b) => a + b, 0) / g.vals.length,
            nRows: g.vals.length,
          }),
        );
        return out;
      }

      function _summFitTemp(pairs) {
        const n = pairs.length;
        if (n < 3) return null; // a slope through two points is not a fit
        const ts = pairs.map((p) => p.t);
        const tMin = Math.min(...ts),
          tMax = Math.max(...ts);
        if (!(tMax - tMin > 1e-9)) return null; // no thermal spread to model
        const mt = ts.reduce((a, b) => a + b, 0) / n;
        const mv = pairs.reduce((a, p) => a + p.v, 0) / n;
        let sxx = 0,
          sxy = 0,
          syy = 0;
        for (const p of pairs) {
          const dt = p.t - mt,
            dv = p.v - mv;
          sxx += dt * dt;
          sxy += dt * dv;
          syy += dv * dv;
        }
        if (!(sxx > 0)) return null;
        // A response that never varies is not a perfect fit, it is no fit at
        // all: there is nothing for temperature to explain. Reporting r² = 1
        // here — as this did — put constants such as an analysis setting at
        // the very top of any "which metrics track temperature" reading, let
        // them pass every significance gate, and had the report print a
        // corrected value identical to the observed one, which reads as
        // though temperature had been accounted for when nothing was.
        if (!(syy > 0)) return null;
        const slope = sxy / sxx;
        return {
          n,
          tMin,
          tMax,
          slope,
          intercept: mv - slope * mt,
          r2: (sxy * sxy) / (sxx * syy),
        };
      }

      function summTempRegression(merged, targetT) {
        const model = [];
        const adjusted = [];
        SUMM_CATS.forEach((cat) => {
          const rows = merged[cat] || [];
          if (!rows.length) return;
          const keys = new Set();
          rows.forEach((r) =>
            Object.keys(r).forEach((k) => {
              if (!_summIsCategoricalKey(k)) keys.add(k);
            }),
          );
          keys.forEach((k) => {
            const obs = [];
            rows.forEach((r) => {
              const t = parseFloat(r.temp_c);
              const v = r[k];
              if (isFinite(t) && typeof v === "number" && isFinite(v))
                obs.push({ t, v, row: r });
            });
            // The SLOPE comes from one mean per recording; the ADJUSTMENT is
            // then applied to every row. Estimating the line and applying it
            // are different jobs: the line describes how the species responds
            // to temperature across recordings, while each row still needs
            // shifting individually.
            const byRec = _summByRecording(rows, k);
            const fit = _summFitTemp(byRec.map(({ t, v }) => ({ t, v })));
            if (!fit) return;
            const nRowsTotal = byRec.reduce((s, r) => s + r.nRows, 0);
            const adjVals = [];
            obs.forEach((o) => {
              const adj = o.v + fit.slope * (targetT - o.t);
              adjVals.push(adj);
              adjusted.push({
                category: SUMM_LABEL[cat],
                specimen_id: o.row.specimen_id || "",
                species: o.row.species || "",
                source_file: o.row.source_file || o.row.source_workbook || "",
                metric: k,
                temp_c: o.t,
                observed: round4(o.v),
                adjusted: round4(adj),
                target_temp_c: targetT,
              });
            });
            const an = adjVals.length;
            const amean = adjVals.reduce((a, b) => a + b, 0) / an;
            const asd =
              an > 1
                ? Math.sqrt(
                    adjVals.reduce((s, v) => s + (v - amean) ** 2, 0) / an,
                  )
                : 0;
            model.push({
              category: SUMM_LABEL[cat],
              metric: k,
              // The fit's sample size is the number of RECORDINGS, spelled
              // out because it is the number the r² and the significance
              // gate should be read against. n_rows_total says how much
              // audio stands behind those means — 10 recordings is 10
              // observations whether each holds 5 trains or 500.
              n_recordings: fit.n,
              n_rows_total: nRowsTotal,
              adj_mean: round4(amean),
              adj_sd: round4(asd),
              adj_min: round4(Math.min(...adjVals)),
              adj_max: round4(Math.max(...adjVals)),
              target_temp_c: targetT,
              slope_per_C: round4(fit.slope),
              intercept: round4(fit.intercept),
              r2: round4(fit.r2),
              temp_min_c: round4(fit.tMin),
              temp_max_c: round4(fit.tMax),
              // Predicting outside the temperatures actually observed is an
              // extrapolation; flag it rather than let it pass as a fit.
              extrapolated:
                targetT < fit.tMin || targetT > fit.tMax ? "YES" : "",
            });
          });
        });
        return { model, adjusted };
      }

      // ── Estimating a missing temperature from the song itself ───────────
      // The inverse of the correction above: if a metric tracks temperature
      // closely, it can be read as a thermometer for recordings where none
      // was noted. Note the fit direction — temperature is regressed ON the
      // metric (temp ~ value), not obtained by algebraically inverting the
      // value ~ temp line. Inverting that line divides by the slope, which
      // explodes for weakly thermal metrics; regressing the quantity you
      // actually want to predict keeps the estimate stable.
      //
      // Only metrics that genuinely track temperature are allowed to vote,
      // and each vote is weighted by how well it fits.
      //
      // The gate is a significance test, not a flat r² cutoff, because r²
      // alone ignores sample size: four points of pure noise reach r² ≈ 0.5
      // routinely, and a fixed threshold lets that vote as if it were a real
      // thermal response. Critical |r| for p = 0.05 (two-tailed) by degrees
      // of freedom (n − 2); values between listed sizes step to the nearest
      // smaller n, which errs toward rejecting.
      const PEARSON_CRIT_05 = [
        [3, 0.997], [4, 0.95], [5, 0.878], [6, 0.811], [7, 0.754],
        [8, 0.707], [9, 0.666], [10, 0.632], [12, 0.576], [15, 0.514],
        [20, 0.444], [25, 0.396], [30, 0.361], [40, 0.312], [50, 0.279],
        [60, 0.254], [80, 0.22], [100, 0.197],
      ];
      // A floor as well: with a large n almost any slope becomes
      // "significant", and a metric that explains 10% of the variance is not
      // a thermometer worth trusting.
      const TEMP_CALIB_MIN_R2 = 0.25;

      function _tempCalibUsable(r2, n) {
        if (!(r2 >= TEMP_CALIB_MIN_R2) || n < 3) return false;
        let crit = PEARSON_CRIT_05[0][1];
        for (const [size, c] of PEARSON_CRIT_05) {
          if (n >= size) crit = c;
          else break;
        }
        return Math.sqrt(r2) >= crit;
      }

      function summEstimateTemps(merged) {
        // 1. Calibrate on the recordings that DO carry a temperature.
        const calib = [];
        SUMM_CATS.forEach((cat) => {
          const rows = merged[cat] || [];
          if (!rows.length) return;
          const keys = new Set();
          rows.forEach((r) =>
            Object.keys(r).forEach((k) => {
              if (!_summIsCategoricalKey(k)) keys.add(k);
            }),
          );
          keys.forEach((k) => {
            // One point per recording, and note the swap: here the metric is
            // the predictor and temperature is what we predict.
            //
            // Calibrating per recording also keeps the fit in the same units
            // as the prediction below, which feeds the line a per-recording
            // MEAN. Calibrating on raw rows meant fit.tMin/tMax were row-level
            // extremes while the value tested against them was a mean, so the
            // extrapolation check compared a mean to a spread it could never
            // reach and almost never fired.
            const byRec = _summByRecording(rows, k);
            const pairs = byRec.map(({ t, v }) => ({ t: v, v: t }));
            const fit = _summFitTemp(pairs);
            if (fit && _tempCalibUsable(fit.r2, fit.n))
              calib.push({
                cat,
                metric: k,
                fit,
                nRowsTotal: byRec.reduce((s, r) => s + r.nRows, 0),
              });
          });
        });
        if (!calib.length) return { estimates: [], detail: [], nCalib: 0 };

        // 2. Gather the recordings with no temperature, grouped by audio file
        //    — one estimate per recording, not per train or per peak.
        const groups = new Map();
        SUMM_CATS.forEach((cat) => {
          (merged[cat] || []).forEach((r) => {
            if (isFinite(parseFloat(r.temp_c))) return;
            const key = r.source_file || r.source_workbook || "(unnamed)";
            if (!groups.has(key))
              groups.set(key, {
                key,
                specimen_id: r.specimen_id || "",
                species: r.species || "",
                byCat: {},
              });
            const g = groups.get(key);
            (g.byCat[cat] = g.byCat[cat] || []).push(r);
          });
        });

        const estimates = [];
        const detail = [];
        groups.forEach((g) => {
          const votes = [];
          calib.forEach(({ cat, metric, fit, nRowsTotal }) => {
            const rows = g.byCat[cat];
            if (!rows || !rows.length) return;
            const vals = rows
              .map((r) => r[metric])
              .filter((v) => typeof v === "number" && isFinite(v));
            if (!vals.length) return;
            const meanVal = vals.reduce((a, b) => a + b, 0) / vals.length;
            const est = fit.intercept + fit.slope * meanVal;
            // fit.tMin/tMax are the METRIC values seen during calibration,
            // since the metric is the predictor here.
            const outside = meanVal < fit.tMin || meanVal > fit.tMax;
            votes.push({ est, w: fit.r2, outside });
            detail.push({
              source_file: g.key,
              specimen_id: g.specimen_id,
              category: SUMM_LABEL[cat],
              metric,
              value_used: round4(meanVal),
              n_rows: vals.length,
              temp_estimate_c: round4(est),
              r2: round4(fit.r2),
              calib_value_min: round4(fit.tMin),
              calib_value_max: round4(fit.tMax),
              // Recordings the calibration line was fitted through, and the
              // rows behind them. calib_value_min/max are now the range of
              // recording MEANS, the same quantity value_used is, so the
              // extrapolation flag compares like with like.
              calib_n_recordings: fit.n,
              calib_n_rows: nRowsTotal,
              extrapolated: outside ? "YES" : "",
            });
          });
          if (!votes.length) return;
          const wsum = votes.reduce((s, v) => s + v.w, 0) || votes.length;
          const est =
            votes.reduce((s, v) => s + v.est * v.w, 0) / wsum;
          const ests = votes.map((v) => v.est);
          const sd =
            ests.length > 1
              ? Math.sqrt(
                  ests.reduce((s, v) => s + (v - est) ** 2, 0) / ests.length,
                )
              : 0;
          estimates.push({
            source_file: g.key,
            specimen_id: g.specimen_id,
            species: g.species,
            metrics_used: votes.length,
            temp_estimate_c: round4(est),
            sd_across_metrics_c: round4(sd),
            lowest_metric_estimate_c: round4(Math.min(...ests)),
            highest_metric_estimate_c: round4(Math.max(...ests)),
            // Any vote drawn from outside its calibration range makes the
            // whole estimate a guess beyond the evidence.
            extrapolated: votes.some((v) => v.outside) ? "YES" : "",
          });
        });
        return { estimates, detail, nCalib: calib.length };
      }

      // How many merged recordings carry no temperature at all.
      function summRecordingsMissingTemp(merged) {
        const missing = new Set();
        SUMM_CATS.forEach((cat) =>
          (merged[cat] || []).forEach((r) => {
            if (!isFinite(parseFloat(r.temp_c)))
              missing.add(r.source_file || r.source_workbook || "(unnamed)");
          }),
        );
        return missing;
      }

      // Distinct temperatures across everything merged — drives the readout
      // that tells the user whether a regression is even possible.
      function summTempsAvailable(merged) {
        const set = new Set();
        SUMM_CATS.forEach((cat) =>
          (merged[cat] || []).forEach((r) => {
            const t = parseFloat(r.temp_c);
            if (isFinite(t)) set.add(t);
          }),
        );
        return [...set].sort((a, b) => a - b);
      }

      function summUpdateTempNote() {
        const el = $("summTempNote");
        if (!el) return;
        if (!summMerged) {
          el.textContent = "";
          return;
        }
        const temps = summTempsAvailable(summMerged);
        if (temps.length < 2) {
          el.textContent =
            temps.length === 1
              ? `Only one temperature found (${temps[0]} °C) — a slope needs at least two.`
              : "No temperatures found in the merged files.";
        } else {
          const missing = summRecordingsMissingTemp(summMerged).size;
          el.textContent =
            `${temps.length} temperatures: ${temps.join(", ")} °C. ` +
            `Metrics with ≥3 observations spanning them get a fit.` +
            (missing
              ? ` ${missing} recording(s) have no temperature — their ` +
                `temperature will be estimated from the song.`
              : "");
        }
      }

      function summSaveWorkbook() {
        if (!summMerged) {
          log("Run Merge & Summarize first.", "warn");
          return;
        }
        const allStats = (summStatsRows || []).filter(
          (s) => s.selection === SUMM_SEL_ALL,
        );
        const sheets = [
          [SUMM_SHEET_NAME.peaks, summMerged.peaks],
          [SUMM_SHEET_NAME.trains, summMerged.trains],
          [SUMM_SHEET_NAME.motifs, summMerged.motifs],
          [SUMM_SHEET_NAME.motseq, summMerged.motseq],
          [SUMM_SHEET_NAME.spectral, summMerged.spectral],
          ["Summary", _summWithFormulaCols(allStats)],
        ].filter(([, data]) => data && data.length);

        // One pair of sheets per structure selection: the rows it matched,
        // and their statistics. Kept out of the Summary sheet so that sheet
        // stays what it has always been — every row, pooled.
        summSelResults.forEach((res) => {
          if (!res.ok || !res.rows.length) return;
          const stem = _summSelSheetStem(res.sel.name);
          sheets.push([stem, _summUniformRows(res.rows)]);
          if (res.stats && res.stats.length)
            sheets.push([stem + "_Stats", _summWithFormulaCols(res.stats)]);
        });

        // Optional temperature-corrected sheets.
        const wantTemp = $("summRegressOn") && $("summRegressOn").checked;
        if (wantTemp) {
          const targetT = parseFloat($("summRegressTemp").value);
          if (!isFinite(targetT)) {
            log("Enter a target temperature to regress to.", "warn");
            return;
          }
          const { model, adjusted } = summTempRegression(summMerged, targetT);
          if (!model.length) {
            log(
              "No metric had ≥3 observations across two or more temperatures — " +
                "temperature sheets skipped.",
              "warn",
            );
          } else {
            // Columns of Temp_Regression: A category, B metric, C n,
            // D adj_mean, E adj_sd, F adj_min, G adj_max — hence D..G here.
            sheets.push([
              "Temp_Regression",
              _withFormulaCols(model, ["adj_mean", "adj_sd", "adj_min", "adj_max"]),
            ]);
            sheets.push(["Temp_Adjusted", adjusted]);
          }

          // The same correction, refitted within each selection. Refitting
          // matters rather than reusing the pooled slope: opening and closing
          // strokes need not respond to temperature at the same rate, and a
          // pooled slope would carry one structure's thermal response into
          // the other.
          summSelResults.forEach((res) => {
            if (!res.ok || !res.rows.length) return;
            const sub = {
              peaks: [],
              trains: [],
              motifs: [],
              motseq: [],
              spectral: [],
            };
            sub[res.cat] = res.rows;
            const r = summTempRegression(sub, targetT);
            if (!r.model.length) return;
            const stem = _summSelSheetStem(res.sel.name);
            sheets.push([
              stem + "_TempReg",
              _withFormulaCols(r.model, ["adj_mean", "adj_sd", "adj_min", "adj_max"]),
            ]);
            sheets.push([stem + "_TempAdj", r.adjusted]);
          });

          // Read the song as a thermometer for recordings with no
          // temperature noted. Independent of the correction above: it needs
          // only a calibration, so it still runs when nothing qualified there.
          const est = summEstimateTemps(summMerged);
          if (est.estimates.length) {
            sheets.push(["Temp_Estimated", est.estimates]);
            sheets.push(["Temp_Estimated_Detail", est.detail]);
          } else if (summRecordingsMissingTemp(summMerged).size) {
            log(
              "Some recordings have no temperature, but no metric tracked " +
                "temperature closely enough (significant at p<0.05 and " +
                "r² ≥ " + TEMP_CALIB_MIN_R2 + ") to estimate one.",
              "warn",
            );
          }
        }
        if (!sheets.length) {
          log("Nothing to save.", "warn");
          return;
        }
        try {
          const bytes = _buildXlsx(sheets);
          const filename =
            _summFilenameStub() + "_rthoptera_summary_" + _summStamp() + ".xlsx";
          dlFile(
            filename,
            bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
          log("Saved merged workbook with " + sheets.length + " sheets.", "ok");
        } catch (e) {
          log("Merged workbook export failed: " + e.message, "err");
        }
      }

      function summSaveReport() {
        const text = ($("summReportText").value || "").trim();
        if (!text) {
          log("Run Merge & Summarize first.", "warn");
          return;
        }
        const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
        try {
          const bytes = _buildDocx("Cross-Recording Summary Report", paragraphs);
          const filename =
            _summFilenameStub() +
            "_rthoptera_summary_report_" +
            _summStamp() +
            ".docx";
          dlFile(
            filename,
            bytes,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          );
          log("Saved summary report.", "ok");
        } catch (e) {
          log("Report export failed: " + e.message, "err");
        }
      }