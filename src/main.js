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
      let activeTool = "select";
      let drawing = null;
      // Visual trim: when trimMode is on, two draggable handles (trimSel.t0/t1,
      // in seconds on the ORIGINAL timeline) define the region to KEEP. Nothing
      // is cut until the user confirms.
      let trimMode = false;
      let trimSel = { t0: 0, t1: 0 };
      let trimDrag = null; // "t0" | "t1" while dragging a handle
      let trimHadPrior = false; // a trim already existed when entering trim mode
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
      let currentAudioFileFolder = "";

      function getFolderFromPath(path) {
        if (!path) return "";
        const sep = path.lastIndexOf("\\") >= 0 ? "\\" : "/";
        const idx = path.lastIndexOf(sep);
        return idx >= 0 ? path.slice(0, idx) : "";
      }

      $("audioFile").onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;

        // Save the name and folder globally, then update UI
        currentAudioFileName = f.name;
        currentAudioFileFolder = getFolderFromPath(
          f.path || f.webkitRelativePath || "",
        );
        log("Loading: " + f.name, "info");
        $("fileLabel").textContent =
          f.name.length > 24 ? f.name.slice(0, 22) + "…" : f.name;

        // Read and decode
        const ab = await f.arrayBuffer();
        let nativeSr = 0;
        try {
          nativeSr = readWavSampleRate(ab);
        } catch (ex) {}
        let tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
        let decoded;
        try {
          decoded = await tmpCtx.decodeAudioData(ab.slice(0));
        } catch (err) {
          log("Decode error: " + err.message, "err");
          tmpCtx.close();
          return;
        }
        tmpCtx.close();
        const detectedSr = nativeSr || decoded.sampleRate;
        let finalBuf = decoded;
        if (detectedSr !== decoded.sampleRate && detectedSr > 0) {
          try {
            const tmpCtx2 = new (
              window.AudioContext || window.webkitAudioContext
            )({ sampleRate: detectedSr });
            try {
              finalBuf = await tmpCtx2.decodeAudioData(ab.slice(0));
              tmpCtx2.close();
            } catch (ex) {
              tmpCtx2.close();
              finalBuf = decoded;
            }
          } catch (ex) {
            finalBuf = decoded;
          }
        }
        audioBuffer = finalBuf;
        sampleRate = audioBuffer.sampleRate;
        duration = audioBuffer.duration;
        const len = audioBuffer.length,
          nch = audioBuffer.numberOfChannels;
        rawSamples = new Float32Array(len);
        for (let c = 0; c < nch; c++) {
          const ch = audioBuffer.getChannelData(c);
          for (let i = 0; i < len; i++) rawSamples[i] += ch[i];
        }
        if (nch > 1) for (let i = 0; i < len; i++) rawSamples[i] /= nch;

        // Snapshot the pristine mono signal and reset the edit chain so a fresh
        // import always starts unedited.
        origSamples = rawSamples;
        origSampleRate = sampleRate;
        audioEdits = [];
        $("infoCh").textContent = nch;
        $("pkStatus").textContent =
          "Audio loaded — set parameters and click Detect Peaks";

        log(
          "Decoded " +
            len.toLocaleString() +
            " samples @ " +
            sampleRate +
            " Hz, Nyquist=" +
            fmtHz(sampleRate / 2),
          "ok",
        );

        // Reset edit-panel UI to defaults for the new file, then build.
        resetEditUiForNewFile();
        // Build rawSamples/duration/audioBuffer from the (currently empty) edit
        // chain and run the full downstream recompute + view reset.
        rebuildAudioFromEdits({ resetView: true });
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

      // ── Edit chain helpers ──────────────────────────────────────────────
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
        log("Trim mode — drag the two handles, then Confirm Trim.", "info");
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
        if (typeof refreshAnnotList === "function") refreshAnnotList();
        const sx = $("btnSaveSpectralExcel");
        if (sx) sx.disabled = true;
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
        ].forEach((id) => {
          const el = $(id);
          if (el) el.disabled = !has;
        });
        // Trim Reset only meaningful when a trim is applied.
        const ct = $("btnClearTrim");
        if (ct) ct.disabled = !has || !audioHasEdit("trim");
        const st = $("editStatus");
        if (st) {
          if (!has) {
            st.textContent = "Load audio to enable editing.";
          } else if (trimMode) {
            st.textContent = "Trim mode active — drag handles, then confirm.";
          } else {
            const parts = [];
            const tr = audioEdits.find((e) => e.type === "trim");
            if (tr)
              parts.push(
                "trim " + tr.t0.toFixed(3) + "–" + tr.t1.toFixed(3) + "s",
              );
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
      function reprocessSpec() {
        if (rawSamples) {
          computeSpectrogram();
          computeSpectralCentroid();
          render();
          renderMinimap();
        }
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
        if ($("showAnnots").checked) {
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
        if ($("showDets").checked) {
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
        const y1 = src === "spec" ? Math.min(d.y0, d.y1) : 0;
        const y2 = src === "spec" ? Math.max(d.y0, d.y1) : H;
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
        if (!rawSamples) return;
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
        // Draw annotations on minimap
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
      document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")
          return;
        if (e.key === "s" || e.key === "S") setTool("select");
        if (e.key === "a" || e.key === "A") setTool("annotate");
        if (e.key === "h" || e.key === "H") setTool("pan");
        if (e.key === " ") {
          e.preventDefault();
          togglePlay();
        }
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
            if (trimDrag) {
              // Drag the active handle; keep t0 < t1 with a small min gap.
              const minGap = 0.001;
              let nt = Math.max(0, Math.min(duration, t));
              if (trimDrag === "t0")
                trimSel.t0 = Math.min(nt, trimSel.t1 - minGap);
              else trimSel.t1 = Math.max(nt, trimSel.t0 + minGap);
              trimSel.t0 = Math.max(0, trimSel.t0);
              trimSel.t1 = Math.min(duration, trimSel.t1);
              updateTrimReadout();
              render();
            } else if (panState) {
              // Pan the view by dragging empty space (lets you zoom + scroll
              // to position handles precisely).
              const W = getVizWidth();
              const dx = e.offsetX - panState.startX;
              const dtPerPx = viewDur / W;
              setViewStart(panState.startViewStart - dx * dtPerPx);
              c.style.cursor = "grabbing";
            } else {
              // Hover feedback: resize cursor near a handle, else a grab hand.
              c.style.cursor =
                trimHandleHit(e.offsetX) !== null ? "ew-resize" : "grab";
            }
            return; // trim mode suppresses other tools
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
            // Grab a handle only if the click is genuinely near a VISIBLE one.
            // Clicking empty space pans the view (so you can zoom in and
            // navigate to place each handle precisely).
            const which = trimHandleHit(e.offsetX);
            if (which !== null) {
              trimDrag = which;
              c.style.cursor = "ew-resize";
              render();
            } else {
              panState = { startX: e.offsetX, startViewStart: viewStart };
              c.style.cursor = "grabbing";
            }
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
              playPos = Math.max(0, Math.min(duration, t));
              $("timeDisp").textContent = playPos.toFixed(3) + " s";
              if (isPlaying) {
                pausePb();
                startPb();
              }
              render();
            }
          }
        });
        c.addEventListener("mouseup", (e) => {
          if (trimMode) {
            trimDrag = null;
            panState = null;
            c.style.cursor =
              trimHandleHit(e.offsetX) !== null ? "ew-resize" : "grab";
            render();
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
            const nyq = sampleRate / 2;
            // When drawn on waveform, freq covers full range (0–Nyquist)
            // When drawn on spectrogram, use the actual drawn freq bounds
            const aFlo = src === "wave" ? 0 : Math.max(0, fLo);
            const aFhi = src === "wave" ? nyq : Math.min(nyq, fHi);
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
      function deleteAnnot(id) {
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
        annotations = [];
        detections = [];
        detMeasurements = [];
        spectralMetricsRows = null;
        selAid = null;
        $("btnExport").disabled = true;
        $("detCount").textContent = "";
        $("detBadge").textContent = "";
        $("measHead").innerHTML = "";
        $("measBody").innerHTML = "";
        $("summaryCards").style.display = "none";
        $("btnSaveSpectralExcel").disabled = true;
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
        const enabled = rawSamples && annotations.length;
        if (_compute) _compute.disabled = !enabled;
        if (_save) _save.disabled = true;
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
          for (const si of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
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
        for (const rm of xml.matchAll(
          /<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g,
        )) {
          const rNum = +rm[1];
          if (rNum > maxRow) maxRow = rNum;
          for (const cm of rm[2].matchAll(
            /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g,
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
            if (ref) cells.push({ col: ref, row: rNum, val });
          }
        }
        if (!cells.length) return [];
        // Header from row 1; map column letters → header names.
        const headerCells = cells
          .filter((c) => c.row === 1)
          .sort((a, b) => _colNum(a.col) - _colNum(b.col));
        const colName = {};
        headerCells.forEach((c) => {
          colName[c.col] = c.val;
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
            // numeric coercion
            const num =
              raw !== "" && raw !== null && !isNaN(raw) ? Number(raw) : raw;
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
        saveSpectralMetricsExcel();
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
        }));

        renderMeasTable();

        const saveBtn = $("btnSaveSpectralExcel");
        if (saveBtn) saveBtn.disabled = false;
        log(
          "Computed spectral metrics for " +
            spectralMetricsRows.length +
            " selections. See Measurements pane; Save Excel when ready.",
          "ok",
        );
      }

      function saveSpectralMetricsExcel() {
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

        try {
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

          const bytes = _buildXlsx([
            ["Spectral_Analysis", rows],
            ["Summary", summary],
            ["Info", meta],
          ]);
          const stamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, "-");
          dlFile(
            "spectral_analysis_" + stamp + ".xlsx",
            bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
          log("Saved spectral analysis for " + rows.length + " rows", "ok");
        } catch (e) {
          log("Spectral export failed: " + e.message, "err");
        }
      }

      // Compute fixed-resolution spectral metrics for a single time window
      // [start,end] (seconds). Returns an object of spectral features in kHz, or
      // null if audio isn't loaded. Used by both the measurement table and the
      // per-selection spectral export, so the maths lives in exactly one place.
      function computeSpectralMetrics(start, end) {
        if (!rawSamples) return null;
        const fftN = measFftSize();
        const bins = fftN >> 1;
        const binHz = sampleRate / fftN;
        const win = hannWin(fftN);
        const hop = Math.max(1, fftN >> 2);
        const n = rawSamples.length;
        const khz3 = (hz) => Math.round((hz / 1000) * 1000) / 1000;

        // Welch-style averaged power spectrum over the window (zero-padded single
        // frame if the window is shorter than one FFT).
        const s0 = Math.max(0, Math.round(start * sampleRate));
        const s1 = Math.min(n, Math.round(end * sampleRate));
        const span = s1 - s0;
        const spec = new Float32Array(bins);
        let frames = 0;
        const re = new Float32Array(fftN),
          im = new Float32Array(fftN);
        const addFrame = (off) => {
          re.fill(0);
          im.fill(0);
          for (let i = 0; i < fftN; i++) {
            const si = off + i;
            re[i] = si >= 0 && si < n ? rawSamples[si] * win[i] : 0;
          }
          fft(re, im, fftN);
          for (let b = 0; b < bins; b++)
            spec[b] += re[b] * re[b] + im[b] * im[b];
          frames++;
        };
        if (span >= fftN) {
          for (let off = s0; off + fftN <= s1; off += hop) addFrame(off);
          if (frames === 0) addFrame(s1 - fftN);
        } else {
          const centre = Math.round((s0 + s1) / 2);
          addFrame(centre - (fftN >> 1));
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
          peak_freq_khz: khz3(peakFreq),
          freq_min_khz: khz3(freqMin20),
          freq_max_khz: khz3(freqMax20),
          bw_20db_khz: khz3(freqMax20 - freqMin20),
          bw_10db_khz: khz3(bw10),
          spec_centroid_khz: khz3(specCent),
          iq_bw_khz: khz3(iqBw),
          spec_entropy: Math.round(entNorm * 1e4) / 1e4,
          spec_flatness: Math.round(flatness * 1e4) / 1e4,
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

      function renderMeasTable() {
        if (!detMeasurements.length) return;
        const cols = [
          { k: "n", lbl: "#" },
          { k: "start", lbl: "Start (s)", fmt: (v) => v.toFixed(4) },
          { k: "end", lbl: "End (s)", fmt: (v) => v.toFixed(4) },
          { k: "dur_ms", lbl: "Dur (ms)", fmt: (v) => v.toFixed(2) },
          {
            k: "gap_ms",
            lbl: "Gap (ms)",
            fmt: (v) => (v !== null ? v.toFixed(2) : "—"),
          },
          {
            k: "peak_freq_khz",
            lbl: "Peak Freq (kHz)",
            fmt: (v) => v.toFixed(3),
          },
          {
            k: "freq_min_khz",
            lbl: "Freq Min -20dB (kHz)",
            fmt: (v) => v.toFixed(3),
          },
          {
            k: "freq_max_khz",
            lbl: "Freq Max -20dB (kHz)",
            fmt: (v) => v.toFixed(3),
          },
          { k: "bw_20db_khz", lbl: "BW -20dB (kHz)", fmt: (v) => v.toFixed(3) },
          { k: "bw_10db_khz", lbl: "BW -10dB (kHz)", fmt: (v) => v.toFixed(3) },
          {
            k: "spec_centroid_khz",
            lbl: "Centroid (kHz)",
            fmt: (v) => v.toFixed(3),
          },
          { k: "iq_bw_khz", lbl: "IQ BW (kHz)", fmt: (v) => v.toFixed(3) },
          { k: "spec_entropy", lbl: "Entropy", fmt: (v) => v.toFixed(4) },
          { k: "spec_flatness", lbl: "Flatness", fmt: (v) => v.toFixed(4) },
        ];
        const thead = $("measHead");
        thead.innerHTML = "";
        cols.forEach((c) => {
          const th = document.createElement("th");
          th.textContent = c.lbl;
          thead.appendChild(th);
        });
        const tbody = $("measBody");
        tbody.innerHTML = "";
        detMeasurements.forEach((m) => {
          const tr = document.createElement("tr");
          cols.forEach((c) => {
            const td = document.createElement("td");
            td.textContent = c.fmt ? c.fmt(m[c.k]) : m[c.k];
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
      async function dlFile(defaultFilename, content, mimeType) {
        try {
          const extension = defaultFilename.split(".").pop();
          let finalDefaultPath = defaultFilename;

          if (currentAudioFileName) {
            const baseAudioName = currentAudioFileName.replace(/\.[^/.]+$/, "");

            // Smart intercept: match the appendix to what the original export called
            let appendix = "";
            if (defaultFilename.includes("spectral_analysis"))
              appendix = "_spectral_analysis";
            else if (defaultFilename.includes("temporal_analysis"))
              appendix = "_temporal_analysis";
            else if (defaultFilename.includes("measurements"))
              appendix = "_measurements";
            else if (defaultFilename.includes("detections"))
              appendix = "_detections";
            else if (extension === "xlsx") appendix = "_results";

            const outputName = `${baseAudioName}${appendix}.${extension}`;
            if (currentAudioFileFolder) {
              const sep = currentAudioFileFolder.includes("\\") ? "\\" : "/";
              finalDefaultPath = `${currentAudioFileFolder}${sep}${outputName}`;
            } else {
              finalDefaultPath = outputName;
            }
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
        sourceNode.buffer = audioBuffer;
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
        playPos += audioCtx.currentTime - playT0;
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
      function animPH() {
        if (!isPlaying) return;
        playPos = playOff + (audioCtx.currentTime - playT0);
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
        const legendSizePt = parseFloat($("plotLegendSize").value) || 11;
        const tickSizePt = parseFloat($("plotTickSize").value) || 9;
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
          ctx.fillText("Frequency (Hz)", 0, 0);
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
          if (useMs) {
            lbl = Math.round(elapsed * 1000) + "ms";
          } else {
            const dec =
              tStep >= 1 ? 0 : tStep >= 0.1 ? 1 : tStep >= 0.01 ? 2 : 3;
            lbl = elapsed.toFixed(dec) + "s";
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
          const lbl =
            f >= 1000
              ? (f / 1000).toFixed(f % 1000 === 0 ? 0 : 1) + "k"
              : f.toFixed(0);
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
        ctx.fillText("Frequency (Hz)", 0, 0);
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
          ctx.fillStyle = FG2;
          ctx.fillText(info, ML + specW, specTop + specH - 3 * D2);
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
      function switchMainTab(name, el) {
        ["analyzer", "plot", "peaks"].forEach((n) => {
          const t = $("maintab-" + n);
          if (t) t.classList.toggle("active", n === name);
        });
        const a = $("mainview-analyzer");
        const p = $("mainview-plot");
        const k = $("mainview-peaks");
        const sb = $("sidebar");
        if (a) a.style.display = name === "analyzer" ? "flex" : "none";
        if (p) p.style.display = name === "plot" ? "flex" : "none";
        if (k) k.style.display = name === "peaks" ? "flex" : "none";
        // Sidebar is only relevant for the Analyzer
        if (sb) sb.style.display = name === "analyzer" ? "flex" : "none";
        if (name === "peaks")
          setTimeout(() => {
            if (pkEnv) pkDrawEnvelope();
          }, 50);
        if (name === "analyzer")
          setTimeout(() => {
            render();
          }, 50);
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

      // ═══════════════════════════════════════════════════════════════════
      // INIT
      // ═══════════════════════════════════════════════════════════════════
      window.addEventListener("resize", () => {
        if (rawSamples) render();
        else renderMinimap();
      });
      window.addEventListener("load", () => {
        // Initialize main tab state
        switchMainTab("analyzer", $("maintab-analyzer"));
        makePointer("waveI", "wave");
        makePointer("specI", "spec");
        initDragHandles();
        initMinimap();
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
          // First require that nothing in the window strictly exceeds cv.
          let isMax = true,
            minV = cv;
          for (let j = i - winSamp; j <= i + winSamp; j++) {
            if (env[j] > cv) {
              isMax = false;
              break;
            }
            if (env[j] < minV) minV = env[j];
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
          // not be higher (they can't be, given isMax), and prominence must hold.
          if (cv - minV >= peakThr) {
            const centre = Math.round((pStart + pEnd) / 2);
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

      // ── Arch detection helper ───────────────────────────────────────────
      function pkLinSlope(amps) {
        // slope of linear fit over array of amplitudes
        const n = amps.length;
        if (n < 2) return 0;
        const mx = amps.reduce((s, v) => s + v, 0) / n;
        const xi = (n - 1) / 2; // mean x = (0+1+...+n-1)/n
        let num = 0,
          den = 0;
        for (let i = 0; i < n; i++) {
          num += (i - xi) * (amps[i] - mx);
          den += (i - xi) * (i - xi);
        }
        return den > 0 ? num / den : 0;
      }

      // ── Group peaks into trains ─────────────────────────────────────────
      function pkGroupTrains(
        peaks,
        maxGapMs,
        maxDiffPct,
        archEnable,
        archHard,
        archK,
        archDropPct,
      ) {
        if (!peaks.length) return [];
        const maxGap = maxGapMs / 1000;
        const maxDiff = maxDiffPct != null ? maxDiffPct / 100 : null;
        const dropFrac = archDropPct / 100;

        const trains = [];
        let cur = [peaks[0]];
        let archMax = peaks[0].amp;
        let archPhase = "rising"; // 'rising' | 'peaked' | 'falling'

        const flushTrain = (nextPeak) => {
          trains.push([...cur]);
          cur = nextPeak ? [nextPeak] : [];
          archMax = nextPeak ? nextPeak.amp : 0;
          archPhase = "rising";
        };

        for (let i = 1; i < peaks.length; i++) {
          const prev = peaks[i - 1],
            curr = peaks[i];
          const timeGap = curr.time - prev.time;
          const ampDrop =
            maxDiff != null &&
            prev.amp > curr.amp &&
            prev.amp - curr.amp > maxDiff;

          // Update arch state
          if (archEnable && cur.length >= archK) {
            const recent = cur.slice(-archK).map((p) => p.amp);
            const slope = pkLinSlope(recent);
            if (archPhase === "rising" && slope < -0.005) {
              archPhase = "peaked";
              archMax = Math.max(...cur.map((p) => p.amp));
            }
            if (archPhase === "peaked" && slope < -0.005) {
              archPhase = "falling";
            }
          }
          if (curr.amp > archMax) {
            archMax = curr.amp;
            archPhase = "rising";
          }

          const archSplit =
            archEnable &&
            archPhase === "falling" &&
            curr.amp < archMax * (1 - dropFrac) &&
            cur.length >= archK;

          const doSplit = timeGap > maxGap || ampDrop || archSplit;

          if (doSplit) {
            flushTrain(curr);
          } else {
            cur.push(curr);
            if (curr.amp > archMax) archMax = curr.amp;
          }
        }
        if (cur.length) trains.push(cur);
        return trains;
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
        "pkMaxGap",
        "pkMaxDiff",
        "pkMinPeaks",
        "pkArchEnable",
        "pkArchHard",
        "pkArchK",
        "pkArchDrop",
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
          archHard: $("pkArchHard").checked,
          archK: parseInt($("pkArchK").value) || 3,
          archDrop: parseFloat($("pkArchDrop").value) || 30,
          maxTrainGapMs: parseFloat($("pkMaxTrainGap").value) || 300,
          minPeaks: parseInt($("pkMinPeaks").value) || 3,
          useMotifSeq: $("pkMotifSeq").checked,
          maxMotifGapMs: parseFloat($("pkMaxMotifGap").value) || 800,
        };
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
          P.archHard,
          P.archK,
          P.archDrop,
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
        pkUpdateSelectionButtons();
        pkDrawEnvelope();
      }

      // ── Main detect ─────────────────────────────────────────────────────
      function pkDetect() {
        if (!rawSamples) {
          log("Load audio first", "warn");
          return;
        }
        pkConfirmed = false;
        $("pkResults").style.display = "none";

        const P = pkReadParams();

        pkEnv = pkComputeEnv(P.smoothMs);
        const rawPeaks = pkFindPeaks(
          pkEnv,
          P.winMs,
          P.peakThr,
          P.detThr,
          P.linkThr,
          P.maxGapMs,
        );
        pkPeaks = rawPeaks;
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
          " peaks → " +
          filtered.length +
          " trains → " +
          rawMotifs.length +
          " motifs";
        $("btnPkConfirm").disabled = rawPeaks.length === 0;
        const applyBtn = $("btnPkApplySpectral");
        if (applyBtn) applyBtn.disabled = rawPeaks.length === 0;

        pkDrawEnvelope();
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
        if (!pkEnv) return;

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
        const iw = Math.max(1, Math.round(pw));
        const img = ctx.createImageData(iw, Math.round(ph));
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
        ctx.putImageData(img, Math.round(padL), 0);
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
        if (!pkEnv) return;
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
        // Insert keeping pkPeaks sorted by time
        let lo = 0;
        while (lo < pkPeaks.length && pkPeaks[lo].time < np.time) lo++;
        // If the insertion point is between two trains, assign the new peak to the
        // nearest one rather than always attaching it to the left train.
        if (lo > 0 && lo < pkPeaks.length && pkPeaks[lo - 1].splitAfter) {
          const leftDist = np.time - pkPeaks[lo - 1].time;
          const rightDist = pkPeaks[lo].time - np.time;
          if (leftDist <= rightDist) {
            // assign to left train: move the boundary to the new peak
            np.splitAfter = true;
            pkPeaks[lo - 1].splitAfter = false;
          } else {
            // assign to right train: keep the old boundary before the new peak
            np.splitAfter = false;
          }
        } else if (lo > 0) {
          np.splitAfter = pkPeaks[lo - 1].splitAfter;
        }
        pkPeaks.splice(lo, 0, np);
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
      function pkMerge(i, dir) {
        const p = pkPeaks[i];
        if (!p) return;
        if (dir === "right") {
          if (i + 1 >= pkPeaks.length) {
            pkLiveUpdate("no peak to the right");
            return;
          }
          p.splitAfter = false;
          pkLiveUpdate("merged right");
        } else {
          if (i - 1 < 0) {
            pkLiveUpdate("no peak to the left");
            return;
          }
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
        pkPeaks[i - 1].splitAfter = true;
        pkLiveUpdate("split left");
      }
      function pkSplitRight(i) {
        if (i + 1 >= pkPeaks.length) {
          pkLiveUpdate("no peak to the right");
          return;
        }
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
          pkPeaks[i - 1].splitAfter = false; // join with left
          if (i + 1 < pkPeaks.length) pkPeaks[i].splitAfter = true; // end the train here
          pkLiveUpdate("assigned to left train");
        } else {
          if (i + 1 >= pkPeaks.length) {
            pkLiveUpdate("no train to the right");
            return;
          }
          if (i - 1 >= 0) pkPeaks[i - 1].splitAfter = true; // cut from left
          pkPeaks[i].splitAfter = false; // join with right
          pkLiveUpdate("assigned to right train");
        }
      }

      // Remove a peak. The two gaps around it collapse into one; a boundary is
      // preserved if either side had one, so trains never accidentally merge.
      function pkRemovePeak(i) {
        const p = pkPeaks[i];
        if (!p) return;
        if (pkSelection.has(p)) pkSelection.delete(p);
        const prev = pkPeaks[i - 1];
        if (prev) prev.splitAfter = prev.splitAfter || p.splitAfter;
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
        for (let i = lo; i < hi; i++) pkPeaks[i].splitAfter = false;
        pkLiveUpdate("joined within selection");
      }
      function pkBulkRemove() {
        const idxs = pkSelectionIndices();
        if (!idxs.length) return;
        // Remove from the end so earlier indices stay valid; preserve boundaries.
        for (let k = idxs.length - 1; k >= 0; k--) {
          const i = idxs[k];
          const prev = pkPeaks[i - 1];
          if (prev) prev.splitAfter = prev.splitAfter || pkPeaks[i].splitAfter;
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
        }
      });

      // ── Confirm & compute metrics ───────────────────────────────────────
      function pkConfirm() {
        if (!pkPeaks.length) return;
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

        // ── Build peak_data ──────────────────────────────────────────────
        pkPeakData = [];
        motifs.forEach((motif, mi) => {
          motif.forEach((train, ti) => {
            train.forEach((p, pi) => {
              const prevP = pi > 0 ? train[pi - 1] : null;
              const period = prevP ? p.time - prevP.time : null;
              pkPeakData.push({
                motif_id: mi + 1,
                train_id: ti + 1,
                peak_id: pi + 1,
                peak_time: round4(p.time),
                peak_period_ms: period !== null ? round4(period * 1000) : null,
                peak_amp: round4(p.amp),
              });
            });
          });
        });

        // ── Build train_data ─────────────────────────────────────────────
        pkTrainData = [];
        motifs.forEach((motif, mi) => {
          motif.forEach((train, ti) => {
            const times = train.map((p) => p.time);
            const amps = train.map((p) => p.amp);
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
              motif_id: mi + 1,
              train_id: ti + 1,
              train_start: round4(start),
              train_end: round4(end),
              train_dur_ms: round4(dur * 1000),
              n_peaks: nPeaks,
              peak_rate_hz: rate,
              mean_amp: meanAmp,
              tem_exc: temExc,
              dyn_exc: dynExc,
              train_gap_ms: gap !== null ? round4(gap * 1000) : null,
            });
          });
        });

        // ── Build motif_data ─────────────────────────────────────────────
        pkMotifData = [];
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
          // PCI: proportions of train durations and gaps within motif
          const props = [];
          myTrains.forEach((t, i) => {
            props.push(t.train_dur_ms / 1000 / mDur);
            if (t.train_gap_ms !== null && i < myTrains.length - 1)
              props.push(t.train_gap_ms / 1000 / mDur);
          });
          const propsFiltered = props.filter((v) => v > 0);
          const propsMean = mean(propsFiltered);
          const propsSD = sd(propsFiltered);
          const propsCV = propsMean > 0 ? propsSD / propsMean : 0;
          const propsEnt = -propsFiltered.reduce(
            (s, v) => s + v * Math.log(v),
            0,
          );
          const pci = round4(
            (propsEnt * propsCV + Math.sqrt(nTrains)) / (Math.sqrt(mDur) + 1),
          );
          // Gap to next motif
          const nextMotif = motifs[mi + 1];
          const mGap = nextMotif
            ? round4(pkClampT(nextMotif[0][0].time - pad) - mEnd)
            : null;
          pkMotifData.push({
            motif_id: mi + 1,
            motif_start: round4(mStart),
            motif_end: round4(mEnd),
            motif_dur_s: round4(mDur),
            motif_gap_s: mGap,
            n_trains: nTrains,
            train_rate_hz: trainRate,
            duty_cycle_pct: dutyCycle,
            tem_exc_mean: temExcMean,
            dyn_exc_mean: dynExcMean,
            props_ent: round4(propsEnt),
            props_cv: round4(propsCV),
            pci,
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
          n_peaks: pkPeakData.length,
          n_trains: pkTrainData.length,
          n_motifs: pkMotifData.length,
          pci_mean: round4(mean(pkMotifData.map((m) => m.pci))),
          pci_sd: round4(sd(pkMotifData.map((m) => m.pci))),
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
          peak_rate_mean: round4(mean(pkTrainData.map((t) => t.peak_rate_hz))),
          peak_rate_sd: round4(sd(pkTrainData.map((t) => t.peak_rate_hz))),
          tem_exc_mean: round4(mean(pkTrainData.map((t) => t.tem_exc))),
          tem_exc_sd: round4(sd(pkTrainData.map((t) => t.tem_exc))),
          dyn_exc_mean: round4(mean(pkTrainData.map((t) => t.dyn_exc))),
          dyn_exc_sd: round4(sd(pkTrainData.map((t) => t.dyn_exc))),
        };

        pkConfirmed = true;
        $("btnPkConfirm").disabled = false;
        $("pkResults").style.display = "";
        $("pkTabBtnMotSeq").style.display = useMotifSeq ? "" : "none";
        pkShowTable("peak");
        pkRenderSummaryCards();
        $("pkStatus").textContent =
          "✓ " +
          pkPeakData.length +
          " peaks | " +
          pkTrainData.length +
          " trains | " +
          pkMotifData.length +
          " motifs";
        pkDrawEnvelope();
      }

      // ── Helpers ──────────────────────────────────────────────────────────
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
          { lbl: "PCI (mean)", v: pkSummaryData.pci_mean },
          { lbl: "Duty cycle %", v: pkSummaryData.duty_cycle_mean },
          { lbl: "Peak rate (Hz)", v: pkSummaryData.peak_rate_mean },
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
      function pkExportAll() {
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

        try {
          const bytes = _buildXlsx(sheets);
          const stamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, "-");
          dlFile(
            "Rthoptera_temporal_analysis_" + stamp + ".xlsx",
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
            if (v === null || v === undefined || v === "") {
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
          "</sheets></workbook>";

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