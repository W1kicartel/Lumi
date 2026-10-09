// Webhook: Kubo parla con n8n, Make, Zapier, Pipedream, IFTTT, Home Assistant… e da lì con migliaia di app.
// In uscita: ogni riga creata o modificata nelle sezioni scelte parte come JSON firmato
//   X-Kubo-Firma: t=<secondi>,v1=<hex HMAC-SHA256(segreto, "<t>.<corpo>")>   (lo stesso schema di Stripe)
// In entrata: POST /api/connettori/webhook-semplice/in/<codice> { azione: 'crea', sezione, valori, id? } crea un cliente, un
// appuntamento, una prenotazione o un'attività; { azione: 'avvisa', testo } manda un avviso a chi usa Kubo.
import { firmaStripeDi } from '../../server/moduli/connettori-rete.js';
import { lingua } from '../_comunica/notifiche.js';

const USCITA = ['clienti', 'fornitori', 'articoli', 'vendite', 'ordini', 'appuntamenti', 'prenotazioni', 'fatture', 'preventivi', 'commesse', 'interventi', 'progetti', 'attivita', 'contratti', 'soci', 'abbonamenti', 'lezioni', 'comande'];
const ENTRATA = ['clienti', 'appuntamenti', 'prenotazioni', 'attivita'];
const scelte = k => new Set(String(k.imp.sezioni || '').split(/[\s,;]+/).filter(Boolean));
async function manda(k, corpo) {
  const testo = JSON.stringify(corpo);
  const r = await k.http.post(k.segreti.url, { testo, intestazioni: { 'Content-Type': 'application/json', 'X-Kubo-Evento': corpo.evento, 'X-Kubo-Firma': firmaStripeDi(k.segreti.firma, testo) } });
  if (!r.ok) throw new Error(`Il webhook ha risposto ${r.stato}`);
  return r;
}
const azienda = k => k.db.prepare("SELECT valore FROM _meta WHERE chiave = 'azienda'").get()?.valore || null;

export default {
  id: 'webhook-semplice', nome: 'Webhook semplice (n8n, Make, Zapier)', versione: 1, icona: 'collegamento',
  descrizione: 'Manda le novità di Kubo a n8n, Make, Zapier o a un tuo programma, e riceve da loro clienti e appuntamenti.',
  impostazioni: [
    { id: 'url', nome: 'Indirizzo del webhook che riceve (da n8n, Make, Zapier…)', segreto: true, tipo: 'url', obbligatorio: false },
    { id: 'sezioni', nome: 'Sezioni da mandare (id separati da virgole)', predefinito: 'clienti, vendite, appuntamenti, prenotazioni, fatture, preventivi' },
    { id: 'firma', nome: 'Segreto della firma (X-Kubo-Firma)', segreto: true, generato: true },
    { id: 'codice', nome: 'Codice segreto per ricevere', segreto: true, generato: true },
  ],
  permessi: Object.fromEntries([...new Set([...USCITA, ...ENTRATA])].map(s => [s, { leggi: true, ...(ENTRATA.includes(s) ? { crea: true } : {}) }])),
  prova: async k => { if (!k.segreti.url) return { ok: true, messaggio: 'Solo in entrata' }; await manda(k, { evento: 'prova', azienda: azienda(k), lingua: lingua(k), quando: new Date().toISOString() }); return { ok: true }; },
  uscita: Object.fromEntries(USCITA.map(sem => [sem, {
    campi: [], quando: (r, k) => !!k.segreti.url && scelte(k).has(sem),
    async invia(r, k) {
      const evento = r.creato && r.creato === r.modificato ? 'creato' : 'modificato';
      await manda(k, { evento: `${sem}.${evento}`, sezione: sem, id: r.id, riga: r, azienda: azienda(k), quando: new Date().toISOString() });
    },
  }])),
  entrata: {
    firma: { tipo: 'token', segreto: 'codice' },
    idempotenza: ev => (ev && typeof ev === 'object' && ev.id ? `id:${ev.id}` : ''),
    async gestisci(ev, k) {
      if (!ev || typeof ev !== 'object') return 'ignorato: serve un oggetto JSON';
      if (ev.azione === 'avvisa') { if (!ev.testo) return 'ignorato: manca il testo'; k.avvisa(String(ev.testo).slice(0, 500)); return 'avvisato'; }
      if (ev.azione !== 'crea') return 'ignorato: azione sconosciuta';
      if (!ENTRATA.includes(ev.sezione)) return `ignorato: sezione non permessa (si crea in ${ENTRATA.join(', ')})`;
      const v = ev.valori && typeof ev.valori === 'object' ? ev.valori : {};
      // un cliente con la stessa email non si duplica
      if (ev.sezione === 'clienti' && v.email) { const c = k.dati.trova('clienti', 'email', String(v.email).trim()); if (c) return `cliente già presente: ${c.id}`; }
      const r = k.dati.crea(ev.sezione, v); return `creato: ${ev.sezione} ${r.id}`;
    },
  },
  catalogo: {
    categoria: 'produttivita', sito: 'https://n8n.io', costo: 'gratis',
    costoNota: 'Il webhook di Kubo è gratis. n8n è gratuito se lo installi tu (open source); Make ha un piano Free con 1.000 operazioni al mese; i webhook di Zapier richiedono un piano a pagamento (da circa 20 $ al mese).',
    serve: [
      { cosa: 'L\'indirizzo del webhook che riceve gli eventi', dove: 'n8n: nodo «Webhook» → Production URL; Make: modulo Webhooks → Custom webhook → Copy address; Zapier: trigger «Webhooks by Zapier» → Catch Hook', link: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/' },
      { cosa: 'Per ricevere: l\'indirizzo di Kubo con il codice segreto (serve un indirizzo pubblico)', dove: 'questa pagina → «Codice segreto per ricevere»: l\'indirizzo è …/api/connettori/webhook-semplice/in/<codice>', link: 'https://www.make.com/en/help/tools/http' },
    ],
    passi: ['In n8n, Make o Zapier crea uno scenario che parte da un webhook e copia il suo indirizzo', 'Incollalo qui e scegli le sezioni da mandare (es. clienti, vendite, appuntamenti)', 'Accendi e premi «Prova»: lo scenario riceve un evento «prova» con cui impostare i campi', 'Per controllare che arrivi da Kubo, verifica X-Kubo-Firma con il «segreto della firma» (HMAC-SHA256 di «t.corpo»)', 'Per far creare clienti o appuntamenti da fuori, manda un POST JSON { "azione": "crea", "sezione": "clienti", "valori": { "nome": "…", "email": "…" } } all\'indirizzo con il codice segreto'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/', 'https://www.make.com/en/help/tools/webhooks', 'https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks', 'https://docs.stripe.com/webhooks#verify-manually'],
    prova: 'finto', parole: ['webhook', 'n8n', 'make', 'integromat', 'zapier', 'pipedream', 'ifttt', 'home assistant', 'automazioni', 'api', 'integrazioni', 'automation'],
  },
  testi: {
    en: { nome: 'Simple webhook (n8n, Make, Zapier)', descrizione: 'Sends Kubo updates to n8n, Make, Zapier or your own program, and receives customers and appointments from them.', 'imp.url': 'Receiving webhook address (from n8n, Make, Zapier…)', 'imp.sezioni': 'Sections to send (ids separated by commas)', 'imp.firma': 'Signature secret (X-Kubo-Firma)', 'imp.codice': 'Secret code for receiving',
      'cat.costoNota': 'Kubo\'s webhook is free. n8n is free if you host it yourself (open source); Make has a Free plan with 1,000 operations a month; Zapier webhooks need a paid plan (from about $20 a month).',
      'cat.serve': [{ cosa: 'The webhook address that receives events', dove: 'n8n: «Webhook» node → Production URL; Make: Webhooks module → Custom webhook → Copy address; Zapier: «Webhooks by Zapier» trigger → Catch Hook' }, { cosa: 'To receive: Kubo\'s address with the secret code (needs a public address)', dove: 'this page → «Secret code for receiving»: the address is …/api/connettori/webhook-semplice/in/<code>' }],
      'cat.passi': ['In n8n, Make or Zapier create a scenario starting from a webhook and copy its address', 'Paste it here and pick the sections to send', 'Turn on and press «Test»: the scenario gets a «prova» event to map the fields', 'To check it comes from Kubo, verify X-Kubo-Firma with the signature secret (HMAC-SHA256 of «t.body»)', 'To create customers or appointments from outside, POST JSON { "azione": "crea", "sezione": "clienti", "valori": { … } } to the address with the secret code'] },
    es: { nome: 'Webhook sencillo (n8n, Make, Zapier)', descrizione: 'Envía las novedades de Kubo a n8n, Make, Zapier o a tu programa, y recibe de ellos clientes y citas.', 'imp.url': 'Dirección del webhook que recibe (de n8n, Make, Zapier…)', 'imp.sezioni': 'Secciones que enviar (ids separados por comas)', 'imp.firma': 'Secreto de la firma (X-Kubo-Firma)', 'imp.codice': 'Código secreto para recibir' },
    fr: { nome: 'Webhook simple (n8n, Make, Zapier)', descrizione: 'Envoie les nouveautés de Kubo à n8n, Make, Zapier ou à ton programme, et en reçoit clients et rendez-vous.', 'imp.url': 'Adresse du webhook qui reçoit (de n8n, Make, Zapier…)', 'imp.sezioni': 'Sections à envoyer (ids séparés par des virgules)', 'imp.firma': 'Secret de la signature (X-Kubo-Firma)', 'imp.codice': 'Code secret pour recevoir' },
    de: { nome: 'Einfacher Webhook (n8n, Make, Zapier)', descrizione: 'Sendet Neuigkeiten aus Kubo an n8n, Make, Zapier oder dein Programm und empfängt von dort Kunden und Termine.', 'imp.url': 'Adresse des empfangenden Webhooks (von n8n, Make, Zapier…)', 'imp.sezioni': 'Zu sendende Bereiche (IDs durch Kommas getrennt)', 'imp.firma': 'Signatur-Geheimnis (X-Kubo-Firma)', 'imp.codice': 'Geheimcode zum Empfangen' },
    pt: { nome: 'Webhook simples (n8n, Make, Zapier)', descrizione: 'Envia as novidades do Kubo para n8n, Make, Zapier ou o seu programa, e recebe deles clientes e agendamentos.', 'imp.url': 'Endereço do webhook que recebe (do n8n, Make, Zapier…)', 'imp.sezioni': 'Seções a enviar (ids separados por vírgulas)', 'imp.firma': 'Segredo da assinatura (X-Kubo-Firma)', 'imp.codice': 'Código secreto para receber' },
  },
};
