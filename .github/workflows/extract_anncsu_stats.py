#!/usr/bin/env python3
"""
Legge il file .pmtiles di ANNCSU e produce un CSV/JSON con:
  - CODICE_ISTAT
  - totale Civico geocodificato
  - totale Fuori limite comunale

Gestisce backup automatici e cancella le copie vecchie.
"""

import json
import csv
import os
import io
import glob
import struct
import zlib
import shutil
import requests
from datetime import datetime, timezone
from collections import defaultdict

# ── Configurazione ────────────────────────────────────────────────────────────
PMTILES_URL = (
    "https://media.githubusercontent.com/media/"
    "anncsu-open/anncsu-viewer/main/data/anncsu-indirizzi.pmtiles"
)
OUTPUT_DIR = "dati"
BASE_NAME  = "anncsu_stats"          # senza estensione
MAX_BACKUPS = 5                       # numero di backup da conservare
# ─────────────────────────────────────────────────────────────────────────────


# ── Lettura PMTiles (formato v3) ──────────────────────────────────────────────

def read_uint64_le(data: bytes, offset: int) -> int:
    return struct.unpack_from("<Q", data, offset)[0]

def read_uint32_le(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]

def read_uint24_le(data: bytes, offset: int) -> int:
    b = data[offset:offset + 3]
    return b[0] | (b[1] << 8) | (b[2] << 16)

def parse_varint(data: bytes, pos: int):
    result = 0
    shift = 0
    while True:
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return result, pos

def parse_pmtiles_header(raw: bytes) -> dict:
    """Decodifica l'header PMTiles v3 (127 byte fissi)."""
    magic = raw[:7]
    assert magic == b"PMTiles", f"Magic non valido: {magic}"
    version = raw[7]
    assert version == 3, f"Versione non supportata: {version}"

    root_dir_offset    = read_uint64_le(raw,  8)
    root_dir_length    = read_uint64_le(raw, 16)
    metadata_offset    = read_uint64_le(raw, 24)
    metadata_length    = read_uint64_le(raw, 32)
    leaf_dirs_offset   = read_uint64_le(raw, 40)
    leaf_dirs_length   = read_uint64_le(raw, 48)
    tile_data_offset   = read_uint64_le(raw, 56)
    tile_data_length   = read_uint64_le(raw, 64)
    num_addressed_tiles= read_uint64_le(raw, 72)
    num_tile_entries   = read_uint64_le(raw, 80)
    num_tile_contents  = read_uint64_le(raw, 88)
    clustered          = raw[96]
    internal_compression = raw[97]   # 1=none, 2=gzip, 3=brotli, 4=zstd
    tile_compression   = raw[98]
    tile_type          = raw[99]     # 1=mvt, 2=png, 3=jpg, 4=webp, 5=avif

    return {
        "root_dir_offset": root_dir_offset,
        "root_dir_length": root_dir_length,
        "metadata_offset": metadata_offset,
        "metadata_length": metadata_length,
        "leaf_dirs_offset": leaf_dirs_offset,
        "leaf_dirs_length": leaf_dirs_length,
        "tile_data_offset": tile_data_offset,
        "tile_data_length": tile_data_length,
        "num_tile_contents": num_tile_contents,
        "internal_compression": internal_compression,
        "tile_compression": tile_compression,
    }

def decompress(data: bytes, compression: int) -> bytes:
    if compression == 1:
        return data
    if compression == 2:
        return zlib.decompress(data, wbits=16 + zlib.MAX_WBITS)
    if compression == 4:
        import zstandard as zstd
        return zstd.ZstdDecompressor().decompress(data)
    raise ValueError(f"Compressione non supportata: {compression}")

def parse_directory(data: bytes) -> list[dict]:
    """Decodifica una directory PMTiles v3 (entry list)."""
    pos = 0
    num_entries, pos = parse_varint(data, pos)
    entries = []

    tile_id = 0
    for _ in range(num_entries):
        delta, pos = parse_varint(data, pos)
        tile_id += delta
        entries.append({"tile_id": tile_id})

    for e in entries:
        run_length, pos = parse_varint(data, pos)
        e["run_length"] = run_length

    for e in entries:
        length, pos = parse_varint(data, pos)
        e["length"] = length

    offset = 0
    for i, e in enumerate(entries):
        raw_offset, pos = parse_varint(data, pos)
        if i == 0:
            offset = raw_offset
        else:
            if raw_offset == 0:
                offset = entries[i - 1]["offset"] + entries[i - 1]["length"]
            else:
                offset = raw_offset
        e["offset"] = offset

    return entries

def fetch_range(url: str, start: int, length: int) -> bytes:
    headers = {"Range": f"bytes={start}-{start + length - 1}"}
    r = requests.get(url, headers=headers, timeout=60)
    r.raise_for_status()
    return r.content

def decode_mvt_feature_properties(data: bytes) -> dict:
    """
    Parser MVT minimalista: estrae solo i tag dei feature come dict
    senza dipendenze esterne (protobuf puro).
    """
    # Layer è un messaggio protobuf; campi:
    #   1 = name (string), 2 = feature (bytes), 3 = keys (string), 4 = values (bytes)
    keys   = []
    values = []
    features_raw = []

    pos = 0
    while pos < len(data):
        b = data[pos]; pos += 1
        field_num = b >> 3
        wire_type = b & 0x07
        if wire_type == 0:           # varint
            val, pos = parse_varint(data, pos)
            if field_num == 5:       # extent
                pass
        elif wire_type == 2:         # length-delimited
            length, pos = parse_varint(data, pos)
            chunk = data[pos:pos + length]; pos += length
            if field_num == 2:       # feature
                features_raw.append(chunk)
            elif field_num == 3:     # key
                keys.append(chunk.decode("utf-8"))
            elif field_num == 4:     # value
                values.append(_decode_mvt_value(chunk))
        else:
            break  # wire type non gestito, interrompi

    props_list = []
    for feat_data in features_raw:
        props = _decode_feature_tags(feat_data, keys, values)
        if props:
            props_list.append(props)
    return props_list

def _decode_mvt_value(data: bytes):
    """Decodifica un Value protobuf MVT."""
    pos = 0
    while pos < len(data):
        b = data[pos]; pos += 1
        field_num = b >> 3
        wire_type = b & 0x07
        if wire_type == 0:
            val, pos = parse_varint(data, pos)
            if field_num == 5:   # sint64
                val = (val >> 1) ^ -(val & 1)
            elif field_num == 6: # bool
                val = bool(val)
            return val
        elif wire_type == 1:     # 64-bit
            val = struct.unpack_from("<d", data, pos)[0]; pos += 8
            return val
        elif wire_type == 2:
            length, pos = parse_varint(data, pos)
            chunk = data[pos:pos + length]; pos += length
            if field_num == 1:
                return chunk.decode("utf-8")
            return chunk
        elif wire_type == 5:     # 32-bit float
            val = struct.unpack_from("<f", data, pos)[0]; pos += 4
            return val
        else:
            break
    return None

def _decode_feature_tags(data: bytes, keys: list, values: list) -> dict:
    """Estrae i tag (properties) da un feature MVT."""
    props = {}
    pos = 0
    tags = []
    geometry_type = None

    while pos < len(data):
        b = data[pos]; pos += 1
        field_num = b >> 3
        wire_type = b & 0x07
        if wire_type == 0:
            val, pos = parse_varint(data, pos)
            if field_num == 3:
                geometry_type = val
        elif wire_type == 2:
            length, pos = parse_varint(data, pos)
            chunk = data[pos:pos + length]; pos += length
            if field_num == 2:  # tags (packed uint32)
                p2 = 0
                while p2 < len(chunk):
                    tag, p2 = parse_varint(chunk, p2)
                    tags.append(tag)
        else:
            pos += 1  # skip unknown

    for i in range(0, len(tags) - 1, 2):
        ki, vi = tags[i], tags[i + 1]
        if ki < len(keys) and vi < len(values):
            props[keys[ki]] = values[vi]
    return props

def fetch_tile(url: str, header: dict, entry: dict) -> bytes | None:
    tile_offset = header["tile_data_offset"] + entry["offset"]
    raw = fetch_range(url, tile_offset, entry["length"])
    try:
        return decompress(raw, header["tile_compression"])
    except Exception:
        return raw

def parse_tile_layers(tile_data: bytes) -> list[dict]:
    """Decodifica i layer MVT da un tile (protobuf top-level)."""
    layers = []
    pos = 0
    while pos < len(tile_data):
        b = tile_data[pos]; pos += 1
        field_num = b >> 3
        wire_type = b & 0x07
        if wire_type == 2:
            length, pos = parse_varint(tile_data, pos)
            chunk = tile_data[pos:pos + length]; pos += length
            if field_num == 3:  # layer
                layers.append(chunk)
        elif wire_type == 0:
            _, pos = parse_varint(tile_data, pos)
        else:
            break
    return layers


# ── Aggregazione dati ─────────────────────────────────────────────────────────

def aggregate_features(url: str) -> dict:
    """
    Scarica il file PMTiles e aggrega per CODICE_ISTAT:
      - count_geocodificato  (TIPOLOGIA == 'Civico geocodificato')
      - count_fuori_limite   (TIPOLOGIA == 'Fuori limite comunale')
    """
    print("Scarico header PMTiles …")
    header_raw = fetch_range(url, 0, 127)
    header = parse_pmtiles_header(header_raw)

    print("Scarico root directory …")
    root_raw = fetch_range(
        url, header["root_dir_offset"], header["root_dir_length"]
    )
    root_raw = decompress(root_raw, header["internal_compression"])
    root_entries = parse_directory(root_raw)

    stats: dict[str, dict] = defaultdict(
        lambda: {"civico_geocodificato": 0, "fuori_limite_comunale": 0}
    )

    total_tiles = len(root_entries)
    print(f"Tile entries nella root directory: {total_tiles}")

    for idx, entry in enumerate(root_entries):
        if entry["run_length"] == 0:
            # È una leaf directory
            leaf_raw = fetch_range(
                url,
                header["leaf_dirs_offset"] + entry["offset"],
                entry["length"],
            )
            leaf_raw = decompress(leaf_raw, header["internal_compression"])
            leaf_entries = parse_directory(leaf_raw)
        else:
            leaf_entries = [entry]

        for tile_entry in leaf_entries:
            try:
                tile_data = fetch_tile(url, header, tile_entry)
                if not tile_data:
                    continue
                layer_chunks = parse_tile_layers(tile_data)
                for layer_chunk in layer_chunks:
                    feature_props = decode_mvt_feature_properties(layer_chunk)
                    for props in feature_props:
                        codice = props.get("CODICE_ISTAT") or props.get("codice_istat")
                        tipologia = props.get("TIPOLOGIA") or props.get("tipologia", "")
                        if not codice:
                            continue
                        codice = str(codice)
                        if tipologia == "Civico geocodificato":
                            stats[codice]["civico_geocodificato"] += 1
                        elif tipologia == "Fuori limite comunale":
                            stats[codice]["fuori_limite_comunale"] += 1
            except Exception as e:
                print(f"  Errore tile {tile_entry['tile_id']}: {e}")

        if (idx + 1) % 50 == 0:
            print(f"  Elaborati {idx + 1}/{total_tiles} entry …")

    return stats


# ── Gestione file di output e backup ─────────────────────────────────────────

def timestamp_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

def save_outputs(stats: dict, output_dir: str, base_name: str, max_backups: int):
    os.makedirs(output_dir, exist_ok=True)
    ts = timestamp_str()

    # ── Backup dei file correnti ──────────────────────────────────────────────
    for ext in ("csv", "json"):
        current_path = os.path.join(output_dir, f"{base_name}.{ext}")
        if os.path.exists(current_path):
            backup_path = os.path.join(output_dir, f"{base_name}_{ts}.{ext}")
            shutil.copy2(current_path, backup_path)
            print(f"Backup creato: {backup_path}")

    # ── Pulizia backup vecchi ─────────────────────────────────────────────────
    for ext in ("csv", "json"):
        pattern = os.path.join(output_dir, f"{base_name}_????????_??????.{ext}")
        backups = sorted(glob.glob(pattern))
        while len(backups) > max_backups:
            old = backups.pop(0)
            os.remove(old)
            print(f"Backup rimosso: {old}")

    # ── Righe ordinate per CODICE_ISTAT ──────────────────────────────────────
    rows = [
        {
            "CODICE_ISTAT":            codice,
            "civico_geocodificato":    d["civico_geocodificato"],
            "fuori_limite_comunale":   d["fuori_limite_comunale"],
            "totale":                  d["civico_geocodificato"] + d["fuori_limite_comunale"],
        }
        for codice, d in sorted(stats.items())
    ]

    # ── CSV ───────────────────────────────────────────────────────────────────
    csv_path = os.path.join(output_dir, f"{base_name}.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["CODICE_ISTAT", "civico_geocodificato", "fuori_limite_comunale", "totale"],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"CSV salvato: {csv_path}")

    # ── JSON ──────────────────────────────────────────────────────────────────
    json_path = os.path.join(output_dir, f"{base_name}.json")
    output = {
        "aggiornato_il": datetime.now(timezone.utc).isoformat(),
        "fonte": "https://media.githubusercontent.com/media/anncsu-open/anncsu-viewer/main/data/anncsu-indirizzi.pmtiles",
        "dati": rows,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"JSON salvato: {json_path}")


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"=== Avvio estrazione ANNCSU — {datetime.now(timezone.utc).isoformat()} ===")
    stats = aggregate_features(PMTILES_URL)
    print(f"Comuni trovati: {len(stats)}")
    save_outputs(stats, OUTPUT_DIR, BASE_NAME, MAX_BACKUPS)
    print("=== Completato ===")
