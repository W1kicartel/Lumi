// Aiuti per i connettori che copiano una sezione scelta dal titolare in un servizio «a tabelle» (Fogli Google,
// Airtable, Notion) o che leggono i clienti cambiati da un giro all'altro (Mailchimp, HubSpot).
// La sezione si sceglie a runtime: per leggerla il connettore dichiara permessi { '*': { leggi: true } }.
import { createHash } from 'node:crypto';

// la sezione scelta (id o nome) con i campi esportabili: niente righe figlie, niente campi archiviati
export function sezione(k, scelta) {
  if (!scelta) throw new Error('Scegli la sezione da copiare nelle impostazioni');
  const entita = k.entita(String(scelta).trim()), def = k.S.leggi(k.db, entita);
  if (!def || def.archiviata) throw new Error(`La sezione «${scelta}» non c'è`);
  return { entita, def, campi: k.S.campiAttivi(def).filter(c => c.tipo !== 'righe') };
}

// un valore di Kubo come testo leggibile: relazioni e utenti con il loro titolo, liste separate da virgole
export function testo(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(testo).filter(x => x !== '').join(', ');
  if (typeof v === 'object') return String(v.titolo ?? v.nome ?? v.id ?? '');
  if (typeof v === 'boolean') return v ? 'sì' : 'no';
  return String(v);
}
// un valore per una cella: numeri e sì/no restano tali, il resto diventa testo
export const cella = v => (typeof v === 'number' || typeof v === 'boolean' ? v : testo(v));

// tutte le righe della sezione (a pagine da 500, al massimo «max»), oppure solo quelle modificate dopo «dopo» (ISO)
export function righe(k, entita, { dopo = null, max = 20000 } = {}) {
  const out = [], filtri = dopo ? [{ campo: 'modificato', op: '>', valore: dopo }] : [];
  for (let pagina = 1; out.length < max; pagina++) {
    const p = k.dati.elenca(entita, { filtri, ordina: [{ campo: 'modificato', dir: 'asc' }], perPagina: 500, pagina });
    out.push(...p.righe); if (p.righe.length < 500 || out.length >= p.totale) break;
  }
  return out.slice(0, max);
}
// le righe cambiate dall'ultimo giro: il cursore («modificato» più recente) sta in k.stato, uno per sezione.
// salva() si chiama a lavoro finito: se il servizio si ferma a metà, il giro dopo riprende dalle stesse righe
export function cambiate(k, entita, nome = 'cursore') {
  const chiave = `${nome}:${entita}`, dopo = k.stato.leggi(chiave) || null, rr = righe(k, entita, { dopo });
  const ultimo = rr.reduce((m, r) => (r.modificato > m ? r.modificato : m), dopo || '');
  return { righe: rr, primo: !dopo, salva: (fino = ultimo) => { if (fino) k.stato.scrivi(chiave, fino); } };
}

// a lotti: [1..25] → [[1..10], [11..20], [21..25]]
export const lotti = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
export const md5 = s => createHash('md5').update(String(s)).digest('hex');
// «Anna Maria Rossi» → { nome: 'Anna', cognome: 'Maria Rossi' }
export const spezza = s => { const p = String(s || '').trim().split(/\s+/); return { nome: p[0] || '', cognome: p.slice(1).join(' ') }; };
// il valore di un campo «scelta» se l'opzione esiste, altrimenti il testo libero (per «provenienza»)
export function opzione(k, sem, campo, voluto, libero) {
  const id = k.campo(sem, campo); if (!id) return undefined;
  const c = k.S.leggi(k.db, k.entita(sem))?.campi.find(x => x.id === id);
  if (c?.tipo === 'scelta' || c?.tipo === 'stato') return (c.opzioni || []).some(o => (o.id ?? o) === voluto) ? voluto : undefined;
  return libero;
}
