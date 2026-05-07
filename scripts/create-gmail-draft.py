"""
create-gmail-draft.py — Crea un borrador en Gmail con el email HTML + adjuntos
Uso: echo '{"asunto":"...","html":"...","adjuntos":[...]}' | python create-gmail-draft.py
"""
import sys, json, base64, io, os, re, time, mimetypes
from html.parser import HTMLParser
from pathlib import Path
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email.mime.application import MIMEApplication
from email import encoders
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError


class _HTML2Text(HTMLParser):
    """Convierte HTML a texto plano para multipart/alternative (anti-spam)."""
    def __init__(self):
        super().__init__()
        self.parts = []
        self._skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('style', 'script', 'head'):
            self._skip += 1
        elif tag in ('br', 'p', 'tr', 'div', 'h1', 'h2', 'h3', 'li'):
            self.parts.append('\n')
        elif tag == 'a':
            href = dict(attrs).get('href', '')
            if href and not href.startswith('mailto:'):
                self.parts.append(' ')
                self._href = href
    def handle_endtag(self, tag):
        if tag in ('style', 'script', 'head') and self._skip > 0:
            self._skip -= 1
        elif tag == 'a' and getattr(self, '_href', None):
            self.parts.append(f' ({self._href})')
            self._href = None
    def handle_data(self, data):
        if self._skip == 0:
            self.parts.append(data)

def html_to_text(html):
    p = _HTML2Text()
    try:
        p.feed(html)
    except Exception:
        text = re.sub(r'<[^>]+>', '', html)
    else:
        text = ''.join(p.parts)
    # Decodificar entidades HTML para que no aparezca &amp; &nbsp; literalmente
    import html as html_module
    text = html_module.unescape(text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]{2,}', ' ', text)
    return text.strip()

BASE = Path(__file__).resolve().parent.parent
CREDS_DIR = Path("C:/Users/elrub/Desktop/CARPETA CODEX/01_PROYECTOS/drive-manager-rubencoton-com")
TOKEN_FILE = CREDS_DIR / "config" / "token.json"
ENV_FILE = CREDS_DIR / ".env"

def load_env():
    env = {}
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env

def get_credentials():
    env = load_env()
    with open(TOKEN_FILE) as f:
        token_data = json.load(f)
    creds = Credentials(
        token=token_data['access_token'],
        refresh_token=token_data['refresh_token'],
        token_uri='https://oauth2.googleapis.com/token',
        client_id=env['GOOGLE_CLIENT_ID'],
        client_secret=env['GOOGLE_CLIENT_SECRET'],
        scopes=['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/drive']
    )
    if creds.expired or not creds.valid:
        creds.refresh(Request())
        token_data['access_token'] = creds.token
        if creds.expiry:
            token_data['expiry_date'] = int(creds.expiry.timestamp() * 1000)
        # Escritura atomica: escribe a tmp y renombra (evita race conditions)
        tmp_file = TOKEN_FILE.with_suffix('.json.tmp')
        with open(tmp_file, 'w') as f:
            json.dump(token_data, f, indent=2)
        tmp_file.replace(TOKEN_FILE)
    return creds

def download_drive_file(drive_service, file_id):
    """Descarga un archivo de Drive y devuelve su contenido en bytes"""
    request = drive_service.files().get_media(fileId=file_id, supportsAllDrives=True)
    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    buffer.seek(0)
    return buffer.read()

def create_draft(data):
    creds = get_credentials()
    gmail = build('gmail', 'v1', credentials=creds)
    drive = build('drive', 'v3', credentials=creds)

    asunto = data.get('asunto', 'Sin asunto')
    html = data.get('html', '')
    adjuntos = data.get('adjuntos', [])

    # 🔒 SECURITY: prevenir header injection (CRLF en asunto puede inyectar headers arbitrarios)
    asunto = asunto.replace('\r', ' ').replace('\n', ' ').strip()[:255]

    # Crear mensaje MIME (estructura: mixed > alternative(plain+html) + adjuntos)
    message = MIMEMultipart('mixed')
    message['Subject'] = asunto
    message['From'] = 'RUBEN COTON <manager@rubencoton.com>'
    message['Reply-To'] = 'manager@rubencoton.com'
    # NO se ponen headers tipo "List-Unsubscribe" ni "X-Mailer" — el email debe parecer 1-on-1
    # personal, NO bulk newsletter. Esos headers delatan envio masivo y suben el riesgo de spam
    # cuando vienen de Gmail personal (no de servicio bulk acreditado).
    # No ponemos 'To' — el usuario lo completa al enviar

    # Parte alternative: TEXTO PLANO PRIMERO (estandar RFC), luego HTML
    body = MIMEMultipart('alternative')
    text_version = html_to_text(html)
    # Si el texto plano queda muy corto, NO usar placeholder spammy: generar contenido mínimo desde el HTML
    if not text_version or len(text_version) < 100:
        text_version = (
            'Soy RUBEN COTON, DJ profesional.\n\n'
            'Le escribo este email con una propuesta para su evento.\n'
            'Para ver el contenido completo con imágenes, abra este correo en un cliente que soporte HTML.\n\n'
            'Contacto:\n'
            'Email: manager@rubencoton.com\n'
            'WhatsApp: +34 613 009 336\n'
        )
    body.attach(MIMEText(text_version, 'plain', 'utf-8'))
    body.attach(MIMEText(html, 'html', 'utf-8'))
    message.attach(body)

    # Limite Gmail: 35MB encoded (~25MB raw). Margen de seguridad 22MB raw.
    MAX_SIZE = 22 * 1024 * 1024
    total_size = len(html.encode('utf-8'))
    adjuntos_ok = 0
    adjuntos_fallidos = []

    # Descarga PARALELA de adjuntos desde Drive (ThreadPool x4)
    from concurrent.futures import ThreadPoolExecutor

    def _download_one(adj):
        nombre = adj.get('nombre', 'documento.pdf')
        # 🔒 Sanitizar filename: filesystem-safe + path traversal + Windows reserved + truncar
        nombre_safe = re.sub(r'[<>:"/\\|?*\n\r\x00]', '_', nombre)
        nombre_safe = nombre_safe.replace('..', '_').strip(' .')
        # Nombres reservados Windows
        if nombre_safe.upper().split('.')[0] in ('CON','PRN','AUX','NUL','COM1','COM2','COM3','COM4','LPT1','LPT2','LPT3'):
            nombre_safe = '_' + nombre_safe
        # Truncar a 200 chars (margen para extension)
        if len(nombre_safe) > 200:
            base, ext = os.path.splitext(nombre_safe)
            nombre_safe = base[:200-len(ext)] + ext
        if not nombre_safe:
            nombre_safe = 'documento.pdf'
        try:
            content = download_drive_file(drive, adj['driveId'])
            return (nombre_safe, content, None)
        except Exception as e:
            return (nombre_safe, None, str(e))

    with ThreadPoolExecutor(max_workers=4) as executor:
        downloads = list(executor.map(_download_one, adjuntos))

    # Adjuntar en orden original con control de tamano
    for nombre_safe, content, err in downloads:
        if err is not None:
            print(f"[ERROR] No se pudo adjuntar {nombre_safe}: {err}", file=sys.stderr)
            adjuntos_fallidos.append(nombre_safe)
            continue
        if total_size + len(content) > MAX_SIZE:
            msg = f"Adjunto '{nombre_safe}' omitido: supera limite Gmail 22MB"
            print(f"[WARN] {msg}", file=sys.stderr)
            adjuntos_fallidos.append(nombre_safe + ' (tamano excedido)')
            continue
        total_size += len(content)
        # MIME type correcto segun extension (PDF, DOCX, PNG, etc.)
        mime_guess, _ = mimetypes.guess_type(nombre_safe)
        if mime_guess and '/' in mime_guess:
            maintype, subtype = mime_guess.split('/', 1)
        else:
            maintype, subtype = 'application', 'octet-stream'
        if maintype == 'application':
            part = MIMEApplication(content, _subtype=subtype)
        else:
            part = MIMEBase(maintype, subtype)
            part.set_payload(content)
            encoders.encode_base64(part)
        part.add_header('Content-Disposition', f'attachment; filename="{nombre_safe}"')
        message.attach(part)
        adjuntos_ok += 1
        print(f"[ADJUNTO] {nombre_safe} ({len(content)} bytes, {maintype}/{subtype})", file=sys.stderr)

    # Codificar y crear borrador con RETRY exponencial (503/429)
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    draft = None
    last_err = None
    for intento in range(3):
        try:
            draft = gmail.users().drafts().create(
                userId='me',
                body={'message': {'raw': raw}}
            ).execute()
            break
        except HttpError as e:
            status = getattr(e.resp, 'status', 0)
            if status in (429, 500, 502, 503, 504) and intento < 2:
                wait = 2 ** intento  # 1s, 2s
                print(f"[RETRY] Gmail {status}, esperando {wait}s...", file=sys.stderr)
                time.sleep(wait)
                last_err = e
                continue
            raise
    if draft is None:
        raise last_err or Exception('Gmail draft creation failed')

    draft_id = draft['id']
    message_id = draft['message']['id']
    return {
        'ok': True,
        'draftId': draft_id,
        'messageId': message_id,
        'asunto': asunto,
        'adjuntos': adjuntos_ok,
        'adjuntos_fallidos': adjuntos_fallidos,
        'link': f'https://mail.google.com/mail/u/0/#drafts/{message_id}'
    }

if __name__ == '__main__':
    try:
        raw_input = sys.stdin.read()
        data = json.loads(raw_input)
        result = create_draft(data)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}), file=sys.stdout)
        sys.exit(1)
