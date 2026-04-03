# Dataset ANAC – file locali

Questa cartella contiene i dataset ANAC scaricati manualmente.
Lo script `scripts/fetch_aggiudicatori.py` li usa al posto del download diretto
(che viene bloccato dagli IP di GitHub Actions).

## File da scaricare e copiare qui

| File | URL | Dimensione |
|------|-----|------------|
| `cup_csv.zip` | https://dati.anticorruzione.it/opendata/download/dataset/cup/filesystem/cup_csv.zip | ~74 MB |
| `aggiudicatari_csv.zip` | https://dati.anticorruzione.it/opendata/download/dataset/aggiudicatari/filesystem/aggiudicatari_csv.zip | ~763 MB |
| `aggiudicazioni_csv.zip` | https://dati.anticorruzione.it/opendata/download/dataset/aggiudicazioni/filesystem/aggiudicazioni_csv.zip | ~724 MB |

## Note

- I file grandi (> 100 MB) richiedono **Git LFS** per essere committati.
- In alternativa ai full dump si possono usare i file datati mensili (molto piu' piccoli):
  - `20260401-aggiudicatari_csv.zip` (~22 MB)
  - `20260401-aggiudicazioni_csv.zip` (~10 MB)
  (copertura solo sui gare recenti, non storica)
- Lo script cerca prima il file con lo stesso nome dell'URL, quindi:
  - metti `cup_csv.zip` per il full cup dataset
  - metti `aggiudicatari_csv.zip` per il full aggiudicatari
  - metti `20260401-aggiudicatari_csv.zip` per il datato
  (usa quello che hai; lo script prova prima il datato, poi il full)
- I file ZIP **non vengono mai estratti su disco**: vengono letti in streaming.
