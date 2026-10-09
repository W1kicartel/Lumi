// Gli SMS ai clienti (Brevo, Twilio, Skebby): l'azione «manda un SMS» per la scheda e per Lumi, e il promemoria
// degli appuntamenti del giorno dopo. invia(k, numeroE164, testo) → { id? } è il servizio del connettore.
import { e164, telefonoDi, nomeDi } from './telefono.js';
import { lingua } from './notifiche.js';

// GSM 03.38: 160 caratteri (153 a pezzo se lungo); con un carattere fuori (emoji, «ő»…) diventa Unicode: 70 (67)
const GSM = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
export function pezzi(testo) {
  const t = String(testo || ''), gsm = GSM.test(t), n = gsm ? [...t].reduce((s, c) => s + ('^{}\\[~]|€'.includes(c) ? 2 : 1), 0) : [...t].length;
  const uno = gsm ? 160 : 70, piu = gsm ? 153 : 67;
  return { caratteri: n, pezzi: n <= uno ? 1 : Math.ceil(n / piu), unicode: !gsm };
}
const prefisso = k => String(k.imp.prefisso || '39');

export function azioneSms(invia, servizio) {
  return {
    nome: 'Manda un SMS', descrizione: `Manda un SMS al cliente con ${servizio}`, su: 'clienti', lumi: true, scrive: true,
    input: { cliente: { tipo: 'relazione', entita: 'clienti', nome: 'Il cliente' }, testo: { tipo: 'testo', nome: 'Il testo dell\'SMS' } },
    proponi: async ({ cliente, testo }, k) => {
      const n = e164(telefonoDi(k, cliente), prefisso(k)), p = pezzi(testo);
      return { titolo: `SMS con ${servizio}`, righe: [['A', `${nomeDi(k, cliente)} ${n || '—'}`], ['Testo', testo], ['Lunghezza', `${p.caratteri} caratteri, ${p.pezzi} SMS`]],
        avvisi: [...(n ? [] : ['Il cliente non ha un numero di telefono valido']), ...(String(testo || '').trim() ? [] : ['Il testo è vuoto'])] };
    },
    async esegui({ cliente, testo }, k) {
      const n = e164(telefonoDi(k, cliente), prefisso(k)); if (!n) throw new Error('Il cliente non ha un numero di telefono valido');
      if (!String(testo || '').trim()) throw new Error('Il testo è vuoto');
      return { a: n, ...(await invia(k, n, String(testo))) };
    },
  };
}

// il promemoria: alle 10 per gli appuntamenti di domani (nel fuso dell'azienda), una volta per appuntamento
const TESTO = { it: 'Promemoria: {nome}, ti aspettiamo {quando}. {azienda}', en: 'Reminder: {nome}, see you {quando}. {azienda}', es: 'Recordatorio: {nome}, te esperamos {quando}. {azienda}',
  fr: 'Rappel : {nome}, nous vous attendons {quando}. {azienda}', de: 'Erinnerung: {nome}, wir erwarten dich {quando}. {azienda}', pt: 'Lembrete: {nome}, esperamos por você {quando}. {azienda}' };
export const impostazioniPromemoria = () => [
  { id: 'promemoria', nome: 'Promemoria SMS il giorno prima degli appuntamenti', tipo: 'si_no', predefinito: false },
  { id: 'testo_promemoria', nome: 'Testo del promemoria ({nome}, {quando}, {azienda})', obbligatorio: false },
];
export function giroPromemoria(invia) {
  return { nome: 'Promemoria degli appuntamenti', alle: '10:00', async giro(k) {
    if (!k.imp.promemoria || !k.campo('appuntamenti', 'quando')) return { mandati: 0 };
    const fuso = k.fuso(), giorno = d => new Date(d).toLocaleDateString('sv-SE', { timeZone: fuso }), domani = giorno(Date.now() + 864e5);
    const l = lingua(k), loc = { it: 'it-IT', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-PT' }[l] || 'it-IT';
    const azienda = k.db.prepare("SELECT valore FROM _meta WHERE chiave = 'azienda'").get()?.valore || '';
    const fatti = new Set(k.stato.leggi('promemoria') || []); let n = 0; const saltati = [];
    const righe = k.dati.elenca('appuntamenti', { filtri: [{ campo: 'quando', op: '>=', valore: new Date(Date.now()).toISOString() }], perPagina: 500 }).righe;
    for (const a of righe) {
      const q = k.valore(a, 'appuntamenti', 'quando'), st = String(k.valore(a, 'appuntamenti', 'stato') || '');
      if (!q || giorno(q) !== domani || fatti.has(a.id) || /annull|cancel/i.test(st)) continue;
      const cid = k.valore(a, 'appuntamenti', 'cliente')?.id; let c = null; try { c = cid ? k.dati.leggi('clienti', cid) : null; } catch { c = null; }
      const num = e164(telefonoDi(k, c), prefisso(k)); if (!num) { saltati.push(a.id); continue; }
      const quando = new Date(q).toLocaleString(loc, { timeZone: fuso, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      const testo = (k.imp.testo_promemoria || TESTO[l] || TESTO.it).replace(/\{(\w+)\}/g, (_, x) => ({ nome: nomeDi(k, c).split(' ')[0], quando, azienda }[x] ?? '')).trim();
      await invia(k, num, testo);
      fatti.add(a.id); n++; k.stato.scrivi('promemoria', [...fatti].slice(-5000));   // segnato subito: un giro che si ferma a metà non manda doppioni
    }
    return { mandati: n, senza_numero: saltati.length };
  } };
}
export const testiSms = {
  en: { 'az.manda_sms': 'Send an SMS', 'imp.promemoria': 'SMS reminder the day before appointments', 'imp.testo_promemoria': 'Reminder text ({nome}, {quando}, {azienda})', 'imp.prefisso': 'Default country code', 'giro.promemoria': 'Appointment reminders' },
  es: { 'az.manda_sms': 'Enviar un SMS', 'imp.promemoria': 'Recordatorio SMS el día antes de las citas', 'imp.testo_promemoria': 'Texto del recordatorio ({nome}, {quando}, {azienda})', 'imp.prefisso': 'Prefijo de país predeterminado', 'giro.promemoria': 'Recordatorios de citas' },
  fr: { 'az.manda_sms': 'Envoyer un SMS', 'imp.promemoria': 'Rappel SMS la veille des rendez-vous', 'imp.testo_promemoria': 'Texte du rappel ({nome}, {quando}, {azienda})', 'imp.prefisso': 'Indicatif pays par défaut', 'giro.promemoria': 'Rappels des rendez-vous' },
  de: { 'az.manda_sms': 'SMS senden', 'imp.promemoria': 'SMS-Erinnerung am Tag vor dem Termin', 'imp.testo_promemoria': 'Erinnerungstext ({nome}, {quando}, {azienda})', 'imp.prefisso': 'Standard-Ländervorwahl', 'giro.promemoria': 'Terminerinnerungen' },
  pt: { 'az.manda_sms': 'Enviar um SMS', 'imp.promemoria': 'Lembrete por SMS na véspera dos agendamentos', 'imp.testo_promemoria': 'Texto do lembrete ({nome}, {quando}, {azienda})', 'imp.prefisso': 'Indicativo do país padrão', 'giro.promemoria': 'Lembretes de agendamentos' },
};
export const impPrefisso = { id: 'prefisso', nome: 'Prefisso del paese per i numeri senza prefisso', predefinito: '39', schema: /^\d{1,4}$/ };
