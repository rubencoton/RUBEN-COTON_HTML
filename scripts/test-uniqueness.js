// Test uniqueness usando el MISMO post-proceso que el bench principal
const { buildPrompt, aplicarPostproceso, callOllama, parseJSON } = require('./test-prompts.js');

async function run() {
  const N = parseInt(process.env.UNIQ_N || '30');
  const audiencia = 'Concejal de Festejos del Ayuntamiento de Parla';
  const objetivo = 'fiestas_patronales';
  console.log(`Generando ${N} emails para "${audiencia}" / ${objetivo}`);
  console.log('---');
  const asuntos = [];
  for (let i = 1; i <= N; i++) {
    try {
      const prompt = buildPrompt(audiencia, objetivo);
      const ollama = await callOllama(prompt);
      let textos = parseJSON(ollama.text);
      if (textos) textos = aplicarPostproceso(textos, audiencia, objetivo);
      const asunto = textos?.asunto || '(vacio)';
      asuntos.push(asunto);
      console.log(`[${i}] ${asunto}`);
    } catch (e) {
      console.log(`[${i}] FALLO: ${e.message}`);
    }
  }
  console.log('---');
  const set = new Set(asuntos);
  const inicios = new Set(asuntos.map(a => a.split(/\s+/).slice(0,3).join(' ').toLowerCase()));
  const preg = asuntos.filter(a => /^¿(conoces|sabías|sabias|te imaginas|sabes)\b/i.test(a)).length;
  const tercera = asuntos.filter(a => /\bRUBEN COTON\s+(llena|cautiva|llenó|cautivó)/i.test(a)).length;
  const venuesFalsos = asuntos.filter(a => /\b(Sala Apolo|Apolo|Medusa|Sonorama|Auditorio|Polideportivo|Plaza Mayor|Villablanca|Coliseum)\b/i.test(a)).length;
  console.log(`Asuntos únicos: ${set.size}/${N} (${(set.size/N*100).toFixed(0)}%)`);
  console.log(`Inicios distintos: ${inicios.size}/${N} (${(inicios.size/N*100).toFixed(0)}%)`);
  console.log(`Preguntas genéricas: ${preg}/${N}`);
  console.log(`Tercera persona: ${tercera}/${N}`);
  console.log(`Venues falsos en asunto: ${venuesFalsos}/${N}`);
  if (preg <= 2 && tercera === 0 && venuesFalsos === 0 && set.size >= N * 0.7) console.log('✅ Excelente.');
  else console.log('⚠️ Hay problemas.');
}
run().catch(e => { console.error(e); process.exit(1); });
