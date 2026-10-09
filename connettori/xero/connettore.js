// Xero: le fatture di Kubo nella contabilità Xero del commercialista (o dello studio estero). Solo verso Xero.
// Accesso OAuth 2 con il codice (PKCE): login.xero.com/identity/connect/authorize → identity.xero.com/connect/token.
// Scope granulari (obbligatori per le app create dal 2 marzo 2026): accounting.invoices e accounting.contacts, più
// offline_access per il refresh token. L'organizzazione (tenant) si legge da GET /connections e va nell'intestazione
// «xero-tenant-id». Una fattura attiva → POST /api.xro/2.0/Invoices con Type ACCREC, Status AUTHORISED; una passiva
// (fatture ricevute, se acceso) → ACCPAY. Il contatto si cerca per nome (Xero lo crea se non c'è) e poi si ricorda il ContactID.
// Fonti: https://developer.xero.com/documentation/api/accounting/invoices, …/guides/oauth2/auth-flow, …/guides/oauth2/scopes
const API = k => k.base || 'https://api.xero.com';
const errore = r => new Error(`Xero ha risposto ${r.stato}: ${String(r.json?.Elements?.flatMap(e => (e.ValidationErrors || []).map(v => v.Message)).join('; ') || r.json?.Message || r.json?.Detail || r.json?.title || r.testo || '').slice(0, 300)}`);
const due = n => Math.round(Number(n || 0) * 100) / 100;

// l'organizzazione Xero: quella scelta nelle impostazioni, o la prima collegata (ricordata nello stato)
async function tenant(k) {
  const t = k.imp.organizzazione || k.stato.leggi('tenant'); if (t) return t;
  const r = await k.http.get(`${API(k)}/connections`, { bearer: await k.oauth.token() }); if (!r.ok) throw errore(r);
  const o = [].concat(r.json || []).find(c => c.tenantType === 'ORGANISATION') || r.json?.[0];
  if (!o?.tenantId) throw new Error('Nessuna organizzazione Xero collegata: ricollega l\'account');
  k.stato.scrivi('tenant', o.tenantId); k.stato.scrivi('nome_organizzazione', o.tenantName || null);
  return o.tenantId;
}
const api = async (k, metodo, percorso, json, intestazioni = {}) => k.http.richiesta(metodo, `${API(k)}/api.xro/2.0${percorso}`,
  { bearer: await k.oauth.token(), json, intestazioni: { 'xero-tenant-id': await tenant(k), Accept: 'application/json', ...intestazioni } });

// «22=OUTPUT2, 10=TAX002, 0=NONE» → il TaxType per aliquota; un valore solo vale per tutte; vuoto: quello del conto
export function tipoIva(regola, aliquota) {
  const s = String(regola || '').trim(); if (!s) return undefined;
  if (!s.includes('=')) return s;
  const m = Object.fromEntries(s.split(/[,;]/).map(x => x.split('=').map(y => y.trim())).filter(x => x[0] && x[1]));
  return m[String(Number(aliquota ?? 0))] ?? m['*'];
}
const leggiRelazione = (k, sem, v) => { const id = v?.id ?? v; if (!id) return null; try { return k.dati.leggi(sem, String(id)); } catch { return null; } };
const esportabile = (k, f) => { const s = k.valore(f, 'fatture', 'stato'); if (s === 'bozza' || s === 'annullata') throw new Error(`La fattura è ${s === 'bozza' ? 'ancora una bozza' : 'annullata'}: non si esporta`); };

// il contatto: il ContactID già noto, altrimenti per nome (con partita IVA ed email, Xero lo crea se non c'è)
function contatto(k, sem, r) {
  const id = r?.id, noto = id && k.sincro.remoto(sem, id); if (noto) return { ContactID: noto };
  const nome = k.valore(r, sem, 'nome') || 'Cliente senza nome', piva = k.valore(r, sem, 'piva'), email = k.valore(r, sem, 'email');
  return { Name: String(nome).slice(0, 255), ...(piva ? { TaxNumber: String(piva) } : {}), ...(email ? { EmailAddress: email } : {}) };
}
async function manda(k, doc, chiave) {
  const r = await api(k, 'POST', '/Invoices', { Invoices: [doc] }, { 'Idempotency-Key': chiave });
  const x = r.json?.Invoices?.[0];
  if (!r.ok || !x?.InvoiceID || x.HasErrors) throw r.ok ? new Error(`Xero: ${(x?.ValidationErrors || []).map(v => v.Message).join('; ') || 'fattura rifiutata'}`) : errore(r);
  return x;
}

// una fattura attiva di Kubo → ACCREC
export async function esportaFattura(k, fattura) {
  const f = k.dati.leggi('fatture', fattura.id); esportabile(k, f);
  if (k.sincro.remoto('fatture', f.id)) throw new Error('Fattura già esportata in Xero');
  const cl = leggiRelazione(k, 'clienti', k.valore(f, 'fatture', 'cliente')), data = k.valore(f, 'fatture', 'data');
  const righe = (f.righe || []).map(r => ({ Description: String(r.descrizione || '—').slice(0, 4000), Quantity: Number(r.quantita ?? 1), UnitAmount: due(Number(r.prezzo || 0) - Number(r.sconto_importo || 0)),
    ...(Number(r.sconto) ? { DiscountRate: Number(r.sconto) } : {}), AccountCode: k.imp.conto || '200', ...(tipoIva(k.imp.iva, r.aliquota) ? { TaxType: tipoIva(k.imp.iva, r.aliquota) } : {}) }));
  if (!righe.length) throw new Error('La fattura non ha righe');
  const x = await manda(k, { Type: 'ACCREC', Contact: cl ? contatto(k, 'clienti', cl) : { Name: 'Cliente senza nome' }, Date: data, DueDate: k.valore(f, 'fatture', 'scadenza') || data,
    InvoiceNumber: String(k.valore(f, 'fatture', 'numero') || f.id), Reference: `kubo-f-${f.id}`, LineAmountTypes: 'Exclusive', LineItems: righe, Status: 'AUTHORISED', CurrencyCode: 'EUR' }, `kubo-f-${f.id}`);
  k.sincro.collega('fatture', f.id, x.InvoiceID);
  if (cl?.id && x.Contact?.ContactID) k.sincro.collega('clienti', cl.id, x.Contact.ContactID);
  return { id: x.InvoiceID, numero: x.InvoiceNumber };
}
// una fattura ricevuta (passiva) → ACCPAY, una riga con l'imponibile
async function esportaRicevuta(k, r) {
  const fo = leggiRelazione(k, 'fornitori', k.valore(r, 'fatture_ricevute', 'fornitore')), data = k.valore(r, 'fatture_ricevute', 'data'), numero = k.valore(r, 'fatture_ricevute', 'numero');
  const x = await manda(k, { Type: 'ACCPAY', Contact: fo ? contatto(k, 'fornitori', fo) : { Name: 'Fornitore senza nome' }, Date: data, DueDate: k.valore(r, 'fatture_ricevute', 'scadenza') || data,
    InvoiceNumber: String(numero || r.id), Reference: `kubo-r-${r.id}`, LineAmountTypes: 'Exclusive', Status: 'AUTHORISED', CurrencyCode: 'EUR',
    LineItems: [{ Description: `Fattura ${numero || ''} ${fo ? k.valore(fo, 'fornitori', 'nome') : ''}`.trim(), Quantity: 1, UnitAmount: due(k.valore(r, 'fatture_ricevute', 'imponibile')),
      AccountCode: k.imp.conto_acquisti || '400', ...(tipoIva(k.imp.iva_acquisti, k.valore(r, 'fatture_ricevute', 'aliquota')) ? { TaxType: tipoIva(k.imp.iva_acquisti, k.valore(r, 'fatture_ricevute', 'aliquota')) } : {}) }] }, `kubo-r-${r.id}`);
  k.sincro.collega('fatture_ricevute', r.id, x.InvoiceID);
  if (fo?.id && x.Contact?.ContactID) k.sincro.collega('fornitori', fo.id, x.Contact.ContactID);
  return x.InvoiceID;
}

export default {
  id: 'xero', nome: 'Xero', versione: 1, icona: 'documento',
  descrizione: 'Le fatture di Kubo nella contabilità Xero: emesse (e, se vuoi, ricevute) esportate con il cliente e le righe.',
  impostazioni: [
    { id: 'client_id', nome: 'Client ID dell\'app Xero', segreto: true },
    { id: 'client_secret', nome: 'Client secret dell\'app Xero', segreto: true },
    { id: 'conto', nome: 'Codice conto dei ricavi', predefinito: '200' },
    { id: 'iva', nome: 'Tax type delle vendite (es. «22=OUTPUT2, 10=TAX002»; vuoto: quello del conto)', obbligatorio: false },
    { id: 'giorni', nome: 'Esporta da solo le fatture degli ultimi giorni (0 = solo a mano)', tipo: 'numero', predefinito: 30 },
    { id: 'passive', nome: 'Esporta anche le fatture ricevute', tipo: 'si_no', predefinito: false },
    { id: 'conto_acquisti', nome: 'Codice conto degli acquisti', predefinito: '400' },
    { id: 'iva_acquisti', nome: 'Tax type degli acquisti (come sopra, facoltativo)', obbligatorio: false },
    { id: 'organizzazione', nome: 'Tenant ID dell\'organizzazione (vuoto: la prima collegata)', obbligatorio: false },
  ],
  richiede: {
    fatture: { numero: {}, data: { tipo: 'data' }, stato: { tipo: 'stato' }, cliente: { tipo: 'relazione' }, scadenza: { tipo: 'data', facoltativo: true } },
    clienti: { nome: {}, piva: { facoltativo: true }, email: { tipo: ['email'], facoltativo: true } },
    fatture_ricevute: { numero: { facoltativo: true }, data: { tipo: 'data', facoltativo: true }, scadenza: { tipo: 'data', facoltativo: true }, imponibile: { facoltativo: true }, aliquota: { facoltativo: true }, fornitore: { tipo: 'relazione', facoltativo: true } },
    fornitori: { nome: { facoltativo: true }, piva: { facoltativo: true }, email: { tipo: ['email'], facoltativo: true } },
  },
  permessi: { fatture: { leggi: true }, clienti: { leggi: true }, fatture_ricevute: { leggi: true }, fornitori: { leggi: true } },
  oauth: { tipo: 'codice', autorizza: 'https://login.xero.com/identity/connect/authorize', token: k => (k.base ? `${k.base}/connect/token` : 'https://identity.xero.com/connect/token'),
    scope: 'offline_access accounting.invoices accounting.contacts' },
  prova: async k => { try { const r = await api(k, 'GET', '/Organisation'); return { ok: r.ok, messaggio: r.ok ? r.json?.Organisations?.[0]?.Name || null : `HTTP ${r.stato}` }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: {
    esporta: {
      nome: 'Esporta in Xero', descrizione: 'Crea in Xero la fattura di vendita (approvata) con il cliente e le righe', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura da esportare' } },
      proponi: async ({ fattura }, k) => ({ titolo: 'Esporta in Xero', righe: [['Fattura', k.valore(fattura, 'fatture', 'numero') || fattura.id], ['Cliente', fattura.cliente?.titolo || '—'], ['Totale', k.euro(fattura.totale)], ['Conto', k.imp.conto || '200']],
        avvisi: [...(k.sincro.remoto('fatture', fattura.id) ? ['È già in Xero'] : []), ...(['bozza', 'annullata'].includes(k.valore(fattura, 'fatture', 'stato')) ? ['Una bozza o una fattura annullata non si esporta'] : [])] }),
      esegui: ({ fattura }, k) => esportaFattura(k, fattura),
    },
  },
  pianificati: {
    esporta: { ogni: '1h', async giro(k) {
      const giorni = Number(k.imp.giorni || 0); if (!(giorni > 0) || !k.oauth.collegato()) return { esportate: 0 };
      const da = new Date(Date.now() - giorni * 864e5).toISOString().slice(0, 10), conti = { esportate: 0, ricevute: 0, errori: 0 };
      const nuove = sem => k.dati.elenca(sem, { filtri: [{ campo: 'data', op: '>=', valore: da }], perPagina: 500 }).righe.filter(r => !k.sincro.remoto(sem, r.id));
      for (const f of nuove('fatture').filter(f => !['bozza', 'annullata'].includes(k.valore(f, 'fatture', 'stato'))).slice(0, 50)) {
        try { await esportaFattura(k, f); conti.esportate++; } catch (e) { conti.errori++; k.avvisa(`fattura ${f.numero || f.id} non esportata: ${e.message}`); }
      }
      if (k.imp.passive === true || k.imp.passive === 'true' || k.imp.passive === 1) {
        let ricevute = []; try { ricevute = nuove('fatture_ricevute').slice(0, 50); } catch { /* il modello non ha le fatture ricevute */ }
        for (const r of ricevute) { try { await esportaRicevuta(k, r); conti.ricevute++; } catch (e) { conti.errori++; k.avvisa(`fattura ricevuta ${r.numero || r.id} non esportata: ${e.message}`); } }
      }
      return conti;
    } },
  },
  catalogo: {
    categoria: 'contabilita', sito: 'https://www.xero.com',
    costo: 'abbonamento', costoNota: 'Serve un abbonamento Xero per l\'organizzazione (listino per Paese su xero.com/pricing; Xero non ha un\'edizione italiana). L\'API è gratuita nel livello Starter del listino sviluppatori Xero, fino a 5 organizzazioni collegate all\'app. Kubo non aggiunge costi.',
    serve: [
      { cosa: 'Client ID e Client secret di un\'app «Web app»', dove: 'developer.xero.com › My Apps › New app (tipo Web app) › Configuration › Generate a secret', link: 'https://developer.xero.com/app/manage' },
      { cosa: 'L\'indirizzo di ritorno OAuth dell\'app', dove: 'La stessa app › Configuration › Redirect URIs: l\'indirizzo che mostra Kubo (…/api/connettori/xero/oauth/ritorno)', link: 'https://developer.xero.com/documentation/guides/oauth2/auth-flow' },
      { cosa: 'Codici dei conti e dei tax type', dove: 'Xero › Accounting › Chart of accounts e Advanced › Tax rates', link: 'https://central.xero.com/s/article/Add-edit-or-delete-accounts-in-the-chart-of-accounts' },
    ],
    passi: ['Su developer.xero.com crea un\'app di tipo «Web app».', 'Nei Redirect URIs aggiungi l\'indirizzo di ritorno che mostra Kubo.', 'Genera il secret e copia Client ID e Client secret in Kubo.', 'Premi «Collega» e scegli l\'organizzazione Xero.', 'Controlla il codice conto dei ricavi (200 di solito) e, se serve, i tax type.', 'Esporta una fattura con «Esporta in Xero»; il giro orario porta in Xero quelle nuove.'],
    difficolta: 'media', zone: ['UE', 'mondo'],
    fonti: ['https://developer.xero.com/documentation/api/accounting/invoices', 'https://developer.xero.com/documentation/guides/oauth2/auth-flow', 'https://developer.xero.com/documentation/guides/oauth2/scopes', 'https://devblog.xero.com/upcoming-changes-to-xero-accounting-api-scopes-705c5a9621a0', 'https://developer.xero.com/pricing'],
    prova: 'finto', parole: ['xero', 'contabilità', 'commercialista', 'esporta fatture', 'accounting', 'bookkeeping', 'invoices export', 'accountant'],
  },
  testi: {
    en: { descrizione: 'Kubo invoices in your Xero books: issued (and, if you want, received) invoices exported with customer and lines.', 'imp.client_id': 'Xero app Client ID', 'imp.client_secret': 'Xero app Client secret', 'imp.conto': 'Revenue account code',
      'imp.iva': 'Sales tax type (e.g. «22=OUTPUT2, 10=TAX002»; empty: the account default)', 'imp.giorni': 'Export invoices of the last days automatically (0 = by hand only)', 'imp.passive': 'Also export received invoices', 'imp.conto_acquisti': 'Purchases account code',
      'imp.iva_acquisti': 'Purchases tax type (as above, optional)', 'imp.organizzazione': 'Organisation tenant ID (empty: the first connected)', 'az.esporta': 'Export to Xero', 'giro.esporta': 'Export new invoices',
      'cat.costoNota': 'The organisation needs a Xero subscription (prices by country on xero.com/pricing; there is no Italian edition). The API is free on the Starter tier of Xero developer pricing, up to 5 organisations connected to the app. Kubo adds no cost.',
      'cat.serve': [{ cosa: 'Client ID and Client secret of a «Web app»', dove: 'developer.xero.com › My Apps › New app (Web app) › Configuration › Generate a secret' }, { cosa: 'The app OAuth redirect address', dove: 'Same app › Configuration › Redirect URIs: the address Kubo shows (…/api/connettori/xero/oauth/ritorno)' }, { cosa: 'Account codes and tax types', dove: 'Xero › Accounting › Chart of accounts and Advanced › Tax rates' }],
      'cat.passi': ['On developer.xero.com create an app of type «Web app».', 'Add the redirect address Kubo shows to the Redirect URIs.', 'Generate the secret and copy Client ID and Client secret into Kubo.', 'Press «Connect» and pick the Xero organisation.', 'Check the revenue account code (usually 200) and, if needed, the tax types.', 'Export an invoice with «Export to Xero»; the hourly run brings new ones to Xero.'] },
    es: { descrizione: 'Las facturas de Kubo en la contabilidad de Xero: emitidas (y, si quieres, recibidas) exportadas con cliente y líneas.', 'imp.client_id': 'Client ID de la app Xero', 'imp.client_secret': 'Client secret de la app Xero', 'imp.conto': 'Código de la cuenta de ingresos',
      'imp.iva': 'Tax type de ventas (p. ej. «22=OUTPUT2»; vacío: el de la cuenta)', 'imp.giorni': 'Exportar solas las facturas de los últimos días (0 = solo a mano)', 'imp.passive': 'Exportar también las facturas recibidas', 'imp.conto_acquisti': 'Código de la cuenta de compras',
      'imp.iva_acquisti': 'Tax type de compras (opcional)', 'imp.organizzazione': 'Tenant ID de la organización (vacío: la primera conectada)', 'az.esporta': 'Exportar a Xero', 'giro.esporta': 'Exportar facturas nuevas' },
    fr: { descrizione: 'Les factures de Kubo dans la comptabilité Xero : émises (et, si vous voulez, reçues) exportées avec client et lignes.', 'imp.client_id': 'Client ID de l\'app Xero', 'imp.client_secret': 'Client secret de l\'app Xero', 'imp.conto': 'Code du compte de produits',
      'imp.iva': 'Tax type des ventes (ex. « 22=OUTPUT2 » ; vide : celui du compte)', 'imp.giorni': 'Exporter seul les factures des derniers jours (0 = à la main)', 'imp.passive': 'Exporter aussi les factures reçues', 'imp.conto_acquisti': 'Code du compte d\'achats',
      'imp.iva_acquisti': 'Tax type des achats (facultatif)', 'imp.organizzazione': 'Tenant ID de l\'organisation (vide : la première connectée)', 'az.esporta': 'Exporter vers Xero', 'giro.esporta': 'Exporter les nouvelles factures' },
    de: { descrizione: 'Kubo-Rechnungen in der Xero-Buchhaltung: ausgestellte (und auf Wunsch erhaltene) Rechnungen mit Kunde und Positionen exportiert.', 'imp.client_id': 'Client-ID der Xero-App', 'imp.client_secret': 'Client-Secret der Xero-App', 'imp.conto': 'Erlöskonto (Code)',
      'imp.iva': 'Steuertyp Verkauf (z. B. «22=OUTPUT2»; leer: der des Kontos)', 'imp.giorni': 'Rechnungen der letzten Tage automatisch exportieren (0 = nur von Hand)', 'imp.passive': 'Auch erhaltene Rechnungen exportieren', 'imp.conto_acquisti': 'Aufwandskonto (Code)',
      'imp.iva_acquisti': 'Steuertyp Einkauf (optional)', 'imp.organizzazione': 'Tenant-ID der Organisation (leer: die erste verbundene)', 'az.esporta': 'Nach Xero exportieren', 'giro.esporta': 'Neue Rechnungen exportieren' },
    pt: { descrizione: 'As faturas do Kubo na contabilidade Xero: emitidas (e, se quiser, recebidas) exportadas com cliente e linhas.', 'imp.client_id': 'Client ID do app Xero', 'imp.client_secret': 'Client secret do app Xero', 'imp.conto': 'Código da conta de receitas',
      'imp.iva': 'Tax type de vendas (ex.: «22=OUTPUT2»; vazio: o da conta)', 'imp.giorni': 'Exportar sozinho as faturas dos últimos dias (0 = só à mão)', 'imp.passive': 'Exportar também as faturas recebidas', 'imp.conto_acquisti': 'Código da conta de compras',
      'imp.iva_acquisti': 'Tax type de compras (opcional)', 'imp.organizzazione': 'Tenant ID da organização (vazio: a primeira conectada)', 'az.esporta': 'Exportar para o Xero', 'giro.esporta': 'Exportar faturas novas' },
  },
};
