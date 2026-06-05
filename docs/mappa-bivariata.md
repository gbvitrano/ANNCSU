# Mappa Bivariate: Qualità Civici vs Densità

## Obiettivo

Evidenziare, a livello comunale, **dove il dato mancante o errato di ANNCSU ha il maggiore impatto reale** sulla qualità dei servizi che dipendono dalla geocodifica degli indirizzi.

Un comune con pochi civici geocodificati male in una zona rurale disabitata ha un impatto pratico basso. Lo stesso tasso di errore in un comune densamente urbanizzato rappresenta un problema molto più grave. La mappa bivariate mette insieme queste due dimensioni in un'unica visualizzazione.

---

## Le due dimensioni

### Asse X — Qualità reale della geocodifica

**Formula:**

```
qualità = max(0, civico_geocodificato − punti_in_cluster_hotspot) / totale
```

**Dati usati:**

| Campo | Sorgente | Descrizione |
|-------|----------|-------------|
| `civico_geocodificato` | `dati/anncsu_stats.json` | Civici con coordinata dentro il confine comunale |
| `totale` | `dati/anncsu_stats.json` | Totale civici del comune nel dataset ANNCSU |
| `punti_in_cluster` | `anncsu_dbscan_hotspots.json` (mfortini/diff_ANNCSU) | Civici rilevati come hotspot DBSCAN |

**Perché sottrarre gli hotspot:**

Il campo `civico_geocodificato` conta tutti i civici con coordinata topologicamente dentro il confine comunale. Include però i **falsi positivi**: civici a cui il geocoder non ha trovato la posizione esatta e ha assegnato una coordinata di fallback (centroide del comune, centroide della via, posizione del municipio). Questi punti cadono dentro il confine ma sono inutilizzabili — decine o centinaia di indirizzi diversi condividono la stessa coordinata.

Il dataset DBSCAN di mfortini/diff_ANNCSU rileva questi cluster con i parametri `eps = 8 m`, `min_points = 5`: se almeno 5 civici si trovano entro 8 metri l'uno dall'altro, sono considerati un hotspot di geocodifica fallback.

**Sorgente hotspot:**
```
https://mfortini.github.io/diff_ANNCSU/quality/_file/data/anncsu_dbscan_hotspots.{hash}.json
```
Struttura JSON: `{ by_comune: [{ codice_istat, n_cluster, max_point_count, punti_in_cluster }] }`

> **Nota:** L'URL contiene un hash di contenuto generato da Observable Framework. Va aggiornato quando mfortini rigenera i dati. Se il file non è raggiungibile, la mappa usa automaticamente `civico_geocodificato / totale` senza correzione (etichetta legenda: "% geocodificati").

---

### Asse Y — Densità civici per km²

**Formula:**

```
densità = totale_civici / area_km2
```

dove `area_km2` è normalizzata in fase di caricamento da `comuni.csv`:

```javascript
// shape_area presenta due scale diverse nel CSV ISTAT:
// valori >= 1e10 sono in unità ~dm² (1000× gonfiate) — 1.049 comuni
// valori <  1e10 sono in m² standard — 4.058 comuni
area_km2 = shape_area >= 1e10 ? shape_area / 1e9 : shape_area / 1e6;
```

**Dati usati:**

| Campo | Sorgente | Descrizione |
|-------|----------|-------------|
| `totale` | `dati/anncsu_stats.json` | Totale civici del comune |
| `shape_area` | `dati/comuni.csv` | Superficie comunale (ISTAT/ANPR) — scala eterogenea, vedi nota |

**Proxy per densità abitativa:**

Il dataset non contiene dati di popolazione. Il numero di civici per km² è un proxy efficace per l'urbanizzazione: i comuni densamente abitati hanno molti più indirizzi per unità di superficie rispetto ai comuni rurali o montani. La correlazione con la densità di popolazione reale è alta nei contesti italiani.

---

## Classificazione — Terzili quantile

Entrambe le dimensioni vengono classificate in **3 classi** (bassa / media / alta) usando i **terzili della distribuzione reale** dei comuni presenti in `anncsu_stats.json` (~5.107 comuni con dati ANNCSU disponibili, non tutti i 7.918 comuni italiani).

```javascript
function quantileBreaks(values, n) {
  const sorted = [...values].sort((a, b) => a - b);
  return Array.from({ length: n - 1 }, (_, i) =>
    sorted[Math.floor((i + 1) * sorted.length / n)]
  );
}
```

**Valori reali dei terzili** (calcolati sul dataset corrente con hotspot DBSCAN):

| Asse | Soglia bassa→media (qB1) | Soglia media→alta (qB2) |
|------|--------------------------|-------------------------|
| Qualità geocodifica | **72,7%** | **95,1%** |
| Densità civici/km² | **45 civ/km²** | **114 civ/km²** |

**Perché quantili e non intervalli uguali:**

La distribuzione della densità urbana in Italia è fortemente asimmetrica. Roma e Milano hanno densità di civici 100× superiore a un comune alpino. Con intervalli uguali il 99% dei comuni finirebbe nel bucket "basso", rendendo la classificazione inutile. I terzili garantiscono che ogni classe contenga circa ⅓ dei comuni.

---

## Palette cromatica — Joshua Stevens 3×3

La palette è derivata dalla metodologia bivariate di **Joshua Stevens** (2015), progettata per massimizzare la distinguibilità percettiva delle 9 combinazioni.

```
               Qualità: Bassa    Media    Alta
Densità Alta:  #be64ac  #8c62aa  #3b4994   ← viola → blu scuro
Densità Media: #dfb0d6  #a5add3  #5698b9   ← rosa  → blu
Densità Bassa: #e8e8e8  #ace4e4  #5ac8c8   ← grigio → teal
```

**Lettura chiave:**

| Colore | Classe | Interpretazione |
|--------|--------|-----------------|
| Viola `#be64ac` | Alta densità + Bassa qualità | **Massimo impatto reale** — molti indirizzi errati in zona urbana |
| Blu scuro `#3b4994` | Alta densità + Alta qualità | Comuni urbanizzati con buona copertura |
| Grigio `#e8e8e8` | Bassa densità + Bassa qualità | Errori numerosi ma impatto pratico limitato |
| Teal `#5ac8c8` | Bassa densità + Alta qualità | Comuni rurali ben geocodificati |

---

## Implementazione tecnica

**Stack:** MapLibre GL JS v5 + PMTiles (vettoriale) + Vanilla JS

**Join dati:** la chiave di raccordo tra tutti i dataset è `pro_com_t` / `codice_istat` come intero numerico.

**Espressione colore MapLibre:**

```javascript
// match expression: cod_comune_numerico → colore bivariate
const fillMatch = ['match', ['to-number', ['get', 'pro_com_t']]];
Object.entries(data).forEach(([codStr, d]) => {
  fillMatch.push(parseInt(codStr, 10), BIVARIATE_COLORS[`${d.xClass}-${d.yClass}`]);
});
fillMatch.push('rgba(0,0,0,0)'); // default: comuni senza dati = trasparente
map.setPaintProperty('comuni-fill', 'fill-color', fillMatch);
```

**Layer:** riusa il layer `comuni-fill` (PMTiles `comuni.pmtiles`) già presente per la visualizzazione aggiudicatori ANNCSU. La modalità bivariate sovrascrive il colore; disattivandola si ripristina la vista aggiudicatori.

---

## Popup comunale

Cliccando su un comune in modalità bivariate (o anche in modalità normale con il layer comuni attivo), il popup mostra un **blocco bivariate** con:

- Un quadratino colorato con il colore esatto della cella 3×3
- La descrizione testuale: es. `Bassa qualità · Alta densità`

Il blocco è generato da `buildBivariatePopupBlock(codNum)` che usa una cache del risultato di `buildBivariateData()` (aggiornata ogni volta che la modalità bivariate viene attivata) oppure la calcola al primo accesso.

---

## Limitazioni e avvertenze

1. **Hotspot DBSCAN vs geocodifica fallback:** i parametri `eps=8m, min_points=5` possono includere cluster legittimi in edifici multipiano o piazze dense. La sottrazione è una stima conservativa, non una correzione esatta.

2. **Densità come proxy:** l'assenza di dati di popolazione ISTAT nel dataset richiede l'uso dei civici/km² come proxy. Comuni con molte seconde case o destinazioni turistiche possono avere densità di civici sproporzionata rispetto alla popolazione residente.

3. **Comuni senza dati ANNCSU:** i comuni non presenti in `anncsu_stats.json` appaiono trasparenti nella mappa bivariate. Questo indica assenza di dati nel dataset, non necessariamente qualità zero.

4. **Aggiornamento URL hotspot:** il file JSON degli hotspot è servito con hash di contenuto da Observable Framework. Quando i dati vengono rigenerati, la costante `HOTSPOT_URL` in `anncsu.js` (riga 4) va aggiornata con il nuovo hash.

5. **Doppia scala `shape_area`:** il CSV ISTAT `comuni.csv` contiene valori `shape_area` in due unità diverse (1.049 comuni con valori ~1.000× gonfiati rispetto agli altri). Il codice normalizza automaticamente usando la soglia 1e10 come discriminante. Se il CSV viene aggiornato da ISTAT, verificare che la soglia rimanga valida.

---

## Sorgenti dati

| Dataset | Sorgente | Aggiornamento |
|---------|----------|---------------|
| Statistiche civici ANNCSU | `quattochiacchiereinquattro/anncus` (Parquet → JSON) | Automatico, vedi `anncsu_stats.json` |
| Superfici comunali | ISTAT/ANPR via `dati/comuni.csv` | Statico |
| Poligoni comunali | `dati/comuni.pmtiles` | Statico |
| Hotspot DBSCAN | `mfortini/diff_ANNCSU` (Observable Framework) | Periodico, hash variabile |
