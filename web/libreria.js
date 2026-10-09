// La libreria delle integrazioni: le regole comuni al server (GET /api/connettori/catalogo, npm run catalogo, i test) e al
// browser (i filtri sono istantanei, senza una richiesta per tasto né per carta). Niente DOM e niente import: si prova in Node.
// Il blocco «catalogo» di un manifesto è descritto in docs/CONNETTORI.md.
export const CATEGORIE = ['pagamenti', 'cassa', 'negozi-online', 'marketplace', 'fatturazione', 'contabilita', 'banche', 'spedizioni', 'whatsapp', 'messaggi',
  'email', 'sms', 'calendario', 'prenotazioni', 'archivio', 'produttivita', 'marketing', 'recensioni', 'firma', 'dati-aziende', 'automazione', 'ia'];
export const COSTI = ['gratis', 'a-consumo', 'abbonamento', 'contratto'];
export const DIFFICOLTA = ['facile', 'media', 'difficile'];
export const ZONE = ['IT', 'UE', 'mondo'];

// minuscolo e senza accenti: «Fatturazione» trova «fatturazióne», «città» trova «citta»
export const normalizza = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// il testo in cui si cerca: id, nome, descrizione, categoria e parole chiave (più quello che il server aggiunge in «cerca»)
const testoDi = v => v.cerca || normalizza([v.id, v.nome, v.descrizione, v.catalogo?.categoria, ...(v.catalogo?.parole || [])].join(' '));

// una voce passa se ogni parola cercata sta nel suo testo (anche a metà: «fattur» trova «fatturazione»), e se rispetta
// categoria, costo, difficoltà e zona. Le voci senza blocco «catalogo» passano solo senza filtri di catalogo.
export function filtra(voci, { q = '', categoria = '', costo = '', difficolta = '', zona = '' } = {}) {
  const parole = normalizza(q).split(/\s+/).filter(Boolean);
  return voci.filter(v => {
    const c = v.catalogo || {};
    if (categoria && c.categoria !== categoria) return false;
    if (costo && c.costo !== costo) return false;
    if (difficolta && c.difficolta !== difficolta) return false;
    if (zona && !(c.zone || []).includes(zona)) return false;
    if (!parole.length) return true;
    const t = testoDi(v); return parole.every(p => t.includes(p));
  });
}

// quante voci per categoria (per i bottoni con il numero); «tutte» è il totale
export function conta(voci) {
  const out = { tutte: voci.length };
  for (const v of voci) { const c = v.catalogo?.categoria || 'altro'; out[c] = (out[c] || 0) + 1; }
  return out;
}

// il monogramma della carta (niente loghi dei marchi): due lettere, dalle prime due parole o dalla prima
export function iniziali(nome) {
  const p = String(nome || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
}
// la tinta della carta: sempre la stessa per lo stesso id (0–359)
export function tinta(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h % 360; }

// lo stato della carta: acceso, spento, da configurare, cambiato, rotto; e se è stato provato solo con un servizio finto
export function statoVoce(v) {
  if (v.rotto) return 'rotto';
  if (v.cambiato) return 'cambiato';
  if (v.daApprovare) return 'da-approvare';
  if (v.attivo && v.mancano?.length) return 'da-configurare';
  return v.attivo ? 'acceso' : 'spento';
}
