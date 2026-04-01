#!/usr/bin/env python3
"""
Legge il file .parquet di ANNCSU e produce CSV/JSON con:
  - CODICE_ISTAT
  - civico_geocodificato  (out_of_bounds == False)
  - fuori_limite_comunale (out_of_bounds == True)
  - totale
"""

import json
import csv
import os
import glob
import shutil
import requests
import io
from datetime import datetime, timezone

import pandas as pd

# ── Configurazione ────────────────────────────────────────────────────────────
PARQUET_URL = (
    "https://github.com/anncsu-open/anncsu-viewer/"
    "raw/refs/heads/main/data/anncsu-indirizzi.parquet"
)
OUTPUT_DIR  = "dati"
BASE_NAME   = "anncsu_stats"
MAX_BACKUPS = 5
# ─────────────────────────────────────────────────────────────────────────────


def download_parquet(url: str) -> pd.DataFrame:
    print(f"Scarico parquet da {url} …")
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    print(f"  {len(r.content) / 1_048_576:.1f} MB scaricati")
    return pd.read_parquet(io.BytesIO(r.content))


def aggregate(df: pd.DataFrame) -> list[dict]:
    # Individua la colonna CODICE_ISTAT (case-insensitive)
    istat_col = next(
        (c for c in df.columns if c.upper() == "CODICE_ISTAT"), None
    )
    if istat_col is None:
        raise ValueError(f"Colonna CODICE_ISTAT non trovata. Colonne: {list(df.columns)}")

    # Individua la colonna out_of_bounds (case-insensitive)
    oob_col = next(
        (c for c in df.columns if c.lower() == "out_of_bounds"), None
    )
    if oob_col is None:
        raise ValueError(f"Colonna out_of_bounds non trovata. Colonne: {list(df.columns)}")

    df = df[[istat_col, oob_col]].copy()
    df[istat_col] = df[istat_col].astype(str)
    df[oob_col]   = df[oob_col].astype(bool)

    grouped = df.groupby(istat_col)[oob_col]
    civico    = (~grouped.apply(lambda s: s)).groupby(level=0).sum().rename("civico_geocodificato")
    fuori     = grouped.sum().rename("fuori_limite_comunale")

    result = pd.concat([civico, fuori], axis=1).fillna(0).astype(int)
    result.index.name = "CODICE_ISTAT"
    result = result.sort_index().reset_index()
    result["totale"] = result["civico_geocodificato"] + result["fuori_limite_comunale"]

    return result.to_dict(orient="records")


def timestamp_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def save_outputs(rows: list[dict], output_dir: str, base_name: str, max_backups: int):
    os.makedirs(output_dir, exist_ok=True)
    ts = timestamp_str()

    # Backup file correnti
    for ext in ("csv", "json"):
        current = os.path.join(output_dir, f"{base_name}.{ext}")
        if os.path.exists(current):
            backup = os.path.join(output_dir, f"{base_name}_{ts}.{ext}")
            shutil.copy2(current, backup)
            print(f"Backup creato: {backup}")

    # Pulizia backup vecchi
    for ext in ("csv", "json"):
        pattern = os.path.join(output_dir, f"{base_name}_????????_??????.{ext}")
        backups = sorted(glob.glob(pattern))
        while len(backups) > max_backups:
            old = backups.pop(0)
            os.remove(old)
            print(f"Backup rimosso: {old}")

    # CSV
    csv_path = os.path.join(output_dir, f"{base_name}.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["CODICE_ISTAT", "civico_geocodificato", "fuori_limite_comunale", "totale"],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"CSV salvato: {csv_path}")

    # JSON
    json_path = os.path.join(output_dir, f"{base_name}.json")
    output = {
        "aggiornato_il": datetime.now(timezone.utc).isoformat(),
        "fonte": PARQUET_URL,
        "dati": rows,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"JSON salvato: {json_path}")


if __name__ == "__main__":
    print(f"=== Avvio estrazione ANNCSU — {datetime.now(timezone.utc).isoformat()} ===")
    df   = download_parquet(PARQUET_URL)
    print(f"Righe totali: {len(df):,}  —  Colonne: {list(df.columns)}")
    rows = aggregate(df)
    print(f"Comuni trovati: {len(rows)}")
    save_outputs(rows, OUTPUT_DIR, BASE_NAME, MAX_BACKUPS)
    print("=== Completato ===")
