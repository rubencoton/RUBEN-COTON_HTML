/**
 * PC Heartbeat — pinguea al VPS cada 30s para que el dot verde aparezca.
 * Uso: node scripts/pc-heartbeat.js
 *
 * Si Ollama local responde → marca PC online en VPS.
 * Si Ollama no responde → no envía (porque sin Ollama, el PC no aporta IA local).
 */
const http = require('http');
const https = require('https');

const VPS_URL = process.env.VPS_URL || 'https://html.rubencoton.com/api/heartbeat';
const HEARTBEAT_TOKEN = process.env.HEARTBEAT_TOKEN || 'rc-pc-heartbeat-2026';
const OLLAMA_URL = 'http://127.0.0.1:11434/api/tags';
const INTERVAL_MS = 30000;

function checkOllama() {
  return new Promise(resolve => {
    const req = http.get(OLLAMA_URL, { timeout: 3000 }, r => {
      resolve(r.statusCode === 200);
      r.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function sendHeartbeat() {
  return new Promise(resolve => {
    const data = JSON.stringify({ token: HEARTBEAT_TOKEN });
    const u = new URL(VPS_URL);
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = lib.request(opts, r => {
      const buf = []; r.on('data', c => buf.push(c));
      r.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(buf).toString('utf8'));
          resolve({ ok: r.statusCode === 200 && j.ok, status: r.statusCode });
        } catch (e) { resolve({ ok: false, status: r.statusCode }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(data); req.end();
  });
}

async function tick() {
  const ollamaOk = await checkOllama();
  if (!ollamaOk) {
    console.log(new Date().toISOString() + ' · ❌ Ollama OFF — no envío heartbeat');
    return;
  }
  const r = await sendHeartbeat();
  if (r.ok) console.log(new Date().toISOString() + ' · ✓ Heartbeat enviado');
  else console.log(new Date().toISOString() + ' · ⚠ Heartbeat falló: ' + (r.error || 'HTTP ' + r.status));
}

console.log('[PC HEARTBEAT] arrancado · VPS=' + VPS_URL + ' · cada ' + (INTERVAL_MS/1000) + 's');
tick();
setInterval(tick, INTERVAL_MS);
