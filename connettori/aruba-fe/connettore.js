// Aruba Fatturazione Elettronica: Kubo genera l'XML FatturaPA (lo stesso di Openapi SDI, con gli stessi controlli) e lo
// carica su Aruba, che lo firma e lo manda allo SDI; gli esiti delle inviate e le fatture passive si leggono con due giri.
// Accesso: POST /auth/signin (grant_type=password, utente API e password), token di 30 minuti rinnovabile con il
// refresh_token per 60 minuti. Aruba accetta UNA autenticazione al minuto per IP: il token si tiene in memoria e non si
// chiede mai più spesso. Limiti: 30 caricamenti e 12 ricerche al minuto, file fino a 5 MB.
// https://fatturazioneelettronica.aruba.it/apidoc/docs_EN.html
import { xmlDi } from '../openapi-sdi/connettore.js';
import { xmlPassiva, PERMESSI_PASSIVE, giorno } from '../_soldi/comuni.js';

const prod = k => k.imp.ambiente === 'produzione';
const auth = k => k.base || (prod(k) ? 'https://auth.fatturazioneelettronica.aruba.it' : 'https://demoauth.fatturazioneelettronica.aruba.it');
const ws = k => k.base || (prod(k) ? 'https://ws.fatturazioneelettronica.aruba.it' : 'https://demows.fatturazioneelettronica.aruba.it');

// il token: in memoria; rinnovo col refresh_token finché vale; un signin al massimo ogni 61 secondi
const accessi = new Map();
export async function token(k) {
  const c = `${k.id}|${auth(k)}|${k.imp.utente}`, t = accessi.get(c) || {}, ora = Date.now();
  if (t.access && t.scade - ora > 60000) return t.access;
  const prendi = async form => {
    const r = await k.http.post(`${auth(k)}/auth/signin`, { form });
    if (!r.ok || !r.json?.access_token) return null;
    accessi.set(c, { access: r.json.access_token, refresh: r.json.refresh_token, scade: ora + Number(r.json.expires_in || 1800) * 1000, rinnovoFino: ora + 3600000, ultimo: t.ultimo || 0 });
    return r.json.access_token;
  };
  if (t.refresh && t.rinnovoFino > ora) { const x = await prendi({ grant_type: 'refresh_token', refresh_token: t.refresh }); if (x) return x; }
  if (ora - (t.ultimo || 0) < 61000) throw new Error('Aruba accetta un accesso al minuto: riprova fra poco');
  accessi.set(c, { ...t, ultimo: ora });
  const x = await prendi({ grant_type: 'password', username: k.imp.utente, password: k.segreti.password });
  if (!x) throw new Error('Aruba ha rifiutato utente o password dell\'API');
  accessi.get(c).ultimo = ora;
  return x;
}
const api = async (k, metodo, percorso, json) => k.http.richiesta(metodo, ws(k) + percorso, { bearer: await token(k), json });
const emessa = (k, f) => { const s = k.valore(f, 'fatture', 'stato'); if (s === 'bozza' || s === 'annullata') throw new Error(`La fattura è ${s === 'bozza' ? 'ancora una bozza' : 'annullata'}: non si invia allo SDI`); };
// gli stati di Aruba che chiudono la storia di una fattura inviata, e quelli da segnalare
const FINALI = ['Consegnata', 'Accettata', 'Decorrenza termini', 'Scartata', 'Non consegnata', 'Recapito impossibile', 'Rifiutata', 'Errore elaborazione'];
const CATTIVI = ['Scartata', 'Rifiutata', 'Errore elaborazione', 'Recapito impossibile', 'Non consegnata'];

export default {
  id: 'aruba-fe', nome: 'Aruba Fatturazione Elettronica', versione: 1, icona: 'documento',
  descrizione: 'Manda allo SDI le fatture elettroniche di Kubo tramite Aruba, segue gli esiti e scarica le fatture dei fornitori.',
  impostazioni: [
    { id: 'utente', nome: 'Utente API Aruba (di solito il codice dell\'utenza)' },
    { id: 'password', nome: 'Password dell\'utente API', segreto: true },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
  ],
  richiede: { fatture: { stato: { tipo: 'stato' }, numero: {}, cliente: { tipo: 'relazione' }, inviata_il: { tipo: 'data', facoltativo: true } }, clienti: { nome: {} },
    fatture_ricevute: { numero: { facoltativo: true } }, fornitori: { nome: { facoltativo: true } } },
  permessi: { fatture: { leggi: true, modifica: true }, clienti: { leggi: true }, ...PERMESSI_PASSIVE },
  prova: async k => { try { await token(k); return { ok: true }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: {
    invia: {
      nome: 'Invia allo SDI (Aruba)', descrizione: 'Manda la fattura elettronica allo SDI tramite Aruba', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura da inviare' } },
      proponi: async ({ fattura }, k) => ({ titolo: 'Invio allo SDI con Aruba', righe: [['Fattura', fattura.numero || fattura.id], ['Cliente', fattura.cliente?.titolo || '—'], ['Totale', k.euro(fattura.totale)]],
        avvisi: [...(k.sincro.remoto('fatture', fattura.id) ? ['Questa fattura è già stata inviata'] : []), ...(['bozza', 'annullata'].includes(k.valore(fattura, 'fatture', 'stato')) ? ['La fattura non è emessa: non si può inviare'] : [])] }),
      async esegui({ fattura }, k) {
        if (k.sincro.remoto('fatture', fattura.id)) throw new Error('Fattura già inviata allo SDI');
        emessa(k, fattura);
        const { xml, nome } = xmlDi(k, fattura);
        if (Buffer.byteLength(xml) > 5e6) throw new Error('Il file supera i 5 MB accettati da Aruba');
        const r = await api(k, 'POST', '/services/invoice/upload', { dataFile: Buffer.from(xml, 'utf8').toString('base64'), credential: '', domain: '' });
        if (!r.ok || r.json?.errorCode !== '0000') throw new Error(`Aruba: ${r.json?.errorCode || r.stato} ${String(r.json?.errorDescription || r.testo || '').slice(0, 200)}`);
        const file = r.json.uploadFileName; k.sincro.collega('fatture', fattura.id, file);
        k.stato.scrivi('inviate', [...(k.stato.leggi('inviate') || []), { file, fattura: fattura.id, numero: fattura.numero, stato: 'Presa in carico', da: Date.now() }].slice(-2000));
        const v = { ...(k.valore(fattura, 'fatture', 'stato') === 'emessa' ? { stato: 'inviata' } : {}), ...(k.campo('fatture', 'inviata_il') ? { inviata_il: giorno(k) } : {}) };
        if (Object.keys(v).length) k.dati.modifica('fatture', fattura.id, v);
        return { file, nome };
      },
    },
  },
  pianificati: {
    // gli esiti delle fatture inviate: al massimo 10 ricerche a giro (il limite è 12 al minuto)
    esiti: { ogni: '30m', async giro(k) {
      const inviate = k.stato.leggi('inviate') || [], aperte = inviate.filter(x => !FINALI.includes(x.stato) && Date.now() - x.da < 30 * 864e5).slice(0, 10), cambi = [];
      for (const x of aperte) {
        const r = await api(k, 'GET', `/services/invoice/out/getByFilename?filename=${encodeURIComponent(x.file)}&includeFile=false`);
        if (!r.ok) throw new Error(`Aruba ha risposto ${r.stato}`);
        const s = r.json?.invoices?.[0]?.status || r.json?.status; if (!s || s === x.stato) continue;
        x.stato = s; cambi.push(`${x.numero}: ${s}`);
        if (CATTIVI.includes(s)) k.avvisa(`fattura ${x.numero} ${s.toLowerCase()}: ${String(r.json?.invoices?.[0]?.statusDescription || '').slice(0, 200)}`);
      }
      k.stato.scrivi('inviate', inviate);
      return { controllate: aperte.length, cambi };
    } },
    // le fatture dei fornitori degli ultimi 30 giorni (poi dall'ultimo giro): al massimo 10 scaricate a giro
    passive: { ogni: '1h', async giro(k) {
      const viste = new Set(k.stato.leggi('viste') || []), da = k.stato.leggi('da') || new Date(Date.now() - 30 * 864e5).toISOString();
      const r = await api(k, 'GET', `/services/invoice/in/findByUsername?username=${encodeURIComponent(k.imp.utente)}&page=1&size=50&startDate=${encodeURIComponent(da)}`);
      if (!r.ok) throw new Error(`Aruba ha risposto ${r.stato}`);
      const tutte = (r.json?.content || []).filter(x => x.filename && !viste.has(x.filename)), nuove = tutte.slice(0, 10), out = { importate: 0, saltate: 0 };
      for (const x of nuove) {
        const f = await api(k, 'GET', `/services/invoice/in/getByFilename?filename=${encodeURIComponent(x.filename)}&includeFile=true`);
        if (!f.ok || !f.json?.file) throw new Error(`Aruba non ha dato il file ${x.filename}`);
        const ris = xmlPassiva(k, x.filename, Buffer.from(f.json.file, 'base64'));
        out.importate += ris.importate.length; out.saltate += ris.saltate.length; viste.add(x.filename);
      }
      k.stato.scrivi('viste', [...viste].slice(-5000));
      // tutto scaricato: il prossimo giro riparte da due giorni fa (le fatture arrivano con un po' di ritardo)
      if (nuove.length === tutte.length && !(r.json?.totalPages > 1)) k.stato.scrivi('da', new Date(Date.now() - 2 * 864e5).toISOString());
      if (out.importate) k.avvisa(`${out.importate} fatture dei fornitori arrivate da Aruba`);
      return out;
    } },
  },
  catalogo: {
    categoria: 'fatturazione', sito: 'https://fatturazioneelettronica.aruba.it/',
    costo: 'abbonamento', costoNota: 'Abbonamento annuale Aruba Fatturazione Elettronica (il piano base costa circa 29,90 € + IVA l\'anno, con conservazione a norma inclusa); l\'accesso alle API va attivato nel pannello e può richiedere il piano Premium. Kubo non aggiunge costi.',
    serve: [{ cosa: 'Utente e password dell\'API (utenza abilitata ai web service)', dove: 'Pannello Aruba Fatturazione Elettronica › Configurazione › API / Web service: attiva l\'accesso e annota utente e password; per le prove chiedi l\'ambiente DEMO', link: 'https://fatturazioneelettronica.aruba.it/' }],
    passi: ['Attiva Aruba Fatturazione Elettronica e l\'accesso alle API (prima l\'ambiente DEMO).', 'Compila in Kubo i dati della tua azienda (Documenti › Azienda): servono per l\'XML.', 'Nella pagina del connettore scrivi utente e password dell\'API e scegli l\'ambiente.', 'Premi «Prova la connessione» (Aruba accetta un accesso al minuto: se fallisce aspetta un minuto).', 'Accendi: da ogni fattura emessa c\'è «Invia allo SDI (Aruba)».', 'Ogni 30 minuti Kubo legge gli esiti (consegnata, scartata…) e ogni ora scarica le fatture dei fornitori in «Fatture ricevute».'],
    difficolta: 'media', zone: ['IT'],
    fonti: ['https://fatturazioneelettronica.aruba.it/apidoc/docs_EN.html', 'https://fatturazioneelettronica.aruba.it/apidoc/docs.html'],
    prova: 'finto', parole: ['aruba', 'fatturazione elettronica', 'sdi', 'fatturapa', 'xml', 'fatture passive', 'e-invoicing', 'e-invoice', 'intermediario', 'conservazione'],
  },
  testi: {
    en: { nome: 'Aruba E-invoicing', descrizione: 'Sends Kubo e-invoices to SDI through Aruba, follows their outcome and downloads supplier invoices.', 'imp.utente': 'Aruba API user (usually the account code)', 'imp.password': 'API user password', 'imp.ambiente': 'Environment', 'az.invia': 'Send to SDI (Aruba)', 'giro.esiti': 'SDI outcomes', 'giro.passive': 'Supplier invoices',
      'cat.costoNota': 'Yearly Aruba E-invoicing subscription (the basic plan is about €29.90 + VAT a year, with legal archiving included); API access must be enabled in the panel and may need the Premium plan. Kubo adds no costs.',
      'cat.serve': [{ cosa: 'API user and password (account enabled for web services)', dove: 'Aruba E-invoicing panel › Configuration › API / Web service: enable access and note user and password; ask for the DEMO environment for tests' }],
      'cat.passi': ['Activate Aruba E-invoicing and API access (DEMO environment first).', 'Fill in your company data in Kubo (Documents › Company): the XML needs it.', 'On the connector page enter API user and password and pick the environment.', 'Press «Test connection» (Aruba accepts one sign-in per minute: if it fails wait a minute).', 'Switch on: every issued invoice gets «Send to SDI (Aruba)».', 'Every 30 minutes Kubo reads the outcomes (delivered, rejected…) and every hour it downloads supplier invoices into «Received invoices».'] },
    es: { nome: 'Aruba Facturación Electrónica', descrizione: 'Envía al SDI las facturas electrónicas de Kubo a través de Aruba, sigue los resultados y descarga las facturas de proveedores.', 'imp.utente': 'Usuario API de Aruba (normalmente el código de la cuenta)', 'imp.password': 'Contraseña del usuario API', 'imp.ambiente': 'Entorno', 'az.invia': 'Enviar al SDI (Aruba)', 'giro.esiti': 'Resultados SDI', 'giro.passive': 'Facturas de proveedores' },
    fr: { nome: 'Aruba Facturation électronique', descrizione: 'Envoie au SDI les factures électroniques de Kubo via Aruba, suit les résultats et télécharge les factures fournisseurs.', 'imp.utente': 'Utilisateur API Aruba (en général le code du compte)', 'imp.password': 'Mot de passe de l\'utilisateur API', 'imp.ambiente': 'Environnement', 'az.invia': 'Envoyer au SDI (Aruba)', 'giro.esiti': 'Résultats SDI', 'giro.passive': 'Factures fournisseurs' },
    de: { nome: 'Aruba E-Rechnung', descrizione: 'Sendet Kubos E-Rechnungen über Aruba an SDI, verfolgt die Ergebnisse und lädt Lieferantenrechnungen herunter.', 'imp.utente': 'Aruba-API-Benutzer (meist der Kontocode)', 'imp.password': 'Passwort des API-Benutzers', 'imp.ambiente': 'Umgebung', 'az.invia': 'An SDI senden (Aruba)', 'giro.esiti': 'SDI-Ergebnisse', 'giro.passive': 'Lieferantenrechnungen' },
    pt: { nome: 'Aruba Faturação Eletrônica', descrizione: 'Envia ao SDI as faturas eletrônicas do Kubo pela Aruba, acompanha os resultados e baixa as faturas de fornecedores.', 'imp.utente': 'Usuário API da Aruba (geralmente o código da conta)', 'imp.password': 'Senha do usuário API', 'imp.ambiente': 'Ambiente', 'az.invia': 'Enviar ao SDI (Aruba)', 'giro.esiti': 'Resultados SDI', 'giro.passive': 'Faturas de fornecedores' },
  },
};
