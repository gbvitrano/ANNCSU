#!/usr/bin/env python3
"""
Scarica in dati/ gli snapshot dei JSON (qualità e andamento) pubblicati da mfortini/diff_ANNCSU
(URL con hash che cambia a ogni build). Per ogni voce di SOURCES:
  1. legge la pagina HTML che referenzia il file e ne estrae l'hash corrente
  2. scarica il JSON in dati/<local>
  3. solo per dbscan: aggiorna HOTSPOT_URL in js/anncsu.js (riferimento documentale)
Esce con codice 0 sempre; il workflow usa git diff per decidere se committare.
"""
import re, sys, json, requests

SITE      = 'https://mfortini.github.io/diff_ANNCSU/'
ANNCSU_JS = 'js/anncsu.js'

# name (prefisso file remoto), page (html relativa a SITE che lo referenzia), local (destinazione)
SOURCES = [
    ('anncsu_dbscan_hotspots',     'quality/hotspots.html', 'dati/hotspots_tmp.json'),
    ('anncsu_grid_quality',        'quality/hotspots.html', 'dati/grid_quality.json'),
    ('anncsu_comuni_inout',        'quality/index.html',    'dati/comuni_inout.json'),
    ('anncsu_cross_region_matrix', 'quality/index.html',    'dati/cross_region_matrix.json'),
    ('anncsu_stats',               'index.html',            'dati/andamento_stats.json'),
    ('anncsu_spatial_stats',       'index.html',            'dati/andamento_spatial.json'),
]

RE_JS = re.compile(r"(const HOTSPOT_URL = ')(https://[^']+)(';)")


def fetch_page(page: str, cache: dict) -> str | None:
    if page not in cache:
        try:
            r = requests.get(SITE + page, timeout=30)
            r.raise_for_status()
            cache[page] = r.text
        except Exception as e:
            print(f'WARN: impossibile raggiungere {page}: {e}', file=sys.stderr)
            cache[page] = None
    return cache[page]


def download(name: str, page: str, page_html: str, local: str) -> str | None:
    m = re.search(rf'{name}\.([a-f0-9]{{8}})\.json', page_html)
    if not m:
        print(f'WARN: pattern {name}.{{hash}}.json non trovato', file=sys.stderr)
        return None
    folder = page.rsplit('/', 1)[0] + '/' if '/' in page else ''
    url = f'{SITE}{folder}_file/data/{name}.{m.group(1)}.json'
    try:
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        data = r.json()
        if name == 'anncsu_spatial_stats':   # bbox non usate: -40% peso
            for group in data.get('comuni', {}), data.get('regioni', {}):
                for rows in group.values():
                    for row in rows:
                        row.pop('bbox', None)
        with open(local, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        print(f'Scaricato: {url} -> {local}')
        return url
    except Exception as e:
        print(f'WARN: impossibile scaricare {url}: {e}', file=sys.stderr)
        return None


def update_js_url(new_url: str) -> None:
    with open(ANNCSU_JS, encoding='utf-8') as f:
        content = f.read()
    mjs = RE_JS.search(content)
    if not mjs:
        print('ERRORE: HOTSPOT_URL non trovata in anncsu.js', file=sys.stderr)
        sys.exit(1)
    if mjs.group(2) == new_url:
        print(f'OK: HOTSPOT_URL già aggiornata ({new_url})')
        return
    with open(ANNCSU_JS, 'w', encoding='utf-8') as f:
        f.write(RE_JS.sub(lambda _: f'{mjs.group(1)}{new_url}{mjs.group(3)}', content))
    print(f'Aggiornato HOTSPOT_URL:\n  vecchio: {mjs.group(2)}\n  nuovo:   {new_url}')


def main():
    pages = {}
    for name, page, local in SOURCES:
        html = fetch_page(page, pages)
        if html is None:
            continue
        url = download(name, page, html, local)
        if url and name == 'anncsu_dbscan_hotspots':
            update_js_url(url)


if __name__ == '__main__':
    main()
