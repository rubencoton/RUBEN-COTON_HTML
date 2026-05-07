"""
download-thumbnails.py — Descarga thumbnails de TODAS las fotos de Drive
Usa lh3.googleusercontent.com (no necesita auth para archivos compartidos).
OPTIMIZADO: ThreadPoolExecutor x10 workers para descarga paralela.
"""
import json, re, urllib.request, sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = Path(__file__).resolve().parent.parent
CATALOG = BASE / "config" / "photos-catalog.json"
CACHE_DIR = BASE / "cache"
THUMB_DIRECTO = CACHE_DIR / "thumb_directo"
THUMB_ESTUDIO = CACHE_DIR / "thumb_estudio"

MAX_WORKERS = 10

def download_thumb(file_id, dest_path, width=300):
    """Descarga thumbnail via lh3 (funciona sin auth para archivos compartidos)"""
    if dest_path.exists():
        return True  # Ya descargada
    url = f"https://lh3.googleusercontent.com/d/{file_id}=w{width}"
    try:
        resp = urllib.request.urlopen(url, timeout=15)
        with open(str(dest_path), 'wb') as f:
            f.write(resp.read())
        return True
    except Exception as e:
        print(f"  ERROR {file_id}: {e}")
        return False

def _task(args):
    i, foto, dest_dir, prefix = args
    fid = foto["id"]
    dest = dest_dir / f"{prefix}_{i:03d}_{fid}.jpg"
    return download_thumb(fid, dest)

def batch_download(fotos, dest_dir, prefix, label):
    print(f"Descargando {len(fotos)} thumbnails {label} (paralelo x{MAX_WORKERS})...")
    dest_dir.mkdir(parents=True, exist_ok=True)
    tasks = [(i, f, dest_dir, prefix) for i, f in enumerate(fotos)]
    ok = 0
    completed = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(_task, t): t for t in tasks}
        for future in as_completed(futures):
            completed += 1
            try:
                if future.result():
                    ok += 1
            except Exception:
                pass
            if completed % 50 == 0:
                print(f"  {completed}/{len(fotos)} completadas...")
    print(f"  {label}: {ok}/{len(fotos)} OK")
    return ok

def main():
    if not CATALOG.exists():
        print("ERROR: No existe photos-catalog.json. Ejecuta primero: python scripts/drive-sync.py")
        sys.exit(1)
    with open(CATALOG, encoding="utf-8") as f:
        catalog = json.load(f)

    directo = catalog.get("directo", [])
    estudio = catalog.get("estudio", [])

    if not directo and not estudio:
        print("WARN: El catalogo esta vacio. Ejecuta drive-sync.py primero.")
        sys.exit(1)

    ok_d = batch_download(directo, THUMB_DIRECTO, "d", "DIRECTO") if directo else 0
    ok_e = batch_download(estudio, THUMB_ESTUDIO, "e", "ESTUDIO") if estudio else 0

    total = ok_d + ok_e
    print(f"\nTotal: {total}/{len(directo) + len(estudio)} thumbnails descargadas")

if __name__ == "__main__":
    main()
