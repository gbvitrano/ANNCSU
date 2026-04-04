# Chart Builder - ANNCSU Adaptation Summary

## Changes Made

The chart builder has been adapted from the Palermo-Incidenti implementation to work with ANNCSU data structure.

### 1. **Data Preparation Function (`prepareChartData`)**
- **Old**: Expected filtered data arrays with incident-specific fields
- **New**: Aggregates directly from `window.ANNCSUDataViz.stats` 
- **Dimensions Handled**:
  - `regione` → stats.regioni (ok/err counts)
  - `provincia` → stats.province (ok/err counts)  
  - `comune` → stats.comuni (ok/err counts)
  - `tipo` → stats.tipi (OK vs ERR global)
  - `aggiudicatore` → aggiudicatoriMap (contractors with import amounts)

### 2. **Dataset Preparation (`prepareChartDatasets`)**
- **Old**: Supported 'count' and 'tipologia' (M/R/F/C) metrics
- **New**: Supports 3 metrics:
  - `count` - generic count of civici
  - `ok_err` - breakdown by OK/ERR status (not yet enabled in HTML)
  - `importo` - financial amounts for contractors dimension

### 3. **Chart Options (`getChartOptions`)**
- Removed references to Palermo incident filters (anno, mese, stagione, etc.)
- Added dimension name mapping for proper chart titles
- ANNCSU uses simpler configuration without temporal filters

### 4. **Footer Statistics (`updateFooterStats`)**
- **Old**: Showed incident count and time period filters
- **New**: Shows total civici, OK percentage, and "ANNCSU Dati Attuali"

### 5. **Cleaned Up Functions**
- Removed `sortByDimension()` - no longer needed for ANNCSU temporal sorting
- Kept `initTipologieCheckboxes()` and `updateTipologieVisibility()` - they harmlessly reference non-existent HTML elements

## Data Flow

```
User selects dimension & clicks "Genera Grafico"
        ↓
generateCustomChart()
        ↓
Validates window.ANNCSUDataViz is loaded
        ↓
prepareChartData() 
  → Aggregates data by selected dimension from window.ANNCSUDataViz.stats
  → Sorts & applies limit
  → Returns { label, value, ok, err, ... }
        ↓
renderCustomChart()
  → prepareChartDatasets() → Creates datasets with styling
  → getChartOptions() → Applies configuration
  → Chart.js renders canvas
```

## Supported Chart Types

- **Bar** (vertical columns)
- **Line** (with optional area fill)
- **Pie** (proportional pie chart)
- **Doughnut** (pie with center hole)

*Note: Full implementation supports 9+ types. Additional types (radar, scatter, bubble, mixed, polarArea) are coded but not exposed in current HTML.*

## Configuration Options Active

### Chart Display
- Type selection (bar, line, pie, doughnut)
- Dimension selection (regione, provincia, comune, tipo, aggiudicatore)
- Custom title input
- Color mode (auto/custom)
- Limit (default 10 items)

### Styling
- Border width, opacity, font sizes
- Grid, legend, animation controls  
- Colors and gradients

## Testing Checklist

- [ ] Data loads: Check `console.log(window.ANNCSUDataViz)` shows populated stats
- [ ] Regione dimension: Shows ~20 regions sorted by civici count
- [ ] Provincia dimension: Shows provinces with ok/err breakdown
- [ ] Comune dimension: Shows communes with ok/err breakdown  
- [ ] Tipo dimension: Shows OK vs ERR (2 bars)
- [ ] Aggiudicatore dimension: Shows top 10 contractors by num_comuni
- [ ] Chart types: Bar, Line, Pie, Doughnut render correctly
- [ ] Legend and tooltip display correct values
- [ ] Download PNG works
- [ ] Modal responsive on mobile/tablet

## Known Limitations

- No temporal filters (ANNCSU data is static/current)
- No "tipologia" metric for categorizing civici types (data structure doesn't support this)
- Chart type buttons in HTML only expose 4 types (could extend to 9+)
- Mixed chart mode implemented but not tested with ANNCSU data

## Next Steps (Optional)

1. Add missing chart type buttons for: radar, scatter, bubble, mixed, polarArea
2. Implement `ok_err` metric selection in HTML
3. Add dimension-specific metric switching (e.g., "importo" auto-selects for aggiudicatore)
4. Add filter controls for regione/provincia to constrain data before charting
5. Test all chart types with real ANNCSU data in browser
