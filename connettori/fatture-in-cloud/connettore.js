// Fatture in Cloud (API v2): per chi lavora già con FiC e il commercialista. I clienti di FiC entrano in Lumi, le fatture di
// Lumi si copiano in FiC (e da lì vanno allo SDI con e_invoice/send), le spese registrate in FiC diventano «Fatture ricevute».
// Accesso: il token manuale di un'app FiC, oppure OAuth 2 con il codice (scope «risorsa:a|r») o con il device code
// («Collega con un codice»: POST /oauth/device con { client_id, scope } in JSON, la risposta dentro «data», poi /oauth/token
// con grant_type urn:ietf:params:oauth:grant-type:device_code; basta il Client ID). FiC vuole i corpi in JSON. Ogni chiamata è sotto
// /c/{company_id}: l'azienda si sceglie dalle impostazioni o è la prima di GET /user/companies.
// https://developers.fattureincloud.it/docs/basics/ · https://developers.fattureincloud.it/api-reference/
import { giorno } from '../_soldi/comuni.js';

const API = 'https://api-v2.fattureincloud.it';
const base = k => k.base || API;
const accesso = async k => k.segreti.token || await k.oauth.token();
const api = async (k, metodo, percorso, json) => {
  const r = await k.http.richiesta(metodo, base(k) + percorso, { bearer: await accesso(k), json });
  if (!r.ok) throw new Error(`Fatture in Cloud ha risposto ${r.stato}: ${String(r.json?.error?.message || r.json?.message || r.testo || '').slice(0, 200)}`);
  return r.json;
};
async function azienda(k) {
  const c = k.imp.azienda || k.stato.leggi('azienda'); if (c) return c;
  const l = (await api(k, 'GET', '/user/companies')).data?.companies || [];
  if (!l.length) throw new Error('Nessuna azienda collegata a questo accesso di Fatture in Cloud');
  k.stato.scrivi('azienda', l[0].id); return l[0].id;
}
// campi di Lumi ← campi di FiC (anagrafica)
const CLIENTE = [['nome', 'name'], ['piva', 'vat_number'], ['codice_fiscale', 'tax_code'], ['email', 'email'], ['pec', 'certified_email'], ['codice_destinatario', 'ei_code'],
  ['telefono', 'phone'], ['via', 'address_street'], ['cap', 'address_postal_code'], ['comune', 'address_city'], ['provincia', 'address_province'], ['nazione', 'country_iso']];
const valoriDi = (k, sem, o, campi) => Object.fromEntries(campi.filter(([locale, remoto]) => k.campo(sem, locale) && o[remoto] != null && o[remoto] !== '').map(([locale, remoto]) => [locale, String(o[remoto])]));
// una riga di FiC in Lumi: abbinata per id remoto o per partita IVA; si scrivono solo i campi cambiati
function abbina(k, sem, o, v, chiave = 'piva') {
  let id = k.sincro.locale(sem, o.id), r = null;
  if (id) { try { r = k.dati.leggi(sem, id); } catch { id = null; } }
  if (!id && v[chiave]) { r = k.dati.trova(sem, chiave, v[chiave]); id = r?.id || null; }
  if (!id) { id = k.dati.crea(sem, v).id; k.sincro.collega(sem, id, o.id); return 'creati'; }
  k.sincro.collega(sem, id, o.id);
  const diversi = Object.fromEntries(Object.entries(v).filter(([c, x]) => String(k.valore(r, sem, c) ?? '') !== x));
  if (!Object.keys(diversi).length) return 'uguali';
  k.dati.modifica(sem, id, diversi); return 'aggiornati';
}
// l'aliquota di Lumi → il tipo IVA di FiC (per lo 0% conta la natura)
async function tipiIva(k, cid) { return (await api(k, 'GET', `/c/${cid}/info/vat_types`)).data || []; }
function ivaDi(tipi, aliquota, natura) {
  const a = Number(aliquota || 0), ok = tipi.filter(t => !t.is_disabled && Math.abs(Number(t.value) - a) < 0.001);
  const t = (a === 0 && natura ? ok.find(x => x.ei_type === natura) : null) || ok[0];
  if (!t) throw new Error(`In Fatture in Cloud non c'è un'aliquota IVA del ${a}%${natura ? ` (${natura})` : ''}`);
  return { id: t.id };
}
// la fattura di Lumi copiata in FiC (una volta: poi resta collegata)
async function copia(k, f) {
  const gia = k.sincro.remoto('fatture', f.id); if (gia) return gia;
  const s = k.valore(f, 'fatture', 'stato'); if (s === 'bozza' || s === 'annullata') throw new Error(`La fattura è ${s === 'bozza' ? 'ancora una bozza' : 'annullata'}`);
  const cid = await azienda(k), tipi = await tipiIva(k, cid);
  let cl = {}; if (f.cliente?.id) { try { cl = k.dati.leggi('clienti', f.cliente.id); } catch { cl = {}; } }
  const idCliente = cl.id && k.sincro.remoto('clienti', cl.id);
  const entity = { ...(idCliente ? { id: Number(idCliente) } : {}), name: cl.nome || f.cliente?.titolo || '—', vat_number: cl.piva || '', tax_code: cl.codice_fiscale || '', address_street: cl.via || '',
    address_postal_code: cl.cap || '', address_city: cl.comune || '', address_province: cl.provincia || '', country_iso: cl.nazione || 'IT', ei_code: cl.codice_destinatario || '', certified_email: cl.pec || '' };
  const numero = String(k.valore(f, 'fatture', 'numero') || ''), n = /^(\d+)(.*)$/.exec(numero);
  const doc = { type: 'invoice', entity, date: f.data, ...(n ? { number: Number(n[1]), numeration: n[2] || '' } : {}), e_invoice: true, currency: { id: 'EUR' }, language: { code: 'it', name: 'Italiano' },
    items_list: (f.righe || []).map(r => ({ name: String(r.descrizione || '').slice(0, 1000), qty: Number(r.quantita || 1), net_price: Number(r.prezzo || 0), discount: Number(r.sconto || 0), vat: ivaDi(tipi, r.aliquota, r.natura) })),
    ...(f.causale ? { notes: String(f.causale).slice(0, 2000) } : {}) };
  const x = await api(k, 'POST', `/c/${cid}/issued_documents`, { data: doc });
  const id = x.data?.id; if (!id) throw new Error('Fatture in Cloud non ha restituito il documento');
  k.sincro.collega('fatture', f.id, id);
  return id;
}

export default {
  id: 'fatture-in-cloud', nome: 'Fatture in Cloud', versione: 1, icona: 'documento',
  descrizione: 'Clienti da Fatture in Cloud, fatture di Lumi copiate in FiC e inviate allo SDI, spese registrate in FiC come fatture ricevute.',
  impostazioni: [
    { id: 'token', nome: 'Token manuale dell\'app FiC (oppure collega con OAuth)', segreto: true, obbligatorio: false },
    { id: 'client_id', nome: 'Client ID dell\'app FiC (solo per OAuth)', segreto: true, obbligatorio: false },
    { id: 'client_secret', nome: 'Client secret dell\'app FiC (solo per OAuth)', segreto: true, obbligatorio: false },
    { id: 'azienda', nome: 'ID dell\'azienda in FiC (vuoto: la prima)', schema: /^\d{1,12}$/, obbligatorio: false },
  ],
  oauth: { tipo: 'codice', autorizza: k => `${base(k)}/oauth/authorize`, token: k => `${base(k)}/oauth/token`, dispositivo: k => `${base(k)}/oauth/device`, corpo: 'json',
    scope: 'entity.clients:a entity.suppliers:r issued_documents.invoices:a received_documents:r settings:r' },
  richiede: {
    clienti: Object.fromEntries(CLIENTE.map(([c]) => [c, { facoltativo: c !== 'nome' }])),
    fatture: { stato: { tipo: 'stato' }, numero: {}, data: { tipo: 'data' }, cliente: { tipo: 'relazione' }, inviata_il: { tipo: 'data', facoltativo: true } },
    fatture_ricevute: { numero: { facoltativo: true }, data: { tipo: 'data', facoltativo: true }, fornitore: { tipo: 'relazione', facoltativo: true }, totale: { facoltativo: true }, imponibile: { facoltativo: true }, imposta: { facoltativo: true }, stato: { tipo: 'stato', facoltativo: true }, note: { facoltativo: true } },
    fornitori: { nome: { facoltativo: true }, piva: { facoltativo: true } },
  },
  permessi: { clienti: { leggi: true, crea: true, modifica: true }, fatture: { leggi: true, modifica: true }, fatture_ricevute: { leggi: true, crea: true }, fornitori: { leggi: true, crea: true } },
  prova: async k => { try { const l = (await api(k, 'GET', '/user/companies')).data?.companies || []; return { ok: l.length > 0, messaggio: l.length ? null : 'Nessuna azienda collegata' }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: {
    copia: {
      nome: 'Copia in Fatture in Cloud', descrizione: 'Crea in Fatture in Cloud la stessa fattura (cliente, righe, aliquote)', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura da copiare' } },
      proponi: async ({ fattura }, k) => ({ titolo: 'Copia in Fatture in Cloud', righe: [['Fattura', fattura.numero || fattura.id], ['Cliente', fattura.cliente?.titolo || '—'], ['Totale', k.euro(fattura.totale)]],
        avvisi: k.sincro.remoto('fatture', fattura.id) ? ['È già in Fatture in Cloud'] : [] }),
      esegui: async ({ fattura }, k) => ({ documento: await copia(k, fattura) }),
    },
    invia: {
      nome: 'Invia allo SDI (Fatture in Cloud)', descrizione: 'Copia la fattura in Fatture in Cloud (se serve) e la manda allo SDI da lì', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura da inviare' } },
      proponi: async ({ fattura }, k) => ({ titolo: 'Invio allo SDI con Fatture in Cloud', righe: [['Fattura', fattura.numero || fattura.id], ['Cliente', fattura.cliente?.titolo || '—'], ['Totale', k.euro(fattura.totale)]],
        avvisi: [...((k.stato.leggi('inviate') || []).includes(fattura.id) ? ['Questa fattura è già stata inviata'] : []), ...(['bozza', 'annullata'].includes(k.valore(fattura, 'fatture', 'stato')) ? ['La fattura non è emessa'] : [])] }),
      async esegui({ fattura }, k) {
        const inviate = k.stato.leggi('inviate') || []; if (inviate.includes(fattura.id)) throw new Error('Fattura già inviata allo SDI');
        const doc = await copia(k, fattura), cid = await azienda(k);
        const x = await api(k, 'POST', `/c/${cid}/issued_documents/${doc}/e_invoice/send`, { data: {} });
        k.stato.scrivi('inviate', [...inviate, fattura.id].slice(-5000));
        const v = { ...(k.valore(fattura, 'fatture', 'stato') === 'emessa' ? { stato: 'inviata' } : {}), ...(k.campo('fatture', 'inviata_il') ? { inviata_il: giorno(k) } : {}) };
        if (Object.keys(v).length) k.dati.modifica('fatture', fattura.id, v);
        return { documento: doc, file: x?.data?.name || null };
      },
    },
  },
  pianificati: {
    // i clienti di FiC entrano in Lumi (FiC comanda sull'anagrafica): al massimo 50 pagine da 100
    clienti: { ogni: '1h', async giro(k) {
      const cid = await azienda(k), conti = { creati: 0, aggiornati: 0, uguali: 0 };
      for (let p = 1, ultima = 1; p <= Math.min(ultima, 50); p++) {
        const x = await api(k, 'GET', `/c/${cid}/entities/clients?fieldset=detailed&per_page=100&page=${p}`); ultima = x.last_page || 1;
        for (const o of x.data || []) { const v = valoriDi(k, 'clienti', o, CLIENTE); if (v.nome) conti[abbina(k, 'clienti', o, v)]++; }
      }
      return conti;
    } },
    // le spese registrate in FiC (comprese le fatture passive arrivate dallo SDI) → «Fatture ricevute», una volta
    ricevute: { ogni: '3h', async giro(k) {
      const cid = await azienda(k), out = { importate: 0, gia: 0 };
      const x = await api(k, 'GET', `/c/${cid}/received_documents?type=expense&fieldset=detailed&per_page=50&page=1&sort=-date`);
      for (const d of x.data || []) {
        if (k.sincro.locale('fatture_ricevute', d.id)) { out.gia++; continue; }
        const e = d.entity || {}, fv = valoriDi(k, 'fornitori', e, [['nome', 'name'], ['piva', 'vat_number']]);
        let fornitore = null; if (fv.nome) { const f = (fv.piva && k.dati.trova('fornitori', 'piva', fv.piva)) || k.dati.trova('fornitori', 'nome', fv.nome); fornitore = f?.id || k.dati.crea('fornitori', fv).id; }
        const v = { numero: d.invoice_number, data: d.date, totale: d.amount_gross, imponibile: d.amount_net, imposta: d.amount_vat, note: d.description, ...(fornitore ? { fornitore } : {}) };
        for (const c of Object.keys(v)) if (!k.campo('fatture_ricevute', c) || v[c] == null || v[c] === '') delete v[c];
        const riga = k.dati.crea('fatture_ricevute', v); k.sincro.collega('fatture_ricevute', riga.id, d.id); out.importate++;
      }
      if (out.importate) k.avvisa(`${out.importate} spese arrivate da Fatture in Cloud`);
      return out;
    } },
  },
  catalogo: {
    categoria: 'fatturazione', sito: 'https://www.fattureincloud.it/',
    costo: 'abbonamento', costoNota: 'Serve un abbonamento a Fatture in Cloud (piani da circa 4 € al mese + IVA il primo anno in promozione, poi secondo il listino su fattureincloud.it/prezzi); le API sono incluse. Lumi non aggiunge costi.',
    serve: [
      { cosa: 'Un token manuale (il modo più semplice)', dove: 'FiC › Impostazioni › Applicazioni collegate › Sviluppatori: crea un\'app di tipo «manuale» con i permessi Clienti, Fatture, Spese, Impostazioni e genera il token', link: 'https://developers.fattureincloud.it/docs/authentication/manual-authentication/' },
      { cosa: 'In alternativa Client ID e Client secret di un\'app OAuth, con l\'indirizzo di ritorno che mostra Lumi (per «Collega con un codice» basta il Client ID)', dove: 'console.fattureincloud.it › Le tue app › Nuova app', link: 'https://console.fattureincloud.it/' },
    ],
    passi: ['In Fatture in Cloud crea un\'app manuale e genera il token con i permessi su clienti, fatture emesse, spese e impostazioni.', 'Incolla il token in Lumi; oppure scrivi il Client ID di un\'app OAuth, premi «Collega con un codice» e inserisci il codice su Fatture in Cloud (se hai più aziende, scrivi anche l\'ID dell\'azienda).', 'Premi «Prova la connessione» e accendi.', 'Premi «Sincronizza ora» sui clienti: arrivano in Lumi, abbinati per partita IVA.', 'Da ogni fattura emessa usa «Copia in Fatture in Cloud» oppure «Invia allo SDI (Fatture in Cloud)».', 'Ogni 3 ore le spese registrate in FiC entrano in «Fatture ricevute».'],
    difficolta: 'media', zone: ['IT'],
    fonti: ['https://developers.fattureincloud.it/docs/basics/', 'https://developers.fattureincloud.it/docs/authentication/manual-authentication/', 'https://developers.fattureincloud.it/docs/authentication/code-flow/', 'https://developers.fattureincloud.it/api-reference/'],
    prova: 'finto', parole: ['fatture in cloud', 'fic', 'teamsystem', 'fatturazione elettronica', 'sdi', 'commercialista', 'clienti', 'spese', 'e-invoicing', 'invoices'],
  },
  testi: {
    en: { descrizione: 'Customers from Fatture in Cloud, Lumi invoices copied to FiC and sent to SDI, expenses recorded in FiC as received invoices.', 'imp.token': 'Manual token of the FiC app (or connect with OAuth)', 'imp.client_id': 'FiC app Client ID (OAuth only)', 'imp.client_secret': 'FiC app Client secret (OAuth only)', 'imp.azienda': 'Company ID in FiC (empty: the first one)', 'az.copia': 'Copy to Fatture in Cloud', 'az.invia': 'Send to SDI (Fatture in Cloud)', 'giro.clienti': 'Customers from FiC', 'giro.ricevute': 'Expenses from FiC',
      'cat.costoNota': 'You need a Fatture in Cloud subscription (plans from about €4 a month + VAT in the first-year promotion, then per the list on fattureincloud.it/prezzi); the API is included. Lumi adds no costs.',
      'cat.serve': [{ cosa: 'A manual token (the simplest way)', dove: 'FiC › Settings › Connected apps › Developers: create a «manual» app with Customers, Invoices, Expenses, Settings permissions and generate the token' }, { cosa: 'Or the Client ID and Client secret of an OAuth app, with the return address Lumi shows (for «Connect with a code» the Client ID is enough)', dove: 'console.fattureincloud.it › Your apps › New app' }],
      'cat.passi': ['In Fatture in Cloud create a manual app and generate the token with permissions on customers, issued invoices, expenses and settings.', 'Paste the token into Lumi; or enter the Client ID of an OAuth app, press «Connect with a code» and type the code on Fatture in Cloud (with several companies, also enter the company ID).', 'Press «Test connection» and switch on.', 'Press «Sync now» on customers: they arrive in Lumi, matched by VAT number.', 'On each issued invoice use «Copy to Fatture in Cloud» or «Send to SDI (Fatture in Cloud)».', 'Every 3 hours the expenses recorded in FiC enter «Received invoices».'] },
    es: { descrizione: 'Clientes desde Fatture in Cloud, facturas de Lumi copiadas en FiC y enviadas al SDI, gastos de FiC como facturas recibidas.', 'imp.token': 'Token manual de la app FiC (o conecta con OAuth)', 'imp.client_id': 'Client ID de la app FiC (solo OAuth)', 'imp.client_secret': 'Client secret de la app FiC (solo OAuth)', 'imp.azienda': 'ID de la empresa en FiC (vacío: la primera)', 'az.copia': 'Copiar en Fatture in Cloud', 'az.invia': 'Enviar al SDI (Fatture in Cloud)', 'giro.clienti': 'Clientes desde FiC', 'giro.ricevute': 'Gastos desde FiC' },
    fr: { descrizione: 'Clients depuis Fatture in Cloud, factures Lumi copiées dans FiC et envoyées au SDI, dépenses de FiC comme factures reçues.', 'imp.token': 'Jeton manuel de l\'app FiC (ou connectez avec OAuth)', 'imp.client_id': 'Client ID de l\'app FiC (OAuth seulement)', 'imp.client_secret': 'Client secret de l\'app FiC (OAuth seulement)', 'imp.azienda': 'ID de l\'entreprise dans FiC (vide : la première)', 'az.copia': 'Copier dans Fatture in Cloud', 'az.invia': 'Envoyer au SDI (Fatture in Cloud)', 'giro.clienti': 'Clients depuis FiC', 'giro.ricevute': 'Dépenses depuis FiC' },
    de: { descrizione: 'Kunden aus Fatture in Cloud, Lumi-Rechnungen nach FiC kopiert und an SDI gesendet, in FiC erfasste Ausgaben als Eingangsrechnungen.', 'imp.token': 'Manuelles Token der FiC-App (oder mit OAuth verbinden)', 'imp.client_id': 'Client-ID der FiC-App (nur OAuth)', 'imp.client_secret': 'Client-Secret der FiC-App (nur OAuth)', 'imp.azienda': 'Firmen-ID in FiC (leer: die erste)', 'az.copia': 'Nach Fatture in Cloud kopieren', 'az.invia': 'An SDI senden (Fatture in Cloud)', 'giro.clienti': 'Kunden aus FiC', 'giro.ricevute': 'Ausgaben aus FiC' },
    pt: { descrizione: 'Clientes do Fatture in Cloud, faturas do Lumi copiadas no FiC e enviadas ao SDI, despesas do FiC como faturas recebidas.', 'imp.token': 'Token manual do app FiC (ou conecte com OAuth)', 'imp.client_id': 'Client ID do app FiC (só OAuth)', 'imp.client_secret': 'Client secret do app FiC (só OAuth)', 'imp.azienda': 'ID da empresa no FiC (vazio: a primeira)', 'az.copia': 'Copiar no Fatture in Cloud', 'az.invia': 'Enviar ao SDI (Fatture in Cloud)', 'giro.clienti': 'Clientes do FiC', 'giro.ricevute': 'Despesas do FiC' },
  },
};
