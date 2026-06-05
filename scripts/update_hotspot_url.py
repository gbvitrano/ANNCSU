#!/usr/bin/env python3
"""
Controlla se l'hash del file anncsu_dbscan_hotspots in mfortini/diff_ANNCSU
è cambiato e aggiorna HOTSPOT_URL in js/anncsu.js.
Esce con codice 0 sempre; il workflow usa git diff per decidere se committare.
"""
import re, sys, requests

HOTSPOT_PAGE = 'https://mfortini.github.io/diff_ANNCSU/quality/hotspots.html'
BASE_URL     = 'https://mfortini.github.io/diff_ANNCSU/quality/_file/data/'
ANNCSU_JS    = 'js/anncsu.js'

RE_HTML = re.compile(r'anncsu_dbscan_hotspots\.([a-f0-9]{8})\.json')
RE_JS   = re.compile(r"(const HOTSPOT_URL = ')(https://[^']+)(';)")

def main():
    # 1 — trova hash corrente sulla pagina di mfortini
    try:
        resp = requests.get(HOTSPOT_PAGE, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f'WARN: impossibile raggiungere hotspots.html: {e}', file=sys.stderr)
        sys.exit(0)

    m = RE_HTML.search(resp.text)
    if not m:
        print('WARN: pattern anncsu_dbscan_hotspots.{hash}.json non trovato', file=sys.stderr)
        sys.exit(0)

    new_url = f"{BASE_URL}anncsu_dbscan_hotspots.{m.group(1)}.json"

    # 2 — leggi js/anncsu.js
    with open(ANNCSU_JS, encoding='utf-8') as f:
        content = f.read()

    mjs = RE_JS.search(content)
    if not mjs:
        print('ERRORE: HOTSPOT_URL non trovata in anncsu.js', file=sys.stderr)
        sys.exit(1)

    current_url = mjs.group(2)
    if current_url == new_url:
        print(f'OK: HOTSPOT_URL già aggiornata ({new_url})')
        sys.exit(0)

    # 3 — aggiorna
    updated = RE_JS.sub(lambda _: f"{mjs.group(1)}{new_url}{mjs.group(3)}", content)
    with open(ANNCSU_JS, 'w', encoding='utf-8') as f:
        f.write(updated)

    print(f'Aggiornato:\n  vecchio: {current_url}\n  nuovo:   {new_url}')

if __name__ == '__main__':
    main()
