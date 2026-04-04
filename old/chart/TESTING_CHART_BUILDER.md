# Testing Chart Builder - ANNCSU Adaptation

## Quick Start

1. **Open the file in browser**:
   ```
   file:///d:/GitHub%20-%20Clone/gbvitrano/ANNCSU/index_dataviz.html
   ```

2. **Wait for map to load** (takes a few seconds)

3. **Look for button**: "Crea il tuo DataViz" (bottom right, purple button with pulse animation)

4. **Click the button** to open the chart builder modal

## Testing Flows

### Test 1: Basic Chart Generation (Regione)

1. Open modal
2. Select dimension: **"Regione"**
3. Verify chart type "Barre" is selected (should be default)
4. Click **"Genera Grafico"**
5. **Expected**: Bar chart shows ~20 Italian regions sorted by civici count
6. Verify chart title shows "Regioni"
7. Verify footer shows total civici count and OK percentage
8. Click **"PNG"** button to download chart as image
9. Verify PNG downloads successfully

### Test 2: Different Dimensions

**Provincia**:
1. Select dimension: **"Provincia"**
2. Click "Genera Grafico"
3. Expected: Bar chart shows provinces (PA, CT, ME, etc.)
4. Provinces should show ok/err breakdown

**Comune**:
1. Select dimension: **"Comune"**
2. Click "Genera Grafico"  
3. Expected: Bar chart shows top 10 comuni (limited by default)
4. Each comune shows ok/err count

**Tipo (OK/ERR)**:
1. Select dimension: **"Tipo (OK/ERR)"**
2. Click "Genera Grafico"
3. Expected: Two bars - OK vs ERR (national totals)
4. Should show OK percentage in title

**Aggiudicatore PNRR**:
1. Select dimension: **"Aggiudicatore PNRR"**
2. Click "Genera Grafico"
3. Expected: Bar chart shows top 10 contractors by num_comuni
4. Each contractor name should be visible (truncated if very long)

### Test 3: Different Chart Types

After generating a chart for any dimension:

**Line Chart**:
1. Click line chart button (second button in chart types)
2. Chart should update to show lines instead of bars
3. Points should be visible on lines
4. Grid should be visible

**Pie Chart**:
1. Click pie chart button
2. Chart should display as pie with segments for each category
3. Legend should show all labels

**Doughnut Chart**:
1. Click doughnut button
2. Similar to pie but with center hole
3. Segments should be proportional to values

### Test 4: Styling Options

1. Generate any chart
2. Try **color mode**: "Personalizzato" (custom colors)
3. Try changing primary/secondary colors if selectors appear
4. Verify chart updates with new colors

### Test 5: Browser Console Verification

Open browser DevTools (F12) and check console:

```javascript
// Should show the data store
console.log(window.ANNCSUDataViz)

// Should output stats object with regioni, province, comuni, tipi
console.log(window.ANNCSUDataViz.stats)

// Should show aggiudicatori map
Object.keys(window.ANNCSUDataViz.aggiudicatoriMap).length  // Should be >0

// Should show loaded data messages
// "✅ ANNCSU DataViz module loaded"
// "📊 DataViz Store aggiornato"
// "✅ Comuni caricati: XXXX"
// "✅ Statistiche ANNCSU caricate: XXXX"
// "✅ Aggiudicatori PNRR caricati: XXXX"
```

### Test 6: Edge Cases

**No Dimension Selected**:
1. Open modal without selecting a dimension
2. Click "Genera Grafico"
3. Should show alert: "⚠️ Seleziona una dimensione per generare il grafico"

**Very Large Contractor Names**:
1. Select Aggiudicatore dimension
2. Generate chart
3. Long contractor names should wrap or truncate properly in chart labels

**Responsive Design**:
1. Test on mobile (DevTools device emulation)
2. Modal should stack vertically (config on left, preview on right becomes single column)
3. Chart should fit viewport
4. Legend and buttons should remain usable

## Debug Information

If chart doesn't generate:

1. **Check console errors**: F12 → Console tab
2. **Verify data loaded**: 
   ```javascript
   window.ANNCSUDataViz.stats.regioni  // Should not be empty
   ```
3. **Check dimension value**:
   ```javascript
   document.getElementById('dimension-select').value  // Should match selected option
   ```
4. **Verify Chart.js loaded**:
   ```javascript
   typeof Chart  // Should be 'function'
   ```

## Expected Console Output

When page loads, you should see:

```
✅ ANNCSU DataViz module loaded
✅ Comuni caricati: XXXX
✅ Statistiche ANNCSU caricate: XXXX
📊 DataViz Store aggiornato: {...}
✅ Aggiudicatori PNRR caricati: XXXX
📊 Comuni con aggiudicatori: XXXX
```

## Performance Notes

- First chart generation may take 1-2 seconds (data aggregation)
- Subsequent charts are faster (data already aggregated)
- Large limits (>50 items) may slow down pie/doughnut charts
- PNG download may take 2-3 seconds for complex charts

## Known Limitations in Current Implementation

- ✗ No time-based filtering (data is current snapshot)
- ✗ No multi-select for dimensions (one at a time)
- ✗ Limited chart types in UI (4 out of 9 available)
- ✗ Mixed chart type button not visible (feature exists, not exposed)
- ✗ No metric selection UI (defaults to 'count')

## Success Criteria

✅ Chart builder modal opens and closes smoothly  
✅ All 5 dimensions can be selected and generate charts  
✅ All 4 chart types (bar, line, pie, doughnut) render correctly  
✅ Chart titles update based on selected dimension  
✅ Footer statistics show correct civici count and percentage  
✅ PNG download works without errors  
✅ No JavaScript errors in console  
✅ Modal is responsive on mobile/tablet  

## Reporting Issues

If you find any issues:
1. Note the exact steps to reproduce
2. Check browser console for error messages
3. Check that all data files are accessible (dati/comuni.csv, dati/anncsu_stats.json, dati/aggiudicatori.csv)
4. Include screenshot of the error or unexpected behavior
