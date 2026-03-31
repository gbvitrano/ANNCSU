  // ── CONFIGURAZIONE ──────────────────────────────────────────────────────────
  const PMTILES_URL = 'https://media.githubusercontent.com/media/anncsu-open/anncsu-viewer/main/data/anncsu-indirizzi.pmtiles';
  const MAP_CENTER  = [12.5, 42.0];
  const MAP_ZOOM    = 6;
  const COLOR_OK    = '#4c9b82';
  const COLOR_ERR   = '#E63946';
  const DENOMI_PALETTE = [
    '#3a86ff','#f72585','#06d6a0','#fb8500','#8338ec',
    '#e63946','#2a9d8f','#f4a261','#06b6d4','#ffbe0b',
    '#7209b7','#ee9b00'
  ];
  const COMUNI_PMTILES_URL = 'https://gbvitrano.github.io/ANNCSU/dati/comuni.pmtiles';

  // ── PROVINCE / REGIONI (caricate da CSV) ────────────────────────────────────
  let PROV_NAMES  = {}; // { cod: name }
  let PROV_TO_REG = {}; // { cod: region }
  let ALL_REGIONS = [];
  let REG_TO_PROV = {};

  // ── STATO ───────────────────────────────────────────────────────────────────
  let selectedRegions   = new Set();
  let selectedProvinces = new Set();
  let selectedComune    = null; // {codice_istat, nome_comune} | null
  let typeFilter        = 'all';
  let allComuni         = []; // caricati da comuni.json
  let aggiudicatoriMap      = {}; // { cod_comune_num → { ente, comune, provincia, regione, importoTotale, entries[] } }
  let denominazioniColorMap = {}; // { denominazione → color }
  let selectedAggiudicatario  = null; // denominazione attualmente selezionata
  let _comuniAnalisiCtrl      = null; // istanza controllo analisi (aggiunta/rimossa dinamicamente)
  let comuniLayerVisible = false;
  let comuniLayerReady   = false;

  // ── HELPERS ─────────────────────────────────────────────────────────────────
  function getActiveProvCodes() {
    return [...selectedRegions].flatMap(r => REG_TO_PROV[r]);
  }

  // ── CARICAMENTO PROVINCE DA CSV ─────────────────────────────────────────────
  async function loadProvince() {
    const res  = await fetch('dati/province.csv');
    const text = await res.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',');
    const iCod  = headers.indexOf('cod_prov');
    const iName = headers.indexOf('den_uts');
    const iReg  = headers.indexOf('den_reg');

    lines.slice(1).forEach(line => {
      if (!line.trim()) return;
      const cols = line.split(',');
      const cod  = cols[iCod].trim().padStart(3, '0');
      const name = cols[iName].trim();
      const reg  = cols[iReg].trim();
      if (cod && name && reg) {
        PROV_NAMES[cod]  = name;
        PROV_TO_REG[cod] = reg;
      }
    });

    ALL_REGIONS = [...new Set(Object.values(PROV_TO_REG))].sort();
    ALL_REGIONS.forEach(r => { REG_TO_PROV[r] = []; });
    Object.entries(PROV_TO_REG).forEach(([p, r]) => REG_TO_PROV[r].push(p));

    selectedRegions   = new Set(ALL_REGIONS);
    selectedProvinces = new Set(Object.keys(PROV_TO_REG));

    buildRegionList();
    buildProvinceList();
  }

  // ── CARICAMENTO COMUNI ──────────────────────────────────────────────────────
  async function loadComuni() {
    try {
      const res = await fetch('https://raw.githubusercontent.com/anncsu-open/anncsu-viewer/main/data/comuni.json');
      allComuni = await res.json();
      buildComuneList();
    } catch(e) {
      console.warn('comuni.json non caricato:', e);
    }
  }

  // ── CARICAMENTO AGGIUDICATORI DA CSV ─────────────────────────────────────────
  function parseCSVLine(line) {
    const cols = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur);
    return cols;
  }

  async function loadAggiudicatori() {
    try {
      const res  = await fetch('dati/aggiudicatori.csv');
      const text = await res.text();
      const lines   = text.trim().split('\n');
      const headers = lines[0].split(',');
      const iCod    = headers.indexOf('cod_comune');
      const iEnte   = headers.indexOf('ente');
      const iComune = headers.indexOf('comune');
      const iProv   = headers.indexOf('provincia');
      const iReg    = headers.indexOf('regione');
      const iImporto = headers.indexOf('importo_finanziamento');
      const iCIG    = headers.indexOf('CIG');
      const iDen    = headers.indexOf('denominazione');
      const iRuolo  = headers.indexOf('ruolo');
      const iCF     = headers.indexOf('codice_fiscale');
      const iStato  = headers.indexOf('stato_candidatura');
      const iFin    = headers.indexOf('numero_finestra_temporale');

      lines.slice(1).forEach(line => {
        if (!line.trim()) return;
        const cols   = parseCSVLine(line);
        const codStr = cols[iCod]?.trim();
        if (!codStr) return;
        const cod = parseInt(codStr, 10);
        if (isNaN(cod)) return;
        const importo = parseFloat(cols[iImporto]) || 0;
        if (!aggiudicatoriMap[cod]) {
          aggiudicatoriMap[cod] = {
            ente:         cols[iEnte]?.trim()   || '',
            comune:       cols[iComune]?.trim() || '',
            provincia:    cols[iProv]?.trim()   || '',
            regione:      cols[iReg]?.trim()    || '',
            importoTotale: 0,
            entries:      []
          };
        }
        aggiudicatoriMap[cod].importoTotale += importo;
        aggiudicatoriMap[cod].entries.push({
          importo,
          CIG:            cols[iCIG]?.trim()    || '',
          denominazione:  cols[iDen]?.trim()    || '',
          ruolo:          cols[iRuolo]?.trim()  || '',
          codice_fiscale: cols[iCF]?.trim()     || '',
          stato:          cols[iStato]?.trim()  || '',
          finestra:       cols[iFin]?.trim()    || ''
        });
      });

      // Assegna colori alle denominazioni (in ordine di prima comparsa)
      let paletteIdx = 0;
      Object.values(aggiudicatoriMap).forEach(info => {
        info.entries.forEach(e => {
          if (e.denominazione && !denominazioniColorMap[e.denominazione]) {
            denominazioniColorMap[e.denominazione] = DENOMI_PALETTE[paletteIdx % DENOMI_PALETTE.length];
            paletteIdx++;
          }
        });
      });

      buildComuniLegend();
      if (comuniLayerReady) updateComuniColors();
    } catch(e) {
      console.warn('aggiudicatori.csv non caricato:', e);
    }
  }

  // ── REGIONI ─────────────────────────────────────────────────────────────────
  function buildRegionList(q = '') {
    const list = document.getElementById('region-list');
    list.innerHTML = '';
    ALL_REGIONS.forEach(r => {
      if (q && !r.toLowerCase().includes(q.toLowerCase())) return;
      const item = document.createElement('label');
      item.className = 'dropdown-item';
      item.innerHTML = `<input type="checkbox" value="${r}" ${selectedRegions.has(r) ? 'checked' : ''} onchange="onRegionChange(this)"> ${r}`;
      list.appendChild(item);
    });
  }

  function filterRegionList(q) { buildRegionList(q); }

  function toggleRegionDropdown() {
    document.getElementById('region-btn').classList.toggle('open');
    document.getElementById('region-panel').classList.toggle('open');
  }

  function onRegionChange(checkbox) {
    if (checkbox.checked) selectedRegions.add(checkbox.value);
    else                  selectedRegions.delete(checkbox.value);
    syncProvincesToRegions();
    selectedComune = null;
    updateRegionLabel();
    buildProvinceList();
    updateProvinceLabel();
    buildComuneList();
    updateComuneLabel();
    applyFilter();
  }

  function syncProvincesToRegions() {
    const active = new Set(getActiveProvCodes());
    // Rimuovi province non più nelle regioni selezionate
    for (const p of [...selectedProvinces]) {
      if (!active.has(p)) selectedProvinces.delete(p);
    }
    // Aggiungi province delle regioni appena selezionate
    for (const p of active) selectedProvinces.add(p);
  }

  function selectAllRegions() {
    selectedRegions   = new Set(ALL_REGIONS);
    selectedProvinces = new Set(Object.keys(PROV_TO_REG));
    selectedComune    = null;
    buildRegionList();
    buildProvinceList();
    buildComuneList();
    updateRegionLabel();
    updateProvinceLabel();
    updateComuneLabel();
    applyFilter();
  }

  function clearAllRegions() {
    selectedRegions.clear();
    selectedProvinces.clear();
    selectedComune = null;
    buildRegionList();
    buildProvinceList();
    buildComuneList();
    updateRegionLabel();
    updateProvinceLabel();
    updateComuneLabel();
    applyFilter();
  }

  function updateRegionLabel() {
    const n = selectedRegions.size, tot = ALL_REGIONS.length;
    document.getElementById('region-label').textContent =
      n === 0   ? 'Nessuna regione' :
      n === tot ? 'Tutte le regioni' :
                  `${n} region${n === 1 ? 'e' : 'i'}`;
  }

  // ── PROVINCE ────────────────────────────────────────────────────────────────
  function toggleProvinceDropdown() {
    document.getElementById('province-btn').classList.toggle('open');
    document.getElementById('province-panel').classList.toggle('open');
  }

  function buildProvinceList(q = '') {
    const list = document.getElementById('province-list');
    list.innerHTML = '';
    const codes = getActiveProvCodes()
      .sort((a, b) => (PROV_NAMES[a] || a).localeCompare(PROV_NAMES[b] || b, 'it'));
    codes.forEach(code => {
      const name = PROV_NAMES[code] || code;
      if (q && !name.toLowerCase().includes(q.toLowerCase())) return;
      const item = document.createElement('label');
      item.className = 'dropdown-item';
      item.innerHTML = `<input type="checkbox" value="${code}" ${selectedProvinces.has(code) ? 'checked' : ''} onchange="onProvinceChange(this)"> ${name}`;
      list.appendChild(item);
    });
  }

  function onProvinceChange(checkbox) {
    if (checkbox.checked) selectedProvinces.add(checkbox.value);
    else                  selectedProvinces.delete(checkbox.value);
    selectedComune = null;
    updateProvinceLabel();
    buildComuneList();
    updateComuneLabel();
    applyFilter();
  }

  function selectAllProvinces() {
    getActiveProvCodes().forEach(c => selectedProvinces.add(c));
    selectedComune = null;
    buildProvinceList(document.getElementById('province-search').value);
    updateProvinceLabel();
    buildComuneList();
    updateComuneLabel();
    applyFilter();
  }

  function clearAllProvinces() {
    selectedProvinces.clear();
    selectedComune = null;
    buildProvinceList(document.getElementById('province-search').value);
    updateProvinceLabel();
    buildComuneList();
    updateComuneLabel();
    applyFilter();
  }

  function updateProvinceLabel() {
    const active = getActiveProvCodes();
    const n = active.filter(c => selectedProvinces.has(c)).length;
    const tot = active.length;
    document.getElementById('province-label').textContent =
      n === 0   ? 'Nessuna provincia' :
      n === tot ? 'Tutte le province' :
                  `${n} provinc${n === 1 ? 'ia' : 'e'}`;
  }

  // ── COMUNI ──────────────────────────────────────────────────────────────────
  function toggleComuneDropdown() {
    const btn   = document.getElementById('comune-btn');
    const panel = document.getElementById('comune-panel');
    btn.classList.toggle('open');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      const search = document.getElementById('comune-search');
      search.value = '';
      search.focus();
      buildComuneList();
    }
  }

  function buildComuneList(q = '') {
    const list = document.getElementById('comune-list');
    list.innerHTML = '';
    const activeProv = getActiveProvCodes().filter(c => selectedProvinces.has(c));
    const comuni = allComuni
      .filter(c => activeProv.includes(c.codice_istat.slice(0, 3)))
      .filter(c => !q || c.nome_comune.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => a.nome_comune.localeCompare(b.nome_comune, 'it'));

    if (comuni.length === 0) {
      list.innerHTML = '<div style="padding:8px 12px;color:var(--text-faint);font-size:0.75rem">Nessun comune trovato</div>';
      return;
    }
    comuni.forEach(c => {
      const item = document.createElement('div');
      item.className = 'dropdown-item' + (selectedComune?.codice_istat === c.codice_istat ? ' active' : '');
      item.textContent = c.nome_comune;
      item.onclick = () => {
        selectedComune = selectedComune?.codice_istat === c.codice_istat ? null : c;
        updateComuneLabel();
        applyFilter();
        document.getElementById('comune-btn').classList.remove('open');
        document.getElementById('comune-panel').classList.remove('open');
      };
      list.appendChild(item);
    });
  }

  function clearComune() {
    selectedComune = null;
    updateComuneLabel();
    buildComuneList();
    applyFilter();
    document.getElementById('comune-btn').classList.remove('open');
    document.getElementById('comune-panel').classList.remove('open');
  }

  function updateComuneLabel() {
    document.getElementById('comune-label').textContent =
      selectedComune ? selectedComune.nome_comune : 'Tutti i comuni';
  }

  // ── SWITCH TEMA ──────────────────────────────────────────────────────────────
  let pendingTheme = null;

  function toggleTheme(isDark) {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.getElementById('th-light').classList.toggle('active', !isDark);
    document.getElementById('th-dark').classList.toggle('active', isDark);
    const tiles = isDark
      ? ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
         'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
         'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png']
      : ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'];
    const src = map.getSource('carto');
    if (src) {
      src.setTiles(tiles);
    } else {
      pendingTheme = tiles;
    }
    if (map.getLayer('civici-labels')) {
      map.setPaintProperty('civici-labels', 'text-halo-color',
        isDark ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)');
    }
  }

  // ── LAYER COMUNI ─────────────────────────────────────────────────────────────
  function updateComuniColors() {
    if (!map.getLayer('comuni-fill')) return;
    if (Object.keys(aggiudicatoriMap).length === 0) return;

    // Raggruppa codici comuni per colore (denominazione primaria)
    const colorGroups = {}; // color → [codNum, ...]
    const fundedCodes = [];
    Object.entries(aggiudicatoriMap).forEach(([codStr, info]) => {
      const cod = parseInt(codStr, 10);
      fundedCodes.push(cod);
      const den   = info.entries.find(e => e.denominazione)?.denominazione || '';
      const color = den ? (denominazioniColorMap[den] || '#aaaaaa') : '#aaaaaa';
      if (!colorGroups[color]) colorGroups[color] = [];
      colorGroups[color].push(cod);
    });

    // Costruisce espressione match: cod → colore denominazione
    const fillMatch    = ['match', ['to-number', ['get', 'pro_com_t']]];
    const outlineMatch = ['match', ['to-number', ['get', 'pro_com_t']]];
    Object.entries(colorGroups).forEach(([color, codes]) => {
      const key = codes.length === 1 ? codes[0] : codes;
      fillMatch.push(key, color);
      outlineMatch.push(key, color);
    });
    fillMatch.push('rgba(0,0,0,0)');
    outlineMatch.push('rgba(150,150,150,0.12)');

    map.setPaintProperty('comuni-fill',    'fill-color',   fillMatch);
    map.setPaintProperty('comuni-fill',    'fill-opacity', [
      'match', ['to-number', ['get', 'pro_com_t']],
      fundedCodes, 0.45, 0
    ]);
    map.setPaintProperty('comuni-outline', 'line-color',   outlineMatch);
    map.setPaintProperty('comuni-outline', 'line-width', [
      'match', ['to-number', ['get', 'pro_com_t']],
      fundedCodes, 1.2, 0.5
    ]);
  }

  function buildComuniLegend() {
    const el = document.getElementById('comuni-legend');
    if (!el) return;
    const nodenCount = Object.values(aggiudicatoriMap)
      .filter(info => !info.entries.find(e => e.denominazione)).length;
    const entries = Object.entries(denominazioniColorMap)
      .sort((a, b) => a[0].localeCompare(b[0]));

    function legendItem(den, color, label, muted) {
      const active = selectedAggiudicatario === den ? ' can-legend-active' : '';
      return `<div class="legend-item can-legend-item${active}" data-den="${den.replace(/"/g,'&quot;')}" onclick="selectAggiudicatario(this.dataset.den)">
        <div class="legend-dot" style="background:${color};border-radius:2px;flex-shrink:0"></div>
        <span class="legend-label comuni-legend-name${muted ? ' can-legend-muted' : ''}">${label}</span>
      </div>`;
    }

    let html = '<h3>Aggiudicatari</h3>';
    if (nodenCount > 0)
      html += legendItem('(Senza aggiudicatario)', '#aaa', `Senza aggiudicatario (${nodenCount})`, true);
    entries.forEach(([den, color]) => { html += legendItem(den, color, den, false); });
    el.innerHTML = html;
    el.style.display = comuniLayerVisible ? '' : 'none';
  }

  function selectAggiudicatario(den) {
    // toggle
    if (selectedAggiudicatario === den) {
      selectedAggiudicatario = null;
      if (map.getLayer('comuni-selected')) map.setFilter('comuni-selected', ['==', '1', '0']);
    } else {
      selectedAggiudicatario = den;
      const isNoDen = den === '(Senza aggiudicatario)';
      const codes = Object.entries(aggiudicatoriMap)
        .filter(([, info]) => isNoDen
          ? !info.entries.find(e => e.denominazione)
          : info.entries.some(e => e.denominazione === den))
        .map(([cod]) => parseInt(cod, 10));
      const color = isNoDen ? '#aaa' : (denominazioniColorMap[den] || '#aaa');
      if (map.getLayer('comuni-selected')) {
        map.setFilter('comuni-selected', ['in', ['to-number', ['get', 'pro_com_t']], ['literal', codes]]);
        map.setPaintProperty('comuni-selected', 'line-color', color);
      }
    }
    // Sync UI
    document.querySelectorAll('.can-legend-item').forEach(el =>
      el.classList.toggle('can-legend-active', el.dataset.den === selectedAggiudicatario));
    document.querySelectorAll('.can-agg-row').forEach(tr =>
      tr.classList.toggle('can-row-active', tr.dataset.den === selectedAggiudicatario));
    updateSelectionFooter();
  }

  function updateSelectionFooter() {
    const bar = document.getElementById('comuni-analisi-footer');
    if (!bar) return;
    if (!selectedAggiudicatario) { bar.style.display = 'none'; return; }
    const den = selectedAggiudicatario;
    const isNoDen = den === '(Senza aggiudicatario)';
    const color = isNoDen ? '#aaa' : (denominazioniColorMap[den] || '#aaa');
    const count = Object.values(aggiudicatoriMap)
      .filter(info => isNoDen
        ? !info.entries.find(e => e.denominazione)
        : info.entries.some(e => e.denominazione === den)).length;
    bar.innerHTML = `
      <div class="can-footer-info">
        <span class="can-dot" style="background:${color}"></span>
        <span class="can-footer-name">${den}</span>
        <span class="can-footer-count">${count} comuni</span>
      </div>
      <div class="can-footer-actions">
        <button class="can-footer-btn" onclick="fitMapToAggiudicatario(selectedAggiudicatario)" title="Centra la mappa sui comuni selezionati">🗺 Centra</button>
        <button class="can-footer-btn" onclick="downloadAggiudicatarioCSV(selectedAggiudicatario)" title="Scarica CSV">⬇ CSV</button>
      </div>`;
    bar.style.display = '';
  }

  function fitMapToAggiudicatario(den) {
    const isNoDen = den === '(Senza aggiudicatario)';
    const codes = new Set(Object.entries(aggiudicatoriMap)
      .filter(([, info]) => isNoDen
        ? !info.entries.find(e => e.denominazione)
        : info.entries.some(e => e.denominazione === den))
      .map(([cod]) => parseInt(cod, 10)));

    const features = map.querySourceFeatures('comuni', { sourceLayer: 'comuni' })
      .filter(f => codes.has(parseInt(f.properties.pro_com_t, 10)));

    if (features.length === 0) {
      map.fitBounds([[6.6, 36.5], [18.5, 47.1]], { padding: 40, maxZoom: 7 });
      return;
    }

    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    features.forEach(f => {
      const rings = f.geometry.type === 'Polygon'
        ? f.geometry.coordinates
        : f.geometry.coordinates.flat(1);
      rings[0].forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      });
    });
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, maxZoom: 8 });
  }

  function downloadAggiudicatarioCSV(den) {
    const isNoDen = den === '(Senza aggiudicatario)';
    const rows = [['Comune','Provincia','Regione','Importo','CIG','Denominazione','Ruolo','Codice Fiscale','Stato','Finestra']];
    Object.values(aggiudicatoriMap).forEach(info => {
      const matched = isNoDen
        ? info.entries.filter(e => !e.denominazione)
        : info.entries.filter(e => e.denominazione === den);
      matched.forEach(en => rows.push([
        info.comune, info.provincia, info.regione,
        en.importo.toFixed(2), en.CIG, en.denominazione,
        en.ruolo, en.codice_fiscale, en.stato, en.finestra
      ]));
    });
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const slug = (isNoDen ? 'senza_aggiudicatario' : den).replace(/[^a-z0-9]/gi,'_').toLowerCase().slice(0,40);
    a.download = `anncsu_${slug}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── ANALISI AGGIUDICATORI ────────────────────────────────────────────────────
  function toggleComuniAnalisiPanel() {
    const panel = document.getElementById('comuni-analisi-panel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) renderComuniAnalisi();
  }

  function fmtEur(n) {
    return '€\u202f' + n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function statoLabel(s) {
    return s === 'A' ? 'Approvato' : s === 'E' ? 'Escluso' : (s || '—');
  }

  function renderComuniAnalisi() {
    const body = document.getElementById('comuni-analisi-body');
    if (!body) return;
    if (Object.keys(aggiudicatoriMap).length === 0) {
      body.innerHTML = '<div class="ma-empty">Dati non ancora caricati</div>';
      return;
    }

    // ── Aggregazione ──────────────────────────────────────────────────────────
    const byDen  = {}; // den → { comuni:Set, province:Set, regioni:Set, importo, color }
    const byReg  = {}; // regione → { comuni:Set, importo }
    const byStato = {}; // stato → { nComuni:Set, importo }
    const byFin  = {}; // finestra → { nComuni:Set, importo }
    let totalImporto = 0;
    const allProvince = new Set(), allRegioni = new Set();

    Object.entries(aggiudicatoriMap).forEach(([, info]) => {
      allProvince.add(info.provincia);
      allRegioni.add(info.regione);
      totalImporto += info.importoTotale;

      info.entries.forEach(en => {
        const den = en.denominazione || '(Senza aggiudicatario)';
        if (!byDen[den]) byDen[den] = {
          comuni: new Set(), province: new Set(), regioni: new Set(), importo: 0,
          color: denominazioniColorMap[en.denominazione] || '#aaa'
        };
        byDen[den].comuni.add(info.comune);
        byDen[den].province.add(info.provincia);
        byDen[den].regioni.add(info.regione);
        byDen[den].importo += en.importo;

        if (!byReg[info.regione]) byReg[info.regione] = { comuni: new Set(), importo: 0 };
        byReg[info.regione].comuni.add(info.comune);
        byReg[info.regione].importo += en.importo;

        const stato = en.stato || '—';
        if (!byStato[stato]) byStato[stato] = { comuni: new Set(), importo: 0 };
        byStato[stato].comuni.add(info.comune);
        byStato[stato].importo += en.importo;

        const fin = en.finestra || '—';
        if (!byFin[fin]) byFin[fin] = { comuni: new Set(), importo: 0 };
        byFin[fin].comuni.add(info.comune);
        byFin[fin].importo += en.importo;
      });
    });

    const nComuni = Object.keys(aggiudicatoriMap).length;
    const nAgg    = Object.keys(byDen).length;

    // ── Riepilogo ─────────────────────────────────────────────────────────────
    const summaryHTML = `
      <div id="can-summary">
        <div class="stat-box"><div class="stat-box-label">Comuni finanziati</div><div class="stat-box-value">${nComuni.toLocaleString('it-IT')}</div></div>
        <div class="stat-box"><div class="stat-box-label">Importo totale</div><div class="stat-box-value neutral" style="font-size:0.8rem">${fmtEur(totalImporto)}</div></div>
        <div class="stat-box"><div class="stat-box-label">Aggiudicatari</div><div class="stat-box-value">${nAgg.toLocaleString('it-IT')}</div></div>
        <div class="stat-box"><div class="stat-box-label">Province coinvolte</div><div class="stat-box-value neutral">${allProvince.size}</div></div>
        <div class="stat-box"><div class="stat-box-label">Regioni coinvolte</div><div class="stat-box-value neutral">${allRegioni.size}</div></div>
      </div>`;

    // ── Per aggiudicatario ────────────────────────────────────────────────────
    const sortedDen = Object.entries(byDen).sort((a, b) => b[1].importo - a[1].importo);
    const denRows = sortedDen.map(([den, d]) => {
        const pct    = (d.comuni.size / nComuni * 100).toFixed(1);
        const active = selectedAggiudicatario === den ? ' can-row-active' : '';
        const safeDen = den.replace(/"/g, '&quot;');
        return `<tr class="can-agg-row${active}" data-den="${safeDen}" onclick="selectAggiudicatario(this.dataset.den)" title="Clicca per evidenziare in mappa">
          <td><span class="can-dot" style="background:${d.color}"></span>${den}</td>
          <td>${d.comuni.size.toLocaleString('it-IT')}</td>
          <td>${d.province.size}</td>
          <td>${d.regioni.size}</td>
          <td>${fmtEur(d.importo)}</td>
          <td>${pct}%</td>
        </tr>`;
      }).join('');
    const denHTML = `
      <div class="can-section">
        <h4 class="can-title">Per aggiudicatario <span class="can-hint">clicca per evidenziare in mappa</span></h4>
        <input id="can-search" class="can-search" placeholder="🔍 Cerca aggiudicatario…" oninput="
          const q=this.value.toLowerCase();
          document.querySelectorAll('.can-agg-row').forEach(tr=>
            tr.style.display=tr.dataset.den.toLowerCase().includes(q)?'':'none')">
        <div class="can-table-wrap">
          <table class="can-table">
            <thead><tr><th>Denominazione</th><th>Comuni</th><th>Prov.</th><th>Reg.</th><th>Importo</th><th>%</th></tr></thead>
            <tbody>${denRows}</tbody>
          </table>
        </div>
      </div>`;

    // ── Per regione ───────────────────────────────────────────────────────────
    const regRows = Object.entries(byReg)
      .sort((a, b) => b[1].comuni.size - a[1].comuni.size)
      .map(([reg, d]) => `<tr>
        <td>${reg}</td>
        <td>${d.comuni.size.toLocaleString('it-IT')}</td>
        <td>${fmtEur(d.importo)}</td>
      </tr>`).join('');
    const regHTML = `
      <div class="can-section">
        <h4 class="can-title">Per regione <span class="can-hint">ordinato per n. comuni</span></h4>
        <div class="can-table-wrap">
          <table class="can-table">
            <thead><tr><th>Regione</th><th>Comuni</th><th>Importo</th></tr></thead>
            <tbody>${regRows}</tbody>
          </table>
        </div>
      </div>`;

    // ── Per stato candidatura ─────────────────────────────────────────────────
    const statoRows = Object.entries(byStato)
      .sort((a, b) => b[1].comuni.size - a[1].comuni.size)
      .map(([s, d]) => `<tr>
        <td>${statoLabel(s)}</td>
        <td>${d.comuni.size.toLocaleString('it-IT')}</td>
        <td>${fmtEur(d.importo)}</td>
      </tr>`).join('');
    const statoHTML = `
      <div class="can-section">
        <h4 class="can-title">Stato candidatura</h4>
        <div class="can-table-wrap">
          <table class="can-table">
            <thead><tr><th>Stato</th><th>Comuni</th><th>Importo</th></tr></thead>
            <tbody>${statoRows}</tbody>
          </table>
        </div>
      </div>`;

    // ── Per finestra temporale ────────────────────────────────────────────────
    const finRows = Object.entries(byFin)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([fin, d]) => `<tr>
        <td>Finestra ${fin}</td>
        <td>${d.comuni.size.toLocaleString('it-IT')}</td>
        <td>${fmtEur(d.importo)}</td>
      </tr>`).join('');
    const finHTML = `
      <div class="can-section">
        <h4 class="can-title">Per finestra temporale</h4>
        <div class="can-table-wrap">
          <table class="can-table">
            <thead><tr><th>Finestra</th><th>Comuni</th><th>Importo</th></tr></thead>
            <tbody>${finRows}</tbody>
          </table>
        </div>
      </div>`;

    body.innerHTML = summaryHTML + denHTML + regHTML + statoHTML + finHTML;
  }

  function toggleComuniLayer() {
    comuniLayerVisible = !comuniLayerVisible;
    const vis = comuniLayerVisible ? 'visible' : 'none';
    ['comuni-fill', 'comuni-outline', 'comuni-selected'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
    const leg = document.getElementById('comuni-legend');
    if (leg) leg.style.display = comuniLayerVisible ? '' : 'none';

    if (comuniLayerVisible) {
      if (!_comuniAnalisiCtrl) _comuniAnalisiCtrl = new ComuniAnalisiControl();
      map.addControl(_comuniAnalisiCtrl, 'top-right');
    } else {
      if (_comuniAnalisiCtrl) {
        map.removeControl(_comuniAnalisiCtrl);
        document.getElementById('comuni-analisi-panel')?.classList.remove('open');
      }
    }
  }

  // ── FILTRO TIPO ──────────────────────────────────────────────────────────────
  function setTypeFilter(type) {
    typeFilter = type;
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.classList.remove('active', 'active-err');
      if (btn.dataset.type === type)
        btn.classList.add(type === 'err' ? 'active-err' : 'active');
    });
    applyFilter();
  }

  // ── FILTRO MAPPA ─────────────────────────────────────────────────────────────
  function buildFilter() {
    const parts = [];

    if (selectedRegions.size === 0) return ['==', '1', '0'];

    if (selectedComune) {
      parts.push(['==', ['get', 'CODICE_ISTAT'], selectedComune.codice_istat]);
    } else {
      const activeProv = getActiveProvCodes().filter(c => selectedProvinces.has(c));
      if (activeProv.length === 0) return ['==', '1', '0'];
      if (activeProv.length < Object.keys(PROV_TO_REG).length)
        parts.push(['in', ['slice', ['get', 'CODICE_ISTAT'], 0, 3], ['literal', activeProv]]);
    }

    if (typeFilter === 'ok')  parts.push(['!=', ['get', 'out_of_bounds'], true]);
    if (typeFilter === 'err') parts.push(['==', ['get', 'out_of_bounds'], true]);

    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    return ['all', ...parts];
  }

  function applyFilter() {
    if (typeof map === 'undefined' || !map.getLayer('civici')) return;
    const f = buildFilter();
    map.setFilter('civici', f);
    if (map.getLayer('civici-labels')) map.setFilter('civici-labels', f);
    updateCounter();
  }

  // Chiudi dropdown cliccando fuori
  document.addEventListener('click', e => {
    ['region', 'province', 'comune'].forEach(id => {
      const dd = document.getElementById(`${id}-dropdown`);
      if (dd && !dd.contains(e.target)) {
        document.getElementById(`${id}-btn`).classList.remove('open');
        document.getElementById(`${id}-panel`).classList.remove('open');
      }
    });
  });

  // ── MAPPA ────────────────────────────────────────────────────────────────────
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

  const map = new maplibregl.Map({
    container: 'map',
style: {
  version: 8,
  sources: {
    'carto': {
      type: 'raster',
      tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors © <a href="https://www.linkedin.com/in/gbvitrano/" target="_blank">CARTO</a> | by <a href="https://carto.com/attribution" title="@gbvitrano "target="_blank">@gbvitrano</a>'
    }
  },
  layers: [{ id: 'carto-tiles', type: 'raster', source: 'carto' }]
},
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    minZoom: 4,
    maxZoom: 19,
    hash: true,
	  dragRotate: false,       // ← blocca rotazione con mouse
  pitchWithRotate: false   // ← blocca anche l'inclinazione (pitch)
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  map.addControl(new maplibregl.FullscreenControl(), 'top-right');

  let popup = null;

  map.on('load', () => {
    document.getElementById('loading').classList.add('hidden');
    if (pendingTheme) { map.getSource('carto').setTiles(pendingTheme); pendingTheme = null; }
    map.addControl(new StatsControl(), 'top-right');
    map.addControl(new AnalisiControl(), 'top-right');
    map.addControl(new ComuniControl(), 'top-right');

    // ── Source e layer comuni (zoom 6-9) ──────────────────────────────────────
    map.addSource('comuni', {
      type: 'vector',
      url: `pmtiles://${COMUNI_PMTILES_URL}`
    });
    map.addLayer({
      id: 'comuni-fill',
      type: 'fill',
      source: 'comuni',
      'source-layer': 'comuni',
      minzoom: 6,
      maxzoom: 9,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': 'rgba(150,150,150,0)',
        'fill-opacity': 1
      }
    });
    map.addLayer({
      id: 'comuni-outline',
      type: 'line',
      source: 'comuni',
      'source-layer': 'comuni',
      minzoom: 6,
      maxzoom: 9,
      layout: { visibility: 'none' },
      paint: {
        'line-color': 'rgba(150,150,150,0.15)',
        'line-width': 0.7
      }
    });
    map.addLayer({
      id: 'comuni-selected',
      type: 'line',
      source: 'comuni',
      'source-layer': 'comuni',
      minzoom: 6,
      maxzoom: 9,
      layout: { visibility: 'none' },
      filter: ['==', '1', '0'],
      paint: { 'line-color': '#fff', 'line-width': 2.5, 'line-opacity': 0.95 }
    });
    comuniLayerReady = true;
    if (Object.keys(aggiudicatoriMap).length > 0) updateComuniColors();

    map.addSource('anncsu', {
      type: 'vector',
      url: `pmtiles://${PMTILES_URL}`,
      attribution: 'Dati: <a href="https://anncsu.open.agenziaentrate.gov.it/" target="_blank">ANNCSU – Agenzia delle Entrate</a>'
    });

    map.addLayer({
      id: 'civici',
      type: 'circle',
      source: 'anncsu',
      'source-layer': 'addresses',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, 1.5, 8, 2.5, 12, 3.5, 16, 5, 20, 7
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'out_of_bounds'], true], COLOR_ERR,
          COLOR_OK
        ],
        'circle-opacity': [
          'interpolate', ['linear'], ['zoom'],
          4, 0.8, 10, 0.9, 14, 1.0
        ],
        'circle-stroke-width': 0,
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, 1.5, 8, 2.5, 12, 3.5, 16, 5, 17, 4, 19, 0
        ]
      }
    });

    map.addLayer({
      id: 'civici-labels',
      type: 'symbol',
      source: 'anncsu',
      'source-layer': 'addresses',
      minzoom: 17,
      layout: {
        'text-field': [
          'case',
          ['all', ['has', 'ESPONENTE'], ['!=', ['get', 'ESPONENTE'], '']],
          ['concat', ['to-string', ['get', 'CIVICO']], '/', ['get', 'ESPONENTE']],
          ['to-string', ['get', 'CIVICO']]
        ],
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 17, 10, 19, 13],
        'text-anchor': 'top',
        'text-offset': [0, 0.4],
        'text-allow-overlap': false,
        'text-ignore-placement': false
      },
      paint: {
        'text-color': [
          'case',
          ['==', ['get', 'out_of_bounds'], true], COLOR_ERR,
          COLOR_OK
        ],
        'text-halo-color': 'rgba(0,0,0,0.75)',
        'text-halo-width': 1.2
      }
    });

    map.addLayer({
      id: 'civici-highlight',
      type: 'circle',
      source: 'anncsu',
      'source-layer': 'addresses',
      filter: ['==', '1', '0'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 7, 14, 11, 18, 15],
        'circle-color': '#ffc800',
        'circle-opacity': 0.85,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5
      }
    });

    updateCounter();
    map.on('moveend', () => {
      updateCounter();
      if (document.getElementById('stats-panel').classList.contains('open')) renderStatsTable();
      if (document.getElementById('analisi-panel').classList.contains('open')) renderAnalisi();
    });
    map.on('zoomend', () => {
      updateCounter();
      if (document.getElementById('stats-panel').classList.contains('open')) renderStatsTable();
      if (document.getElementById('analisi-panel').classList.contains('open')) renderAnalisi();
    });

    map.on('click', 'civici', (e) => {
      if (popup) popup.remove();
      const p   = e.features[0].properties;
      const odonimo = p.ODONIMO || '';
      const civico  = p.CIVICO  || '';
      const esp     = p.ESPONENTE ? `/${p.ESPONENTE}` : '';
      const comune  = p.NOME_COMUNE || '';
      const addr    = [odonimo, civico + esp].filter(Boolean).join(', ');
      const [lon, lat] = e.features[0].geometry.coordinates;

      popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div class="popup-address">${addr || 'Indirizzo non disponibile'}</div>
          ${comune ? `<div class="popup-comune">${comune}</div>` : ''}
          ${p.out_of_bounds ? `<div class="popup-warning" id="popup-oob-dest">⚠ Fuori confine — ricerca territorio...</div>` : ''}
        `)
        .addTo(map);

      if (p.out_of_bounds) {
        reverseGeocodeNominatim(lon, lat).then(dest => {
          const el = document.getElementById('popup-oob-dest');
          if (el) el.innerHTML = `⚠ Fuori confine — coordinate in: <strong>${dest}</strong>`;
        }).catch(() => {});
      }
    });

    map.on('mouseenter', 'civici', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'civici', () => { map.getCanvas().style.cursor = ''; });

    map.on('click', 'comuni-fill', (e) => {
      const feat = e.features?.[0];
      if (!feat) return;
      const codNum = parseInt(feat.properties.pro_com_t, 10);
      const info   = aggiudicatoriMap[codNum];
      const nome   = feat.properties.comune || feat.properties.COMUNE || '';
      if (popup) popup.remove();
      if (!info) {
        popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
          .setLngLat(e.lngLat)
          .setHTML(`<div class="popup-address">${nome}</div><div class="popup-comune">Nessun finanziamento ANNCSU registrato</div>`)
          .addTo(map);
        return;
      }
      const importoFmt = info.importoTotale.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      // Conteggio civici visibili per questo comune
      const allCivici  = map.queryRenderedFeatures({ layers: ['civici'] });
      const civComune  = allCivici.filter(f => parseInt(f.properties.CODICE_ISTAT, 10) === codNum);
      const civOk  = civComune.filter(f => !f.properties.out_of_bounds).length;
      const civErr = civComune.filter(f =>  f.properties.out_of_bounds).length;
      const civTot = civComune.length;
      const civHTML = civTot > 0
        ? `<div class="popup-comuni-civici">
             <span class="civ-ok">✓ ${civOk.toLocaleString('it-IT')}</span>
             <span class="civ-sep"> · </span>
             <span class="civ-err">✗ ${civErr.toLocaleString('it-IT')}</span>
             <span class="civ-sep"> · </span>
             <span>Tot. ${civTot.toLocaleString('it-IT')} civici</span>
           </div>`
        : `<div class="popup-comuni-civici" style="color:var(--text-muted)">Nessun civico visibile a questo zoom</div>`;

      const entriesHTML = info.entries.map(en => {
        const den = en.denominazione || '—';
        const denColor = denominazioniColorMap[en.denominazione] || 'var(--text-muted)';
        return `
          <div class="popup-agg-entry">
            <div class="popup-agg-label">Aggiudicatario</div>
            <div class="popup-agg-row"><span>CIG</span><strong>${en.CIG || '—'}</strong></div>
            <div class="popup-agg-row popup-agg-den" style="--den-color:${denColor}"><span>Denominazione</span><strong>${den}</strong></div>
            <div class="popup-agg-row"><span>Ruolo</span><strong>${en.ruolo || '—'}</strong></div>
            <div class="popup-agg-row"><span>Cod. Fiscale</span><strong>${en.codice_fiscale || '—'}</strong></div>
          </div>`;
      }).join('');
      popup = new maplibregl.Popup({ closeButton: true, maxWidth: '340px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div class="popup-address">${info.ente || nome}</div>
          <div class="popup-comune">${info.provincia}</div>
          <div class="popup-comuni-importo">€ ${importoFmt}</div>
          ${civHTML}
          ${entriesHTML}
        `)
        .addTo(map);
    });
    map.on('mouseenter', 'comuni-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'comuni-fill', () => { map.getCanvas().style.cursor = ''; });
  });

  function fmt(n) {
    return n >= 10000 ? '>10.000' : n.toLocaleString('it-IT');
  }

  function updateCounter() {
    const features = map.queryRenderedFeatures({ layers: ['civici'] });
    const ok  = features.filter(f => !f.properties.out_of_bounds).length;
    const err = features.filter(f =>  f.properties.out_of_bounds).length;
    document.getElementById('count-ok').textContent    = fmt(ok);
    document.getElementById('count-err').textContent   = fmt(err);
    document.getElementById('count-value').textContent = fmt(features.length);
  }

  // ── CONTROLLI MAPPA ──────────────────────────────────────────────────────────
  function makeMapControl(title, svgInner, onclick) {
    return class {
      onAdd() {
        this._c = document.createElement('div');
        this._c.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const btn = document.createElement('button');
        btn.type = 'button'; btn.title = title;
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgInner}</svg>`;
        btn.onclick = onclick;
        this._c.appendChild(btn);
        return this._c;
      }
      onRemove() { this._c.parentNode.removeChild(this._c); }
    };
  }

  const StatsControl   = makeMapControl(
    'Statistiche per comune',
    '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/>',
    () => toggleStatsPanel()
  );

  const AnalisiControl = makeMapControl(
    'Analisi della mappa',
    '<circle cx="11" cy="11" r="7"/><circle cx="11" cy="11" r="3"/><line x1="11" y1="4" x2="11" y2="2"/><line x1="11" y1="20" x2="11" y2="22"/><line x1="4" y1="11" x2="2" y2="11"/><line x1="20" y1="11" x2="22" y2="11"/>',
    () => toggleAnalisiPanel()
  );

  class ComuniControl {
    onAdd() {
      this._c = document.createElement('div');
      this._c.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      this._btn = document.createElement('button');
      this._btn.type = 'button';
      this._btn.title = 'Mostra/nascondi comuni finanziati ANNCSU';
      this._btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`;
      // starts inactive (layer off by default)
      this._btn.onclick = () => {
        toggleComuniLayer();
        this._btn.classList.toggle('comuni-ctrl-active', comuniLayerVisible);
      };
      this._c.appendChild(this._btn);
      return this._c;
    }
    onRemove() { this._c.parentNode.removeChild(this._c); }
  }

  const ComuniAnalisiControl = makeMapControl(
    'Analisi aggiudicatori ANNCSU',
    '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/>',
    () => toggleComuniAnalisiPanel()
  );

  // ── RESIZE GENERICO ──────────────────────────────────────────────────────────
  function makeResizable(handleId, panelId, direction) {
    const handle = document.getElementById(handleId);
    const panel  = document.getElementById(panelId);
    let startX, startW;
    handle.addEventListener('mousedown', e => {
      startX = e.clientX; startW = panel.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      const onMove = e => {
        const delta = direction === 'left' ? startX - e.clientX : e.clientX - startX;
        panel.style.width = Math.min(
          Math.max(startW + delta, parseInt(getComputedStyle(panel).minWidth)),
          window.innerWidth - 60
        ) + 'px';
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  makeResizable('stats-resize-handle',   'stats-panel',   'left');
  makeResizable('analisi-resize-handle', 'analisi-panel', 'right');

  // ── STATS PANEL (tabella per comune) ─────────────────────────────────────────
  function toggleStatsPanel() {
    const panel = document.getElementById('stats-panel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) renderStatsTable();
  }

  function computeStats() {
    const features = map.queryRenderedFeatures({ layers: ['civici'] });
    const byComune = {};
    features.forEach(f => {
      const nome = f.properties.NOME_COMUNE || '—';
      if (!byComune[nome]) byComune[nome] = { ok: 0, err: 0, errFeatures: [] };
      if (f.properties.out_of_bounds) { byComune[nome].err++; byComune[nome].errFeatures.push(f); }
      else byComune[nome].ok++;
    });
    return byComune;
  }

  function renderStatsTable() {
    const byComune = computeStats();
    const rows = Object.entries(byComune).sort((a, b) => (b[1].ok + b[1].err) - (a[1].ok + a[1].err));
    let totalOk = 0, totalErr = 0;
    rows.forEach(([, v]) => { totalOk += v.ok; totalErr += v.err; });
    const total = totalOk + totalErr;
    const pctOk = total > 0 ? (totalOk / total * 100).toFixed(1) : '—';
    const pctErr = total > 0 ? (totalErr / total * 100).toFixed(1) : '—';

    document.getElementById('stats-summary').innerHTML = `
      <div class="stat-box"><div class="stat-box-label">✓ Geocodificati</div><div class="stat-box-value">${totalOk.toLocaleString('it-IT')}</div></div>
      <div class="stat-box"><div class="stat-box-label">✗ Fuori limite</div><div class="stat-box-value err">${totalErr.toLocaleString('it-IT')}</div></div>
      <div class="stat-box"><div class="stat-box-label">% OK / Errori</div><div class="stat-box-value neutral">${pctOk}% / ${pctErr}%</div></div>`;

    const tbody = document.getElementById('stats-tbody');
    tbody.innerHTML = '';
    rows.forEach(([nome, v]) => {
      const tot = v.ok + v.err;
      const pct = (v.ok / tot * 100).toFixed(1);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${nome}</td>
        <td class="td-ok">${v.ok.toLocaleString('it-IT')}</td>
        <td class="${v.err > 0 ? 'td-err' : 'td-ok'}">${v.err.toLocaleString('it-IT')}</td>
        <td class="td-tot">${tot.toLocaleString('it-IT')}</td>
        <td class="td-pct">${pct}%</td>
        <td style="text-align:center;padding:3px 6px;">
          ${v.err > 0 ? `<button class="oob-btn" title="Analizza dove cadono i civici fuori confine">🔍</button>` : ''}
        </td>`;
      tbody.appendChild(tr);

      const detailTr = document.createElement('tr');
      detailTr.style.display = 'none';
      detailTr.innerHTML = `<td colspan="6" style="padding:0 10px 8px 10px;"></td>`;
      tbody.appendChild(detailTr);

      if (v.err > 0) {
        tr.querySelector('.oob-btn').addEventListener('click', () => {
          const isOpen = detailTr.style.display !== 'none';
          if (isOpen) { detailTr.style.display = 'none'; tr.querySelector('.oob-btn').textContent = '🔍'; }
          else analyzeOOBComune(nome, tr.querySelector('.oob-btn'), detailTr);
        });
      }
    });

    document.getElementById('stats-tfoot').innerHTML = `
      <tr>
        <td>Totale (${rows.length} comuni)</td>
        <td class="td-ok">${totalOk.toLocaleString('it-IT')}</td>
        <td class="${totalErr > 0 ? 'td-err' : 'td-ok'}">${totalErr.toLocaleString('it-IT')}</td>
        <td class="td-tot">${total.toLocaleString('it-IT')}</td>
        <td class="td-pct">${pctOk}%</td>
        <td></td>
      </tr>`;
  }

  // ── ANALISI PANEL (dot-list, bottom-left) ────────────────────────────────────
  let _analisiAbort = false;

  function toggleAnalisiPanel() {
    const panel = document.getElementById('analisi-panel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) renderAnalisi();
  }

  function refreshAnalisi() {
    _analisiAbort = true;
    setTimeout(() => { _analisiAbort = false; renderAnalisi(); }, 60);
  }

  let _oobByComune = {};
  let _highlightComune = null;

  function downloadAnalisiCSV() {
    const rows = [['COMUNE_SORGENTE','CODICE_ISTAT','ODONIMO','CIVICO','ESPONENTE','INDIRIZZO','LONGITUDINE','LATITUDINE']];
    Object.entries(_oobByComune).forEach(([nome, feats]) => {
      feats.forEach(f => {
        const p = f.properties;
        const esp     = p.ESPONENTE || '';
        const civico  = p.CIVICO    || '';
        const odonimo = p.ODONIMO   || '';
        const addr    = [odonimo, civico + (esp ? '/' + esp : '')].filter(Boolean).join(', ');
        const [lng, lat] = f.geometry.coordinates;
        rows.push([
          nome,
          p.CODICE_ISTAT || '',
          odonimo,
          civico,
          esp,
          addr,
          lng.toFixed(6),
          lat.toFixed(6)
        ]);
      });
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `civici_fuori_confine_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function zoomToComune(nome) {
    if (_highlightComune === nome) {
      // Deseleziona
      _highlightComune = null;
      map.setFilter('civici-highlight', ['==', '1', '0']);
      document.querySelectorAll('.ma-item[data-comune]').forEach(el => el.classList.remove('ma-active'));
      return;
    }
    _highlightComune = nome;
    map.setFilter('civici-highlight', ['all',
      ['==', ['get', 'out_of_bounds'], true],
      ['==', ['get', 'NOME_COMUNE'], nome]
    ]);
    document.querySelectorAll('.ma-item[data-comune]').forEach(el =>
      el.classList.toggle('ma-active', el.dataset.comune === nome)
    );
    const feats = _oobByComune[nome] || [];
    if (feats.length === 0) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    feats.forEach(f => {
      const [lng, lat] = f.geometry.coordinates;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    });
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 80, maxZoom: 14 });
  }

  function renderAnalisi() {
    const body = document.getElementById('analisi-body');
    const features = map.queryRenderedFeatures({ layers: ['civici'] });
    const oob = features.filter(f => f.properties.out_of_bounds);

    const dlBtn = document.getElementById('analisi-download');
    if (oob.length === 0) {
      body.innerHTML = '<div class="ma-empty">Nessun civico fuori confine nella vista corrente</div>';
      if (dlBtn) dlBtn.disabled = true;
      return;
    }

    // Raggruppa per NOME_COMUNE
    _oobByComune = {};
    oob.forEach(f => {
      const nome = f.properties.NOME_COMUNE || '—';
      if (!_oobByComune[nome]) _oobByComune[nome] = [];
      _oobByComune[nome].push(f);
    });
    const entries = Object.entries(_oobByComune).sort((a, b) => b[1].length - a[1].length);

    let html = `<div class="ma-section-title">${oob.length.toLocaleString('it-IT')} civici fuori confine visibili</div>`;
    entries.forEach(([nome, feats]) => {
      const isActive = _highlightComune === nome;
      const safeName = nome.replace(/'/g, '&#39;');
      html += `
        <div class="ma-item${isActive ? ' ma-active' : ''}" data-comune="${safeName}" onclick="zoomToComune('${safeName}')">
          <div class="ma-dot" style="background:var(--accent-err);"></div>
          <div class="ma-label">${nome}</div>
          <div class="ma-count err">${feats.length.toLocaleString('it-IT')}</div>
        </div>`;
    });
    body.innerHTML = html;
    if (dlBtn) dlBtn.disabled = false;
  }

  // ── REVERSE GEOCODING ────────────────────────────────────────────────────────
  const _rgCache = new Map();

  async function reverseGeocodeNominatim(lon, lat) {
    const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
    if (_rgCache.has(key)) return _rgCache.get(key);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=it&zoom=10`,
      { headers: { 'User-Agent': 'ANNCSU-Viewer/1.0' } }
    );
    const d = await r.json();
    const name = d.address?.municipality || d.address?.city ||
                 d.address?.town || d.address?.village ||
                 d.address?.county || '—';
    _rgCache.set(key, name);
    return name;
  }

  async function analyzeOOBComune(nomeSrc, btnEl, detailTr) {
    btnEl.disabled = true; btnEl.textContent = '⏳';
    detailTr.style.display = '';
    const all = computeStats()[nomeSrc]?.errFeatures || [];
    if (all.length === 0) {
      detailTr.querySelector('td').innerHTML = '<em style="color:var(--text-faint);font-size:0.72rem">Nessun civico fuori confine visibile</em>';
      btnEl.textContent = '🔍'; btnEl.disabled = false; return;
    }
    const SAMPLE = Math.min(all.length, 20);
    const destCount = {};
    detailTr.querySelector('td').innerHTML = `<span style="color:var(--text-faint);font-size:0.72rem">⏳ 0/${SAMPLE}...</span>`;
    for (let i = 0; i < SAMPLE; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1100));
      const [lon, lat] = all[i].geometry.coordinates;
      try { const d = await reverseGeocodeNominatim(lon, lat); destCount[d] = (destCount[d] || 0) + 1; }
      catch { destCount['—'] = (destCount['—'] || 0) + 1; }
      detailTr.querySelector('td').innerHTML = `<span style="color:var(--text-faint);font-size:0.72rem">⏳ ${i+1}/${SAMPLE}...</span>`;
    }
    const note = SAMPLE < all.length ? ` (campione ${SAMPLE}/${all.length})` : '';
    const entries = Object.entries(destCount).sort((a, b) => b[1] - a[1]);
    detailTr.querySelector('td').innerHTML = `
      <div style="padding:6px 8px;background:var(--oob-strip-bg);border-radius:5px;margin:2px 0">
        <div style="font-size:0.65rem;color:var(--text-faint);margin-bottom:5px">Territorio in cui cadono${note}:</div>
        ${entries.map(([dest, n]) => `
          <div style="display:flex;justify-content:space-between;font-size:0.73rem;padding:2px 0;border-bottom:1px solid var(--oob-row-border)">
            <span style="color:var(--text-item)">${dest}</span>
            <span style="color:var(--accent-err);font-weight:700;margin-left:12px">${n}</span>
          </div>`).join('')}
      </div>`;
    btnEl.textContent = '🔄'; btnEl.title = 'Rianalizza'; btnEl.disabled = false;
  }

  // ── INFO MODAL ───────────────────────────────────────────────────────────────
  function switchInfoTab(id) {
    document.querySelectorAll('.info-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === id));
    document.querySelectorAll('.info-tab-body').forEach(b =>
      b.classList.toggle('active', b.id === 'info-tab-' + id));
  }

  function openInfoModal() {
    document.getElementById('info-overlay').classList.add('open');
    document.getElementById('info-sheet').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeInfoModal() {
    document.getElementById('info-overlay').classList.remove('open');
    document.getElementById('info-sheet').classList.remove('open');
    document.body.style.overflow = '';
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeInfoModal(); });

  // ── INIT ────────────────────────────────────────────────────────────────────
  loadProvince();
  loadComuni();
  loadAggiudicatori();