/**
 * Test refinar email con reglas aprendidas activas.
 * Verifica que la IA respeta las reglas de la base de conocimiento.
 */
const http = require('http');

const textosActuales = {
  asunto: 'Una propuesta DJ para tu evento',
  saludo: 'Buenos días Rocío, ¿qué tal?',
  intro: 'Te escribo porque RUBEN COTON ha sido reconocido como uno de los DJs más activos de la escena nacional, con presencia constante en medios y una audiencia consolidada en muchos sitios.',
  cuerpo: 'He animado el Movistar Arena durante 6 temporadas del Real Madrid Baloncesto, llenando la pista cada partido. He compartido escenario con grandes nombres y he pinchado en muchas patronales.',
  cta: '¿Hablamos?'
};

const reglasAprendidas = [
  'Escribe la introducción en una frase breve, centrada en experiencias relevantes.',
  'Evita mencionar el Real Madrid Baloncesto específicamente.',
  'Añade nombres de lugares concretos donde has pinchado antes.'
];

const body = JSON.stringify({
  textos: textosActuales,
  instruccion: 'mejora este email entero',
  historial: [],
  reglasAprendidas
});

const opts = {
  hostname:'127.0.0.1', port:8090, path:'/api/refinar-email',
  method:'POST', headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
};
const t0 = Date.now();
const req = http.request(opts, r => {
  const buf = []; r.on('data', c => buf.push(c));
  r.on('end', () => {
    const ms = Date.now() - t0;
    try {
      const j = JSON.parse(Buffer.concat(buf).toString('utf8'));
      console.log('=== RESULTADO ('+ms+'ms, source='+(j.source||'?')+') ===');
      if (!j.ok) { console.log('ERROR:', j.error); return; }
      const n = j.json || {};
      console.log('ASUNTO :', n.asunto);
      console.log('INTRO  :', n.intro);
      console.log('CUERPO :', n.cuerpo);
      console.log('CTA    :', n.cta);
      console.log('COMENT :', n.comentario);
      console.log('\n=== AUDITORÍA REGLAS ===');
      const intro = (n.intro || '').toLowerCase();
      const cuerpo = (n.cuerpo || '').toLowerCase();
      const checkRMB = !/real madrid/i.test(n.intro+n.cuerpo);
      const checkIntroBreve = (n.intro || '').split(/[.!?]/).filter(s => s.trim().length>3).length <= 2;
      const checkConcreto = /(soto del real|villaconejos|pelahust|chinch|coslada|colmenar|villablino|aldovea|palau alameda|movistar)/i.test(n.intro+n.cuerpo);
      console.log('R1 intro breve (≤2 frases):', checkIntroBreve ? 'OK' : 'FALLO');
      console.log('R2 NO menciona Real Madrid Baloncesto:', checkRMB ? 'OK' : 'FALLO');
      console.log('R3 menciona lugar concreto:', checkConcreto ? 'OK' : 'FALLO');
    } catch (e) { console.log('Parse error', e.message, Buffer.concat(buf).toString('utf8').slice(0,500)); }
  });
});
req.on('error', e => console.log('Req error:', e.message));
req.setTimeout(120000, () => { req.destroy(new Error('client timeout')); });
req.write(body); req.end();
