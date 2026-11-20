// Voice Notes Protocol: read the metadata spoken at the start (or end) of a
// field recording and fill in the Recording metadata form. Loaded after
// voice_notes.js, which supplies the transcript.
//
// The protocol is "label, then value", for example
//   begin notes. date 2026 11 20. time 14 30. latitude minus 3 8 4 5 1 2 ...
//   temperature 2 4 point 5. species Gryllus assimilis. end notes.
// Labels (English or Spanish) are looked up in the text, so the order is free
// and a skipped field does not move the others. Numbers may be spoken digit by
// digit or as words, and may arrive from the transcription as digits ("3.45")
// or as words ("three point four five"). Nothing is saved before the user has
// seen the table of what was heard and what it was read as.
//
// When coordinates were read, the country and place are looked up from them
// (OpenStreetMap Nominatim, falling back to BigDataCloud), unless they were
// spoken. That sends the coordinates to those services, so it can be switched off.

// ── text helpers ────────────────────────────────────────────────────────
function vpFold(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Cleaned tokens: {o: as written, f: folded}. Decimal commas become points,
// other punctuation becomes a separator, hyphenated words are split.
function vpTokens(text) {
  let t = String(text || "")
    .replace(/[−–—]/g, "-")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/([A-Za-zÀ-ɏ])-(?=[A-Za-zÀ-ɏ])/g, "$1 ")
    .replace(/[;!?()"“”]/g, " ")
    .replace(/,/g, " ")
    .replace(/\b([ap])\.\s?(m)\b\.?/gi, "$1$2")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/:(?!\d)/g, " ");
  return t
    .split(/\s+/)
    .filter(Boolean)
    .map((o) => ({ o, f: vpFold(o) }));
}

// ── number words ────────────────────────────────────────────────────────
const VP_UNIT = {
  zero: 0, oh: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9,
  cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
};
const VP_TEEN = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const VP_TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const VP_HUND = { doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900 };
const VP_SCALE = { hundred: 100, thousand: 1000, ciento: 100, cien: 100, mil: 1000 };
const VP_POINT = new Set(["point", "dot", "decimal", "punto", "coma"]);
const VP_MINUS = new Set(["minus", "negative", "menos"]);
const VP_DIR = { north: 1, norte: 1, east: 1, este: 1, south: -1, sur: -1, west: -1, oeste: -1 };
const VP_FILLER = new Set([
  "and", "y", "the", "of", "at", "degrees", "degree", "grados", "grado", "celsius", "centigrade", "centigrados", "meters", "metres", "meter", "metros", "metro",
  "m", "hours", "hour", "horas", "hrs", "oclock", "o'clock", "plus", "positive", "mas", "approximately", "about", "aprox", "approx", "around",
]);

function vpIsNumWord(f) {
  return f in VP_UNIT || f in VP_TEEN || f in VP_TENS || f in VP_SCALE || f in VP_HUND;
}
// A run of number words -> string of digits. With "hundred"/"thousand" it is
// read as a cardinal ("four hundred twelve" = 412); otherwise digit by digit,
// with "twenty four" kept together as 24.
function vpWordsInt(fs) {
  if (fs.some((f) => f in VP_SCALE || f in VP_HUND)) {
    let total = 0,
      cur = 0;
    for (const f of fs) {
      if (f in VP_SCALE) {
        if (VP_SCALE[f] === 1000) {
          total += (cur || 1) * 1000;
          cur = 0;
        } else cur = (cur || 1) * 100;
      } else cur += f in VP_UNIT ? VP_UNIT[f] : f in VP_TEEN ? VP_TEEN[f] : f in VP_HUND ? VP_HUND[f] : VP_TENS[f];
    }
    return String(total + cur);
  }
  let out = "";
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i];
    if (f in VP_TENS) {
      const nx = fs[i + 1];
      if (nx !== undefined && nx in VP_UNIT && VP_UNIT[nx] > 0) {
        out += String(VP_TENS[f] + VP_UNIT[nx]);
        i++;
      } else out += String(VP_TENS[f]);
    } else if (f in VP_TEEN) out += String(VP_TEEN[f]);
    else out += String(VP_UNIT[f]);
  }
  return out;
}

// Tokens -> {value, digits, dir, bad}: a signed decimal number.
function vpNumber(toks) {
  let neg = false,
    dir = 0,
    out = "",
    points = 0;
  const bad = [];
  for (let i = 0; i < toks.length; i++) {
    const f = toks[i].f;
    if (VP_MINUS.has(f)) neg = true;
    else if (f in VP_DIR) dir = VP_DIR[f];
    else if (VP_POINT.has(f)) {
      out += ".";
      points++;
    } else if (/^-?\d+(\.\d+)?$/.test(f)) {
      let d = f;
      if (d[0] === "-") {
        neg = true;
        d = d.slice(1);
      }
      if (d.includes(".")) points++;
      out += d;
    } else if (vpIsNumWord(f)) {
      const run = [f];
      for (;;) {
        const n1 = toks[i + 1],
          n2 = toks[i + 2];
        if (n1 && vpIsNumWord(n1.f)) run.push(toks[++i].f);
        else if (n1 && (n1.f === "y" || n1.f === "and") && n2 && vpIsNumWord(n2.f)) {
          i++;
          run.push(toks[++i].f);
        } else break;
      }
      out += vpWordsInt(run);
    } else if (VP_FILLER.has(f)) {
      // ignored
    } else bad.push(toks[i].o);
  }
  if (dir < 0) neg = true;
  const ok = /^\d+(\.\d+)?$/.test(out.replace(/^\./, "0.")) && points <= 1;
  const v = ok ? parseFloat(out.replace(/^\./, "0.")) * (neg ? -1 : 1) : null;
  return { value: v, digits: out.replace(/\./g, ""), dir, bad };
}

// ── date and time ───────────────────────────────────────────────────────
const VP_MONTHS = {
  january: 1, jan: 1, enero: 1, ene: 1, february: 2, feb: 2, febrero: 2, march: 3, mar: 3, marzo: 3, april: 4, apr: 4, abril: 4, abr: 4,
  may: 5, mayo: 5, june: 6, jun: 6, junio: 6, july: 7, jul: 7, julio: 7, august: 8, aug: 8, agosto: 8, ago: 8,
  september: 9, sep: 9, sept: 9, septiembre: 9, setiembre: 9, october: 10, oct: 10, octubre: 10, november: 11, nov: 11, noviembre: 11,
  december: 12, dec: 12, diciembre: 12, dic: 12,
};
function vpPad(n) {
  return (n < 10 ? "0" : "") + n;
}
// Groups of digit strings: a numeral is a group of its own, a run of number
// words is one group ("two zero two six" = 2026). Separators split groups.
function vpGroups(toks) {
  const groups = [];
  let run = [];
  const flush = () => {
    if (run.length) {
      const g = vpNumber(run.map((f) => ({ f, o: f }))).digits;
      if (g) groups.push(g);
      run = [];
    }
  };
  for (const t of toks) {
    const f = t.f.replace(/(st|nd|rd|th)$/, (m, a, off, s) => (/^\d+/.test(s) ? "" : m));
    if (/^\d$/.test(f)) run.push(f);
    else if (/^\d+$/.test(f)) {
      flush();
      groups.push(f);
    } else if (/^\d+[/-]\d+([/-]\d+)?$/.test(f)) {
      flush();
      f.split(/[/-]/).forEach((x) => groups.push(x));
    } else if (/^\d+:\d+$/.test(f)) {
      flush();
      f.split(":").forEach((x) => groups.push(x));
    } else if (vpIsNumWord(f)) run.push(f);
    else if ((f === "y" || f === "and") && run.length) continue;
    else flush();
  }
  flush();
  return groups;
}
function vpParseDate(toks) {
  const yMax = new Date().getFullYear() + 1;
  const okYear = (y) => y >= 1950 && y <= yMax;
  const mk = (y, m, d) => {
    if (!okYear(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return y + "-" + vpPad(m) + "-" + vpPad(d);
  };
  const mi = toks.findIndex((t) => t.f in VP_MONTHS);
  const g = vpGroups(toks.filter((t) => !(t.f in VP_MONTHS)));
  if (mi >= 0) {
    const m = VP_MONTHS[toks[mi].f];
    const nums = g.map((x) => parseInt(x, 10));
    const y = nums.find((n) => n >= 1000) || (nums.length > 1 ? nums.find((n) => n > 31 && n < 100) + 2000 : NaN);
    const d = nums.find((n) => n >= 1 && n <= 31);
    return mk(y, m, d);
  }
  if (g.length === 1 && g[0].length === 8) {
    const a = g[0];
    return mk(+a.slice(0, 4), +a.slice(4, 6), +a.slice(6, 8)) || mk(+a.slice(4, 8), +a.slice(2, 4), +a.slice(0, 2));
  }
  if (g.length === 3) {
    const n = g.map((x) => parseInt(x, 10));
    if (g[0].length === 4) return mk(n[0], n[1], n[2]);
    if (g[2].length === 4) return mk(n[2], n[1], n[0]) || mk(n[2], n[0], n[1]);
    if (g[2].length === 2) return mk(2000 + n[2], n[1], n[0]);
  }
  return null;
}
function vpParseTime(toks, rawText) {
  const f = vpFold(rawText);
  const pm = /\b(p\s?m|de la tarde|de la noche|in the (afternoon|evening|night))\b/.test(f) || /\bpm\b/.test(f);
  const am = /\b(a\s?m|de la manana|in the morning)\b/.test(f) || /\bam\b/.test(f);
  const body = toks.filter((t) => !/^(a|p|am|pm|m|manana|tarde|noche|morning|afternoon|evening|night|la|de|in|the)$/.test(t.f));
  const digits = vpGroups(body).join("");
  let h, mnt;
  if (digits.length <= 2 && digits.length > 0) {
    h = +digits;
    mnt = 0;
  } else if (digits.length === 3) {
    h = +digits[0];
    mnt = +digits.slice(1);
  } else if (digits.length === 4) {
    h = +digits.slice(0, 2);
    mnt = +digits.slice(2);
  } else return null;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h > 23 || mnt > 59) return null;
  return vpPad(h) + ":" + vpPad(mnt);
}

// ── fields and labels ───────────────────────────────────────────────────
// key = the name used by the Recording metadata form (META_FIELDS)
const VP_FIELDS = [
  { key: "date", label: "Date", kind: "date", words: ["date", "fecha"] },
  { key: "time", label: "Time", kind: "time", words: ["time", "hour", "hora"] },
  { key: "lat", label: "Latitude", kind: "lat", words: ["latitude", "latitud", "lat"] },
  { key: "lon", label: "Longitude", kind: "lon", words: ["longitude", "longitud", "lon"] },
  { key: "elev", label: "Elevation (m)", kind: "elev", words: ["elevation", "altitude", "elevacion", "altitud"] },
  { key: "tempC", label: "Temperature (°C)", kind: "temp", words: ["temperature", "temperatura", "temp"] },
  { key: "country", label: "Country", kind: "text", words: ["country", "pais"] },
  { key: "locality", label: "Locality", kind: "text", words: ["locality", "location", "localidad", "lugar", "ubicacion"] },
  { key: "recorder", label: "Recorder", kind: "text", words: ["recorder", "recording device", "grabadora"] },
  { key: "microphone", label: "Microphone", kind: "text", words: ["microphone", "mic", "microfono"] },
  { key: "accessories", label: "Accessories", kind: "text", words: ["accessories", "accesorios"] },
  { key: "specimenId", label: "Specimen ID", kind: "id", words: ["specimen id", "specimen number", "specimen", "especimen", "ejemplar", "id"], kindOf: "specimen" },
  { key: "species", label: "Species", kind: "species", words: ["species", "especie", "especies"], kindOf: "specimen" },
];
const VP_START = /\b(begin|start|inicio|comienzo|comienza|empieza)\s+(of\s+|de\s+)?(the\s+)?(notes?|notas?)\b/;
const VP_END = /\b(end|fin|final|termina)\s+(of\s+|de\s+)?(the\s+)?(notes?|notas?)\b/;

function vpValue(field, toks, rawText) {
  const raw = toks.map((t) => t.o).join(" ");
  const res = { raw, value: "", status: "ok", note: "" };
  if (!toks.length) return Object.assign(res, { status: "missing", note: "nothing heard after the label" });
  const num = (lo, hi, dec) => {
    const n = vpNumber(toks);
    if (n.value === null) return Object.assign(res, { status: "bad", note: "not read as a number" });
    if (n.bad.length) res.note = "ignored: " + n.bad.join(" ");
    if (n.value < lo || n.value > hi) {
      res.value = String(+n.value.toFixed(dec));
      return Object.assign(res, { status: "bad", note: "outside " + lo + " to " + hi });
    }
    res.value = String(+n.value.toFixed(dec));
    return res;
  };
  switch (field.kind) {
    case "date": {
      const d = vpParseDate(toks);
      if (!d) return Object.assign(res, { status: "bad", note: "not read as a date (say year month day)" });
      res.value = d;
      return res;
    }
    case "time": {
      const t = vpParseTime(toks, rawText);
      if (!t) return Object.assign(res, { status: "bad", note: "not read as a time (say hour minute)" });
      res.value = t;
      return res;
    }
    case "lat":
      return num(-90, 90, 6);
    case "lon":
      return num(-180, 180, 6);
    case "elev":
      return num(-500, 9000, 0);
    case "temp":
      return num(-40, 60, 1);
    case "id": {
      res.value = toks.map((t) => (vpIsNumWord(t.f) ? vpWordsInt([t.f]) : t.o)).join("").replace(/[^\w-]/g, "");
      return res;
    }
    case "species": {
      const w = toks.map((t) => t.o.replace(/[.]+$/, ""));
      res.value = w.map((x, i) => (i === 0 ? x.charAt(0).toUpperCase() + x.slice(1).toLowerCase() : x.toLowerCase())).join(" ");
      return res;
    }
    default: {
      const s = toks.map((t) => t.o).join(" ").replace(/[.,;:]+$/, "");
      res.value = s.charAt(0).toUpperCase() + s.slice(1);
      return res;
    }
  }
}

// text -> rows (one per field heard), plus the part of the text that was not
// understood as belonging to a label.
function vpParse(text) {
  let src = String(text || "");
  const f0 = vpFold(src);
  const s = VP_START.exec(f0),
    e = VP_END.exec(f0);
  if (s) src = src.slice(s.index + s[0].length);
  const f1 = vpFold(src);
  const e2 = VP_END.exec(f1);
  if (e2 && (s || e)) src = src.slice(0, e2.index);
  const toks = vpTokens(src);
  // find labels, longest phrase first
  const phrases = [];
  VP_FIELDS.forEach((fd) => fd.words.forEach((w) => phrases.push({ fd, w: w.split(" ") })));
  phrases.sort((a, b) => b.w.length - a.w.length);
  const hits = [];
  for (let i = 0; i < toks.length; i++) {
    for (const p of phrases) {
      if (p.w.every((w, k) => toks[i + k] && toks[i + k].f === w)) {
        hits.push({ fd: p.fd, i, n: p.w.length });
        i += p.w.length - 1;
        break;
      }
    }
  }
  const rows = [];
  const seen = new Set();
  hits.forEach((h, k) => {
    const from = h.i + h.n,
      to = k + 1 < hits.length ? hits[k + 1].i : toks.length;
    if (seen.has(h.fd.key)) return; // first mention wins
    seen.add(h.fd.key);
    const vt = toks.slice(from, to);
    const row = vpValue(h.fd, vt, vt.map((t) => t.o).join(" "));
    row.key = h.fd.key;
    row.label = h.fd.label;
    row.kind = h.fd.kindOf || "session";
    rows.push(row);
  });
  // fixed order, as in the form
  const order = VP_FIELDS.map((f) => f.key);
  rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const before = hits.length ? toks.slice(0, hits[0].i).map((t) => t.o).join(" ") : toks.map((t) => t.o).join(" ");
  return { rows, ignored: before };
}

// ── reverse geocoding ───────────────────────────────────────────────────
const VP_GEO_CACHE = {};
function vpTidyRegion(s) {
  return String(s || "")
    .replace(/^(regi[oó]n|provincia|province|state|estado|departamento|department)( of| del| de la| de los| de)?\s+/i, "")
    .replace(/\s+(region|province|state|department|prefecture)$/i, "")
    .trim();
}
async function vpReverseGeocode(lat, lon) {
  const key = lat.toFixed(3) + "," + lon.toFixed(3);
  if (VP_GEO_CACHE[key]) return VP_GEO_CACHE[key];
  let res = null;
  try {
    const r = await fetch(
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=14&accept-language=en&lat=" + lat + "&lon=" + lon,
    );
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const a = j.address;
    if (!a || !a.country) throw new Error("no place there");
    const place = a.hamlet || a.village || a.town || a.city || a.suburb || a.municipality || a.city_district || a.county || "";
    const region = vpTidyRegion(a.state || a.region || a.province || a.state_district || "");
    res = {
      country: a.country,
      locality: [place, region].filter((x, i, arr) => x && arr.indexOf(x) === i).join(", "),
      source: "OpenStreetMap",
    };
  } catch (e) {
    const r = await fetch(
      "https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en&latitude=" + lat + "&longitude=" + lon,
    );
    if (!r.ok) throw new Error("both lookups failed (" + e.message + ")");
    const j = await r.json();
    if (!j.countryName) throw new Error("no country at these coordinates");
    const place = j.locality || j.city || "";
    const region = vpTidyRegion(j.principalSubdivision || "");
    res = {
      country: j.countryName,
      locality: [place, region].filter((x, i, arr) => x && arr.indexOf(x) === i).join(", "),
      source: "BigDataCloud",
    };
  }
  VP_GEO_CACHE[key] = res;
  return res;
}

// ── review window ───────────────────────────────────────────────────────
const VP = { rows: [], seq: 0 };
function vpEl(id) {
  return document.getElementById(id);
}
function vpEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
function vpTranscriptText() {
  return (typeof VN !== "undefined" ? VN.ranges : [])
    .filter((r) => r.text)
    .map((r) => r.text)
    .join(" ");
}
function vpOpen() {
  vpEl("vpText").value = vpTranscriptText();
  try {
    vpEl("vpGeo").checked = localStorage.getItem("rt_vp_geo") !== "0";
  } catch (e) {}
  vpEl("vpOverlay").classList.add("show");
  vpRead();
}
function vpClose() {
  vpEl("vpOverlay").classList.remove("show");
}
function vpStatus(msg, isErr) {
  const e = vpEl("vpStatus");
  e.textContent = msg || "";
  e.style.color = isErr ? "#f85149" : "var(--txt3)";
}

function vpRead() {
  const seq = ++VP.seq;
  const p = vpParse(vpEl("vpText").value);
  VP.rows = p.rows.map((r) => Object.assign(r, { use: r.status === "ok" && r.value !== "" }));
  VP.ignored = p.ignored;
  vpRender();
  vpStatus(
    p.rows.length
      ? p.rows.length + " field(s) heard." + (p.ignored ? " Text before the first label was not used: “" + p.ignored.slice(0, 80) + "”." : "")
      : "No labels were found. Say a label, then its value (date, time, latitude, longitude, temperature, species, …).",
  );
  vpGeoLookup(seq);
}

// Country, locality and elevation from the coordinates, for whatever was not
// spoken. Two independent lookups, so one failing does not lose the other.
async function vpGeoLookup(seq) {
  const lat = VP.rows.find((r) => r.key === "lat" && !r.geo),
    lon = VP.rows.find((r) => r.key === "lon" && !r.geo);
  VP.rows = VP.rows.filter((r) => !r.geo);
  const valid = lat && lon && lat.status === "ok" && lon.status === "ok" && lat.value !== "" && lon.value !== "";
  if (!valid || !vpEl("vpGeo").checked) {
    vpRender();
    return;
  }
  const spoken = new Set(VP.rows.map((r) => r.key));
  const needPlace = !(spoken.has("country") && spoken.has("locality")),
    needElev = !spoken.has("elev");
  if (!needPlace && !needElev) return;
  const la = parseFloat(lat.value),
    lo = parseFloat(lon.value);
  VP.rows.push({ key: "wait", label: "Place / elevation", geo: true, raw: "", value: "", status: "wait", note: "looking up…", use: false, kind: "session" });
  vpRender();
  const [place, elev] = await Promise.allSettled([
    needPlace ? vpReverseGeocode(la, lo) : Promise.resolve(null),
    needElev && typeof fetchElevation === "function" ? fetchElevation(la, lo) : Promise.resolve(null),
  ]);
  if (seq !== VP.seq) return;
  VP.rows = VP.rows.filter((r) => !r.geo);
  const add = (key, label, value, note) =>
    VP.rows.push({ key, label, geo: true, raw: "from the coordinates", value, status: "ok", note, use: true, kind: "session" });
  const problems = [];
  if (needPlace) {
    if (place.status === "fulfilled" && place.value) {
      const g = place.value;
      if (!spoken.has("country")) add("country", "Country", g.country, "looked up (" + g.source + ")");
      if (!spoken.has("locality") && g.locality) add("locality", "Locality", g.locality, "looked up (" + g.source + ")");
    } else problems.push("place (" + (place.reason && place.reason.message) + ")");
  }
  if (needElev) {
    if (elev.status === "fulfilled" && typeof elev.value === "number" && isFinite(elev.value)) add("elev", "Elevation (m)", String(Math.round(elev.value)), "looked up from the coordinates");
    else if (elev.status === "rejected") problems.push("elevation (" + (elev.reason && elev.reason.message) + ")");
  }
  const order = VP_FIELDS.map((f) => f.key);
  VP.rows.sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key));
  if (problems.length) vpStatus("Could not look up the " + problems.join(" and ") + ". You can type them in the metadata window.", true);
  vpRender();
}

function vpRender() {
  const icon = { ok: "&#10003;", bad: "&#9888;", missing: "&#9888;", wait: "&hellip;" };
  const col = { ok: "#3fb950", bad: "#d29922", missing: "#d29922", wait: "var(--txt3)" };
  vpEl("vpTable").innerHTML =
    '<thead><tr><th></th><th style="text-align:left">Field</th><th style="text-align:left">Heard</th><th style="text-align:left">Read as (editable)</th><th style="text-align:left"></th></tr></thead><tbody>' +
    VP.rows
      .map(
        (r, i) =>
          '<tr><td><input type="checkbox" ' + (r.use ? "checked" : "") + (r.status === "wait" ? " disabled" : "") + ' onchange="VP.rows[' + i + '].use=this.checked" /></td>' +
          "<td>" + vpEsc(r.label) + "</td>" +
          '<td style="color:var(--txt3)">' + vpEsc(r.raw) + "</td>" +
          '<td><input type="text" value="' + vpEsc(r.value) + '" oninput="VP.rows[' + i + '].value=this.value;VP.rows[' + i + '].use=this.value!==\'\';" onchange="vpRowEdited(' + i + ')" style="width:100%;font-size:11px" /></td>' +
          '<td style="color:' + col[r.status] + '" title="' + vpEsc(r.note) + '">' + icon[r.status] + " <span style=\"font-size:10px\">" + vpEsc(r.note) + "</span></td></tr>",
      )
      .join("") +
    "</tbody>";
  vpEl("btnVpApply").disabled = !VP.rows.some((r) => r.use);
}

function vpApply() {
  const use = VP.rows.filter((r) => r.use && r.value !== "");
  if (!use.length) return;
  const session = {},
    specimen = {};
  use.forEach((r) => {
    (r.kind === "specimen" ? specimen : session)[r.key] = r.value;
  });
  const scope = vpEl("vpScope").value;
  // The active recording goes through the metadata form so its inputs follow.
  if (Object.keys(session).length) metaFill("session", session);
  if (Object.keys(specimen).length) metaFill("specimen", specimen);
  let targets = [];
  if (scope === "checked") targets = audioLibrary.filter((e) => audioLibBatchSelected.has(e.id));
  else if (scope === "all") targets = audioLibrary.slice();
  let n = 1;
  targets.forEach((e) => {
    if (e.id === audioLibActiveId) return;
    Object.keys(session).forEach((k) => (e[k] = String(session[k])));
    n++;
  });
  if (typeof refreshResultsMetadata === "function") refreshResultsMetadata();
  log("Voice notes: " + use.length + " metadata field(s) applied to " + n + " recording(s).", "ok");
  vpClose();
}
function vpGeoSetting(on) {
  try {
    localStorage.setItem("rt_vp_geo", on ? "1" : "0");
  } catch (e) {}
  vpRead();
}

// A coordinate corrected by hand: check it, and look the place and elevation
// up again for the new position.
function vpRowEdited(i) {
  const r = VP.rows[i];
  if (!r || (r.key !== "lat" && r.key !== "lon")) return;
  const n = parseFloat(r.value),
    lim = r.key === "lat" ? 90 : 180;
  if (isFinite(n) && Math.abs(n) <= lim) {
    r.status = "ok";
    r.note = "edited";
    r.use = true;
  } else {
    r.status = "bad";
    r.note = "outside -" + lim + " to " + lim;
    r.use = false;
  }
  VP.rows = VP.rows.filter((x) => !x.derived); // the elevation of the old position
  vpGeoLookup(++VP.seq);
}

// ── map: check the coordinates and fine-tune them ───────────────────────
function vpOpenMap() {
  const lat = VP.rows.find((r) => r.key === "lat" && !r.geo),
    lon = VP.rows.find((r) => r.key === "lon" && !r.geo);
  const opts = { onUse: vpMapUsed };
  if (lat && lon && lat.value !== "" && lon.value !== "") {
    opts.lat = parseFloat(lat.value);
    opts.lon = parseFloat(lon.value);
  } else opts.lat = opts.lon = NaN;
  openMapPicker(opts);
}
// The point chosen on the map replaces the coordinates; its elevation (looked
// up when the point was clicked) replaces the elevation; place is looked up
// again for the new position.
function vpMapUsed(pt) {
  const setRow = (key, label, value, note) => {
    let r = VP.rows.find((x) => x.key === key && !x.geo);
    if (!r) {
      r = { key, label, kind: "session" };
      VP.rows.push(r);
    }
    Object.assign(r, { raw: "set on the map", value: String(value), status: "ok", note, use: true, geo: false });
  };
  setRow("lat", "Latitude", pt.lat, "set on the map");
  setRow("lon", "Longitude", pt.lon, "set on the map");
  VP.rows = VP.rows.filter((r) => !(r.key === "elev" && (r.geo || r.derived))); // never keep one from another point
  if (pt.elev !== null && pt.elev !== undefined) {
    setRow("elev", "Elevation (m)", pt.elev, "from the map point");
    VP.rows.find((r) => r.key === "elev").derived = true;
  }
  const order = VP_FIELDS.map((f) => f.key);
  VP.rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  vpStatus("Coordinates set on the map.");
  vpGeoLookup(++VP.seq);
}
