/**
 * server.js — Servidor del Email Builder de RUBEN COTON
 * - Sirve archivos estaticos
 * - API /api/photos-catalog — catalogo Drive
 * - API /api/sync-drive — fuerza sync Drive
 * - API /api/create-gmail-draft — crea borrador con adjuntos
 * - Solo escucha en 127.0.0.1 (localhost) por seguridad
 * - Auto-sync cada 30 min si catalogo tiene > 1 hora
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

// Cargar .env
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) { console.log('[ENV] .env no existe'); return; }
    let raw = fs.readFileSync(envPath, 'utf8');
    // Quitar BOM si existe
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const lines = raw.split(/\r?\n/);
    let count = 0;
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        count++;
      }
    }
    console.log('[ENV] Cargadas ' + count + ' variables. GEMINI_API_KEY=' + (process.env.GEMINI_API_KEY ? 'OK' : 'MISSING'));
  } catch (e) { console.log('[ENV] Error: ' + e.message); }
}
loadEnv();

const PORT = parseInt(process.env.PORT || '8090', 10);
// Si AUTH_PASSWORD definido (modo VPS), escuchar en 0.0.0.0 (público) con auth.
// Si no (modo local PC), solo localhost.
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const AUTH_USER = process.env.AUTH_USER || 'ruben';
const HOST = AUTH_PASSWORD ? '0.0.0.0' : '127.0.0.1';
const BASE = path.resolve(__dirname);
const CATALOG_FILE = path.join(BASE, 'config', 'photos-catalog.json');
const SYNC_SCRIPT = path.join(BASE, 'scripts', 'drive-sync.py');
const GMAIL_SCRIPT = path.join(BASE, 'scripts', 'create-gmail-draft.py');

const MAX_BODY_BYTES = 40 * 1024 * 1024; // 40MB limite POST
const PYTHON_TIMEOUT_MS = 90000; // 90s timeout Python

// Content types
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.heic': 'image/heic', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.map': 'application/json', '.txt': 'text/plain'
};

// Mutex para sync (evita race conditions auto-sync vs manual)
let syncInProgress = false;

// Cache en memoria del catalog (se invalida al completar sync)
let catalogCache = null;

function loadCatalogToCache() {
  try {
    catalogCache = fs.readFileSync(CATALOG_FILE, 'utf8');
  } catch (e) {
    catalogCache = null;
  }
}

function runDriveSync(callback) {
  if (syncInProgress) {
    console.log('[SYNC] Ya hay un sync en curso, saltando');
    if (callback) callback(false, 'Sync already in progress');
    return;
  }
  syncInProgress = true;
  console.log('[SYNC] Ejecutando sync con Google Drive...');
  exec(`python "${SYNC_SCRIPT}"`, { timeout: 120000 }, (err, stdout, stderr) => {
    syncInProgress = false;
    if (err) {
      console.error('[SYNC] Error:', stderr || err.message);
      if (callback) callback(false, stderr || err.message);
      return;
    }
    console.log('[SYNC]', stdout.trim());
    // Invalidar cache para proxima lectura
    catalogCache = null;
    if (callback) callback(true, stdout.trim());
  });
}

function needsSync() {
  try {
    const stat = fs.statSync(CATALOG_FILE);
    return (Date.now() - stat.mtimeMs) > 3600000;
  } catch {
    return true;
  }
}

// Helper: envia JSON response (evita doble writeHead)
function sendJson(res, status, data) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'http://127.0.0.1:' + PORT,
    'Access-Control-Allow-Methods': 'GET, POST'
  });
  res.end(JSON.stringify(data));
}

// Health check público (sin auth) — usado por Coolify para detectar app viva
function isHealthCheck(pathname) {
  return pathname === '/health' || pathname === '/api/health';
}

// BasicAuth — solo activo si AUTH_PASSWORD env var existe
function checkBasicAuth(req, res) {
  if (!AUTH_PASSWORD) return true; // modo local, sin auth
  if (isHealthCheck(new URL(req.url, 'http://x').pathname)) return true;
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (u === AUTH_USER && p === AUTH_PASSWORD) return true;
    } catch (e) {}
  }
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="RUBEN COTON Email Builder", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end('Acceso restringido. Introduce las credenciales.');
  return false;
}

const server = http.createServer((req, res) => {
  // BasicAuth gate (si está habilitado)
  if (!checkBasicAuth(req, res)) return;

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // Health endpoint
  if (isHealthCheck(url.pathname)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }

  // CORS: solo localhost permitido
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:' + PORT);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  // API: Get photo catalog (cache en memoria, no I/O disco en cada request)
  if (url.pathname === '/api/photos-catalog') {
    if (!catalogCache) loadCatalogToCache();
    if (!catalogCache) {
      sendJson(res, 404, { error: 'Catalog not found. Run sync first.' });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(catalogCache);
    return;
  }

  // API: Trigger Drive sync
  if (url.pathname === '/api/sync-drive') {
    runDriveSync((ok, msg) => {
      sendJson(res, 200, { ok, message: msg });
    });
    return;
  }

  // API: Base de conocimiento RUBEN COTON
  if (url.pathname === '/api/perfil' && req.method === 'GET') {
    try {
      const data = fs.readFileSync(path.join(BASE, 'config', 'perfil-ruben-coton.json'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(data);
    } catch (e) { sendJson(res, 500, { error: 'No se pudo leer perfil' }); }
    return;
  }
  if (url.pathname === '/api/blacklists' && req.method === 'GET') {
    try {
      const data = fs.readFileSync(path.join(BASE, 'config', 'blacklists.json'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(data);
    } catch (e) { sendJson(res, 500, { error: 'No se pudo leer blacklists' }); }
    return;
  }

  // API: Refinar email — chat con IA para ajustar el email ya generado
  if (url.pathname === '/api/refinar-email' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0; let rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      bodySize += chunk.length;
      if (bodySize > 2 * 1024 * 1024) { rejected = true; req.destroy(); sendJson(res, 413, { ok:false, error:'Demasiado grande' }); }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (rejected) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const textosActuales = body.textos || {};
        const instruccion = (body.instruccion || '').slice(0, 1000);
        const historial = body.historial || [];
        const reglasAprendidas = Array.isArray(body.reglasAprendidas) ? body.reglasAprendidas.slice(0, 15) : [];

        const prompt =
          'Eres asistente de RUBEN COTON, DJ profesional. Tienes un email YA generado y el usuario te da instrucciones para mejorarlo, modificarlo o ajustarlo.\n\n' +
          (reglasAprendidas.length > 0 ? '🧠 REGLAS APRENDIDAS DE CORRECCIONES PREVIAS DEL USUARIO (RESPÉTALAS SIEMPRE):\n' + reglasAprendidas.map((r,i)=>(i+1)+'. '+r).join('\n') + '\n\n' : '') +
          'EMAIL ACTUAL (campos JSON):\n' +
          '- asunto: ' + JSON.stringify(textosActuales.asunto || '') + '\n' +
          '- saludo: ' + JSON.stringify(textosActuales.saludo || '') + '\n' +
          '- intro: ' + JSON.stringify(textosActuales.intro || '') + '\n' +
          '- cuerpo: ' + JSON.stringify(textosActuales.cuerpo || '') + '\n' +
          '- cta: ' + JSON.stringify(textosActuales.cta || '') + '\n\n' +
          (historial.length > 0 ? 'CONVERSACIÓN PREVIA:\n' + historial.map(h => '- USUARIO: ' + h.user + '\n  ASISTENTE: ' + (h.asistente || '(modificó el email)')).join('\n') + '\n\n' : '') +
          'INSTRUCCIÓN ACTUAL DEL USUARIO: ' + instruccion + '\n\n' +
          'REGLAS INVIOLABLES (mantén estas siempre):\n' +
          '- Primera persona, tuteo cercano.\n' +
          '- Saludo "Buenos días [Nombre], ¿qué tal?" o similar natural.\n' +
          '- Despedida "Un abrazo grande, RUBEN COTON" o "Un saludo grande, RUBEN COTON".\n' +
          '- RUBEN COTON en mayúsculas sin tildes, una T.\n' +
          '- Real Madrid Baloncesto SIEMPRE en pasado (6 temporadas consecutivas, etapa cerrada marzo 2026).\n' +
          '- Cadena Dial: medio donde fue resaltado el trabajo.\n' +
          '- Palau Alameda (Valencia) sala con fiesta After You. NO "Sala After You".\n' +
          '- Solo venues reales: Palau Alameda, Movistar Arena, Palacio de Aldovea (solo bodas), Mad Cool, Churrymember Fest. Patronales: Soto del Real, Villaconejos, Villablino, Chinchón, Roa de Duero, Seseña, Coslada, Pelahustán, Colmenar de Oreja, El Real de San Vicente.\n' +
          '- Artistas reales con quien ha compartido escenario: Abel Ramos, DJ Neil, Sofía Cristo, Dani BPM, DJ Marta, Mago de Oz, OBK.\n' +
          '- Mailing en frío: NUNCA fingir conocer al destinatario ("he visto tu evento" PROHIBIDO).\n' +
          '- Castellano de España con tildes y eñes.\n\n' +
          'Devuelve ÚNICAMENTE este JSON con el email modificado según la instrucción del usuario (mantén los campos que no toque la instrucción tal cual):\n' +
          '{"asunto":"...","saludo":"...","intro":"...","cuerpo":"...","cta":"...","comentario":"breve explicación al usuario de qué cambiaste y por qué (1-2 frases)"}\n';

        const schema = {
          type: 'object',
          properties: {
            asunto: { type:'string' }, saludo:{ type:'string' }, intro:{ type:'string' },
            cuerpo: { type:'string' }, cta:{ type:'string' }, comentario:{ type:'string' }
          },
          required: ['asunto','saludo','intro','cuerpo','cta','comentario']
        };
        const result = await llmCascade(prompt, schema, {});
        // Validar que vengan los 5 campos obligatorios con contenido mínimo
        if (result.ok && result.json) {
          const must = ['asunto','saludo','intro','cuerpo','cta'];
          const vacios = must.filter(k => !result.json[k] || String(result.json[k]).trim().length < 3);
          if (vacios.length > 0) {
            return sendJson(res, 200, { ok:false, error: 'IA devolvió campos vacíos (' + vacios.join(',') + '), reintenta', source: result.source });
          }
        }
        sendJson(res, 200, result);
      } catch (e) { sendJson(res, 500, { ok:false, error: String(e.message || e) }); }
    });
    return;
  }

  // API: Chat IA UNIVERSAL — sin sesgo de marca RUBEN COTON
  // Ollama qwen2.5:14b local. Mantiene contexto de conversación por turn.
  if (url.pathname === '/api/chat-libre' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0; let rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      bodySize += chunk.length;
      if (bodySize > 4 * 1024 * 1024) { rejected = true; req.destroy(); sendJson(res, 413, { ok:false, error:'Demasiado grande' }); }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (rejected) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const messages = Array.isArray(body.messages) ? body.messages.slice(-30) : [];
        if (messages.length === 0) return sendJson(res, 200, { ok:false, error:'Sin mensajes' });
        // Validar shape y truncar
        const safeMessages = messages.map(m => ({
          role: (m.role === 'user' || m.role === 'assistant') ? m.role : 'user',
          content: String(m.content || '').slice(0, 8000)
        })).filter(m => m.content.trim().length > 0);
        if (safeMessages.length === 0) return sendJson(res, 200, { ok:false, error:'Mensajes vacíos' });
        if (safeMessages[safeMessages.length-1].role !== 'user') return sendJson(res, 200, { ok:false, error:'Último mensaje debe ser del usuario' });

        const t0 = Date.now();
        try {
          // Usar /api/chat de Ollama para multi-turn nativo
          const r = await callOllamaChat(safeMessages, 120000);
          if (r && r.content) {
            console.log('[CHAT-LIBRE] OK Ollama en ' + (Date.now()-t0) + 'ms (' + r.content.length + ' chars)');
            return sendJson(res, 200, { ok:true, source:'ollama', respuesta: r.content, ms: Date.now()-t0 });
          }
          return sendJson(res, 200, { ok:false, error:'Ollama no devolvió contenido' });
        } catch (e) {
          // Fallback a Gemini si está configurado
          if (process.env.GEMINI_API_KEY) {
            try {
              // Convertir messages al formato prompt para Gemini (sin schema)
              const flatPrompt = safeMessages.map(m => (m.role === 'user' ? 'USUARIO: ' : 'ASISTENTE: ') + m.content).join('\n\n') + '\n\nASISTENTE:';
              const g = await callGeminiText(flatPrompt, 60000);
              if (g && g.text) return sendJson(res, 200, { ok:true, source:'gemini', respuesta: g.text, ms: Date.now()-t0 });
            } catch (ge) {
              return sendJson(res, 200, { ok:false, error:'Ollama: ' + e.message + ' | Gemini: ' + ge.message });
            }
          }
          return sendJson(res, 200, { ok:false, error:'Ollama: ' + e.message });
        }
      } catch (e) { sendJson(res, 500, { ok:false, error: String(e.message || e) }); }
    });
    return;
  }

  // API: Refinar UN BLOQUE concreto del email (modo libre con selección visual)
  if (url.pathname === '/api/refinar-bloque' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0; let rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      bodySize += chunk.length;
      if (bodySize > 1 * 1024 * 1024) { rejected = true; req.destroy(); sendJson(res, 413, { ok:false, error:'Demasiado grande' }); }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (rejected) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const bloque = String(body.bloque || 'libre').slice(0, 30);
        const textoOriginal = String(body.textoOriginal || '').slice(0, 4000);
        const instruccion = String(body.instruccion || '').slice(0, 1000);
        const reglasAprendidas = Array.isArray(body.reglasAprendidas) ? body.reglasAprendidas.slice(0, 15) : [];
        if (!textoOriginal || !instruccion) {
          return sendJson(res, 200, { ok:false, error:'Faltan textoOriginal o instruccion' });
        }
        const prompt =
          'Eres un editor experto. RUBEN COTON (DJ profesional) tiene seleccionado UN bloque de un email y te pide que lo modifiques.\n\n' +
          (reglasAprendidas.length > 0 ? '🧠 REGLAS APRENDIDAS DEL USUARIO (respétalas siempre):\n' + reglasAprendidas.map((r,i)=>(i+1)+'. '+r).join('\n') + '\n\n' : '') +
          'BLOQUE A EDITAR: ' + bloque + '\n' +
          'TEXTO ACTUAL:\n"""\n' + textoOriginal + '\n"""\n\n' +
          'INSTRUCCIÓN DEL USUARIO: ' + instruccion + '\n\n' +
          'REGLAS INVIOLABLES:\n' +
          '- Devuelve SOLO el bloque modificado, en castellano de España con tildes y eñes.\n' +
          '- Primera persona, tuteo cercano. NO tercera persona.\n' +
          '- RUBEN COTON en mayúsculas sin tildes.\n' +
          '- Real Madrid Baloncesto SIEMPRE en pasado (etapa cerrada marzo 2026).\n' +
          '- Solo venues reales: Palau Alameda (Valencia), Movistar Arena, Palacio de Aldovea (bodas), Mad Cool, Churrymember Fest. Patronales reales: Soto del Real, Villaconejos, Villablino, Chinchón, Roa de Duero, Seseña, Coslada, Pelahustán, Colmenar de Oreja, El Real de San Vicente.\n' +
          '- NUNCA inventar destinatarios ni eventos del lector ("he visto tu evento" PROHIBIDO).\n' +
          '- Mantén el formato original (si era una frase, devuelve una frase; si era un párrafo, un párrafo).\n' +
          '- NO añadas comillas, asteriscos ni marcado HTML alrededor.\n' +
          '- Aplica EXACTAMENTE lo que pide la instrucción, sin extender ni recortar de más.\n\n' +
          'Devuelve SOLO este JSON:\n{"nuevoTexto":"...el bloque modificado..."}\n';
        const schema = { type:'object', properties:{ nuevoTexto:{ type:'string' } }, required:['nuevoTexto'] };
        const t0 = Date.now();
        const result = await llmCascade(prompt, schema, {});
        if (result.ok && result.json && typeof result.json.nuevoTexto === 'string') {
          let nuevo = result.json.nuevoTexto.trim();
          // Limpieza: quitar comillas envolventes si la IA las añade
          nuevo = nuevo.replace(/^["“'']|["”'']$/g, '').trim();
          console.log('[REFINAR-BLOQUE] OK ' + result.source + ' en ' + (Date.now()-t0) + 'ms, bloque=' + bloque);
          return sendJson(res, 200, { ok:true, source: result.source, nuevoTexto: nuevo });
        }
        return sendJson(res, 200, { ok:false, error:'IA no devolvió nuevoTexto válido', source: result.source });
      } catch (e) { sendJson(res, 500, { ok:false, error: String(e.message || e) }); }
    });
    return;
  }

  // API: Extraer patrones — analiza correcciones del usuario y devuelve reglas aprendidas
  // Solo Ollama local (sin Gemini) para máxima privacidad y porque es uso intensivo
  if (url.pathname === '/api/extraer-patrones' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0; let rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      bodySize += chunk.length;
      if (bodySize > 4 * 1024 * 1024) { rejected = true; req.destroy(); sendJson(res, 413, { ok:false, error:'Demasiado grande' }); }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (rejected) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const correcciones = Array.isArray(body.correcciones) ? body.correcciones.slice(-50) : [];
        const reglasPrevias = Array.isArray(body.reglasPrevias) ? body.reglasPrevias.slice(0, 30) : [];
        if (correcciones.length === 0) {
          return sendJson(res, 200, { ok:false, error:'No hay correcciones para analizar' });
        }
        // Construir el contexto: cada corrección con instrucción + diff resumido
        const corpus = correcciones.map((c, i) => {
          const a = c.antes || {}; const d = c.despues || {};
          const dif = ['asunto','intro','cuerpo','cta'].map(k => {
            const va = (a[k]||'').slice(0,200); const vd = (d[k]||'').slice(0,200);
            if (va === vd) return null;
            return '  ' + k + ' ANTES: ' + JSON.stringify(va) + '\n  ' + k + ' DESPUÉS: ' + JSON.stringify(vd);
          }).filter(Boolean).join('\n');
          return '#' + (i+1) + ' [audiencia:"' + (c.audiencia||'?').slice(0,60) + '" objetivo:"' + (c.objetivo||'?').slice(0,40) + '"]\n  USUARIO PIDIÓ: ' + (c.instruccion||'').slice(0,250) + '\n' + dif;
        }).join('\n\n');

        const prompt =
          'Eres un analista de patrones. RUBEN COTON usa una IA para generar emails y luego los corrige a través de un chat. Tu trabajo es extraer las REGLAS estables que el usuario quiere SIEMPRE en sus emails, leyendo sus correcciones.\n\n' +
          (reglasPrevias.length > 0 ? 'REGLAS YA APRENDIDAS PREVIAMENTE (no las repitas, mejóralas o añade NUEVAS):\n' + reglasPrevias.map((r,i)=>(i+1)+'. '+r).join('\n') + '\n\n' : '') +
          'CORRECCIONES DEL USUARIO (' + correcciones.length + ' totales):\n' + corpus + '\n\n' +
          'INSTRUCCIONES ESTRICTAS:\n' +
          '- Cada regla DEBE estar evidenciada en AL MENOS 1 corrección concreta del usuario.\n' +
          '- Si una "regla" suena genérica (ej: "tono profesional") y NO se ve en las correcciones, NO la incluyas.\n' +
          '- Prioriza patrones repetidos en ≥2 correcciones (más fuerza).\n' +
          '- Cada regla: 1 frase imperativa en castellano, máximo 25 palabras, accionable.\n' +
          '- NO inventes. NO copies reglas obvias del sistema (tutear, RUBEN COTON mayúsculas, no festival si es ayuntamiento, etc.).\n' +
          '- Enfócate en: TONO específico, LONGITUD preferida, FRASES que evita, DATOS que añade/quita, ESTRUCTURA del cuerpo, VOCABULARIO.\n' +
          '- Mejor 4 reglas sólidas que 12 inventadas.\n' +
          '- Devuelve entre 3 y 12 reglas según evidencia real.\n\n' +
          'Devuelve SOLO este JSON:\n' +
          '{"reglas":["regla 1...","regla 2..."]}\n';

        const schema = {
          type:'object',
          properties:{ reglas:{ type:'array', items:{ type:'string' } } },
          required:['reglas']
        };
        // Solo Ollama local — uso intensivo de aprendizaje, no quemar cuota cloud
        const t0 = Date.now();
        try {
          const r = await callOllama(prompt, schema, 90000);
          if (r && r.json && Array.isArray(r.json.reglas)) {
            const reglas = r.json.reglas
              .map(s => String(s||'').trim())
              .filter(s => s.length >= 8 && s.length <= 250)
              .slice(0, 15);
            console.log('[PATRONES] OK Ollama en ' + (Date.now()-t0) + 'ms — ' + reglas.length + ' reglas');
            return sendJson(res, 200, { ok:true, source:'ollama', reglas, total_correcciones: correcciones.length });
          }
          return sendJson(res, 200, { ok:false, error:'Ollama devolvió respuesta sin reglas válidas' });
        } catch (e) {
          console.log('[PATRONES] Ollama falló: ' + e.message);
          return sendJson(res, 200, { ok:false, error:'Ollama: ' + e.message });
        }
      } catch (e) { sendJson(res, 500, { ok:false, error: String(e.message || e) }); }
    });
    return;
  }

  // API: Cascada LLM (Ollama → Gemini → ...). Recibe { prompt, schema }, devuelve {ok, source, json}
  if (url.pathname === '/api/llm-cascade' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    let rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      bodySize += chunk.length;
      if (bodySize > 1024 * 1024) {
        rejected = true; req.destroy();
        sendJson(res, 413, { ok: false, error: 'Prompt demasiado grande (max 1MB)' });
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (rejected) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result = await llmCascade(body.prompt || '', body.schema, { skipOllama: !!body.skipOllama });
        sendJson(res, 200, result);
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e.message || e) });
      }
    });
    return;
  }

  // API: Crear borrador Gmail (POST) — con timeout + limite body
  if (url.pathname === '/api/create-gmail-draft' && req.method === 'POST') {
    const chunks = []; // Buffer.concat evita reallocation de strings
    let bodySize = 0;
    let rejected = false;

    req.on('data', chunk => {
      if (rejected) return;
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_BYTES) {
        rejected = true;
        req.destroy();
        sendJson(res, 413, { ok: false, error: 'Payload demasiado grande (max 40MB)' });
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (rejected) return;
      const body = Buffer.concat(chunks).toString('utf8');

      const child = spawn('python', [GMAIL_SCRIPT], { windowsHide: true });
      let stdout = '', stderr = '';
      let timedOut = false;

      // Timeout: mata el proceso si tarda > 90s
      const killTimer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch (e) {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} }, 2000);
        sendJson(res, 504, { ok: false, error: 'Timeout: el script tardó más de 90s' });
      }, PYTHON_TIMEOUT_MS);

      child.stdout.on('data', d => stdout += d);
      child.stderr.on('data', d => stderr += d);

      child.on('error', err => {
        clearTimeout(killTimer);
        if (timedOut) return;
        sendJson(res, 500, { ok: false, error: 'Error lanzando Python: ' + err.message });
      });

      child.on('close', code => {
        clearTimeout(killTimer);
        if (timedOut) return;
        if (stderr) console.log('[GMAIL]', stderr.trim());
        try {
          const result = JSON.parse(stdout.trim());
          sendJson(res, result.ok ? 200 : 500, result);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: stderr.trim() || stdout.trim() || 'Error parseando respuesta Python (código ' + code + ')' });
        }
      });

      try {
        child.stdin.write(body);
        child.stdin.end();
      } catch (e) {
        clearTimeout(killTimer);
        sendJson(res, 500, { ok: false, error: 'Error escribiendo stdin: ' + e.message });
      }
    });

    req.on('error', err => {
      if (!rejected) sendJson(res, 400, { ok: false, error: 'Request error: ' + err.message });
    });
    return;
  }

  // Static files — proteccion path traversal
  const rawPath = url.pathname;
  const safePath = path.normalize(rawPath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(BASE, rawPath === '/' || safePath === '\\' || safePath === '' ? 'index.html' : safePath);
  filePath = path.resolve(filePath);

  // SEGURIDAD: case-insensitive en Windows
  const baseNorm = BASE.toLowerCase();
  const pathNorm = filePath.toLowerCase();
  if (!pathNorm.startsWith(baseNorm)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ===== CASCADA LLM =====
// Orden: Ollama (local, gratis) → Gemini (cloud) → ...
async function llmCascade(prompt, schema, opts) {
  opts = opts || {};
  const errors = [];
  console.log('[CASCADA] Iniciando. skipOllama=' + (opts.skipOllama?'YES':'no') + ' GEMINI_API_KEY=' + (process.env.GEMINI_API_KEY ? 'SET' : 'NOT SET'));

  // 1) Ollama local — saltado si frontend ya lo intentó en paralelo
  if (!opts.skipOllama) {
    try {
      const t0 = Date.now();
      const r = await callOllama(prompt, schema, 90000);
      if (r && r.json) {
        console.log('[CASCADA] OK Ollama en ' + (Date.now() - t0) + 'ms');
        return { ok: true, source: 'ollama', json: r.json, raw: r.raw };
      }
      errors.push('ollama: respuesta vacía');
    } catch (e) {
      console.log('[CASCADA] Ollama falló: ' + e.message);
      errors.push('ollama: ' + e.message);
    }
  }

  // 2) Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log('[CASCADA] Probando Gemini (timeout 45s)...');
      const t0 = Date.now();
      const r = await callGemini(prompt, schema, 45000);
      if (r && r.json) {
        console.log('[CASCADA] OK Gemini en ' + (Date.now() - t0) + 'ms');
        return { ok: true, source: 'gemini', json: r.json, raw: r.raw };
      }
      errors.push('gemini: respuesta vacía');
    } catch (e) {
      console.log('[CASCADA] Gemini falló: ' + e.message);
      errors.push('gemini: ' + e.message);
    }
  } else {
    errors.push('gemini: GEMINI_API_KEY no configurada en .env');
  }

  // 3) Anthropic / OpenAI futuros
  return { ok: false, source: 'none', errors };
}

function callOllama(prompt, schema, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'qwen2.5:14b',
      prompt,
      stream: false,
      keep_alive: '30m',
      format: schema || 'json',
      options: { temperature: 0.55, top_p: 0.85, repeat_penalty: 1.15, num_predict: 750, num_ctx: 4096 }
    });
    const opts = { hostname: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
    const req = http.request(opts, r => {
      const buf = []; r.on('data', c => buf.push(c));
      r.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(buf).toString('utf8'));
          const text = body.response || '';
          const json = tryJSON(text);
          resolve({ raw: text, json });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('Ollama timeout ' + timeoutMs + 'ms')); });
    req.write(data); req.end();
  });
}

// Ollama /api/chat — multi-turn nativo, sin schema (para chat libre)
function callOllamaChat(messages, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'qwen2.5:14b',
      messages: messages,
      stream: false,
      keep_alive: '30m',
      options: { temperature: 0.7, top_p: 0.9, repeat_penalty: 1.1, num_predict: 1500, num_ctx: 8192 }
    });
    const opts = { hostname: '127.0.0.1', port: 11434, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
    const req = http.request(opts, r => {
      const buf = []; r.on('data', c => buf.push(c));
      r.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(buf).toString('utf8'));
          const content = body.message && body.message.content ? body.message.content : '';
          resolve({ content });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('Ollama chat timeout ' + timeoutMs + 'ms')); });
    req.write(data); req.end();
  });
}

// Gemini texto plano sin schema (para chat libre fallback)
function callGeminiText(prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const apiKey = process.env.GEMINI_API_KEY;
    const data = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 2000 }
    });
    const opts = { hostname: 'generativelanguage.googleapis.com', port: 443, path: `/v1beta/models/${model}:generateContent?key=${apiKey}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
    const req = https.request(opts, r => {
      const buf = []; r.on('data', c => buf.push(c));
      r.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(buf).toString('utf8'));
          if (body.error) return reject(new Error(body.error.message || 'Gemini error'));
          const text = body.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve({ text });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('Gemini text timeout ' + timeoutMs + 'ms')); });
    req.write(data); req.end();
  });
}

function callGemini(prompt, schema, timeoutMs) {
  return new Promise((resolve, reject) => {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const apiKey = process.env.GEMINI_API_KEY;
    const generationConfig = { temperature: 0.55, topP: 0.85, maxOutputTokens: 1500, responseMimeType: 'application/json' };
    if (schema) generationConfig.responseSchema = schema;
    const data = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig
    });
    const opts = { hostname: 'generativelanguage.googleapis.com', port: 443, path: `/v1beta/models/${model}:generateContent?key=${apiKey}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
    const req = https.request(opts, r => {
      const buf = []; r.on('data', c => buf.push(c));
      r.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(buf).toString('utf8'));
          if (body.error) return reject(new Error(body.error.message || 'Gemini error'));
          const text = body.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const json = tryJSON(text);
          resolve({ raw: text, json });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('Gemini timeout ' + timeoutMs + 'ms')); });
    req.write(data); req.end();
  });
}

function tryJSON(text) {
  try { return JSON.parse(text); } catch (e) {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  return null;
}

server.listen(PORT, HOST, () => {
  console.log(`[EMAIL BUILDER] Servidor en http://${HOST}:${PORT}`);
  console.log(`[EMAIL BUILDER] Tambien accesible en http://localhost:${PORT}`);

  // Pre-cargar catalog en memoria
  loadCatalogToCache();
  if (catalogCache) console.log('[CACHE] Catalog precargado en memoria');

  if (needsSync()) {
    runDriveSync();
  } else {
    console.log('[SYNC] Catalogo actualizado, no necesita sync');
  }

  // Auto-sync periodico cada 30 min
  setInterval(() => {
    if (needsSync()) runDriveSync();
  }, 1800000);
});
