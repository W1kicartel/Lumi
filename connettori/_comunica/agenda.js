// Gli aiuti comuni ai connettori dell'agenda (Outlook, CalDAV, Calendly, Cal.com): un evento o una prenotazione che
// arriva da fuori diventa un appuntamento di Kubo (con il cliente trovato per email o creato), uno spostamento sposta,
// un annullamento mette lo stato «annullato». Gli id remoti si abbinano con k.sincro: lo stesso evento non entra due volte.
export const REQ = {
  appuntamenti: { quando: { tipo: ['data_ora'] }, cliente: { tipo: 'relazione', facoltativo: true }, servizio: { tipo: 'relazione', facoltativo: true }, stato: { tipo: 'stato', facoltativo: true }, note: { tipo: ['testo_lungo', 'testo'], facoltativo: true } },
  clienti: { nome: {}, email: { tipo: ['email'], facoltativo: true }, telefono: { tipo: ['telefono'], facoltativo: true } },
};
export const PERMESSI = { appuntamenti: { leggi: true, crea: true, modifica: true }, clienti: { leggi: true, crea: true }, servizi: { leggi: true } };
const SEM = 'appuntamenti';
const prova = f => { try { return f(); } catch { return null; } };

// il titolo di un appuntamento: cliente · servizio (i titoli delle relazioni), altrimenti «Appuntamento»
export function titoloDi(k, r) {
  const t = ['cliente', 'servizio'].map(c => k.valore(r, SEM, c)?.titolo).filter(Boolean);
  return t.join(' · ') || 'Appuntamento';
}
// la fine: la durata del servizio (minuti) se c'è, altrimenti quella delle impostazioni
export function fineDi(k, r) {
  const q = k.valore(r, SEM, 'quando'), s = k.valore(r, SEM, 'servizio')?.id;
  const d = s ? Number(prova(() => k.dati.leggi('servizi', s))?.durata) : 0;
  return new Date(Date.parse(q) + (d > 0 ? d : Number(k.imp.durata || 60)) * 6e4).toISOString();
}
export const annullato = (k, r) => k.valore(r, SEM, 'stato') === 'annullato';

// il cliente di una prenotazione: per email, poi per telefono; se non c'è e «crea», lo crea. → id o null
export function clientePer(k, { email, nome, telefono } = {}, { crea = true } = {}) {
  if (!k.campo('clienti', 'nome')) return null;
  const e = String(email || '').trim().toLowerCase();
  const c = (e && k.campo('clienti', 'email') && prova(() => k.dati.trova('clienti', 'email', e))) || (telefono && k.campo('clienti', 'telefono') && prova(() => k.dati.trova('clienti', 'telefono', String(telefono))));
  if (c) return c.id;
  if (!crea || (!e && !nome)) return null;
  const v = { nome: String(nome || e.split('@')[0]).slice(0, 200) };
  if (e && k.campo('clienti', 'email')) v.email = e;
  if (telefono && k.campo('clienti', 'telefono')) v.telefono = String(telefono);
  return k.dati.crea('clienti', v).id;
}
// il servizio con quel nome (il tipo di evento di Calendly, il titolo del tipo di prenotazione di Cal.com)
export function servizioPer(k, nome) {
  if (!nome || !k.campo(SEM, 'servizio')) return null;
  return prova(() => k.dati.trova('servizi', 'nome', String(nome)))?.id || null;
}
const stati = k => { const id = k.campo(SEM, 'stato'); return id ? (k.S.leggi(k.db, k.entita(SEM))?.campi.find(c => c.id === id)?.opzioni || []).map(o => o.id ?? o) : []; };

// arriva un evento: { remoto, quando, cliente: { email, nome, telefono }, servizio, note, vecchio (id remoto prima di uno spostamento) }
// → 'creato' | 'spostato' | 'uguale' | 'ignorato: …'
export function ricevi(k, { remoto, quando, cliente, servizio, note, vecchio, creaClienti = true }) {
  if (!remoto || !quando) return 'ignorato: senza data';
  const iso = new Date(quando).toISOString();
  let rid = k.sincro.locale(SEM, remoto) || (vecchio && k.sincro.locale(SEM, vecchio));
  const r = rid && prova(() => k.dati.leggi(SEM, rid)); if (!r) rid = null;
  if (rid) {
    k.sincro.collega(SEM, rid, remoto);
    const v = {};
    if (k.valore(r, SEM, 'quando') !== iso) v.quando = iso;
    if (k.valore(r, SEM, 'stato') === 'annullato' && stati(k).includes('prenotato')) v.stato = 'prenotato';
    if (!Object.keys(v).length) return 'uguale';
    k.dati.modifica(SEM, rid, v); return 'spostato';
  }
  const v = { quando: iso };
  const c = cliente && k.campo(SEM, 'cliente') ? prova(() => clientePer(k, cliente, { crea: creaClienti })) : null; if (c) v.cliente = c;
  const s = servizioPer(k, servizio); if (s) v.servizio = s;
  if (note && k.campo(SEM, 'note')) v.note = String(note).slice(0, 4000);
  // un evento senza invitati, se nel modello il cliente è obbligatorio, resta solo nel calendario
  let nuovo; try { nuovo = k.dati.crea(SEM, v); } catch (e) { return `ignorato: ${e.message}`; }
  k.sincro.collega(SEM, nuovo.id, remoto);
  return 'creato';
}
// un annullamento: stato «annullato» se il modello lo prevede. → 'annullato' | 'ignorato: …'
export function annulla(k, remoto) {
  const rid = remoto && k.sincro.locale(SEM, remoto), r = rid && prova(() => k.dati.leggi(SEM, rid));
  if (!r) return 'ignorato: appuntamento sconosciuto';
  if (!stati(k).includes('annullato')) return 'ignorato: senza stato annullato';
  if (k.valore(r, SEM, 'stato') === 'annullato') return 'uguale';
  k.dati.modifica(SEM, rid, { stato: 'annullato' }); return 'annullato';
}
// l'indirizzo pubblico di Kubo: quello scritto nel connettore o, se è vuoto, quello unico della Libreria (k.pubblico)
export const indirizzoDi = k => String(k.imp.indirizzo || k.pubblico || '').trim().replace(/\/+$/, '');
export const MANCA_INDIRIZZO = 'Manca l\'indirizzo pubblico di Kubo: impostalo nella Libreria (o nelle impostazioni del connettore)';
// l'indirizzo del webhook, da mostrare al titolare; «serve»: senza indirizzo pubblico è un errore chiaro
export const webhookDi = (k, id, serve = false) => { const b = indirizzoDi(k); if (!b && serve) throw new Error(MANCA_INDIRIZZO); return `${b}/api/connettori/${id}/in`; };
// i conti di un giro di sincronizzazione
export const conta = (conti, x) => { conti[x === 'creato' ? 'creati' : x === 'spostato' ? 'spostati' : /^ignorato/.test(x) ? 'saltati' : 'uguali']++; };
