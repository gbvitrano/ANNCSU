// ============================================
// CHART BUILDER - JAVASCRIPT COMPLETO
// Versione: 4.0 - Dati autonomi dai CSV
// ============================================

let customChart = null;
let _lastChartData = null; // ultimi dati generati (per tabella/CSV)

// ============================================
// CARICAMENTO DATI AUTONOMO (indipendente dalla mappa)
// Carica direttamente i CSV senza dipendere da anncsu_dataviz.js
// ============================================
const _cb = {
    statsMap:   null,  // { CODICE_ISTAT → { ok, err, totale } }
    comuniMap:  null,  // { CODICE_ISTAT → { nome, provincia, regione } }
    agRows:     null,  // [{ denominazione, regione, provincia, comune, ... }]
    _promise:   null   // Promise di caricamento (singleton)
};

async function _loadCSV(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status} – ${path}`);
    return await res.text();
}

function _parseHeaders(csv) {
    const lines = csv.split('\n');
    return { headers: lines[0].split(',').map(h => h.trim()), lines };
}

async function _loadAllChartData() {
    // statsMap da anncsu_stats.csv
    const csv1 = await _loadCSV('dati/anncsu_stats.csv');
    const { headers: h1, lines: l1 } = _parseHeaders(csv1);
    const iC = h1.indexOf('CODICE_ISTAT'), iOk = h1.indexOf('civico_geocodificato'),
          iEr = h1.indexOf('fuori_limite_comunale'), iTo = h1.indexOf('totale'),
          iAl = h1.indexOf('civici_da_altri_comuni');
    const statsMap = {};
    l1.slice(1).forEach(line => {
        if (!line.trim()) return;
        const c = line.split(',');
        const cod = c[iC]?.trim(); if (!cod) return;
        statsMap[cod] = { ok: +c[iOk]||0, err: +c[iEr]||0, totale: +c[iTo]||0, altri: +c[iAl]||0 };
    });

    // comuniMap da comuni.csv (pro_com_t padded a 6 cifre, den_uts per città metropolitane)
    const csv2 = await _loadCSV('dati/comuni.csv');
    const { headers: h2, lines: l2 } = _parseHeaders(csv2);
    const iPct = h2.indexOf('pro_com_t'), iNm = h2.indexOf('comune'),
          iPv  = h2.indexOf('den_prov'), iUts = h2.indexOf('den_uts'),
          iRg  = h2.indexOf('den_reg'), iSg  = h2.indexOf('sigla');
    const comuniMap = {};
    l2.slice(1).forEach(line => {
        if (!line.trim()) return;
        const c = line.split(',');
        const cod  = c[iPct]?.trim().padStart(6, '0');
        const nome = c[iNm]?.trim();
        if (!cod || !nome) return;
        const prov = c[iPv]?.trim(), uts = c[iUts]?.trim();
        comuniMap[cod] = {
            nome,
            provincia: (prov && prov !== '-') ? prov : (uts || 'N/A'),
            regione:   c[iRg]?.trim() || 'N/A',
            sigla:     c[iSg]?.trim() || ''
        };
    });

    // agRows da aggiudicatori.csv
    const csv3 = await _loadCSV('dati/aggiudicatori.csv');
    const { headers: h3, lines: l3 } = _parseHeaders(csv3);
    const idx3 = f => h3.indexOf(f);
    const agRows = [];
    l3.slice(1).forEach(line => {
        if (!line.trim()) return;
        const c = line.split(',');
        const denominazione = c[idx3('denominazione')]?.trim();
        const codComune     = c[idx3('cod_comune')]?.trim();
        if (!denominazione || !codComune) return;
        agRows.push({
            codComune,        // ← salvato per il join con statsMap
            denominazione,
            aggiudicatore:    denominazione, // alias comodo
            ente:             c[idx3('ente')]?.trim()             || 'N/D',
            tipologiaEnte:    c[idx3('tipologia_ente')]?.trim()   || 'N/D',
            tipologiaAppalto: c[idx3('tipologia_appalto')]?.trim()|| 'N/D',
            comune:           c[idx3('comune')]?.trim()           || 'N/D',
            provincia:        c[idx3('provincia')]?.trim()        || 'N/D',
            regione:          c[idx3('regione')]?.trim()          || 'N/D',
            misura:           c[idx3('misura')]?.trim()           || 'N/D',
            avviso:           c[idx3('avviso')]?.trim()           || 'N/D',
            statoCandidatura: c[idx3('stato_candidatura')]?.trim()|| 'N/D',
            ruolo:            c[idx3('ruolo')]?.trim()            || 'N/D',
            importoFinanziamento:  parseFloat(c[idx3('importo_finanziamento')]  || 0),
            importoAggiudicazione: parseFloat(c[idx3('importo_aggiudicazione')] || 0)
        });
    });

    // Mappa cod_comune → primo aggiudicatore (per arricchire _getCiviciRows)
    const agByCodComune = {};
    agRows.forEach(ag => {
        if (!agByCodComune[ag.codComune]) agByCodComune[ag.codComune] = ag;
    });

    _cb.statsMap       = statsMap;
    _cb.comuniMap      = comuniMap;
    _cb.agRows         = agRows;
    _cb.agByCodComune  = agByCodComune;

    console.log(`✅ Chart Builder: ${Object.keys(statsMap).length} comuni stats, ${agRows.length} contratti PNRR, ${Object.keys(agByCodComune).length} comuni PNRR`);
}

/** Singleton: carica i dati una volta sola */
function _ensureData() {
    if (!_cb._promise) {
        _cb._promise = _loadAllChartData().catch(e => {
            console.error('❌ Chart Builder: errore caricamento dati', e);
            _cb._promise = null;  // Permette un nuovo tentativo
            throw e;
        });
    }
    return _cb._promise;
}

/** Array piatto civici: una riga per comune, arricchita con il primo aggiudicatore PNRR */
function _getCiviciRows() {
    const sm  = _cb.statsMap      || {};
    const cm  = _cb.comuniMap     || {};
    const agm = _cb.agByCodComune || {};
    return Object.entries(sm).map(([cod, s]) => {
        const info = cm[cod]  || {};
        const ag   = agm[cod] || {};
        return {
            CODICE_ISTAT:     cod,
            comune:           info.nome      || cod,
            provincia:        info.provincia || 'N/A',
            regione:          info.regione   || 'N/A',
            aggiudicatore:    ag.denominazione  || 'N/D',
            tipologiaEnte:    ag.tipologiaEnte   || 'N/D',
            tipologiaAppalto: ag.tipologiaAppalto|| 'N/D',
            misura:           ag.misura          || 'N/D',
            avviso:           ag.avviso          || 'N/D',
            statoCandidatura: ag.statoCandidatura|| 'N/D',
            importoFinanziamento:  ag.importoFinanziamento  || 0,
            importoAggiudicazione: ag.importoAggiudicazione || 0,
            totale: s.totale,
            ok:     s.ok,
            err:    s.err
        };
    });
}

/**
 * Array piatto JOIN: una riga per contratto PNRR, arricchita con le statistiche civici
 * del comune corrispondente (via cod_comune → CODICE_ISTAT).
 * Usato dalle dimensioni con prefisso "j_".
 */
function _getJoinedRows() {
    const sm = _cb.statsMap || {};
    return (_cb.agRows || []).map(ag => {
        const s = sm[ag.codComune] || { ok: 0, err: 0, totale: 0, altri: 0 };
        return {
            ...ag,              // tutti i campi aggiudicatori (incluso codComune, denominazione, aggiudicatore…)
            totale: s.totale,   // civici totale del comune
            ok:     s.ok,       // civici geocodificati
            err:    s.err       // civici fuori limite
        };
    });
}

// Filtri geografici attivi nel Chart Builder
let chartGeoFilters = { regioni: [], province: [], comuni: [], aggiudicatori: [] };

// Cache per le opzioni (usata dal search + cascade)
let _geoCache = { regToProvince: {}, provToComuni: {}, allProvince: [], allComuni: [], allAggiudicatori: [], agByComuneCache: {} };

let customChartConfig = {
    type: 'bar',
    dimension: null,
    metric: 'count',
    tipologieSelezionate: [],
    limit: 10,
    orientation: 'vertical',
    customTitle: '',
    // ✅ NUOVO: Configurazione grafici combinati
    mixed: {
        enabled: false,
        primaryType: 'bar',
        secondaryType: 'line',
        secondMetric: '',     // metrica per la seconda serie (solo con metrica singola)
        primaryDatasets: [],
        secondaryDatasets: []
    },
    colors: {
        mode: 'auto',
        primary: '#3b82f6',
        secondary: '#8b5cf6',
        text: '#1f2937'
    },
    style: {
        borderWidth: 2,
        opacity: 0.8,
        fontSize: 12,
        titleSize: 16,
        legendSize: 12,
        gridOpacity: 0.1,
        showGrid: true,
        showLegend: true,
        tension: 0.4,
        pointRadius: 3,
        fill: true
    },
    variant: {
        stacked: false,
        horizontal: false,
        showValues: true,
        animation: true,
        showLabelsOnLines: false  // ✅ NUOVO: etichette su linee/scatter nei mixed
    }
};

// ============================================
// GESTIONE MODALI GLOBALE
// ============================================
const ModalManager = {
    activeModals: new Set(),
    
    open(modalId) {
        this.activeModals.add(modalId);
        if (this.activeModals.size === 1) {
            document.body.classList.add('modal-open');
        }
    },
    
    close(modalId) {
        this.activeModals.delete(modalId);
        if (this.activeModals.size === 0) {
            document.body.classList.remove('modal-open');
            document.body.classList.remove('analytics-panel-open');
        }
    }
};

window.ModalManager = ModalManager;

// ============================================
// INIZIALIZZAZIONE
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    // Avvia subito il caricamento dati in background
    _ensureData()
        .then(() => _activateTriggerButton())
        .catch(() => _errorTriggerButton());

    setTimeout(() => initChartBuilderUI(), 300);
});

/** Stato iniziale: pulsante in loading (visibile ma non cliccabile) */
function _setTriggerLoading() {
    const btn = document.getElementById('chart-builder-trigger');
    if (!btn) return;
    btn.disabled = true;
    btn.title = 'Caricamento dati in corso...';
    btn.querySelector('i').className = 'fas fa-spinner fa-spin';
    btn.querySelector('span:not(.pulse-ring1)').textContent = 'Caricamento...';
    btn.classList.add('loading');
}

/** Stato pronto: pulsante attivo */
function _activateTriggerButton() {
    const btn = document.getElementById('chart-builder-trigger');
    if (!btn) return;
    btn.disabled = false;
    btn.title = 'Crea il tuo grafico personalizzato';
    btn.querySelector('i').className = 'fas fa-chart-pie';
    btn.querySelector('span:not(.pulse-ring1)').textContent = 'Crea il tuo DataViz';
    btn.classList.remove('loading');
    // Riavvia il pulse solo ora che è pronto
    const ring = btn.querySelector('.pulse-ring1');
    if (ring) { ring.style.animation = 'none'; setTimeout(() => { ring.style.animation = ''; }, 50); }
}

/** Stato errore: mostra che qualcosa non va */
function _errorTriggerButton() {
    const btn = document.getElementById('chart-builder-trigger');
    if (!btn) return;
    btn.disabled = false;  // Lasciamo cliccabile per riprovare
    btn.title = 'Errore nel caricamento dati — clicca per riprovare';
    btn.querySelector('i').className = 'fas fa-exclamation-triangle';
    btn.querySelector('span:not(.pulse-ring1)').textContent = 'Errore dati';
    btn.classList.add('error');
}

function initChartBuilderUI() {
    const triggerBtn = document.getElementById('chart-builder-trigger');
    const closeBtn = document.getElementById('chart-builder-close');
    const modal = document.getElementById('chart-builder-modal');
    
    if (!triggerBtn || !modal) return;
    
    const newTrigger = triggerBtn.cloneNode(true);
    triggerBtn.parentNode.replaceChild(newTrigger, triggerBtn);
    
    newTrigger.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        openChartBuilder();
    });
    
    let touchStartTime = 0;
    let touchMoved = false;
    
    newTrigger.addEventListener('touchstart', function(e) {
        touchStartTime = Date.now();
        touchMoved = false;
    }, { passive: true });
    
    newTrigger.addEventListener('touchmove', function() {
        touchMoved = true;
    }, { passive: true });
    
    newTrigger.addEventListener('touchend', function(e) {
        const touchDuration = Date.now() - touchStartTime;
        if (!touchMoved && touchDuration < 500) {
            e.preventDefault();
            e.stopPropagation();
            openChartBuilder();
        }
    }, { passive: false });
    
    if (closeBtn) {
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        
        newCloseBtn.addEventListener('click', closeChartBuilder);
        newCloseBtn.addEventListener('touchend', function(e) {
            e.preventDefault();
            closeChartBuilder();
        }, { passive: false });
    }
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeChartBuilder();
        }
    });
    
    initChartBuilder();
}

function openChartBuilder() {
    const analyticsPanel = document.getElementById('analytics-panel');
    if (analyticsPanel && analyticsPanel.classList.contains('open')) {
        if (typeof closeAnalytics === 'function') {
            closeAnalytics();
        }
        setTimeout(continueOpenChartBuilder, 100);
    } else {
        continueOpenChartBuilder();
    }
}

function continueOpenChartBuilder() {
    const modal = document.getElementById('chart-builder-modal');
    if (!modal) return;

    modal.style.zIndex = '10001';
    modal.classList.add('show');
    ModalManager.open('chart-builder');

    try { updateChartBuilderFiltersDisplay(); updateFooterStats(); } catch(e) {}

    // Carica i dati e inizializza i filtri geo quando pronti
    _ensureData().then(() => {
        try {
            updateChartBuilderFiltersDisplay();
            updateFooterStats();
            initGeoFilters();
        } catch(e) {}
    }).catch(() => {});
}

function closeChartBuilder() {
    const modal = document.getElementById('chart-builder-modal');
    if (modal) {
        modal.classList.remove('show');
        ModalManager.close('chart-builder');
    }
}

// ============================================
// INIZIALIZZAZIONE COMPONENTI
// ============================================
function initChartBuilder() {
    // Chart Type Selection
    document.querySelectorAll('.chart-type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            customChartConfig.type = this.dataset.type;
            
            // ✅ NUOVO: Gestione tipo mixed
            if (this.dataset.type === 'mixed') {
                customChartConfig.mixed.enabled = true;
                showMixedControls();
            } else {
                customChartConfig.mixed.enabled = false;
                hideMixedControls();
            }
            
            updateConfigOptions();
        });
    });
    
    // Dimension Select
    const dimensionSelect = document.getElementById('dimension-select');
    if (dimensionSelect) {
        dimensionSelect.addEventListener('change', (e) => {
            customChartConfig.dimension = e.target.value;
        });
    }
    
    // Custom Title Input
    const customTitleInput = document.getElementById('custom-title-input');
    if (customTitleInput) {
        customTitleInput.addEventListener('input', (e) => {
            customChartConfig.customTitle = e.target.value.trim();
        });
    }
    
    // Metric Select
    const metricSelect = document.getElementById('metric-select');
    if (metricSelect) {
        metricSelect.addEventListener('change', (e) => {
            customChartConfig.metric = e.target.value;
            updateTipologieVisibility();
            if (customChartConfig.mixed.enabled) _updateSecondMetricVisibility();
        });
    }
    
    // Tipologie Checkboxes
    initTipologieCheckboxes();
    
    // ✅ NUOVO: Mixed Chart Controls
    initMixedChartControls();
    
    // Limit Select
    const limitSelect = document.getElementById('limit-select');
    if (limitSelect) {
        limitSelect.addEventListener('change', (e) => {
            customChartConfig.limit = parseInt(e.target.value);
        });
    }
    
    // Orientation Select
    const orientationSelect = document.getElementById('orientation-select');
    if (orientationSelect) {
        orientationSelect.addEventListener('change', (e) => {
            customChartConfig.orientation = e.target.value;
        });
    }
    
    // Color Mode
    const colorModeSelect = document.getElementById('color-mode-select');
    if (colorModeSelect) {
        colorModeSelect.addEventListener('change', (e) => {
            customChartConfig.colors.mode = e.target.value;
            updateColorControls();
        });
    }
    
    // Color Pickers
    initColorPickers();
    
    // Range Controls
    initRangeControls();
    
    // Variant Checkboxes
    initVariantCheckboxes();
    
    // Action Buttons
    const generateBtn = document.getElementById('btn-generate-chart');
    if (generateBtn) {
        generateBtn.addEventListener('click', generateCustomChart);
    }
    
    const resetBtn = document.getElementById('btn-reset-builder');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetChartBuilder);
    }
    
    const downloadBtn = document.getElementById('btn-download-custom-chart');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadCustomChart);
    }

    // Vista grafico / tabella
    const btnViewChart = document.getElementById('btn-view-chart');
    if (btnViewChart) btnViewChart.addEventListener('click', _showChartView);

    const btnViewTable = document.getElementById('btn-view-table');
    if (btnViewTable) btnViewTable.addEventListener('click', _showTableView);

    // Download CSV
    const csvBtn = document.getElementById('btn-download-csv');
    if (csvBtn) csvBtn.addEventListener('click', downloadTableCSV);
    
    // Preset Buttons
    document.querySelectorAll('.apply-preset').forEach(btn => {
        btn.addEventListener('click', function() {
            applyStylePreset(this.dataset.preset);
        });
    });
    
    // Filtri geografici
    initGeoFilters();

    // Listener per aggiornamento filtri
    window.addEventListener('filtersUpdated', () => {
        if (document.getElementById('chart-builder-modal').classList.contains('show')) {
            updateChartBuilderFiltersDisplay();
            updateFooterStats();
        }
    });
}

// ============================================
// ✅ NUOVO: MIXED CHART CONTROLS
// ============================================
function initMixedChartControls() {
    const primaryTypeSelect = document.getElementById('mixed-primary-type');
    if (primaryTypeSelect) {
        primaryTypeSelect.addEventListener('change', (e) => {
            customChartConfig.mixed.primaryType = e.target.value;
        });
    }

    const secondaryTypeSelect = document.getElementById('mixed-secondary-type');
    if (secondaryTypeSelect) {
        secondaryTypeSelect.addEventListener('change', (e) => {
            customChartConfig.mixed.secondaryType = e.target.value;
        });
    }

    const secondMetricSelect = document.getElementById('mixed-second-metric');
    if (secondMetricSelect) {
        secondMetricSelect.addEventListener('change', (e) => {
            customChartConfig.mixed.secondMetric = e.target.value;
        });
    }
}

function showMixedControls() {
    const mixedGroup = document.getElementById('mixed-config-group');
    if (mixedGroup) mixedGroup.style.display = 'block';
    // Mostra/nasconde la seconda metrica in base alla metrica corrente
    _updateSecondMetricVisibility();
}

function hideMixedControls() {
    const mixedGroup = document.getElementById('mixed-config-group');
    if (mixedGroup) mixedGroup.style.display = 'none';
    customChartConfig.mixed.secondMetric = '';
    const sel = document.getElementById('mixed-second-metric');
    if (sel) sel.value = '';
}

/** Nasconde il select seconda metrica quando si usa metric=tipo (gestisce internamente 3 serie) */
function _updateSecondMetricVisibility() {
    const group = document.getElementById('mixed-second-metric-group');
    if (!group) return;
    const isTipo = customChartConfig.metric === 'tipo';
    group.style.display = isTipo ? 'none' : 'block';
    if (isTipo) {
        customChartConfig.mixed.secondMetric = '';
        const sel = document.getElementById('mixed-second-metric');
        if (sel) sel.value = '';
    }
}

// ============================================
// FILTRI GEOGRAFICI
// Logica: regione → filtra province → filtra comuni (cascade)
// I filtri vengono applicati in applyGeoFilters() prima dell'aggregazione.
// ============================================

function initGeoFilters() {
    const comuniMap = _cb.comuniMap || window.ANNCSUDataViz?.comuniMap || {};
    const agByCodComune = _cb.agByCodComune || {};
    const regToProvince = {};  // { regione → Set(province) }
    const provToComuni  = {};  // { provincia → Set(comuni nomi) }
    const comuneToAg    = {};  // { comune nome → aggiudicatore denominazione }

    Object.entries(comuniMap).forEach(([cod, c]) => {
        const reg  = c.regione   || 'N/A';
        const prov = c.provincia || 'N/A';
        const nome = c.nome      || '';
        if (!regToProvince[reg])  regToProvince[reg]  = new Set();
        if (!provToComuni[prov])  provToComuni[prov]  = new Set();
        regToProvince[reg].add(prov);
        if (nome) {
            provToComuni[prov].add(nome);
            const ag = agByCodComune[cod];
            if (ag) comuneToAg[nome] = ag.denominazione;
        }
    });

    // Converti in array ordinati
    Object.keys(regToProvince).forEach(k => regToProvince[k] = [...regToProvince[k]].sort());
    Object.keys(provToComuni).forEach(k  => provToComuni[k]  = [...provToComuni[k]].sort());

    // Lista unica aggiudicatori (ordinata)
    const allAggiudicatori = [...new Set(Object.values(agByCodComune).map(a => a.denominazione))].sort();

    _geoCache.regToProvince     = regToProvince;
    _geoCache.provToComuni      = provToComuni;
    _geoCache.allProvince       = Object.keys(provToComuni).sort();
    _geoCache.allComuni         = Object.values(provToComuni).flat().sort();
    _geoCache.allAggiudicatori  = allAggiudicatori;
    _geoCache.comuneToAg        = comuneToAg;  // comune → aggiudicatore (per cascade)

    // Popola i select iniziali
    const regioni = Object.keys(regToProvince).sort();
    _fillSelect('filter-regione',       regioni);
    _fillSelect('filter-provincia',     _geoCache.allProvince);
    _fillSelect('filter-comune',        _geoCache.allComuni);
    _fillSelect('filter-aggiudicatore', allAggiudicatori);

    // Evento: cambio regione → cascade province + comuni
    const selReg = document.getElementById('filter-regione');
    if (selReg) {
        selReg.addEventListener('change', function() {
            const sel = _getSelected(this);
            chartGeoFilters.regioni = sel;
            _updateCountBadge('regioni-sel-count', sel.length);
            _cascadeFromRegioni(sel);
            // Reset province e comuni
            chartGeoFilters.province = [];
            chartGeoFilters.comuni   = [];
            _updateCountBadge('province-sel-count', 0);
            _updateCountBadge('comuni-sel-count', 0);
            const sp = document.getElementById('search-provincia'); if(sp) sp.value = '';
            const sc = document.getElementById('search-comune');    if(sc) sc.value = '';
        });
    }

    // Evento: cambio provincia → cascade comuni
    const selProv = document.getElementById('filter-provincia');
    if (selProv) {
        selProv.addEventListener('change', function() {
            const sel = _getSelected(this);
            chartGeoFilters.province = sel;
            _updateCountBadge('province-sel-count', sel.length);
            _cascadeFromProvince(sel);
            chartGeoFilters.comuni = [];
            _updateCountBadge('comuni-sel-count', 0);
            document.getElementById('search-comune').value = '';
        });
    }

    // Evento: cambio comuni
    const selCom = document.getElementById('filter-comune');
    if (selCom) {
        selCom.addEventListener('change', function() {
            chartGeoFilters.comuni = _getSelected(this);
            _updateCountBadge('comuni-sel-count', chartGeoFilters.comuni.length);
        });
    }

    // Search: province
    const searchProv = document.getElementById('search-provincia');
    if (searchProv) {
        searchProv.addEventListener('input', function() {
            const activeProv = chartGeoFilters.regioni.length > 0
                ? chartGeoFilters.regioni.flatMap(r => _geoCache.regToProvince[r] || [])
                : _geoCache.allProvince;
            _filterSelectOptions('filter-provincia', activeProv, this.value, chartGeoFilters.province);
        });
    }

    // Search: comuni
    const searchCom = document.getElementById('search-comune');
    if (searchCom) {
        searchCom.addEventListener('input', function() {
            const activeCom = _getActiveComuni();
            _filterSelectOptions('filter-comune', activeCom, this.value, chartGeoFilters.comuni);
        });
    }

    // Evento: cambio aggiudicatore
    const selAg = document.getElementById('filter-aggiudicatore');
    if (selAg) {
        selAg.addEventListener('change', function() {
            chartGeoFilters.aggiudicatori = _getSelected(this);
            _updateCountBadge('aggiudicatori-sel-count', chartGeoFilters.aggiudicatori.length);
        });
    }

    // Search: aggiudicatori
    const searchAg = document.getElementById('search-aggiudicatore');
    if (searchAg) {
        searchAg.addEventListener('input', function() {
            const activeAg = _getActiveAggiudicatori();
            _filterSelectOptions('filter-aggiudicatore', activeAg, this.value, chartGeoFilters.aggiudicatori);
        });
    }

    // Reset geo filters button
    const resetBtn = document.getElementById('btn-reset-geo-filters');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetGeoFilters);
    }

    // Radio livello geografico
    document.querySelectorAll('input[name="geo-level"]').forEach(radio => {
        radio.addEventListener('change', function() {
            _switchGeoPanel(this.value);
        });
    });

    // Pulsanti "Seleziona tutte"
    const selAllReg = document.getElementById('btn-sel-all-regione');
    if (selAllReg) selAllReg.addEventListener('click', () => _selectAll('filter-regione', 'regioni', 'regioni-sel-count'));

    const selAllProv = document.getElementById('btn-sel-all-provincia');
    if (selAllProv) selAllProv.addEventListener('click', () => _selectAll('filter-provincia', 'province', 'province-sel-count'));

    const selAllCom = document.getElementById('btn-sel-all-comune');
    if (selAllCom) selAllCom.addEventListener('click', () => _selectAll('filter-comune', 'comuni', 'comuni-sel-count'));

    const selAllAg = document.getElementById('btn-sel-all-aggiudicatore');
    if (selAllAg) selAllAg.addEventListener('click', () => _selectAll('filter-aggiudicatore', 'aggiudicatori', 'aggiudicatori-sel-count'));
}

function _fillSelect(id, values, selected = []) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = values.map(v =>
        `<option value="${v}"${selected.includes(v) ? ' selected' : ''}>${v}</option>`
    ).join('');
}

function _getSelected(el) {
    return [...el.selectedOptions].map(o => o.value);
}

function _updateCountBadge(id, n) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n > 0 ? `(${n} selezionate)` : '';
}

function _cascadeFromRegioni(selectedRegioni) {
    let province;
    if (selectedRegioni.length === 0) {
        province = _geoCache.allProvince;
    } else {
        province = [...new Set(selectedRegioni.flatMap(r => _geoCache.regToProvince[r] || []))].sort();
    }
    _fillSelect('filter-provincia', province);
    const comuni = _getComuniForProvince(province);
    _fillSelect('filter-comune', comuni);
}

function _cascadeFromProvince(selectedProvince) {
    const comuni = _getComuniForProvince(
        selectedProvince.length > 0 ? selectedProvince : _getAvailableProvince()
    );
    _fillSelect('filter-comune', comuni);
}

function _getAvailableProvince() {
    if (chartGeoFilters.regioni.length > 0) {
        return chartGeoFilters.regioni.flatMap(r => _geoCache.regToProvince[r] || []);
    }
    return _geoCache.allProvince;
}

function _getComuniForProvince(province) {
    return [...new Set(province.flatMap(p => _geoCache.provToComuni[p] || []))].sort();
}

function _getActiveComuni() {
    if (chartGeoFilters.province.length > 0) return _getComuniForProvince(chartGeoFilters.province);
    if (chartGeoFilters.regioni.length > 0) {
        const prov = chartGeoFilters.regioni.flatMap(r => _geoCache.regToProvince[r] || []);
        return _getComuniForProvince(prov);
    }
    return _geoCache.allComuni;
}

/**
 * Aggiudicatori disponibili in base ai filtri geo attivi (regione/provincia/comune).
 * Se nessun filtro geo è attivo, restituisce tutti gli aggiudicatori.
 */
function _getActiveAggiudicatori() {
    const comuneToAg = _geoCache.comuneToAg || {};
    const activeCom  = _getActiveComuni();   // rispetta regione/provincia selezionate

    // Se ci sono comuni attivi (filtro geografico ristretto), mostra solo i loro aggiudicatori
    if (chartGeoFilters.regioni.length > 0 || chartGeoFilters.province.length > 0 || chartGeoFilters.comuni.length > 0) {
        const filteredCom = chartGeoFilters.comuni.length > 0 ? chartGeoFilters.comuni : activeCom;
        const ags = [...new Set(filteredCom.map(c => comuneToAg[c]).filter(Boolean))].sort();
        return ags.length > 0 ? ags : _geoCache.allAggiudicatori;
    }
    return _geoCache.allAggiudicatori;
}

function _filterSelectOptions(id, allOptions, searchTerm, currentSelected) {
    const term = searchTerm.toLowerCase().trim();
    const filtered = term ? allOptions.filter(v => v.toLowerCase().includes(term)) : allOptions;
    _fillSelect(id, filtered, currentSelected);
}

function resetGeoFilters() {
    chartGeoFilters = { regioni: [], province: [], comuni: [], aggiudicatori: [] };
    _fillSelect('filter-regione',       Object.keys(_geoCache.regToProvince).sort());
    _fillSelect('filter-provincia',     _geoCache.allProvince);
    _fillSelect('filter-comune',        _geoCache.allComuni);
    _fillSelect('filter-aggiudicatore', _geoCache.allAggiudicatori);
    ['regioni-sel-count','province-sel-count','comuni-sel-count','aggiudicatori-sel-count']
        .forEach(id => _updateCountBadge(id, 0));
    const sp = document.getElementById('search-provincia');     if (sp) sp.value = '';
    const sc = document.getElementById('search-comune');        if (sc) sc.value = '';
    const sa = document.getElementById('search-aggiudicatore'); if (sa) sa.value = '';
    // Torna al pannello regione
    const regRadio = document.getElementById('geo-level-regione');
    if (regRadio) { regRadio.checked = true; _switchGeoPanel('regione'); }
}

/**
 * Mostra un solo pannello geografico (regione / provincia / comune)
 * e popola il select in base allo stato cascade corrente.
 */
function _switchGeoPanel(level) {
    ['regione', 'provincia', 'comune', 'aggiudicatore'].forEach(l => {
        const panel = document.getElementById(`geo-panel-${l}`);
        if (panel) panel.style.display = l === level ? 'block' : 'none';
    });

    if (level === 'provincia') {
        const availProv = chartGeoFilters.regioni.length > 0
            ? [...new Set(chartGeoFilters.regioni.flatMap(r => _geoCache.regToProvince[r] || []))].sort()
            : _geoCache.allProvince;
        _fillSelect('filter-provincia', availProv, chartGeoFilters.province);

    } else if (level === 'comune') {
        const availCom = _getActiveComuni();
        _fillSelect('filter-comune', availCom, chartGeoFilters.comuni);

    } else if (level === 'aggiudicatore') {
        // Filtra la lista aggiudicatori in base alle regioni/province/comuni già selezionati
        const availAg = _getActiveAggiudicatori();
        _fillSelect('filter-aggiudicatore', availAg, chartGeoFilters.aggiudicatori);
    }
}

/**
 * Seleziona tutte le opzioni visibili nel select e aggiorna il filtro.
 * filterKey = 'regioni' | 'province' | 'comuni'
 */
function _selectAll(selectId, filterKey, badgeId) {
    const el = document.getElementById(selectId);
    if (!el) return;
    [...el.options].forEach(opt => { opt.selected = true; });
    const selected = _getSelected(el);
    chartGeoFilters[filterKey] = selected;
    _updateCountBadge(badgeId, selected.length);

    // Se selezioniamo regioni, cascade-aggiorna i selects di province e comuni
    if (filterKey === 'regioni') _cascadeFromRegioni(selected);
}

/**
 * Applica i filtri geografici all'array piatto prima dell'aggregazione.
 * Filtro a cascata: regione AND provincia AND comune.
 * Se una lista è vuota, non filtra per quella dimensione.
 */
function applyGeoFilters(data) {
    const { regioni, province, comuni, aggiudicatori } = chartGeoFilters;
    if (!regioni.length && !province.length && !comuni.length && !aggiudicatori.length) return data;
    return data.filter(row => {
        if (regioni.length       && !regioni.includes(row.regione))           return false;
        if (province.length      && !province.includes(row.provincia))        return false;
        if (comuni.length        && !comuni.includes(row.comune))             return false;
        if (aggiudicatori.length && !aggiudicatori.includes(row.aggiudicatore)) return false;
        return true;
    });
}

// ============================================
// TIPOLOGIE CHECKBOXES
// ============================================
function initTipologieCheckboxes() {
    const checkboxes = document.querySelectorAll('.tipologia-checkbox input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', function() {
            const tipo = this.value;
            const parent = this.closest('.tipologia-checkbox');
            
            if (this.checked) {
                customChartConfig.tipologieSelezionate.push(tipo);
                parent.classList.add('checked');
            } else {
                customChartConfig.tipologieSelezionate = customChartConfig.tipologieSelezionate.filter(t => t !== tipo);
                parent.classList.remove('checked');
            }
        });
    });
}

function updateTipologieVisibility() {
    const tipologieGroup = document.getElementById('tipologie-group');
    if (tipologieGroup) {
        // Mostra i checkbox ok/err quando la metrica è 'tipo' (equivalente a 'tipologia' di Palermo)
        tipologieGroup.style.display = customChartConfig.metric === 'tipo' ? 'block' : 'none';
    }
}

// ============================================
// COLOR CONTROLS
// ============================================
function initColorPickers() {
    const primaryColor = document.getElementById('primary-color');
    if (primaryColor) {
        primaryColor.addEventListener('input', (e) => {
            customChartConfig.colors.primary = e.target.value;
        });
    }
    
    const primaryGradient = document.getElementById('primary-color-gradient');
    if (primaryGradient) {
        primaryGradient.addEventListener('input', (e) => {
            customChartConfig.colors.primary = e.target.value;
        });
    }
    
    const secondaryColor = document.getElementById('secondary-color');
    if (secondaryColor) {
        secondaryColor.addEventListener('input', (e) => {
            customChartConfig.colors.secondary = e.target.value;
        });
    }
    
    const textColor = document.getElementById('text-color');
    if (textColor) {
        textColor.addEventListener('input', (e) => {
            customChartConfig.colors.text = e.target.value;
            if (customChart) {
                updateChartColors();
            }
        });
    }
}

function updateColorControls() {
    const mode = customChartConfig.colors.mode;
    const singleGroup = document.getElementById('single-color-group');
    const gradientGroup = document.getElementById('gradient-color-group');
    
    if (singleGroup) singleGroup.style.display = mode === 'single' ? 'block' : 'none';
    if (gradientGroup) gradientGroup.style.display = mode === 'gradient' ? 'block' : 'none';
}

function updateChartColors() {
    if (!customChart) return;
    
    const textColor = customChartConfig.colors.text;
    
    if (customChart.options.plugins.title) {
        customChart.options.plugins.title.color = textColor;
    }
    if (customChart.options.plugins.legend) {
        customChart.options.plugins.legend.labels.color = textColor;
    }
    if (customChart.options.plugins.datalabels) {
        customChart.options.plugins.datalabels.color = textColor;
    }
    if (customChart.options.scales) {
        Object.values(customChart.options.scales).forEach(scale => {
            if (scale.ticks) scale.ticks.color = textColor;
            if (scale.pointLabels) scale.pointLabels.color = textColor;
        });
    }
    
    customChart.update();
}

// ============================================
// RANGE CONTROLS
// ============================================
function initRangeControls() {
    initRangeControl('border-width', 'border-width-value', (val) => {
        customChartConfig.style.borderWidth = parseFloat(val);
    });
    
    initRangeControl('opacity', 'opacity-value', (val) => {
        customChartConfig.style.opacity = parseFloat(val);
    });
    
    initRangeControl('font-size', 'font-size-value', (val) => {
        customChartConfig.style.fontSize = parseInt(val);
    }, 'px');
    
    initRangeControl('title-size', 'title-size-value', (val) => {
        customChartConfig.style.titleSize = parseInt(val);
    }, 'px');
    
    initRangeControl('legend-size', 'legend-size-value', (val) => {
        customChartConfig.style.legendSize = parseInt(val);
    }, 'px');
    
    initRangeControl('grid-opacity', 'grid-opacity-value', (val) => {
        customChartConfig.style.gridOpacity = parseFloat(val);
    });
    
    initRangeControl('tension', 'tension-value', (val) => {
        customChartConfig.style.tension = parseFloat(val);
    });
    
    initRangeControl('point-radius', 'point-radius-value', (val) => {
        customChartConfig.style.pointRadius = parseInt(val);
    }, 'px');
}

function initRangeControl(inputId, displayId, callback, suffix = '') {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    
    if (input && display) {
        input.addEventListener('input', (e) => {
            const value = e.target.value;
            display.textContent = value + suffix;
            callback(value);
        });
    }
}

// ============================================
// VARIANT CHECKBOXES
// ============================================
function initVariantCheckboxes() {
    const stackedCb = document.getElementById('stacked-variant');
    if (stackedCb) {
        stackedCb.addEventListener('change', (e) => {
            customChartConfig.variant.stacked = e.target.checked;
        });
    }
    
    const horizontalCb = document.getElementById('horizontal-variant');
    if (horizontalCb) {
        horizontalCb.addEventListener('change', (e) => {
            customChartConfig.variant.horizontal = e.target.checked;
        });
    }
    
    // ✅ NUOVO: Variant Checkboxes con opzioni per mixed
    const showValuesCb = document.getElementById('show-values');
    if (showValuesCb) {
        showValuesCb.addEventListener('change', (e) => {
            customChartConfig.variant.showValues = e.target.checked;
        });
    }
    
    // ✅ NUOVO: Etichette su linee nei mixed
    const showLabelsOnLinesCb = document.getElementById('show-labels-on-lines');
    if (showLabelsOnLinesCb) {
        showLabelsOnLinesCb.addEventListener('change', (e) => {
            customChartConfig.variant.showLabelsOnLines = e.target.checked;
        });
    }
    
    const showGridCb = document.getElementById('show-grid');
    if (showGridCb) {
        showGridCb.addEventListener('change', (e) => {
            customChartConfig.style.showGrid = e.target.checked;
        });
    }
    
    const showLegendCb = document.getElementById('show-legend');
    if (showLegendCb) {
        showLegendCb.addEventListener('change', (e) => {
            customChartConfig.style.showLegend = e.target.checked;
        });
    }
    
    const fillAreaCb = document.getElementById('fill-area');
    if (fillAreaCb) {
        fillAreaCb.addEventListener('change', (e) => {
            customChartConfig.style.fill = e.target.checked;
        });
    }
    
    const animationCb = document.getElementById('animation');
    if (animationCb) {
        animationCb.addEventListener('change', (e) => {
            customChartConfig.variant.animation = e.target.checked;
        });
    }
}

// ============================================
// CONFIG OPTIONS UPDATE
// ============================================
function updateConfigOptions() {
    const type = customChartConfig.type;
    
    const orientationGroup = document.getElementById('orientation-group');
    if (orientationGroup) {
        orientationGroup.style.display = type === 'bar' ? 'block' : 'none';
    }
    
    const stackedGroup = document.getElementById('stacked-group');
    if (stackedGroup) {
        stackedGroup.style.display = ['bar', 'line', 'mixed'].includes(type) ? 'block' : 'none';
    }
    
    const horizontalGroup = document.getElementById('horizontal-group');
    if (horizontalGroup) {
        horizontalGroup.style.display = type === 'bar' ? 'block' : 'none';
    }
    
    const fillGroup = document.getElementById('fill-group');
    if (fillGroup) {
        fillGroup.style.display = ['line', 'mixed'].includes(type) ? 'block' : 'none';
    }
    
    const tensionGroup = document.getElementById('tension-group');
    if (tensionGroup) {
        tensionGroup.style.display = ['line', 'radar', 'mixed'].includes(type) ? 'block' : 'none';
    }
    
    const pointGroup = document.getElementById('point-group');
    if (pointGroup) {
        pointGroup.style.display = ['line', 'scatter', 'mixed'].includes(type) ? 'block' : 'none';
    }
}

// ============================================
// PRESET STYLES
// ============================================
function applyStylePreset(preset) {
    const presets = {
        minimal: {
            borderWidth: 1,
            opacity: 0.6,
            fontSize: 10,
            titleSize: 14,
            legendSize: 10,
            gridOpacity: 0.05
        },
        default: {
            borderWidth: 2,
            opacity: 0.8,
            fontSize: 12,
            titleSize: 16,
            legendSize: 12,
            gridOpacity: 0.1
        },
        bold: {
            borderWidth: 4,
            opacity: 1,
            fontSize: 14,
            titleSize: 20,
            legendSize: 14,
            gridOpacity: 0.2
        },
        clean: {
            borderWidth: 0,
            opacity: 0.9,
            fontSize: 11,
            titleSize: 18,
            legendSize: 11,
            gridOpacity: 0
        }
    };
    
    if (presets[preset]) {
        Object.assign(customChartConfig.style, presets[preset]);
        
        const updateInput = (id, value, displayId, suffix = '') => {
            const input = document.getElementById(id);
            const display = document.getElementById(displayId);
            if (input) input.value = value;
            if (display) display.textContent = value + suffix;
        };
        
        updateInput('border-width', presets[preset].borderWidth, 'border-width-value');
        updateInput('opacity', presets[preset].opacity, 'opacity-value');
        updateInput('font-size', presets[preset].fontSize, 'font-size-value', 'px');
        updateInput('title-size', presets[preset].titleSize, 'title-size-value', 'px');
        updateInput('legend-size', presets[preset].legendSize, 'legend-size-value', 'px');
        updateInput('grid-opacity', presets[preset].gridOpacity, 'grid-opacity-value');
    }
}

// ============================================
// FILTERS DISPLAY
// ============================================
// ============================================
// ANNCSU – mostra info dati nel pannello filtri
// ============================================
function updateChartBuilderFiltersDisplay() {
    const container = document.getElementById('custom-chart-filters');
    if (!container) return;

    // Usa i dati locali del chart builder (priorità) o anncsu_dataviz come fallback
    const sm = _cb.statsMap;
    const ag = _cb.agRows;

    if (!sm) {
        container.innerHTML = '<span class="no-filters">Caricamento dati in corso...</span>';
        return;
    }

    let totalCivici = 0, totalOk = 0, totalErr = 0;
    Object.values(sm).forEach(s => { totalCivici += s.totale; totalOk += s.ok; totalErr += s.err; });
    const numComuni        = Object.keys(sm).length;
    const okPct            = totalCivici > 0 ? ((totalOk / totalCivici) * 100).toFixed(2) : '0.00';
    const numContratti     = ag ? ag.length : 0;
    const numAggiudicatori = ag ? new Set(ag.map(r => r.denominazione)).size : 0;

    container.innerHTML = `
        <span class="filter-badge"><i class="fas fa-map-marker-alt"></i> ${totalCivici.toLocaleString('it-IT')} civici</span>
        <span class="filter-badge"><i class="fas fa-check-circle" style="color:#10b981"></i> ${totalOk.toLocaleString('it-IT')} OK (${okPct}%)</span>
        <span class="filter-badge"><i class="fas fa-times-circle" style="color:#ef4444"></i> ${totalErr.toLocaleString('it-IT')} ERR</span>
        <span class="filter-badge"><i class="fas fa-city"></i> ${numComuni.toLocaleString('it-IT')} comuni</span>
        <span class="filter-badge"><i class="fas fa-building"></i> ${numAggiudicatori} aggiudicatori PNRR</span>
        <span class="filter-badge"><i class="fas fa-file-contract"></i> ${numContratti.toLocaleString('it-IT')} contratti PNRR</span>
    `;
}

function updateFooterStats() {
    const totalEl  = document.getElementById('custom-chart-total');
    const periodEl = document.getElementById('custom-chart-period');
    if (!totalEl || !periodEl) return;

    const sm = _cb.statsMap;
    if (sm) {
        let tot = 0, ok = 0;
        Object.values(sm).forEach(s => { tot += s.totale; ok += s.ok; });
        const pct = tot > 0 ? ((ok/tot)*100).toFixed(2) : '0.00';
        totalEl.textContent = `${tot.toLocaleString('it-IT')} civici (${pct}% OK) · ${Object.keys(sm).length.toLocaleString('it-IT')} comuni`;
    }
    periodEl.textContent = 'ANNCSU · anncsu_stats.csv';
}

// ============================================
// CHART GENERATION
// Logica identica a Palermo-Incidenti:
//   1. getData()         →  array piatto (civici OPPURE aggiudicatori)
//   2. prepareChartData(data)  →  aggrega per row[dimension]
//   3. renderCustomChart(chartData)
//
// Rilevamento fonte dati:
//   dimensioni che iniziano per "ag_"  → getAggiudicatoriData()
//   altrimenti                          → getANNCSUData()
// ============================================
function isAggiudicatoriDimension(dim) {
    return dim && dim.startsWith('ag_');
}

function isJoinedDimension(dim) {
    return dim && dim.startsWith('j_');
}

function getFieldName(dim) {
    if (isAggiudicatoriDimension(dim)) return dim.slice(3); // 'ag_tipologiaEnte' → 'tipologiaEnte'
    if (isJoinedDimension(dim))        return dim.slice(2); // 'j_tipologiaEnte'  → 'tipologiaEnte'
    return dim;
}

async function generateCustomChart() {
    if (!customChartConfig.dimension) {
        alert('⚠️ Seleziona una dimensione per generare il grafico');
        return;
    }

    try {
        await _ensureData();
    } catch(e) {
        alert('⚠️ Impossibile caricare i dati. Verifica che il server serva i file in dati/');
        return;
    }

    const dim = customChartConfig.dimension;

    // Tabelle dettaglio: bypass del grafico
    if (dim === '_detail_join') {
        const rows = applyGeoFilters(_getJoinedRows());
        if (!rows.length) { alert('⚠️ Nessun risultato con i filtri correnti.'); return; }
        renderDetailTable(rows, 'join');
        return;
    }
    if (dim === '_detail_civici') {
        const rows = applyGeoFilters(_getCiviciRows());
        if (!rows.length) { alert('⚠️ Nessun risultato con i filtri correnti.'); return; }
        renderDetailTable(rows, 'civici');
        return;
    }

    const useAg   = isAggiudicatoriDimension(dim);
    const useJoin = isJoinedDimension(dim);
    let allData = useJoin ? _getJoinedRows()
                : useAg   ? (_cb.agRows || [])
                :            _getCiviciRows();

    if (!allData.length) {
        alert('⚠️ Nessun dato disponibile. Controlla la console per dettagli.');
        return;
    }

    allData = applyGeoFilters(allData);
    const chartData = prepareChartData(allData);

    if (chartData.length === 0) {
        alert('⚠️ Nessun risultato. Prova a ridurre i filtri geografici o cambia dimensione.');
        return;
    }

    // Seconda serie per Mixed con metrica singola
    let secondaryChartData = null;
    const secondMetric = customChartConfig.mixed.secondMetric;
    if (customChartConfig.mixed.enabled && secondMetric && customChartConfig.metric !== 'tipo') {
        const savedMetric = customChartConfig.metric;
        customChartConfig.metric = secondMetric;
        secondaryChartData = prepareChartData(allData);
        customChartConfig.metric = savedMetric;
    }

    renderCustomChart(chartData, secondaryChartData);
}

/**
 * Aggrega l'array piatto in base a dimensione + metrica.
 *
 * Sorgenti dati:
 *   (nessun prefisso) → _getCiviciRows()  – una riga per comune (civici + primo aggiudicatore)
 *   ag_*              → _cb.agRows        – una riga per contratto PNRR
 *   j_*               → _getJoinedRows()  – join contratti PNRR × civici del comune
 *
 * Metriche disponibili su tutte le sorgenti (i campi numerici coincidono):
 *   "count" / "ag_count"         → conta righe
 *   "totale_civici"              → somma row.totale
 *   "tipo"                       → breakdown ok / err / TOTAL
 *   "ag_importo_finanziamento"   → somma row.importoFinanziamento
 *   "ag_importo_aggiudicazione"  → somma row.importoAggiudicazione
 */
function prepareChartData(data) {
    const dimension = customChartConfig.dimension;
    const metric    = customChartConfig.metric;
    const limit     = customChartConfig.limit;
    const field     = getFieldName(dimension); // campo effettivo nel row

    let aggregatedData = {};
    const SKIP = v => !v || v === 'null' || v === 'N/A' || v === 'N/D';

    if (metric === 'count' || metric === 'ag_count') {
        data.forEach(row => {
            const value = row[field];
            if (!SKIP(value)) {
                aggregatedData[value] = (aggregatedData[value] || 0) + 1;
            }
        });

    } else if (metric === 'totale_civici') {
        // Somma totale civici per gruppo (usa anncsu_stats.json)
        data.forEach(row => {
            const value = row[field];
            if (!SKIP(value)) {
                aggregatedData[value] = (aggregatedData[value] || 0) + (row.totale || 0);
            }
        });

    } else if (metric === 'tipo') {
        // Breakdown ok/err/TOTAL — somma i campi ok/err/totale per comune
        data.forEach(row => {
            const value = row[field];
            if (!SKIP(value)) {
                if (!aggregatedData[value]) aggregatedData[value] = { ok: 0, err: 0, TOTAL: 0 };
                aggregatedData[value].ok    += row.ok    || 0;
                aggregatedData[value].err   += row.err   || 0;
                aggregatedData[value].TOTAL += row.totale || 0;
            }
        });

    } else if (metric === 'ag_importo_finanziamento') {
        data.forEach(row => {
            const value = row[field];
            if (!SKIP(value)) {
                aggregatedData[value] = (aggregatedData[value] || 0) + (row.importoFinanziamento || 0);
            }
        });

    } else if (metric === 'ag_importo_aggiudicazione') {
        data.forEach(row => {
            const value = row[field];
            if (!SKIP(value)) {
                aggregatedData[value] = (aggregatedData[value] || 0) + (row.importoAggiudicazione || 0);
            }
        });
    }

    let dataArray = Object.entries(aggregatedData).map(([key, value]) => ({
        label: key,
        value: value
    }));

    // Ordina per totale decrescente
    if (metric === 'tipo') {
        dataArray.sort((a, b) => (b.value.TOTAL || 0) - (a.value.TOTAL || 0));
    } else {
        dataArray.sort((a, b) => b.value - a.value);
    }

    // Applica limite
    if (limit > 0) dataArray = dataArray.slice(0, limit);

    return dataArray;
}


// ============================================
// CHART RENDERING
// ============================================
function renderCustomChart(data, secondaryData = null) {
    const canvas = document.getElementById('custom-chart-canvas');
    const wrapper = document.getElementById('chart-wrapper-custom');
    const placeholder = document.querySelector('.preview-placeholder');

    if (!canvas) return;

    // Salva i dati per tabella/CSV
    _lastChartData = data;

    if (wrapper) {
        wrapper.style.display = 'block';
        wrapper.classList.add('active');
    }
    if (placeholder) placeholder.style.display = 'none';

    // Mostra toggle visualizzazione e pulsante CSV
    const viewToggle = document.getElementById('view-toggle');
    const csvBtn = document.getElementById('btn-download-csv');
    if (viewToggle) viewToggle.style.display = 'flex';
    if (csvBtn) csvBtn.style.display = '';

    // Torna alla vista grafico
    _showChartView();

    // Aggiorna tabella in background
    renderDataTable(data);

    if (customChart) {
        customChart.destroy();
    }

    const chartDatasets = prepareChartDatasets(data, secondaryData);
    const chartLabels = data.map(d => d.label);

    // ✅ NUOVO: Per grafici mixed, il tipo del config è 'bar' o 'line' ma i dataset hanno il loro tipo
    const chartType = customChartConfig.mixed.enabled ? 'bar' : customChartConfig.type;

    const config = {
        type: chartType,
        data: {
            labels: chartLabels,
            datasets: chartDatasets
        },
        options: getChartOptions()
    };

    customChart = new Chart(canvas, config);
}

// ============================================
// VISTA TABELLA
// ============================================
function _showChartView() {
    const wrapper = document.getElementById('chart-wrapper-custom');
    const tableWrapper = document.getElementById('table-wrapper-custom');
    const btnChart = document.getElementById('btn-view-chart');
    const btnTable = document.getElementById('btn-view-table');
    if (wrapper) wrapper.style.display = 'block';
    if (tableWrapper) tableWrapper.style.display = 'none';
    if (btnChart) btnChart.classList.add('active');
    if (btnTable) btnTable.classList.remove('active');
}

function _showTableView() {
    const wrapper = document.getElementById('chart-wrapper-custom');
    const tableWrapper = document.getElementById('table-wrapper-custom');
    const btnChart = document.getElementById('btn-view-chart');
    const btnTable = document.getElementById('btn-view-table');
    if (wrapper) wrapper.style.display = 'none';
    if (tableWrapper) tableWrapper.style.display = 'block';
    if (btnChart) btnChart.classList.remove('active');
    if (btnTable) btnTable.classList.add('active');
}

function renderDataTable(data) {
    const thead = document.getElementById('data-table-head');
    const tbody = document.getElementById('data-table-body');
    if (!thead || !tbody) return;

    const metric = customChartConfig.metric;
    const dimension = customChartConfig.dimension;
    const dimLabel = getDimensionLabel(dimension);
    const isTipo = metric === 'tipo';

    // Intestazione
    if (isTipo) {
        thead.innerHTML = `<tr>
            <th>${dimLabel}</th>
            <th>OK (geocodificati)</th>
            <th>Fuori limite</th>
            <th>Totale</th>
            <th>% OK</th>
        </tr>`;
    } else {
        const metricLabel = getMetricLabel(metric);
        thead.innerHTML = `<tr><th>${dimLabel}</th><th class="num">${metricLabel}</th></tr>`;
    }

    // Righe
    const fmt = n => n.toLocaleString('it-IT');
    let rows = '';
    let totOk = 0, totErr = 0, totTot = 0, totVal = 0;

    data.forEach(d => {
        if (isTipo) {
            const ok = d.value.ok || 0;
            const err = d.value.err || 0;
            const tot = d.value.TOTAL || 0;
            const pct = tot > 0 ? ((ok / tot) * 100).toFixed(1) : '0.0';
            totOk += ok; totErr += err; totTot += tot;
            rows += `<tr>
                <td>${d.label}</td>
                <td class="num ok-val">${fmt(ok)}</td>
                <td class="num err-val">${fmt(err)}</td>
                <td class="num">${fmt(tot)}</td>
                <td class="num">${pct}%</td>
            </tr>`;
        } else {
            const val = d.value || 0;
            totVal += val;
            rows += `<tr>
                <td>${d.label}</td>
                <td class="num">${fmt(val)}</td>
            </tr>`;
        }
    });

    // Riga totale nel tfoot
    let tfoot = '';
    if (isTipo) {
        const pctTot = totTot > 0 ? ((totOk / totTot) * 100).toFixed(1) : '0.0';
        tfoot = `<tfoot><tr>
            <td><strong>Totale</strong></td>
            <td class="num ok-val"><strong>${fmt(totOk)}</strong></td>
            <td class="num err-val"><strong>${fmt(totErr)}</strong></td>
            <td class="num"><strong>${fmt(totTot)}</strong></td>
            <td class="num"><strong>${pctTot}%</strong></td>
        </tr></tfoot>`;
    } else {
        tfoot = `<tfoot><tr>
            <td><strong>Totale (${data.length} voci)</strong></td>
            <td class="num"><strong>${fmt(totVal)}</strong></td>
        </tr></tfoot>`;
    }

    tbody.innerHTML = rows;
    // Aggiunge tfoot alla tabella
    const table = document.getElementById('data-table');
    const existingTfoot = table.querySelector('tfoot');
    if (existingTfoot) existingTfoot.remove();
    table.insertAdjacentHTML('beforeend', tfoot);
}

function getDimensionLabel(dimension) {
    const map = {
        // Civici
        regione: 'Regione', provincia: 'Provincia', comune: 'Comune',
        aggiudicatore: 'Aggiudicatore PNRR',
        tipologiaEnte: 'Tipologia Ente', tipologiaAppalto: 'Tipologia Appalto',
        misura: 'Misura PNRR', avviso: 'Avviso / Bando',
        statoCandidatura: 'Stato Candidatura',
        // Aggiudicatori (ag_)
        ag_denominazione: 'Denominazione', ag_regione: 'Regione (contratti)',
        ag_provincia: 'Provincia (contratti)', ag_comune: 'Comune (contratti)',
        ag_tipologiaEnte: 'Tipologia Ente (contratti)', ag_tipologiaAppalto: 'Tipologia Appalto',
        ag_misura: 'Misura PNRR', ag_avviso: 'Avviso / Bando',
        ag_statoCandidatura: 'Stato Candidatura', ag_ente: 'Ente Beneficiario',
        // Join (j_)
        j_tipologiaEnte: 'Tipologia Ente → Civici', j_tipologiaAppalto: 'Tipologia Appalto → Civici',
        j_misura: 'Misura PNRR → Civici', j_avviso: 'Avviso / Bando → Civici',
        j_statoCandidatura: 'Stato Candidatura → Civici',
        j_aggiudicatore: 'Aggiudicatore → Civici', j_regione: 'Regione (join)'
    };
    return map[dimension] || dimension || 'Dimensione';
}

function getMetricLabel(metric) {
    const map = {
        count: 'N. Comuni / Contratti', totale_civici: 'Totale Civici',
        ag_count: 'N. Contratti',
        ag_importo_finanziamento: 'Importo Finanziamento (€)',
        ag_importo_aggiudicazione: 'Importo Aggiudicazione (€)'
    };
    return map[metric] || metric || 'Valore';
}

function downloadTableCSV() {
    if (!_lastChartData || !_lastChartData.length) return;

    const metric = customChartConfig.metric;
    const dimension = customChartConfig.dimension;
    const dimLabel = getDimensionLabel(dimension);
    const isTipo = metric === 'tipo';

    let csv = '';
    if (isTipo) {
        csv = `"${dimLabel}","OK (geocodificati)","Fuori limite","Totale","% OK"\n`;
        _lastChartData.forEach(d => {
            const ok = d.value.ok || 0;
            const err = d.value.err || 0;
            const tot = d.value.TOTAL || 0;
            const pct = tot > 0 ? ((ok / tot) * 100).toFixed(1) : '0.0';
            csv += `"${d.label}",${ok},${err},${tot},${pct}%\n`;
        });
    } else {
        const metricLabel = getMetricLabel(metric);
        csv = `"${dimLabel}","${metricLabel}"\n`;
        _lastChartData.forEach(d => {
            csv += `"${d.label}",${d.value}\n`;
        });
    }

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeTitle = (customChartConfig.customTitle || dimension || 'tabella').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.href = url;
    link.download = `anncsu_${safeTitle}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ============================================
// TABELLA DETTAGLIO MULTI-COLONNA
// ============================================

let _lastDetailRows = null;  // per CSV download della tabella dettaglio
let _lastDetailType = null;

/**
 * Rende una tabella multi-colonna con i dati grezzi join/civici.
 * type = 'join'   → colonne: Regione | Provincia | Comune | Aggiudicatore | Tipologia Ente | Misura | Totale | OK | ERR | % OK | Importo Fin.
 * type = 'civici' → colonne: Regione | Provincia | Comune | Aggiudicatore | Totale | OK | ERR | % OK
 */
function renderDetailTable(rows, type) {
    _lastDetailRows = rows;
    _lastDetailType = type;

    // Mostra l'area preview in modalità tabella
    const wrapper = document.getElementById('chart-wrapper-custom');
    const tableWrapper = document.getElementById('table-wrapper-custom');
    const placeholder = document.querySelector('.preview-placeholder');
    const viewToggle = document.getElementById('view-toggle');
    const csvBtn = document.getElementById('btn-download-csv');

    if (wrapper) wrapper.style.display = 'none';
    if (tableWrapper) tableWrapper.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
    if (viewToggle) viewToggle.style.display = 'flex';
    if (csvBtn) {
        csvBtn.style.display = '';
        csvBtn.onclick = downloadDetailCSV;  // sovrascrive il handler per CSV aggregato
    }

    // Aggiorna i toggle button
    const btnChart = document.getElementById('btn-view-chart');
    const btnTable = document.getElementById('btn-view-table');
    if (btnChart) btnChart.classList.remove('active');
    if (btnTable) btnTable.classList.add('active');

    const thead = document.getElementById('data-table-head');
    const tbody = document.getElementById('data-table-body');
    if (!thead || !tbody) return;

    const fmt  = n => (n || 0).toLocaleString('it-IT');
    const fmtE = n => (n || 0).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    if (type === 'join') {
        thead.innerHTML = `<tr>
            <th>Regione</th>
            <th>Provincia</th>
            <th>Comune</th>
            <th>Aggiudicatore</th>
            <th>Tipologia Ente</th>
            <th>Misura PNRR</th>
            <th class="num">Totale Civici</th>
            <th class="num">OK</th>
            <th class="num">Fuori Limite</th>
            <th class="num">% OK</th>
            <th class="num">Importo Fin. (€)</th>
        </tr>`;

        let totTot = 0, totOk = 0, totErr = 0, totFin = 0;
        tbody.innerHTML = rows.map(r => {
            const tot = r.totale || 0, ok = r.ok || 0, err = r.err || 0;
            const fin = r.importoFinanziamento || 0;
            const pct = tot > 0 ? ((ok / tot) * 100).toFixed(1) : '–';
            totTot += tot; totOk += ok; totErr += err; totFin += fin;
            return `<tr>
                <td>${r.regione || '–'}</td>
                <td>${r.provincia || '–'}</td>
                <td>${r.comune || '–'}</td>
                <td>${r.aggiudicatore || r.denominazione || '–'}</td>
                <td>${r.tipologiaEnte || '–'}</td>
                <td>${r.misura || '–'}</td>
                <td class="num">${fmt(tot)}</td>
                <td class="num ok-val">${fmt(ok)}</td>
                <td class="num err-val">${fmt(err)}</td>
                <td class="num">${pct}%</td>
                <td class="num">${fmtE(fin)}</td>
            </tr>`;
        }).join('');

        const pctTot = totTot > 0 ? ((totOk / totTot) * 100).toFixed(1) : '–';
        const tfoot = document.querySelector('#data-table tfoot');
        if (tfoot) tfoot.remove();
        document.getElementById('data-table').insertAdjacentHTML('beforeend',
            `<tfoot><tr>
                <td colspan="6"><strong>Totale (${rows.length} righe)</strong></td>
                <td class="num"><strong>${fmt(totTot)}</strong></td>
                <td class="num ok-val"><strong>${fmt(totOk)}</strong></td>
                <td class="num err-val"><strong>${fmt(totErr)}</strong></td>
                <td class="num"><strong>${pctTot}%</strong></td>
                <td class="num"><strong>${fmtE(totFin)}</strong></td>
            </tr></tfoot>`
        );

    } else {
        // type === 'civici'
        thead.innerHTML = `<tr>
            <th>Regione</th>
            <th>Provincia</th>
            <th>Comune</th>
            <th>Aggiudicatore PNRR</th>
            <th class="num">Totale Civici</th>
            <th class="num">OK</th>
            <th class="num">Fuori Limite</th>
            <th class="num">% OK</th>
        </tr>`;

        let totTot = 0, totOk = 0, totErr = 0;
        tbody.innerHTML = rows.map(r => {
            const tot = r.totale || 0, ok = r.ok || 0, err = r.err || 0;
            const pct = tot > 0 ? ((ok / tot) * 100).toFixed(1) : '–';
            totTot += tot; totOk += ok; totErr += err;
            return `<tr>
                <td>${r.regione || '–'}</td>
                <td>${r.provincia || '–'}</td>
                <td>${r.comune || '–'}</td>
                <td>${r.aggiudicatore || '–'}</td>
                <td class="num">${fmt(tot)}</td>
                <td class="num ok-val">${fmt(ok)}</td>
                <td class="num err-val">${fmt(err)}</td>
                <td class="num">${tot > 0 ? ((totOk / totTot) * 100).toFixed(1) : '–'}%</td>
            </tr>`;
        }).join('');

        const pctTot = totTot > 0 ? ((totOk / totTot) * 100).toFixed(1) : '–';
        const tfoot = document.querySelector('#data-table tfoot');
        if (tfoot) tfoot.remove();
        document.getElementById('data-table').insertAdjacentHTML('beforeend',
            `<tfoot><tr>
                <td colspan="4"><strong>Totale (${rows.length} comuni)</strong></td>
                <td class="num"><strong>${fmt(totTot)}</strong></td>
                <td class="num ok-val"><strong>${fmt(totOk)}</strong></td>
                <td class="num err-val"><strong>${fmt(totErr)}</strong></td>
                <td class="num"><strong>${pctTot}%</strong></td>
            </tr></tfoot>`
        );
    }
}

function downloadDetailCSV() {
    if (!_lastDetailRows || !_lastDetailRows.length) return;
    const rows = _lastDetailRows;
    const type = _lastDetailType;

    let csv = '';
    if (type === 'join') {
        csv = '"Regione","Provincia","Comune","Aggiudicatore","Tipologia Ente","Misura PNRR","Totale Civici","OK","Fuori Limite","% OK","Importo Fin. (€)"\n';
        rows.forEach(r => {
            const tot = r.totale || 0, ok = r.ok || 0, err = r.err || 0;
            const pct = tot > 0 ? ((ok / tot) * 100).toFixed(1) : '0.0';
            csv += `"${r.regione||''}","${r.provincia||''}","${r.comune||''}","${r.aggiudicatore||r.denominazione||''}","${r.tipologiaEnte||''}","${r.misura||''}",${tot},${ok},${err},${pct}%,${r.importoFinanziamento||0}\n`;
        });
    } else {
        csv = '"Regione","Provincia","Comune","Aggiudicatore","Totale Civici","OK","Fuori Limite","% OK"\n';
        rows.forEach(r => {
            const tot = r.totale || 0, ok = r.ok || 0, err = r.err || 0;
            const pct = tot > 0 ? ((ok / tot) * 100).toFixed(1) : '0.0';
            csv += `"${r.regione||''}","${r.provincia||''}","${r.comune||''}","${r.aggiudicatore||''}",${tot},${ok},${err},${pct}%\n`;
        });
    }

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `anncsu_dettaglio_${type}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ============================================
// PREPARE DATASETS
// Equivalente a Palermo-Incidenti:
//   metric='count'  → 1 dataset "Civici"
//   metric='tipo'   → 3 dataset OK / ERR / TOTAL  (come tipologia M/R/F/C/TOTAL)
// ============================================
function prepareChartDatasets(data, secondaryData = null) {
    const metric = customChartConfig.metric;
    const type   = customChartConfig.type;
    const style  = customChartConfig.style;
    const colors = customChartConfig.colors;
    const mixed  = customChartConfig.mixed;

    const isSingleMetric = metric === 'count' || !metric ||
        metric === 'totale_civici' ||
        metric === 'ag_count' ||
        metric === 'ag_importo_finanziamento' ||
        metric === 'ag_importo_aggiudicazione';

    if (isSingleMetric) {
        // ---- SINGOLO DATASET ----
        const values = data.map(d => d.value);
        let bgColors, borderColors;

        if (colors.mode === 'single') {
            bgColors     = values.map(() => hexToRgba(colors.primary, style.opacity));
            borderColors = values.map(() => colors.primary);
        } else if (colors.mode === 'gradient') {
            bgColors     = generateGradientColors(data.length, colors.primary, colors.secondary, style.opacity);
            borderColors = bgColors.map(c => c.replace(/[\d.]+\)$/g, '1)'));
        } else {
            if (['pie', 'doughnut', 'polarArea'].includes(type)) {
                const base = generateColors(data.length);
                bgColors     = base.map(c => hexToRgba(c, style.opacity));
                borderColors = base;
            } else {
                bgColors     = generateGradientColors(data.length, '#3b82f6', '#8b5cf6', style.opacity);
                borderColors = bgColors.map(c => c.replace(/[\d.]+\)$/g, '1)'));
            }
        }

        const metricLabels = {
            'count':                     'N. Comuni',
            'totale_civici':             'Totale Civici',
            'ag_count':                  'Contratti',
            'ag_importo_finanziamento':  'Importo Finanziamento (€)',
            'ag_importo_aggiudicazione': 'Importo Aggiudicazione (€)'
        };

        const dataset = {
            label: metricLabels[metric] || 'Civici',
            data: values,
            backgroundColor: bgColors,
            borderColor: borderColors,
            borderWidth: style.borderWidth,
            tension: style.tension,
            pointBackgroundColor: borderColors,
            pointBorderColor: '#fff',
            pointBorderWidth: 1
        };

        const actualType = mixed.enabled ? mixed.primaryType : type;
        if (actualType === 'line') {
            dataset.fill = style.fill;
            dataset.pointRadius = style.pointRadius;
            dataset.pointHoverRadius = style.pointRadius + 2;
        } else if (actualType === 'scatter') {
            dataset.pointRadius = style.pointRadius + 2;
            dataset.pointHoverRadius = style.pointRadius + 4;
        } else if (actualType === 'area') {
            dataset.type = 'line';
            dataset.fill = true;
            dataset.pointRadius = style.pointRadius;
            dataset.backgroundColor = bgColors.map(c => c.replace(/[\d.]+\)/, '0.3)'));
        } else {
            dataset.fill = true;
            dataset.pointRadius = 0;
        }

        // ---- SECONDA SERIE (mixed + secondMetric) ----
        if (mixed.enabled && secondaryData && secondaryData.length) {
            dataset.type        = mixed.primaryType;
            dataset.yAxisID     = 'y';

            const sec2Values = secondaryData.map(d => d.value ?? 0);
            const sec2Color  = colors.secondary || '#3b82f6';
            const sec2Dataset = {
                label:           metricLabels[mixed.secondMetric] || mixed.secondMetric || 'Serie 2',
                type:            mixed.secondaryType === 'area' ? 'line' : mixed.secondaryType,
                data:            sec2Values,
                backgroundColor: hexToRgba(sec2Color, mixed.secondaryType === 'area' ? 0.3 : style.opacity),
                borderColor:     sec2Color,
                borderWidth:     style.borderWidth,
                tension:         style.tension,
                yAxisID:         'y1',
                pointBackgroundColor: sec2Color,
                pointBorderColor:     '#fff',
                pointBorderWidth:     1,
                fill:            mixed.secondaryType === 'area',
                pointRadius:     ['line','area','scatter'].includes(mixed.secondaryType) ? style.pointRadius : 0
            };
            return [dataset, sec2Dataset];
        }

        return [dataset];

    } else if (metric === 'tipo') {
        // ---- MULTI-DATASET: OK / ERR / TOTAL ----
        // equivalente a tipologia M/R/F/C/TOTAL di Palermo
        const tipoMap = {
            'ok':    { label: 'Geocodificati (OK)',    color: '#10b981' },
            'err':   { label: 'Fuori Confine (ERR)',   color: '#ef4444' },
            'TOTAL': { label: 'Totale',                color: '#3b82f6' }
        };

        const tipiDaUsare = customChartConfig.tipologieSelezionate.length > 0
            ? customChartConfig.tipologieSelezionate
            : ['ok', 'err', 'TOTAL'];

        return tipiDaUsare.map((tipo, index) => {
            let datasetType = type;
            let yAxisID = 'y';

            if (mixed.enabled) {
                // TOTAL va sul tipo secondario con asse Y separato (come in Palermo)
                if (tipo === 'TOTAL') {
                    datasetType = mixed.secondaryType;
                    yAxisID = 'y1';
                } else {
                    datasetType = mixed.primaryType;
                    yAxisID = 'y';
                }
            }

            const dataset = {
                label: tipoMap[tipo]?.label || tipo,
                type: mixed.enabled ? datasetType : undefined,
                data: data.map(d => {
                    const v = d.value;
                    if (tipo === 'TOTAL') return (v?.ok || 0) + (v?.err || 0);
                    return v?.[tipo] || 0;
                }),
                backgroundColor: hexToRgba(tipoMap[tipo]?.color || '#6b7280', style.opacity),
                borderColor: tipoMap[tipo]?.color || '#6b7280',
                borderWidth: style.borderWidth,
                yAxisID: mixed.enabled ? yAxisID : undefined,
                tension: style.tension,
                pointBackgroundColor: tipoMap[tipo]?.color || '#6b7280',
                pointBorderColor: '#fff',
                pointBorderWidth: 1
            };

            if (datasetType === 'line' || type === 'line') {
                dataset.fill = style.fill;
                dataset.pointRadius = style.pointRadius;
            } else if (datasetType === 'scatter') {
                dataset.pointRadius = style.pointRadius + 2;
                dataset.pointHoverRadius = style.pointRadius + 4;
            } else if (datasetType === 'area') {
                dataset.type = 'line';
                dataset.fill = true;
                dataset.pointRadius = style.pointRadius;
                dataset.backgroundColor = hexToRgba(tipoMap[tipo]?.color || '#6b7280', 0.3);
            } else {
                dataset.pointRadius = 0;
            }

            return dataset;
        });
    }

    return [];
}

// ============================================
// ✅ CHART OPTIONS CON SUPPORTO DOPPIO ASSE Y
// ============================================
function getChartOptions() {
    const type = customChartConfig.type;
    const style = customChartConfig.style;
    const variant = customChartConfig.variant;
    const dimension = customChartConfig.dimension;
    const textColor = customChartConfig.colors.text;
    const mixed = customChartConfig.mixed;

    const metric = customChartConfig.metric;

    // Nomi leggibili per le dimensioni
    const dimensionNames = {
        'regione':              'per Regione',
        'provincia':            'per Provincia',
        'comune':               'per Comune',
        'tipo':                 'Tipo OK / ERR',
        'aggiudicatore':        'per Aggiudicatore PNRR',
        'ag_denominazione':     'per Aggiudicatore PNRR',
        'ag_regione':           'per Regione (PNRR)',
        'ag_tipologiaEnte':     'per Tipologia Ente',
        'ag_statoCandidatura':  'per Stato Candidatura',
        'ag_misura':            'per Misura PNRR',
        'ag_avviso':            'per Avviso / Bando',
        'ag_ente':              'per Ente Beneficiario'
    };

    const metricNames = {
        'count':                     'N. Comuni',
        'totale_civici':             'Totale Civici',
        'tipo':                      'Civici per Tipo (OK/ERR)',
        'ag_count':                  'Contratti PNRR',
        'ag_importo_finanziamento':  'Importo Finanziamento (€)',
        'ag_importo_aggiudicazione': 'Importo Aggiudicazione (€)'
    };

    // Formattazione numero intero per totale civici
    const isTotaleCivici = metric === 'totale_civici';
    const formatNumero = v => new Intl.NumberFormat('it-IT').format(v);

    const dimLabel = dimensionNames[dimension] || dimension;
    const metLabel = metricNames[metric] || '';
    const autoTitle = metLabel ? `${metLabel} ${dimLabel}` : dimLabel;

    let chartTitle = customChartConfig.customTitle || autoTitle;

    // Per metriche importo: formatta i valori come € nel tooltip
    const isImporto = metric === 'ag_importo_finanziamento' || metric === 'ag_importo_aggiudicazione';
    const formatEuro = v => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
    
    const baseOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: variant.animation ? { duration: 750 } : false,
        plugins: {
            legend: {
                display: style.showLegend,
                position: 'bottom',
                labels: {
                    color: textColor,
                    font: { size: style.legendSize, family: 'Titillium Web' },
                    padding: 15,
                    usePointStyle: true
                }
            },
            title: {
                display: true,
                text: chartTitle,
                color: textColor,
                font: { size: style.titleSize, weight: 'bold', family: 'Titillium Web' },
                padding: 20
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                padding: 12,
                titleFont: { size: style.fontSize + 1, weight: 'bold' },
                bodyFont: { size: style.fontSize },
                titleColor: '#fff',
                bodyColor: '#fff',
                callbacks: isImporto ? {
                    label: function(ctx) {
                        return ` ${ctx.dataset.label}: ${formatEuro(ctx.parsed.y ?? ctx.parsed)}`;
                    }
                } : isTotaleCivici ? {
                    label: function(ctx) {
                        return ` ${ctx.dataset.label}: ${formatNumero(ctx.parsed.y ?? ctx.parsed)}`;
                    }
                } : undefined
            },
            datalabels: {
                display: function(context) {
                    const datasetType = context.dataset.type || type;
                    if (mixed.enabled) {
                        if (datasetType === 'bar') return variant.showValues;
                        if (['line', 'scatter', 'area'].includes(datasetType)) return variant.showLabelsOnLines;
                    }
                    return variant.showValues;
                },
                formatter: function(value) {
                    if (value === null || value === undefined) return '';
                    if (isImporto) return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
                    if (typeof value === 'number') return value >= 1000 ? new Intl.NumberFormat('it-IT').format(Math.round(value)) : value;
                    return value;
                },
                color: textColor,
                anchor: function(context) {
                    const datasetType = context.dataset.type || type;
                    // ✅ Linee: etichette sopra i punti
                    if (['line', 'scatter', 'area'].includes(datasetType)) {
                        return 'end';
                    }
                    // ✅ Barre: dentro o sopra in base al valore
                    const value = context.dataset.data[context.dataIndex];
                    const max = Math.max(...context.dataset.data);
                    return value > max * 0.2 ? 'center' : 'end';
                },
                align: function(context) {
                    const datasetType = context.dataset.type || type;
                    // ✅ Linee: allineamento sopra
                    if (['line', 'scatter', 'area'].includes(datasetType)) {
                        return 'top';
                    }
                    // ✅ Barre: logica normale
                    const value = context.dataset.data[context.dataIndex];
                    const max = Math.max(...context.dataset.data);
                    return value > max * 0.2 ? 'center' : 'end';
                },
                offset: function(context) {
                    const datasetType = context.dataset.type || type;
                    // ✅ Linee: offset maggiore per non sovrapporsi ai punti
                    if (['line', 'scatter', 'area'].includes(datasetType)) {
                        return 8;
                    }
                    // ✅ Barre: offset normale
                    const value = context.dataset.data[context.dataIndex];
                    const max = Math.max(...context.dataset.data);
                    return value > max * 0.2 ? 0 : 4;
                },
                font: { 
                    weight: 'bold', 
                    size: style.fontSize - 1,
                    family: 'Titillium Web'
                },
                borderRadius: 4,
                padding: { top: 3, right: 5, bottom: 3, left: 5 },
                backgroundColor: function(context) {
                    const datasetType = context.dataset.type || type;
                    // ✅ Linee: sfondo semi-trasparente per leggibilità
                    if (['line', 'scatter', 'area'].includes(datasetType)) {
                        return 'rgba(255, 255, 255, 0.8)';
                    }
                    return 'transparent';
                }
            }
        }
    };
    
    // ✅ SCALES CON SUPPORTO DOPPIO ASSE Y PER MIXED
    if (type === 'bar' || type === 'line' || mixed.enabled) {
        const scales = {
            x: {
                stacked: variant.stacked && !mixed.enabled,
                ticks: { 
                    color: textColor, 
                    font: { size: style.fontSize } 
                },
                grid: { 
                    display: style.showGrid, 
                    color: `rgba(148, 163, 184, ${style.gridOpacity})` 
                }
            },
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                stacked: variant.stacked && !mixed.enabled,
                beginAtZero: true,
                ticks: { 
                    color: textColor, 
                    font: { size: style.fontSize } 
                },
                grid: { 
                    display: style.showGrid, 
                    color: `rgba(148, 163, 184, ${style.gridOpacity})` 
                }
            }
        };
        
        // ✅ Aggiungi secondo asse Y se mixed è abilitato
        if (mixed.enabled) {
            scales.y1 = {
                type: 'linear',
                display: true,
                position: 'right',
                beginAtZero: true,
                ticks: { 
                    color: textColor, 
                    font: { size: style.fontSize } 
                },
                grid: { 
                    drawOnChartArea: false // Non sovrapporre la griglia
                }
            };
        }
        
        baseOptions.scales = scales;
        
        if (type === 'bar') {
            baseOptions.indexAxis = variant.horizontal || customChartConfig.orientation === 'horizontal' ? 'y' : 'x';
        }
    } else if (type === 'radar') {
        baseOptions.scales = {
            r: {
                beginAtZero: true,
                ticks: { 
                    color: textColor, 
                    backdropColor: 'transparent',
                    font: { size: style.fontSize },
                    showLabelBackdrop: false
                },
                grid: { color: `rgba(148, 163, 184, ${style.gridOpacity * 3})` },
                angleLines: { color: `rgba(148, 163, 184, ${style.gridOpacity * 3})` },
                pointLabels: { 
                    color: textColor, 
                    font: { size: style.fontSize, weight: '600' } 
                }
            }
        };
    } else if (type === 'polarArea') {
        baseOptions.scales = {
            r: {
                beginAtZero: true,
                ticks: { 
                    color: textColor, 
                    backdropColor: 'transparent',
                    font: { size: style.fontSize },
                    showLabelBackdrop: false
                },
                grid: { color: `rgba(148, 163, 184, ${style.gridOpacity * 3})` }
            }
        };
    }
    
    return baseOptions;
}

// ============================================
// COLOR UTILITIES
// ============================================
function generateColors(count) {
    const baseColors = [
        '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', 
        '#ef4444', '#ec4899', '#06b6d4', '#84cc16'
    ];
    return baseColors.slice(0, count);
}

function generateGradientColors(count, startColor, endColor, opacity = 1) {
    const start = hexToRgb(startColor);
    const end = hexToRgb(endColor);
    const colors = [];
    
    for (let i = 0; i < count; i++) {
        const ratio = count > 1 ? i / (count - 1) : 0;
        const r = Math.round(start.r + (end.r - start.r) * ratio);
        const g = Math.round(start.g + (end.g - start.g) * ratio);
        const b = Math.round(start.b + (end.b - start.b) * ratio);
        colors.push(`rgba(${r}, ${g}, ${b}, ${opacity})`);
    }
    
    return colors;
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 59, g: 130, b: 246 };
}

function hexToRgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// ============================================
// RESET & DOWNLOAD
// ============================================
function resetChartBuilder() {
    customChartConfig = {
        type: 'bar',
        dimension: null,
        metric: 'count',
        tipologieSelezionate: [],
        limit: 10,
        orientation: 'vertical',
        customTitle: '',
        mixed: {
            enabled: false,
            primaryType: 'bar',
            secondaryType: 'line',
            primaryDatasets: [],
            secondaryDatasets: []
        },
        colors: {
            mode: 'auto',
            primary: '#3b82f6',
            secondary: '#8b5cf6',
            text: '#1f2937'
        },
        style: {
            borderWidth: 2,
            opacity: 0.8,
            fontSize: 12,
            titleSize: 16,
            legendSize: 12,
            gridOpacity: 0.1,
            showGrid: true,
            showLegend: true,
            tension: 0.4,
            pointRadius: 3,
            fill: true
        },
        variant: {
            stacked: false,
            horizontal: false,
            showValues: true,
            animation: true,
            showLabelsOnLines: false  // ✅ Reset anche questo
        }
    };
    
    document.querySelectorAll('.chart-type-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.type === 'bar') btn.classList.add('active');
    });
    
    const selects = ['dimension-select', 'metric-select', 'limit-select', 'orientation-select', 
                     'color-mode-select', 'mixed-primary-type', 'mixed-secondary-type'];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.selectedIndex = 0;
    });
    
    const customTitleInput = document.getElementById('custom-title-input');
    if (customTitleInput) customTitleInput.value = '';
    
    document.querySelectorAll('.tipologia-checkbox input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
        cb.closest('.tipologia-checkbox').classList.remove('checked');
    });

    // Reset filtri geografici
    resetGeoFilters();
    
    const primaryColor = document.getElementById('primary-color');
    if (primaryColor) primaryColor.value = '#3b82f6';
    
    const primaryGradient = document.getElementById('primary-color-gradient');
    if (primaryGradient) primaryGradient.value = '#3b82f6';
    
    const secondaryColor = document.getElementById('secondary-color');
    if (secondaryColor) secondaryColor.value = '#8b5cf6';
    
    const textColor = document.getElementById('text-color');
    if (textColor) textColor.value = '#1f2937';
    
    hideMixedControls();
    applyStylePreset('default');
    
    if (customChart) {
        customChart.destroy();
        customChart = null;
    }
    
    const wrapper = document.getElementById('chart-wrapper-custom');
    const placeholder = document.querySelector('.preview-placeholder');
    if (wrapper) wrapper.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
}

async function downloadCustomChart() {
    if (!customChart) {
        alert('⚠️ Genera prima un grafico da scaricare');
        return;
    }
    
    const canvas = document.getElementById('custom-chart-canvas');
    if (!canvas) return;
    
    const targetWidth = 800;
    const originalRatio = canvas.height / canvas.width;
    const targetHeight = Math.max(Math.round(targetWidth * originalRatio), 600);
    
    const headerHeight = 100;
    const footerHeight = 70;
    const chartAreaHeight = targetHeight - headerHeight - footerHeight;
    
    const finalCanvas = document.createElement('canvas');
    const ctx = finalCanvas.getContext('2d');
    
    finalCanvas.width = targetWidth;
    finalCanvas.height = targetHeight;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    
    const textColor = customChartConfig.colors.text;
    ctx.fillStyle = textColor;
    ctx.font = 'bold 22px Titillium Web, Arial, sans-serif';
    ctx.textAlign = 'left';
    
    const baseTitle = customChartConfig.customTitle || customChartConfig.dimension || 'Grafico Analytics';
    let downloadTitle = baseTitle;
    
    const filters = [];
    const tipoNames = { 
        M: 'Mortali', 
        R: 'Riserva', 
        F: 'Feriti', 
        C: 'Cose' 
    };
    
    if (typeof currentFilters !== 'undefined' && currentFilters) {
        Object.entries(currentFilters).forEach(([key, value]) => {
            if (value && value !== '') {
                if (key === 'filter-tipologia' && tipoNames[value]) {
                    filters.push(tipoNames[value]);
                } else {
                    const isDimensionValue = value === customChartConfig.dimension;
                    if (!isDimensionValue) {
                        filters.push(value);
                    }
                }
            }
        });
    }
    
    const uniqueFilters = [...new Set(filters)];
    
    if (uniqueFilters.length > 0) {
        downloadTitle += ' - ' + uniqueFilters.join(' • ');
    }
    
    ctx.fillText(downloadTitle, 40, 35);
    
    ctx.font = '13px Titillium Web, Arial, sans-serif';
    const activeFilters = document.getElementById('custom-chart-filters');
    let filtersText = 'Chart Builder - Grafico Personalizzato';
    
    if (activeFilters) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = activeFilters.innerHTML;
        filtersText = tempDiv.textContent || tempDiv.innerText || '';
        filtersText = filtersText.replace(/\(\d+\.?\d*\)/g, '').trim();
    }
    
    const lines = wrapText(ctx, filtersText, targetWidth - 80, 13);
    lines.forEach((line, index) => {
        ctx.fillText(line, 40, 60 + (index * 18));
    });
    
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, headerHeight - 15);
    ctx.lineTo(targetWidth - 40, headerHeight - 15);
    ctx.stroke();
    
    const chartCanvas = document.createElement('canvas');
    const chartWidth = targetWidth - 80;
    const chartHeight = chartAreaHeight;
    
    chartCanvas.width = chartWidth;
    chartCanvas.height = chartHeight;
    
    const chartCtx = chartCanvas.getContext('2d');
    chartCtx.fillStyle = '#FFFFFF';
    chartCtx.fillRect(0, 0, chartWidth, chartHeight);
    chartCtx.drawImage(canvas, 0, 0, chartWidth, chartHeight);
    
    ctx.drawImage(chartCanvas, 40, headerHeight);
    
    ctx.strokeStyle = '#d1d5db';
    ctx.beginPath();
    ctx.moveTo(40, targetHeight - footerHeight + 10);
    ctx.lineTo(targetWidth - 40, targetHeight - footerHeight + 10);
    ctx.stroke();
    
    ctx.font = '11px Titillium Web, Arial, sans-serif';
    ctx.fillStyle = textColor;
    ctx.fillText('Fonte: anticorruzione.it (ANAC) - Rielaborazione: opendatasicilia.it', 40, targetHeight - 40);
    ctx.fillText('palermohub.opendatasicilia.it', 40, targetHeight - 20);
    
    try {
        const logo = new Image();
        logo.crossOrigin = 'anonymous';
        await new Promise((resolve) => {
            logo.onload = resolve;
            logo.onerror = resolve;
            logo.src = 'img/pa_hub_new.png';
        });
        
        if (logo.complete && logo.naturalWidth > 0) {
            const logoWidth = 100;
            const logoHeight = (logoWidth * logo.naturalHeight) / logo.naturalWidth;
            ctx.drawImage(logo, targetWidth - logoWidth - 40, targetHeight - footerHeight + 15, logoWidth, logoHeight);
        }
    } catch (e) {}
    
    const dataURL = finalCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    const safeFilename = (customChartConfig.customTitle || customChartConfig.dimension || 'grafico').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `${safeFilename}_${targetWidth}x${targetHeight}.png`;
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function wrapText(ctx, text, maxWidth, fontSize) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];
    
    ctx.font = `${fontSize}px Titillium Web`;
    
    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}