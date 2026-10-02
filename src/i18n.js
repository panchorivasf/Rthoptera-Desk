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
      "Amplitude Detector": "Detector de Amplitud",
      "Manual Echemes": "Motivos Manuales",
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
      // ── Panel descriptions / explanations ──
      "Edits apply to the active recording for both Temporal and Spectral analysis. Click \"Trim…\" then drag the two handles on the waveform/spectrogram below to choose the region to keep.":
        "Las ediciones se aplican a la grabación activa tanto para el Análisis Temporal como el Espectral. Haga clic en «Recortar…» y luego arrastre las dos asas en la forma de onda/espectrograma de abajo para elegir la región a conservar.",
      "Click the waveform to place the playhead; drag to select a stretch of time. |< and >| step through its edges.":
        "Haga clic en la forma de onda para colocar el cabezal de reproducción; arrastre para seleccionar un tramo de tiempo. |< y >| recorren sus bordes.",
      "Drag out a region on the waveform/spectrogram below to select it, drag the middle of a selection to move it, or drag either edge to resize.":
        "Arrastre para marcar una región en la forma de onda/espectrograma de abajo y seleccionarla, arrastre el centro de una selección para moverla, o arrastre cualquiera de los bordes para redimensionarla.",
      "Scales every frequency down by this percentage while keeping the duration the same — 25% moves a 40 kHz peak to 30 kHz over the same 3 s.":
        "Reduce cada frecuencia en este porcentaje manteniendo la misma duración — un 25% mueve un pico de 40 kHz a 30 kHz en los mismos 3 s.",
      "Lowers the sample rate (and with it, the Nyquist limit — everything above it is gone for good). An anti-aliasing filter runs first so content above the new Nyquist is removed rather than folded back down into the passband.":
        "Reduce la tasa de muestreo (y con ella, el límite de Nyquist — todo lo que esté por encima desaparece definitivamente). Primero se aplica un filtro antialiasing para eliminar el contenido por encima del nuevo Nyquist en lugar de que se pliegue de vuelta a la banda de paso.",
      "\"Save edited files\" writes each checked entry to a folder you pick (defaults to wherever the last import came from) as <original name>_<edit suffix>.wav — e.g. a 1kHz high-pass + normalize becomes \"call_1hpf_n0.wav\".":
        "«Guardar archivos editados» escribe cada entrada marcada en una carpeta que usted elija (por defecto, de donde vino la última importación) como <nombre original>_<sufijo de edición>.wav — p. ej., un paso alto de 1kHz + normalización se convierte en «call_1hpf_n0.wav».",
      "Frequency resolution of the spectral measurements. Nothing here affects envelope peak detection or grouping. Hold these constant to compare recordings — stated in Hz, they mean the same thing at any sample rate.":
        "Resolución de frecuencia de las mediciones espectrales. Nada aquí afecta la detección o agrupación de picos de envolvente. Mantenga estos valores constantes para comparar grabaciones — expresados en Hz, significan lo mismo a cualquier tasa de muestreo.",
      "Use the 📂 Audio button in the top bar to import files (you can select several at once) — they land in the Loaded Audio panel and here, ready to add as traces.":
        "Use el botón 📂 Audio en la barra superior para importar archivos (puede seleccionar varios a la vez) — aparecen en el panel de Audio Cargado y aquí, listos para añadir como trazas.",
      "Time axis defaults to the longest wave plus the buffer, until you edit it by hand.":
        "El eje de tiempo toma por defecto la onda más larga más el margen, hasta que lo edite manualmente.",
      "\"Thickness\"/\"Color\" also restyle a selected scale bar's line.":
        "«Grosor»/«Color» también reestilizan la línea de una barra de escala seleccionada.",
      "Click a label to select it — Shift/Ctrl-click to add more, or drag a rectangle over empty space (Shift adds, Ctrl toggles). Drag or use arrow keys to move the selection. Double-click to edit text. Renaming labels in the plot does not rename the waves on the left.":
        "Haga clic en una etiqueta para seleccionarla — Shift/Ctrl-clic para añadir más, o arrastre un rectángulo sobre espacio vacío (Shift añade, Ctrl alterna). Arrastre o use las flechas para mover la selección. Doble clic para editar el texto. Renombrar etiquetas en el gráfico no renombra las ondas de la izquierda.",
      "Use the 📂 Audio button in the top bar to import files. Pick one below to zoom into.":
        "Use el botón 📂 Audio en la barra superior para importar archivos. Elija uno abajo para hacer zoom.",
      "Click a scale bar in the figure to select it, then Set. A length longer than its panel is capped at the panel's span.":
        "Haga clic en una barra de escala en la figura para seleccionarla, luego Fijar. Una longitud mayor que su panel se limita a la extensión del panel.",
      "Drag across any panel to open that slice below it. Shift/Ctrl-drag selects labels instead of zooming.":
        "Arrastre sobre cualquier panel para abrir ese fragmento debajo de él. Shift/Ctrl-arrastre selecciona etiquetas en lugar de hacer zoom.",
      "\"Thickness\"/\"Color\" also restyle a selected scale bar's line or a selected zoom bracket.":
        "«Grosor»/«Color» también reestilizan la línea de una barra de escala seleccionada o un corchete de zoom seleccionado.",
      "Saves the settings in this sidebar only — panel ranges, label text and dragged positions belong to the recording, not the preset.":
        "Guarda solo los ajustes de esta barra lateral — los rangos de paneles, el texto de las etiquetas y las posiciones arrastradas pertenecen a la grabación, no al ajuste predefinido.",
      "Click a label to select it — Shift/Ctrl-click to add more, or Shift/Ctrl-drag over a panel to marquee-select labels. Drag or use arrow keys to move the selection. Double-click to edit text.":
        "Haga clic en una etiqueta para seleccionarla — Shift/Ctrl-clic para añadir más, o Shift/Ctrl-arrastre sobre un panel para seleccionar etiquetas con un marco. Arrastre o use las flechas para mover la selección. Doble clic para editar el texto.",
      "Use the 📂 Audio button in the top bar to import files, then pick one below.":
        "Use el botón 📂 Audio en la barra superior para importar archivos, luego elija uno abajo.",
      "FRB/FRT/FFT changes need a re-Analyze. The FRPT and every style control below redraw on the spot.":
        "Los cambios en FRB/FRT/FFT requieren volver a Analizar. El FRPT y cada control de estilo de abajo se redibujan al instante.",
      "Time resolution is the spectrogram's, not the oscillogram's — that is inherent to the method.":
        "La resolución temporal es la del espectrograma, no la del oscilograma — eso es inherente al método.",
      "On the figure:": "En la figura:",
      "drag to zoom to a range, click to place the playhead, wheel to zoom, Shift+wheel to pan, double-click for the whole recording. Space plays or pauses.":
        "arrastre para hacer zoom a un rango, haga clic para colocar el cabezal de reproducción, use la rueda para hacer zoom, Shift+rueda para desplazar, doble clic para toda la grabación. Espacio reproduce o pausa.",
      "Check the recordings to average in the Loaded Audio panel at the bottom of the window — no separate add step, whatever's checked there is what gets drawn.":
        "Marque las grabaciones a promediar en el panel de Audio Cargado en la parte inferior de la ventana — no hay un paso de añadir aparte, lo que esté marcado allí es lo que se dibuja.",
      "All recordings must share the same sample rate — they're averaged bin-for-bin into the mean/median contour and SD band. The photo is optional; without one, only the spectrum panel is drawn. Drag the photo to pan it within the frame; drag the A/B letters to reposition them.":
        "Todas las grabaciones deben compartir la misma tasa de muestreo — se promedian bin por bin en el contorno de media/mediana y la banda de DE. La foto es opcional; sin ella, solo se dibuja el panel del espectro. Arrastre la foto para desplazarla dentro del marco; arrastre las letras A/B para reposicionarlas.",
      "Add the Temporal Analysis and/or Spectral Analysis .xlsx exports for each recording. The Specimen ID tagged when exporting (top toolbar) is read automatically; if it's missing or wrong, fix it below — that's what groups recordings by animal in the summary.":
        "Añada las exportaciones .xlsx de Análisis Temporal y/o Análisis Espectral de cada grabación. El ID de espécimen etiquetado al exportar (barra superior) se lee automáticamente; si falta o es incorrecto, corríjalo abajo — eso es lo que agrupa las grabaciones por animal en el resumen.",
      "Check entries here to select which ones the Habitus/Osc. panes work on, and to batch-edit them from the Preprocessing tab.":
        "Marque las entradas aquí para seleccionar con cuáles trabajan los paneles Habitus/Osc., y para editarlas por lotes desde la pestaña de Preprocesamiento.",
      // ── Tooltips (title attributes) ──
      "Back to the home tab":
        "Volver a la pestaña de inicio",
      "Tagged per loaded recording — carried into every exported table (Peaks/Pulses/Motifs/Spectral) as its first column, and used by Summarize to count individuals correctly.":
        "Etiquetado por grabación cargada — se incluye como primera columna en cada tabla exportada (Picos/Pulsos/Motivos/Espectral), y Resumir lo usa para contar individuos correctamente.",
      "Tagged per loaded recording — carried into every exported table as a column.":
        "Etiquetado por grabación cargada — se incluye como columna en cada tabla exportada.",
      "Tagged per loaded recording — carried into every exported table as a column, and saved into the specimen metadata .json alongside Species and Locality.":
        "Etiquetado por grabación cargada — se incluye como columna en cada tabla exportada, y se guarda en el .json de metadatos del espécimen junto con Especie y Localidad.",
      "Air temperature at the time of recording, in °C. Tagged per loaded recording — carried into every exported table as the temp_c column. Stridulation rate is strongly temperature-dependent, so this is needed to compare recordings. Free text, so 22.5 or ~23 are both fine.":
        "Temperatura del aire al momento de la grabación, en °C. Etiquetada por grabación cargada — se incluye como la columna temp_c en cada tabla exportada. La tasa de estridulación depende fuertemente de la temperatura, por lo que esto es necesario para comparar grabaciones. Es texto libre, así que 22.5 o ~23 son válidos.",
      "Save Specimen ID/Species/Locality to a .json file, so it can be reloaded for other recordings of the same specimen.":
        "Guardar ID de espécimen/Especie/Localidad en un archivo .json, para poder recargarlos en otras grabaciones del mismo espécimen.",
      "Load Specimen ID/Species/Locality from a previously saved .json file.":
        "Cargar ID de espécimen/Especie/Localidad desde un archivo .json guardado previamente.",
      "Language — English default; the app remembers your choice.":
        "Idioma — inglés por defecto; la aplicación recuerda su elección.",
      "Clear the time selection (a plain click on the waveform does this too).":
        "Borrar la selección de tiempo (un simple clic en la forma de onda también lo hace).",
      "Drag two handles on the waveform/spectrogram (Spectral Analysis tab) to choose the region to keep, then confirm.":
        "Arrastre dos asas en la forma de onda/espectrograma (pestaña de Análisis Espectral) para elegir la región a conservar, y luego confirme.",
      "Restore the full duration.":
        "Restaurar la duración completa.",
      "Type a duration (s) — resizes the selection from its current start.":
        "Escriba una duración (s) — redimensiona la selección desde su inicio actual.",
      "Save the current selection as its own .wav (original name + _1, _2, …) without confirming/applying the trim.":
        "Guardar la selección actual como su propio .wav (nombre original + _1, _2, …) sin confirmar/aplicar el recorte.",
      "High-pass cutoff in Hz (removes content below). 0 = off.":
        "Corte de paso alto en Hz (elimina el contenido por debajo). 0 = desactivado.",
      "Low-pass cutoff in Hz (removes content above). Defaults to the Nyquist frequency.":
        "Corte de paso bajo en Hz (elimina el contenido por encima). Por defecto, la frecuencia de Nyquist.",
      "Remove the bandpass filter.":
        "Eliminar el filtro de paso de banda.",
      "Percentage to lower every frequency by. 50% halves them; 0 and 100 are not valid.":
        "Porcentaje en que se reducirá cada frecuencia. 50% las reduce a la mitad; 0 y 100 no son válidos.",
      "Remove the frequency drop.":
        "Eliminar la reducción de frecuencia.",
      "Only rates below the current sample rate are offered — this reduces resolution, it never increases it.":
        "Solo se ofrecen tasas por debajo de la tasa de muestreo actual — esto reduce la resolución, nunca la aumenta.",
      "Restore the original sample rate.":
        "Restaurar la tasa de muestreo original.",
      "Nothing to undo.":
        "Nada que deshacer.",
      "Save the current (edited) audio as a new entry in the Loaded Audio panel, without touching the original file.":
        "Guardar el audio actual (editado) como una nueva entrada en el panel de Audio Cargado, sin modificar el archivo original.",
      "High-pass cutoff in Hz. 0 = off.":
        "Corte de paso alto en Hz. 0 = desactivado.",
      "Low-pass cutoff in Hz. 0 = Nyquist (off).":
        "Corte de paso bajo en Hz. 0 = Nyquist (desactivado).",
      "Target envelope peak level in dBFS (0 = full scale).":
        "Nivel objetivo del pico de envolvente en dBFS (0 = escala completa).",
      "Scale every frequency down by this percentage, keeping each recording's duration unchanged.":
        "Reducir cada frecuencia en este porcentaje, manteniendo sin cambios la duración de cada grabación.",
      "Rates are offered below the highest-rate checked recording. A checked recording already at or below the chosen rate is left untouched. An anti-aliasing filter runs before each one is decimated.":
        "Se ofrecen tasas por debajo de la grabación marcada con la tasa más alta. Una grabación marcada que ya esté en o por debajo de la tasa elegida se deja intacta. Se aplica un filtro antialiasing antes de diezmar cada una.",
      "Drag to resize":
        "Arrastrar para redimensionar",
      "Drag to resize bottom panel":
        "Arrastrar para redimensionar el panel inferior",
      "Jump to the previous selection edge (trim handles, or annotation bounds)":
        "Saltar al borde de selección anterior (asas de recorte, o límites de anotación)",
      "Jump to the next selection edge (trim handles, or annotation bounds)":
        "Saltar al siguiente borde de selección (asas de recorte, o límites de anotación)",
      "Playback speed as a percentage of real time, from 1 to 400. Slowing down also lowers the pitch, which brings ultrasonic song into hearing range: 1% plays a 120 kHz carrier at about 1.2 kHz. Note that it stretches the recording by the same factor, so 1% takes 100x as long to play. To lower the pitch WITHOUT stretching time, use Freq drop instead.":
        "Velocidad de reproducción como porcentaje del tiempo real, de 1 a 400. Reducir la velocidad también baja el tono, lo que trae el canto ultrasónico al rango audible: 1% reproduce una portadora de 120 kHz a unos 1.2 kHz. Tenga en cuenta que esto estira la grabación por el mismo factor, así que 1% tarda 100 veces más en reproducirse. Para bajar el tono SIN estirar el tiempo, use Reducir frecuencia en su lugar.",
      "Lower every frequency by this percentage for LISTENING only — the stored audio, measurements, exports and plots are untouched. Unlike Speed, this keeps the tempo: 0 = off.":
        "Baja cada frecuencia en este porcentaje solo para ESCUCHAR — el audio almacenado, las mediciones, las exportaciones y los gráficos no se ven afectados. A diferencia de Velocidad, esto mantiene el tempo: 0 = desactivado.",
      "Select/Seek (S)":
        "Seleccionar/Buscar (S)",
      "Draw annotation (A)":
        "Dibujar anotación (A)",
      "Pan/scroll (H)":
        "Desplazar (H)",
      "Ignore the vertical drag: annotations cover the whole frequency axis, so you only aim at the time axis.":
        "Ignorar el arrastre vertical: las anotaciones cubren todo el eje de frecuencia, así que solo se apunta al eje de tiempo.",
      "Nothing to undo (Ctrl+Z)":
        "Nada que deshacer (Ctrl+Z)",
      "Export Selection table":
        "Exportar tabla de selecciones",
      "Clear all selections, detections, and measurements from the spectrogram":
        "Borrar todas las selecciones, detecciones y mediciones del espectrograma",
      "Import selections from a Raven selection table (.txt/.csv).":
        "Importar selecciones desde una tabla de selección de Raven (.txt/.csv).",
      "Import the Pulse or Motif table from a Temporal Analysis Excel export as selections.":
        "Importar la tabla de Pulsos o Motivos de una exportación de Excel de Análisis Temporal como selecciones.",
      "Frequency resolution used to MEASURE spectral features in the table below. Independent of the display FFT, so you can use a small display FFT for temporal detail while still measuring frequency precisely. The FFT is auto-sized (next power of 2) to reach at least this resolution.":
        "Resolución de frecuencia usada para MEDIR las características espectrales en la tabla de abajo. Independiente de la FFT de visualización, así puede usar una FFT de visualización pequeña para detalle temporal y aun así medir la frecuencia con precisión. La FFT se dimensiona automáticamente (siguiente potencia de 2) para alcanzar al menos esta resolución.",
      "Clear the measurements table":
        "Borrar la tabla de mediciones",
      "Compute spectral metrics for selections or detections and prepare Excel output.":
        "Calcular métricas espectrales para selecciones o detecciones y preparar la salida en Excel.",
      "Save the most recently computed spectral metrics as an Excel workbook.":
        "Guardar las métricas espectrales calculadas más recientemente como un libro de Excel.",
      "Save a plain-language narrative summary of the computed spectral metrics as a DOCX file.":
        "Guardar un resumen narrativo en lenguaje sencillo de las métricas espectrales calculadas como un archivo DOCX.",
      "Show a plain-language explanation of every column in the measurements table.":
        "Mostrar una explicación en lenguaje sencillo de cada columna de la tabla de mediciones.",
      "Optional lower floor: weak envelope peaks above this value are kept ONLY when they sit within one Max-envelope peak-gap of an accepted (strong) envelope peak. Catches the quiet onset/offset envelope peaks of a pulse without picking up isolated inter-pulse noise. Leave blank to disable.":
        "Piso inferior opcional: los picos de envolvente débiles por encima de este valor se conservan SOLO cuando están dentro de un Máx. hueco entre picos de envolvente de un pico de envolvente aceptado (fuerte). Captura los picos de envolvente tenues de inicio/fin de un pulso sin captar ruido aislado entre pulsos. Déjelo en blanco para desactivar.",
      "After detection, removes near-baseline 'envelope peaks' that pass the prominence check on their own tiny local dip but aren't real signal. A envelope peak is dropped only if it BOTH sits within this much of the recording's floor AND is more than this much below the real envelope peaks on either side — so a low bump between two pulses goes, while the quiet onset/offset envelope peaks of a real pulse stay. Runs of several bumps at the same low level are judged as one unit against the taller envelope peaks flanking the whole run. Leave blank to disable.":
        "Después de la detección, elimina \"picos de envolvente\" cercanos a la línea base que pasan la prueba de prominencia por su propia caída local diminuta pero no son señal real. Un pico de envolvente se descarta solo si está DENTRO de esta distancia del piso de la grabación Y está más de esta distancia por debajo de los picos de envolvente reales a ambos lados — así se elimina un bulto bajo entre dos pulsos, mientras que los tenues picos de envolvente de inicio/fin de un pulso real se conservan. Las series de varios bultos al mismo nivel bajo se juzgan como una sola unidad frente a los picos de envolvente más altos que flanquean toda la serie. Déjelo en blanco para desactivar.",
      "Expand every pulse (and therefore every motif/sequence) by this many milliseconds on EACH side, to capture the true acoustic onset/offset that precedes/follows each envelope peak's amplitude maximum. Pulse rate and other envelope peak-timing metrics are unaffected.":
        "Expande cada pulso (y por lo tanto cada motivo/secuencia) en esta cantidad de milisegundos en CADA lado, para capturar el verdadero inicio/fin acústico que precede/sigue al máximo de amplitud de cada pico de envolvente. La tasa de pulsos y otras métricas de temporización de picos de envolvente no se ven afectadas.",
      "For species whose pulses run back to back, where the silence between pulses is no longer than the spacing between envelope peaks inside one, so Max envelope peak gap cannot separate them. Splits at the valley between two amplitude arches instead. Runs AFTER the gap rule and only subdivides what it produced — it never merges pulses the gap rule separated.":
        "Para especies cuyos pulsos se suceden sin pausa, donde el silencio entre pulsos no es más largo que el espaciado entre picos de envolvente dentro de uno, por lo que el Hueco máx. entre picos de envolvente no puede separarlos. En su lugar, divide en el valle entre dos arcos de amplitud. Se ejecuta DESPUÉS de la regla de hueco y solo subdivide lo que esta produjo — nunca fusiona pulsos que la regla de hueco separó.",
      "How far a valley must fall below the crests on either side, as a percentage of those crests. Relative, so quiet and loud pulses are judged alike. Lower = more splits.":
        "Cuánto debe caer un valle por debajo de las crestas a cada lado, como porcentaje de esas crestas. Relativo, así que los pulsos suaves y fuertes se juzgan por igual. Menor = más divisiones.",
      "Refuses any arch cut that would leave a pulse shorter than this — shallow amplitude modulation inside one pulse can look like a valley. Leave blank to derive it from the recording: half the median duration of the pulses the unmistakable valleys produce.":
        "Rechaza cualquier corte de arco que deje un pulso más corto que esto — una modulación de amplitud leve dentro de un pulso puede parecer un valle. Déjelo en blanco para derivarlo de la grabación: la mitad de la duración mediana de los pulsos que producen los valles inequívocos.",
      "Target frequency resolution for TOOTH spectra, in Hz. Resolution is 1/window, so 1500 Hz means a 0.67 ms window — but stating it in Hz keeps it identical across recordings with different sample rates, which a duration in milliseconds does not. The signal is still capped at half the distance to the neighbouring peak, so where pulses are tighter than this asks for, the row reports the coarser resolution it actually achieved in spec_res_hz. Keep this constant across a study.":
        "Resolución de frecuencia objetivo para los espectros de DIENTE, en Hz. La resolución es 1/ventana, así que 1500 Hz significa una ventana de 0.67 ms — pero expresarla en Hz la mantiene idéntica entre grabaciones con distintas tasas de muestreo, lo que una duración en milisegundos no logra. La señal sigue limitada a la mitad de la distancia al pico vecino, así que donde los pulsos estén más juntos de lo que esto pide, la fila reporta la resolución más gruesa realmente alcanzada en spec_res_hz. Mantenga esto constante a lo largo de un estudio.",
      "Target frequency resolution for PULSE spectra, in Hz. 50 Hz means a 20 ms window. A pulse longer than that is Welch-averaged over overlapping frames at this resolution; a shorter pulse reports the coarser resolution it could actually achieve. The motif columns ending in _tmean are the average of these pulse rows. Keep it constant across a study.":
        "Resolución de frecuencia objetivo para los espectros de PULSO, en Hz. 50 Hz significa una ventana de 20 ms. Un pulso más largo que eso se promedia con el método de Welch sobre cuadros superpuestos a esta resolución; un pulso más corto reporta la resolución más gruesa que realmente pudo alcanzar. Las columnas de motivo que terminan en _tmean son el promedio de estas filas de pulso. Manténgalo constante a lo largo de un estudio.",
      "Target frequency resolution for MOTIF spectra, in Hz. 10 Hz means a 100 ms window, long enough to resolve structure the pulse window cannot. This measures the whole motif span, so its frames also cross the silence between pulses — on a low duty cycle that raises spec_entropy and spec_flatness. The motif row also carries _tmean columns, the average of its pulse rows, which contain no silence; compare the two. Keep this constant across a study.":
        "Resolución de frecuencia objetivo para los espectros de MOTIVO, en Hz. 10 Hz significa una ventana de 100 ms, lo bastante larga para resolver estructura que la ventana de pulso no puede. Esto mide todo el tramo del motivo, así que sus cuadros también cruzan el silencio entre pulsos — con un ciclo de trabajo bajo eso eleva spec_entropy y spec_flatness. La fila de motivo también lleva columnas _tmean, el promedio de sus filas de pulso, que no contienen silencio; compare ambas. Mantenga esto constante a lo largo de un estudio.",
      "Saved Temporal Analysis parameter sets (stored on this machine).":
        "Conjuntos de parámetros de Análisis Temporal guardados (almacenados en esta máquina).",
      "Save the current parameters into the selected slot.":
        "Guardar los parámetros actuales en la ranura seleccionada.",
      "Load the selected preset's parameters.":
        "Cargar los parámetros del ajuste predefinido seleccionado.",
      "Delete the selected preset slot.":
        "Eliminar la ranura de ajuste predefinido seleccionada.",
      "Save the current parameters to a .json file. Opens a file browser so you can choose the folder and edit the name. Unlike the 10 slots, a file can be copied to another computer or kept beside the recordings it belongs to.":
        "Guardar los parámetros actuales en un archivo .json. Abre un explorador de archivos para que pueda elegir la carpeta y editar el nombre. A diferencia de las 10 ranuras, un archivo se puede copiar a otro equipo o guardar junto a las grabaciones a las que pertenece.",
      "Load parameters from a .json preset file. The values go into the panels; use Save afterwards to also keep them in a slot.":
        "Cargar parámetros desde un archivo .json de ajuste predefinido. Los valores se colocan en los paneles; use Guardar después para conservarlos también en una ranura.",
      "Convert detected units into Spectral Analysis selections.":
        "Convertir las unidades detectadas en selecciones de Análisis Espectral.",
      "Choose whether detected units become pulse or motif selections.":
        "Elegir si las unidades detectadas se convierten en selecciones de pulso o de motivo.",
      "Load a Envelope peaks table from a Temporal Analysis Excel export, restoring the envelope peaks and the pulse boundaries exactly as they were saved, including any you edited by hand. Needs the matching audio loaded. Does not re-run detection.":
        "Cargar una tabla de Picos de envolvente desde una exportación de Excel de Análisis Temporal, restaurando los picos de envolvente y los límites de pulso exactamente como se guardaron, incluyendo cualquiera que haya editado a mano. Requiere que el audio correspondiente esté cargado. No vuelve a ejecutar la detección.",
      "Correct a few pulses by hand, select their envelope peaks (shift-drag), then press this. Searches the pulse-grouping parameters for the combination that best reproduces the boundaries you set. Envelope peak DETECTION is only fitted if you tick the box below. Nothing changes until you press Apply.":
        "Corrija a mano algunos pulsos, seleccione sus picos de envolvente (shift-arrastrar), y luego presione esto. Busca en los parámetros de agrupación de pulsos la combinación que mejor reproduce los límites que estableció. La DETECCIÓN de picos de envolvente solo se ajusta si marca la casilla de abajo. Nada cambia hasta que presione Aplicar.",
      "Also fit the envelope peak-detection parameters (envelope peak window, envelope peak/detection/onset thresholds, false envelope peak delta) to the envelope peaks you kept, added and deleted by hand. Smoothing is never fitted. Slower, and Apply then re-runs detection over the whole recording, which replaces manual envelope peak edits as well as boundary edits.":
        "También ajusta los parámetros de detección de picos de envolvente (ventana de pico de envolvente, umbrales de pico de envolvente/detección/inicio, delta de falso pico de envolvente) a los picos de envolvente que conservó, añadió y eliminó a mano. El suavizado nunca se ajusta. Es más lento, y Aplicar entonces vuelve a ejecutar la detección sobre toda la grabación, lo que reemplaza tanto las ediciones manuales de picos de envolvente como las de límites.",
      "Write the fitted parameters into the panels and re-apply them over the whole recording. This replaces manual boundary edits, including the ones just pulseed on.":
        "Escribe los parámetros ajustados en los paneles y los vuelve a aplicar sobre toda la grabación. Esto reemplaza las ediciones manuales de límites, incluidas las que se acaban de usar para el ajuste.",
      "Left-click a marker to select it.":
        "Clic izquierdo en un marcador para seleccionarlo.",
      "Click anywhere on the plot to add a envelope peak, snapped to the envelope at that time.":
        "Haga clic en cualquier parte del gráfico para añadir un pico de envolvente, ajustado a la envolvente en ese momento.",
      "Re-run the detected segmentation, discarding manual boundary edits (added/removed envelope peaks are kept).":
        "Vuelve a ejecutar la segmentación detectada, descartando las ediciones manuales de límites (los picos de envolvente añadidos/eliminados se conservan).",
      "Re-apply the False envelope peak Δ filter to the current envelope peaks (e.g. after manually adding one, or after changing the Δ value).":
        "Vuelve a aplicar el filtro Δ de falso pico de envolvente a los picos de envolvente actuales (p. ej., tras añadir uno manualmente, o tras cambiar el valor de Δ).",
      "Assign the selected envelope peak(s) to the left pulse.":
        "Asignar el/los pico(s) de envolvente seleccionado(s) al pulso izquierdo.",
      "Assign the selected envelope peak(s) to the right pulse.":
        "Asignar el/los pico(s) de envolvente seleccionado(s) al pulso derecho.",
      "Merge the left gap for the selected envelope peak.":
        "Fusionar el hueco izquierdo del pico de envolvente seleccionado.",
      "Merge the right gap for the selected envelope peak.":
        "Fusionar el hueco derecho del pico de envolvente seleccionado.",
      "Split the left gap for the selected envelope peak.":
        "Dividir el hueco izquierdo del pico de envolvente seleccionado.",
      "Split the right gap for the selected envelope peak.":
        "Dividir el hueco derecho del pico de envolvente seleccionado.",
      "Make the selected envelope peaks into a single pulse.":
        "Convertir los picos de envolvente seleccionados en un solo pulso.",
      "Join internal gaps within the selected envelope peaks.":
        "Unir los huecos internos dentro de los picos de envolvente seleccionados.",
      "Remove the selected envelope peak(s).":
        "Eliminar el/los pico(s) de envolvente seleccionado(s).",
      "Clear the current envelope peak selection.":
        "Borrar la selección actual de picos de envolvente.",
      "Magnify amplitude — reveals faint envelope peaks (clips tall ones at the top).":
        "Ampliar la amplitud — revela picos de envolvente tenues (recorta los altos por arriba).",
      "Show a small synced spectrogram below the envelope to tell real envelope peak impacts from noise.":
        "Mostrar un pequeño espectrograma sincronizado debajo de la envolvente para distinguir los impactos reales de picos de envolvente del ruido.",
      "Overview — click or drag to navigate; drag the highlighted window to pan.":
        "Vista general — haga clic o arrastre para navegar; arrastre la ventana resaltada para desplazarse.",
      "Export all tables (Envelope peaks, Pulses, Motifs, MotifSeqs, Summary) into one Excel workbook — one sheet each.":
        "Exportar todas las tablas (Picos de envolvente, Pulsos, Motivos, SecMotivos, Resumen) en un solo libro de Excel — una hoja cada una.",
      "Auto-coded Oscillogram — an oscillogram whose colour marks the frequency bands present above a threshold. After Brizio (2023), Colour Enhanced Time/Pressure Envelope":
        "Oscilograma Autocodificado — un oscilograma cuyo color marca las bandas de frecuencia presentes por encima de un umbral. Según Brizio (2023), Colour Enhanced Time/Pressure Envelope",
      "Clear preset":
        "Borrar ajuste predefinido",
      "Write the current plot settings to a .json file you can keep beside your recordings or share.":
        "Escribir los ajustes actuales del gráfico en un archivo .json que puede guardar junto a sus grabaciones o compartir.",
      "Load plot settings from a .json preset file into the toolbar.":
        "Cargar ajustes del gráfico desde un archivo .json de ajuste predefinido en la barra de herramientas.",
      "Shared scale for the Power Spectrum curve and the spectrogram's colour mapping. dB compresses the range so quieter shoulders stay visible; Linear puts everything relative to the peak, so the dominant band reads as a sharp spike and the rest fades fast.":
        "Escala compartida para la curva del Espectro de Potencia y el mapeo de color del espectrograma. dB comprime el rango para que los hombros más tenues sigan siendo visibles; Lineal pone todo relativo al pico, así que la banda dominante se lee como un pico agudo y el resto se desvanece rápido.",
      "Use current analyzer view":
        "Usar la vista actual del analizador",
      "Use current freq view":
        "Usar la vista de frecuencia actual",
      "The species this selection is of. Typed once, then offered from the list.":
        "La especie a la que pertenece esta selección. Se escribe una vez y luego se ofrece desde la lista.",
      "Wind and handling noise routinely exceed an insect call in absolute level. Set this above the rumble or it will capture the envelope peak and drag the band down to DC.":
        "El ruido de viento y manipulación suele superar el nivel absoluto del canto de un insecto. Ajuste esto por encima del retumbo o capturará el pico de envolvente y arrastrará la banda hasta DC.",
      "Band edges this many dB below the spectrum's peak. 20 dB is the usual bioacoustics convention.":
        "Bordes de banda a esta cantidad de dB por debajo del pico del espectro. 20 dB es la convención habitual en bioacústica.",
      "outer — outermost crossings, harmonics included (and any neighbour calling in the same window). around peak — the one lobe around the carrier.":
        "exterior — cruces más externos, incluidos los armónicos (y cualquier vecino que cante en la misma ventana). alrededor del pico — solo el lóbulo alrededor de la portadora.",
      "Re-derive the band from the threshold whenever the selection changes.":
        "Volver a derivar la banda a partir del umbral cada vez que cambie la selección.",
      "Freeze the band across every later selection and every later recording. What makes 'auto' safe to leave on.":
        "Congela la banda para todas las selecciones y grabaciones posteriores. Lo que hace seguro dejar activado \"auto\".",
      "Power-spectrum window. Deliberately not the finest available: fine structure from one individual or one microphone does not generalise, and the band should describe the species.":
        "Ventana del espectro de potencia. Deliberadamente no la más fina disponible: la estructura fina de un individuo o un micrófono no generaliza, y la banda debe describir la especie.",
      "Display only — neither scale changes a number that gets saved. Linear makes the carrier read as a spike; dB makes the shoulders visible.":
        "Solo visualización — ninguna escala cambia un número que se guarda. Lineal hace que la portadora se lea como un pico; dB hace visibles los hombros.",
      "Spectrogram dynamic range, in dB below the loudest bin in view.":
        "Rango dinámico del espectrograma, en dB por debajo del bin más fuerte en vista.",
      "Drag to set the time span. Shift+drag to pan. Wheel to zoom. Click to clear.":
        "Arrastre para fijar el intervalo de tiempo. Shift+arrastrar para desplazar. Rueda para hacer zoom. Clic para borrar.",
      "Display only. Click a box to select it and adopt its label and band. Wheel to zoom time, Ctrl+wheel to zoom frequency.":
        "Solo visualización. Haga clic en un cuadro para seleccionarlo y adoptar su etiqueta y banda. Rueda para hacer zoom en el tiempo, Ctrl+rueda para hacer zoom en la frecuencia.",
      "Power spectrum of the marked span. Drag horizontally to set the band by hand.":
        "Espectro de potencia del tramo marcado. Arrastre horizontalmente para fijar la banda a mano.",
      "Commit the pending box (Enter / A)":
        "Confirmar el cuadro pendiente (Enter / A)",
      "Undo (Ctrl+Z)":
        "Deshacer (Ctrl+Z)",
      "Drop the time span, keep the band (Esc)":
        "Descartar el intervalo de tiempo, conservar la banda (Esc)",
      "Delete the selected box (Del)":
        "Eliminar el cuadro seleccionado (Supr)",
      "Write <species>.band.json. Refused for a band derived from the whole view — in a recording holding two species that is neither species' band.":
        "Escribe <especie>.band.json. Se rechaza para una banda derivada de toda la vista — en una grabación con dos especies eso no es la banda de ninguna de las dos.",
      "Adopt a saved band: same edges, locked.":
        "Adoptar una banda guardada: mismos bordes, bloqueada.",
      "What to do when the pieces disagree. Resampling low-passes before any downsample, so it cannot alias.":
        "Qué hacer cuando las piezas no coinciden. El remuestreo aplica paso bajo antes de cualquier reducción de tasa, así que no puede generar aliasing.",
      "Silence inserted between pieces, never before the first or after the last. 0 reproduces merge_waves() exactly.":
        "Silencio insertado entre piezas, nunca antes de la primera ni después de la última. 0 reproduce merge_waves() exactamente.",
      "Subtract the mean of the whole merged signal, as tuneR's normalize(center = TRUE) does.":
        "Restar la media de toda la señal combinada, como hace normalize(center = TRUE) de tuneR.",
      "Envelope peak-normalize the merged signal. NOTE: this destroys the relative levels between the source recordings.":
        "Normalizar por pico de envolvente la señal combinada. NOTA: esto destruye los niveles relativos entre las grabaciones de origen.",
      "Write the merged audio as a 16-bit mono WAV.":
        "Escribir el audio combinado como un WAV mono de 16 bits.",
      "Write where each source recording landed, as a Raven selection table.":
        "Escribir dónde quedó cada grabación de origen, como una tabla de selección de Raven.",
      "Extra audio shown on each side of a brushed selection, as a % of the selection's own width, so the zoomed panel isn't a context-free sliver. The selection itself stays centered.":
        "Audio adicional mostrado a cada lado de una selección marcada, como % del ancho propio de la selección, para que el panel ampliado no sea una franja sin contexto. La selección misma permanece centrada.",
      "Length of the scale bar on the selected panel(s). Each panel keeps its own length, since zoom panels span very different durations. Leave a panel on Auto for a bar about 20% of that panel's width.":
        "Longitud de la barra de escala en el/los panel(es) seleccionado(s). Cada panel conserva su propia longitud, ya que los paneles de zoom abarcan duraciones muy distintas. Deje un panel en Auto para una barra de aproximadamente el 20% del ancho de ese panel.",
      "Apply this length to the selected scale bar(s).":
        "Aplicar esta longitud a la(s) barra(s) de escala seleccionada(s).",
      "Return the selected scale bar(s) to the automatic length.":
        "Devolver la(s) barra(s) de escala seleccionada(s) a la longitud automática.",
      "Apply to every panel instead of only the selected scale bars.":
        "Aplicar a todos los paneles en lugar de solo a las barras de escala seleccionadas.",
      "Write the current Osc. Zoom settings to a .json file you can reuse or share.":
        "Escribir los ajustes actuales de Zoom de Oscilograma en un archivo .json que puede reutilizar o compartir.",
      "Load Osc. Zoom settings from a .json preset file.":
        "Cargar ajustes de Zoom de Oscilograma desde un archivo .json de ajuste predefinido.",
      "FFT size sets the frequency resolution and, inversely, the time resolution of the whole rendering: t = nfft / fs.":
        "El tamaño de la FFT fija la resolución de frecuencia y, a la inversa, la resolución temporal de todo el renderizado: t = nfft / fs.",
      "Higher overlap gives more drawn columns per second — finer colour placement in time at the same frequency resolution.":
        "Un mayor solapamiento da más columnas dibujadas por segundo — una colocación de color más fina en el tiempo a la misma resolución de frecuencia.",
      "2-colour marks one frequency range in a single contrasting colour. Multicolour splits the range into uniform bands, each mapped to one bit of the 24-bit RGB triplet.":
        "2 colores marca un rango de frecuencia en un único color contrastante. Multicolor divide el rango en bandas uniformes, cada una asignada a un bit del triplete RGB de 24 bits.",
      "Frequency Range Bottom":
        "Límite inferior del rango de frecuencia",
      "Frequency Range Top":
        "Límite superior del rango de frecuencia",
      "Frequency Range Pressure Threshold. A band counts as present when its strongest bin reaches this level. Changing it recolours instantly — no re-analysis.":
        "Umbral de presión del rango de frecuencia. Una banda se considera presente cuando su bin más fuerte alcanza este nivel. Cambiarlo recolorea al instante — sin volver a analizar.",
      "Restrict colour to columns whose OVERALL level falls in a range — a way to exclude the loudest or the feeblest parts of the recording.":
        "Restringir el color a las columnas cuyo nivel GENERAL cae dentro de un rango — una forma de excluir las partes más fuertes o más débiles de la grabación.",
      "Overall Pressure Range Bottom":
        "Límite inferior del rango de presión general",
      "Overall Pressure Range Top":
        "Límite superior del rango de presión general",
      "Applies to the reference oscillogram only. The Auto-coded Oscillogram's own columns are always drawn exactly one column wide, so a thicker stroke can never smear one column's colour over its neighbours.":
        "Se aplica solo al oscilograma de referencia. Las propias columnas del Oscilograma Autocodificado siempre se dibujan con exactamente una columna de ancho, así que un trazo más grueso nunca puede difuminar el color de una columna sobre sus vecinas.",
      "Colour of every column that does NOT reach the threshold.":
        "Color de cada columna que NO alcanza el umbral.",
      "2-colour rendering only — multicolour takes its colours from the band mapping.":
        "Solo para el renderizado de 2 colores — el multicolor toma sus colores del mapeo de bandas.",
      "Top of the displayed frequency axis. 0 = up to Nyquist.":
        "Parte superior del eje de frecuencia mostrado. 0 = hasta Nyquist.",
      "Write the current Auto-coded Oscillogram settings to a .json file you can reuse or share.":
        "Escribir los ajustes actuales del Oscilograma Autocodificado en un archivo .json que puede reutilizar o compartir.",
      "Load Auto-coded Oscillogram settings from a .json preset file.":
        "Cargar ajustes del Oscilograma Autocodificado desde un archivo .json de ajuste predefinido.",
      "PNG scale factor":
        "Factor de escala del PNG",
      "Export the contiguous coloured stretches as a CSV of time intervals with the bands that lit them.":
        "Exportar los tramos coloreados contiguos como un CSV de intervalos de tiempo con las bandas que los activaron.",
      "The publication this module implements":
        "La publicación que implementa este módulo",
      "Play or pause the visible range (Space)":
        "Reproducir o pausar el rango visible (Espacio)",
      "Stop and return the playhead to the start of the view":
        "Detener y devolver el cabezal de reproducción al inicio de la vista",
      "Playback speed as a percentage of real time, from 1 to 400 — the same scale as the main transport. Slowing down also lowers the pitch, which brings ultrasonic song into hearing range: 6% plays a 42 kHz song at about 2.6 kHz, and 1% reaches a 120 kHz carrier. It stretches the recording by the same factor, so 1% takes 100x as long to play.":
        "Velocidad de reproducción como porcentaje del tiempo real, de 1 a 400 — la misma escala que el transporte principal. Reducir la velocidad también baja el tono, lo que trae el canto ultrasónico al rango audible: 6% reproduce un canto de 42 kHz a unos 2.6 kHz, y 1% alcanza una portadora de 120 kHz. Estira la grabación por el mismo factor, así que 1% tarda 100 veces más en reproducirse.",
      "Lights while the playhead is over a highlighted column — a band above the FRPT is sounding.":
        "Se ilumina mientras el cabezal de reproducción está sobre una columna resaltada — una banda por encima del FRPT está sonando.",
      "Zoom in on the centre of the view":
        "Acercar el centro de la vista",
      "Zoom out":
        "Alejar",
      "Show the whole recording (Home, or double-click the figure)":
        "Mostrar toda la grabación (Inicio, o doble clic en la figura)",
      "Spacing between frequency axis ticks/labels. 0 = automatic (6 ticks).":
        "Espaciado entre las marcas/etiquetas del eje de frecuencia. 0 = automático (6 marcas).",
      "Express every measurement at this temperature, using a least-squares fit of each metric against the temperatures actually recorded. Adds a corrected mean/SD beside every observed one in the table, a bracketed figure in the report, and the Temp_Regression sheets to the workbook.":
        "Expresa cada medición a esta temperatura, usando un ajuste de mínimos cuadrados de cada métrica frente a las temperaturas realmente registradas.\n\nAñade una media/DE corregida junto a cada una observada en la tabla, una cifra entre corchetes en el informe, y las hojas Temp_Regression al libro.",
      "How the min-max range is wrapped in the LaTeX and Word convenience columns of the saved workbook, e.g. 12.00±1.50 (9.80–14.20) versus 12.00±1.50 [9.80–14.20]. The columns are Excel formulas, so this is baked in when the workbook is written — change it and save again to switch.":
        "Cómo se envuelve el rango mín-máx en las columnas de conveniencia de LaTeX y Word del libro guardado, p. ej. 12.00±1.50 (9.80–14.20) frente a 12.00±1.50 [9.80–14.20].\n\nLas columnas son fórmulas de Excel, así que esto queda fijado al escribir el libro — cámbielo y guarde de nuevo para cambiarlo.",
      "Save the figure as SVG — vector, so it stays sharp at any size and can be edited in Illustrator or Inkscape. This is the format most journals ask for.":
        "Guardar la figura como SVG — vectorial, así que se mantiene nítida a cualquier tamaño y se puede editar en Illustrator o Inkscape. Este es el formato que piden la mayoría de las revistas.",
      "Save the figure as a 300 dpi PNG, rasterized from the same drawing — for journals that will not take vector art.":
        "Guardar la figura como PNG de 300 ppp, rasterizado a partir del mismo dibujo — para revistas que no aceptan arte vectorial.",
      "Check every loaded recording":
        "Marcar todas las grabaciones cargadas",
      "Uncheck every loaded recording":
        "Desmarcar todas las grabaciones cargadas",
      "Grid size settings":
        "Ajustes de tamaño de cuadrícula",
      "Add to the Loaded Audio panel AND write a .wav file to disk.":
        "Añadir al panel de Audio Cargado Y escribir un archivo .wav en el disco.",
      "Add to the Loaded Audio panel only — nothing written to disk.":
        "Añadir solo al panel de Audio Cargado — nada se escribe en el disco.",
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
      "Amplitude Detector": "Rilevatore di Ampiezza",
      "Manual Echemes": "Motivi Manuali",
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
      // ── Panel descriptions / explanations ──
      "Edits apply to the active recording for both Temporal and Spectral analysis. Click \"Trim…\" then drag the two handles on the waveform/spectrogram below to choose the region to keep.":
        "Le modifiche si applicano alla registrazione attiva sia per l'Analisi Temporale che per quella Spettrale. Fai clic su «Taglia…» e poi trascina le due maniglie sulla forma d'onda/spettrogramma qui sotto per scegliere la regione da conservare.",
      "Click the waveform to place the playhead; drag to select a stretch of time. |< and >| step through its edges.":
        "Fai clic sulla forma d'onda per posizionare il cursore di riproduzione; trascina per selezionare un intervallo di tempo. |< e >| scorrono i suoi bordi.",
      "Drag out a region on the waveform/spectrogram below to select it, drag the middle of a selection to move it, or drag either edge to resize.":
        "Trascina per delimitare una regione sulla forma d'onda/spettrogramma qui sotto e selezionarla, trascina il centro di una selezione per spostarla, o trascina uno dei bordi per ridimensionarla.",
      "Scales every frequency down by this percentage while keeping the duration the same — 25% moves a 40 kHz peak to 30 kHz over the same 3 s.":
        "Riduce ogni frequenza di questa percentuale mantenendo invariata la durata — il 25% sposta un picco di 40 kHz a 30 kHz negli stessi 3 s.",
      "Lowers the sample rate (and with it, the Nyquist limit — everything above it is gone for good). An anti-aliasing filter runs first so content above the new Nyquist is removed rather than folded back down into the passband.":
        "Riduce la frequenza di campionamento (e con essa il limite di Nyquist — tutto ciò che sta sopra scompare definitivamente). Viene prima applicato un filtro anti-aliasing per rimuovere il contenuto sopra il nuovo Nyquist invece di farlo ripiegare nella banda passante.",
      "\"Save edited files\" writes each checked entry to a folder you pick (defaults to wherever the last import came from) as <original name>_<edit suffix>.wav — e.g. a 1kHz high-pass + normalize becomes \"call_1hpf_n0.wav\".":
        "«Salva file modificati» scrive ogni voce selezionata in una cartella a scelta (predefinita: da dove proviene l'ultima importazione) come <nome originale>_<suffisso di modifica>.wav — ad es. un passa-alto a 1kHz + normalizzazione diventa «call_1hpf_n0.wav».",
      "Frequency resolution of the spectral measurements. Nothing here affects envelope peak detection or grouping. Hold these constant to compare recordings — stated in Hz, they mean the same thing at any sample rate.":
        "Risoluzione in frequenza delle misurazioni spettrali. Nulla qui influisce sul rilevamento o raggruppamento dei picchi di inviluppo. Mantieni questi valori costanti per confrontare le registrazioni — espressi in Hz, significano la stessa cosa a qualsiasi frequenza di campionamento.",
      "Use the 📂 Audio button in the top bar to import files (you can select several at once) — they land in the Loaded Audio panel and here, ready to add as traces.":
        "Usa il pulsante 📂 Audio nella barra superiore per importare i file (puoi selezionarne più di uno alla volta) — compaiono nel pannello Audio Caricato e qui, pronti per essere aggiunti come tracce.",
      "Time axis defaults to the longest wave plus the buffer, until you edit it by hand.":
        "L'asse del tempo assume come predefinito l'onda più lunga più il margine, finché non lo modifichi manualmente.",
      "\"Thickness\"/\"Color\" also restyle a selected scale bar's line.":
        "«Spessore»/«Colore» restilizzano anche la linea di una barra di scala selezionata.",
      "Click a label to select it — Shift/Ctrl-click to add more, or drag a rectangle over empty space (Shift adds, Ctrl toggles). Drag or use arrow keys to move the selection. Double-click to edit text. Renaming labels in the plot does not rename the waves on the left.":
        "Fai clic su un'etichetta per selezionarla — Shift/Ctrl-clic per aggiungerne altre, o trascina un rettangolo sullo spazio vuoto (Shift aggiunge, Ctrl alterna). Trascina o usa le frecce per spostare la selezione. Doppio clic per modificare il testo. Rinominare le etichette nel grafico non rinomina le onde a sinistra.",
      "Use the 📂 Audio button in the top bar to import files. Pick one below to zoom into.":
        "Usa il pulsante 📂 Audio nella barra superiore per importare i file. Scegline uno qui sotto su cui eseguire lo zoom.",
      "Click a scale bar in the figure to select it, then Set. A length longer than its panel is capped at the panel's span.":
        "Fai clic su una barra di scala nella figura per selezionarla, poi Imposta. Una lunghezza maggiore del pannello viene limitata all'estensione del pannello.",
      "Drag across any panel to open that slice below it. Shift/Ctrl-drag selects labels instead of zooming.":
        "Trascina su un pannello qualsiasi per aprire quella porzione sotto di esso. Shift/Ctrl-trascinamento seleziona etichette invece di fare zoom.",
      "\"Thickness\"/\"Color\" also restyle a selected scale bar's line or a selected zoom bracket.":
        "«Spessore»/«Colore» restilizzano anche la linea di una barra di scala selezionata o una parentesi di zoom selezionata.",
      "Saves the settings in this sidebar only — panel ranges, label text and dragged positions belong to the recording, not the preset.":
        "Salva solo le impostazioni di questa barra laterale — gli intervalli dei pannelli, il testo delle etichette e le posizioni trascinate appartengono alla registrazione, non alla preimpostazione.",
      "Click a label to select it — Shift/Ctrl-click to add more, or Shift/Ctrl-drag over a panel to marquee-select labels. Drag or use arrow keys to move the selection. Double-click to edit text.":
        "Fai clic su un'etichetta per selezionarla — Shift/Ctrl-clic per aggiungerne altre, o Shift/Ctrl-trascinamento su un pannello per selezionare etichette con un riquadro. Trascina o usa le frecce per spostare la selezione. Doppio clic per modificare il testo.",
      "Use the 📂 Audio button in the top bar to import files, then pick one below.":
        "Usa il pulsante 📂 Audio nella barra superiore per importare i file, poi scegline uno qui sotto.",
      "FRB/FRT/FFT changes need a re-Analyze. The FRPT and every style control below redraw on the spot.":
        "Le modifiche a FRB/FRT/FFT richiedono di rieseguire Analizza. Il FRPT e ogni controllo di stile qui sotto si ridisegnano all'istante.",
      "Time resolution is the spectrogram's, not the oscillogram's — that is inherent to the method.":
        "La risoluzione temporale è quella dello spettrogramma, non quella dell'oscillogramma — è intrinseco al metodo.",
      "On the figure:": "Nella figura:",
      "drag to zoom to a range, click to place the playhead, wheel to zoom, Shift+wheel to pan, double-click for the whole recording. Space plays or pauses.":
        "trascina per ingrandire un intervallo, fai clic per posizionare il cursore di riproduzione, usa la rotella per lo zoom, Shift+rotella per scorrere, doppio clic per l'intera registrazione. Barra spaziatrice per riprodurre o mettere in pausa.",
      "Check the recordings to average in the Loaded Audio panel at the bottom of the window — no separate add step, whatever's checked there is what gets drawn.":
        "Seleziona le registrazioni da mediare nel pannello Audio Caricato in fondo alla finestra — nessun passaggio di aggiunta separato, ciò che è selezionato lì è ciò che viene disegnato.",
      "All recordings must share the same sample rate — they're averaged bin-for-bin into the mean/median contour and SD band. The photo is optional; without one, only the spectrum panel is drawn. Drag the photo to pan it within the frame; drag the A/B letters to reposition them.":
        "Tutte le registrazioni devono condividere la stessa frequenza di campionamento — vengono mediate bin per bin nel contorno di media/mediana e nella banda di DS. La foto è opzionale; senza di essa, viene disegnato solo il pannello dello spettro. Trascina la foto per spostarla nel riquadro; trascina le lettere A/B per riposizionarle.",
      "Add the Temporal Analysis and/or Spectral Analysis .xlsx exports for each recording. The Specimen ID tagged when exporting (top toolbar) is read automatically; if it's missing or wrong, fix it below — that's what groups recordings by animal in the summary.":
        "Aggiungi le esportazioni .xlsx di Analisi Temporale e/o Analisi Spettrale per ogni registrazione. L'ID esemplare taggato al momento dell'esportazione (barra superiore) viene letto automaticamente; se manca o è errato, correggilo qui sotto — è questo che raggruppa le registrazioni per animale nel riepilogo.",
      "Check entries here to select which ones the Habitus/Osc. panes work on, and to batch-edit them from the Preprocessing tab.":
        "Seleziona le voci qui per scegliere su quali agiscono i pannelli Habitus/Osc., e per modificarle in blocco dalla scheda Preelaborazione.",
      // ── Tooltips (title attributes) ──
      "Back to the home tab":
        "Torna alla scheda iniziale",
      "Tagged per loaded recording — carried into every exported table (Peaks/Pulses/Motifs/Spectral) as its first column, and used by Summarize to count individuals correctly.":
        "Assegnato per ogni registrazione caricata — riportato come prima colonna in ogni tabella esportata (Picchi/Impulsi/Motivi/Spettrale), e usato da Riepilogo per contare correttamente gli esemplari.",
      "Tagged per loaded recording — carried into every exported table as a column.":
        "Assegnato per ogni registrazione caricata — riportato come colonna in ogni tabella esportata.",
      "Tagged per loaded recording — carried into every exported table as a column, and saved into the specimen metadata .json alongside Species and Locality.":
        "Assegnato per ogni registrazione caricata — riportato come colonna in ogni tabella esportata, e salvato nel .json dei metadati dell'esemplare insieme a Specie e Località.",
      "Air temperature at the time of recording, in °C. Tagged per loaded recording — carried into every exported table as the temp_c column. Stridulation rate is strongly temperature-dependent, so this is needed to compare recordings. Free text, so 22.5 or ~23 are both fine.":
        "Temperatura dell'aria al momento della registrazione, in °C. Assegnata per ogni registrazione caricata — riportata come colonna temp_c in ogni tabella esportata. Il tasso di stridulazione dipende fortemente dalla temperatura, quindi è necessaria per confrontare le registrazioni. È testo libero, quindi 22.5 o ~23 vanno bene entrambi.",
      "Save Specimen ID/Species/Locality to a .json file, so it can be reloaded for other recordings of the same specimen.":
        "Salva ID esemplare/Specie/Località in un file .json, così da poterli ricaricare per altre registrazioni dello stesso esemplare.",
      "Load Specimen ID/Species/Locality from a previously saved .json file.":
        "Carica ID esemplare/Specie/Località da un file .json salvato in precedenza.",
      "Language — English default; the app remembers your choice.":
        "Lingua — inglese predefinito; l'app ricorda la tua scelta.",
      "Clear the time selection (a plain click on the waveform does this too).":
        "Cancella la selezione temporale (anche un semplice clic sulla forma d'onda lo fa).",
      "Drag two handles on the waveform/spectrogram (Spectral Analysis tab) to choose the region to keep, then confirm.":
        "Trascina due maniglie sulla forma d'onda/spettrogramma (scheda Analisi Spettrale) per scegliere la regione da conservare, poi conferma.",
      "Restore the full duration.":
        "Ripristina la durata completa.",
      "Type a duration (s) — resizes the selection from its current start.":
        "Digita una durata (s) — ridimensiona la selezione a partire dal suo inizio attuale.",
      "Save the current selection as its own .wav (original name + _1, _2, …) without confirming/applying the trim.":
        "Salva la selezione corrente come proprio .wav (nome originale + _1, _2, …) senza confermare/applicare il taglio.",
      "High-pass cutoff in Hz (removes content below). 0 = off.":
        "Taglio passa-alto in Hz (rimuove il contenuto sottostante). 0 = disattivato.",
      "Low-pass cutoff in Hz (removes content above). Defaults to the Nyquist frequency.":
        "Taglio passa-basso in Hz (rimuove il contenuto superiore). Predefinito sulla frequenza di Nyquist.",
      "Remove the bandpass filter.":
        "Rimuovi il filtro passa-banda.",
      "Percentage to lower every frequency by. 50% halves them; 0 and 100 are not valid.":
        "Percentuale di riduzione di ogni frequenza. Il 50% le dimezza; 0 e 100 non sono validi.",
      "Remove the frequency drop.":
        "Rimuovi la riduzione di frequenza.",
      "Only rates below the current sample rate are offered — this reduces resolution, it never increases it.":
        "Vengono offerte solo frequenze inferiori a quella di campionamento attuale — questo riduce la risoluzione, non la aumenta mai.",
      "Restore the original sample rate.":
        "Ripristina la frequenza di campionamento originale.",
      "Nothing to undo.":
        "Niente da annullare.",
      "Save the current (edited) audio as a new entry in the Loaded Audio panel, without touching the original file.":
        "Salva l'audio attuale (modificato) come nuova voce nel pannello Audio Caricato, senza toccare il file originale.",
      "High-pass cutoff in Hz. 0 = off.":
        "Taglio passa-alto in Hz. 0 = disattivato.",
      "Low-pass cutoff in Hz. 0 = Nyquist (off).":
        "Taglio passa-basso in Hz. 0 = Nyquist (disattivato).",
      "Target envelope peak level in dBFS (0 = full scale).":
        "Livello obiettivo del picco di inviluppo in dBFS (0 = scala piena).",
      "Scale every frequency down by this percentage, keeping each recording's duration unchanged.":
        "Riduci ogni frequenza di questa percentuale, mantenendo invariata la durata di ogni registrazione.",
      "Rates are offered below the highest-rate checked recording. A checked recording already at or below the chosen rate is left untouched. An anti-aliasing filter runs before each one is decimated.":
        "Vengono offerte frequenze inferiori alla registrazione selezionata con la frequenza più alta. Una registrazione selezionata già alla o sotto la frequenza scelta viene lasciata invariata. Un filtro anti-aliasing viene applicato prima di decimare ciascuna.",
      "Drag to resize":
        "Trascina per ridimensionare",
      "Drag to resize bottom panel":
        "Trascina per ridimensionare il pannello inferiore",
      "Jump to the previous selection edge (trim handles, or annotation bounds)":
        "Vai al bordo di selezione precedente (maniglie di taglio, o limiti di annotazione)",
      "Jump to the next selection edge (trim handles, or annotation bounds)":
        "Vai al bordo di selezione successivo (maniglie di taglio, o limiti di annotazione)",
      "Playback speed as a percentage of real time, from 1 to 400. Slowing down also lowers the pitch, which brings ultrasonic song into hearing range: 1% plays a 120 kHz carrier at about 1.2 kHz. Note that it stretches the recording by the same factor, so 1% takes 100x as long to play. To lower the pitch WITHOUT stretching time, use Freq drop instead.":
        "Velocità di riproduzione come percentuale del tempo reale, da 1 a 400. Rallentare abbassa anche il tono, portando il canto ultrasonico nel campo udibile: l'1% riproduce una portante di 120 kHz a circa 1,2 kHz. Nota che questo allunga la registrazione dello stesso fattore, quindi l'1% impiega 100 volte più tempo per essere riprodotto. Per abbassare il tono SENZA allungare il tempo, usa invece Riduci frequenza.",
      "Lower every frequency by this percentage for LISTENING only — the stored audio, measurements, exports and plots are untouched. Unlike Speed, this keeps the tempo: 0 = off.":
        "Abbassa ogni frequenza di questa percentuale solo per l'ASCOLTO — l'audio memorizzato, le misurazioni, le esportazioni e i grafici restano invariati. A differenza di Velocità, questo mantiene il tempo: 0 = disattivato.",
      "Select/Seek (S)":
        "Seleziona/Cerca (S)",
      "Draw annotation (A)":
        "Disegna annotazione (A)",
      "Pan/scroll (H)":
        "Scorri (H)",
      "Ignore the vertical drag: annotations cover the whole frequency axis, so you only aim at the time axis.":
        "Ignora il trascinamento verticale: le annotazioni coprono l'intero asse della frequenza, quindi miri solo all'asse del tempo.",
      "Nothing to undo (Ctrl+Z)":
        "Niente da annullare (Ctrl+Z)",
      "Export Selection table":
        "Esporta tabella delle selezioni",
      "Clear all selections, detections, and measurements from the spectrogram":
        "Cancella tutte le selezioni, i rilevamenti e le misurazioni dallo spettrogramma",
      "Import selections from a Raven selection table (.txt/.csv).":
        "Importa selezioni da una tabella di selezione Raven (.txt/.csv).",
      "Import the Pulse or Motif table from a Temporal Analysis Excel export as selections.":
        "Importa la tabella Impulsi o Motivi da un'esportazione Excel di Analisi Temporale come selezioni.",
      "Frequency resolution used to MEASURE spectral features in the table below. Independent of the display FFT, so you can use a small display FFT for temporal detail while still measuring frequency precisely. The FFT is auto-sized (next power of 2) to reach at least this resolution.":
        "Risoluzione in frequenza usata per MISURARE le caratteristiche spettrali nella tabella qui sotto. Indipendente dalla FFT di visualizzazione, quindi puoi usare una FFT di visualizzazione piccola per il dettaglio temporale pur misurando la frequenza con precisione. La FFT viene dimensionata automaticamente (potenza di 2 successiva) per raggiungere almeno questa risoluzione.",
      "Clear the measurements table":
        "Cancella la tabella delle misurazioni",
      "Compute spectral metrics for selections or detections and prepare Excel output.":
        "Calcola le metriche spettrali per selezioni o rilevamenti e prepara l'output Excel.",
      "Save the most recently computed spectral metrics as an Excel workbook.":
        "Salva le metriche spettrali calcolate più di recente come cartella di lavoro Excel.",
      "Save a plain-language narrative summary of the computed spectral metrics as a DOCX file.":
        "Salva un riepilogo narrativo in linguaggio semplice delle metriche spettrali calcolate come file DOCX.",
      "Show a plain-language explanation of every column in the measurements table.":
        "Mostra una spiegazione in linguaggio semplice di ogni colonna della tabella delle misurazioni.",
      "Optional lower floor: weak envelope peaks above this value are kept ONLY when they sit within one Max-envelope peak-gap of an accepted (strong) envelope peak. Catches the quiet onset/offset envelope peaks of a pulse without picking up isolated inter-pulse noise. Leave blank to disable.":
        "Soglia inferiore opzionale: i picchi di inviluppo deboli sopra questo valore vengono mantenuti SOLO quando si trovano entro un Gap-picco max di inviluppo da un picco di inviluppo accettato (forte). Cattura i picchi di inviluppo deboli di inizio/fine di un impulso senza catturare rumore isolato tra gli impulsi. Lascia vuoto per disattivare.",
      "After detection, removes near-baseline 'envelope peaks' that pass the prominence check on their own tiny local dip but aren't real signal. A envelope peak is dropped only if it BOTH sits within this much of the recording's floor AND is more than this much below the real envelope peaks on either side — so a low bump between two pulses goes, while the quiet onset/offset envelope peaks of a real pulse stay. Runs of several bumps at the same low level are judged as one unit against the taller envelope peaks flanking the whole run. Leave blank to disable.":
        "Dopo il rilevamento, rimuove i \"picchi di inviluppo\" vicini alla linea di base che superano il controllo di prominenza per un proprio minuscolo avvallamento locale ma non sono segnale reale. Un picco di inviluppo viene scartato solo se si trova ENTRO questa distanza dalla soglia della registrazione E più di questa distanza sotto i picchi di inviluppo reali su entrambi i lati — così un piccolo rigonfiamento tra due impulsi viene rimosso, mentre i deboli picchi di inviluppo di inizio/fine di un impulso reale restano. Serie di più rigonfiamenti allo stesso livello basso vengono giudicate come un'unica unità rispetto ai picchi di inviluppo più alti che fiancheggiano l'intera serie. Lascia vuoto per disattivare.",
      "Expand every pulse (and therefore every motif/sequence) by this many milliseconds on EACH side, to capture the true acoustic onset/offset that precedes/follows each envelope peak's amplitude maximum. Pulse rate and other envelope peak-timing metrics are unaffected.":
        "Espande ogni impulso (e quindi ogni motivo/sequenza) di questo numero di millisecondi su OGNI lato, per catturare il vero inizio/fine acustico che precede/segue il massimo di ampiezza di ciascun picco di inviluppo. Il tasso di impulsi e le altre metriche di temporizzazione dei picchi di inviluppo non ne risentono.",
      "For species whose pulses run back to back, where the silence between pulses is no longer than the spacing between envelope peaks inside one, so Max envelope peak gap cannot separate them. Splits at the valley between two amplitude arches instead. Runs AFTER the gap rule and only subdivides what it produced — it never merges pulses the gap rule separated.":
        "Per specie i cui impulsi si susseguono senza pause, dove il silenzio tra gli impulsi non è più lungo della spaziatura tra i picchi di inviluppo al loro interno, per cui il Gap-picco max di inviluppo non riesce a separarli. Divide invece alla valle tra due archi di ampiezza. Viene eseguito DOPO la regola del gap e suddivide solo ciò che essa ha prodotto — non unisce mai impulsi che la regola del gap ha separato.",
      "How far a valley must fall below the crests on either side, as a percentage of those crests. Relative, so quiet and loud pulses are judged alike. Lower = more splits.":
        "Quanto deve scendere una valle al di sotto delle creste su entrambi i lati, come percentuale di quelle creste. Relativo, così impulsi deboli e forti vengono giudicati allo stesso modo. Più basso = più divisioni.",
      "Refuses any arch cut that would leave a pulse shorter than this — shallow amplitude modulation inside one pulse can look like a valley. Leave blank to derive it from the recording: half the median duration of the pulses the unmistakable valleys produce.":
        "Rifiuta qualsiasi taglio d'arco che lascerebbe un impulso più corto di questo — una lieve modulazione di ampiezza all'interno di un impulso può sembrare una valle. Lascia vuoto per derivarlo dalla registrazione: metà della durata mediana degli impulsi prodotti dalle valli inequivocabili.",
      "Target frequency resolution for TOOTH spectra, in Hz. Resolution is 1/window, so 1500 Hz means a 0.67 ms window — but stating it in Hz keeps it identical across recordings with different sample rates, which a duration in milliseconds does not. The signal is still capped at half the distance to the neighbouring peak, so where pulses are tighter than this asks for, the row reports the coarser resolution it actually achieved in spec_res_hz. Keep this constant across a study.":
        "Risoluzione in frequenza obiettivo per gli spettri di DENTE, in Hz. La risoluzione è 1/finestra, quindi 1500 Hz significa una finestra di 0,67 ms — ma esprimerla in Hz la mantiene identica tra registrazioni con frequenze di campionamento diverse, cosa che una durata in millisecondi non fa. Il segnale resta comunque limitato a metà della distanza dal picco vicino, quindi dove gli impulsi sono più ravvicinati di quanto richiesto, la riga riporta la risoluzione più grossolana effettivamente raggiunta in spec_res_hz. Mantieni questo valore costante in tutto lo studio.",
      "Target frequency resolution for PULSE spectra, in Hz. 50 Hz means a 20 ms window. A pulse longer than that is Welch-averaged over overlapping frames at this resolution; a shorter pulse reports the coarser resolution it could actually achieve. The motif columns ending in _tmean are the average of these pulse rows. Keep it constant across a study.":
        "Risoluzione in frequenza obiettivo per gli spettri di IMPULSO, in Hz. 50 Hz significa una finestra di 20 ms. Un impulso più lungo di così viene mediato con il metodo di Welch su frame sovrapposti a questa risoluzione; un impulso più corto riporta la risoluzione più grossolana che ha potuto effettivamente raggiungere. Le colonne di motivo che terminano in _tmean sono la media di queste righe di impulso. Mantienilo costante in tutto lo studio.",
      "Target frequency resolution for MOTIF spectra, in Hz. 10 Hz means a 100 ms window, long enough to resolve structure the pulse window cannot. This measures the whole motif span, so its frames also cross the silence between pulses — on a low duty cycle that raises spec_entropy and spec_flatness. The motif row also carries _tmean columns, the average of its pulse rows, which contain no silence; compare the two. Keep this constant across a study.":
        "Risoluzione in frequenza obiettivo per gli spettri di MOTIVO, in Hz. 10 Hz significa una finestra di 100 ms, abbastanza lunga da risolvere strutture che la finestra dell'impulso non può. Questo misura l'intera estensione del motivo, quindi i suoi frame attraversano anche il silenzio tra gli impulsi — con un duty cycle basso questo aumenta spec_entropy e spec_flatness. La riga del motivo porta anche colonne _tmean, la media delle sue righe di impulso, che non contengono silenzio; confronta le due. Mantieni questo valore costante in tutto lo studio.",
      "Saved Temporal Analysis parameter sets (stored on this machine).":
        "Set di parametri di Analisi Temporale salvati (memorizzati su questa macchina).",
      "Save the current parameters into the selected slot.":
        "Salva i parametri attuali nello slot selezionato.",
      "Load the selected preset's parameters.":
        "Carica i parametri della preimpostazione selezionata.",
      "Delete the selected preset slot.":
        "Elimina lo slot di preimpostazione selezionato.",
      "Save the current parameters to a .json file. Opens a file browser so you can choose the folder and edit the name. Unlike the 10 slots, a file can be copied to another computer or kept beside the recordings it belongs to.":
        "Salva i parametri attuali in un file .json. Apre un esploratore di file per scegliere la cartella e modificare il nome. A differenza dei 10 slot, un file può essere copiato su un altro computer o conservato accanto alle registrazioni a cui appartiene.",
      "Load parameters from a .json preset file. The values go into the panels; use Save afterwards to also keep them in a slot.":
        "Carica i parametri da un file .json di preimpostazione. I valori vengono inseriti nei pannelli; usa poi Salva per conservarli anche in uno slot.",
      "Convert detected units into Spectral Analysis selections.":
        "Converti le unità rilevate in selezioni di Analisi Spettrale.",
      "Choose whether detected units become pulse or motif selections.":
        "Scegli se le unità rilevate diventano selezioni di impulso o di motivo.",
      "Load a Envelope peaks table from a Temporal Analysis Excel export, restoring the envelope peaks and the pulse boundaries exactly as they were saved, including any you edited by hand. Needs the matching audio loaded. Does not re-run detection.":
        "Carica una tabella di Picchi di inviluppo da un'esportazione Excel di Analisi Temporale, ripristinando i picchi di inviluppo e i confini degli impulsi esattamente come sono stati salvati, incluse eventuali modifiche manuali. Richiede che l'audio corrispondente sia caricato. Non riesegue il rilevamento.",
      "Correct a few pulses by hand, select their envelope peaks (shift-drag), then press this. Searches the pulse-grouping parameters for the combination that best reproduces the boundaries you set. Envelope peak DETECTION is only fitted if you tick the box below. Nothing changes until you press Apply.":
        "Correggi manualmente alcuni impulsi, seleziona i loro picchi di inviluppo (shift-trascinamento), poi premi questo. Cerca tra i parametri di raggruppamento degli impulsi la combinazione che riproduce meglio i confini impostati. Il RILEVAMENTO dei picchi di inviluppo viene adattato solo se selezioni la casella sottostante. Niente cambia finché non premi Applica.",
      "Also fit the envelope peak-detection parameters (envelope peak window, envelope peak/detection/onset thresholds, false envelope peak delta) to the envelope peaks you kept, added and deleted by hand. Smoothing is never fitted. Slower, and Apply then re-runs detection over the whole recording, which replaces manual envelope peak edits as well as boundary edits.":
        "Adatta anche i parametri di rilevamento dei picchi di inviluppo (finestra del picco, soglie di picco/rilevamento/insorgenza, delta del falso picco di inviluppo) ai picchi di inviluppo che hai mantenuto, aggiunto ed eliminato manualmente. Lo smoothing non viene mai adattato. Più lento, e Applica riesegue quindi il rilevamento sull'intera registrazione, il che sostituisce sia le modifiche manuali dei picchi di inviluppo sia quelle dei confini.",
      "Write the fitted parameters into the panels and re-apply them over the whole recording. This replaces manual boundary edits, including the ones just pulseed on.":
        "Scrive i parametri adattati nei pannelli e li riapplica sull'intera registrazione. Questo sostituisce le modifiche manuali dei confini, incluse quelle appena usate per l'adattamento.",
      "Left-click a marker to select it.":
        "Clic sinistro su un marcatore per selezionarlo.",
      "Click anywhere on the plot to add a envelope peak, snapped to the envelope at that time.":
        "Fai clic in un punto qualsiasi del grafico per aggiungere un picco di inviluppo, agganciato all'inviluppo in quell'istante.",
      "Re-run the detected segmentation, discarding manual boundary edits (added/removed envelope peaks are kept).":
        "Riesegue la segmentazione rilevata, scartando le modifiche manuali dei confini (i picchi di inviluppo aggiunti/rimossi vengono mantenuti).",
      "Re-apply the False envelope peak Δ filter to the current envelope peaks (e.g. after manually adding one, or after changing the Δ value).":
        "Riapplica il filtro Δ falso picco di inviluppo ai picchi di inviluppo attuali (ad es. dopo averne aggiunto uno manualmente, o dopo aver modificato il valore di Δ).",
      "Assign the selected envelope peak(s) to the left pulse.":
        "Assegna i picchi di inviluppo selezionati all'impulso a sinistra.",
      "Assign the selected envelope peak(s) to the right pulse.":
        "Assegna i picchi di inviluppo selezionati all'impulso a destra.",
      "Merge the left gap for the selected envelope peak.":
        "Unisci il gap a sinistra del picco di inviluppo selezionato.",
      "Merge the right gap for the selected envelope peak.":
        "Unisci il gap a destra del picco di inviluppo selezionato.",
      "Split the left gap for the selected envelope peak.":
        "Dividi il gap a sinistra del picco di inviluppo selezionato.",
      "Split the right gap for the selected envelope peak.":
        "Dividi il gap a destra del picco di inviluppo selezionato.",
      "Make the selected envelope peaks into a single pulse.":
        "Trasforma i picchi di inviluppo selezionati in un unico impulso.",
      "Join internal gaps within the selected envelope peaks.":
        "Unisci i gap interni tra i picchi di inviluppo selezionati.",
      "Remove the selected envelope peak(s).":
        "Rimuovi i picchi di inviluppo selezionati.",
      "Clear the current envelope peak selection.":
        "Cancella la selezione attuale di picchi di inviluppo.",
      "Magnify amplitude — reveals faint envelope peaks (clips tall ones at the top).":
        "Ingrandisci l'ampiezza — rivela picchi di inviluppo deboli (taglia quelli alti in cima).",
      "Show a small synced spectrogram below the envelope to tell real envelope peak impacts from noise.":
        "Mostra un piccolo spettrogramma sincronizzato sotto l'inviluppo per distinguere i veri impatti dei picchi di inviluppo dal rumore.",
      "Overview — click or drag to navigate; drag the highlighted window to pan.":
        "Panoramica — fai clic o trascina per navigare; trascina la finestra evidenziata per scorrere.",
      "Export all tables (Envelope peaks, Pulses, Motifs, MotifSeqs, Summary) into one Excel workbook — one sheet each.":
        "Esporta tutte le tabelle (Picchi di inviluppo, Impulsi, Motivi, SeqMotivi, Riepilogo) in un'unica cartella di lavoro Excel — un foglio ciascuna.",
      "Auto-coded Oscillogram — an oscillogram whose colour marks the frequency bands present above a threshold. After Brizio (2023), Colour Enhanced Time/Pressure Envelope":
        "Oscillogramma Autocodificato — un oscillogramma il cui colore segna le bande di frequenza presenti sopra una soglia. Da Brizio (2023), Colour Enhanced Time/Pressure Envelope",
      "Clear preset":
        "Cancella preimpostazione",
      "Write the current plot settings to a .json file you can keep beside your recordings or share.":
        "Scrivi le impostazioni attuali del grafico in un file .json che puoi conservare accanto alle tue registrazioni o condividere.",
      "Load plot settings from a .json preset file into the toolbar.":
        "Carica le impostazioni del grafico da un file .json di preimpostazione nella barra degli strumenti.",
      "Shared scale for the Power Spectrum curve and the spectrogram's colour mapping. dB compresses the range so quieter shoulders stay visible; Linear puts everything relative to the peak, so the dominant band reads as a sharp spike and the rest fades fast.":
        "Scala condivisa per la curva dello Spettro di Potenza e la mappatura dei colori dello spettrogramma. dB comprime l'intervallo così le spalle più deboli restano visibili; Lineare pone tutto relativo al picco, quindi la banda dominante si legge come un picco netto e il resto svanisce rapidamente.",
      "Use current analyzer view":
        "Usa la vista attuale dell'analizzatore",
      "Use current freq view":
        "Usa la vista di frequenza attuale",
      "The species this selection is of. Typed once, then offered from the list.":
        "La specie a cui appartiene questa selezione. Digitata una volta, poi proposta dall'elenco.",
      "Wind and handling noise routinely exceed an insect call in absolute level. Set this above the rumble or it will capture the envelope peak and drag the band down to DC.":
        "Il rumore di vento e maneggio supera abitualmente il livello assoluto del canto di un insetto. Imposta questo sopra il rombo, altrimenti catturerà il picco di inviluppo e trascinerà la banda fino a DC.",
      "Band edges this many dB below the spectrum's peak. 20 dB is the usual bioacoustics convention.":
        "Bordi della banda a questo numero di dB sotto il picco dello spettro. 20 dB è la convenzione bioacustica abituale.",
      "outer — outermost crossings, harmonics included (and any neighbour calling in the same window). around peak — the one lobe around the carrier.":
        "esterno — attraversamenti più esterni, armoniche incluse (e qualsiasi vicino che canti nella stessa finestra). attorno al picco — solo il lobo attorno alla portante.",
      "Re-derive the band from the threshold whenever the selection changes.":
        "Rideriva la banda dalla soglia ogni volta che la selezione cambia.",
      "Freeze the band across every later selection and every later recording. What makes 'auto' safe to leave on.":
        "Blocca la banda per ogni selezione e registrazione successiva. Ciò che rende sicuro lasciare attivo \"auto\".",
      "Power-spectrum window. Deliberately not the finest available: fine structure from one individual or one microphone does not generalise, and the band should describe the species.":
        "Finestra dello spettro di potenza. Deliberatamente non la più fine disponibile: la struttura fine di un singolo individuo o microfono non generalizza, e la banda dovrebbe descrivere la specie.",
      "Display only — neither scale changes a number that gets saved. Linear makes the carrier read as a spike; dB makes the shoulders visible.":
        "Solo visualizzazione — nessuna scala modifica un numero che viene salvato. Lineare fa leggere la portante come un picco netto; dB rende visibili le spalle.",
      "Spectrogram dynamic range, in dB below the loudest bin in view.":
        "Intervallo dinamico dello spettrogramma, in dB sotto il bin più forte in vista.",
      "Drag to set the time span. Shift+drag to pan. Wheel to zoom. Click to clear.":
        "Trascina per impostare l'intervallo di tempo. Shift+trascinamento per scorrere. Rotella per lo zoom. Clic per cancellare.",
      "Display only. Click a box to select it and adopt its label and band. Wheel to zoom time, Ctrl+wheel to zoom frequency.":
        "Solo visualizzazione. Fai clic su un riquadro per selezionarlo e adottarne l'etichetta e la banda. Rotella per lo zoom sul tempo, Ctrl+rotella per lo zoom sulla frequenza.",
      "Power spectrum of the marked span. Drag horizontally to set the band by hand.":
        "Spettro di potenza dell'intervallo segnato. Trascina orizzontalmente per impostare la banda manualmente.",
      "Commit the pending box (Enter / A)":
        "Conferma il riquadro in sospeso (Invio / A)",
      "Undo (Ctrl+Z)":
        "Annulla (Ctrl+Z)",
      "Drop the time span, keep the band (Esc)":
        "Elimina l'intervallo di tempo, mantieni la banda (Esc)",
      "Delete the selected box (Del)":
        "Elimina il riquadro selezionato (Canc)",
      "Write <species>.band.json. Refused for a band derived from the whole view — in a recording holding two species that is neither species' band.":
        "Scrive <specie>.band.json. Rifiutato per una banda derivata dall'intera vista — in una registrazione con due specie quella non è la banda di nessuna delle due.",
      "Adopt a saved band: same edges, locked.":
        "Adotta una banda salvata: stessi bordi, bloccata.",
      "What to do when the pieces disagree. Resampling low-passes before any downsample, so it cannot alias.":
        "Cosa fare quando i pezzi non coincidono. Il ricampionamento applica un passa-basso prima di qualsiasi sottocampionamento, quindi non può generare aliasing.",
      "Silence inserted between pieces, never before the first or after the last. 0 reproduces merge_waves() exactly.":
        "Silenzio inserito tra i pezzi, mai prima del primo né dopo l'ultimo. 0 riproduce esattamente merge_waves().",
      "Subtract the mean of the whole merged signal, as tuneR's normalize(center = TRUE) does.":
        "Sottrae la media dell'intero segnale unito, come fa normalize(center = TRUE) di tuneR.",
      "Envelope peak-normalize the merged signal. NOTE: this destroys the relative levels between the source recordings.":
        "Normalizza per picco di inviluppo il segnale unito. NOTA: questo distrugge i livelli relativi tra le registrazioni di origine.",
      "Write the merged audio as a 16-bit mono WAV.":
        "Scrivi l'audio unito come WAV mono a 16 bit.",
      "Write where each source recording landed, as a Raven selection table.":
        "Scrivi dove è finita ogni registrazione di origine, come tabella di selezione Raven.",
      "Extra audio shown on each side of a brushed selection, as a % of the selection's own width, so the zoomed panel isn't a context-free sliver. The selection itself stays centered.":
        "Audio extra mostrato su entrambi i lati di una selezione tracciata, come % della larghezza propria della selezione, così il pannello ingrandito non è una striscia priva di contesto. La selezione stessa resta centrata.",
      "Length of the scale bar on the selected panel(s). Each panel keeps its own length, since zoom panels span very different durations. Leave a panel on Auto for a bar about 20% of that panel's width.":
        "Lunghezza della barra di scala nei pannelli selezionati. Ogni pannello mantiene la propria lunghezza, poiché i pannelli di zoom coprono durate molto diverse. Lascia un pannello su Auto per una barra pari a circa il 20% della larghezza di quel pannello.",
      "Apply this length to the selected scale bar(s).":
        "Applica questa lunghezza alle barre di scala selezionate.",
      "Return the selected scale bar(s) to the automatic length.":
        "Riporta le barre di scala selezionate alla lunghezza automatica.",
      "Apply to every panel instead of only the selected scale bars.":
        "Applica a tutti i pannelli invece che solo alle barre di scala selezionate.",
      "Write the current Osc. Zoom settings to a .json file you can reuse or share.":
        "Scrivi le impostazioni attuali di Zoom Oscillogramma in un file .json che puoi riutilizzare o condividere.",
      "Load Osc. Zoom settings from a .json preset file.":
        "Carica le impostazioni di Zoom Oscillogramma da un file .json di preimpostazione.",
      "FFT size sets the frequency resolution and, inversely, the time resolution of the whole rendering: t = nfft / fs.":
        "La dimensione della FFT imposta la risoluzione in frequenza e, inversamente, la risoluzione temporale dell'intero rendering: t = nfft / fs.",
      "Higher overlap gives more drawn columns per second — finer colour placement in time at the same frequency resolution.":
        "Una sovrapposizione maggiore dà più colonne disegnate al secondo — un posizionamento del colore più fine nel tempo alla stessa risoluzione in frequenza.",
      "2-colour marks one frequency range in a single contrasting colour. Multicolour splits the range into uniform bands, each mapped to one bit of the 24-bit RGB triplet.":
        "2 colori segna un intervallo di frequenza in un unico colore contrastante. Multicolore divide l'intervallo in bande uniformi, ciascuna mappata su un bit della terna RGB a 24 bit.",
      "Frequency Range Bottom":
        "Limite inferiore dell'intervallo di frequenza",
      "Frequency Range Top":
        "Limite superiore dell'intervallo di frequenza",
      "Frequency Range Pressure Threshold. A band counts as present when its strongest bin reaches this level. Changing it recolours instantly — no re-analysis.":
        "Soglia di pressione dell'intervallo di frequenza. Una banda è considerata presente quando il suo bin più forte raggiunge questo livello. Modificarla ricolora all'istante — senza rianalizzare.",
      "Restrict colour to columns whose OVERALL level falls in a range — a way to exclude the loudest or the feeblest parts of the recording.":
        "Limita il colore alle colonne il cui livello COMPLESSIVO rientra in un intervallo — un modo per escludere le parti più forti o più deboli della registrazione.",
      "Overall Pressure Range Bottom":
        "Limite inferiore dell'intervallo di pressione complessivo",
      "Overall Pressure Range Top":
        "Limite superiore dell'intervallo di pressione complessivo",
      "Applies to the reference oscillogram only. The Auto-coded Oscillogram's own columns are always drawn exactly one column wide, so a thicker stroke can never smear one column's colour over its neighbours.":
        "Si applica solo all'oscillogramma di riferimento. Le colonne proprie dell'Oscillogramma Autocodificato vengono sempre disegnate esattamente larghe una colonna, quindi un tratto più spesso non può mai sbavare il colore di una colonna sulle vicine.",
      "Colour of every column that does NOT reach the threshold.":
        "Colore di ogni colonna che NON raggiunge la soglia.",
      "2-colour rendering only — multicolour takes its colours from the band mapping.":
        "Solo per il rendering a 2 colori — il multicolore prende i suoi colori dalla mappatura delle bande.",
      "Top of the displayed frequency axis. 0 = up to Nyquist.":
        "Estremo superiore dell'asse di frequenza visualizzato. 0 = fino a Nyquist.",
      "Write the current Auto-coded Oscillogram settings to a .json file you can reuse or share.":
        "Scrivi le impostazioni attuali dell'Oscillogramma Autocodificato in un file .json che puoi riutilizzare o condividere.",
      "Load Auto-coded Oscillogram settings from a .json preset file.":
        "Carica le impostazioni dell'Oscillogramma Autocodificato da un file .json di preimpostazione.",
      "PNG scale factor":
        "Fattore di scala del PNG",
      "Export the contiguous coloured stretches as a CSV of time intervals with the bands that lit them.":
        "Esporta i tratti colorati contigui come CSV di intervalli di tempo con le bande che li hanno attivati.",
      "The publication this module implements":
        "La pubblicazione implementata da questo modulo",
      "Play or pause the visible range (Space)":
        "Riproduci o metti in pausa l'intervallo visibile (Barra spaziatrice)",
      "Stop and return the playhead to the start of the view":
        "Ferma e riporta il cursore di riproduzione all'inizio della vista",
      "Playback speed as a percentage of real time, from 1 to 400 — the same scale as the main transport. Slowing down also lowers the pitch, which brings ultrasonic song into hearing range: 6% plays a 42 kHz song at about 2.6 kHz, and 1% reaches a 120 kHz carrier. It stretches the recording by the same factor, so 1% takes 100x as long to play.":
        "Velocità di riproduzione come percentuale del tempo reale, da 1 a 400 — la stessa scala del trasporto principale. Rallentare abbassa anche il tono, portando il canto ultrasonico nel campo udibile: il 6% riproduce un canto di 42 kHz a circa 2,6 kHz, e l'1% raggiunge una portante di 120 kHz. Allunga la registrazione dello stesso fattore, quindi l'1% impiega 100 volte più tempo per essere riprodotto.",
      "Lights while the playhead is over a highlighted column — a band above the FRPT is sounding.":
        "Si illumina quando il cursore di riproduzione è su una colonna evidenziata — una banda sopra la FRPT sta suonando.",
      "Zoom in on the centre of the view":
        "Zoom avanti sul centro della vista",
      "Zoom out":
        "Zoom indietro",
      "Show the whole recording (Home, or double-click the figure)":
        "Mostra l'intera registrazione (Home, o doppio clic sulla figura)",
      "Spacing between frequency axis ticks/labels. 0 = automatic (6 ticks).":
        "Spaziatura tra le tacche/etichette dell'asse di frequenza. 0 = automatico (6 tacche).",
      "Express every measurement at this temperature, using a least-squares fit of each metric against the temperatures actually recorded. Adds a corrected mean/SD beside every observed one in the table, a bracketed figure in the report, and the Temp_Regression sheets to the workbook.":
        "Esprime ogni misurazione a questa temperatura, usando un adattamento ai minimi quadrati di ogni metrica rispetto alle temperature effettivamente registrate.\n\nAggiunge una media/DS corretta accanto a ogni valore osservato nella tabella, una cifra tra parentesi nel rapporto, e i fogli Temp_Regression alla cartella di lavoro.",
      "How the min-max range is wrapped in the LaTeX and Word convenience columns of the saved workbook, e.g. 12.00±1.50 (9.80–14.20) versus 12.00±1.50 [9.80–14.20]. The columns are Excel formulas, so this is baked in when the workbook is written — change it and save again to switch.":
        "Come viene racchiuso l'intervallo min-max nelle colonne di comodo LaTeX e Word della cartella di lavoro salvata, ad es. 12.00±1.50 (9.80–14.20) contro 12.00±1.50 [9.80–14.20].\n\nLe colonne sono formule Excel, quindi questo viene fissato quando la cartella di lavoro viene scritta — cambialo e salva di nuovo per applicarlo.",
      "Save the figure as SVG — vector, so it stays sharp at any size and can be edited in Illustrator or Inkscape. This is the format most journals ask for.":
        "Salva la figura come SVG — vettoriale, quindi resta nitida a qualsiasi dimensione e può essere modificata in Illustrator o Inkscape. Questo è il formato richiesto dalla maggior parte delle riviste.",
      "Save the figure as a 300 dpi PNG, rasterized from the same drawing — for journals that will not take vector art.":
        "Salva la figura come PNG a 300 dpi, rasterizzato dallo stesso disegno — per riviste che non accettano immagini vettoriali.",
      "Check every loaded recording":
        "Seleziona tutte le registrazioni caricate",
      "Uncheck every loaded recording":
        "Deseleziona tutte le registrazioni caricate",
      "Grid size settings":
        "Impostazioni delle dimensioni della griglia",
      "Add to the Loaded Audio panel AND write a .wav file to disk.":
        "Aggiungi al pannello Audio Caricato E scrivi un file .wav su disco.",
      "Add to the Loaded Audio panel only — nothing written to disk.":
        "Aggiungi solo al pannello Audio Caricato — nulla viene scritto su disco.",
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
      "Amplitude Detector": "Detetor de Amplitude",
      "Manual Echemes": "Motivos Manuais",
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
      // ── Panel descriptions / explanations ──
      "Edits apply to the active recording for both Temporal and Spectral analysis. Click \"Trim…\" then drag the two handles on the waveform/spectrogram below to choose the region to keep.":
        "As edições se aplicam à gravação ativa tanto para a Análise Temporal quanto para a Espectral. Clique em «Cortar…» e depois arraste as duas alças na forma de onda/espectrograma abaixo para escolher a região a manter.",
      "Click the waveform to place the playhead; drag to select a stretch of time. |< and >| step through its edges.":
        "Clique na forma de onda para posicionar o cursor de reprodução; arraste para selecionar um trecho de tempo. |< e >| percorrem suas bordas.",
      "Drag out a region on the waveform/spectrogram below to select it, drag the middle of a selection to move it, or drag either edge to resize.":
        "Arraste para marcar uma região na forma de onda/espectrograma abaixo e selecioná-la, arraste o centro de uma seleção para movê-la, ou arraste uma das bordas para redimensioná-la.",
      "Scales every frequency down by this percentage while keeping the duration the same — 25% moves a 40 kHz peak to 30 kHz over the same 3 s.":
        "Reduz cada frequência nesta porcentagem mantendo a mesma duração — 25% move um pico de 40 kHz para 30 kHz nos mesmos 3 s.",
      "Lowers the sample rate (and with it, the Nyquist limit — everything above it is gone for good). An anti-aliasing filter runs first so content above the new Nyquist is removed rather than folded back down into the passband.":
        "Reduz a taxa de amostragem (e com ela, o limite de Nyquist — tudo o que estiver acima desaparece definitivamente). Um filtro anti-aliasing é aplicado primeiro para remover o conteúdo acima do novo Nyquist em vez de dobrá-lo de volta para a banda passante.",
      "\"Save edited files\" writes each checked entry to a folder you pick (defaults to wherever the last import came from) as <original name>_<edit suffix>.wav — e.g. a 1kHz high-pass + normalize becomes \"call_1hpf_n0.wav\".":
        "«Salvar arquivos editados» grava cada item marcado em uma pasta à sua escolha (padrão: de onde veio a última importação) como <nome original>_<sufixo de edição>.wav — por ex., um passa-alta de 1kHz + normalização vira «call_1hpf_n0.wav».",
      "Frequency resolution of the spectral measurements. Nothing here affects envelope peak detection or grouping. Hold these constant to compare recordings — stated in Hz, they mean the same thing at any sample rate.":
        "Resolução de frequência das medições espectrais. Nada aqui afeta a detecção ou o agrupamento de picos de envoltória. Mantenha esses valores constantes para comparar gravações — expressos em Hz, significam a mesma coisa em qualquer taxa de amostragem.",
      "Use the 📂 Audio button in the top bar to import files (you can select several at once) — they land in the Loaded Audio panel and here, ready to add as traces.":
        "Use o botão 📂 Audio na barra superior para importar arquivos (você pode selecionar vários de uma vez) — eles aparecem no painel Áudio Carregado e aqui, prontos para adicionar como traços.",
      "Time axis defaults to the longest wave plus the buffer, until you edit it by hand.":
        "O eixo do tempo assume por padrão a onda mais longa mais a margem, até que você o edite manualmente.",
      "\"Thickness\"/\"Color\" also restyle a selected scale bar's line.":
        "«Espessura»/«Cor» também reestilizam a linha de uma barra de escala selecionada.",
      "Click a label to select it — Shift/Ctrl-click to add more, or drag a rectangle over empty space (Shift adds, Ctrl toggles). Drag or use arrow keys to move the selection. Double-click to edit text. Renaming labels in the plot does not rename the waves on the left.":
        "Clique em um rótulo para selecioná-lo — Shift/Ctrl-clique para adicionar mais, ou arraste um retângulo sobre espaço vazio (Shift adiciona, Ctrl alterna). Arraste ou use as setas para mover a seleção. Duplo clique para editar o texto. Renomear rótulos no gráfico não renomeia as ondas à esquerda.",
      "Use the 📂 Audio button in the top bar to import files. Pick one below to zoom into.":
        "Use o botão 📂 Audio na barra superior para importar arquivos. Escolha um abaixo para dar zoom.",
      "Click a scale bar in the figure to select it, then Set. A length longer than its panel is capped at the panel's span.":
        "Clique em uma barra de escala na figura para selecioná-la, depois Definir. Um comprimento maior que o painel é limitado à extensão do painel.",
      "Drag across any panel to open that slice below it. Shift/Ctrl-drag selects labels instead of zooming.":
        "Arraste sobre qualquer painel para abrir aquele trecho abaixo dele. Shift/Ctrl-arraste seleciona rótulos em vez de dar zoom.",
      "\"Thickness\"/\"Color\" also restyle a selected scale bar's line or a selected zoom bracket.":
        "«Espessura»/«Cor» também reestilizam a linha de uma barra de escala selecionada ou um colchete de zoom selecionado.",
      "Saves the settings in this sidebar only — panel ranges, label text and dragged positions belong to the recording, not the preset.":
        "Salva apenas as configurações desta barra lateral — os intervalos dos painéis, o texto dos rótulos e as posições arrastadas pertencem à gravação, não à predefinição.",
      "Click a label to select it — Shift/Ctrl-click to add more, or Shift/Ctrl-drag over a panel to marquee-select labels. Drag or use arrow keys to move the selection. Double-click to edit text.":
        "Clique em um rótulo para selecioná-lo — Shift/Ctrl-clique para adicionar mais, ou Shift/Ctrl-arraste sobre um painel para selecionar rótulos com uma moldura. Arraste ou use as setas para mover a seleção. Duplo clique para editar o texto.",
      "Use the 📂 Audio button in the top bar to import files, then pick one below.":
        "Use o botão 📂 Audio na barra superior para importar arquivos, depois escolha um abaixo.",
      "FRB/FRT/FFT changes need a re-Analyze. The FRPT and every style control below redraw on the spot.":
        "As alterações em FRB/FRT/FFT exigem reanalisar. O FRPT e cada controle de estilo abaixo são redesenhados na hora.",
      "Time resolution is the spectrogram's, not the oscillogram's — that is inherent to the method.":
        "A resolução temporal é a do espectrograma, não a do oscilograma — isso é inerente ao método.",
      "On the figure:": "Na figura:",
      "drag to zoom to a range, click to place the playhead, wheel to zoom, Shift+wheel to pan, double-click for the whole recording. Space plays or pauses.":
        "arraste para dar zoom em um intervalo, clique para posicionar o cursor de reprodução, use a roda para dar zoom, Shift+roda para deslocar, duplo clique para a gravação inteira. Espaço reproduz ou pausa.",
      "Check the recordings to average in the Loaded Audio panel at the bottom of the window — no separate add step, whatever's checked there is what gets drawn.":
        "Marque as gravações a serem promediadas no painel Áudio Carregado na parte inferior da janela — não há uma etapa separada de adicionar, o que estiver marcado ali é o que é desenhado.",
      "All recordings must share the same sample rate — they're averaged bin-for-bin into the mean/median contour and SD band. The photo is optional; without one, only the spectrum panel is drawn. Drag the photo to pan it within the frame; drag the A/B letters to reposition them.":
        "Todas as gravações devem compartilhar a mesma taxa de amostragem — são promediadas bin a bin no contorno de média/mediana e na faixa de DP. A foto é opcional; sem ela, apenas o painel do espectro é desenhado. Arraste a foto para deslocá-la dentro do quadro; arraste as letras A/B para reposicioná-las.",
      "Add the Temporal Analysis and/or Spectral Analysis .xlsx exports for each recording. The Specimen ID tagged when exporting (top toolbar) is read automatically; if it's missing or wrong, fix it below — that's what groups recordings by animal in the summary.":
        "Adicione as exportações .xlsx de Análise Temporal e/ou Análise Espectral de cada gravação. O ID do espécime marcado ao exportar (barra superior) é lido automaticamente; se estiver ausente ou errado, corrija-o abaixo — é isso que agrupa as gravações por animal no resumo.",
      "Check entries here to select which ones the Habitus/Osc. panes work on, and to batch-edit them from the Preprocessing tab.":
        "Marque as entradas aqui para selecionar com quais os painéis Habitus/Osc. trabalham, e para editá-las em lote a partir da aba Pré-processamento.",
      // ── Tooltips (title attributes) ──
      "Back to the home tab":
        "Voltar à aba inicial",
      "Tagged per loaded recording — carried into every exported table (Peaks/Pulses/Motifs/Spectral) as its first column, and used by Summarize to count individuals correctly.":
        "Marcado por gravação carregada — incluído como primeira coluna em cada tabela exportada (Picos/Pulsos/Motivos/Espectral), e usado por Resumir para contar indivíduos corretamente.",
      "Tagged per loaded recording — carried into every exported table as a column.":
        "Marcado por gravação carregada — incluído como coluna em cada tabela exportada.",
      "Tagged per loaded recording — carried into every exported table as a column, and saved into the specimen metadata .json alongside Species and Locality.":
        "Marcado por gravação carregada — incluído como coluna em cada tabela exportada, e salvo no .json de metadados do espécime junto com Espécie e Localidade.",
      "Air temperature at the time of recording, in °C. Tagged per loaded recording — carried into every exported table as the temp_c column. Stridulation rate is strongly temperature-dependent, so this is needed to compare recordings. Free text, so 22.5 or ~23 are both fine.":
        "Temperatura do ar no momento da gravação, em °C. Marcada por gravação carregada — incluída como a coluna temp_c em cada tabela exportada. A taxa de estridulação depende fortemente da temperatura, por isso isso é necessário para comparar gravações. É texto livre, então 22.5 ou ~23 servem.",
      "Save Specimen ID/Species/Locality to a .json file, so it can be reloaded for other recordings of the same specimen.":
        "Salvar ID do espécime/Espécie/Localidade em um arquivo .json, para poder recarregá-los em outras gravações do mesmo espécime.",
      "Load Specimen ID/Species/Locality from a previously saved .json file.":
        "Carregar ID do espécime/Espécie/Localidade de um arquivo .json salvo anteriormente.",
      "Language — English default; the app remembers your choice.":
        "Idioma — inglês padrão; o aplicativo lembra sua escolha.",
      "Clear the time selection (a plain click on the waveform does this too).":
        "Limpar a seleção de tempo (um simples clique na forma de onda também faz isso).",
      "Drag two handles on the waveform/spectrogram (Spectral Analysis tab) to choose the region to keep, then confirm.":
        "Arraste duas alças na forma de onda/espectrograma (aba Análise Espectral) para escolher a região a manter, depois confirme.",
      "Restore the full duration.":
        "Restaurar a duração completa.",
      "Type a duration (s) — resizes the selection from its current start.":
        "Digite uma duração (s) — redimensiona a seleção a partir do seu início atual.",
      "Save the current selection as its own .wav (original name + _1, _2, …) without confirming/applying the trim.":
        "Salvar a seleção atual como seu próprio .wav (nome original + _1, _2, …) sem confirmar/aplicar o corte.",
      "High-pass cutoff in Hz (removes content below). 0 = off.":
        "Corte passa-alta em Hz (remove o conteúdo abaixo). 0 = desativado.",
      "Low-pass cutoff in Hz (removes content above). Defaults to the Nyquist frequency.":
        "Corte passa-baixa em Hz (remove o conteúdo acima). Padrão é a frequência de Nyquist.",
      "Remove the bandpass filter.":
        "Remover o filtro passa-banda.",
      "Percentage to lower every frequency by. 50% halves them; 0 and 100 are not valid.":
        "Porcentagem para reduzir cada frequência. 50% as reduz pela metade; 0 e 100 não são válidos.",
      "Remove the frequency drop.":
        "Remover a redução de frequência.",
      "Only rates below the current sample rate are offered — this reduces resolution, it never increases it.":
        "Somente taxas abaixo da taxa de amostragem atual são oferecidas — isso reduz a resolução, nunca a aumenta.",
      "Restore the original sample rate.":
        "Restaurar a taxa de amostragem original.",
      "Nothing to undo.":
        "Nada para desfazer.",
      "Save the current (edited) audio as a new entry in the Loaded Audio panel, without touching the original file.":
        "Salvar o áudio atual (editado) como uma nova entrada no painel Áudio Carregado, sem alterar o arquivo original.",
      "High-pass cutoff in Hz. 0 = off.":
        "Corte passa-alta em Hz. 0 = desativado.",
      "Low-pass cutoff in Hz. 0 = Nyquist (off).":
        "Corte passa-baixa em Hz. 0 = Nyquist (desativado).",
      "Target envelope peak level in dBFS (0 = full scale).":
        "Nível alvo do pico de envoltória em dBFS (0 = escala completa).",
      "Scale every frequency down by this percentage, keeping each recording's duration unchanged.":
        "Reduzir cada frequência nesta porcentagem, mantendo inalterada a duração de cada gravação.",
      "Rates are offered below the highest-rate checked recording. A checked recording already at or below the chosen rate is left untouched. An anti-aliasing filter runs before each one is decimated.":
        "São oferecidas taxas abaixo da gravação marcada com a taxa mais alta. Uma gravação marcada já na taxa escolhida ou abaixo dela é deixada intacta. Um filtro anti-aliasing é aplicado antes de decimar cada uma.",
      "Drag to resize":
        "Arraste para redimensionar",
      "Drag to resize bottom panel":
        "Arraste para redimensionar o painel inferior",
      "Jump to the previous selection edge (trim handles, or annotation bounds)":
        "Ir para a borda de seleção anterior (alças de corte, ou limites de anotação)",
      "Jump to the next selection edge (trim handles, or annotation bounds)":
        "Ir para a próxima borda de seleção (alças de corte, ou limites de anotação)",
      "Playback speed as a percentage of real time, from 1 to 400. Slowing down also lowers the pitch, which brings ultrasonic song into hearing range: 1% plays a 120 kHz carrier at about 1.2 kHz. Note that it stretches the recording by the same factor, so 1% takes 100x as long to play. To lower the pitch WITHOUT stretching time, use Freq drop instead.":
        "Velocidade de reprodução como porcentagem do tempo real, de 1 a 400. Diminuir a velocidade também abaixa o tom, o que traz o canto ultrassônico para a faixa audível: 1% reproduz uma portadora de 120 kHz a cerca de 1,2 kHz. Note que isso estica a gravação pelo mesmo fator, então 1% leva 100x mais tempo para tocar. Para abaixar o tom SEM esticar o tempo, use Reduzir frequência.",
      "Lower every frequency by this percentage for LISTENING only — the stored audio, measurements, exports and plots are untouched. Unlike Speed, this keeps the tempo: 0 = off.":
        "Reduz cada frequência nesta porcentagem apenas para ESCUTA — o áudio armazenado, as medições, as exportações e os gráficos permanecem inalterados. Ao contrário de Velocidade, isso mantém o andamento: 0 = desativado.",
      "Select/Seek (S)":
        "Selecionar/Buscar (S)",
      "Draw annotation (A)":
        "Desenhar anotação (A)",
      "Pan/scroll (H)":
        "Deslocar (H)",
      "Ignore the vertical drag: annotations cover the whole frequency axis, so you only aim at the time axis.":
        "Ignorar o arraste vertical: as anotações cobrem todo o eixo de frequência, então você mira apenas no eixo do tempo.",
      "Nothing to undo (Ctrl+Z)":
        "Nada para desfazer (Ctrl+Z)",
      "Export Selection table":
        "Exportar tabela de seleções",
      "Clear all selections, detections, and measurements from the spectrogram":
        "Limpar todas as seleções, detecções e medições do espectrograma",
      "Import selections from a Raven selection table (.txt/.csv).":
        "Importar seleções de uma tabela de seleção Raven (.txt/.csv).",
      "Import the Pulse or Motif table from a Temporal Analysis Excel export as selections.":
        "Importar a tabela de Pulsos ou Motivos de uma exportação Excel de Análise Temporal como seleções.",
      "Frequency resolution used to MEASURE spectral features in the table below. Independent of the display FFT, so you can use a small display FFT for temporal detail while still measuring frequency precisely. The FFT is auto-sized (next power of 2) to reach at least this resolution.":
        "Resolução de frequência usada para MEDIR os recursos espectrais na tabela abaixo. Independente da FFT de exibição, então você pode usar uma FFT de exibição pequena para detalhe temporal e ainda medir a frequência com precisão. A FFT é dimensionada automaticamente (próxima potência de 2) para alcançar pelo menos essa resolução.",
      "Clear the measurements table":
        "Limpar a tabela de medições",
      "Compute spectral metrics for selections or detections and prepare Excel output.":
        "Calcular métricas espectrais para seleções ou detecções e preparar a saída em Excel.",
      "Save the most recently computed spectral metrics as an Excel workbook.":
        "Salvar as métricas espectrais calculadas mais recentemente como uma pasta de trabalho do Excel.",
      "Save a plain-language narrative summary of the computed spectral metrics as a DOCX file.":
        "Salvar um resumo narrativo em linguagem simples das métricas espectrais calculadas como um arquivo DOCX.",
      "Show a plain-language explanation of every column in the measurements table.":
        "Mostrar uma explicação em linguagem simples de cada coluna da tabela de medições.",
      "Optional lower floor: weak envelope peaks above this value are kept ONLY when they sit within one Max-envelope peak-gap of an accepted (strong) envelope peak. Catches the quiet onset/offset envelope peaks of a pulse without picking up isolated inter-pulse noise. Leave blank to disable.":
        "Piso inferior opcional: picos de envoltória fracos acima deste valor são mantidos SOMENTE quando estão dentro de um Intervalo máx. entre picos de um pico de envoltória aceito (forte). Captura os picos de envoltória fracos de início/fim de um pulso sem captar ruído isolado entre pulsos. Deixe em branco para desativar.",
      "After detection, removes near-baseline 'envelope peaks' that pass the prominence check on their own tiny local dip but aren't real signal. A envelope peak is dropped only if it BOTH sits within this much of the recording's floor AND is more than this much below the real envelope peaks on either side — so a low bump between two pulses goes, while the quiet onset/offset envelope peaks of a real pulse stay. Runs of several bumps at the same low level are judged as one unit against the taller envelope peaks flanking the whole run. Leave blank to disable.":
        "Após a detecção, remove \"picos de envoltória\" próximos da linha de base que passam na verificação de proeminência por sua própria pequena depressão local, mas não são sinal real. Um pico de envoltória é descartado somente se estiver DENTRO desta distância do piso da gravação E mais que esta distância abaixo dos picos de envoltória reais em ambos os lados — assim uma elevação baixa entre dois pulsos é removida, enquanto os picos de envoltória fracos de início/fim de um pulso real permanecem. Séries de vários solavancos no mesmo nível baixo são julgadas como uma única unidade em relação aos picos de envoltória mais altos que flanqueiam toda a série. Deixe em branco para desativar.",
      "Expand every pulse (and therefore every motif/sequence) by this many milliseconds on EACH side, to capture the true acoustic onset/offset that precedes/follows each envelope peak's amplitude maximum. Pulse rate and other envelope peak-timing metrics are unaffected.":
        "Expande cada pulso (e, portanto, cada motivo/sequência) nesta quantidade de milissegundos em CADA lado, para capturar o verdadeiro início/fim acústico que precede/segue o máximo de amplitude de cada pico de envoltória. A taxa de pulsos e outras métricas de temporização de picos de envoltória não são afetadas.",
      "For species whose pulses run back to back, where the silence between pulses is no longer than the spacing between envelope peaks inside one, so Max envelope peak gap cannot separate them. Splits at the valley between two amplitude arches instead. Runs AFTER the gap rule and only subdivides what it produced — it never merges pulses the gap rule separated.":
        "Para espécies cujos pulsos se sucedem sem pausa, onde o silêncio entre pulsos não é maior que o espaçamento entre picos de envoltória dentro de um, de modo que o Intervalo máx. entre picos não consegue separá-los. Em vez disso, divide no vale entre dois arcos de amplitude. É executado DEPOIS da regra de intervalo e apenas subdivide o que ela produziu — nunca funde pulsos que a regra de intervalo separou.",
      "How far a valley must fall below the crests on either side, as a percentage of those crests. Relative, so quiet and loud pulses are judged alike. Lower = more splits.":
        "O quanto um vale deve cair abaixo das cristas em ambos os lados, como porcentagem dessas cristas. Relativo, para que pulsos fracos e fortes sejam julgados da mesma forma. Menor = mais divisões.",
      "Refuses any arch cut that would leave a pulse shorter than this — shallow amplitude modulation inside one pulse can look like a valley. Leave blank to derive it from the recording: half the median duration of the pulses the unmistakable valleys produce.":
        "Recusa qualquer corte de arco que deixaria um pulso mais curto que isso — uma modulação de amplitude leve dentro de um pulso pode parecer um vale. Deixe em branco para derivá-lo da gravação: metade da duração mediana dos pulsos que os vales inequívocos produzem.",
      "Target frequency resolution for TOOTH spectra, in Hz. Resolution is 1/window, so 1500 Hz means a 0.67 ms window — but stating it in Hz keeps it identical across recordings with different sample rates, which a duration in milliseconds does not. The signal is still capped at half the distance to the neighbouring peak, so where pulses are tighter than this asks for, the row reports the coarser resolution it actually achieved in spec_res_hz. Keep this constant across a study.":
        "Resolução de frequência alvo para os espectros de DENTE, em Hz. A resolução é 1/janela, então 1500 Hz significa uma janela de 0,67 ms — mas expressá-la em Hz a mantém idêntica entre gravações com taxas de amostragem diferentes, o que uma duração em milissegundos não faz. O sinal ainda é limitado a metade da distância até o pico vizinho, então onde os pulsos estão mais próximos do que isso exige, a linha reporta a resolução mais grosseira realmente alcançada em spec_res_hz. Mantenha isso constante ao longo de um estudo.",
      "Target frequency resolution for PULSE spectra, in Hz. 50 Hz means a 20 ms window. A pulse longer than that is Welch-averaged over overlapping frames at this resolution; a shorter pulse reports the coarser resolution it could actually achieve. The motif columns ending in _tmean are the average of these pulse rows. Keep it constant across a study.":
        "Resolução de frequência alvo para os espectros de PULSO, em Hz. 50 Hz significa uma janela de 20 ms. Um pulso mais longo que isso é promediado pelo método de Welch em quadros sobrepostos nesta resolução; um pulso mais curto reporta a resolução mais grosseira que conseguiu realmente alcançar. As colunas de motivo que terminam em _tmean são a média dessas linhas de pulso. Mantenha isso constante ao longo de um estudo.",
      "Target frequency resolution for MOTIF spectra, in Hz. 10 Hz means a 100 ms window, long enough to resolve structure the pulse window cannot. This measures the whole motif span, so its frames also cross the silence between pulses — on a low duty cycle that raises spec_entropy and spec_flatness. The motif row also carries _tmean columns, the average of its pulse rows, which contain no silence; compare the two. Keep this constant across a study.":
        "Resolução de frequência alvo para os espectros de MOTIVO, em Hz. 10 Hz significa uma janela de 100 ms, longa o suficiente para resolver estrutura que a janela de pulso não consegue. Isso mede todo o intervalo do motivo, então seus quadros também cruzam o silêncio entre pulsos — em um ciclo de trabalho baixo isso eleva spec_entropy e spec_flatness. A linha de motivo também carrega colunas _tmean, a média de suas linhas de pulso, que não contêm silêncio; compare as duas. Mantenha isso constante ao longo de um estudo.",
      "Saved Temporal Analysis parameter sets (stored on this machine).":
        "Conjuntos de parâmetros de Análise Temporal salvos (armazenados nesta máquina).",
      "Save the current parameters into the selected slot.":
        "Salvar os parâmetros atuais no slot selecionado.",
      "Load the selected preset's parameters.":
        "Carregar os parâmetros da predefinição selecionada.",
      "Delete the selected preset slot.":
        "Excluir o slot de predefinição selecionado.",
      "Save the current parameters to a .json file. Opens a file browser so you can choose the folder and edit the name. Unlike the 10 slots, a file can be copied to another computer or kept beside the recordings it belongs to.":
        "Salvar os parâmetros atuais em um arquivo .json. Abre um explorador de arquivos para você escolher a pasta e editar o nome. Ao contrário dos 10 slots, um arquivo pode ser copiado para outro computador ou mantido junto às gravações a que pertence.",
      "Load parameters from a .json preset file. The values go into the panels; use Save afterwards to also keep them in a slot.":
        "Carregar parâmetros de um arquivo .json de predefinição. Os valores vão para os painéis; use Salvar depois para também mantê-los em um slot.",
      "Convert detected units into Spectral Analysis selections.":
        "Converter as unidades detectadas em seleções de Análise Espectral.",
      "Choose whether detected units become pulse or motif selections.":
        "Escolher se as unidades detectadas se tornam seleções de pulso ou de motivo.",
      "Load a Envelope peaks table from a Temporal Analysis Excel export, restoring the envelope peaks and the pulse boundaries exactly as they were saved, including any you edited by hand. Needs the matching audio loaded. Does not re-run detection.":
        "Carregar uma tabela de Picos de envoltória de uma exportação Excel de Análise Temporal, restaurando os picos de envoltória e os limites de pulso exatamente como foram salvos, incluindo quaisquer edições manuais. Requer que o áudio correspondente esteja carregado. Não executa a detecção novamente.",
      "Correct a few pulses by hand, select their envelope peaks (shift-drag), then press this. Searches the pulse-grouping parameters for the combination that best reproduces the boundaries you set. Envelope peak DETECTION is only fitted if you tick the box below. Nothing changes until you press Apply.":
        "Corrija alguns pulsos manualmente, selecione seus picos de envoltória (shift-arrastar), depois pressione isto. Busca nos parâmetros de agrupamento de pulsos a combinação que melhor reproduz os limites que você definiu. A DETECÇÃO de picos de envoltória só é ajustada se você marcar a caixa abaixo. Nada muda até você pressionar Aplicar.",
      "Also fit the envelope peak-detection parameters (envelope peak window, envelope peak/detection/onset thresholds, false envelope peak delta) to the envelope peaks you kept, added and deleted by hand. Smoothing is never fitted. Slower, and Apply then re-runs detection over the whole recording, which replaces manual envelope peak edits as well as boundary edits.":
        "Também ajusta os parâmetros de detecção de picos de envoltória (janela de pico, limiares de pico/detecção/início, delta de falso pico de envoltória) aos picos de envoltória que você manteve, adicionou e excluiu manualmente. A suavização nunca é ajustada. Mais lento, e Aplicar então executa a detecção novamente em toda a gravação, o que substitui tanto as edições manuais de picos de envoltória quanto as de limites.",
      "Write the fitted parameters into the panels and re-apply them over the whole recording. This replaces manual boundary edits, including the ones just pulseed on.":
        "Grava os parâmetros ajustados nos painéis e os reaplica em toda a gravação. Isso substitui as edições manuais de limites, incluindo as que acabaram de ser usadas no ajuste.",
      "Left-click a marker to select it.":
        "Clique esquerdo em um marcador para selecioná-lo.",
      "Click anywhere on the plot to add a envelope peak, snapped to the envelope at that time.":
        "Clique em qualquer lugar do gráfico para adicionar um pico de envoltória, ajustado à envoltória naquele instante.",
      "Re-run the detected segmentation, discarding manual boundary edits (added/removed envelope peaks are kept).":
        "Executa novamente a segmentação detectada, descartando as edições manuais de limites (os picos de envoltória adicionados/removidos são mantidos).",
      "Re-apply the False envelope peak Δ filter to the current envelope peaks (e.g. after manually adding one, or after changing the Δ value).":
        "Reaplica o filtro Δ de falso pico de envoltória aos picos de envoltória atuais (por ex., após adicionar um manualmente, ou após alterar o valor de Δ).",
      "Assign the selected envelope peak(s) to the left pulse.":
        "Atribuir o(s) pico(s) de envoltória selecionado(s) ao pulso à esquerda.",
      "Assign the selected envelope peak(s) to the right pulse.":
        "Atribuir o(s) pico(s) de envoltória selecionado(s) ao pulso à direita.",
      "Merge the left gap for the selected envelope peak.":
        "Mesclar o intervalo à esquerda do pico de envoltória selecionado.",
      "Merge the right gap for the selected envelope peak.":
        "Mesclar o intervalo à direita do pico de envoltória selecionado.",
      "Split the left gap for the selected envelope peak.":
        "Dividir o intervalo à esquerda do pico de envoltória selecionado.",
      "Split the right gap for the selected envelope peak.":
        "Dividir o intervalo à direita do pico de envoltória selecionado.",
      "Make the selected envelope peaks into a single pulse.":
        "Transformar os picos de envoltória selecionados em um único pulso.",
      "Join internal gaps within the selected envelope peaks.":
        "Unir os intervalos internos entre os picos de envoltória selecionados.",
      "Remove the selected envelope peak(s).":
        "Remover o(s) pico(s) de envoltória selecionado(s).",
      "Clear the current envelope peak selection.":
        "Limpar a seleção atual de picos de envoltória.",
      "Magnify amplitude — reveals faint envelope peaks (clips tall ones at the top).":
        "Ampliar a amplitude — revela picos de envoltória fracos (corta os altos no topo).",
      "Show a small synced spectrogram below the envelope to tell real envelope peak impacts from noise.":
        "Mostrar um pequeno espectrograma sincronizado abaixo da envoltória para distinguir os impactos reais de picos de envoltória do ruído.",
      "Overview — click or drag to navigate; drag the highlighted window to pan.":
        "Visão geral — clique ou arraste para navegar; arraste a janela destacada para deslocar.",
      "Export all tables (Envelope peaks, Pulses, Motifs, MotifSeqs, Summary) into one Excel workbook — one sheet each.":
        "Exportar todas as tabelas (Picos de envoltória, Pulsos, Motivos, SeqMotivos, Resumo) em uma única pasta de trabalho do Excel — uma planilha cada.",
      "Auto-coded Oscillogram — an oscillogram whose colour marks the frequency bands present above a threshold. After Brizio (2023), Colour Enhanced Time/Pressure Envelope":
        "Oscilograma Autocodificado — um oscilograma cuja cor marca as bandas de frequência presentes acima de um limiar. Segundo Brizio (2023), Colour Enhanced Time/Pressure Envelope",
      "Clear preset":
        "Limpar predefinição",
      "Write the current plot settings to a .json file you can keep beside your recordings or share.":
        "Gravar as configurações atuais do gráfico em um arquivo .json que você pode manter junto às suas gravações ou compartilhar.",
      "Load plot settings from a .json preset file into the toolbar.":
        "Carregar configurações do gráfico de um arquivo .json de predefinição na barra de ferramentas.",
      "Shared scale for the Power Spectrum curve and the spectrogram's colour mapping. dB compresses the range so quieter shoulders stay visible; Linear puts everything relative to the peak, so the dominant band reads as a sharp spike and the rest fades fast.":
        "Escala compartilhada para a curva do Espectro de Potência e o mapeamento de cores do espectrograma. dB comprime o intervalo para que os ombros mais fracos permaneçam visíveis; Linear coloca tudo relativo ao pico, então a banda dominante aparece como um pico nítido e o resto desaparece rápido.",
      "Use current analyzer view":
        "Usar a visualização atual do analisador",
      "Use current freq view":
        "Usar a visualização de frequência atual",
      "The species this selection is of. Typed once, then offered from the list.":
        "A espécie a que esta seleção pertence. Digitada uma vez, depois oferecida na lista.",
      "Wind and handling noise routinely exceed an insect call in absolute level. Set this above the rumble or it will capture the envelope peak and drag the band down to DC.":
        "O ruído de vento e manuseio costuma superar o nível absoluto do canto de um inseto. Ajuste isso acima do ronco, ou ele capturará o pico de envoltória e arrastará a banda até DC.",
      "Band edges this many dB below the spectrum's peak. 20 dB is the usual bioacoustics convention.":
        "Bordas de banda a esta quantidade de dB abaixo do pico do espectro. 20 dB é a convenção habitual em bioacústica.",
      "outer — outermost crossings, harmonics included (and any neighbour calling in the same window). around peak — the one lobe around the carrier.":
        "externo — cruzamentos mais externos, harmônicos incluídos (e qualquer vizinho cantando na mesma janela). ao redor do pico — apenas o lóbulo ao redor da portadora.",
      "Re-derive the band from the threshold whenever the selection changes.":
        "Rededuzir a banda a partir do limiar sempre que a seleção mudar.",
      "Freeze the band across every later selection and every later recording. What makes 'auto' safe to leave on.":
        "Congela a banda para todas as seleções e gravações posteriores. O que torna seguro deixar \"auto\" ativado.",
      "Power-spectrum window. Deliberately not the finest available: fine structure from one individual or one microphone does not generalise, and the band should describe the species.":
        "Janela do espectro de potência. Deliberadamente não a mais fina disponível: a estrutura fina de um indivíduo ou microfone não generaliza, e a banda deve descrever a espécie.",
      "Display only — neither scale changes a number that gets saved. Linear makes the carrier read as a spike; dB makes the shoulders visible.":
        "Somente exibição — nenhuma escala altera um número que é salvo. Linear faz a portadora aparecer como um pico; dB torna os ombros visíveis.",
      "Spectrogram dynamic range, in dB below the loudest bin in view.":
        "Faixa dinâmica do espectrograma, em dB abaixo do bin mais forte na visualização.",
      "Drag to set the time span. Shift+drag to pan. Wheel to zoom. Click to clear.":
        "Arraste para definir o intervalo de tempo. Shift+arraste para deslocar. Roda para dar zoom. Clique para limpar.",
      "Display only. Click a box to select it and adopt its label and band. Wheel to zoom time, Ctrl+wheel to zoom frequency.":
        "Somente exibição. Clique em uma caixa para selecioná-la e adotar seu rótulo e banda. Roda para dar zoom no tempo, Ctrl+roda para dar zoom na frequência.",
      "Power spectrum of the marked span. Drag horizontally to set the band by hand.":
        "Espectro de potência do trecho marcado. Arraste horizontalmente para definir a banda manualmente.",
      "Commit the pending box (Enter / A)":
        "Confirmar a caixa pendente (Enter / A)",
      "Undo (Ctrl+Z)":
        "Desfazer (Ctrl+Z)",
      "Drop the time span, keep the band (Esc)":
        "Descartar o intervalo de tempo, manter a banda (Esc)",
      "Delete the selected box (Del)":
        "Excluir a caixa selecionada (Del)",
      "Write <species>.band.json. Refused for a band derived from the whole view — in a recording holding two species that is neither species' band.":
        "Grava <espécie>.band.json. Recusado para uma banda derivada de toda a visualização — em uma gravação com duas espécies essa não é a banda de nenhuma delas.",
      "Adopt a saved band: same edges, locked.":
        "Adotar uma banda salva: mesmas bordas, travada.",
      "What to do when the pieces disagree. Resampling low-passes before any downsample, so it cannot alias.":
        "O que fazer quando as partes não coincidem. A reamostragem aplica passa-baixa antes de qualquer redução de taxa, então não pode gerar aliasing.",
      "Silence inserted between pieces, never before the first or after the last. 0 reproduces merge_waves() exactly.":
        "Silêncio inserido entre as partes, nunca antes da primeira nem depois da última. 0 reproduz merge_waves() exatamente.",
      "Subtract the mean of the whole merged signal, as tuneR's normalize(center = TRUE) does.":
        "Subtrair a média de todo o sinal mesclado, como normalize(center = TRUE) do tuneR faz.",
      "Envelope peak-normalize the merged signal. NOTE: this destroys the relative levels between the source recordings.":
        "Normalizar por pico de envoltória o sinal mesclado. NOTA: isso destrói os níveis relativos entre as gravações de origem.",
      "Write the merged audio as a 16-bit mono WAV.":
        "Gravar o áudio mesclado como um WAV mono de 16 bits.",
      "Write where each source recording landed, as a Raven selection table.":
        "Gravar onde cada gravação de origem ficou, como uma tabela de seleção Raven.",
      "Extra audio shown on each side of a brushed selection, as a % of the selection's own width, so the zoomed panel isn't a context-free sliver. The selection itself stays centered.":
        "Áudio extra mostrado em cada lado de uma seleção marcada, como % da largura da própria seleção, para que o painel ampliado não seja uma faixa sem contexto. A própria seleção permanece centralizada.",
      "Length of the scale bar on the selected panel(s). Each panel keeps its own length, since zoom panels span very different durations. Leave a panel on Auto for a bar about 20% of that panel's width.":
        "Comprimento da barra de escala no(s) painel(is) selecionado(s). Cada painel mantém seu próprio comprimento, já que os painéis de zoom abrangem durações muito diferentes. Deixe um painel em Auto para uma barra de cerca de 20% da largura desse painel.",
      "Apply this length to the selected scale bar(s).":
        "Aplicar este comprimento à(s) barra(s) de escala selecionada(s).",
      "Return the selected scale bar(s) to the automatic length.":
        "Retornar a(s) barra(s) de escala selecionada(s) ao comprimento automático.",
      "Apply to every panel instead of only the selected scale bars.":
        "Aplicar a todos os painéis em vez de apenas às barras de escala selecionadas.",
      "Write the current Osc. Zoom settings to a .json file you can reuse or share.":
        "Gravar as configurações atuais de Zoom de Oscilograma em um arquivo .json que você pode reutilizar ou compartilhar.",
      "Load Osc. Zoom settings from a .json preset file.":
        "Carregar configurações de Zoom de Oscilograma de um arquivo .json de predefinição.",
      "FFT size sets the frequency resolution and, inversely, the time resolution of the whole rendering: t = nfft / fs.":
        "O tamanho da FFT define a resolução de frequência e, inversamente, a resolução temporal de toda a renderização: t = nfft / fs.",
      "Higher overlap gives more drawn columns per second — finer colour placement in time at the same frequency resolution.":
        "Uma sobreposição maior dá mais colunas desenhadas por segundo — um posicionamento de cor mais fino no tempo na mesma resolução de frequência.",
      "2-colour marks one frequency range in a single contrasting colour. Multicolour splits the range into uniform bands, each mapped to one bit of the 24-bit RGB triplet.":
        "2 cores marca um intervalo de frequência em uma única cor contrastante. Multicor divide o intervalo em bandas uniformes, cada uma mapeada para um bit do trio RGB de 24 bits.",
      "Frequency Range Bottom":
        "Limite inferior do intervalo de frequência",
      "Frequency Range Top":
        "Limite superior do intervalo de frequência",
      "Frequency Range Pressure Threshold. A band counts as present when its strongest bin reaches this level. Changing it recolours instantly — no re-analysis.":
        "Limiar de pressão do intervalo de frequência. Uma banda é considerada presente quando seu bin mais forte atinge este nível. Alterá-lo recolore instantaneamente — sem reanalisar.",
      "Restrict colour to columns whose OVERALL level falls in a range — a way to exclude the loudest or the feeblest parts of the recording.":
        "Restringir a cor às colunas cujo nível GERAL cai dentro de um intervalo — uma forma de excluir as partes mais fortes ou mais fracas da gravação.",
      "Overall Pressure Range Bottom":
        "Limite inferior do intervalo de pressão geral",
      "Overall Pressure Range Top":
        "Limite superior do intervalo de pressão geral",
      "Applies to the reference oscillogram only. The Auto-coded Oscillogram's own columns are always drawn exactly one column wide, so a thicker stroke can never smear one column's colour over its neighbours.":
        "Aplica-se apenas ao oscilograma de referência. As próprias colunas do Oscilograma Autocodificado são sempre desenhadas com exatamente uma coluna de largura, então um traço mais grosso nunca pode borrar a cor de uma coluna sobre as vizinhas.",
      "Colour of every column that does NOT reach the threshold.":
        "Cor de cada coluna que NÃO atinge o limiar.",
      "2-colour rendering only — multicolour takes its colours from the band mapping.":
        "Somente para a renderização de 2 cores — o multicor obtém suas cores do mapeamento de bandas.",
      "Top of the displayed frequency axis. 0 = up to Nyquist.":
        "Topo do eixo de frequência exibido. 0 = até Nyquist.",
      "Write the current Auto-coded Oscillogram settings to a .json file you can reuse or share.":
        "Gravar as configurações atuais do Oscilograma Autocodificado em um arquivo .json que você pode reutilizar ou compartilhar.",
      "Load Auto-coded Oscillogram settings from a .json preset file.":
        "Carregar configurações do Oscilograma Autocodificado de um arquivo .json de predefinição.",
      "PNG scale factor":
        "Fator de escala do PNG",
      "Export the contiguous coloured stretches as a CSV of time intervals with the bands that lit them.":
        "Exportar os trechos coloridos contíguos como um CSV de intervalos de tempo com as bandas que os acionaram.",
      "The publication this module implements":
        "A publicação que este módulo implementa",
      "Play or pause the visible range (Space)":
        "Reproduzir ou pausar o intervalo visível (Espaço)",
      "Stop and return the playhead to the start of the view":
        "Parar e retornar o cursor de reprodução ao início da visualização",
      "Playback speed as a percentage of real time, from 1 to 400 — the same scale as the main transport. Slowing down also lowers the pitch, which brings ultrasonic song into hearing range: 6% plays a 42 kHz song at about 2.6 kHz, and 1% reaches a 120 kHz carrier. It stretches the recording by the same factor, so 1% takes 100x as long to play.":
        "Velocidade de reprodução como porcentagem do tempo real, de 1 a 400 — a mesma escala do transporte principal. Diminuir a velocidade também abaixa o tom, o que traz o canto ultrassônico para a faixa audível: 6% reproduz um canto de 42 kHz a cerca de 2,6 kHz, e 1% alcança uma portadora de 120 kHz. Estica a gravação pelo mesmo fator, então 1% leva 100x mais tempo para tocar.",
      "Lights while the playhead is over a highlighted column — a band above the FRPT is sounding.":
        "Acende enquanto o cursor de reprodução está sobre uma coluna destacada — uma banda acima do FRPT está soando.",
      "Zoom in on the centre of the view":
        "Aproximar o centro da visualização",
      "Zoom out":
        "Afastar",
      "Show the whole recording (Home, or double-click the figure)":
        "Mostrar a gravação inteira (Home, ou clique duplo na figura)",
      "Spacing between frequency axis ticks/labels. 0 = automatic (6 ticks).":
        "Espaçamento entre as marcas/rótulos do eixo de frequência. 0 = automático (6 marcas).",
      "Express every measurement at this temperature, using a least-squares fit of each metric against the temperatures actually recorded. Adds a corrected mean/SD beside every observed one in the table, a bracketed figure in the report, and the Temp_Regression sheets to the workbook.":
        "Expressa cada medição a esta temperatura, usando um ajuste de mínimos quadrados de cada métrica em relação às temperaturas realmente registradas.\n\nAdiciona uma média/DP corrigida ao lado de cada uma observada na tabela, um valor entre colchetes no relatório, e as planilhas Temp_Regression à pasta de trabalho.",
      "How the min-max range is wrapped in the LaTeX and Word convenience columns of the saved workbook, e.g. 12.00±1.50 (9.80–14.20) versus 12.00±1.50 [9.80–14.20]. The columns are Excel formulas, so this is baked in when the workbook is written — change it and save again to switch.":
        "Como o intervalo mín-máx é envolvido nas colunas de conveniência de LaTeX e Word da pasta de trabalho salva, por ex. 12.00±1.50 (9.80–14.20) versus 12.00±1.50 [9.80–14.20].\n\nAs colunas são fórmulas do Excel, então isso fica fixado quando a pasta de trabalho é gravada — altere e salve novamente para mudar.",
      "Save the figure as SVG — vector, so it stays sharp at any size and can be edited in Illustrator or Inkscape. This is the format most journals ask for.":
        "Salvar a figura como SVG — vetorial, então permanece nítida em qualquer tamanho e pode ser editada no Illustrator ou Inkscape. Este é o formato que a maioria dos periódicos pede.",
      "Save the figure as a 300 dpi PNG, rasterized from the same drawing — for journals that will not take vector art.":
        "Salvar a figura como PNG de 300 dpi, rasterizado a partir do mesmo desenho — para periódicos que não aceitam arte vetorial.",
      "Check every loaded recording":
        "Marcar todas as gravações carregadas",
      "Uncheck every loaded recording":
        "Desmarcar todas as gravações carregadas",
      "Grid size settings":
        "Configurações de tamanho da grade",
      "Add to the Loaded Audio panel AND write a .wav file to disk.":
        "Adicionar ao painel Áudio Carregado E gravar um arquivo .wav no disco.",
      "Add to the Loaded Audio panel only — nothing written to disk.":
        "Adicionar apenas ao painel Áudio Carregado — nada é gravado no disco.",
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
      // Captured once, from whatever the page shows the FIRST time this
      // node is ever seen (always English, since that's what's authored
      // in the HTML) — the permanent source of truth this rebuilds from
      // on every later call. Rebuilding from the node's CURRENT value
      // instead (e.g. via raw.replace(englishText, translated)) is what
      // the previous version did, and it broke after the first switch:
      // once the text reads "Preprocesamiento", the English substring
      // "Preprocessing" is no longer IN it to find, so the replace
      // silently no-ops and the node sticks at whatever it was last
      // translated to, forever.
      if (node._i18nSrc === undefined) {
        const raw = node.nodeValue;
        const trimmed = raw.trim();
        if (!trimmed) {
          node._i18nSrc = null; // whitespace-only — nothing to translate, ever
          return;
        }
        const start = raw.indexOf(trimmed);
        node._i18nSrc = trimmed;
        node._i18nPre = raw.slice(0, start);
        node._i18nPost = raw.slice(start + trimmed.length);
      }
      if (node._i18nSrc === null) return;
      const src = node._i18nSrc;
      const dict = I18N[lang];
      const translated =
        lang === "en" ? src : (dict && dict[normKey(src)]) || src;
      node.nodeValue = node._i18nPre + translated + node._i18nPost;
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
