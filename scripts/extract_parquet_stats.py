#!/usr/bin/env python3
"""
Legge il file .parquet di ANNCSU e produce CSV/JSON con:
  - CODICE_ISTAT
  - civico_geocodificato    (out_of_bounds == False)
  - fuori_limite_comunale   (out_of_bounds == True)
  - totale
  - civici_da_altri_comuni  (civici di altri comuni che ricadono fisicamente nel territorio)
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
import geopandas as gpd

# ── Configurazione ────────────────────────────────────────────────────────────
PARQUET_URL = (
    "https://github.com/PalermoHub/ANNCUS/"
    "raw/refs/heads/main/data/anncsu-indirizzi.parquet"
)
GEOJSON_PATH = os.path.join("dati", "comuni.geojson")
OUTPUT_DIR   = "dati"
BASE_NAME    = "anncsu_stats"
MAX_BACKUPS  = 1
# ─────────────────────────────────────────────────────────────────────────────


def download_parquet(url: str) -> pd.DataFrame:
    print(f"Scarico parquet da {url} …")
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    print(f"  {len(r.content) / 1_048_576:.1f} MB scaricati")
    return pd.read_parquet(io.BytesIO(r.content))


def aggregate(df: pd.DataFrame) -> list[dict]:
    # Individua le colonne (case-insensitive)
    istat_col = next((c for c in df.columns if c.upper() == "CODICE_ISTAT"), None)
    if istat_col is None:
        raise ValueError(f"Colonna CODICE_ISTAT non trovata. Colonne: {list(df.columns)}")

    oob_col = next((c for c in df.columns if c.lower() == "out_of_bounds"), None)
    if oob_col is None:
        raise ValueError(f"Colonna out_of_bounds non trovata. Colonne: {list(df.columns)}")

    lon_col = next((c for c in df.columns if c.lower() == "longitude"), None)
    lat_col = next((c for c in df.columns if c.lower() == "latitude"), None)

    # ── Statistiche base ──────────────────────────────────────────────────────
    base = df[[istat_col, oob_col]].copy()
    base[istat_col] = base[istat_col].astype(str)
    base[oob_col]   = base[oob_col].astype(bool)

    grouped = base.groupby(istat_col)[oob_col]
    fuori  = grouped.sum().astype(int).rename("fuori_limite_comunale")
    totale = grouped.count().astype(int).rename("totale_rows")
    civico = (totale - fuori).rename("civico_geocodificato")

    result = pd.concat([civico, fuori], axis=1).fillna(0).astype(int)
    result.index.name = "CODICE_ISTAT"
    result = result.sort_index().reset_index()
    result["totale"] = result["civico_geocodificato"] + result["fuori_limite_comunale"]

    # ── Civici di altri comuni ospitati (spatial join) ────────────────────────
    ospitati = pd.Series(0, index=result["CODICE_ISTAT"], name="civici_da_altri_comuni", dtype=int)

    if lon_col and lat_col and os.path.exists(GEOJSON_PATH):
        print("Calcolo civici_da_altri_comuni (spatial join) …")
        df_oob = df[df[oob_col] == True][[istat_col, lon_col, lat_col]].copy()
        df_oob[istat_col] = df_oob[istat_col].astype(str)
        print(f"  Civici fuori confine: {len(df_oob):,}")

        gdf_pts = gpd.GeoDataFrame(
            df_oob[[istat_col]],
            geometry=gpd.points_from_xy(df_oob[lon_col], df_oob[lat_col]),
            crs="EPSG:4326"
        )
        gdf_comuni = gpd.read_file(GEOJSON_PATH)[["pro_com_t", "geometry"]]

        joined = gpd.sjoin(gdf_pts, gdf_comuni, how="left", predicate="within")
        in_altro = joined[
            joined["pro_com_t"].notna() &
            (joined["pro_com_t"] != joined[istat_col])
        ]
        counts = in_altro.groupby("pro_com_t").size().rename("civici_da_altri_comuni")
        counts.index.name = "CODICE_ISTAT"
        ospitati = ospitati.add(counts, fill_value=0).astype(int)
        print(f"  Comuni con civici ospitati: {(ospitati > 0).sum()}")
    else:
        print("ATTENZIONE: spatial join saltato (coordinate o GeoJSON mancanti).")

    result = result.merge(ospitati.reset_index(), on="CODICE_ISTAT", how="left")
    result["civici_da_altri_comuni"] = result["civici_da_altri_comuni"].fillna(0).astype(int)

    return result.to_dict(orient="records")


def timestamp_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def save_outputs(rows: list[dict], output_dir: str, base_name: str, max_backups: int):
    os.makedirs(output_dir, exist_ok=True)
    backup_dir = os.path.join(output_dir, "backup")
    os.makedirs(backup_dir, exist_ok=True)
    ts = timestamp_str()

    # Backup file correnti nella cartella backup/
    for ext in ("csv", "json"):
        current = os.path.join(output_dir, f"{base_name}.{ext}")
        if os.path.exists(current):
            backup = os.path.join(backup_dir, f"{base_name}_{ts}.{ext}")
            shutil.copy2(current, backup)
            print(f"Backup creato: {backup}")

    # Pulizia backup vecchi
    for ext in ("csv", "json"):
        pattern = os.path.join(backup_dir, f"{base_name}_????????_??????.{ext}")
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
            fieldnames=["CODICE_ISTAT", "civico_geocodificato", "fuori_limite_comunale", "totale", "civici_da_altri_comuni"],
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
