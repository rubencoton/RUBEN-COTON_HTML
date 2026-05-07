/**
 * Test del endpoint /api/extraer-patrones con correcciones realistas.
 */
const http = require('http');

const correcciones = [
  // 3 correcciones sobre LONGITUD (debería detectar patrón)
  { instruccion:'hazlo más corto, máximo 3 frases por bloque',
    antes:{ intro:'Soy RUBEN COTON, DJ profesional con más de 15 años de experiencia animando salas, fiestas patronales y eventos corporativos. He pinchado en muchísimos sitios de toda España y también internacionalmente.' },
    despues:{ intro:'Soy RUBEN COTON, DJ con 15 años pinchando en España.' },
    audiencia:'Concejal de Festejos Coslada', objetivo:'fiestas_patronales' },
  { instruccion:'corta el cuerpo, va muy largo',
    antes:{ cuerpo:'He llenado el Movistar Arena durante 6 temporadas consecutivas. He compartido escenario con Abel Ramos, DJ Neil, Sofía Cristo, DJ Marta, Mago de Oz y OBK. Mi mashup TWENTY suena cada semana en Cadena Dial. He pinchado en patronales como Soto del Real y Villaconejos.' },
    despues:{ cuerpo:'Llené el Movistar Arena 6 temporadas. Compartí escenario con Abel Ramos y Sofía Cristo. Mi TWENTY suena en Cadena Dial.' },
    audiencia:'Boda', objetivo:'boda_particular' },
  { instruccion:'más breve, una idea por frase',
    antes:{ intro:'Te escribo porque RUBEN COTON ha sido reconocido como uno de los DJs más activos de la escena nacional, con presencia constante en medios y una audiencia consolidada.' },
    despues:{ intro:'Soy RUBEN COTON. DJ activo en la escena nacional. Presencia en medios.' },
    audiencia:'Festival', objetivo:'festival_grande' },

  // 2 correcciones sobre QUITAR Real Madrid mention
  { instruccion:'quita la mención al Real Madrid en este contexto',
    antes:{ cuerpo:'Animé el Movistar Arena durante 6 temporadas del Real Madrid Baloncesto, llenando la pista cada partido.' },
    despues:{ cuerpo:'Animé el Movistar Arena durante varias temporadas, llenando la pista.' },
    audiencia:'Concejala Igualdad', objetivo:'concejal_igualdad' },
  { instruccion:'no menciones Real Madrid aquí, no aplica',
    antes:{ intro:'Como ex DJ del Real Madrid Baloncesto durante 6 temporadas, tengo experiencia en eventos masivos.' },
    despues:{ intro:'Tengo experiencia en eventos masivos llenando salas durante 6 temporadas en Movistar Arena.' },
    audiencia:'Ayuntamiento pueblo', objetivo:'fiestas_patronales' },

  // 2 correcciones sobre AÑADIR concreción/pueblos
  { instruccion:'añade más nombres de pueblos donde he pinchado',
    antes:{ cuerpo:'He pinchado en muchas patronales de la Comunidad de Madrid.' },
    despues:{ cuerpo:'He pinchado las patronales de Soto del Real, Villaconejos, Pelahustán, Coslada y Chinchón.' },
    audiencia:'Junta vecinal', objetivo:'junta_vecinal' },
  { instruccion:'pon nombres concretos, no vale "muchos sitios"',
    antes:{ intro:'He animado muchas fiestas y bodas en lugares emblemáticos.' },
    despues:{ intro:'He animado bodas en Palacio de Aldovea y patronales en Soto del Real.' },
    audiencia:'Wedding planner', objetivo:'wedding_planner' },

  // 1 corrección sobre ASUNTO concreto vs genérico
  { instruccion:'el asunto muy genérico, ponlo más concreto con un nombre propio',
    antes:{ asunto:'Una propuesta DJ para tu evento' },
    despues:{ asunto:'Lo que pasó en Pelahustán cuando pinché yo' },
    audiencia:'Comisión festejos', objetivo:'fiestas_patronales' }
];

const reglasPrevias = process.argv[2] === 'con-previas' ? [
  'Escribe la introducción en una sola frase concisa.',
  'Evita mencionar el Real Madrid Baloncesto específicamente.',
  'Añade nombres de lugares concretos donde has pinchado antes.'
] : [];
const body = JSON.stringify({ correcciones, reglasPrevias });
const opts = {
  hostname: '127.0.0.1', port: 8090, path: '/api/extraer-patrones',
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
};
const t0 = Date.now();
const req = http.request(opts, r => {
  const buf = []; r.on('data', c => buf.push(c));
  r.on('end', () => {
    const ms = Date.now() - t0;
    try {
      const j = JSON.parse(Buffer.concat(buf).toString('utf8'));
      console.log('=== RESULTADO ('+ms+'ms) ===');
      console.log(JSON.stringify(j, null, 2));
      if (j.ok && Array.isArray(j.reglas)) {
        console.log('\n=== ANÁLISIS ===');
        console.log('Reglas extraídas: ' + j.reglas.length);
        j.reglas.forEach((r,i) => console.log((i+1)+'. ['+r.length+' chars] '+r));
      }
    } catch (e) { console.log('Parse error', e.message); }
  });
});
req.on('error', e => console.log('Req error:', e.message));
req.setTimeout(120000, () => { req.destroy(new Error('client timeout')); });
req.write(body); req.end();
