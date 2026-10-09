// Vonage (ex Nexmo) SMS API: SMS ai clienti, promemoria degli appuntamenti, ricevute di consegna e SMS in arrivo.
// Invio: POST /sms/json (form con api_key e api_secret); ogni pezzo ha il suo status, «0» = accettato.
// Il webhook ha sempre il codice segreto in fondo all'indirizzo; se in Vonage accendi i webhook firmati c'è anche «sig»:
// i parametri senza sig, ordinati per nome, «&nome=valore» con & e = nei valori cambiati in «_», poi HMAC (o MD5 col segreto in coda).
import { createHash, createHmac } from 'node:crypto';
import { stessoSegreto } from '../../server/moduli/connettori-rete.js';
import { nomeDi } from '../_comunica/telefono.js';
import { azioneSms, giroPromemoria, impostazioniPromemoria, testiSms, impPrefisso, pezzi } from '../_comunica/sms.js';

const base = k => k.base || 'https://rest.nexmo.com';
const pubblico = k => String(k.imp.pubblico || k.pubblico || '').trim().replace(/\/+$/, '');   // il suo, o quello della Libreria
export function firmaVonage(segreto, parametri, metodo = 'sha256') {
  const s = Object.keys(parametri).filter(n => n !== 'sig').sort().map(n => `&${n}=${String(parametri[n] ?? '').replace(/[&=]/g, '_')}`).join('');
  return metodo === 'md5hash' ? createHash('md5').update(s + segreto, 'utf8').digest('hex') : createHmac(metodo, segreto).update(s, 'utf8').digest('hex');
}
async function sms(k, numero, testo) {
  const r = await k.http.post(`${base(k)}/sms/json`, { form: { api_key: k.imp.chiave, api_secret: k.segreti.segreto, from: String(k.imp.mittente || '').replace(/^\+/, ''), to: numero.replace(/^\+/, ''), text: testo,
    ...(pezzi(testo).unicode ? { type: 'unicode' } : {}), 'client-ref': 'lumi', ...(pubblico(k) && k.segreti.webhook ? { callback: `${pubblico(k)}/api/connettori/vonage/in/${k.segreti.webhook}` } : {}) } });
  const m = r.json?.messages || [], no = m.find(x => String(x.status) !== '0');
  if (!r.ok || !m.length || no) throw new Error(`Vonage: ${no?.['error-text'] || `HTTP ${r.stato}`}${no ? ` (stato ${no.status})` : ''}`);
  return { id: m[0]['message-id'], pezzi: m.length, credito: m.at(-1)['remaining-balance'] };
}
function clienteDa(k, numero) {   // Vonage scrive i numeri senza «+» (393331234567)
  const n = `+${String(numero || '').replace(/^\+/, '')}`, loc = n.replace(/^\+39/, '');
  for (const v of [n, loc, `0039${loc}`, n.slice(1), loc.replace(/^(\d{3})(\d+)/, '$1 $2')]) { const c = k.dati.trova('clienti', 'telefono', v); if (c) return c; }
  return null;
}

export default {
  id: 'vonage', nome: 'Vonage SMS', versione: 1, icona: 'messaggio',
  descrizione: 'SMS ai clienti e promemoria degli appuntamenti con Vonage (ex Nexmo), con le ricevute di consegna.',
  impostazioni: [
    { id: 'chiave', nome: 'API key', schema: /^[0-9a-z]{6,16}$/i },
    { id: 'segreto', nome: 'API secret', segreto: true },
    { id: 'mittente', nome: 'Mittente: numero Vonage (39…) o nome (max 11 lettere o cifre)', schema: /^[A-Za-z0-9 ]{1,11}$|^\+?\d{6,15}$/ },
    { id: 'pubblico', nome: 'Indirizzo pubblico di Lumi (per le ricevute di consegna)', tipo: 'url', obbligatorio: false },
    { id: 'webhook', nome: 'Codice segreto del webhook', segreto: true, generato: true },
    { id: 'firma', nome: 'Signature secret (solo se hai acceso i webhook firmati)', segreto: true, obbligatorio: false },
    { id: 'metodo', nome: 'Metodo della firma', tipo: 'scelta', opzioni: ['sha256', 'sha512', 'sha1', 'md5', 'md5hash'], predefinito: 'sha256', aiuto: 'Quello scelto in Vonage: sha256 = SHA-256 HMAC, md5hash = MD5 hash (il vecchio predefinito)' },
    impPrefisso, ...impostazioniPromemoria(),
  ],
  richiede: { clienti: { telefono: { tipo: ['telefono'] } } },
  permessi: { clienti: { leggi: true }, appuntamenti: { leggi: true } },
  prova: async k => {
    const r = await k.http.get(`${base(k)}/account/get-balance`, { basic: [k.imp.chiave, k.segreti.segreto] });
    return { ok: r.ok, messaggio: r.ok ? `credito: ${Number(r.json?.value ?? 0).toFixed(2)} €` : r.stato === 401 ? 'API key o secret sbagliati' : `HTTP ${r.stato}` };
  },
  azioni: { manda_sms: azioneSms(sms, 'Vonage') },
  pianificati: { promemoria: giroPromemoria(sms) },
  entrata: {
    // codice segreto in fondo all'indirizzo sempre; la firma sig in più se c'è il signature secret
    firma: { tipo: 'vonage', segreto: 'webhook', verifica: ({ req, grezzo, segreto, k }) => {
      const codice = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/in/')[1] || '');
      if (!codice || !stessoSegreto(codice, segreto)) return false;
      if (!k.segreti.firma) return true;
      const t = grezzo.toString('utf8'); let p = {};
      try { p = /json/i.test(req.headers['content-type'] || '') ? JSON.parse(t || '{}') : Object.fromEntries(new URLSearchParams(t)); } catch { return false; }
      return !!p.sig && stessoSegreto(String(p.sig).toLowerCase(), firmaVonage(k.segreti.firma, p, k.imp.metodo || 'sha256'));
    } },
    idempotenza: ev => `${ev.messageId || ev['message-id']}:${ev.status || 'in'}`,
    async gestisci(ev, k) {
      if (ev.text != null && !ev.status) {   // un SMS in arrivo sul numero Vonage
        const c = clienteDa(k, ev.msisdn), chi = c ? nomeDi(k, c) : `+${ev.msisdn}`;
        k.avvisa(`SMS da ${chi}: ${String(ev.text).slice(0, 300)}`); return `SMS ricevuto da ${chi}`;
      }
      if (['failed', 'rejected', 'expired'].includes(ev.status)) {
        k.avvisa(`l'SMS a +${ev.msisdn} non è stato consegnato${ev['err-code'] && ev['err-code'] !== '0' ? ` (errore ${ev['err-code']})` : ''}`); return `non consegnato: +${ev.msisdn}`;
      }
      return ev.status ? `stato: ${ev.status}` : 'ignorato';
    },
  },
  catalogo: {
    categoria: 'sms', sito: 'https://www.vonage.it/communications-apis/sms/', costo: 'a-consumo',
    costoNota: 'A consumo, senza canone: si paga ogni SMS (per pezzo da 160 caratteri, 70 con emoji) secondo il paese di destinazione, con il listino su vonage.com/communications-apis/sms/pricing. Alla registrazione c\'è un piccolo credito di prova; un numero virtuale ha un canone mensile, un mittente alfanumerico no.',
    serve: [
      { cosa: 'API key e API secret', dove: 'dashboard.nexmo.com → in alto nella pagina iniziale («API key» e «API secret»)', link: 'https://dashboard.nexmo.com' },
      { cosa: 'Un mittente: numero Vonage o nome alfanumerico', dove: 'Dashboard → Numbers → Buy numbers, oppure un nome fino a 11 caratteri dove il paese lo permette', link: 'https://dashboard.nexmo.com/buy-numbers' },
      { cosa: 'Facoltativo: il signature secret per i webhook firmati', dove: 'Dashboard → API Settings → «Signature secret» e metodo di firma (la firma dei webhook va chiesta al supporto Vonage)', link: 'https://dashboard.nexmo.com/settings' },
    ],
    passi: ['Crea un account su vonage.com (c\'è un credito di prova)', 'Copia API key e API secret dalla dashboard e incollali qui', 'Scrivi il mittente: un numero Vonage o il nome del negozio (max 11 caratteri)', 'Per le ricevute di consegna scrivi l\'indirizzo pubblico di Lumi (se l\'hai impostato nella Libreria, puoi lasciarlo vuoto): Lumi lo manda con ogni SMS; in API Settings → SMS settings scegli il metodo POST (o POST-JSON)', 'Se in Vonage hai i webhook firmati, scrivi qui il signature secret e lo stesso metodo di firma', 'Accendi e premi «Prova»: mostra il credito rimasto'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developer.vonage.com/en/api/sms', 'https://developer.vonage.com/en/messaging/sms/guides/delivery-receipts', 'https://developer.vonage.com/en/getting-started/concepts/signing-messages', 'https://developer.vonage.com/en/api/account', 'https://www.vonage.com/communications-apis/sms/pricing/'],
    prova: 'finto', parole: ['vonage', 'nexmo', 'sms', 'messaggi', 'promemoria', 'appuntamenti', 'ricevuta di consegna', 'text message', 'reminder', 'delivery receipt'],
  },
  testi: {
    en: { nome: 'Vonage SMS', descrizione: 'SMS to customers and appointment reminders with Vonage (formerly Nexmo), with delivery receipts.', 'imp.chiave': 'API key', 'imp.segreto': 'API secret', 'imp.mittente': 'Sender: Vonage number (39…) or name (max 11 letters or digits)', 'imp.pubblico': 'Public address of Lumi (for delivery receipts)', 'imp.webhook': 'Webhook secret code', 'imp.firma': 'Signature secret (only if signed webhooks are on)', 'imp.metodo': 'Signature method', 'aiuto.metodo': 'The one chosen in Vonage: sha256 = SHA-256 HMAC, md5hash = MD5 hash (the old default)', ...testiSms.en,
      'cat.costoNota': 'Pay as you go, no fee: each SMS (per 160-character segment, 70 with emoji) is priced by destination country, see vonage.com/communications-apis/sms/pricing. A small trial credit on sign-up; a virtual number has a monthly fee, an alphanumeric sender does not.',
      'cat.serve': [{ cosa: 'API key and API secret', dove: 'dashboard.nexmo.com → top of the home page («API key» and «API secret»)' }, { cosa: 'A sender: Vonage number or alphanumeric name', dove: 'Dashboard → Numbers → Buy numbers, or a name up to 11 characters where the country allows it' }, { cosa: 'Optional: the signature secret for signed webhooks', dove: 'Dashboard → API Settings → «Signature secret» and signature method (signed webhooks are enabled by Vonage support)' }],
      'cat.passi': ['Create an account on vonage.com (trial credit included)', 'Copy API key and API secret from the dashboard and paste them here', 'Write the sender: a Vonage number or the shop name (max 11 characters)', 'For delivery receipts write Lumi\'s public address (if you set it in the Library, you can leave it empty): Lumi sends it with each SMS; in API Settings → SMS settings choose POST (or POST-JSON)', 'If your Vonage webhooks are signed, write the signature secret and the same signature method here', 'Turn on and press «Test»: it shows the remaining credit'] },
    es: { nome: 'Vonage SMS', descrizione: 'SMS a los clientes y recordatorios de citas con Vonage (antes Nexmo), con confirmaciones de entrega.', 'imp.chiave': 'API key', 'imp.segreto': 'API secret', 'imp.mittente': 'Remitente: número Vonage (39…) o nombre (máx. 11 letras o cifras)', 'imp.pubblico': 'Dirección pública de Lumi (para las confirmaciones de entrega)', 'imp.webhook': 'Código secreto del webhook', 'imp.firma': 'Signature secret (solo con webhooks firmados)', 'imp.metodo': 'Método de firma', 'aiuto.metodo': 'El elegido en Vonage: sha256 = HMAC SHA-256, md5hash = hash MD5 (el antiguo predeterminado)', ...testiSms.es },
    fr: { nome: 'Vonage SMS', descrizione: 'SMS aux clients et rappels de rendez-vous avec Vonage (ex Nexmo), avec accusés de réception.', 'imp.chiave': 'API key', 'imp.segreto': 'API secret', 'imp.mittente': 'Expéditeur : numéro Vonage (39…) ou nom (11 lettres ou chiffres max.)', 'imp.pubblico': 'Adresse publique de Lumi (pour les accusés de réception)', 'imp.webhook': 'Code secret du webhook', 'imp.firma': 'Signature secret (seulement avec webhooks signés)', 'imp.metodo': 'Méthode de signature', 'aiuto.metodo': 'Celle choisie dans Vonage : sha256 = HMAC SHA-256, md5hash = hachage MD5 (l\'ancien défaut)', ...testiSms.fr },
    de: { nome: 'Vonage SMS', descrizione: 'SMS an Kunden und Terminerinnerungen mit Vonage (früher Nexmo), mit Zustellberichten.', 'imp.chiave': 'API key', 'imp.segreto': 'API secret', 'imp.mittente': 'Absender: Vonage-Nummer (39…) oder Name (max. 11 Buchstaben oder Ziffern)', 'imp.pubblico': 'Öffentliche Adresse von Lumi (für Zustellberichte)', 'imp.webhook': 'Geheimcode des Webhooks', 'imp.firma': 'Signature secret (nur bei signierten Webhooks)', 'imp.metodo': 'Signaturverfahren', 'aiuto.metodo': 'Das in Vonage gewählte: sha256 = HMAC SHA-256, md5hash = MD5-Hash (der alte Standard)', ...testiSms.de },
    pt: { nome: 'Vonage SMS', descrizione: 'SMS aos clientes e lembretes de agendamentos com a Vonage (antiga Nexmo), com confirmações de entrega.', 'imp.chiave': 'API key', 'imp.segreto': 'API secret', 'imp.mittente': 'Remetente: número Vonage (39…) ou nome (máx. 11 letras ou dígitos)', 'imp.pubblico': 'Endereço público do Lumi (para as confirmações de entrega)', 'imp.webhook': 'Código secreto do webhook', 'imp.firma': 'Signature secret (só com webhooks assinados)', 'imp.metodo': 'Método de assinatura', 'aiuto.metodo': 'O escolhido na Vonage: sha256 = HMAC SHA-256, md5hash = hash MD5 (o antigo padrão)', ...testiSms.pt },
  },
};
