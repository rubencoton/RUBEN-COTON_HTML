"""
crop-photos.py — Recorta las mejores fotos a 600x320px para el email
OPTIMIZADO: ThreadPool x4, BICUBIC, quality 85, cleanup robusto.
"""
import json, sys, urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

BASE = Path(__file__).resolve().parent.parent
CROPPED_DIR = BASE / "cache" / "cropped"
TARGET_W, TARGET_H = 600, 320
MAX_WORKERS = 4

def crop_photo(file_id, crop_position="center", output_name=None):
    """Descarga foto de Drive y la recorta a 600x320"""
    CROPPED_DIR.mkdir(parents=True, exist_ok=True)
    out_path = CROPPED_DIR / (output_name or f"{file_id}.jpg")

    if out_path.exists():
        return str(out_path)

    url = f"https://lh3.googleusercontent.com/d/{file_id}=w800"
    tmp_path = CROPPED_DIR / f"_tmp_{file_id}.jpg"

    # Fase 1: descarga (con cleanup si falla)
    try:
        resp = urllib.request.urlopen(url, timeout=15)
        with open(str(tmp_path), 'wb') as f:
            f.write(resp.read())
    except Exception as e:
        print(f"  ERROR descargando {file_id}: {e}")
        if tmp_path.exists():
            try: tmp_path.unlink()
            except: pass
        return None

    # Fase 2: procesamiento (cleanup garantizado)
    try:
        img = Image.open(str(tmp_path))
        w, h = img.size
        ratio = TARGET_W / w
        new_h = int(h * ratio)
        img = img.resize((TARGET_W, new_h), Image.BICUBIC)  # BICUBIC: 20-30% mas rapido que LANCZOS

        if new_h <= TARGET_H:
            result = Image.new('RGB', (TARGET_W, TARGET_H), (0, 0, 0))
            offset = (TARGET_H - new_h) // 2
            result.paste(img, (0, offset))
        else:
            if crop_position == "top":
                box = (0, 0, TARGET_W, TARGET_H)
            elif crop_position == "bottom":
                box = (0, new_h - TARGET_H, TARGET_W, new_h)
            else:
                top = (new_h - TARGET_H) // 2
                box = (0, top, TARGET_W, top + TARGET_H)
            result = img.crop(box)

        result.save(str(out_path), "JPEG", quality=85, optimize=True)  # q85: 15-25% menos peso
        print(f"  OK: {out_path.name} ({w}x{h} -> {TARGET_W}x{TARGET_H})")
    except Exception as e:
        print(f"  ERROR procesando {file_id}: {e}")
        return None
    finally:
        if tmp_path.exists():
            try: tmp_path.unlink()
            except: pass

    return str(out_path)

def _task(args):
    i, photo = args
    fid = photo.get("id")
    if not fid:
        return (i, photo, None, None)
    crop = photo.get("crop", "center")
    name = f"email_{i:02d}_{fid}.jpg"
    path = crop_photo(fid, crop, name)
    return (i, photo, path, name)

def main():
    selected_file = BASE / "config" / "selected-photos.json"
    if not selected_file.exists():
        print("ERROR: No existe config/selected-photos.json")
        sys.exit(1)

    with open(selected_file, encoding="utf-8") as f:
        photos = json.load(f)

    print(f"Recortando {len(photos)} fotos a {TARGET_W}x{TARGET_H}px (paralelo x{MAX_WORKERS})...")
    args_list = list(enumerate(photos))
    results = [None] * len(photos)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        for i, photo, path, name in executor.map(_task, args_list):
            if path:
                results[i] = {**photo, "cropped_path": path, "cropped_name": name}

    results = [r for r in results if r is not None]

    with open(BASE / "config" / "cropped-photos.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\nRecortadas: {len(results)}/{len(photos)}")
    print(f"Guardado en: config/cropped-photos.json")

if __name__ == "__main__":
    main()
