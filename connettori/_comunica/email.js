// I servizi di email transazionale (SendGrid, Postmark, Mailgun, Resend, Amazon SES): stesse azioni per tutti.
// - manda_email: un'email a un cliente (Lumi: «scrivi a Rossi che…»);
// - invia_fattura: la fattura al cliente, con la stampa HTML e l'XML FatturaPA in allegato (mai una bozza o un'annullata);
// - invia_preventivo: il preventivo al cliente, con la stampa in allegato.
// Il connettore dà solo invia(k, { da, daNome, a, aNome, oggetto, testo, html, allegati: [{ nome, tipo, contenuto: Buffer }] }) → { id }.
import { documentoDi } from './documento.js';
import { nomeDi } from './telefono.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const html = testo => `<p>${esc(testo).replace(/\r?\n\r?\n/g, '</p><p>').replace(/\r?\n/g, '<br>')}</p>`;
const giorno = d => (/^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')) || []).slice(1).reverse().join('/') || '—';
const clienteDi = (k, r) => { const id = k.valore(r, r._sem, 'cliente')?.id; if (!id) return null; try { return k.dati.leggi('clienti', id); } catch { return null; } };
const emailDi = (k, c) => (c && k.valore(c, 'clienti', 'email')) || null;
const fermo = (k, f) => { const s = k.valore(f, 'fatture', 'stato'); return s === 'bozza' ? 'La fattura è ancora una bozza: non si manda' : s === 'annullata' ? 'La fattura è annullata: non si manda' : null; };

export const impostazioniMittente = [
  { id: 'mittente_email', nome: 'Email del mittente (di un dominio verificato)', schema: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  { id: 'mittente_nome', nome: 'Nome del mittente', obbligatorio: false },
  { id: 'rispondi', nome: 'Rispondi a (facoltativo)', obbligatorio: false },
];
const mittente = k => ({ da: k.imp.mittente_email, daNome: k.imp.mittente_nome || null, rispondi: k.imp.rispondi || null });

function documento(sem, nomeDoc) {
  return {
    nome: `Manda ${nomeDoc === 'fattura' ? 'la fattura' : 'il preventivo'} per email`, descrizione: `Manda ${nomeDoc === 'fattura' ? 'la fattura (stampa e XML FatturaPA in allegato)' : 'il preventivo (stampa in allegato)'} al cliente per email`,
    su: sem, lumi: true, scrive: true,
    input: { doc: { tipo: 'relazione', entita: sem, nome: nomeDoc === 'fattura' ? 'La fattura' : 'Il preventivo' } },
    proponi: async ({ doc }, k) => { const c = clienteDi(k, { ...doc, _sem: sem }), a = emailDi(k, c), no = sem === 'fatture' ? fermo(k, doc) : null;
      return { titolo: `${nomeDoc === 'fattura' ? 'Fattura' : 'Preventivo'} per email`, righe: [['Numero', k.valore(doc, sem, 'numero') ?? '—'], ['A', a ? `${nomeDi(k, c)} <${a}>` : '—'], ['Totale', k.euro(k.valore(doc, sem, 'totale'))]],
        avvisi: [...(a ? [] : ['Il cliente non ha un indirizzo email']), ...(no ? [no] : [])] }; },
    async esegui({ doc }, k, x) {
      if (sem === 'fatture' && fermo(k, doc)) throw new Error(fermo(k, doc));
      const c = clienteDi(k, { ...doc, _sem: sem }), a = emailDi(k, c); if (!a) throw new Error('Il cliente non ha un indirizzo email');
      const n = k.valore(doc, sem, 'numero'), d = giorno(k.valore(doc, sem, 'data')), cosa = nomeDoc === 'fattura' ? 'la fattura' : 'il preventivo';
      const testo = `Buongiorno,\nin allegato ${cosa} ${n ?? ''} del ${d}, totale ${k.euro(k.valore(doc, sem, 'totale'))}.\n\nGrazie.`.replace(/ {2,}/g, ' ');
      const r = await x.invia(k, { ...mittente(k), a, aNome: nomeDi(k, c), oggetto: `${nomeDoc === 'fattura' ? 'Fattura' : 'Preventivo'} ${n ?? ''} del ${d}`.replace(/ {2,}/g, ' '), testo, html: html(testo), allegati: documentoDi(k, sem, doc) });
      return { a, id: r?.id ?? null };
    },
  };
}

// le azioni «manda la fattura / il preventivo per email» per un connettore che ha già il suo manifesto (es. Brevo)
export function azioniDocumenti(invia) {
  const az = { invia_fattura: documento('fatture', 'fattura'), invia_preventivo: documento('preventivi', 'preventivo') };
  for (const a of Object.values(az)) { const e = a.esegui; a.esegui = (i, k) => e(i, k, { invia }); }
  return az;
}
export const TESTI_DOCUMENTI = l => ({ 'az.invia_fattura': TESTI[l]['az.invia_fattura'], 'az.invia_preventivo': TESTI[l]['az.invia_preventivo'] });
// def: { id, nome, descrizione, base, oauth?, impostazioni, prova, invia, catalogo, testi }
export function connettoreEmail(def) {
  const az = { manda_email: {
    nome: 'Manda un\'email', descrizione: `Manda un'email al cliente con ${def.nome}`, su: 'clienti', lumi: true, scrive: true,
    input: { cliente: { tipo: 'relazione', entita: 'clienti', nome: 'Il cliente' }, oggetto: { tipo: 'testo', nome: 'L\'oggetto' }, testo: { tipo: 'testo', nome: 'Il testo' } },
    proponi: async ({ cliente, oggetto, testo }, k) => ({ titolo: `Email con ${def.nome}`, righe: [['A', `${nomeDi(k, cliente)} <${emailDi(k, cliente) || '—'}>`], ['Oggetto', oggetto], ['Testo', testo]], avvisi: emailDi(k, cliente) ? [] : ['Il cliente non ha un indirizzo email'] }),
    async esegui({ cliente, oggetto, testo }, k) {
      const a = emailDi(k, cliente); if (!a) throw new Error('Il cliente non ha un indirizzo email');
      if (!String(oggetto || '').trim() || !String(testo || '').trim()) throw new Error('Servono oggetto e testo');
      const r = await def.invia(k, { ...mittente(k), a, aNome: nomeDi(k, cliente), oggetto, testo, html: html(testo), allegati: [] });
      return { a, id: r?.id ?? null };
    },
  } };
  Object.assign(az, azioniDocumenti(def.invia));
  return {
    id: def.id, nome: def.nome, versione: 1, icona: 'documento', ...(def.base ? { base: def.base } : {}), ...(def.oauth ? { oauth: def.oauth } : {}), descrizione: def.descrizione,
    impostazioni: [...def.impostazioni, ...impostazioniMittente],
    richiede: { clienti: { email: { tipo: ['email'] } }, fatture: { numero: { facoltativo: true }, stato: { tipo: 'stato', facoltativo: true }, cliente: { tipo: 'relazione', facoltativo: true } }, preventivi: { cliente: { tipo: 'relazione', facoltativo: true } } },
    permessi: { clienti: { leggi: true }, fatture: { leggi: true }, preventivi: { leggi: true }, vendite: { leggi: true } },
    prova: def.prova, azioni: az, catalogo: def.catalogo,
    testi: Object.fromEntries(['en', 'es', 'fr', 'de', 'pt'].map(l => [l, { ...TESTI[l], ...(def.testi[l] || {}) }])),
  };
}
const TESTI = {
  en: { 'imp.mittente_email': 'Sender email (on a verified domain)', 'imp.mittente_nome': 'Sender name', 'imp.rispondi': 'Reply-to (optional)', 'az.manda_email': 'Send an email', 'az.invia_fattura': 'Email the invoice', 'az.invia_preventivo': 'Email the quote' },
  es: { 'imp.mittente_email': 'Email del remitente (de un dominio verificado)', 'imp.mittente_nome': 'Nombre del remitente', 'imp.rispondi': 'Responder a (opcional)', 'az.manda_email': 'Enviar un email', 'az.invia_fattura': 'Enviar la factura por email', 'az.invia_preventivo': 'Enviar el presupuesto por email' },
  fr: { 'imp.mittente_email': 'E-mail de l\'expéditeur (d\'un domaine vérifié)', 'imp.mittente_nome': 'Nom de l\'expéditeur', 'imp.rispondi': 'Répondre à (facultatif)', 'az.manda_email': 'Envoyer un e-mail', 'az.invia_fattura': 'Envoyer la facture par e-mail', 'az.invia_preventivo': 'Envoyer le devis par e-mail' },
  de: { 'imp.mittente_email': 'Absender-E-Mail (einer verifizierten Domain)', 'imp.mittente_nome': 'Absendername', 'imp.rispondi': 'Antwort an (optional)', 'az.manda_email': 'E-Mail senden', 'az.invia_fattura': 'Rechnung per E-Mail senden', 'az.invia_preventivo': 'Angebot per E-Mail senden' },
  pt: { 'imp.mittente_email': 'Email do remetente (de um domínio verificado)', 'imp.mittente_nome': 'Nome do remetente', 'imp.rispondi': 'Responder para (opcional)', 'az.manda_email': 'Enviar um email', 'az.invia_fattura': 'Enviar a fatura por email', 'az.invia_preventivo': 'Enviar o orçamento por email' },
};
// «Nome <email>» con il nome tra virgolette se serve (RFC 5322)
export const indirizzo = (email, nome) => (nome ? `${/[",<>@;:]/.test(nome) ? `"${String(nome).replace(/"/g, '\'')}"` : nome} <${email}>` : email);
