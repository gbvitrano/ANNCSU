# ANNCSU – Analisi Numeri Civici

Esplora i dati dell'**ANNCSU** — l'Anagrafe Nazionale dei Numeri Civici Stradali Urbani — gestita dall'**Agenzia delle Entrate**. Ogni punto sulla mappa è un numero civico italiano: puoi navigare su tutto il territorio nazionale e osservare come sono distribuiti gli indirizzi nei diversi comuni.

🔗 **[Apri l'applicazione](https://gbvitrano.github.io/ANNCSU/)**

---

## Funzionalità

### I colori dei civici

I punti **verdi** rappresentano civici geocodificati correttamente, la cui posizione ricade all'interno del confine del comune di appartenenza. I punti **rossi** segnalano civici "fuori confine": la coordinata registrata cade al di fuori del territorio comunale di riferimento, indicando un possibile errore di posizionamento o un dato da verificare.

### Filtri e ricerca

Puoi restringere la visualizzazione usando i menu a tendina in alto per selezionare una o più **regioni**, una o più **province**, oppure un singolo **comune**. I tre pulsanti *Tutti*, *Geocodificati* e *Fuori limite* permettono di isolare rapidamente i soli civici corretti o quelli anomali. La mappa si aggiorna in tempo reale a ogni modifica del filtro.

### I comuni finanziati con il PNRR

Attivando il layer dei comuni tramite il pulsante mappa nella barra degli strumenti, compaiono i poligoni comunali colorati per **aggiudicatario**: ogni colore identifica l'azienda o il professionista che ha vinto il contratto per aggiornare i dati ANNCSU in quel comune nell'ambito della **Misura 1.3.1 del PNRR**. I comuni senza aggiudicatario appaiono in grigio. Cliccando su un poligono si apre un popup con i dettagli del finanziamento e il conteggio dei civici visibili.

### Analisi degli aggiudicatari

Il pulsante con l'icona tabella (visibile solo quando il layer dei comuni è attivo) apre il **pannello di analisi degli aggiudicatari**. Qui si trova un riepilogo completo: quanti comuni ha in gestione ciascun aggiudicatario, in quante province e regioni opera, l'importo totale dei finanziamenti ricevuti e la sua quota percentuale sul totale nazionale. È possibile cercare un aggiudicatario specifico, selezionarlo per evidenziarne i comuni sulla mappa, centrare la vista su di essi e scaricare tutti i dati in formato CSV.

### Statistiche per comune

Il pannello statistiche (icona tabella, in alto a destra) mostra un riepilogo dei civici visibili nella porzione di mappa inquadrata, suddivisi per comune con il numero di indirizzi corretti, quelli fuori confine e la percentuale di qualità. I valori si aggiornano automaticamente spostando o zoomando la mappa.

### Analisi dei civici fuori confine

Dal pannello di analisi (icona target) è possibile vedere l'elenco dei comuni con civici anomali visibili nella vista corrente. Cliccando su un comune i punti relativi vengono evidenziati in giallo e la vista si centra su di essi. È possibile avviare una **verifica tramite geocodifica inversa** (OpenStreetMap Nominatim) per scoprire in quale territorio ricadono realmente le coordinate fuori confine. Il pulsante CSV esporta tutti i civici anomali visibili con le relative coordinate.

### Tecnologie

La mappa è realizzata con **MapLibre GL JS**. I dati vettoriali sono in formato **PMTiles**, che permette di servire milioni di punti direttamente dal browser senza un server dedicato. La mappa di base è fornita da **CARTO** su base OpenStreetMap. L'applicazione è open source e gira interamente nel browser, senza installazione.

---

## Fonti dati

### Numeri civici ANNCSU

- [anncsu-open.github.io/anncsu-viewer](https://anncsu-open.github.io/anncsu-viewer/) — Viewer ufficiale dei dati ANNCSU, sviluppato da **Geobeyond**. Fonte primaria dei numeri civici, distribuiti in formato PMTiles per alte prestazioni su scala nazionale.
- [mfortini.github.io/diff_ANNCSU](https://mfortini.github.io/diff_ANNCSU/) — Applicazione di **Matteo Fortini** per visualizzare le differenze tra versioni successive dei dati ANNCSU.

### Confini amministrativi

- [confini-amministrativi.it](https://www.confini-amministrativi.it/) — Portale curato da **OnData** che distribuisce i confini comunali, provinciali e regionali italiani in GeoJSON, Shapefile e PMTiles.

### Finanziamenti PNRR – Misura 1.3.1

Il dataset degli aggiudicatari è stato costruito unendo più fonti open data. Il flusso è stato realizzato da **Dennis Angemi**.

1. **[PA Digitale 2026 · candidature_finanziate_131.csv](https://raw.githubusercontent.com/teamdigitale/padigitale2026-opendata/refs/heads/main/data/candidature_finanziate_131.csv)**
   Candidature approvate per la misura 1.3.1, da cui si estraggono i codici CUP dei progetti ANNCSU.

2. **[ANAC · dataset/cup](https://dati.anticorruzione.it/opendata/opendata/dataset/cup)**
   Associa i CUP ai CIG (Codici Identificativi di Gara).

3. **[ANAC · dataset/aggiudicatari](https://dati.anticorruzione.it/opendata/dataset/aggiudicatari)**
   Per ogni CIG riporta il vincitore del contratto, l'importo aggiudicato e i dettagli economici.

---

## Credits

Web app progettata e sviluppata da [@gbvitrano](https://www.linkedin.com/in/gbvitrano/) in collaborazione con [Claude AI](https://claude.ai) (Anthropic), che ha affiancato le scelte architetturali, l'ottimizzazione del codice e lo sviluppo delle funzionalità di visualizzazione geospaziale.

## Licenza

[![CC BY 4.0](https://licensebuttons.net/l/by/4.0/88x31.png)](https://creativecommons.org/licenses/by/4.0/deed.it)

I contenuti di questa applicazione sono rilasciati sotto licenza [CC BY 4.0 – Attribuzione 4.0 Internazionale](https://creativecommons.org/licenses/by/4.0/deed.it). Sei libero di condividere e adattare il materiale per qualsiasi scopo, anche commerciale, a condizione di citare adeguatamente la fonte.


![01](https://github.com/user-attachments/assets/13335bcd-6b1e-476f-afb4-d2245ea27726) ![02](https://github.com/user-attachments/assets/d353b31d-354d-4462-9265-ba413b0b7ffe)

![03](https://github.com/user-attachments/assets/5f004a17-0829-4ff6-9af5-87a449137743) ![04](https://github.com/user-attachments/assets/0cb08916-a459-43b0-9c72-3f610e03dcb9)

![05](https://github.com/user-attachments/assets/d7ae7706-5401-4caf-a742-79246483222d)




