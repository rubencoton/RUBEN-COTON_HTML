"""
drive-sync.py — Sincroniza fotos desde Google Drive (manager@rubencoton.com)
Usa las credenciales OAuth2 del proyecto drive-manager-rubencoton-com.
Genera config/photos-catalog.json con todas las fotos categorizadas.
"""
import json, os, re, sys
from pathlib import Path
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# Rutas
BASE = Path(__file__).resolve().parent.parent
CREDS_DIR = Path("C:/Users/elrub/Desktop/CARPETA CODEX/01_PROYECTOS/drive-manager-rubencoton-com")
TOKEN_FILE = CREDS_DIR / "config" / "token.json"
ENV_FILE = CREDS_DIR / ".env"
CATALOG_FILE = BASE / "config" / "photos-catalog.json"
FOLDERS_FILE = BASE / "config" / "drive-folders.json"

# OAuth config
def load_env():
    env = {}
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env

def get_drive_service():
    env = load_env()
    with open(TOKEN_FILE) as f:
        token_data = json.load(f)
    creds = Credentials(
        token=token_data['access_token'],
        refresh_token=token_data['refresh_token'],
        token_uri='https://oauth2.googleapis.com/token',
        client_id=env['GOOGLE_CLIENT_ID'],
        client_secret=env['GOOGLE_CLIENT_SECRET'],
        scopes=['https://www.googleapis.com/auth/drive']
    )
    # Auto-refresh token si esta expirado (escritura atomica para evitar race conditions)
    if creds.expired or not creds.valid:
        from google.auth.transport.requests import Request
        creds.refresh(Request())
        token_data['access_token'] = creds.token
        if creds.expiry:
            token_data['expiry_date'] = int(creds.expiry.timestamp() * 1000)
        tmp_file = TOKEN_FILE.with_suffix('.json.tmp')
        with open(tmp_file, 'w') as f:
            json.dump(token_data, f, indent=2)
        tmp_file.replace(TOKEN_FILE)
        print("[TOKEN] Token renovado automaticamente")
    return build('drive', 'v3', credentials=creds)

def list_images(service, folder_id):
    # pageSize=1000 (max) + filtro mimeType en query API (no en Python)
    results = []
    page_token = None
    while True:
        response = service.files().list(
            q=f"'{folder_id}' in parents and mimeType contains 'image/'",
            fields='nextPageToken, files(id, name, mimeType, size, modifiedTime)',
            pageSize=1000, pageToken=page_token,
            supportsAllDrives=True, includeItemsFromAllDrives=True,
            corpora='allDrives'
        ).execute()
        results.extend(response.get('files', []))
        page_token = response.get('nextPageToken')
        if not page_token:
            break
    return results

# Categorizar por nombre de archivo
LOCATION_PATTERNS = {
    'villaconejos': {'evento': 'fiestas_patronales', 'lugar': 'Villaconejos'},
    'chinch': {'evento': 'fiestas_patronales', 'lugar': 'Chinchon'},
    'colmenar': {'evento': 'fiestas_patronales', 'lugar': 'Colmenar de Oreja'},
    'soto': {'evento': 'fiestas_patronales', 'lugar': 'Soto del Real'},
    'coslada': {'evento': 'fiestas_patronales', 'lugar': 'Coslada'},
    'villablino': {'evento': 'fiestas_patronales', 'lugar': 'Villablino'},
    'roa': {'evento': 'fiestas_patronales', 'lugar': 'Roa de Duero'},
    'afteryou': {'evento': 'discoteca', 'lugar': 'Palau Alameda Valencia'},
    'gran sala': {'evento': 'discoteca', 'lugar': 'Palau Alameda Valencia'},
    'palau': {'evento': 'discoteca', 'lugar': 'Palau Alameda Valencia'},
    'palacio': {'evento': 'boda', 'lugar': 'Palacio de Aldovea'},
    'boda': {'evento': 'boda', 'lugar': ''},
    'mad cool': {'evento': 'festival', 'lugar': 'Mad Cool Madrid'},
    'festival': {'evento': 'festival', 'lugar': ''},
    'real madrid': {'evento': 'deportivo', 'lugar': 'Real Madrid'},
    'bernabeu': {'evento': 'deportivo', 'lugar': 'Santiago Bernabeu'},
    'nazca': {'evento': 'discoteca', 'lugar': 'Sala Nazca'},
    'estudio': {'evento': 'estudio', 'lugar': 'Estudio profesional'},
    'dsc': {'evento': 'sesion_foto', 'lugar': ''},
    'a730': {'evento': 'sesion_foto', 'lugar': ''},
    'img_': {'evento': 'sesion_foto', 'lugar': ''},
}

def categorize_photo(name, tipo):
    name_lower = name.lower()
    info = {'evento': tipo, 'lugar': '', 'tags': []}
    for pattern, data in LOCATION_PATTERNS.items():
        if pattern in name_lower:
            info['evento'] = data['evento']
            info['lugar'] = data['lugar']
            info['tags'].append(pattern)
            break
    # Extract year from name
    year_match = re.search(r'20[12]\d', name)
    if year_match:
        info['tags'].append(year_match.group())
    # HEIC files = iPhone = potentially lower quality for email
    if name_lower.endswith('.heic'):
        info['tags'].append('heic')
    return info

def build_catalog():
    print("Conectando a Google Drive (manager@rubencoton.com)...")
    try:
        service = get_drive_service()
    except Exception as e:
        print(f"ERROR: No se pudo conectar a Google Drive: {e}")
        print("Verifica las credenciales en drive-manager-rubencoton-com")
        return None

    with open(FOLDERS_FILE) as f:
        folders = json.load(f)

    directo_id = folders['fotos']['directo']['folder_id']
    estudio_id = folders['fotos']['estudio']['folder_id']

    print(f"Listando fotos directo ({directo_id})...")
    try:
        directo_files = list_images(service, directo_id)
        print(f"  → {len(directo_files)} fotos")
    except Exception as e:
        print(f"  ERROR accediendo carpeta directo: {e}")
        directo_files = []

    print(f"Listando fotos estudio ({estudio_id})...")
    try:
        estudio_files = list_images(service, estudio_id)
        print(f"  → {len(estudio_files)} fotos")
    except Exception as e:
        print(f"  ERROR accediendo carpeta estudio: {e}")
        estudio_files = []

    if not directo_files and not estudio_files:
        print("ERROR: No se encontraron fotos en ninguna carpeta. Abortando.")
        return None

    catalog = {
        'version': 1,
        'account': 'manager@rubencoton.com',
        'directo': [],
        'estudio': [],
        'stats': {}
    }

    for f in directo_files:
        info = categorize_photo(f['name'], 'directo')
        catalog['directo'].append({
            'id': f['id'],
            'name': f['name'],
            'mime': f.get('mimeType', ''),
            'size': int(f.get('size') or 0),
            'modified': f.get('modifiedTime', ''),
            'evento': info['evento'],
            'lugar': info['lugar'],
            'tags': info['tags'],
            'url': f"https://lh3.googleusercontent.com/d/{f['id']}=w600"
        })

    for f in estudio_files:
        info = categorize_photo(f['name'], 'estudio')
        catalog['estudio'].append({
            'id': f['id'],
            'name': f['name'],
            'mime': f.get('mimeType', ''),
            'size': int(f.get('size') or 0),
            'modified': f.get('modifiedTime', ''),
            'evento': info['evento'],
            'lugar': info['lugar'],
            'tags': info['tags'],
            'url': f"https://lh3.googleusercontent.com/d/{f['id']}=w600"
        })

    # Sort by size descending (larger files = higher resolution = better quality)
    catalog['directo'].sort(key=lambda x: x['size'], reverse=True)
    catalog['estudio'].sort(key=lambda x: x['size'], reverse=True)

    # Stats
    eventos = {}
    for foto in catalog['directo'] + catalog['estudio']:
        ev = foto['evento']
        eventos[ev] = eventos.get(ev, 0) + 1
    catalog['stats'] = {
        'total_directo': len(catalog['directo']),
        'total_estudio': len(catalog['estudio']),
        'total': len(catalog['directo']) + len(catalog['estudio']),
        'por_evento': eventos
    }

    os.makedirs(os.path.dirname(CATALOG_FILE), exist_ok=True)
    with open(CATALOG_FILE, 'w', encoding='utf-8') as out:
        json.dump(catalog, out, indent=2, ensure_ascii=False)

    print(f"\nCatalogo guardado: {CATALOG_FILE}")
    print(f"Total: {catalog['stats']['total']} fotos")
    print(f"  Directo: {catalog['stats']['total_directo']}")
    print(f"  Estudio: {catalog['stats']['total_estudio']}")
    print(f"  Por evento: {json.dumps(eventos, indent=4)}")
    return catalog

if __name__ == '__main__':
    build_catalog()
