/**
 * Stress test: 50 correcciones para ver timing y calidad con corpus grande.
 */
const http = require('http');

const tipos = [
  { ins:'hazlo más corto',           pat:{ k:'intro', a:'Soy RUBEN COTON con muchísima experiencia en eventos de gran formato y bodas privadas.', d:'Soy RUBEN COTON. 15 años pinchando.' } },
  { ins:'quita Real Madrid',         pat:{ k:'cuerpo', a:'Animé el Movistar Arena 6 temporadas del Real Madrid Baloncesto.', d:'Animé el Movistar Arena varias temporadas.' } },
  { ins:'añade pueblos',             pat:{ k:'cuerpo', a:'He pinchado en muchas patronales.', d:'Patronales: Soto del Real, Villaconejos, Pelahustán.' } },
  { ins:'asunto más concreto',       pat:{ k:'asunto', a:'Una propuesta DJ', d:'Lo que pasó en Pelahustán cuando pinché yo' } },
  { ins:'tono más serio',            pat:{ k:'intro', a:'¡Hola! Soy RUBEN COTON y te traigo una propuesta brutal.', d:'Soy RUBEN COTON, DJ profesional con 15 años de carrera.' } },
  { ins:'menos exclamaciones',       pat:{ k:'cta', a:'¡Hablamos pronto! ¡Te va a encantar!', d:'¿Hablamos?' } },
  { ins:'sin clichés',               pat:{ k:'intro', a:'Te voy a hacer vivir una experiencia inolvidable.', d:'Te ofrezco una propuesta concreta para tu evento.' } },
  { ins:'con datos concretos',       pat:{ k:'cuerpo', a:'He tenido mucho éxito.', d:'He llenado el Movistar Arena 6 temporadas seguidas.' } },
];

const correcciones = [];
for (let i = 0; i < 50; i++) {
  const t = tipos[i % tipos.length];
  const c = {
    instruccion: t.ins,
    antes: { [t.pat.k]: t.pat.a },
    despues: { [t.pat.k]: t.pat.d },
    audiencia: ['Concejal','Boda','Festival','Wedding planner','Junta vecinal'][i%5],
    objetivo: ['fiestas','boda','festival','wedding','vecinal'][i%5]
  };
  correcciones.push(c);
}

const body = JSON.stringify({ correcciones, reglasPrevias: [] });
const opts = { hostname:'127.0.0.1', port:8090, path:'/api/extraer-patrones', method:'POST',
  headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }};
const t0 = Date.now();
const req = http.request(opts, r => {
  const buf = []; r.on('data', c => buf.push(c));
  r.on('end', () => {
    const ms = Date.now() - t0;
    try {
      const j = JSON.parse(Buffer.concat(buf).toString('utf8'));
      console.log('=== STRESS 50 corr ('+ms+'ms, body='+(body.length/1024).toFixed(1)+'KB) ===');
      console.log('ok:', j.ok, 'reglas:', (j.reglas||[]).length);
      (j.reglas||[]).forEach((r,i) => console.log((i+1)+'. '+r));
    } catch(e) { console.log('parse error', e.message); }
  });
});
req.on('error', e => console.log('err', e.message));
req.setTimeout(180000, () => { req.destroy(new Error('timeout')); });
req.write(body); req.end();
