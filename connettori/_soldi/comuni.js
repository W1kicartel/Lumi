// Attrezzi comuni ai connettori dei soldi (pagamenti, banche, fatturazione, firma). La cartella comincia con «_»:
// il nucleo non la carica come connettore (l'id deve cominciare con una lettera), ma i connettori la importano.
//   riferimento / daRiferimento   il codice di Lumi che viaggia con il pagamento: «lumi-v-<id>» (vendita) o «lumi-f-<id>» (fattura)
//   daIncassare                   quanto deve pagare il cliente (per una fattura con ritenuta: il netto)
//   incassa                       segna pagata la vendita o la fattura, con i controlli di importo, valuta e «già pagata»
//   azioniLink                    le due azioni «link di pagamento» (vendita, fattura) di un servizio, con anteprima e Lumi
//   RICHIEDE_INCASSI, PERMESSI_INCASSI   vendite (modello negozio) e fatture (modello fatture), tutte e due facoltative
//   pubblicoDi                    l'indirizzo pubblico https di Lumi: quello del connettore o, se vuoto, quello della Libreria
//   tokenClient                   un token OAuth «client credentials» con Basic, tenuto in memoria finché vale
//   meta, xmlPassiva              per i connettori SDI: l'azienda e l'import di una fattura passiva (fatture.js)
import { importa } from '../../server/moduli/fatture.js';

export const riferimento = (sem, id) => `lumi-${sem === 'fatture' ? 'f' : 'v'}-${id}`;
export function daRiferimento(s) {
  const m = /lumi-([vf])-([\w-]{1,60})/.exec(String(s ?? ''));
  return m ? { sem: m[1] === 'f' ? 'fatture' : 'vendite', id: m[2] } : null;
}

export const RICHIEDE_INCASSI = {
  vendite: { stato: { tipo: 'stato', facoltativo: true }, totale: { facoltativo: true }, numero: { facoltativo: true }, pagamento: { tipo: 'scelta', facoltativo: true } },
  fatture: { stato: { tipo: 'stato', facoltativo: true }, totale: { facoltativo: true }, netto: { facoltativo: true }, numero: { facoltativo: true }, pagata_il: { tipo: 'data', facoltativo: true } },
};
export const PERMESSI_INCASSI = { vendite: { leggi: true, modifica: true }, fatture: { leggi: true, modifica: true } };

// una fattura con la ritenuta d'acconto si incassa al netto: il cliente versa la ritenuta all'Erario
export function daIncassare(k, sem, r) {
  const netto = sem === 'fatture' && k.campo('fatture', 'netto') ? k.valore(r, sem, 'netto') : null;
  return Math.round(Number(netto ?? k.valore(r, sem, 'totale') ?? 0) * 100) / 100;
}
export const nomeRiga = (k, sem, r) => `${sem === 'fatture' ? 'Fattura' : 'Vendita'} ${k.valore(r, sem, 'numero') || r.numero || r.id}`;
// l'indirizzo pubblico di Lumi per i ritorni e i webhook: l'impostazione del connettore («indirizzo»), se no quello unico
// della Libreria (k.pubblico) purché sia https (i servizi di pagamento lo vogliono); senza barra finale, o ''
export const pubblicoDi = (k, campo = 'indirizzo') => (String(k.imp?.[campo] || '').trim() || (/^https:\/\//i.test(k.pubblico || '') ? k.pubblico : '')).replace(/\/+$/, '');
export const giorno = (k, quando = Date.now()) => new Date(quando).toLocaleDateString('sv-SE', { timeZone: k.fuso() });

// segna pagata: «rif» è il riferimento (stringa) o { sem, id }. Torna l'esito da mettere nel registro
export async function incassa(k, rif, { importo, valuta = 'EUR', quando = Date.now(), metodo = 'carta', fonte = k.man?.nome || k.id } = {}) {
  const x = typeof rif === 'string' ? daRiferimento(rif) : rif;
  if (!x?.id) return 'ignorato: senza riga di Lumi';
  if (valuta && String(valuta).toUpperCase() !== 'EUR') return k.avvisa(`pagamento in ${valuta} per ${x.id}: controllalo a mano`);
  let r; try { r = k.dati.leggi(x.sem, x.id); } catch { return k.avvisa(`pagamento per una riga che non c'è (${x.id})`); }
  if (k.valore(r, x.sem, 'stato') === 'pagata') return 'ignorato: già pagata';
  const totale = daIncassare(k, x.sem, r);
  if (Math.abs(totale - Number(importo)) > 0.005) return k.avvisa(`${nomeRiga(k, x.sem, r)}: pagamento ${fonte} di ${k.euro(importo)} diverso da ${k.euro(totale)}`);
  await k.dati.modifica(x.sem, x.id, { stato: 'pagata',
    ...(x.sem === 'vendite' && k.campo('vendite', 'pagamento') ? { pagamento: metodo } : {}),
    ...(x.sem === 'fatture' && k.campo('fatture', 'pagata_il') ? { pagata_il: giorno(k, quando) } : {}) });
  return 'pagata';
}

// le azioni «link di pagamento» di un servizio. crea(k, { sem, riga, importo, cent, rif, descrizione }) → { url, id? }
export function azioniLink(servizio, crea, { nome = 'Link di pagamento' } = {}) {
  const una = sem => ({
    nome: `${nome} (${sem === 'fatture' ? 'fattura' : 'vendita'})`, su: sem, lumi: true, scrive: true,
    descrizione: `Crea un link ${servizio} per far pagare ${sem === 'fatture' ? 'una fattura' : 'una vendita'} al cliente`,
    input: { [sem === 'fatture' ? 'fattura' : 'vendita']: { tipo: 'relazione', entita: sem, nome: sem === 'fatture' ? 'La fattura da far pagare' : 'La vendita da far pagare' } },
    proponi: async (x, k) => {
      const r = x.fattura || x.vendita, imp = daIncassare(k, sem, r);
      return { titolo: `${nome} ${servizio}`, righe: [[sem === 'fatture' ? 'Fattura' : 'Vendita', k.valore(r, sem, 'numero') || r.id], ['Importo', k.euro(imp)]],
        avvisi: [...(k.valore(r, sem, 'stato') === 'pagata' ? ['È già pagata'] : []), ...(imp <= 0 ? ['L\'importo è zero'] : [])] };
    },
    async esegui(x, k) {
      const r = x.fattura || x.vendita, importo = daIncassare(k, sem, r);
      if (k.valore(r, sem, 'stato') === 'pagata') throw new Error('È già pagata');
      if (!(importo > 0)) throw new Error('L\'importo da pagare è zero');
      return crea(k, { sem, riga: r, importo, cent: Math.round(importo * 100), rif: riferimento(sem, r.id), descrizione: nomeRiga(k, sem, r) });
    },
  });
  return { link_vendita: una('vendite'), link_fattura: una('fatture') };
}
// i testi delle due azioni nelle lingue, a partire dal nome del link
export const testiLink = (link, v, f) => ({ 'az.link_vendita': `${link} (${v})`, 'az.link_fattura': `${link} (${f})` });

// token OAuth «client credentials» con Basic (PayPal e simili), in memoria finché vale (meno un minuto)
const tokens = new Map();
export async function tokenClient(k, url, id, segreto, form = { grant_type: 'client_credentials' }) {
  const chiave = `${k.id}|${url}|${id}`, t = tokens.get(chiave);
  if (t && t.scade - Date.now() > 60000) return t.token;
  const r = await k.http.post(url, { basic: [id, segreto], form });
  if (!r.ok || !r.json?.access_token) throw new Error(`Accesso rifiutato (${r.stato}): controlla le chiavi`);
  tokens.set(chiave, { token: r.json.access_token, scade: Date.now() + Number(r.json.expires_in || 300) * 1000 });
  return r.json.access_token;
}
export const dimenticaToken = k => { for (const c of tokens.keys()) if (c.startsWith(`${k.id}|`)) tokens.delete(c); };

// ---------- fatturazione elettronica ----------
export const meta = { leggi: (db, c) => db.prepare('SELECT valore FROM _meta WHERE chiave = ?').get(c)?.valore ?? null };
// una fattura passiva (XML o .p7m) arrivata da un intermediario entra in «Fatture ricevute», come l'import a mano
export function xmlPassiva(k, nome, dati) {
  const b = Buffer.isBuffer(dati) ? dati : Buffer.from(String(dati));
  return importa(k.db, { S: k.S, D: k.D, meta }, nome, b, k.ctx);
}
export const PERMESSI_PASSIVE = { fatture_ricevute: { leggi: true, crea: true }, fornitori: { leggi: true, crea: true } };
