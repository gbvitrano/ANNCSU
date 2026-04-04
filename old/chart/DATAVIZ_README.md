# 📊 ANNCSU Chart Builder - Guida al Testing

Questa è una guida per testare il nuovo pulsante **"Crea il tuo DataViz"** nei file clonati.

## 📁 File Clonati

Tutti i file originali rimangono intatti. I file clone sono:

```
├── index_dataviz.html                 ← Clone di index.html con Chart Builder
├── js/
│   ├── anncsu_dataviz.js             ← Espone i dati per il Chart Builder
│   └── chart-builder-anncsu.js       ← Logica del Chart Builder
├── css/
│   └── chart-builder.css             ← Stili del Chart Builder
└── DATAVIZ_README.md                 ← Questo file
```

## 🚀 Come Testare

### Opzione 1: Con la mappa reale (index_dataviz.html)
```bash
# Apri nel browser:
file:///d:/GitHub%20-%20Clone/gbvitrano/ANNCSU/index_dataviz.html
```

1. La pagina carica completamente la mappa ANNCSU
2. Clicca il pulsante **"Crea il tuo DataViz"** in basso a destra
3. Seleziona:
   - **Tipo grafico**: Barre, Linea, Torta, Ciambella
   - **Raggruppa per**: Regione, Provincia, Tipo
   - Clicca **"Genera Grafico"**
4. Il grafico si aggiorna in tempo reale
5. Scarica come PNG con il bottone **"PNG"**

### Opzione 2: Con dati mock (testing senza mappa)
Se la mappa ha lentezza o errori, i dati mock forniscono 200 civici finti distribuiti su 10 regioni.

```javascript
// Nel browser console:
console.log(window.ANNCSUDataViz);
// Mostra: { features: [...], stats: {...} }
```

## 🔧 Come Funziona

### Flusso dati:
```
anncsu_dataviz.js (espone dati)
    ├─ loadComuniData()           → comuni.csv
    ├─ loadAnncsuStats()          → anncsu_stats.json
    ├─ loadAggiudicatoriData()    → aggiudicatori.csv
    └─ updateDataVizStore()       → aggregazione
         ↓
window.ANNCSUDataViz.{
  features,
  stats: { regioni, province, comuni, tipi },
  comuniMap,                    // { codiceIstat → nome, provincia, regione, sigla }
  anncsuStats,                  // { codiceIstat → civico_geocodificato, fuori_confine... }
  aggiudicatoriMap,             // COMPLETO: denominazione → importi, comuni, regioni, entries
  comuniAggiudicatoriMap,       // { codiceIstat → aggiudicatore }
  comuniDetailMap               // NUOVO: { codiceIstat → aggiudicatore + entries completi }
}
    ↓
chart-builder-anncsu.js (aggregateData per dimensione)
    ↓
Chart.js (visualizza)
```

### Struttura di un feature:
```javascript
{
  id: 1,
  type: 'Feature',
  geometry: {
    type: 'Point',
    coordinates: [lng, lat]
  },
  properties: {
    CODICE_ISTAT: '015146',
    regione: 'Sicilia',
    provincia: 'PA',
    tipo: 'ok'  // o 'err'
    civico: 'Via Roma 1'
  }
}
```

## 📊 Funzionalità Implementate

✅ Pulsante trigger con animazione pulse
✅ Modal responsive (desktop, tablet, mobile)
✅ Selezione tipo grafico (4 tipi)
✅ Selezione dimensione (4 dimensioni: regione, provincia, **comune**, tipo)
✅ Generazione grafico in tempo reale
✅ Download PNG
✅ **Salvataggio grafici** (localStorage)
✅ **Gestione più grafici**
✅ Reset configurazione
✅ Dark/light theme support
✅ Statistiche footer (conteggio + percentuale qualità)
✅ **Dati dei comuni** (nome, provincia, regione)
✅ **Statistiche ANNCSU** (civici geocodificati vs fuori confine)

## 🎨 Dimensioni Disponibili

| Dimensione | Dettagli | Dati |
|-----------|----------|------|
| **Regione** | Aggrega per regione (OK vs ERR) | Features + mapping |
| **Provincia** | Aggrega per provincia (OK vs ERR) | Features + mapping |
| **Comune** | Aggrega per comune (OK vs ERR) | **comuni.csv + anncsu_stats.json** |
| **Aggiudicatore PNRR** | Civici per aggiudicatore PNRR | **aggiudicatori.csv + comuni** |
| **Tipo** | OK vs ERR nazionale | Features (conteggio globale) |

## 📈 Tipi di Grafico

| Tipo | Uso |
|------|-----|
| **Barre** | Confronto categorie (default) |
| **Linea** | Trend nel tempo |
| **Torta** | Proporzioni globali |
| **Ciambella** | Proporzioni con buco centrale |

## 🐛 Debug

### Controllare TUTTI i dati esposti:

```javascript
// === CIVICI ===
window.ANNCSUDataViz.features              // Array di features GeoJSON

// === STATISTICHE CIVICI ===
window.ANNCSUDataViz.stats                 // Tutte le statistiche aggregate
window.ANNCSUDataViz.stats.regioni         // Per regione (OK/ERR)
window.ANNCSUDataViz.stats.province        // Per provincia (OK/ERR)
window.ANNCSUDataViz.stats.comuni          // Per comune (OK/ERR)
window.ANNCSUDataViz.stats.tipi            // Globale { ok: n, err: n }

// === ANAGRAFE COMUNI ===
window.ANNCSUDataViz.comuniMap             // { codiceIstat → nome, provincia, regione, sigla }

// === STATISTICHE ANNCSU ===
window.ANNCSUDataViz.anncsuStats           // { codiceIstat → civico_geocodificato, fuori_confine... }

// === AGGIUDICATORI PNRR (COMPLETI) ===
window.ANNCSUDataViz.aggiudicatoriMap      // { denominazione → importi, comuni, regioni, entries[] }
Object.keys(window.ANNCSUDataViz.aggiudicatoriMap)  // Lista aggiudicatori
window.ANNCSUDataViz.aggiudicatoriMap['POSTE ITALIANE SPA']  // Dettagli singolo aggiudicatore

// === MAPPING COMUNI ↔ AGGIUDICATORI ===
window.ANNCSUDataViz.comuniAggiudicatoriMap         // { codiceIstat → aggiudicatore }
window.ANNCSUDataViz.comuniDetailMap                // { codiceIstat → aggiudicatore + entries completi }

// === STATISTICHE GLOBALI ===
Object.keys(window.ANNCSUDataViz.aggiudicatoriMap).length      // Numero aggiudicatori
Object.keys(window.ANNCSUDataViz.comuniDetailMap).length       // Comuni con aggiudicatori
```

### Verificare il caricamento:
```javascript
// Dovresti vedere in console:
// ✅ ANNCSU DataViz module loaded
// 📊 DataViz Store aggiornato: {...}
```

### Rigenerare i dati mock:
```javascript
// Browser console:
updateDataVizStore();
console.log(window.ANNCSUDataViz);
```

## ⚙️ Personalizzazioni Possibili

### Aggiungere più dimensioni:

**1. Nel file `aggregateData()` di `chart-builder-anncsu.js`:**
```javascript
case 'nuova_dimensione':
  // Aggrega i dati per questa dimensione
  const newData = {};
  Object.keys(stats.comuni || {}).forEach(nomeComune => {
    // Logica di aggregazione
  });
  return newData;
```

**2. Nel selettore HTML `index_dataviz.html`:**
```html
<option value="nuova_dimensione">Nuova Dimensione</option>
```

**3. Esempio: Aggiungere "Sigla Provincia"**
```javascript
case 'sigla_provincia':
  const siglaData = {};
  Object.keys(stats.province || {}).forEach(prov => {
    const comune = stats.comuni[Object.keys(stats.comuni)[0]];
    const sigla = comuniMap[comune.codiceIstat]?.sigla || prov;
    if (!siglaData[sigla]) siglaData[sigla] = { ok: 0, err: 0, total: 0 };
    siglaData[sigla].ok += stats.province[prov].ok;
    siglaData[sigla].err += stats.province[prov].err;
    siglaData[sigla].total += stats.province[prov].total;
  });
  return siglaData;
```

### Aggiungere più tipi di grafico:
```html
<button class="chart-type-btn" data-type="mixed">
  <i class="fas fa-layer-group"></i>
  <span>Mixed</span>
</button>
```

## 🔄 Prossimi Passi

Una volta testato e approvato, integrare in `index.html` originale:

```bash
# 1. Copia i file
cp js/chart-builder-anncsu.js js/chart-builder.js
cp js/anncsu_dataviz.js js/anncsu-dataviz-bridge.js
cp css/chart-builder.css css/

# 2. Aggiorna index.html con:
# - Script dipendenze (Chart.js, Font Awesome)
# - Pulsante trigger
# - Modal HTML
# - Link ai script

# 3. Test finale
```

## 📞 Supporto

Se qualcosa non funziona:

1. Verifica in console che `window.ANNCSUDataViz` sia popolato
2. Controlla che anncsu_dataviz.js sia caricato prima di chart-builder-anncsu.js
3. Verifica l'ordine degli script in index_dataviz.html
4. Prova con dati mock disabilitando la mappa

---

**Versione**: 1.0 Clone  
**Data**: 2026-04-03  
**Stato**: Pronto per testing
