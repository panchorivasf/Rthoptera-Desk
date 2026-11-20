// Field records -> recordings.
//
// Rthoptera Field (the iPhone companion app) saves one folder per recording
// site: <name>.json (+ .jpg satellite picture, _note.m4a voice note, .wav sound).
// The phone also shares the whole folder as one .zip. This window reads those
// (several at once), finds which loaded recording each one belongs to by TIME,
// and writes the site metadata into those recordings.
//
// Time matching. A record made in "Metadata Only" is a MARK: one instant (mark_utc),
// tapped whenever the person likes, with no start or stop. Each loaded recording is
// paired with the NEAREST mark in time: the mark inside the recording's own time span, or
// else the one closest to it, as long as it is within the tolerance. A record made with
// "Record with Phone" has the real start and stop of its recording (the same rule applies
// to that window), and its sound can be opened directly.
// The recorder's clock may differ from the phone's: recorder_clock_offset_s (recorder
// minus phone, seconds) is subtracted. A recording's own start time is read, in this order, from:
//   1. the AudioMoth comment in the WAV ("Recorded at 14:30:05 20/11/2026 (UTC-3)")
//   2. the BWF "bext" chunk (Zoom recorders and others: date and time, no zone,
//      taken as the zone of the phone record)
//   3. the time written in the file name, 4. the file's modified date minus its duration
// The user chooses which of these to trust (the "recording time from" list): the
// first available one in the order above (automatic), or only the file name, only the
// file date, or only the WAV header. These functions are plain (no DOM) so they can be
// tested outside the app.

// ───────────────────────── time of a recording ─────────────────────────

function fiAscii(v, off, n) {
  let s = "";
  for (let i = 0; i < n && off + i < v.byteLength; i++) {
    const c = v.getUint8(off + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

// Reads the time stamps a WAV carries about itself. ab: ArrayBuffer.
// -> { bext: {wallMs}|null, moth: {absMs}|null }
// wallMs is the clock reading taken as if it were UTC (no zone known);
// absMs is a real instant.
function fiWavTimes(ab) {
  const out = { bext: null, moth: null };
  let v;
  try {
    v = new DataView(ab);
    if (v.byteLength < 12 || fiAscii(v, 0, 4) !== "RIFF" || fiAscii(v, 8, 4) !== "WAVE") return out;
  } catch (e) {
    return out;
  }
  let pos = 12;
  while (pos + 8 <= v.byteLength) {
    const id = fiAscii(v, pos, 4);
    const size = v.getUint32(pos + 4, true);
    const body = pos + 8;
    if (size === 0xffffffff) break;
    if (id === "bext" && body + 338 <= v.byteLength) {
      const d = /^(\d{4})[-:/](\d{2})[-:/](\d{2})$/.exec(fiAscii(v, body + 320, 10));
      const t = /^(\d{2})[-:.](\d{2})[-:.](\d{2})$/.exec(fiAscii(v, body + 330, 8));
      if (d && t) out.bext = { wallMs: Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]) };
    } else if (id === "LIST" && body + 4 <= v.byteLength && fiAscii(v, body, 4) === "INFO") {
      let p = body + 4;
      const end = Math.min(v.byteLength, body + size);
      while (p + 8 <= end) {
        const sid = fiAscii(v, p, 4);
        const ssz = v.getUint32(p + 4, true);
        if (sid === "ICMT") {
          const m = fiMothComment(fiAscii(v, p + 8, Math.min(ssz, 512)));
          if (m) out.moth = m;
        }
        p += 8 + ssz + (ssz & 1);
      }
    }
    pos = body + size + (size & 1);
  }
  return out;
}

// "Recorded at 14:30:05 20/11/2026 (UTC-3) by AudioMoth 24E144..." -> {absMs}
function fiMothComment(s) {
  const m = /Recorded at (\d{2}):(\d{2}):(\d{2}) (\d{2})\/(\d{2})\/(\d{4}) \(UTC([+-]\d{1,2})?(?::(\d{2}))?\)/.exec(s || "");
  if (!m) return null;
  const hh = m[7] ? parseInt(m[7], 10) : 0;
  const mm = m[8] ? parseInt(m[8], 10) : 0;
  const offMin = (hh < 0 || /^-/.test(m[7] || "") ? -1 : 1) * (Math.abs(hh) * 60 + mm);
  const wall = Date.UTC(+m[6], +m[5] - 1, +m[4], +m[1], +m[2], +m[3]);
  return { absMs: wall - offMin * 60000 };
}

// Date and time written in a file name, as the clock reading it shows (taken as if UTC,
// the zone is not in the name). Understands 20261120_143005, 2026-11-20_14-30-05,
// 2026-11-20 14.30.05, 20261120143005 and 261120_143005 (YYMMDD_HHMMSS).
function fiNameTime(name) {
  const n = String(name || "").replace(/^.*[\\/]/, "");
  const ok = (mo, d, h, mi, se) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59 && se <= 59;
  let m = /(?:^|\D)(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[ T_.-]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})(?!\d)/.exec(n);
  if (m && ok(+m[2], +m[3], +m[4], +m[5], +m[6])) return { wallMs: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) };
  m = /(?:^|\D)(\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(?!\d)/.exec(n);
  if (m && ok(+m[2], +m[3], +m[4], +m[5], +m[6])) return { wallMs: Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) };
  return null;
}

// What is known about when a loaded recording was made.
// durS: its length in seconds; mtimeMs: the file's modified time (or 0).
function fiTimeInfo(ab, mtimeMs, durS, fileName) {
  const w = ab ? fiWavTimes(ab) : { bext: null, moth: null };
  return { bext: w.bext, moth: w.moth, name: fiNameTime(fileName), mtimeMs: mtimeMs || 0, durS: durS || 0 };
}

// Start of the recording on the PHONE's clock, in ms, and where it came from.
// tzOffMin: zone of the Field record; offsetS: recorder clock minus phone clock;
// mode: "auto" (header, then file name, then file date), "header", "name" or "stamp" (file date).
function fiFileStart(rt, tzOffMin, offsetS, mode) {
  if (!rt) return null;
  mode = mode || "auto";
  const corr = (offsetS || 0) * 1000;
  const wallToMs = (w) => w.wallMs - tzOffMin * 60000 - corr;
  if (mode === "auto" || mode === "header") {
    if (rt.moth) return { ms: rt.moth.absMs - corr, src: "AudioMoth header" };
    if (rt.bext) return { ms: wallToMs(rt.bext), src: "WAV header (bext)" };
  }
  if (mode === "auto" || mode === "name") {
    if (rt.name) return { ms: wallToMs(rt.name), src: "file name" };
  }
  if (mode === "auto" || mode === "stamp") {
    if (rt.mtimeMs) return { ms: rt.mtimeMs - rt.durS * 1000 - corr, src: "file date" };
  }
  return null;
}

// ───────────────────────── Field records ─────────────────────────

const FI_META_NAMES = {
  session: ["country", "locality", "date", "time", "temp_c", "latitude", "longitude", "elevation_m", "recorder", "microphone", "accessories"],
  specimen: ["specimen_id", "species"],
};

// Turns a parsed JSON into what Desk needs; null if it is not a metadata file.
function fiParseRecord(meta, name) {
  if (!meta || typeof meta !== "object") return null;
  const flat = { ...meta, ...(meta.recording_session || {}), ...(meta.specimen || {}) };
  if (flat.specimenId !== undefined && flat.specimen_id === undefined) flat.specimen_id = flat.specimenId;
  const has = FI_META_NAMES.session.concat(FI_META_NAMES.specimen).some((k) => flat[k] !== undefined);
  if (!has) return null;
  const fr = meta.field_record || {};
  const tzOffMin = typeof fr.timezone_offset_min === "number" ? fr.timezone_offset_min : -new Date().getTimezoneOffset();
  const startMs = fr.recording_start_utc ? Date.parse(fr.recording_start_utc) : NaN;
  const endMs = fr.recording_end_utc ? Date.parse(fr.recording_end_utc) : NaN;
  const markMs = fr.mark_utc ? Date.parse(fr.mark_utc) : NaN;
  let approx = false;
  let isMark = false;
  let s = startMs;
  let e = endMs;
  if (!isFinite(s) && isFinite(markMs)) {
    // a mark: one instant
    s = markMs;
    e = markMs;
    isMark = true;
  } else if (!isFinite(s)) {
    // no marks: only the date and time of the record, to the minute
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(flat.date || ""),
      t = /^(\d{2}):(\d{2})/.exec(flat.time || "");
    s = d && t ? Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) - tzOffMin * 60000 : NaN;
    e = s;
    approx = true;
  } else if (!isFinite(e)) e = s;
  return {
    name: name || "record",
    flat,
    fr,
    startMs: s,
    endMs: e,
    approx,
    isMark,
    mode: fr.mode || null,
    tzOffMin,
    offsetS: typeof fr.recorder_clock_offset_s === "number" ? fr.recorder_clock_offset_s : 0,
    files: { image: null, note: null, sound: null }, // { name, bytes }
  };
}

// The metadata of a record as the Desk form wants it: { session:{key:value}, specimen:{...} }
// Empty values are left out, so they never wipe what is already filled in.
function fiFormValues(rec, metaFields) {
  const out = { session: {}, specimen: {} };
  ["session", "specimen"].forEach((kind) => {
    metaFields[kind].forEach(([k, , , , f]) => {
      const v = rec.flat[f];
      if (v === undefined || v === null || v === "") return;
      out[kind][k] = v;
    });
  });
  return out;
}

// Which recordings belong to which record (mark).
// recs: parsed records; entries: [{id, name, time}] (time = fiTimeInfo); tolS: tolerance in seconds;
// mode: where the recording's time is taken from (see fiFileStart); shiftS: extra seconds added to
// every record's clock offset (a correction found later).
// The gap between a recording (from its start to its end) and a record (its mark, or its start
// to stop window) is 0 when they overlap, else the time between them. A recording goes to the
// record with the smallest gap, if that gap is within the tolerance; a tie (several marks inside
// one recording) goes to the mark closest to the recording's start.
// -> array parallel to recs of [{id, deltaS, signedS, gapS, src}], best first.
function fiMatch(recs, entries, tolS, mode, shiftS) {
  const tol = tolS * 1000;
  const best = new Map(); // entry id -> {ri, gap, delta, signed, src}
  recs.forEach((r, ri) => {
    if (!isFinite(r.startMs)) return;
    const rs = r.startMs;
    const re = Math.max(r.endMs, r.startMs);
    entries.forEach((en) => {
      const st = fiFileStart(en.time, r.tzOffMin, (r.offsetS || 0) + (shiftS || 0), mode);
      if (!st) return;
      const fe = st.ms + (en.time.durS || 0) * 1000;
      const gap = Math.max(0, st.ms - re, rs - fe);
      if (gap > tol) return;
      const signed = st.ms - rs;
      const delta = Math.abs(signed);
      const cur = best.get(en.id);
      if (!cur || gap < cur.gap - 500 || (Math.abs(gap - cur.gap) <= 500 && delta < cur.delta))
        best.set(en.id, { ri, gap, delta, signed, src: st.src });
    });
  });
  const out = recs.map(() => []);
  best.forEach((b, id) => out[b.ri].push({ id, deltaS: b.delta / 1000, signedS: b.signed / 1000, gapS: b.gap / 1000, src: b.src }));
  out.forEach((l) => l.sort((x, y) => x.deltaS - y.deltaS));
  return out;
}

// ───────────────────────── zip (what the phone shares) ─────────────────────────

// Reads a zip from its central directory: stored and deflated entries.
// -> Promise<[{name, bytes}]>
async function fiReadZip(ab) {
  const v = new DataView(ab);
  const u8 = new Uint8Array(ab);
  let eocd = -1;
  for (let i = v.byteLength - 22; i >= Math.max(0, v.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = [];
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("damaged zip directory");
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const cmtLen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + cmtLen;
    if (name.endsWith("/")) continue;
    const dataStart = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
    const raw = u8.subarray(dataStart, dataStart + csize);
    let bytes;
    if (method === 0) bytes = raw.slice();
    else if (method === 8) {
      const ds = new DecompressionStream("deflate-raw");
      const w = ds.writable.getWriter();
      w.write(raw);
      w.close();
      bytes = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    } else throw new Error("zip compression method " + method + " is not supported");
    out.push({ name, bytes });
  }
  return out;
}

// Files of one record folder -> parsed records. files: [{name, bytes}] (names may have a folder).
function fiRecordsFromFiles(files) {
  const base = (n) => n.replace(/^.*[\\/]/, "");
  const dirOf = (n) => (/[\\/]/.test(n) ? n.replace(/[\\/][^\\/]*$/, "") : "");
  const out = [];
  const dec = new TextDecoder();
  files
    .filter((f) => /\.json$/i.test(f.name))
    .forEach((f) => {
      let meta;
      try {
        meta = JSON.parse(dec.decode(f.bytes));
      } catch (e) {
        return;
      }
      const rec = fiParseRecord(meta, base(f.name).replace(/\.json$/i, ""));
      if (!rec) return;
      const dir = dirOf(f.name);
      const sib = (want) => {
        if (!want) return null;
        const hit = files.find((g) => dirOf(g.name) === dir && base(g.name) === want);
        return hit ? { name: base(hit.name), bytes: hit.bytes } : null;
      };
      rec.files.image = sib(rec.fr.satellite_image);
      rec.files.note = sib(rec.fr.voice_note);
      rec.files.sound = sib(rec.fr.sound_file);
      out.push(rec);
    });
  return out;
}

// ───────────────────────── the window ─────────────────────────

const FI = { recs: [], rows: [], urls: [], audio: null, playing: -1 };

function fiEl(id) {
  return document.getElementById(id);
}
function fiEsc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
// "12 s after the start mark" / "3 min before the start mark" / "at the start mark"
function fiRel(sec) {
  const a = Math.abs(sec);
  if (a < 1) return "at the start mark";
  const t = a >= 120 ? Math.round(a / 60) + " min" : Math.round(a) + " s";
  return t + (sec > 0 ? " after" : " before") + " the start mark";
}
// How a matched recording sits relative to a MARK: "the mark is 12 s into the recording" ...
function fiRelMark(h) {
  const t = (sec) => {
    const a = Math.abs(sec);
    return a >= 120 ? Math.round(a / 60) + " min" : Math.round(a) + " s";
  };
  if (h.gapS === 0) return "the mark is " + t(-h.signedS) + " into the recording";
  return h.signedS > 0 ? "recording starts " + t(h.signedS) + " after the mark" : "recording ended " + t(h.gapS) + " before the mark";
}
function fiPlaceName(r) {
  return [r.flat.country, r.flat.locality].filter(Boolean).join(", ");
}
function fiClock(ms) {
  return isFinite(ms) ? new Date(ms).toISOString().slice(11, 19) + " UTC" : "—";
}

function fiOpen() {
  try {
    const v = localStorage.getItem("rt_fi_src");
    if (v && [...fiEl("fiSrc").options].some((o) => o.value === v)) fiEl("fiSrc").value = v;
  } catch (e) {}
  fiEl("fiOverlay").classList.add("show");
  fiRender();
}
function fiClose() {
  fiStopNote();
  fiEl("fiOverlay").classList.remove("show");
}
function fiClear() {
  fiStopNote();
  FI.urls.forEach((u) => URL.revokeObjectURL(u));
  FI.urls = [];
  FI.recs = [];
  FI.rows = [];
  fiRender();
}
function fiUrl(file, type) {
  if (!file) return "";
  const u = URL.createObjectURL(new Blob([file.bytes], { type }));
  FI.urls.push(u);
  return u;
}

// Choose files: the native dialog when in the app (it gives paths, so the picture, voice
// note and sound next to a .json can be read too), the browser input otherwise.
async function fiPick() {
  const T = window.__TAURI__;
  if (T && T.dialog && typeof T.dialog.open === "function" && T.fs && typeof T.fs.readFile === "function") {
    let sel;
    try {
      sel = await T.dialog.open({ multiple: true, filters: [{ name: "Field records", extensions: ["zip", "json"] }] });
    } catch (e) {
      fiEl("fiStatus").textContent = "File dialog failed: " + e.message;
      return;
    }
    if (!sel) return;
    const paths = Array.isArray(sel) ? sel : [sel];
    const jobs = [];
    for (const p of paths) {
      try {
        const bytes = await T.fs.readFile(p);
        jobs.push({ name: getFilenameFromPath(p) || p, path: p, bytes: new Uint8Array(bytes) });
      } catch (e) {
        fiEl("fiStatus").textContent = "Could not read " + p + ": " + e.message;
      }
    }
    await fiIngest(jobs, async (job, want) => {
      // a loose .json: its picture / note / sound are in the same folder
      const dir = getFolderFromPath(job.path);
      const sep = job.path.indexOf("\\") >= 0 ? "\\" : "/";
      try {
        return new Uint8Array(await T.fs.readFile(dir + sep + want));
      } catch (e) {
        return null;
      }
    });
  } else fiEl("fiFile").click();
}
async function fiPickedBrowser(fileList) {
  const jobs = [];
  for (const f of fileList) jobs.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  await fiIngest(jobs, null);
  fiEl("fiFile").value = "";
}

async function fiIngest(jobs, readSibling) {
  const status = fiEl("fiStatus");
  let added = 0;
  for (const job of jobs) {
    try {
      let recs;
      if (/\.zip$/i.test(job.name)) {
        recs = fiRecordsFromFiles(await fiReadZip(job.bytes.buffer.slice(job.bytes.byteOffset, job.bytes.byteOffset + job.bytes.byteLength)));
      } else {
        recs = fiRecordsFromFiles([{ name: job.name, bytes: job.bytes }]);
        if (readSibling) {
          for (const r of recs) {
            for (const [slot, want] of [["image", r.fr.satellite_image], ["note", r.fr.voice_note], ["sound", r.fr.sound_file]]) {
              if (!want) continue;
              const b = await readSibling(job, want);
              if (b) r.files[slot] = { name: want, bytes: b };
            }
          }
        }
      }
      if (!recs.length) status.textContent = job.name + ": no Field record or metadata found in it.";
      recs.forEach((r) => {
        // the same record twice (same name) replaces the first
        const i = FI.recs.findIndex((x) => x.name === r.name);
        if (i >= 0) FI.recs.splice(i, 1);
        FI.recs.push(r);
        added++;
      });
    } catch (e) {
      status.textContent = job.name + ": " + e.message;
    }
  }
  FI.recs.sort((a, b) => a.name.localeCompare(b.name));
  fiMatchAll();
  if (added) status.textContent = added + " record(s) read.";
}

function fiLibEntries() {
  return audioLibrary.map((e) => ({ id: e.id, name: e.name, time: e.recTime || null }));
}

// (Re)computes the automatic matches; a row the user fixed by hand keeps its choice.
function fiMatchAll() {
  const tol = parseInt(fiEl("fiTol").value, 10) || 120;
  const mode = fiEl("fiSrc").value || "auto";
  try {
    localStorage.setItem("rt_fi_src", mode);
  } catch (e) {}
  const entries = fiLibEntries();
  const shift = parseFloat((fiEl("fiShift").value || "0").replace(",", ".")) || 0;
  const m = fiMatch(FI.recs, entries, tol, mode, shift);
  // recordings with no time from the chosen source cannot be matched: say so
  const none = entries.filter((en) => !fiFileStart(en.time, 0, 0, mode));
  const srcLabel = fiEl("fiSrc").selectedOptions && fiEl("fiSrc").selectedOptions[0] ? fiEl("fiSrc").selectedOptions[0].textContent : mode;
  fiEl("fiStatus").textContent = none.length
    ? none.length + " of " + entries.length + ' loaded recording(s) have no time from "' + srcLabel + '": ' + none.slice(0, 4).map((e) => e.name).join(", ") + (none.length > 4 ? ", …" : "") + ". Choose another source if they should match."
    : "";
  const old = new Map(FI.rows.map((r) => [r.rec.name, r]));
  FI.rows = FI.recs.map((rec, i) => {
    const prev = old.get(rec.name);
    if (prev && prev.manual) return { ...prev, rec };
    return { rec, use: true, manual: false, targets: m[i].map((x) => x.id), how: m[i].map((x) => x), imageUrl: prev ? prev.imageUrl : "", noteUrl: prev ? prev.noteUrl : "" };
  });
  FI.rows.forEach((r) => {
    if (!r.imageUrl && r.rec.files.image) r.imageUrl = fiUrl(r.rec.files.image, "image/jpeg");
    if (!r.noteUrl && r.rec.files.note) r.noteUrl = fiUrl(r.rec.files.note, "audio/mp4");
  });
  fiRender();
}

function fiRender() {
  const tb = fiEl("fiTable");
  if (!FI.rows.length) {
    tb.innerHTML = '<tbody><tr><td style="color:var(--txt3);padding:8px">No Field records yet. Add the .zip (or the .json) that Rthoptera Field shared from the phone.</td></tr></tbody>';
    fiEl("btnFiApply").disabled = true;
    return;
  }
  const names = new Map(audioLibrary.map((e) => [e.id, e.name]));
  const opts = (sel) =>
    '<option value="">(automatic)</option>' +
    audioLibrary.map((e) => '<option value="' + e.id + '"' + (sel === e.id ? " selected" : "") + ">" + fiEsc(e.name) + "</option>").join("");
  tb.innerHTML =
    '<thead><tr style="text-align:left"><th></th><th>Field record</th><th>Mark / recording</th><th>Recording(s)</th><th>Extras</th></tr></thead><tbody>' +
    FI.rows
      .map((r, i) => {
        const rec = r.rec;
        const w =
          (rec.isMark
            ? "⚡ mark " + fiClock(rec.startMs)
            : rec.approx
              ? "≈ " + fiClock(rec.startMs) + '<br><span style="color:var(--txt3)">no mark or recording times: matched by the time of the record</span>'
              : "● " + fiClock(rec.startMs) + " → " + fiClock(rec.endMs)) +
          (rec.offsetS ? '<br><span style="color:var(--txt3)">recorder clock ' + (rec.offsetS > 0 ? "+" : "") + rec.offsetS + " s</span>" : "");
        const got = r.targets.length
          ? r.targets.map((id) => fiEsc(names.get(id) || "?")).join("<br>") +
            (r.manual ? '<br><span style="color:var(--txt3)">chosen by hand</span>' : "<br>" + r.how.map((h) => '<span style="color:var(--txt3)">' + fiEsc(h.src) + ", " + (rec.isMark ? fiRelMark(h) : "starts " + fiRel(h.signedS)) + "</span>").join("<br>"))
          : '<span style="color:#d29922">no loaded recording matches</span>';
        const extras =
          (r.imageUrl ? '<a href="#" onclick="fiShowImage(' + i + ');return false" title="Satellite picture">🛰 picture</a> ' : "") +
          (r.noteUrl ? '<a href="#" onclick="fiPlayNote(' + i + ');return false" title="Voice note">' + (FI.playing === i ? "■ stop" : "▶ note") + "</a> " : "") +
          (rec.files.sound ? '<a href="#" onclick="fiOpenSound(' + i + ');return false" title="Open the sound recorded in Field">🎧 open sound</a>' : "");
        return (
          "<tr style=\"vertical-align:top;border-top:1px solid var(--border, #444)\"><td><input type=\"checkbox\" " + (r.use ? "checked" : "") + " onchange=\"FI.rows[" + i + "].use=this.checked;fiRender()\" /></td>" +
          "<td><b>" + fiEsc(rec.name) + "</b><br>" + fiEsc(fiPlaceName(rec)) + "<br>" + fiEsc([rec.flat.date, rec.flat.time].filter(Boolean).join(" ")) + (rec.flat.temp_c !== undefined && rec.flat.temp_c !== null && rec.flat.temp_c !== "" ? " · " + fiEsc(rec.flat.temp_c) + " °C" : "") + "</td>" +
          "<td>" + w + "</td>" +
          "<td>" + got + '<br><select onchange="fiChoose(' + i + ', this.value)" style="font-size:11px;max-width:200px">' + opts(r.manual && r.targets.length === 1 ? r.targets[0] : null) + "</select></td>" +
          "<td>" + extras + "</td></tr>"
        );
      })
      .join("") +
    "</tbody>";
  fiEl("btnFiApply").disabled = !FI.rows.some((r) => r.use && r.targets.length);
}

function fiChoose(i, v) {
  const r = FI.rows[i];
  if (!r) return;
  if (v === "") {
    r.manual = false;
    fiMatchAll();
    return;
  }
  r.manual = true;
  r.targets = [parseInt(v, 10)];
  fiRender();
}

function fiShowImage(i) {
  const r = FI.rows[i];
  if (!r || !r.imageUrl) return;
  fiEl("fiImg").src = r.imageUrl;
  fiEl("fiImgCap").textContent = r.rec.name;
  fiEl("fiImgOverlay").classList.add("show");
}
function fiStopNote() {
  if (FI.audio) {
    FI.audio.pause();
    FI.audio = null;
  }
  FI.playing = -1;
}
function fiPlayNote(i) {
  const r = FI.rows[i];
  if (!r || !r.noteUrl) return;
  if (FI.playing === i) {
    fiStopNote();
    fiRender();
    return;
  }
  fiStopNote();
  FI.audio = new Audio(r.noteUrl);
  FI.playing = i;
  FI.audio.onended = () => {
    FI.playing = -1;
    FI.audio = null;
    fiRender();
  };
  FI.audio.onerror = () => {
    fiEl("fiStatus").textContent = "The voice note could not be played on this computer.";
    FI.playing = -1;
    FI.audio = null;
    fiRender();
  };
  FI.audio.play().catch(() => {});
  fiRender();
}

// Opens the WAV recorded in Field as a recording of its own and gives it this record.
async function fiOpenSound(i) {
  const r = FI.rows[i];
  const f = r && r.rec.files.sound;
  if (!f) return;
  try {
    const ab = f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength);
    const decoded = await decodeAudioBytes(ab);
    const entry = await _ingestDecodedAudio(f.name, "", decoded, { ab, mtimeMs: 0 });
    r.manual = true;
    r.targets = r.targets.concat(entry.id).filter((x, k, a) => a.indexOf(x) === k);
    r.use = true;
    selectLibraryAudio(entry.id);
    fiRender();
    fiEl("fiStatus").textContent = '"' + f.name + '" opened in Loaded Audio.';
  } catch (e) {
    fiEl("fiStatus").textContent = "Could not open the sound: " + e.message;
  }
}

function fiApply() {
  let nRec = 0,
    nEntries = 0;
  FI.rows.forEach((r) => {
    if (!r.use || !r.targets.length) return;
    const vals = fiFormValues(r.rec, META_FIELDS);
    r.targets.forEach((id) => {
      const e = audioLibrary.find((x) => x.id === id);
      if (!e) return;
      ["session", "specimen"].forEach((kind) => {
        Object.keys(vals[kind]).forEach((k) => (e[k] = String(vals[kind][k])));
      });
      e.fieldRecord = r.rec.name;
      if (id === audioLibActiveId) {
        // the active recording goes through the form so its inputs follow
        metaFill("session", vals.session);
        metaFill("specimen", vals.specimen);
      }
      nEntries++;
    });
    nRec++;
  });
  if (typeof refreshResultsMetadata === "function") refreshResultsMetadata();
  if (typeof renderAudioLibraryPanel === "function") renderAudioLibraryPanel();
  log("Field records: metadata of " + nRec + " record(s) applied to " + nEntries + " recording(s).", "ok");
  fiClose();
}
