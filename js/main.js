const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

// ── Tema chiaro/scuro: letto da localStorage prima di creare la mappa, così
//    i tile CARTO giusti (dark_all/light_all) si caricano già al primo giro. ──
const THEME_KEY = 'poteredacquisto-theme';
let currentTheme = localStorage.getItem(THEME_KEY) || 'dark';
document.documentElement.setAttribute('data-theme', currentTheme);

const CARTO_TILES = {
  dark: ['a', 'b', 'c', 'd'].map(s => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`),
  light: ['a', 'b', 'c', 'd'].map(s => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`)
};
const MAP_BG = { dark: '#0b0d12', light: '#e8e4d8' };
const BORDER_COLOR = { dark: 'rgba(255,255,255,.6)', light: 'rgba(30,30,30,.55)' };

// Base satellitare (Esri World Imagery, nessuna API key richiesta), alternativa
// al basemap colore CARTO — attivabile dal dial, indipendente dal tema chiaro/scuro.
const SATELLITE_TILES = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'];
const SATELLITE_KEY = 'poteredacquisto-satellite';
let satelliteOn = localStorage.getItem(SATELLITE_KEY) === '1';

const VIEWS = {
  comuni: {
    pmtiles: 'dist/geo/potere_acquisto_comuni.pmtiles',
    sourceLayer: 'comuni_potere_acquisto',
    idField: 'pro_com',
    nameField: 'comune'
  },
  province: {
    pmtiles: 'dist/geo/potere_acquisto_province.pmtiles',
    sourceLayer: 'province_potere_acquisto',
    idField: 'sigla_prov',
    nameField: 'provincia'
  },
  bivariata: {
    pmtiles: 'dist/geo/potere_acquisto_bivariata.pmtiles',
    sourceLayer: 'comuni_bivariata',
    idField: 'pro_com',
    nameField: 'comune',
    bivariate: true,
    bivarField: 'bivar_class'
  },
  bivariataReddito: {
    pmtiles: 'dist/geo/potere_acquisto_bivariata_reddito.pmtiles',
    sourceLayer: 'comuni_bivariata_reddito',
    idField: 'pro_com',
    nameField: 'comune',
    bivariate: true,
    bivarField: 'bivar2_class'
  },
  redditi: {
    pmtiles: 'dist/geo/potere_acquisto_province.pmtiles',
    sourceLayer: 'province_potere_acquisto',
    idField: 'sigla_prov',
    nameField: 'provincia'
  },
  redditiComuni: {
    pmtiles: 'dist/geo/potere_acquisto_comuni.pmtiles',
    sourceLayer: 'comuni_potere_acquisto',
    idField: 'pro_com',
    nameField: 'comune',
    sharedSource: 'comuni' // stessi tile del layer "comuni", solo stile diverso: niente doppio fetch
  }
};
let currentView = 'comuni';

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: {
      'carto-base': {
        type: 'raster',
        tiles: CARTO_TILES[currentTheme],
        tileSize: 256,
        maxzoom: 20,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      },
      'satellite-base': {
        type: 'raster',
        tiles: SATELLITE_TILES,
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; Esri, Maxar, Earthstar Geographics'
      }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': MAP_BG[currentTheme] } },
      { id: 'carto-base-layer', type: 'raster', source: 'carto-base', layout: { visibility: satelliteOn ? 'none' : 'visible' } },
      { id: 'satellite-base-layer', type: 'raster', source: 'satellite-base', layout: { visibility: satelliteOn ? 'visible' : 'none' } }
    ]
  },
  center: [12.5, 42.5],
  zoom: window.innerWidth <= 640 ? 4 : 5.2,
  minZoom: 4,
  maxZoom: 10,
  maxBounds: [[-3.7, 32.9], [29.5, 50.5]],
  attributionControl: false,
  hash: true,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false
});
map.touchZoomRotate.disableRotation();

map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

/* Pulsantino bordi comuni, sotto i +/- zoom: custom IControl così finisce
   nello stesso gruppo top-right e si sposta in sincro col pannello dx tramite
   la regola CSS .maplibregl-ctrl-top-right già usata per i controlli nativi. */
class BordersControl {
  onAdd() {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.id = 'borders-toggle-btn';
    btn.type = 'button';
    btn.title = 'Mostra/nascondi limiti amministrativi';
    btn.innerHTML = '<span class="italia-icon"></span>';
    btn.addEventListener('click', toggleBorders);
    this._container.appendChild(btn);
    return this._container;
  }
  onRemove() { this._container.remove(); }
}
map.addControl(new BordersControl(), 'top-right');
requestAnimationFrame(() => {
  document.querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show')
    .forEach(el => el.classList.remove('maplibregl-compact-show'));
});

const COLOR_EXPR = [
  'match', ['get', 'classe_potere_acquisto'],
  1, '#c94f4f',
  2, '#d99a55',
  3, '#c9bd8a',
  4, '#7fac86',
  5, '#3f8f6b',
  '#5a6472'
];

// Reddito nominale (vista Redditi): rampa viola→blu→verde, classi fisse in €.
const REDDITI_COLOR_EXPR = [
  'step', ['get', 'reddito_medio_prov'],
  '#e0ead2',
  19000, '#b2d8b6',
  21000, '#74be9e',
  23000, '#4ca69e',
  25000, '#4080a5',
  27000, '#345298',
  29000, '#342168',
  31000, '#1e133a'
];

// Stessa rampa colore, soglie più basse: la distribuzione comunale parte
// più in basso (min 7.500 €) e ha una coda lunga di piccoli comuni molto ricchi
// (poche centinaia di contribuenti, media statisticamente rumorosa).
const REDDITI_COMUNI_COLOR_EXPR = [
  'step', ['get', 'reddito_medio_euro'],
  '#e0ead2',
  17000, '#b2d8b6',
  19000, '#74be9e',
  21000, '#4ca69e',
  23000, '#4080a5',
  25000, '#345298',
  27000, '#342168',
  29000, '#1e133a'
];

// Palette bivariata (schema Stevens), riusata per qualunque incrocio di terzili:
// il primo digit di bivar_class/bivar2_class e' sempre l'asse "orizzontale"
// (reddito), il secondo l'asse "verticale" (costo vita o potere d'acquisto).
function bivarColorExpr(field) {
  return [
    'match', ['get', field],
    '11', '#e8e8e8', '21', '#e4acac', '31', '#c85a5a',
    '12', '#b0d5df', '22', '#ad9ea5', '32', '#985356',
    '13', '#64acbe', '23', '#627f8c', '33', '#574249',
    '#5a6472'
  ];
}
const BIVAR_COLOR_EXPR = bivarColorExpr('bivar_class');
const BIVAR2_COLOR_EXPR = bivarColorExpr('bivar2_class');

const fmtEuro = (v) => v == null ? 'n.d.' : Math.round(v).toLocaleString('it-IT') + ' €';
const fmtEuroMq = (v) => v == null ? 'n.d.' : Math.round(v).toLocaleString('it-IT') + ' €/m²';

const FONTE_LABEL_COMUNI = {
  omi_diretto: 'OMI diretto del comune',
  media_provincia: 'Media OMI di provincia (fallback)',
  media_nazionale: 'Media OMI nazionale (fallback)'
};

/* Contribuenti/popolazione: rapporto tipico ~45-50% a livello nazionale
   (minori e molti pensionati a basso reddito non dichiarano). Popolazione e'
   bilancio demografico 31/12/2025 (dato provvisorio), contribuenti 2024: uno
   scarto marcato puo' riflettere variazione demografica nel frattempo, non
   solo composizione anagrafica. */
function popRatioRow(props) {
  if (props.popolazione == null || !props.n_contribuenti) return '';
  const pct = (props.n_contribuenti / props.popolazione * 100).toFixed(0);
  return `<div class="pop-row"><span class="k">Contribuenti / popolazione</span><span class="v">${pct}%</span></div>`;
}

function popupComuni(props) {
  const fonteWarn = props.fonte_costo_vita !== 'omi_diretto'
    ? `<div class="pop-warn">⚠ Nessuna quotazione OMI diretta per questo comune: usata la ${props.fonte_costo_vita === 'media_provincia' ? 'media provinciale' : 'media nazionale'}.</div>`
    : '';
  return `
    <div class="pop-title">${props.comune} (${props.sigla_prov})</div>
    <div class="pop-row"><span class="k">Regione</span><span class="v">${REGIONE_LABEL(props.regione)}</span></div>
    <div class="pop-row"><span class="k">Potere d'acquisto reale</span><span class="v">${fmtEuro(props.potere_acquisto_reale)}</span></div>
    <div class="pop-row"><span class="k">Reddito medio IRPEF</span><span class="v">${fmtEuro(props.reddito_medio_euro)}</span></div>
    <div class="pop-row"><span class="k">Valore immobiliare (OMI)</span><span class="v">${fmtEuroMq(props.omi_eur_mq)}</span></div>
    <div class="pop-row"><span class="k">Fonte costo vita</span><span class="v">${FONTE_LABEL_COMUNI[props.fonte_costo_vita] || props.fonte_costo_vita}</span></div>
    <div class="pop-row"><span class="k">Contribuenti</span><span class="v">${props.n_contribuenti != null ? props.n_contribuenti.toLocaleString('it-IT') : 'n.d.'}</span></div>
    <div class="pop-row"><span class="k">Popolazione (2025)</span><span class="v">${props.popolazione != null ? props.popolazione.toLocaleString('it-IT') : 'n.d.'}</span></div>
    ${popRatioRow(props)}
    ${fonteWarn}
  `;
}

const TERZILE_LABEL = ['', 'basso', 'medio', 'alto'];
const BIVAR_COLOR_MAP = {
  '11': '#e8e8e8', '21': '#e4acac', '31': '#c85a5a',
  '12': '#b0d5df', '22': '#ad9ea5', '32': '#985356',
  '13': '#64acbe', '23': '#627f8c', '33': '#574249'
};

function textOnColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.55 ? '#1a1d23' : '#f2f4f7';
}

function popupBivariata(props) {
  const cls = props.bivar_class;
  const bg = BIVAR_COLOR_MAP[cls] || '#5a6472';
  const fg = textOnColor(bg);
  return `
    <div class="pop-title">${props.comune} (${props.sigla_prov})</div>
    <div class="pop-row"><span class="k">Regione</span><span class="v">${REGIONE_LABEL(props.regione)}</span></div>
    <div class="pop-row"><span class="k">Classe bivariata</span><span class="v pop-badge" style="background:${bg};color:${fg}">reddito ${TERZILE_LABEL[props.terzile_reddito]} · costo vita ${TERZILE_LABEL[props.terzile_costo_vita]}</span></div>
    <div class="pop-row"><span class="k">Reddito medio IRPEF</span><span class="v">${fmtEuro(props.reddito_medio_euro)} <i>(${TERZILE_LABEL[props.terzile_reddito]})</i></span></div>
    <div class="pop-row"><span class="k">Costo vita stimato (OMI)</span><span class="v">${fmtEuroMq(props.costo_vita_stimato)} <i>(${TERZILE_LABEL[props.terzile_costo_vita]})</i></span></div>
    <div class="pop-row"><span class="k">Potere d'acquisto reale</span><span class="v">${fmtEuro(props.potere_acquisto_reale)}</span></div>
    <div class="pop-row"><span class="k">Contribuenti</span><span class="v">${props.n_contribuenti != null ? props.n_contribuenti.toLocaleString('it-IT') : 'n.d.'}</span></div>
    <div class="pop-row"><span class="k">Popolazione (2025)</span><span class="v">${props.popolazione != null ? props.popolazione.toLocaleString('it-IT') : 'n.d.'}</span></div>
    ${popRatioRow(props)}
  `;
}

function popupBivariataReddito(props) {
  const cls = props.bivar2_class;
  const bg = BIVAR_COLOR_MAP[cls] || '#5a6472';
  const fg = textOnColor(bg);
  return `
    <div class="pop-title">${props.comune} (${props.sigla_prov})</div>
    <div class="pop-row"><span class="k">Regione</span><span class="v">${REGIONE_LABEL(props.regione)}</span></div>
    <div class="pop-row"><span class="k">Classe bivariata</span><span class="v pop-badge" style="background:${bg};color:${fg}">reddito ${TERZILE_LABEL[props.terzile_reddito_nom]} · potere d'acquisto ${TERZILE_LABEL[props.terzile_pot_acquisto]}</span></div>
    <div class="pop-row"><span class="k">Reddito medio IRPEF (nominale)</span><span class="v">${fmtEuro(props.reddito_medio_euro)} <i>(${TERZILE_LABEL[props.terzile_reddito_nom]})</i></span></div>
    <div class="pop-row"><span class="k">Potere d'acquisto reale</span><span class="v">${fmtEuro(props.potere_acquisto_reale)} <i>(${TERZILE_LABEL[props.terzile_pot_acquisto]})</i></span></div>
    <div class="pop-row"><span class="k">Contribuenti</span><span class="v">${props.n_contribuenti != null ? props.n_contribuenti.toLocaleString('it-IT') : 'n.d.'}</span></div>
    <div class="pop-row"><span class="k">Popolazione (2025)</span><span class="v">${props.popolazione != null ? props.popolazione.toLocaleString('it-IT') : 'n.d.'}</span></div>
    ${popRatioRow(props)}
  `;
}

function popupProvince(props) {
  const ndWarn = props.nic_valore == null
    ? `<div class="pop-warn">⚠ Nessuna rilevazione NIC diretta in questa provincia: potere d'acquisto non calcolabile con dato reale.</div>`
    : '';
  return `
    <div class="pop-title">${props.provincia} (${props.sigla_prov})</div>
    <div class="pop-row"><span class="k">Regione</span><span class="v">${REGIONE_LABEL(props.regione)}</span></div>
    <div class="pop-row"><span class="k">Potere d'acquisto reale</span><span class="v">${fmtEuro(props.potere_acquisto_reale_prov)}</span></div>
    <div class="pop-row"><span class="k">Reddito medio provinciale</span><span class="v">${fmtEuro(props.reddito_medio_prov)}</span></div>
    <div class="pop-row"><span class="k">Indice NIC (2025=100)</span><span class="v">${props.nic_valore != null ? props.nic_valore.toFixed(1) : 'n.d.'}</span></div>
    <div class="pop-row"><span class="k">Contribuenti</span><span class="v">${props.n_contribuenti_prov != null ? props.n_contribuenti_prov.toLocaleString('it-IT') : 'n.d.'}</span></div>
    ${ndWarn}
  `;
}

function popupRedditi(props) {
  return `
    <div class="pop-title">${props.provincia} (${props.sigla_prov})</div>
    <div class="pop-row"><span class="k">Regione</span><span class="v">${REGIONE_LABEL(props.regione)}</span></div>
    <div class="pop-row"><span class="k">Reddito medio provinciale</span><span class="v">${fmtEuro(props.reddito_medio_prov)}</span></div>
    <div class="pop-row"><span class="k">Contribuenti</span><span class="v">${props.n_contribuenti_prov != null ? props.n_contribuenti_prov.toLocaleString('it-IT') : 'n.d.'}</span></div>
  `;
}

function popupRedditiComuni(props) {
  return `
    <div class="pop-title">${props.comune} (${props.sigla_prov})</div>
    <div class="pop-row"><span class="k">Regione</span><span class="v">${REGIONE_LABEL(props.regione)}</span></div>
    <div class="pop-row"><span class="k">Reddito medio IRPEF</span><span class="v">${fmtEuro(props.reddito_medio_euro)}</span></div>
    <div class="pop-row"><span class="k">Contribuenti</span><span class="v">${props.n_contribuenti != null ? props.n_contribuenti.toLocaleString('it-IT') : 'n.d.'}</span></div>
    <div class="pop-row"><span class="k">Popolazione (2025)</span><span class="v">${props.popolazione != null ? props.popolazione.toLocaleString('it-IT') : 'n.d.'}</span></div>
    ${popRatioRow(props)}
  `;
}

const FILL_OPACITY_KEY = 'poteredacquisto-fill-opacity';
const storedFillOpacity = parseFloat(localStorage.getItem(FILL_OPACITY_KEY));
let fillOpacity = Number.isFinite(storedFillOpacity) ? storedFillOpacity : 0.82;

let hoveredId = null;
function clearHover() {
  if (hoveredId) map.setFeatureState(hoveredId, { hover: false });
  hoveredId = null;
}

const nameTooltipEl = document.getElementById('map-tooltip');
function showNameTooltip(name, point) {
  nameTooltipEl.textContent = name;
  nameTooltipEl.style.left = `${point.x}px`;
  nameTooltipEl.style.top = `${point.y}px`;
  nameTooltipEl.style.display = 'block';
}
function hideNameTooltip() {
  nameTooltipEl.style.display = 'none';
}

function addViewLayers(view) {
  const cfg = VIEWS[view];
  const srcId = cfg.sharedSource ? `src-${cfg.sharedSource}` : `src-${view}`;
  const fillId = `${view}-fill`;
  const lineId = `${view}-line`;
  const hoverId = `${view}-hover-line`;

  if (!cfg.sharedSource) map.addSource(srcId, { type: 'vector', url: `pmtiles://${cfg.pmtiles}`, promoteId: cfg.idField });

  const fillColor = cfg.bivariate
    ? bivarColorExpr(cfg.bivarField)
    : view === 'province'
      ? ['case', ['==', ['get', 'nic_valore'], null], '#5a6472', COLOR_EXPR]
      : view === 'redditi'
        ? REDDITI_COLOR_EXPR
        : view === 'redditiComuni'
          ? REDDITI_COMUNI_COLOR_EXPR
          : COLOR_EXPR;

  const active = view === currentView;

  map.addLayer({
    id: fillId, type: 'fill', source: srcId, 'source-layer': cfg.sourceLayer,
    paint: {
      'fill-color': fillColor,
      'fill-opacity': active ? fillOpacity : 0,
      'fill-opacity-transition': { duration: 260 },
      'fill-antialias': false
    }
  });
  map.addLayer({
    id: lineId, type: 'line', source: srcId, 'source-layer': cfg.sourceLayer,
    paint: {
      'line-color': fillColor,
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 9, 1.2],
      'line-opacity': 0,
      'line-opacity-transition': { duration: 260 }
    }
  });
  map.addLayer({
    id: hoverId, type: 'line', source: srcId, 'source-layer': cfg.sourceLayer,
    paint: {
      'line-color': '#ffffff', 'line-width': 1.6,
      'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0]
    }
  });

  /* Highlight via feature-state (non setFilter): setFilter ricalcola l'intero
     layer a ogni mousemove ed è pesante su migliaia di poligoni, causando un
     ritardo visibile — il bordo del comune precedente non si spegne subito e
     resta una "scia" di comuni illuminati mentre il mouse scorre veloce. */
  map.on('mousemove', fillId, (e) => {
    if (view !== currentView || !e.features.length) return;
    map.getCanvas().style.cursor = 'pointer';
    showNameTooltip(e.features[0].properties[cfg.nameField], e.point);
    const id = e.features[0].id;
    if (hoveredId && hoveredId.id === id && hoveredId.source === srcId) return;
    clearHover();
    hoveredId = { source: srcId, sourceLayer: cfg.sourceLayer, id };
    map.setFeatureState(hoveredId, { hover: true });
  });
  map.on('mouseleave', fillId, () => {
    if (view !== currentView) return;
    map.getCanvas().style.cursor = '';
    clearHover();
    hideNameTooltip();
  });
  map.on('click', fillId, (e) => {
    if (view !== currentView) return;
    const props = e.features[0].properties;
    const html = view === 'bivariataReddito' ? popupBivariataReddito(props)
      : cfg.bivariate ? popupBivariata(props)
      : view === 'comuni' ? popupComuni(props)
      : view === 'redditi' ? popupRedditi(props)
      : view === 'redditiComuni' ? popupRedditiComuni(props)
      : popupProvince(props);
    new maplibregl.Popup({ closeButton: true, maxWidth: '300px' })
      .setLngLat(e.lngLat).setHTML(html).addTo(map);
  });
}

/* ── Bordi amministrativi (regione/provincia/comune): layer indipendenti
   dalla vista scelta, sempre presenti sulla mappa e attivabili col pulsante
   sotto lo zoom. Ognuno visibile solo nella sua fascia di zoom, con dissolvenza
   incrociata così il passaggio da un livello all'altro non è un salto secco.
   Le fonti "comuni" e "province" sono già caricate per le viste dati (niente
   doppio fetch); i confini regionali arrivano da un pmtiles dedicato, perché
   nessuna vista dati esiste già a livello di regione. ── */
const BORDER_LEVELS = [
  { id: 'confini-regioni', srcId: 'src-confini-regioni', sourceLayer: 'regioni',
    stops: [4, 0, 4.3, 1, 6.5, 1, 7.5, 0] },
  { id: 'confini-province', srcId: 'src-province', sourceLayer: VIEWS.province.sourceLayer,
    stops: [5.5, 0, 6.5, 1, 8.5, 1, 9.5, 0] },
  { id: 'confini-comuni', srcId: 'src-comuni', sourceLayer: VIEWS.comuni.sourceLayer,
    stops: [7.5, 0, 8.5, 1, 10, 1] }
];

function addBorderLayers() {
  map.addSource('src-confini-regioni', { type: 'vector', url: 'pmtiles://dist/geo/confini_regioni.pmtiles' });
  for (const lvl of BORDER_LEVELS) {
    map.addLayer({
      id: lvl.id, type: 'line', source: lvl.srcId, 'source-layer': lvl.sourceLayer,
      layout: { visibility: bordersOn ? 'visible' : 'none' },
      paint: {
        'line-color': BORDER_COLOR[currentTheme],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 10, 1.4],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], ...lvl.stops]
      }
    });
  }
}

map.on('load', () => {
  addViewLayers('comuni');
  addViewLayers('province');
  addViewLayers('bivariata');
  addViewLayers('bivariataReddito');
  addViewLayers('redditi');
  addViewLayers('redditiComuni');
  addBorderLayers();
  applyBorders();
  document.getElementById('map-loader').style.display = 'none';
});

function switchView(view) {
  if (view === currentView) return;
  clearHover();
  hideNameTooltip();
  currentView = view;
  for (const v of Object.keys(VIEWS)) {
    const isActive = v === view;
    map.setPaintProperty(`${v}-fill`, 'fill-opacity', isActive ? fillOpacity : 0);
    map.setPaintProperty(`${v}-hover-line`, 'line-opacity', isActive
      ? ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0] : 0);
  }
  document.querySelectorAll('#dial-items [data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  setActiveTab(view);
}

/* ── Pulsante bordi sotto lo zoom: mostra/nasconde tutti e tre i livelli di
   confine insieme (regione/provincia/comune), ognuno visibile solo alla sua
   fascia di zoom via BORDER_LEVELS. ── */
const BORDERS_KEY = 'poteredacquisto-borders-v2';
let bordersOn = localStorage.getItem(BORDERS_KEY) !== '0';
function applyBorders() {
  for (const lvl of BORDER_LEVELS) {
    if (map.getLayer(lvl.id)) map.setLayoutProperty(lvl.id, 'visibility', bordersOn ? 'visible' : 'none');
  }
  const btn = document.getElementById('borders-toggle-btn');
  if (btn) btn.classList.toggle('active', bordersOn);
}
function toggleBorders() {
  bordersOn = !bordersOn;
  localStorage.setItem(BORDERS_KEY, bordersOn ? '1' : '0');
  applyBorders();
}

/* ── Pannello dx: tab Comuni/Province/Bivariata, sempre sincronizzato con
   la vista mappa attiva. Su desktop apribile/richiudibile con la linguetta
   (aperto di default); su mobile la linguetta è disattivata — si apre da
   solo a ogni cambio vista e si chiude con la ✕. ── */
const sidePanel = document.getElementById('side-panel');
const rankingDialBtn = document.querySelector('#dial-items [data-action="ranking"]');
function openSidePanel() { sidePanel.classList.remove('closed'); document.body.classList.add('side-panel-open'); rankingDialBtn.classList.add('active'); syncMapWithPanel(); }
function closeSidePanel() { sidePanel.classList.add('closed'); document.body.classList.remove('side-panel-open'); rankingDialBtn.classList.remove('active'); syncMapWithPanel(); }
window.innerWidth <= 640 ? closeSidePanel() : openSidePanel();

/* Il pannello dx è in overlay (position:fixed) sopra la mappa: il canvas
   resta a piena larghezza, ma la fetta coperta dal pannello non è visibile
   all'utente. Va quindi esclusa da tutto ciò che legge "cosa si vede sulla
   mappa" (classifiche "solo quest'area"), altrimenti includerebbero comuni
   nascosti sotto il pannello. syncMapWithPanel ricalcola quel bordo a ogni
   apertura/chiusura, dopo la transizione CSS (.28s). */
function panelPixelWidth() {
  if (window.innerWidth <= 640) return 0; // su mobile il pannello copre tutto, non scosta il bordo
  return sidePanel.classList.contains('closed') ? 0 : sidePanel.offsetWidth;
}
function syncMapWithPanel() {
  map.setPadding({ top: 0, bottom: 0, left: 0, right: panelPixelWidth() });
  setTimeout(() => {
    map.resize();
    const scope = currentView;
    if (RANKING_STATE[scope] && RANKING_STATE[scope].viewport) renderRankingScope(scope);
  }, 300);
}

function setActiveTab(view) {
  document.querySelectorAll('.tab-hdr').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.dataset.tab === view));
  if (window.innerWidth <= 640) openSidePanel();
}
document.querySelectorAll('.tab-hdr').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'capoluoghi') { setActiveTab('capoluoghi'); return; }
    switchView(btn.dataset.view);
  });
});
document.getElementById('panel-toggle').addEventListener('click', () => {
  sidePanel.classList.contains('closed') ? openSidePanel() : closeSidePanel();
});
document.getElementById('panel-close-mobile').addEventListener('click', closeSidePanel);

/* ── Logo + attribution: seguono in sincro l'apertura di qualsiasi pannello/modale ── */
let openPanelCount = 0;
function panelOpened() { openPanelCount++; document.body.classList.add('panel-open'); }
function panelClosed() { openPanelCount = Math.max(0, openPanelCount - 1); if (openPanelCount === 0) document.body.classList.remove('panel-open'); }

const noteOverlay = document.getElementById('note-overlay');
const infoDialBtn = document.querySelector('#dial-items [data-action="info"]');
function openNote() { noteOverlay.classList.add('open'); infoDialBtn.classList.add('active'); panelOpened(); }
function closeNote() { if (!noteOverlay.classList.contains('open')) return; noteOverlay.classList.remove('open'); infoDialBtn.classList.remove('active'); panelClosed(); }
document.getElementById('note-close').addEventListener('click', closeNote);
noteOverlay.addEventListener('click', (e) => { if (e.target === noteOverlay) closeNote(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNote(); });

const noteScroll = document.getElementById('note-scroll');
const noteTop = document.getElementById('note-top');
document.querySelectorAll('.note-tab-hdr').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.noteTab;
    document.querySelectorAll('.note-tab-hdr').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.note-tab-content').forEach(c => c.classList.toggle('active', c.dataset.noteTab === tab));
    noteScroll.scrollTop = 0;
  });
});
noteScroll.addEventListener('scroll', () => {
  const past = noteScroll.scrollTop > 200;
  noteTop.classList.toggle('show', past);
  requestAnimationFrame(() => noteTop.classList.toggle('visible', past));
});
noteTop.addEventListener('click', () => noteScroll.scrollTo({ top: 0, behavior: 'smooth' }));

/* ── Classifiche: una per tab (Comuni/Province/Bivariata), incorporate nel
   pannello dx. "scope" = tab/vista mappa (comuni|province|bivariata);
   "unit" = livello del dato classificato (comuni|province|regioni) — il tab
   Province ha unit fissa "province", i tab Comuni/Bivariata offrono anche
   il sotto-livello "regioni" tramite i pillola .ranking-subtab. ── */
const RANKING_UNIT_LABEL = { comuni: 'comuni', province: 'province', regioni: 'regioni', redditi: 'province', redditi_regioni: 'regioni', redditi_comuni: 'comuni' };
const RANKING_METRIC_LABEL = { redditi: 'reddito medio', redditiComuni: 'reddito medio' };
let RANKINGS = null;
const RANKING_STATE = {
  comuni:        { unit: 'comuni',        viewport: false },
  province:      { unit: 'province',      viewport: false },
  bivariata:        { unit: 'comuni', viewport: false },
  bivariataReddito: { unit: 'comuni', viewport: false },
  redditi:       { unit: 'redditi',       viewport: false },
  redditiComuni: { unit: 'redditi_comuni', viewport: false }
};

function fmtRankVal(r) {
  return Math.round(r.valore).toLocaleString('it-IT') + ' €';
}

/* Le classifiche seguono il filtro geografico attivo (stesso geoState della
   mappa): provincia selezionata ha precedenza su regione, come nel filtro mappa. */
function filterRankingRows(rows, unit, viewport) {
  const isRegioni = unit === 'regioni' || unit === 'redditi_regioni';
  let out = rows;
  if (geoState.provincia) {
    out = isRegioni ? out.filter(r => r.nome === geoState.regione) : out.filter(r => r.prov === geoState.provincia);
  } else if (geoState.regione) {
    out = isRegioni ? out.filter(r => r.nome === geoState.regione) : out.filter(r => r.regione === geoState.regione);
  }
  if (viewport) out = filterByViewport(out, unit);
  return out;
}

/* Tab Bivariata: la selezione di una classe nella legenda (geoState.bivarClass)
   filtra anche la classifica, non solo la mappa — restringe l'elenco ai comuni
   di quella cella (es. reddito medio · costo vita alto = "23", caso Palermo). */
const BIVAR_CLASS_LABEL = {
  '11': 'reddito basso · costo vita basso', '21': 'reddito medio · costo vita basso', '31': 'reddito alto · costo vita basso',
  '12': 'reddito basso · costo vita medio', '22': 'reddito medio · costo vita medio', '32': 'reddito alto · costo vita medio',
  '13': 'reddito basso · costo vita alto', '23': 'reddito medio · costo vita alto', '33': 'reddito alto · costo vita alto'
};

/* "Solo quest'area": interroga i layer renderizzati nel viewport corrente
   (map.queryRenderedFeatures senza geometria = intero canvas visibile) e
   incrocia gli id con le righe della classifica. Funziona anche se il layer
   della vista attiva ha fill-opacity 0 (i comuni sono comunque nei tile). */
function viewportIdSet(layerId, idField) {
  if (!map.getLayer(layerId)) return null;
  const pw = panelPixelWidth();
  const canvas = map.getCanvas();
  const bbox = pw > 0 ? [[0, 0], [canvas.clientWidth - pw, canvas.clientHeight]] : undefined;
  const feats = bbox ? map.queryRenderedFeatures(bbox, { layers: [layerId] }) : map.queryRenderedFeatures({ layers: [layerId] });
  const s = new Set();
  feats.forEach(f => s.add(f.properties[idField]));
  return s;
}

function filterByViewport(rows, unit) {
  if (unit === 'province') {
    const ids = viewportIdSet('province-fill', 'sigla_prov');
    return ids ? rows.filter(r => ids.has(r.prov)) : rows;
  }
  if (unit === 'redditi') {
    const ids = viewportIdSet('redditi-fill', 'sigla_prov');
    return ids ? rows.filter(r => ids.has(r.prov)) : rows;
  }
  if (unit === 'redditi_regioni') {
    const ids = viewportIdSet('redditi-fill', 'regione');
    return ids ? rows.filter(r => ids.has(r.nome)) : rows;
  }
  if (unit === 'redditi_comuni') {
    const ids = viewportIdSet('redditiComuni-fill', 'pro_com');
    return ids ? rows.filter(r => ids.has(r.pro_com)) : rows;
  }
  if (unit === 'regioni') {
    const ids = viewportIdSet('comuni-fill', 'regione');
    return ids ? rows.filter(r => ids.has(r.nome)) : rows;
  }
  const ids = viewportIdSet('comuni-fill', 'pro_com');
  return ids ? rows.filter(r => ids.has(r.pro_com)) : rows;
}

function topBottom(rows, n = 10) {
  const sorted = [...rows].sort((a, b) => b.valore - a.valore);
  return { top: sorted.slice(0, n), bottom: sorted.slice(-n).reverse() };
}

function rankingScopeLabel(viewport) {
  let s = '';
  if (geoState.provincia) s = ` in provincia di ${provinceOf(geoState.regione)[geoState.provincia]?.nome || geoState.provincia}`;
  else if (geoState.regione) s = ` in ${REGIONE_LABEL(geoState.regione)}`;
  if (viewport) s += s ? ', nell’area visualizzata' : ' nell’area visualizzata sulla mappa';
  return s;
}

function findRegioneOfProvincia(sigla) {
  if (!HIERARCHY) return '';
  for (const [reg, rData] of Object.entries(HIERARCHY.regioni)) {
    if (rData.province[sigla]) return reg;
  }
  return '';
}

function selectFromRanking(r, unit, scope) {
  if (unit === 'comuni' || unit === 'redditi_comuni') {
    fRegione.value = r.regione; geoState.regione = r.regione; populateProvince(r.regione);
    fProvincia.value = r.prov; geoState.provincia = r.prov; populateComuni(r.regione, r.prov);
    const proCom = String(parseInt(r.pro_com, 10));
    fComune.value = proCom; geoState.comune = proCom; geoState.comuneProvincia = r.prov;
    geoState.comuneNome = r.nome;
  } else if (unit === 'province' || unit === 'redditi') {
    const reg = findRegioneOfProvincia(r.prov);
    fRegione.value = reg; geoState.regione = reg; populateProvince(reg);
    fProvincia.value = r.prov; geoState.provincia = r.prov; populateComuni(reg, r.prov);
    geoState.comune = '';
  } else {
    fRegione.value = r.nome; geoState.regione = r.nome; populateProvince(r.nome);
    geoState.provincia = ''; geoState.comune = '';
  }
  if (currentView !== scope) switchView(scope);
  setActiveTab(scope);
  applyGeoFilters(); updateGeoChips();
}

function renderRankingList(el, rows, minVal, maxVal, unit, scope) {
  const span = maxVal - minVal || 1;
  el.innerHTML = rows.map((r, i) => {
    const pct = Math.max(6, Math.round(((r.valore - minVal) / span) * 100));
    /* r.rank, se presente, è la vera posizione nella classifica completa
       (non l'indice nell'elenco filtrato) — es. la ricerca capoluoghi mostra
       "45" per Palermo anche quando è l'unico risultato visibile, non "1". */
    const counterStyle = r.rank ? ` style="counter-reset:rank ${r.rank - 1}"` : '';
    return `
    <li class="ranking-item" data-idx="${i}"${counterStyle} tabindex="0" role="button">
      <span class="rk-name" title="${esc(r.nome)}${r.prov ? ' (' + esc(r.prov) + ')' : ''}">${esc(r.nome)}${r.prov ? ' <span class="rk-prov">' + esc(r.prov) + '</span>' : ''}</span>
      <span class="rk-bar-track"><span class="rk-bar-fill" style="width:${pct}%"></span></span>
      <span class="rk-val">${fmtRankVal(r)}</span>
    </li>`;
  }).join('');
  el.querySelectorAll('.ranking-item').forEach((li, i) => {
    const go = () => selectFromRanking(rows[i], unit, scope);
    li.addEventListener('click', go);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

/* Ordine di lettura della griglia bivariata: righe costo vita alta→bassa,
   colonne reddito bassa→alta (stesso layout visivo della legenda). */
const BIVAR_ORDER = ['13', '23', '33', '12', '22', '32', '11', '21', '31'];

const BIVAR2_CLASS_LABEL = {
  '11': 'reddito nominale basso · potere d\'acquisto basso', '21': 'reddito nominale medio · potere d\'acquisto basso', '31': 'reddito nominale alto · potere d\'acquisto basso',
  '12': 'reddito nominale basso · potere d\'acquisto medio', '22': 'reddito nominale medio · potere d\'acquisto medio', '32': 'reddito nominale alto · potere d\'acquisto medio',
  '13': 'reddito nominale basso · potere d\'acquisto alto', '23': 'reddito nominale medio · potere d\'acquisto alto', '33': 'reddito nominale alto · potere d\'acquisto alto'
};

/* Config per scope bivariato: quale campo classe leggere dalle righe di
   RANKINGS.comuni, in quale contenitore renderizzare, con quali etichette. */
const BIVAR_ACCORDION_CFG = {
  bivariata:        { classField: 'bivar_class',  containerId: 'bivar-class-accordion',         labels: BIVAR_CLASS_LABEL },
  bivariataReddito: { classField: 'bivar2_class', containerId: 'bivar-class-accordion-reddito', labels: BIVAR2_CLASS_LABEL }
};

function renderBivarAccordion(scope) {
  const cfg = BIVAR_ACCORDION_CFG[scope];
  const st = RANKING_STATE[scope];
  const container = document.getElementById(cfg.containerId);
  if (!container) return;
  const rows = filterRankingRows(RANKINGS.comuni, 'comuni', st.viewport);
  const byClass = {};
  rows.forEach(r => { const cls = r[cfg.classField]; if (!cls) return; (byClass[cls] = byClass[cls] || []).push(r); });
  Object.values(byClass).forEach(list => list.sort((a, b) => b.valore - a.valore));

  container.innerHTML = BIVAR_ORDER.map(cls => {
    const list = byClass[cls] || [];
    const top10 = list.slice(0, 10);
    const bg = BIVAR_COLOR_MAP[cls] || '#5a6472';
    const itemsHtml = top10.length
      ? top10.map((r, i) => `
        <li class="ranking-item bivar-acc-item" data-cls="${cls}" data-idx="${i}" tabindex="0" role="button">
          <span class="rk-name" title="${esc(r.nome)} (${esc(r.prov)})">${esc(r.nome)} <span class="rk-prov">${esc(r.prov)}</span></span>
          <span class="rk-val">${fmtRankVal(r)}</span>
        </li>`).join('')
      : '<li class="ranking-empty">Nessun comune in questa classe.</li>';
    return `
      <details class="bivar-acc" data-cls="${cls}">
        <summary><span class="bivar-acc-swatch" style="background:${bg}"></span>${esc(cfg.labels[cls])} <span class="bivar-acc-count">${list.length}</span></summary>
        <ol class="ranking-list bivar-acc-list">${itemsHtml}</ol>
      </details>`;
  }).join('');

  container.querySelectorAll('.bivar-acc-item').forEach(li => {
    const cls = li.dataset.cls;
    const r = (byClass[cls] || [])[+li.dataset.idx];
    const go = () => selectFromRanking(r, 'comuni', scope);
    li.addEventListener('click', go);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

function renderRankingScope(scope) {
  if (!RANKINGS) return;
  if (BIVAR_ACCORDION_CFG[scope]) { renderBivarAccordion(scope); return; }
  const st = RANKING_STATE[scope];
  const unit = st.unit;
  const subtitleEl = document.querySelector(`.ranking-subtitle[data-scope="${scope}"]`);
  const topEl = document.querySelector(`.ranking-list.ranking-top[data-scope="${scope}"]`);
  const bottomEl = document.querySelector(`.ranking-list.ranking-bottom[data-scope="${scope}"]`);
  const noteEl = document.querySelector(`.ranking-note[data-scope="${scope}"]`);

  const rows = filterRankingRows(RANKINGS[unit], unit, st.viewport);
  if (rows.length === 0) {
    topEl.innerHTML = ''; bottomEl.innerHTML = '';
    subtitleEl.textContent = `Nessun dato disponibile${rankingScopeLabel(st.viewport)} per questa classifica.`;
    noteEl.textContent = '';
    return;
  }
  const data = topBottom(rows);
  const allVals = rows.map(r => r.valore);
  const minVal = Math.min(...allVals), maxVal = Math.max(...allVals);
  renderRankingList(topEl, data.top, minVal, maxVal, unit, scope);
  renderRankingList(bottomEl, data.bottom, minVal, maxVal, unit, scope);
  const n = Math.min(10, rows.length);
  const metric = RANKING_METRIC_LABEL[scope] || "potere d'acquisto reale";
  subtitleEl.textContent = `I ${n} ${RANKING_UNIT_LABEL[unit]} dove si vive meglio e peggio${rankingScopeLabel(st.viewport)}, per ${metric}`;
  noteEl.textContent = unit === 'comuni'
    ? `Solo comuni con almeno ${RANKINGS.min_contribuenti.toLocaleString('it-IT')} contribuenti, per evitare medie statisticamente rumorose sui centri molto piccoli.`
    : unit === 'redditi_comuni'
      ? `Solo comuni con almeno ${RANKINGS.min_contribuenti.toLocaleString('it-IT')} contribuenti; reddito medio nominale, non corretto per il costo della vita.`
      : unit === 'province'
        ? 'Solo le province con rilevazione NIC Istat diretta (77 su 107).'
        : unit === 'redditi'
          ? 'Tutte le 107 province, reddito medio nominale — non corretto per il costo della vita.'
          : unit === 'redditi_regioni'
            ? 'Media pesata sui contribuenti delle province di ciascuna regione, reddito medio nominale.'
            : 'Media pesata sui contribuenti dei comuni di ciascuna regione (stessa soglia della vista Comuni).';
}

/* Ricerca "intelligente": ignora maiuscole/accenti e cerca sia sul nome
   del comune sia sulla sigla/nome provincia, cosi' "Milano", "milano" o
   "MI" trovano tutti Milano. */
const normSearch = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
let capoluoghiSearchTerm = '';

function renderCapoluoghi() {
  if (!RANKINGS || !RANKINGS.capoluoghi) return;
  const el = document.querySelector('.ranking-list.ranking-general[data-scope="capoluoghi"]');
  const countEl = document.getElementById('capoluoghi-search-count');
  if (!el) return;
  /* RANKINGS.capoluoghi è già ordinato per valore desc (query SQL a monte):
     la posizione vera è l'indice nell'elenco completo, assegnata una sola
     volta cosi' resta stabile anche quando la ricerca filtra l'elenco. */
  if (!RANKINGS.capoluoghi[0] || RANKINGS.capoluoghi[0].rank === undefined) {
    RANKINGS.capoluoghi.forEach((r, i) => { r.rank = i + 1; });
  }
  let rows = RANKINGS.capoluoghi;
  const term = normSearch(capoluoghiSearchTerm);
  if (term) {
    rows = rows.filter(r => normSearch(r.nome).includes(term) || normSearch(r.prov).includes(term));
  }
  if (countEl) countEl.textContent = term ? `${rows.length}/${RANKINGS.capoluoghi.length}` : '';
  if (rows.length === 0) { el.innerHTML = '<li class="ranking-empty">Nessun capoluogo trovato.</li>'; return; }
  const allVals = rows.map(r => r.valore);
  renderRankingList(el, rows, Math.min(...allVals), Math.max(...allVals), 'comuni', 'comuni');
}

const capoluoghiSearchInput = document.getElementById('capoluoghi-search');
if (capoluoghiSearchInput) {
  capoluoghiSearchInput.addEventListener('input', () => {
    capoluoghiSearchTerm = capoluoghiSearchInput.value;
    renderCapoluoghi();
  });
}

function renderAllRankings() {
  Object.keys(RANKING_STATE).forEach(renderRankingScope);
  renderCapoluoghi();
}

document.querySelectorAll('.ranking-subtabs').forEach(group => {
  const scope = group.dataset.scope;
  group.querySelectorAll('.ranking-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      RANKING_STATE[scope].unit = btn.dataset.unit;
      group.querySelectorAll('.ranking-subtab').forEach(b => b.classList.toggle('active', b === btn));
      renderRankingScope(scope);
    });
  });
});

document.querySelectorAll('.ranking-viewport-toggle').forEach(btn => {
  const scope = btn.dataset.scope;
  btn.addEventListener('click', () => {
    RANKING_STATE[scope].viewport = !RANKING_STATE[scope].viewport;
    btn.setAttribute('aria-pressed', String(RANKING_STATE[scope].viewport));
    renderRankingScope(scope);
  });
});

let viewportRankingRAF = null;
map.on('move', () => {
  const scope = currentView;
  if (!RANKING_STATE[scope].viewport) return;
  if (viewportRankingRAF) return;
  viewportRankingRAF = requestAnimationFrame(() => { viewportRankingRAF = null; renderRankingScope(scope); });
});

fetch('dist/geo/rankings.json?v=15').then(r => r.json()).then(d => { RANKINGS = d; renderAllRankings(); });

/* ── Menu speed-dial (home / info / viste) ── */
function setTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  const src = map.getSource('carto-base');
  if (src) src.setTiles(CARTO_TILES[theme]);
  if (map.getLayer('bg')) map.setPaintProperty('bg', 'background-color', MAP_BG[theme]);
  for (const lvl of BORDER_LEVELS) {
    if (map.getLayer(lvl.id)) map.setPaintProperty(lvl.id, 'line-color', BORDER_COLOR[theme]);
  }
}

const satelliteDialBtn = document.getElementById('satellite-dial-btn');
satelliteDialBtn.classList.toggle('active', satelliteOn);
function toggleSatellite() {
  satelliteOn = !satelliteOn;
  localStorage.setItem(SATELLITE_KEY, satelliteOn ? '1' : '0');
  if (map.getLayer('carto-base-layer')) map.setLayoutProperty('carto-base-layer', 'visibility', satelliteOn ? 'none' : 'visible');
  if (map.getLayer('satellite-base-layer')) map.setLayoutProperty('satellite-base-layer', 'visibility', satelliteOn ? 'visible' : 'none');
  satelliteDialBtn.classList.toggle('active', satelliteOn);
}

const dialFab = document.getElementById('dial-fab');
const dialItems = document.getElementById('dial-items');
function closeDial() { dialFab.classList.remove('open'); dialItems.classList.remove('open'); dialFab.setAttribute('aria-expanded', 'false'); }
dialFab.addEventListener('click', () => {
  const open = dialItems.classList.toggle('open');
  dialFab.classList.toggle('open', open);
  dialFab.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#view-dial')) closeDial();
});
dialItems.querySelectorAll('.dial-item').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.action === 'home') {
      map.flyTo({ center: MAP_HOME.center, zoom: MAP_HOME.zoom, duration: 800 });
    } else if (btn.dataset.action === 'info') {
      noteOverlay.classList.contains('open') ? closeNote() : openNote();
    } else if (btn.dataset.action === 'ranking') {
      sidePanel.classList.contains('closed') ? openSidePanel() : closeSidePanel();
    } else if (btn.dataset.action === 'theme') {
      setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    } else if (btn.dataset.action === 'fullscreen') {
      toggleFullscreen();
    } else if (btn.dataset.action === 'satellite') {
      toggleSatellite();
    } else if (btn.dataset.action === 'opacity') {
      opacityPanel.classList.contains('open') ? closeOpacityPanel() : openOpacityPanel();
    } else if (btn.dataset.view) {
      switchView(btn.dataset.view);
    }
    closeDial();
  });
});

/* ── Pannellino trasparenza poligoni: applica l'opacita del fill solo al
   layer della vista attiva (le altre restano a 0), quindi ogni switchView
   deve riusare la stessa variabile invece di un valore fisso. ── */
const opacityPanel = document.getElementById('opacity-panel');
const opacityDialBtn = document.getElementById('opacity-dial-btn');
const opacitySlider = document.getElementById('opacity-slider');
const opacityValueEl = document.getElementById('opacity-value');
opacitySlider.value = Math.round(fillOpacity * 100);
opacityValueEl.textContent = `${opacitySlider.value}%`;

function openOpacityPanel() { opacityPanel.classList.add('open'); opacityDialBtn.classList.add('active'); }
function closeOpacityPanel() { opacityPanel.classList.remove('open'); opacityDialBtn.classList.remove('active'); }

opacitySlider.addEventListener('input', () => {
  fillOpacity = parseInt(opacitySlider.value, 10) / 100;
  opacityValueEl.textContent = `${opacitySlider.value}%`;
  localStorage.setItem(FILL_OPACITY_KEY, String(fillOpacity));
  if (map.getLayer(`${currentView}-fill`)) map.setPaintProperty(`${currentView}-fill`, 'fill-opacity', fillOpacity);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#opacity-panel') && !e.target.closest('#opacity-dial-btn')) closeOpacityPanel();
});

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}
document.addEventListener('fullscreenchange', () => {
  const btn = document.getElementById('fullscreen-toggle');
  const active = !!document.fullscreenElement;
  btn.querySelector('.icon-expand').style.display = active ? 'none' : 'block';
  btn.querySelector('.icon-collapse').style.display = active ? 'block' : 'none';
});

/* ── Filtro geografico interconnesso: Regione → Provincia → Comune ─────
   Le stesse selezioni filtrano entrambe le viste (Comuni/Province), a
   scala diversa: la vista Comuni usa regione/sigla_prov/pro_com sulle
   feature; la vista Province ha solo sigla_prov, quindi una Regione
   selezionata diventa un filtro "in" sull'elenco delle sue province. */
let HIERARCHY = null; // { regioni: {...}, comuni_bbox: {...} }
const geoState = { regione: '', provincia: '', comune: '', comuneNome: '', comuneProvincia: '', bivarClass: '', bivarClass2: '', classComuni: '', classProvince: '' };

/* Legenda comuni/province: righe cliccabili che filtrano la mappa e le
   classifiche per classe di potere d'acquisto (1-5), combinandosi (AND) con
   il filtro geografico regione/provincia/comune già attivo — stesso pattern
   della legenda bivariata. */
function setClassFilter(view, cls) {
  const key = view === 'comuni' ? 'classComuni' : 'classProvince';
  geoState[key] = geoState[key] === cls ? '' : cls;
  const legend = document.querySelector(`.legend-filter[data-legend-view="${view}"]`);
  legend.querySelectorAll('.row[data-class]').forEach(r => r.classList.toggle('active', r.dataset.class === geoState[key]));
  legend.querySelector('.legend-clear').style.display = geoState[key] ? 'block' : 'none';
  applyGeoFilters();
}
document.querySelectorAll('.legend-filter .row[data-class]').forEach(el => {
  const view = el.closest('.legend-filter').dataset.legendView;
  el.addEventListener('click', () => setClassFilter(view, el.dataset.class));
});
document.querySelectorAll('.legend-clear').forEach(btn => {
  btn.addEventListener('click', () => setClassFilter(btn.dataset.legendClear, ''));
});

/* Setup generico della legenda bivariata (griglia 3x3 cliccabile + hover):
   usato sia dalla vista Bivariata (reddito x costo vita) sia dalla vista
   Bivariata reddito (reddito nominale x potere d'acquisto reale) — stesso
   markup/pattern, container e chiave di geoState diversi. */
function setupBivarLegend(containerId, stateKey) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const hoverEl = container.querySelector('.bivar-hover');
  const clearBtn = container.querySelector('.bivar-clear');
  function setClass(cls) {
    geoState[stateKey] = geoState[stateKey] === cls ? '' : cls;
    container.querySelectorAll('.bivar-grid .bs').forEach(b => b.classList.toggle('active', b.dataset.class === geoState[stateKey]));
    clearBtn.style.display = geoState[stateKey] ? 'block' : 'none';
    applyGeoFilters();
  }
  container.querySelectorAll('.bivar-grid .bs').forEach(el => {
    el.addEventListener('mouseenter', () => { hoverEl.textContent = el.title; });
    el.addEventListener('mouseleave', () => { hoverEl.textContent = ''; });
    el.addEventListener('click', () => setClass(el.dataset.class));
  });
  clearBtn.addEventListener('click', () => {
    geoState[stateKey] = '';
    container.querySelectorAll('.bivar-grid .bs').forEach(b => b.classList.remove('active'));
    clearBtn.style.display = 'none';
    applyGeoFilters();
  });
}
setupBivarLegend('legend-bivar', 'bivarClass');
setupBivarLegend('legend-bivar-reddito', 'bivarClass2');

const fRegione   = document.getElementById('f-regione');
const fProvincia = document.getElementById('f-provincia');
const fComune    = document.getElementById('f-comune');
const geoBtnZoom = document.getElementById('geo-btn-zoom');

function regioniList() { return HIERARCHY ? Object.keys(HIERARCHY.regioni).sort() : []; }
function provinceOf(regione) { return HIERARCHY && regione ? HIERARCHY.regioni[regione].province : {}; }
function comuniOf(regione, sigla) {
  const p = provinceOf(regione)[sigla];
  return p ? p.comuni : [];
}

function populateProvince(regione) {
  fProvincia.innerHTML = '<option value="">— Tutte —</option>';
  fComune.innerHTML = '<option value="">— Tutti —</option>';
  fProvincia.disabled = !regione;
  fComune.disabled = true;
  if (!regione) return;
  Object.entries(provinceOf(regione)).sort((a, b) => a[1].nome.localeCompare(b[1].nome)).forEach(([sigla, p]) => {
    const o = document.createElement('option');
    o.value = sigla; o.textContent = p.nome;
    fProvincia.appendChild(o);
  });
}

function populateComuni(regione, sigla) {
  fComune.innerHTML = '<option value="">— Tutti —</option>';
  fComune.disabled = !sigla;
  if (!regione || !sigla) return;
  comuniOf(regione, sigla).forEach(c => {
    const o = document.createElement('option');
    o.value = c.c; o.textContent = c.n;
    fComune.appendChild(o);
  });
}

fRegione.addEventListener('change', () => {
  geoState.regione = fRegione.value; geoState.provincia = ''; geoState.comune = ''; geoState.comuneProvincia = '';
  populateProvince(fRegione.value);
  applyGeoFilters(); updateGeoChips();
});
fProvincia.addEventListener('change', () => {
  geoState.provincia = fProvincia.value; geoState.comune = ''; geoState.comuneProvincia = '';
  populateComuni(geoState.regione, fProvincia.value);
  applyGeoFilters(); updateGeoChips();
});
fComune.addEventListener('change', () => {
  geoState.comune = fComune.value;
  geoState.comuneProvincia = fComune.value ? geoState.provincia : '';
  const opt = fComune.selectedOptions[0];
  geoState.comuneNome = opt ? opt.textContent : '';
  applyGeoFilters(); updateGeoChips();
});

function geoConditionsForView(view) {
  const c = [];
  if (view === 'comuni' || view === 'bivariata' || view === 'bivariataReddito' || view === 'redditiComuni') {
    if (geoState.regione) c.push(['==', ['get', 'regione'], geoState.regione]);
    if (geoState.provincia) c.push(['==', ['get', 'sigla_prov'], geoState.provincia]);
    if (geoState.comune) c.push(['==', ['get', 'pro_com'], String(geoState.comune).padStart(6, '0')]);
    if (view === 'bivariata' && geoState.bivarClass) c.push(['==', ['get', 'bivar_class'], geoState.bivarClass]);
    if (view === 'bivariataReddito' && geoState.bivarClass2) c.push(['==', ['get', 'bivar2_class'], geoState.bivarClass2]);
    if (view === 'comuni' && geoState.classComuni) c.push(['==', ['get', 'classe_potere_acquisto'], +geoState.classComuni]);
  } else {
    if (geoState.provincia) {
      c.push(['==', ['get', 'sigla_prov'], geoState.provincia]);
    } else if (geoState.regione) {
      const provs = Object.keys(provinceOf(geoState.regione));
      c.push(['in', ['get', 'sigla_prov'], ['literal', provs]]);
    }
    if (view === 'province' && geoState.classProvince) c.push(['==', ['get', 'classe_potere_acquisto'], +geoState.classProvince]);
  }
  return c;
}

function mkGeoFilter(conds) {
  if (conds.length === 0) return null;
  if (conds.length === 1) return conds[0];
  return ['all', ...conds];
}

const MAP_HOME = { center: [12.5, 42.5], zoom: 5.2 };

function bboxOf() {
  if (geoState.comune) return HIERARCHY.comuni_bbox[String(geoState.comune)];
  if (geoState.provincia) return provinceOf(geoState.regione)[geoState.provincia]?.bbox;
  if (geoState.regione) return HIERARCHY.regioni[geoState.regione]?.bbox;
  return null;
}

function zoomToSelection() {
  const b = bboxOf();
  if (b) {
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, duration: 700 });
  } else {
    map.flyTo({ center: MAP_HOME.center, zoom: MAP_HOME.zoom, duration: 700 });
  }
}

function applyGeoFilters() {
  for (const view of Object.keys(VIEWS)) {
    const fillId = `${view}-fill`;
    if (!map.getLayer(fillId)) continue;
    const f = mkGeoFilter(geoConditionsForView(view));
    map.setFilter(fillId, f);
    map.setFilter(`${view}-line`, f);
  }
  const hasSel = !!(geoState.regione || geoState.provincia || geoState.comune);
  geoBtnZoom.disabled = !hasSel;
  zoomToSelection();
  if (RANKINGS) renderAllRankings();
  syncUrlFromGeoState();
}

/* ── Routing: regione/provincia/comune riflessi nell'indirizzo (query
   string, cosi' il deep-link funziona anche su hosting statico senza
   rewrite lato server) e ripristinati al caricamento o con back/forward. ── */
function syncUrlFromGeoState() {
  const p = new URLSearchParams();
  if (geoState.regione) p.set('regione', geoState.regione);
  if (geoState.provincia) p.set('provincia', geoState.provincia);
  if (geoState.comune) p.set('comune', geoState.comune);
  const qs = p.toString();
  const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  if (url !== window.location.pathname + window.location.search + window.location.hash) {
    history.replaceState(null, '', url);
  }
}

function restoreGeoStateFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const reg = p.get('regione'), prov = p.get('provincia'), com = p.get('comune');

  fRegione.value = ''; populateProvince('');
  geoState.regione = ''; geoState.provincia = ''; geoState.comune = ''; geoState.comuneProvincia = '';

  if (reg && HIERARCHY.regioni[reg]) {
    fRegione.value = reg; geoState.regione = reg; populateProvince(reg);
    if (prov && provinceOf(reg)[prov]) {
      fProvincia.value = prov; geoState.provincia = prov; populateComuni(reg, prov);
      const c = com && comuniOf(reg, prov).find(x => String(x.c) === com);
      if (c) { fComune.value = String(c.c); geoState.comune = String(c.c); geoState.comuneProvincia = prov; geoState.comuneNome = c.n; }
    }
  }
  applyGeoFilters();
  updateGeoChips();
}
window.addEventListener('popstate', restoreGeoStateFromUrl);

geoBtnZoom.addEventListener('click', zoomToSelection);

const REGIONE_LABEL = r => r.replace(/\(P\.A\.(.+)\)/, ' — P.A. $1');

function updateGeoChips() {
  const chipsEl = document.getElementById('geo-chips');
  const filterBtn = document.getElementById('geo-filter-btn');
  const filterBadge = document.getElementById('geo-filter-badge');
  const active = [];
  if (geoState.regione) active.push({ label: REGIONE_LABEL(geoState.regione), clear: 'regione' });
  if (geoState.provincia) active.push({ label: provinceOf(geoState.regione)[geoState.provincia]?.nome || geoState.provincia, clear: 'provincia' });
  if (geoState.comune) active.push({ label: geoState.comuneNome, clear: 'comune' });

  chipsEl.style.display = active.length ? 'flex' : 'none';
  filterBadge.style.display = active.length ? 'flex' : 'none';
  filterBadge.textContent = active.length;
  filterBtn.classList.toggle('active', active.length > 0);

  let html = active.map(f => `
    <span class="geo-chip">${f.label}<button class="geo-chip-close" data-clear="${f.clear}">✕</button></span>
  `).join('');
  if (active.length > 1) html += `<button class="geo-chip geo-chip-resetall" id="geo-chips-resetall">✕ tutti</button>`;
  chipsEl.innerHTML = html;

  chipsEl.querySelectorAll('.geo-chip-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.clear;
      if (c === 'regione') { fRegione.value = ''; geoState.regione = ''; populateProvince(''); geoState.provincia = ''; geoState.comune = ''; }
      if (c === 'provincia') { fProvincia.value = ''; geoState.provincia = ''; populateComuni(geoState.regione, ''); geoState.comune = ''; }
      if (c === 'comune') { fComune.value = ''; geoState.comune = ''; geoState.comuneProvincia = ''; }
      applyGeoFilters(); updateGeoChips();
    });
  });
  const ra = document.getElementById('geo-chips-resetall');
  if (ra) ra.addEventListener('click', resetGeoFilters);
}

function resetGeoFilters() {
  fRegione.value = ''; populateProvince('');
  geoState.regione = ''; geoState.provincia = ''; geoState.comune = ''; geoState.comuneProvincia = '';
  applyGeoFilters(); updateGeoChips();
}

/* ── Search + suggerimenti ── */
const geoSearchInput = document.getElementById('geo-search-input');
const geoSearchClear = document.getElementById('geo-search-clear');
const geoSearchDD = document.getElementById('geo-search-dd');
const geoFilterBtn = document.getElementById('geo-filter-btn');
const geoFilterOverlay = document.getElementById('geo-filter-overlay');
const geoFilterModal = document.getElementById('geo-filter-modal');

let SUGGESTIONS = [];
function buildSuggestions() {
  const items = [];
  Object.entries(HIERARCHY.regioni).forEach(([reg, rData]) => {
    items.push({ type: 'regione', label: REGIONE_LABEL(reg), value: reg });
    Object.entries(rData.province).forEach(([sigla, p]) => {
      items.push({ type: 'provincia', label: p.nome, value: sigla, regione: reg });
      p.comuni.forEach(c => {
        items.push({ type: 'comune', label: c.n, value: String(c.c), regione: reg, provincia: sigla });
      });
    });
  });
  return items;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
function highlight(text, query) {
  const safe = esc(text);
  if (!query) return safe;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}
const TYPE_LABELS = { regione: 'Regione', provincia: 'Provincia', comune: 'Comune' };

function renderGeoDD(query) {
  const q = query.trim().toLowerCase();
  const matches = q.length === 0 ? [] : SUGGESTIONS.filter(s => s.label.toLowerCase().includes(q)).slice(0, 12);

  if (matches.length === 0) {
    geoSearchDD.innerHTML = q.length > 0 ? `<div class="geo-dd-empty">Nessun risultato per &ldquo;${esc(q)}&rdquo;</div>` : '';
    geoSearchDD.classList.toggle('open', q.length > 0);
    return;
  }

  let html = '';
  let lastType = null;
  matches.forEach(m => {
    if (m.type !== lastType) { html += `<div class="geo-dd-cat">${TYPE_LABELS[m.type]}</div>`; lastType = m.type; }
    html += `<div class="geo-dd-item" data-type="${m.type}" data-value="${esc(m.value)}" data-regione="${esc(m.regione || '')}" data-provincia="${esc(m.provincia || '')}">
      <span>${highlight(m.label, query.trim())}</span><span class="geo-dd-badge">${TYPE_LABELS[m.type]}</span>
    </div>`;
  });
  geoSearchDD.innerHTML = html;
  geoSearchDD.classList.add('open');
  geoSearchDD.querySelectorAll('.geo-dd-item').forEach(el => el.addEventListener('click', () => selectGeoSuggestion(el)));
}

function selectGeoSuggestion(el) {
  const type = el.dataset.type, value = el.dataset.value, regione = el.dataset.regione, provincia = el.dataset.provincia;
  if (type === 'regione') {
    fRegione.value = value; geoState.regione = value; populateProvince(value);
    geoState.provincia = ''; geoState.comune = '';
  } else if (type === 'provincia') {
    fRegione.value = regione; geoState.regione = regione; populateProvince(regione);
    fProvincia.value = value; geoState.provincia = value; populateComuni(regione, value);
    geoState.comune = '';
  } else if (type === 'comune') {
    fRegione.value = regione; geoState.regione = regione; populateProvince(regione);
    fProvincia.value = provincia; geoState.provincia = provincia; populateComuni(regione, provincia);
    fComune.value = value; geoState.comune = value; geoState.comuneProvincia = provincia;
    geoState.comuneNome = el.querySelector('span').textContent;
  }
  applyGeoFilters();
  geoSearchInput.value = ''; geoSearchClear.style.display = 'none'; geoSearchDD.classList.remove('open');
  updateGeoChips();
}

geoSearchInput.addEventListener('input', () => {
  geoSearchClear.style.display = geoSearchInput.value ? '' : 'none';
  renderGeoDD(geoSearchInput.value);
});
geoSearchClear.addEventListener('click', () => {
  geoSearchInput.value = ''; geoSearchClear.style.display = 'none'; geoSearchDD.classList.remove('open');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#geo-searchbar')) geoSearchDD.classList.remove('open');
});

geoFilterBtn.addEventListener('click', () => { geoFilterModal.classList.add('open'); geoFilterOverlay.classList.add('open'); panelOpened(); });
document.getElementById('geo-pfm-close').addEventListener('click', closeGeoFilterModal);
geoFilterOverlay.addEventListener('click', closeGeoFilterModal);
document.getElementById('geo-pfm-reset').addEventListener('click', () => { resetGeoFilters(); closeGeoFilterModal(); });
document.getElementById('geo-pfm-apply').addEventListener('click', () => { applyGeoFilters(); updateGeoChips(); closeGeoFilterModal(); });
function closeGeoFilterModal() {
  if (!geoFilterModal.classList.contains('open')) return;
  geoFilterModal.classList.remove('open'); geoFilterOverlay.classList.remove('open'); panelClosed();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeGeoFilterModal(); });

fetch('dist/geo/geo_hierarchy.json')
  .then(r => r.json())
  .then(d => {
    HIERARCHY = d;
    regioniList().forEach(r => {
      const o = document.createElement('option');
      o.value = r; o.textContent = REGIONE_LABEL(r);
      fRegione.appendChild(o);
    });
    SUGGESTIONS = buildSuggestions();
    restoreGeoStateFromUrl();
  });
