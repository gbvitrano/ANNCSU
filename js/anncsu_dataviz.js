// ============================================
// ANNCSU DATAVIZ - Clone per Chart Builder
// Importa anncsu.js originale e espone i dati
// Incluso: comuni, province, regioni, stats
// ============================================

// anncsu.js è già caricato direttamente dall'HTML, non duplicarlo qui

// ============================================
// GLOBAL DATA STORE PER CHART BUILDER
// ============================================

window.ANNCSUDataViz = {
  features: [],
  stats: {},
  provinces: {},
  regions: {},
  comuni: {},
  comuniMap: {}, // { codiceIstat → { nome, provincia, regione, ... } }
  anncsuStats: {}, // { codiceIstat → { civico_geocodificato, fuori_limite_comunale, ... } }
  savedCharts: [] // Salva più grafici
};

/**
 * Carica i dati dei comuni da comuni.csv
 */
async function loadComuniData() {
  try {
    const res = await fetch('dati/comuni.csv');
    const csv = await res.text();
    const lines = csv.split('\n');
    const headers = lines[0].split(',');

    const comuniMap = {};

    lines.slice(1).forEach(line => {
      if (!line.trim()) return;
      const cols = line.split(',');
      // Normalizza a 6 cifre (comuni.csv usa "81001", anncsu_stats usa "081001")
      const proComT = cols[headers.indexOf('pro_com_t')]?.trim().padStart(6, '0');
      const nome  = cols[headers.indexOf('comune')]?.trim();
      const prov  = cols[headers.indexOf('den_prov')]?.trim();
      const uts   = cols[headers.indexOf('den_uts')]?.trim();   // Città metropolitana
      const reg   = cols[headers.indexOf('den_reg')]?.trim();
      const sigla = cols[headers.indexOf('sigla')]?.trim();

      // den_prov è '-' per i comuni di Città metropolitana → usa den_uts
      const provincia = (prov && prov !== '-') ? prov : (uts || 'N/A');

      if (proComT && nome) {
        comuniMap[proComT] = {
          codiceIstat: proComT,
          nome,
          provincia,
          regione: reg || 'N/A',
          sigla: sigla || 'XX'
        };
      }
    });

    window.ANNCSUDataViz.comuniMap = comuniMap;
    console.log('✅ Comuni caricati:', Object.keys(comuniMap).length);
    return comuniMap;
  } catch (e) {
    console.warn('Errore nel caricamento comuni:', e);
    return {};
  }
}

/**
 * Carica le statistiche ANNCSU da anncsu_stats.csv
 * Colonne: CODICE_ISTAT, civico_geocodificato, fuori_limite_comunale, totale, civici_da_altri_comuni
 * Ogni riga: un comune con conteggi pre-aggregati
 */
async function loadAnncsuStats() {
  try {
    const res = await fetch('dati/anncsu_stats.csv');
    const csv = await res.text();
    const lines = csv.split('\n');
    const headers = lines[0].split(',').map(h => h.trim());

    const iCodice = headers.indexOf('CODICE_ISTAT');
    const iOk     = headers.indexOf('civico_geocodificato');
    const iErr    = headers.indexOf('fuori_limite_comunale');
    const iTot    = headers.indexOf('totale');
    const iAltri  = headers.indexOf('civici_da_altri_comuni');

    const statsMap = {};
    let totalCivici = 0, totalOk = 0, totalErr = 0;

    lines.slice(1).forEach(line => {
      if (!line.trim()) return;
      const cols = line.split(',');
      const codice = cols[iCodice]?.trim();
      if (!codice) return;

      const ok  = parseInt(cols[iOk]  || 0, 10);
      const err = parseInt(cols[iErr] || 0, 10);
      const tot = parseInt(cols[iTot] || 0, 10);

      statsMap[codice] = {
        civico_geocodificato:   ok,
        fuori_limite_comunale:  err,
        totale:                 tot,
        civici_da_altri_comuni: parseInt(cols[iAltri] || 0, 10)
      };
      totalCivici += tot;
      totalOk     += ok;
      totalErr    += err;
    });

    window.ANNCSUDataViz.anncsuStats = statsMap;

    window.ANNCSUDataViz.globalStats = {
      totalCivici,
      totalOk,
      totalErr,
      okPercentage: totalCivici > 0 ? ((totalOk / totalCivici) * 100).toFixed(2) : '0.00',
      numComuni: Object.keys(statsMap).length
    };

    console.log('✅ Statistiche ANNCSU caricate:', Object.keys(statsMap).length,
                '| Totale civici:', totalCivici.toLocaleString('it-IT'));
    return statsMap;
  } catch (e) {
    console.warn('Errore nel caricamento statistiche:', e);
    return {};
  }
}

/**
 * Carica TUTTI i dati degli aggiudicatori PNRR da aggiudicatori.csv
 */
async function loadAggiudicatoriData() {
  try {
    const res = await fetch('dati/aggiudicatori.csv');
    const csv = await res.text();
    const lines = csv.split('\n');
    const headers = lines[0].split(',');

    // Mappa: denominazione → dati aggregati
    const aggiudicatoriMap = {};
    // Mappa: codiceIstat → aggiudicatore (denominazione)
    const comuniAggiudicatoriMap = {};
    // Mappa: codiceIstat → dati completi riga aggiudicatori
    const comuniDetailMap = {};
    // Array piatto: tutte le righe grezze (una per contratto CSV)
    const aggiudicatoriRows = [];

    lines.slice(1).forEach(line => {
      if (!line.trim()) return;
      const cols = line.split(',');

      // Estrai TUTTI i campi
      const codicEIpa = cols[headers.indexOf('codice_ipa')]?.trim();
      const ente = cols[headers.indexOf('ente')]?.trim();
      const tipologiaEnte = cols[headers.indexOf('tipologia_ente')]?.trim();
      const comune = cols[headers.indexOf('comune')]?.trim();
      const codComune = cols[headers.indexOf('cod_comune')]?.trim();
      const provincia = cols[headers.indexOf('provincia')]?.trim();
      const codProvincia = cols[headers.indexOf('cod_provincia')]?.trim();
      const regione = cols[headers.indexOf('regione')]?.trim();
      const codRegione = cols[headers.indexOf('cod_regione')]?.trim();
      const importoFinanziamento = parseFloat(cols[headers.indexOf('importo_finanziamento')] || 0);
      const avviso = cols[headers.indexOf('avviso')]?.trim();
      const dataInvioCandidatura = cols[headers.indexOf('data_invio_candidatura')]?.trim();
      const dataFinanziamento = cols[headers.indexOf('data_finanziamento')]?.trim();
      const codiceCup = cols[headers.indexOf('codice_cup')]?.trim();
      const numeroFinestra = cols[headers.indexOf('numero_finestra_temporale')]?.trim();
      const numeroProtocollo = cols[headers.indexOf('numero_di_protocollo')]?.trim();
      const decretoFinanziamento = cols[headers.indexOf('decreto_finanziamento')]?.trim();
      const statoCandidatura = cols[headers.indexOf('stato_candidatura')]?.trim();
      const dataStatoCandidatura = cols[headers.indexOf('data_stato_candidatura')]?.trim();
      const misura = cols[headers.indexOf('misura')]?.trim();
      const cig = cols[headers.indexOf('CIG')]?.trim();
      const denominazione = cols[headers.indexOf('denominazione')]?.trim();
      const codiceFiscale = cols[headers.indexOf('codice_fiscale')]?.trim();
      const ruolo = cols[headers.indexOf('ruolo')]?.trim();
      const importoAggiudicazione = parseFloat(cols[headers.indexOf('importo_aggiudicazione')] || 0);

      if (denominazione && codComune) {
        // Salva la riga grezza per il Chart Builder (flat array)
        aggiudicatoriRows.push({
          denominazione:      denominazione   || 'N/D',
          ente:               ente            || 'N/D',
          tipologiaEnte:      tipologiaEnte   || 'N/D',
          comune:             comune          || 'N/D',
          codComune,
          provincia:          provincia       || 'N/D',
          regione:            regione         || 'N/D',
          importoFinanziamento,
          importoAggiudicazione,
          avviso:             avviso          || 'N/D',
          statoCandidatura:   statoCandidatura || 'N/D',
          misura:             misura          || 'N/D',
          ruolo:              ruolo           || 'N/D'
        });

        // Mappa aggiudicatore → dati aggregati
        if (!aggiudicatoriMap[denominazione]) {
          aggiudicatoriMap[denominazione] = {
            denominazione,
            codiceFiscale,
            ruolo,
            importoTotaleFinanziamento: 0,
            importoTotaleAggiudicazione: 0,
            numComuni: new Set(),
            comuni: [],
            regioni: new Set(),
            province: new Set(),
            entries: []
          };
        }

        aggiudicatoriMap[denominazione].importoTotaleFinanziamento += importoFinanziamento;
        aggiudicatoriMap[denominazione].importoTotaleAggiudicazione += importoAggiudicazione;
        aggiudicatoriMap[denominazione].numComuni.add(codComune);
        if (regione) aggiudicatoriMap[denominazione].regioni.add(regione);
        if (provincia) aggiudicatoriMap[denominazione].province.add(provincia);

        // Aggiungi l'entry completa
        aggiudicatoriMap[denominazione].entries.push({
          codiceIpa: codicEIpa,
          ente,
          tipologiaEnte,
          comune,
          codComune,
          provincia,
          codProvincia,
          regione,
          codRegione,
          importoFinanziamento,
          avviso,
          dataInvioCandidatura,
          dataFinanziamento,
          codiceCup,
          numeroFinestra,
          numeroProtocollo,
          decretoFinanziamento,
          statoCandidatura,
          dataStatoCandidatura,
          misura,
          cig,
          denominazione,
          codiceFiscale,
          ruolo,
          importoAggiudicazione
        });

        // Mappa comune → aggiudicatore
        comuniAggiudicatoriMap[codComune] = denominazione;

        // Mappa comune → dettagli completi
        if (!comuniDetailMap[codComune]) {
          comuniDetailMap[codComune] = {
            aggiudicatore: denominazione,
            entries: []
          };
        }
        comuniDetailMap[codComune].entries.push({
          codiceFiscale,
          denominazione,
          importoFinanziamento,
          importoAggiudicazione,
          statoCandidatura,
          dataStatoCandidatura,
          cig,
          ruolo
        });
      }
    });

    // Converti Set in array per JSON
    Object.keys(aggiudicatoriMap).forEach(key => {
      aggiudicatoriMap[key].numComuni = aggiudicatoriMap[key].numComuni.size;
      aggiudicatoriMap[key].regioni = Array.from(aggiudicatoriMap[key].regioni);
      aggiudicatoriMap[key].province = Array.from(aggiudicatoriMap[key].province);
    });

    window.ANNCSUDataViz.aggiudicatoriMap = aggiudicatoriMap;
    window.ANNCSUDataViz.comuniAggiudicatoriMap = comuniAggiudicatoriMap;
    window.ANNCSUDataViz.comuniDetailMap = comuniDetailMap;
    window.ANNCSUDataViz.aggiudicatoriRows = aggiudicatoriRows;

    console.log('✅ Aggiudicatori PNRR caricati:', Object.keys(aggiudicatoriMap).length);
    console.log('📊 Comuni con aggiudicatori:', Object.keys(comuniDetailMap).length);

    return { aggiudicatoriMap, comuniAggiudicatoriMap, comuniDetailMap };
  } catch (e) {
    console.warn('Errore nel caricamento aggiudicatori:', e);
    return {};
  }
}

/**
 * Estrae i features visibili dalla mappa
 */
function getMapFeatures() {
  try {
    if (window.map && window.map.querySourceFeatures) {
      const features = window.map.querySourceFeatures('anncsu', { sourceLayer: 'addresses' });
      return features || [];
    }
  } catch (e) {
    console.warn('Errore nel recupero features:', e);
  }

  return generateMockFeatures();
}

/**
 * Genera dati mock per testare
 */
function generateMockFeatures() {
  const regioni = [
    'Sicilia', 'Campania', 'Lazio', 'Lombardia', 'Emilia-Romagna',
    'Toscana', 'Veneto', 'Piemonte', 'Puglia', 'Calabria'
  ];

  const province = {
    'Sicilia': ['PA', 'CT', 'ME', 'AG'],
    'Campania': ['NA', 'SA', 'BN', 'CE'],
    'Lazio': ['RM', 'LT', 'FR'],
    'Lombardia': ['MI', 'BG', 'BS', 'CO'],
    'Emilia-Romagna': ['BO', 'MO', 'RE', 'PR'],
    'Toscana': ['FI', 'PI', 'AR', 'LI'],
    'Veneto': ['VE', 'VR', 'PD', 'TV'],
    'Piemonte': ['TO', 'AL', 'AT', 'NO'],
    'Puglia': ['BA', 'LE', 'TA', 'BR'],
    'Calabria': ['CS', 'CZ', 'KR', 'RC']
  };

  const features = [];
  let id = 1;

  regioni.forEach(regione => {
    const provArray = province[regione] || [];

    for (let i = 0; i < 20; i++) {
      const prov = provArray[Math.floor(Math.random() * provArray.length)] || 'XX';
      const isOk = Math.random() > 0.15;

      features.push({
        id: id++,
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            12.5 + (Math.random() - 0.5) * 10,
            42.0 + (Math.random() - 0.5) * 10
          ]
        },
        properties: {
          CODICE_ISTAT: `${String(Math.floor(Math.random() * 999)).padStart(3, '0')}${String(Math.floor(Math.random() * 99)).padStart(2, '0')}0`,
          regione,
          provincia: prov,
          tipo: isOk ? 'ok' : 'err',
          civico: `Via Roma ${i + 1}`
        }
      });
    }
  });

  return features;
}

/**
 * Aggiorna i dati esposti per il chart builder
 */
function updateDataVizStore() {
  const features = getMapFeatures();
  window.ANNCSUDataViz.features = features;

  const regioni = {};
  const province = {};
  const comuni = {};
  const tipi = { ok: 0, err: 0 };

  features.forEach(f => {
    const props = f.properties || {};
    const regione = props.regione || 'N/A';
    const provincia = props.provincia || 'N/A';
    const codiceIstat = props.CODICE_ISTAT || 'N/A';
    const tipo = props.tipo || 'err';

    // Per regione
    if (!regioni[regione]) {
      regioni[regione] = { ok: 0, err: 0, total: 0 };
    }
    regioni[regione][tipo]++;
    regioni[regione].total++;

    // Per provincia
    if (!province[provincia]) {
      province[provincia] = { ok: 0, err: 0, total: 0, regione };
    }
    province[provincia][tipo]++;
    province[provincia].total++;

    // Per comune
    const comuneInfo = window.ANNCSUDataViz.comuniMap[codiceIstat];
    const nomeComune = comuneInfo?.nome || codiceIstat;
    if (!comuni[nomeComune]) {
      comuni[nomeComune] = {
        ok: 0,
        err: 0,
        total: 0,
        codiceIstat,
        provincia,
        regione
      };
    }
    comuni[nomeComune][tipo]++;
    comuni[nomeComune].total++;

    tipi[tipo]++;
  });

  window.ANNCSUDataViz.stats = {
    regioni,
    province,
    comuni,
    tipi,
    total: features.length,
    okPercentage: features.length > 0
      ? ((tipi.ok / features.length) * 100).toFixed(2)
      : 0
  };

  console.log('📊 DataViz Store aggiornato:', window.ANNCSUDataViz.stats);
  return window.ANNCSUDataViz;
}

/**
 * Ascolta gli aggiornamenti della mappa
 */
function initDataVizListener() {
  if (!window.map) return;

  window.map.on('data', updateDataVizStore);
  window.map.on('render', updateDataVizStore);

  setTimeout(updateDataVizStore, 1000);
}

/**
 * Getter per Chart Builder
 */
window.getChartBuilderData = function() {
  return window.ANNCSUDataViz;
};

/**
 * Getter per features
 */
window.getMapFeaturesForChart = function() {
  return window.ANNCSUDataViz.features || getMapFeatures();
};

/**
 * Costruisce array piatto arricchito – usato dal Chart Builder.
 * BASE: anncsu_stats.json  (una riga per comune con totale civici, ok, err)
 * CROSS: comuni.csv        (nome, provincia, regione)
 *        aggiudicatori.csv (denominazione aggiudicatore per quel comune)
 *
 * Ogni riga:
 *   { CODICE_ISTAT, comune, provincia, regione, aggiudicatore,
 *     totale, ok, err, civici_da_altri_comuni }
 */
function buildEnrichedFeatures() {
  const anncsuStats          = window.ANNCSUDataViz.anncsuStats          || {};
  const comuniMap            = window.ANNCSUDataViz.comuniMap            || {};
  const comuniAggiudicatoriMap = window.ANNCSUDataViz.comuniAggiudicatoriMap || {};

  return Object.entries(anncsuStats).map(([codiceIstat, stats]) => {
    const comuneInfo    = comuniMap[codiceIstat]            || {};
    const aggiudicatore = comuniAggiudicatoriMap[codiceIstat] || 'N/D';

    return {
      CODICE_ISTAT:          codiceIstat,
      comune:                comuneInfo.nome      || codiceIstat,
      provincia:             comuneInfo.provincia || 'N/A',   // nome esteso (es. "Palermo")
      regione:               comuneInfo.regione   || 'N/A',
      aggiudicatore,
      totale:                stats.totale                || 0,
      ok:                    stats.civico_geocodificato  || 0,
      err:                   stats.fuori_limite_comunale || 0,
      civici_da_altri_comuni: stats.civici_da_altri_comuni || 0
    };
  });
}

/**
 * Restituisce l'array piatto arricchito per il Chart Builder.
 * Equivalente a getFilteredData() in Palermo-Incidenti.
 */
window.getANNCSUData = function() {
  return buildEnrichedFeatures();
};

/**
 * Restituisce l'array piatto delle righe aggiudicatori (una per contratto CSV).
 * Campi: denominazione, ente, tipologiaEnte, comune, provincia, regione,
 *        importoFinanziamento, importoAggiudicazione, avviso,
 *        statoCandidatura, misura, ruolo
 */
window.getAggiudicatoriData = function() {
  return window.ANNCSUDataViz.aggiudicatoriRows || [];
};

/**
 * Salva il grafico corrente
 */
window.saveChart = function(config, imageData) {
  const chart = {
    id: Date.now(),
    timestamp: new Date().toLocaleString('it-IT'),
    config: { ...config },
    imageData
  };
  window.ANNCSUDataViz.savedCharts.push(chart);
  localStorage.setItem('anncsuSavedCharts', JSON.stringify(window.ANNCSUDataViz.savedCharts));
  console.log('💾 Grafico salvato:', chart.id);
  return chart;
};

/**
 * Carica i grafici salvati
 */
window.loadSavedCharts = function() {
  try {
    const saved = localStorage.getItem('anncsuSavedCharts');
    if (saved) {
      window.ANNCSUDataViz.savedCharts = JSON.parse(saved);
      console.log('📂 Grafici salvati caricati:', window.ANNCSUDataViz.savedCharts.length);
    }
  } catch (e) {
    console.warn('Errore nel caricamento grafici salvati:', e);
  }
};

/**
 * Inizializzazione — ogni load ha il proprio try/catch,
 * così un fallimento non blocca i successivi.
 */
async function initDataViz() {
  await loadComuniData();
  await loadAnncsuStats();
  await loadAggiudicatoriData();
  updateDataVizStore();
  initDataVizListener();
  window.loadSavedCharts();
  console.log('✅ ANNCSU DataViz pronto — comuni:', Object.keys(window.ANNCSUDataViz.anncsuStats).length);
}

// Avvia subito (i fetch funzionano senza attendere DOMContentLoaded)
initDataViz();

console.log('✅ ANNCSU DataViz module loaded');
