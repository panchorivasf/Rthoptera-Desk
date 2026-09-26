// ═══════════════════════════════════════════════════════════════════
// I18N — Language menu (English default; Spanish/Italian/Portuguese)
// ═══════════════════════════════════════════════════════════════════
// Scope: this first pass covers the app's "core chrome" — the top-level
// tabs, the Plotting sub-tabs, every panel <h2> header, and the primary
// (class="pri") action buttons across every pane. Tooltips, status/log
// messages, and secondary buttons are English-only for now; they read
// the same mechanism (t()/applyTranslations below) whenever a later pass
// adds data-i18n / data-i18n-title to them or wraps a JS string in t().
//
// Numbers and identifiers that get written into exported files (Excel/
// Word/CSV column headers like peak_freq_khz, bw_20db_khz, dur_ms, …)
// are deliberately NOT covered here — those stay in English always, so
// a workbook opened by a collaborator or re-imported into Rthoptera
// later reads the same column names regardless of which language
// produced it.
//
// How it works: the English text authored directly in index.html IS the
// translation key. An element opts in with a bare `data-i18n` attribute
// (its own direct text) and/or `data-i18n-title` (its title tooltip) —
// no separate id scheme to invent or keep in sync with the markup. Only
// DIRECT TEXT-NODE children are rewritten, never nested elements, so a
// header like `<h2 data-i18n>Detections <span id="detBadge"></span></h2>`
// translates the word "Detections" and leaves the live badge alone.

(function () {
  const I18N = {
    es: {
      // ── Main tabs ──
      "Preprocessing": "Preprocesamiento",
      "Merge": "Combinar",
      "Temporal Analysis": "Análisis Temporal",
      "Spectral Analysis": "Análisis Espectral",
      "Annotate": "Anotar",
      "Plotting": "Gráficos",
      "Summarize": "Resumir",
      // ── Plotting sub-tabs ──
      "Multiplot": "Multigráfico",
      "Osc. Stack": "Pila de Oscilogramas",
      "Osc. Zoom": "Zoom de Oscilograma",
      "Auto-coded Osc.": "Oscilograma Autocodificado",
      "Habitus": "Habitus",
      // ── Temporal Analysis results tabs ──
      "Envelope peaks": "Picos de envolvente",
      "Pulses": "Pulsos",
      "Motifs": "Motivos",
      "Motif Sequences": "Secuencias de motivos",
      "Summary": "Resumen",
      // ── Panel headers ──
      "Time Axis": "Eje de Tiempo",
      "Frequency Axis": "Eje de Frecuencia",
      "Spectrogram": "Espectrograma",
      "Envelope & Floor": "Envolvente y Piso",
      "Annotations": "Anotaciones",
      "Detections": "Detecciones",
      "Audio Info": "Información del Audio",
      "Edit Audio": "Editar Audio",
      "Batch Edit": "Edición por Lotes",
      "Envelope peak Detection": "Detección de Picos de Envolvente",
      "Grouping": "Agrupación",
      "Arch Detection": "Detección de Arcos",
      "Spectral Parameters": "Parámetros Espectrales",
      "Parameter Presets": "Ajustes Predefinidos",
      "Detect & Apply": "Detectar y Aplicar",
      "Learn from Edits": "Aprender de las Ediciones",
      "Edit Mode": "Modo de Edición",
      "Envelope peak Actions": "Acciones de Picos de Envolvente",
      "Figure Layout": "Diseño de la Figura",
      "FFT": "FFT",
      "Colors": "Colores",
      "Power Spectrum": "Espectro de Potencia",
      "Typography": "Tipografía",
      "Detect motifs in the band": "Detectar motivos en la banda",
      "Rename a species": "Renombrar una especie",
      "Selections": "Selecciones",
      "1 Loaded audio": "1 Audio cargado",
      "2 Merge list — top plays first": "2 Lista de combinación — el primero suena primero",
      "3 Result": "3 Resultado",
      "Loaded Audio": "Audio Cargado",
      "Waves": "Ondas",
      "Axis": "Eje",
      "Style": "Estilo",
      "Extras": "Extras",
      "Selected label style": "Estilo de la etiqueta seleccionada",
      "Wave": "Onda",
      "Panels": "Paneles",
      "Preset": "Ajuste Predefinido",
      "Analysis": "Análisis",
      "Frequency window": "Ventana de frecuencia",
      "Pressure range (optional)": "Rango de presión (opcional)",
      "Figure": "Figura",
      "Spectrogram panel": "Panel del espectrograma",
      "Recordings": "Grabaciones",
      "Spectrum": "Espectro",
      "Contour + Band": "Contorno + Banda",
      "Habitus photo": "Foto de habitus",
      "Source files": "Archivos de origen",
      "Merge & Summarize": "Combinar y Resumir",
      "Structure selections": "Selecciones de estructura",
      "Pooled summary": "Resumen agrupado",
      "Summary table (by specimen)": "Tabla resumen (por espécimen)",
      "Temperature response": "Respuesta a la temperatura",
      "Text report": "Informe de texto",
      "Save edited audio as…": "Guardar audio editado como…",
      "Measurement columns explained": "Explicación de las columnas de medición",
      // ── Primary buttons ──
      "📂 Load Audio": "📂 Cargar Audio",
      "⌁ Filter selected": "⌁ Filtrar seleccionados",
      "📶 Normalize selected": "📶 Normalizar seleccionados",
      "↓ Drop selected": "↓ Reducir seleccionados",
      "↓⟳ Downsample selected": "↓⟳ Reducir muestreo de seleccionados",
      "🔍 Detect Envelope peaks": "🔍 Detectar Picos de Envolvente",
      "↖ Select": "↖ Seleccionar",
      "📂 Load": "📂 Cargar",
      "🖼 Render": "🖼 Renderizar",
      "✚ Add selection": "✚ Añadir selección",
      "Add ▸": "Añadir ▸",
      "⇄ Merge": "⇄ Combinar",
      "➕ Add selected": "➕ Añadir seleccionados",
      "Apply style": "Aplicar estilo",
      "🖼 Draw": "🖼 Dibujar",
      "⚙ Analyze": "⚙ Analizar",
      "🖼 Redraw": "🖼 Redibujar",
      "▶ Play": "▶ Reproducir",
      "📂 Add Excel Files": "📂 Añadir Archivos Excel",
    },
    it: {
      "Preprocessing": "Preelaborazione",
      "Merge": "Unisci",
      "Temporal Analysis": "Analisi Temporale",
      "Spectral Analysis": "Analisi Spettrale",
      "Annotate": "Annota",
      "Plotting": "Grafici",
      "Summarize": "Riepilogo",
      "Multiplot": "Multigrafico",
      "Osc. Stack": "Pila di Oscillogrammi",
      "Osc. Zoom": "Zoom Oscillogramma",
      "Auto-coded Osc.": "Oscillogramma Autocodificato",
      "Habitus": "Habitus",
      "Envelope peaks": "Picchi di inviluppo",
      "Pulses": "Impulsi",
      "Motifs": "Motivi",
      "Motif Sequences": "Sequenze di motivi",
      "Summary": "Riepilogo",
      "Time Axis": "Asse del Tempo",
      "Frequency Axis": "Asse della Frequenza",
      "Spectrogram": "Spettrogramma",
      "Envelope & Floor": "Inviluppo e Soglia",
      "Annotations": "Annotazioni",
      "Detections": "Rilevamenti",
      "Audio Info": "Informazioni Audio",
      "Edit Audio": "Modifica Audio",
      "Batch Edit": "Modifica in Blocco",
      "Envelope peak Detection": "Rilevamento Picchi di Inviluppo",
      "Grouping": "Raggruppamento",
      "Arch Detection": "Rilevamento Archi",
      "Spectral Parameters": "Parametri Spettrali",
      "Parameter Presets": "Preimpostazioni Parametri",
      "Detect & Apply": "Rileva e Applica",
      "Learn from Edits": "Apprendi dalle Modifiche",
      "Edit Mode": "Modalità Modifica",
      "Envelope peak Actions": "Azioni sui Picchi di Inviluppo",
      "Figure Layout": "Layout della Figura",
      "FFT": "FFT",
      "Colors": "Colori",
      "Power Spectrum": "Spettro di Potenza",
      "Typography": "Tipografia",
      "Detect motifs in the band": "Rileva motivi nella banda",
      "Rename a species": "Rinomina una specie",
      "Selections": "Selezioni",
      "1 Loaded audio": "1 Audio caricato",
      "2 Merge list — top plays first": "2 Elenco di unione — il primo viene riprodotto per primo",
      "3 Result": "3 Risultato",
      "Loaded Audio": "Audio Caricato",
      "Waves": "Onde",
      "Axis": "Asse",
      "Style": "Stile",
      "Extras": "Extra",
      "Selected label style": "Stile dell'etichetta selezionata",
      "Wave": "Onda",
      "Panels": "Pannelli",
      "Preset": "Preimpostazione",
      "Analysis": "Analisi",
      "Frequency window": "Finestra di frequenza",
      "Pressure range (optional)": "Intervallo di pressione (opzionale)",
      "Figure": "Figura",
      "Spectrogram panel": "Pannello dello spettrogramma",
      "Recordings": "Registrazioni",
      "Spectrum": "Spettro",
      "Contour + Band": "Contorno + Banda",
      "Habitus photo": "Foto habitus",
      "Source files": "File di origine",
      "Merge & Summarize": "Unisci e Riepiloga",
      "Structure selections": "Selezioni di struttura",
      "Pooled summary": "Riepilogo aggregato",
      "Summary table (by specimen)": "Tabella riassuntiva (per esemplare)",
      "Temperature response": "Risposta alla temperatura",
      "Text report": "Rapporto testuale",
      "Save edited audio as…": "Salva audio modificato come…",
      "Measurement columns explained": "Spiegazione delle colonne di misura",
      "📂 Load Audio": "📂 Carica Audio",
      "⌁ Filter selected": "⌁ Filtra selezionati",
      "📶 Normalize selected": "📶 Normalizza selezionati",
      "↓ Drop selected": "↓ Riduci selezionati",
      "↓⟳ Downsample selected": "↓⟳ Sottocampiona selezionati",
      "🔍 Detect Envelope peaks": "🔍 Rileva Picchi di Inviluppo",
      "↖ Select": "↖ Seleziona",
      "📂 Load": "📂 Carica",
      "🖼 Render": "🖼 Genera immagine",
      "✚ Add selection": "✚ Aggiungi selezione",
      "Add ▸": "Aggiungi ▸",
      "⇄ Merge": "⇄ Unisci",
      "➕ Add selected": "➕ Aggiungi selezionati",
      "Apply style": "Applica stile",
      "🖼 Draw": "🖼 Disegna",
      "⚙ Analyze": "⚙ Analizza",
      "🖼 Redraw": "🖼 Ridisegna",
      "▶ Play": "▶ Riproduci",
      "📂 Add Excel Files": "📂 Aggiungi File Excel",
    },
    pt: {
      "Preprocessing": "Pré-processamento",
      "Merge": "Mesclar",
      "Temporal Analysis": "Análise Temporal",
      "Spectral Analysis": "Análise Espectral",
      "Annotate": "Anotar",
      "Plotting": "Gráficos",
      "Summarize": "Resumir",
      "Multiplot": "Multigráfico",
      "Osc. Stack": "Pilha de Oscilogramas",
      "Osc. Zoom": "Zoom de Oscilograma",
      "Auto-coded Osc.": "Oscilograma Autocodificado",
      "Habitus": "Habitus",
      "Envelope peaks": "Picos de envoltória",
      "Pulses": "Pulsos",
      "Motifs": "Motivos",
      "Motif Sequences": "Sequências de motivos",
      "Summary": "Resumo",
      "Time Axis": "Eixo do Tempo",
      "Frequency Axis": "Eixo de Frequência",
      "Spectrogram": "Espectrograma",
      "Envelope & Floor": "Envoltória e Piso",
      "Annotations": "Anotações",
      "Detections": "Detecções",
      "Audio Info": "Informações do Áudio",
      "Edit Audio": "Editar Áudio",
      "Batch Edit": "Edição em Lote",
      "Envelope peak Detection": "Detecção de Picos de Envoltória",
      "Grouping": "Agrupamento",
      "Arch Detection": "Detecção de Arcos",
      "Spectral Parameters": "Parâmetros Espectrais",
      "Parameter Presets": "Predefinições de Parâmetros",
      "Detect & Apply": "Detectar e Aplicar",
      "Learn from Edits": "Aprender com as Edições",
      "Edit Mode": "Modo de Edição",
      "Envelope peak Actions": "Ações de Picos de Envoltória",
      "Figure Layout": "Layout da Figura",
      "FFT": "FFT",
      "Colors": "Cores",
      "Power Spectrum": "Espectro de Potência",
      "Typography": "Tipografia",
      "Detect motifs in the band": "Detectar motivos na banda",
      "Rename a species": "Renomear uma espécie",
      "Selections": "Seleções",
      "1 Loaded audio": "1 Áudio carregado",
      "2 Merge list — top plays first": "2 Lista de mesclagem — o primeiro toca primeiro",
      "3 Result": "3 Resultado",
      "Loaded Audio": "Áudio Carregado",
      "Waves": "Ondas",
      "Axis": "Eixo",
      "Style": "Estilo",
      "Extras": "Extras",
      "Selected label style": "Estilo do rótulo selecionado",
      "Wave": "Onda",
      "Panels": "Painéis",
      "Preset": "Predefinição",
      "Analysis": "Análise",
      "Frequency window": "Janela de frequência",
      "Pressure range (optional)": "Intervalo de pressão (opcional)",
      "Figure": "Figura",
      "Spectrogram panel": "Painel do espectrograma",
      "Recordings": "Gravações",
      "Spectrum": "Espectro",
      "Contour + Band": "Contorno + Banda",
      "Habitus photo": "Foto de habitus",
      "Source files": "Arquivos de origem",
      "Merge & Summarize": "Mesclar e Resumir",
      "Structure selections": "Seleções de estrutura",
      "Pooled summary": "Resumo agrupado",
      "Summary table (by specimen)": "Tabela resumo (por espécime)",
      "Temperature response": "Resposta à temperatura",
      "Text report": "Relatório de texto",
      "Save edited audio as…": "Salvar áudio editado como…",
      "Measurement columns explained": "Explicação das colunas de medição",
      "📂 Load Audio": "📂 Carregar Áudio",
      "⌁ Filter selected": "⌁ Filtrar selecionados",
      "📶 Normalize selected": "📶 Normalizar selecionados",
      "↓ Drop selected": "↓ Reduzir selecionados",
      "↓⟳ Downsample selected": "↓⟳ Reduzir amostragem dos selecionados",
      "🔍 Detect Envelope peaks": "🔍 Detectar Picos de Envoltória",
      "↖ Select": "↖ Selecionar",
      "📂 Load": "📂 Carregar",
      "🖼 Render": "🖼 Renderizar",
      "✚ Add selection": "✚ Adicionar seleção",
      "Add ▸": "Adicionar ▸",
      "⇄ Merge": "⇄ Mesclar",
      "➕ Add selected": "➕ Adicionar selecionados",
      "Apply style": "Aplicar estilo",
      "🖼 Draw": "🖼 Desenhar",
      "⚙ Analyze": "⚙ Analisar",
      "🖼 Redraw": "🖼 Redesenhar",
      "▶ Play": "▶ Reproduzir",
      "📂 Add Excel Files": "📂 Adicionar Arquivos Excel",
    },
  };

  // Collapses ALL whitespace (including the   that &nbsp; becomes in
  // the DOM) to single regular spaces before a dictionary lookup, so an
  // author writing "1 Loaded audio" as a key doesn't have to know or
  // reproduce which particular whitespace character sits in the markup.
  function normKey(s) {
    return s.replace(/\s+/g, " ");
  }

  let currentLang = "en";
  try {
    currentLang = localStorage.getItem("rt_lang") || "en";
  } catch (e) {}

  // General-purpose lookup for JS-authored strings (log messages, alerts,
  // dynamically built labels). Falls back to the English text unchanged
  // when there is no entry for the current language — which is always
  // true today for anything outside the data-i18n chrome, and is exactly
  // what a later pass will fill in without touching this function.
  function t(s) {
    const dict = I18N[currentLang];
    if (!dict) return s;
    return dict[normKey(s)] || s;
  }

  // Rewrites only the DIRECT text-node children of `el` — never nested
  // elements — so a header carrying a live badge/counter span keeps that
  // span intact while its own label text translates.
  function translateOwnText(el, lang) {
    el.childNodes.forEach((node) => {
      if (node.nodeType !== 3) return; // not a text node
      const raw = node.nodeValue;
      const trimmed = raw.trim();
      if (!trimmed) return;
      // Captured once, from whatever the page shows the FIRST time this
      // runs (always English, since that's what's authored in the HTML)
      // — the permanent source of truth for restoring English later,
      // regardless of how many times the language is switched back and
      // forth.
      if (node._i18nSrc === undefined) node._i18nSrc = trimmed;
      const src = node._i18nSrc;
      const dict = I18N[lang];
      const translated =
        lang === "en" ? src : (dict && dict[normKey(src)]) || src;
      node.nodeValue = raw.replace(src, translated);
    });
  }

  function applyTranslations(lang) {
    if (!I18N[lang] && lang !== "en") lang = "en";
    currentLang = lang;
    try {
      localStorage.setItem("rt_lang", lang);
    } catch (e) {}

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      translateOwnText(el, lang);
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const cur = el.getAttribute("title") || "";
      if (el.dataset.i18nTitleSrc === undefined)
        el.dataset.i18nTitleSrc = cur;
      const src = el.dataset.i18nTitleSrc;
      const dict = I18N[lang];
      el.setAttribute(
        "title",
        lang === "en" ? src : (dict && dict[normKey(src)]) || src,
      );
    });

    document.documentElement.lang = lang;
    const sel = document.getElementById("langSelect");
    if (sel) sel.value = lang;
  }

  // Exposed globally: setLanguage is the <select>'s onchange handler,
  // t()/applyTranslations are what any later pass reuses to cover more
  // of the app.
  window.t = t;
  window.applyTranslations = applyTranslations;
  window.setLanguage = function (lang) {
    applyTranslations(lang);
  };

  // This script tag is the last thing loaded, at the end of <body>, so
  // every data-i18n element from index.html above it already exists —
  // no need to wait for DOMContentLoaded.
  applyTranslations(currentLang);
})();
