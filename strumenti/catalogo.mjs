// npm run catalogo: scrive docs/CATALOGO.md dai manifesti dei connettori ufficiali (connettori/<id>/connettore.js),
// raggruppati per categoria: cosa fa, cosa serve, costo, difficoltà, provato con un servizio finto o con quello vero.
// Con --controlla non scrive niente: elenca i connettori il cui blocco «catalogo» non va ed esce con 1 (come il test).
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CATEGORIE } from '../web/libreria.js';
import { controllaCatalogo } from '../server/moduli/connettori-catalogo.js';
import IT from '../web/lingue/it/connettori.js';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');
const et = (pre, x) => IT[`connettori.${pre}-${x}`] || x;

// i manifesti ufficiali, in ordine di id: { id, man } oppure { id, rotto }
export async function manifesti(cartella = join(RADICE, 'connettori')) {
  const out = [];
  for (const id of readdirSync(cartella).filter(n => /^[a-z][a-z0-9-]{1,40}$/.test(n)).sort()) {
    const f = join(cartella, id, 'connettore.js'); if (!existsSync(f)) continue;
    try { out.push({ id, man: (await import(pathToFileURL(f).href)).default }); } catch (e) { out.push({ id, rotto: String(e.message) }); }
  }
  return out;
}

const md = s => String(s ?? '').replace(/([\\|*_`[\]<>])/g, '\\$1');
const link = (testo, u) => (/^https:\/\//.test(u || '') ? `[${md(testo)}](${u})` : md(testo));

export function generaCatalogo(lista) {
  const buoni = lista.filter(x => x.man?.catalogo), senza = lista.filter(x => !x.man?.catalogo);
  const gruppi = [...CATEGORIE, 'altro'].map(c => [c, buoni.filter(x => (CATEGORIE.includes(x.man.catalogo.categoria) ? x.man.catalogo.categoria : 'altro') === c)]).filter(([, l]) => l.length);
  const righe = [
    '# Catalogo delle integrazioni', '',
    `Generato da \`npm run catalogo\` dai manifesti in \`connettori/\`: non modificarlo a mano. ${buoni.length} integrazioni in ${gruppi.length} categorie.`,
    'Come si scrive un connettore e il suo blocco «catalogo»: [CONNETTORI.md](CONNETTORI.md).', '',
    '«Provato con un servizio finto» vuol dire che le prove automatiche usano un server finto che risponde come quello vero, secondo la documentazione delle fonti: prima di affidarti, fai una prova nella modalità test del servizio.', '',
    '| Integrazione | Categoria | Costo | Difficoltà | Provato |', '|---|---|---|---|---|',
    ...gruppi.flatMap(([c, l]) => l.map(({ id, man }) => `| [${md(man.nome)}](#${id}) | ${et('cat', c)} | ${et('costo', man.catalogo.costo)} | ${et('diff', man.catalogo.difficolta)} | ${man.catalogo.prova === 'vero' ? 'servizio vero' : 'servizio finto'} |`)),
    '',
  ];
  for (const [c, l] of gruppi) {
    righe.push(`## ${et('cat', c)} (${l.length})`, '');
    for (const { id, man } of l) {
      const g = man.catalogo;
      righe.push(`<a id="${id}"></a>`, `### ${md(man.nome)} · \`${id}\``, '', md(man.descrizione), '',
        `- **Costo:** ${et('costo', g.costo)}${g.costoNota ? ` (${md(g.costoNota)})` : ''}`,
        `- **Difficoltà:** ${et('diff', g.difficolta)} · **Dove:** ${(g.zone || []).map(z => et('zona', z)).join(', ')}`,
        `- **Provato:** ${g.prova === 'vero' ? 'con il servizio vero' : 'con un servizio finto'}`,
        `- **Ti serve:** ${(g.serve || []).map(s => `${link(s.cosa, s.link)} (${md(s.dove)})`).join('; ')}`,
        `- **Passi:** ${(g.passi || []).map((p, i) => `${i + 1}. ${md(p)}`).join(' ')}`,
        `- **Sito e fonti:** ${[link('sito', g.sito), ...(g.fonti || []).map((f, i) => link(`fonte ${i + 1}`, f))].join(' · ')}`, '');
    }
  }
  if (senza.length) righe.push('## Senza blocco catalogo', '', ...senza.map(x => `- \`${x.id}\`${x.rotto ? ` (non si carica: ${md(x.rotto)})` : ''}`), '');
  return righe.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const lista = await manifesti();
  if (process.argv.includes('--controlla')) {
    const male = lista.map(x => [x.id, x.rotto ? [`non si carica: ${x.rotto}`] : controllaCatalogo(x.man)]).filter(([, p]) => p.length);
    for (const [id, p] of male) console.error(`${id}: ${p.join('; ')}`);
    process.exit(male.length ? 1 : 0);
  }
  const f = join(RADICE, 'docs', 'CATALOGO.md'); writeFileSync(f, generaCatalogo(lista));
  console.log(`docs/CATALOGO.md: ${lista.filter(x => x.man?.catalogo).length} integrazioni`);
}
