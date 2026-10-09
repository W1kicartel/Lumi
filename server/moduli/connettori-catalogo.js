// Il blocco «catalogo» dei manifesti: la vista nella lingua di chi guarda e il controllo (test/catalogo.test.mjs e
// npm run catalogo). Le regole comuni con il browser (categorie, filtri, ricerca) sono in web/libreria.js.
// Le traduzioni stanno in testi.<lingua>: 'cat.costoNota' (testo), 'cat.passi' (elenco), 'cat.serve' (elenco di { cosa, dove }).
// Ripiego: lingua → en → it.
import { CATEGORIE, COSTI, DIFFICOLTA, ZONE, normalizza } from '../../web/libreria.js';
export { CATEGORIE, COSTI, DIFFICOLTA, ZONE };
export const LINGUE = ['it', 'en', 'es', 'fr', 'de', 'pt'];
export const CHIAVI_TESTI = ['cat.costoNota', 'cat.passi', 'cat.serve'];

const tr = (man, l, c, d) => man.testi?.[l]?.[c] ?? man.testi?.en?.[c] ?? d;
const trIt = (man, l, c, d) => (l === 'it' ? d : tr(man, l, c, d));
// un manifesto di terzi (connettori/ accanto ai dati) non passa dal test: un campo storto non deve rompere la libreria
const elenco = x => (Array.isArray(x) ? x : []);

// la vista: leggera per le carte, completa (guida, credenziali, fonti) per la pagina del connettore
export function vistaCatalogo(man, l = 'it', completa = false) {
  const c = man?.catalogo; if (!c) return null;
  const base = { categoria: c.categoria || null, costo: c.costo || null, difficolta: c.difficolta || null, zone: elenco(c.zone), prova: c.prova || 'finto', sito: c.sito || null, parole: elenco(c.parole) };
  if (!completa) return base;
  const serveT = trIt(man, l, 'cat.serve', null);
  return { ...base,
    costoNota: trIt(man, l, 'cat.costoNota', c.costoNota || null),
    passi: elenco(trIt(man, l, 'cat.passi', c.passi)),
    // «link» non si traduce: viene sempre dal blocco italiano, voce per voce
    serve: elenco(c.serve).map((s, i) => ({ cosa: serveT?.[i]?.cosa || s?.cosa, dove: serveT?.[i]?.dove || s?.dove, link: s?.link || null })),
    fonti: elenco(c.fonti) };
}

// il testo in cui cerca la libreria: id, nomi e descrizioni in italiano, inglese e nella lingua di chi guarda, parole chiave
export function testoRicerca(man, id, l = 'it') {
  const ls = [...new Set(['it', 'en', l])];
  return normalizza([id, man?.nome, man?.descrizione, man?.catalogo?.categoria, ...elenco(man?.catalogo?.parole),
    ...ls.flatMap(x => [man?.testi?.[x]?.nome, man?.testi?.[x]?.descrizione])].filter(Boolean).join(' '));
}

const https = u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const testoPieno = s => typeof s === 'string' && s.trim().length > 0;

// i problemi del blocco catalogo di un manifesto (vuoto = va bene). Un messaggio chiaro per chi scrive il connettore.
export function controllaCatalogo(man) {
  const p = [], c = man?.catalogo;
  if (!c || typeof c !== 'object') return ['manca il blocco «catalogo» (docs/CONNETTORI.md, «Il blocco catalogo»)'];
  if (!CATEGORIE.includes(c.categoria)) p.push(`categoria «${c.categoria}» non valida: una di ${CATEGORIE.join(', ')}`);
  if (!COSTI.includes(c.costo)) p.push(`costo «${c.costo}» non valido: uno di ${COSTI.join(', ')}`);
  if (!DIFFICOLTA.includes(c.difficolta)) p.push(`difficolta «${c.difficolta}» non valida: una di ${DIFFICOLTA.join(', ')}`);
  if (!Array.isArray(c.zone) || !c.zone.length || c.zone.some(z => !ZONE.includes(z))) p.push(`zone non valide: un elenco con ${ZONE.join(', ')}`);
  if (!https(c.sito)) p.push('sito: serve l\'indirizzo https del servizio');
  if (c.costoNota != null && !testoPieno(c.costoNota)) p.push('costoNota: un testo, o niente');
  if (!Array.isArray(c.passi) || c.passi.length < 3 || c.passi.length > 8 || !c.passi.every(testoPieno)) p.push('passi: da 3 a 8 frasi brevi');
  if (!Array.isArray(c.serve) || !c.serve.length || !c.serve.every(s => testoPieno(s?.cosa) && testoPieno(s?.dove) && (s.link == null || https(s.link))))
    p.push('serve: almeno una voce { cosa, dove, link? } (link in https)');
  if (!Array.isArray(c.fonti) || !c.fonti.length || !c.fonti.every(https)) p.push('fonti: almeno un indirizzo https della documentazione usata');
  if (!['finto', 'vero'].includes(c.prova)) p.push('prova: «finto» (provato con un servizio finto) o «vero»');
  if (c.parole != null && (!Array.isArray(c.parole) || !c.parole.every(testoPieno))) p.push('parole: un elenco di parole chiave');
  if (!testoPieno(man.descrizione)) p.push('manca la descrizione in italiano');
  for (const l of LINGUE.slice(1)) if (!testoPieno(man.testi?.[l]?.descrizione)) p.push(`manca testi.${l}.descrizione`);
  // la guida in inglese: stessi passi e stesse credenziali dell'italiano (e la nota sul costo, se c'è)
  const en = man.testi?.en || {};
  if (!Array.isArray(en['cat.passi']) || en['cat.passi'].length !== (c.passi || []).length || !en['cat.passi'].every(testoPieno)) p.push('testi.en[\'cat.passi\']: la guida in inglese, un passo per ogni passo italiano');
  if (!Array.isArray(en['cat.serve']) || en['cat.serve'].length !== (c.serve || []).length || !en['cat.serve'].every(s => testoPieno(s?.cosa) && testoPieno(s?.dove)))
    p.push('testi.en[\'cat.serve\']: { cosa, dove } in inglese per ogni voce di «serve»');
  if (c.costoNota && !testoPieno(en['cat.costoNota'])) p.push('testi.en[\'cat.costoNota\']: la nota sul costo in inglese');
  for (const l of LINGUE.slice(2)) {   // le altre lingue sono facoltative, ma se ci sono devono tornare
    const x = man.testi?.[l] || {};
    if (x['cat.passi'] != null && (!Array.isArray(x['cat.passi']) || x['cat.passi'].length !== (c.passi || []).length || !x['cat.passi'].every(testoPieno))) p.push(`testi.${l}['cat.passi']: tanti passi quanti in italiano, ognuno un testo`);
    if (x['cat.serve'] != null && (!Array.isArray(x['cat.serve']) || x['cat.serve'].length !== (c.serve || []).length || !x['cat.serve'].every(s => testoPieno(s?.cosa) && testoPieno(s?.dove)))) p.push(`testi.${l}['cat.serve']: tante voci quante in italiano, ognuna { cosa, dove }`);
    if (x['cat.costoNota'] != null && !testoPieno(x['cat.costoNota'])) p.push(`testi.${l}['cat.costoNota']: un testo`);
  }
  // una chiave scritta male (« cat.pasi », o « cat: { passi } » annidato) si perderebbe in silenzio: la guida resterebbe in inglese
  for (const l of LINGUE.slice(1)) for (const x of Object.keys(man.testi?.[l] || {}))
    if ((x === 'cat' || x.startsWith('cat.')) && !CHIAVI_TESTI.includes(x)) p.push(`testi.${l}['${x}']: chiave sconosciuta, le chiavi sono ${CHIAVI_TESTI.join(', ')}`);
  return p;
}
