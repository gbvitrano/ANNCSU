#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pipeline: Candidature finanziate ANNCSU Misura 1.3.1
1. Scarica candidature da PA Digitale 2026, filtra ANNCSU -> CUP
2. ANAC cup_csv.zip: CUP -> CIG (streaming, nessuna estrazione)
3. ANAC aggiudicatari_csv.zip: CIG -> denominazione, CF, ruolo
4. ANAC aggiudicazioni_csv.zip: CIG -> importo aggiudicazione
5. Salva dati/aggiudicatori.csv, backup in dati/backup/
"""

import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import csv
import glob
import io
import os
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone

import pandas as pd
import requests

# ── Configurazione ────────────────────────────────────────────────────────────
CANDIDATURE_URL = (
    "https://raw.githubusercontent.com/teamdigitale/padigitale2026-opendata"
    "/refs/heads/main/data/candidature_finanziate_131.csv"
)
CUP_ZIP_URL = (
    "https://dati.anticorruzione.it/opendata/download/dataset/cup/filesystem/cup_csv.zip"
)
# File datati (snapshot mensile, molto più piccoli): tentativo primario
# Fallback al full dump se il file datato non copre tutti i CIG cercati
AGGIUDICATARI_ZIP_URL_DATED = (
    "https://dati.anticorruzione.it/opendata/download/dataset/aggiudicatari/filesystem/20260401-aggiudicatari_csv.zip"
)
AGGIUDICATARI_ZIP_URL_FULL = (
    "https://dati.anticorruzione.it/opendata/download/dataset/aggiudicatari/filesystem/aggiudicatari_csv.zip"
)
AGGIUDICAZIONI_ZIP_URL_DATED = (
    "https://dati.anticorruzione.it/opendata/download/dataset/aggiudicazioni/filesystem/20260401-aggiudicazioni_csv.zip"
)
AGGIUDICAZIONI_ZIP_URL_FULL = (
    "https://dati.anticorruzione.it/opendata/download/dataset/aggiudicazioni/filesystem/aggiudicazioni_csv.zip"
)

OUTPUT_DIR = "dati"
BASE_NAME = "aggiudicatori"
MAX_BACKUPS = 1
# ─────────────────────────────────────────────────────────────────────────────


def log(msg: str):
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')} UTC] {msg}", flush=True)


UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    "Referer": "https://dati.anticorruzione.it/opendata",
}

COOKIE_JAR = tempfile.NamedTemporaryFile(delete=False, suffix=".cookies").name


def _init_session():
    """Visita il portale ANAC con curl per ottenere i cookie di sessione."""
    portal = "https://dati.anticorruzione.it/opendata"
    log(f"Init sessione ANAC: {portal}")
    subprocess.run(
        [
            "curl", "-s", "-L",
            "-c", COOKIE_JAR,
            "-A", UA,
            "-o", os.devnull,
            portal,
        ],
        timeout=30,
        check=False,
    )


def _curl_head(url: str) -> str:
    """Esegue HEAD request e restituisce le prime righe degli header per diagnosi."""
    result = subprocess.run(
        ["curl", "-sI", "-L", "-A", UA,
         "-H", "Referer: https://dati.anticorruzione.it/opendata",
         "--max-time", "15", url],
        capture_output=True, text=True, timeout=20, check=False,
    )
    return (result.stdout + result.stderr)[:800]


def download_to_temp(url: str) -> str:
    """Scarica tramite curl con cookie jar, restituisce il path del file temp."""
    log(f"Download: {url}")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()

    cmd = [
        "curl", "-L", "--fail",
        "-b", COOKIE_JAR, "-c", COOKIE_JAR,
        "-A", UA,
        "-H", "Accept: application/octet-stream,*/*;q=0.8",
        "-H", "Accept-Language: it-IT,it;q=0.9,en;q=0.8",
        "-H", "Referer: https://dati.anticorruzione.it/opendata",
        "--compressed",
        "--connect-timeout", "30",
        "--max-time", "600",
        "--retry", "3",
        "--retry-delay", "10",
        "-o", tmp.name,
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=660)

    if result.returncode != 0:
        # Diagnosi: mostra gli header HTTP effettivi
        log(f"  curl fallito (exit {result.returncode}). Diagnosi HEAD request:")
        log(_curl_head(url))
        raise RuntimeError(
            f"Download fallito (curl exit {result.returncode}) per {url}\n"
            f"stderr: {result.stderr[:400]}"
        )

    size = os.path.getsize(tmp.name)
    if size < 1024:
        # File troppo piccolo — probabilmente una pagina di errore HTML
        with open(tmp.name, "rb") as f:
            snippet = f.read(300).decode("utf-8", errors="replace")
        os.unlink(tmp.name)
        raise RuntimeError(
            f"File scaricato sospetto ({size} byte) per {url}.\n"
            f"Contenuto: {snippet}"
        )

    log(f"  {size / 1_048_576:.1f} MB -> {tmp.name}")
    return tmp.name


def _detect_delimiter(line: str) -> str:
    for delim in [";", ",", "\t"]:
        if delim in line:
            return delim
    return ","


def stream_filter_zip(zip_path: str, filter_col_hints: list, filter_values: set) -> pd.DataFrame:
    """
    Apre il CSV dentro lo ZIP, lo scorre riga per riga e restituisce solo
    le righe in cui la colonna indicata da filter_col_hints è in filter_values.
    Non estrae mai l'intero archivio su disco.
    """
    filter_values_upper = {v.strip().upper() for v in filter_values if v}

    with zipfile.ZipFile(zip_path, "r") as zf:
        csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not csv_names:
            raise ValueError(f"Nessun CSV trovato nello zip {zip_path}")
        csv_name = csv_names[0]
        info = zf.getinfo(csv_name)
        log(f"  Leggo: {csv_name} ({info.file_size / 1_048_576:.0f} MB non compresso)")

        with zf.open(csv_name) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8", errors="replace")
            first_line = text.readline()
            delimiter = _detect_delimiter(first_line)
            # Usa csv.reader per gestire correttamente i campi quotati ("CIG";"CUP")
            header = [
                h.strip().strip('"').strip("'").upper()
                for h in next(csv.reader([first_line], delimiter=delimiter))
            ]
            log(f"  Delimiter='{delimiter}', colonne={len(header)}")

            # Trova indice colonna di filtro
            filter_idx = None
            for hint in filter_col_hints:
                if hint.upper() in header:
                    filter_idx = header.index(hint.upper())
                    log(f"  Colonna filtro: {hint.upper()} (idx {filter_idx})")
                    break

            if filter_idx is None:
                log(f"  ATTENZIONE: nessuna colonna tra {filter_col_hints} trovata. Header: {header[:15]}")
                return pd.DataFrame(columns=header)

            rows = []
            reader = csv.reader(text, delimiter=delimiter)
            processed = 0
            for row in reader:
                processed += 1
                if filter_idx < len(row) and row[filter_idx].strip().upper() in filter_values_upper:
                    rows.append(row)
                if processed % 2_000_000 == 0:
                    log(f"  Processate {processed:,} righe, trovate {len(rows):,}")

    log(f"  Fine: {processed:,} righe processate, {len(rows):,} trovate")
    return pd.DataFrame(rows, columns=header) if rows else pd.DataFrame(columns=header)


# ─── Step 1 ──────────────────────────────────────────────────────────────────

def step1_candidature() -> pd.DataFrame:
    log("=== STEP 1: Candidature finanziate ANNCSU ===")
    r = requests.get(CANDIDATURE_URL, timeout=60)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    log(f"  Righe totali: {len(df):,}  |  Colonne: {list(df.columns)}")

    # Filtra righe che contengono "ANNCSU" in qualsiasi campo
    mask = df.apply(lambda row: row.astype(str).str.contains("ANNCSU", case=False).any(), axis=1)
    df_anncsu = df[mask].copy()
    log(f"  Righe ANNCSU: {len(df_anncsu):,}")

    # Normalizza nome colonna CUP
    cup_col = next((c for c in df_anncsu.columns if "cup" in c.lower()), None)
    if cup_col and cup_col != "codice_cup":
        df_anncsu = df_anncsu.rename(columns={cup_col: "codice_cup"})

    return df_anncsu


# ─── Step 2 ──────────────────────────────────────────────────────────────────

def step2_cup_to_cig(df: pd.DataFrame) -> pd.DataFrame:
    log("=== STEP 2: CUP -> CIG (ANAC cup dataset) ===")
    cups = set(df["codice_cup"].dropna().str.strip().str.upper())
    log(f"  CUP unici: {len(cups):,}")

    df_cup = _download_and_filter(
        urls=[CUP_ZIP_URL],
        filter_col_hints=["CUP", "CODICE_CUP"],
        filter_values=cups,
    )
    if df_cup.empty:
        log("  ATTENZIONE: nessun CIG trovato. Il CSV avrà CIG vuoto.")
        return df.assign(CIG="")

    # Colonne attendibili nel dataset cup
    cup_col = next((c for c in df_cup.columns if c in ["CUP", "CODICE_CUP"]), None)
    cig_col = next((c for c in df_cup.columns if c in ["CIG", "CODICE_CIG", "CIG_ACCORDO_QUADRO"]), None)

    if not cup_col or not cig_col:
        log(f"  Colonne cup/cig non trovate. Disponibili: {list(df_cup.columns)}")
        return df.assign(CIG="")

    df_cup = df_cup[[cup_col, cig_col]].rename(columns={cup_col: "_cup_upper", cig_col: "CIG"})
    df_cup["_cup_upper"] = df_cup["_cup_upper"].str.strip().str.upper()
    df_cup = df_cup.drop_duplicates(subset=["_cup_upper", "CIG"])

    df["_cup_upper"] = df["codice_cup"].str.strip().str.upper()
    merged = df.merge(df_cup, on="_cup_upper", how="left").drop(columns=["_cup_upper"])
    log(f"  Righe dopo join: {len(merged):,}")
    return merged


# ─── Helper download con fallback ────────────────────────────────────────────

def _download_and_filter(urls: list, filter_col_hints: list, filter_values: set) -> pd.DataFrame:
    """
    Prova ogni URL in sequenza finché uno funziona.
    Restituisce il DataFrame filtrato dal primo download riuscito.
    """
    last_error = None
    for url in urls:
        try:
            zip_path = download_to_temp(url)
            try:
                return stream_filter_zip(zip_path, filter_col_hints, filter_values)
            finally:
                os.unlink(zip_path)
        except Exception as e:
            log(f"  Tentativo fallito ({url}): {e}")
            last_error = e
    log(f"  Tutti i tentativi falliti. Ultimo errore: {last_error}")
    return pd.DataFrame()


# ─── Step 3 ──────────────────────────────────────────────────────────────────

def step3_aggiudicatari(df: pd.DataFrame) -> pd.DataFrame:
    log("=== STEP 3: Aggiudicatari (ANAC) ===")
    cigs = {v for v in df["CIG"].dropna().str.strip().str.upper() if v}
    log(f"  CIG unici: {len(cigs):,}")

    if not cigs:
        log("  Nessun CIG, step saltato.")
        return df.assign(ruolo="", codice_fiscale="", denominazione="")

    df_agg = _download_and_filter(
        urls=[AGGIUDICATARI_ZIP_URL_DATED, AGGIUDICATARI_ZIP_URL_FULL],
        filter_col_hints=["CIG", "CODICE_CIG"],
        filter_values=cigs,
    )
    if df_agg.empty:
        log("  Nessun aggiudicatario trovato.")
        return df.assign(ruolo="", codice_fiscale="", denominazione="")

    log(f"  Colonne aggiudicatari: {list(df_agg.columns)}")

    cig_col   = next((c for c in df_agg.columns if c in ["CIG", "CODICE_CIG"]), None)
    ruolo_col = next((c for c in df_agg.columns if "RUOLO" in c), None)
    cf_col    = next((c for c in df_agg.columns if "CODICE_FISCALE" in c), None)
    den_col   = next((c for c in df_agg.columns if "DENOMINAZIONE" in c), None)

    keep = {cig_col: "_cig_upper"}
    if ruolo_col: keep[ruolo_col] = "ruolo"
    if cf_col:    keep[cf_col]    = "codice_fiscale"
    if den_col:   keep[den_col]   = "denominazione"

    df_agg = df_agg[list(keep.keys())].rename(columns=keep)
    df_agg["_cig_upper"] = df_agg["_cig_upper"].str.strip().str.upper()

    df["_cig_upper"] = df["CIG"].str.strip().str.upper()
    merged = df.merge(df_agg, on="_cig_upper", how="left").drop(columns=["_cig_upper"])
    log(f"  Righe dopo join: {len(merged):,}")
    return merged


# ─── Step 4 ──────────────────────────────────────────────────────────────────

def step4_aggiudicazioni(df: pd.DataFrame) -> pd.DataFrame:
    log("=== STEP 4: Aggiudicazioni (ANAC) ===")
    cigs = {v for v in df["CIG"].dropna().str.strip().str.upper() if v}
    log(f"  CIG unici: {len(cigs):,}")

    if not cigs:
        log("  Nessun CIG, step saltato.")
        return df.assign(importo_aggiudicazione="")

    df_agz = _download_and_filter(
        urls=[AGGIUDICAZIONI_ZIP_URL_DATED, AGGIUDICAZIONI_ZIP_URL_FULL],
        filter_col_hints=["CIG", "CODICE_CIG", "CIG_ACCORDO_QUADRO"],
        filter_values=cigs,
    )
    if df_agz.empty:
        log("  Nessuna aggiudicazione trovata.")
        return df.assign(importo_aggiudicazione="")

    log(f"  Colonne aggiudicazioni: {list(df_agz.columns)}")

    cig_col     = next((c for c in df_agz.columns if c in ["CIG", "CODICE_CIG", "CIG_ACCORDO_QUADRO"]), None)
    importo_col = next((c for c in df_agz.columns if "IMPORTO" in c and "AGGIUDIC" in c), None)
    if not importo_col:
        importo_col = next((c for c in df_agz.columns if "IMPORTO" in c), None)

    if not cig_col:
        log("  Colonna CIG non trovata. Step saltato.")
        return df.assign(importo_aggiudicazione="")

    keep = {cig_col: "_cig_upper"}
    if importo_col:
        keep[importo_col] = "importo_aggiudicazione"
        log(f"  Colonna importo: {importo_col}")

    df_agz = df_agz[list(keep.keys())].rename(columns=keep)
    df_agz["_cig_upper"] = df_agz["_cig_upper"].str.strip().str.upper()
    # Se ci sono più aggiudicazioni per CIG, tieni la prima
    df_agz = df_agz.drop_duplicates(subset=["_cig_upper"])

    df["_cig_upper"] = df["CIG"].str.strip().str.upper()
    merged = df.merge(df_agz, on="_cig_upper", how="left").drop(columns=["_cig_upper"])
    log(f"  Righe dopo join: {len(merged):,}")
    return merged


# ─── Backup e salvataggio ────────────────────────────────────────────────────

def backup_and_save(df: pd.DataFrame):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    backup_dir = os.path.join(OUTPUT_DIR, "backup")
    os.makedirs(backup_dir, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_path = os.path.join(OUTPUT_DIR, f"{BASE_NAME}.csv")

    if os.path.exists(out_path):
        bk = os.path.join(backup_dir, f"{BASE_NAME}_{ts}.csv")
        shutil.copy2(out_path, bk)
        log(f"Backup creato: {bk}")

    # Mantieni solo MAX_BACKUPS copie
    pattern = os.path.join(backup_dir, f"{BASE_NAME}_????????_??????.csv")
    backups = sorted(glob.glob(pattern))
    while len(backups) > MAX_BACKUPS:
        old = backups.pop(0)
        os.remove(old)
        log(f"Backup rimosso: {old}")

    df.to_csv(out_path, index=False, encoding="utf-8")
    log(f"CSV salvato: {out_path} ({len(df):,} righe, {len(df.columns)} colonne)")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log(f"=== Avvio pipeline aggiudicatori ANNCSU 1.3.1 — {datetime.now(timezone.utc).isoformat()} ===")
    _init_session()
    df = step1_candidature()
    df = step2_cup_to_cig(df)
    df = step3_aggiudicatari(df)
    df = step4_aggiudicazioni(df)
    backup_and_save(df)
    log("=== Completato ===")
