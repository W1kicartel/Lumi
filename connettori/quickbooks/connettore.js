// QuickBooks Online: le fatture emesse di Lumi nella contabilità QuickBooks (Intuit). Solo verso QuickBooks.
// Accesso OAuth 2 con il codice: appcenter.intuit.com/connect/oauth2 → oauth.platform.intuit.com/oauth2/v1/tokens/bearer,
// scope com.intuit.quickbooks.accounting, client id e secret in Authorization: Basic (oauth.basic del kit). Il realmId
// (Company ID) arriva nel ritorno e il kit lo tiene (oauth.conserva → k.oauth.extra()); l'impostazione «realm» resta
// facoltativa per chi l'aveva incollato prima (vale solo se il collegamento non l'ha portato).
// Chiamate: /v3/company/{realm}/… con ?minorversion=75 (dall'agosto 2025 le versioni 1–74 non ci sono più) e Accept JSON.
// Il cliente si cerca per DisplayName (GET /query «select * from Customer where DisplayName = '…'»), se manca si crea
// (POST /customer); poi POST /invoice con righe SalesItemLineDetail sull'articolo scelto (Item Id, «1» di solito «Services»).
// Fonti: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice, …/customer,
// https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0, …/learn/explore-the-quickbooks-online-api/minor-versions
const VERSIONE = 75;
const base = k => k.base || (k.imp.ambiente === 'produzione' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com');
const errore = r => { const e = r.json?.Fault?.Error?.[0] || r.json?.fault?.error?.[0]; return new Error(`QuickBooks ha risposto ${r.stato}: ${String(e ? `${e.Message || e.message}${e.Detail || e.detail ? ` (${e.Detail || e.detail})` : ''}` : r.testo || '').slice(0, 300)}`); };
const due = n => Math.round(Number(n || 0) * 100) / 100;
// l'azienda: quella del collegamento (realmId del ritorno), se no quella incollata nelle impostazioni
export const realmDi = k => String(k.oauth.extra().realmId || k.imp.realm || '');
async function api(k, metodo, percorso, json) {
  const realm = realmDi(k); if (!/^\d{1,25}$/.test(realm)) throw new Error('Manca il Company ID (realm) di QuickBooks: premi «Collega» (arriva con il collegamento) o scrivilo nelle impostazioni');
  const u = `${base(k)}/v3/company/${realm}${percorso}${percorso.includes('?') ? '&' : '?'}minorversion=${VERSIONE}`;
  const r = await k.http.richiesta(metodo, u, { bearer: await k.oauth.token(), json, intestazioni: { Accept: 'application/json' } });
  if (!r.ok) throw errore(r); return r.json;
}
// «22=5, 10=7» → il TaxCodeRef per aliquota; un valore solo vale per tutte; vuoto: niente (QuickBooks US calcola da sé)
export function codiceIva(regola, aliquota) {
  const s = String(regola || '').trim(); if (!s) return undefined;
  if (!s.includes('=')) return s;
  const m = Object.fromEntries(s.split(/[,;]/).map(x => x.split('=').map(y => y.trim())).filter(x => x[0] && x[1]));
  return m[String(Number(aliquota ?? 0))] ?? m['*'];
}
// il DisplayName: niente due punti, tabulazioni e a capo (QuickBooks li rifiuta), al massimo 500 caratteri
const nomeQb = s => String(s || 'Cliente senza nome').replace(/[:\t\r\n]+/g, ' ').trim().slice(0, 500);

// il cliente in QuickBooks: già collegato, trovato per nome, o creato
export async function clienteQb(k, cl) {
  const noto = cl?.id && k.sincro.remoto('clienti', cl.id); if (noto) return noto;
  const nome = nomeQb(cl && k.valore(cl, 'clienti', 'nome'));
  const q = await api(k, 'GET', `/query?query=${encodeURIComponent(`select * from Customer where DisplayName = '${nome.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)}`);
  let id = q?.QueryResponse?.Customer?.[0]?.Id;
  if (!id) {
    const email = cl && k.valore(cl, 'clienti', 'email'), via = cl && k.valore(cl, 'clienti', 'via');
    const c = await api(k, 'POST', '/customer', { DisplayName: nome, ...(email ? { PrimaryEmailAddr: { Address: email } } : {}),
      ...(via ? { BillAddr: { Line1: via, City: k.valore(cl, 'clienti', 'comune') || undefined, PostalCode: k.valore(cl, 'clienti', 'cap') || undefined, Country: k.valore(cl, 'clienti', 'nazione') || 'IT' } } : {}) });
    id = c?.Customer?.Id; if (!id) throw new Error('QuickBooks non ha creato il cliente');
  }
  if (cl?.id) k.sincro.collega('clienti', cl.id, id);
  return id;
}
const leggiCliente = (k, v) => { const id = v?.id ?? v; if (!id) return null; try { return k.dati.leggi('clienti', String(id)); } catch { return null; } };

// una fattura emessa di Lumi → Invoice
export async function esportaFattura(k, fattura) {
  const f = k.dati.leggi('fatture', fattura.id), s = k.valore(f, 'fatture', 'stato');
  if (s === 'bozza' || s === 'annullata') throw new Error(`La fattura è ${s === 'bozza' ? 'ancora una bozza' : 'annullata'}: non si esporta`);
  if (k.sincro.remoto('fatture', f.id)) throw new Error('Fattura già esportata in QuickBooks');
  const articolo = String(k.imp.articolo || '1');
  const righe = (f.righe || []).map(r => {
    const q = Number(r.quantita ?? 1), unit = (Number(r.prezzo || 0) - Number(r.sconto_importo || 0)) * (1 - Number(r.sconto || 0) / 100), iva = codiceIva(k.imp.iva, r.aliquota);
    return { DetailType: 'SalesItemLineDetail', Amount: due(q * unit), Description: String(r.descrizione || '—').slice(0, 4000),
      SalesItemLineDetail: { ItemRef: { value: articolo }, Qty: q, UnitPrice: Math.round(unit * 1e6) / 1e6, ...(iva ? { TaxCodeRef: { value: iva } } : {}) } };
  });
  if (!righe.length) throw new Error('La fattura non ha righe');
  const cliente = await clienteQb(k, leggiCliente(k, k.valore(f, 'fatture', 'cliente'))), data = k.valore(f, 'fatture', 'data'), scade = k.valore(f, 'fatture', 'scadenza');
  const x = await api(k, 'POST', '/invoice', { CustomerRef: { value: cliente }, DocNumber: String(k.valore(f, 'fatture', 'numero') || f.id).slice(0, 21), TxnDate: data, ...(scade ? { DueDate: scade } : {}),
    PrivateNote: `lumi-f-${f.id}`, ...(k.imp.iva ? { GlobalTaxCalculation: 'TaxExcluded' } : {}), Line: righe });
  const id = x?.Invoice?.Id; if (!id) throw new Error('QuickBooks non ha creato la fattura');
  k.sincro.collega('fatture', f.id, id);
  return { id, numero: x.Invoice.DocNumber };
}

export default {
  id: 'quickbooks', nome: 'QuickBooks', versione: 1, icona: 'documento',
  descrizione: 'Le fatture emesse di Lumi in QuickBooks Online: cliente trovato o creato, righe sull\'articolo che scegli.',
  impostazioni: [
    { id: 'client_id', nome: 'Client ID dell\'app Intuit', segreto: true },
    { id: 'client_secret', nome: 'Client secret dell\'app Intuit', segreto: true },
    { id: 'realm', nome: 'Company ID (realm) di QuickBooks (vuoto: quello del collegamento)', schema: /^\d{1,25}$/, obbligatorio: false },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
    { id: 'articolo', nome: 'Id dell\'articolo (Product/Service) delle righe', predefinito: '1' },
    { id: 'iva', nome: 'Codice IVA (TaxCode) delle righe (es. «22=5, 10=7»; vuoto: nessuno)', obbligatorio: false },
    { id: 'giorni', nome: 'Esporta da solo le fatture degli ultimi giorni (0 = solo a mano)', tipo: 'numero', predefinito: 30 },
  ],
  richiede: {
    fatture: { numero: {}, data: { tipo: 'data' }, stato: { tipo: 'stato' }, cliente: { tipo: 'relazione' }, scadenza: { tipo: 'data', facoltativo: true } },
    clienti: { nome: {}, email: { tipo: ['email'], facoltativo: true }, via: { facoltativo: true }, cap: { facoltativo: true }, comune: { facoltativo: true }, nazione: { facoltativo: true } },
  },
  permessi: { fatture: { leggi: true }, clienti: { leggi: true } },
  oauth: { tipo: 'codice', autorizza: 'https://appcenter.intuit.com/connect/oauth2', token: k => (k.base ? `${k.base}/oauth2/v1/tokens/bearer` : 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'),
    scope: 'com.intuit.quickbooks.accounting', basic: true, conserva: ['realmId'] },
  prova: async k => { try { const r = await api(k, 'GET', `/companyinfo/${realmDi(k)}`); return { ok: true, messaggio: r?.CompanyInfo?.CompanyName || null }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: {
    esporta: {
      nome: 'Esporta in QuickBooks', descrizione: 'Crea in QuickBooks Online la fattura di vendita con il cliente e le righe', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura da esportare' } },
      proponi: async ({ fattura }, k) => ({ titolo: 'Esporta in QuickBooks', righe: [['Fattura', k.valore(fattura, 'fatture', 'numero') || fattura.id], ['Cliente', fattura.cliente?.titolo || '—'], ['Totale', k.euro(fattura.totale)], ['Articolo', k.imp.articolo || '1']],
        avvisi: [...(k.sincro.remoto('fatture', fattura.id) ? ['È già in QuickBooks'] : []), ...(['bozza', 'annullata'].includes(k.valore(fattura, 'fatture', 'stato')) ? ['Una bozza o una fattura annullata non si esporta'] : [])] }),
      esegui: ({ fattura }, k) => esportaFattura(k, fattura),
    },
  },
  pianificati: {
    esporta: { ogni: '1h', async giro(k) {
      const giorni = Number(k.imp.giorni || 0); if (!(giorni > 0) || !k.oauth.collegato()) return { esportate: 0 };
      const da = new Date(Date.now() - giorni * 864e5).toISOString().slice(0, 10), conti = { esportate: 0, errori: 0 };
      const nuove = k.dati.elenca('fatture', { filtri: [{ campo: 'data', op: '>=', valore: da }], perPagina: 500 }).righe
        .filter(f => !k.sincro.remoto('fatture', f.id) && !['bozza', 'annullata'].includes(k.valore(f, 'fatture', 'stato'))).slice(0, 50);
      for (const f of nuove) { try { await esportaFattura(k, f); conti.esportate++; } catch (e) { conti.errori++; k.avvisa(`fattura ${f.numero || f.id} non esportata: ${e.message}`); } }
      return conti;
    } },
  },
  catalogo: {
    categoria: 'contabilita', sito: 'https://quickbooks.intuit.com',
    costo: 'abbonamento', costoNota: 'Serve un abbonamento QuickBooks Online (non venduto in Italia: per aziende e commercialisti di Regno Unito, USA, Canada, Australia, Francia e altri Paesi; prezzi su quickbooks.intuit.com). L\'API è gratuita nel livello Builder dell\'Intuit App Partner Program (scritture gratuite, letture con una quota mensile gratuita). Lumi non aggiunge costi.',
    serve: [
      { cosa: 'Client ID e Client secret dell\'app', dove: 'developer.intuit.com › Dashboard › crea un\'app QuickBooks Online and Payments › Keys & credentials (Development per la sandbox, Production per i dati veri)', link: 'https://developer.intuit.com/app/developer/dashboard' },
      { cosa: 'L\'indirizzo di ritorno OAuth', dove: 'La stessa app › Keys & credentials › Redirect URIs: l\'indirizzo che mostra Lumi (…/api/connettori/quickbooks/oauth/ritorno)', link: 'https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0' },
      { cosa: 'Il Company ID (realm), solo se il collegamento non lo porta: di solito arriva da solo', dove: 'QuickBooks › ingranaggio › Account e impostazioni › Fatturazione e abbonamento › Company ID (in sandbox: developer.intuit.com › Sandbox)', link: 'https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0' },
    ],
    passi: ['Su developer.intuit.com crea un\'app con lo scope Accounting.', 'Aggiungi nei Redirect URIs l\'indirizzo di ritorno che mostra Lumi.', 'Copia Client ID e Client secret in Lumi e scegli l\'ambiente (prova = sandbox).', 'Premi «Collega» e autorizza l\'azienda: il Company ID arriva da solo con il collegamento.', 'Controlla l\'articolo delle righe (Id 1 di solito è «Services») e, fuori dagli USA, i codici IVA.', 'Esporta una fattura con «Esporta in QuickBooks»; il giro orario porta le nuove.'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice', 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer', 'https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0', 'https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/minor-versions', 'https://developer.intuit.com/app/developer/qbo/docs/get-started/app-partner-program'],
    prova: 'finto', parole: ['quickbooks', 'intuit', 'qbo', 'contabilità', 'commercialista', 'esporta fatture', 'accounting', 'bookkeeping', 'accountant'],
  },
  testi: {
    en: { descrizione: 'Lumi issued invoices in QuickBooks Online: customer found or created, lines on the item you choose.', 'imp.client_id': 'Intuit app Client ID', 'imp.client_secret': 'Intuit app Client secret', 'imp.realm': 'QuickBooks Company ID (realm) (empty: the one from the connection)', 'imp.ambiente': 'Environment',
      'imp.articolo': 'Item (Product/Service) Id for the lines', 'imp.iva': 'Line TaxCode (e.g. «22=5, 10=7»; empty: none)', 'imp.giorni': 'Export invoices of the last days automatically (0 = by hand only)', 'az.esporta': 'Export to QuickBooks', 'giro.esporta': 'Export new invoices',
      'cat.costoNota': 'Needs a QuickBooks Online subscription (not sold in Italy: for companies and accountants in the UK, US, Canada, Australia, France and other countries; prices on quickbooks.intuit.com). The API is free on the Builder tier of the Intuit App Partner Program (writes free, reads with a free monthly quota). Lumi adds no cost.',
      'cat.serve': [{ cosa: 'App Client ID and Client secret', dove: 'developer.intuit.com › Dashboard › create a QuickBooks Online and Payments app › Keys & credentials (Development for the sandbox, Production for real data)' }, { cosa: 'The OAuth redirect address', dove: 'Same app › Keys & credentials › Redirect URIs: the address Lumi shows (…/api/connettori/quickbooks/oauth/ritorno)' }, { cosa: 'The Company ID (realm), only if the connection does not bring it: usually it arrives by itself', dove: 'QuickBooks › gear › Account and settings › Billing & subscription › Company ID (sandbox: developer.intuit.com › Sandbox)' }],
      'cat.passi': ['On developer.intuit.com create an app with the Accounting scope.', 'Add the redirect address Lumi shows to the Redirect URIs.', 'Copy Client ID and Client secret into Lumi and choose the environment (prova = sandbox).', 'Press «Connect» and authorise the company: the Company ID arrives with the connection.', 'Check the line item (Id 1 is usually «Services») and, outside the US, the tax codes.', 'Export an invoice with «Export to QuickBooks»; the hourly run brings the new ones.'] },
    es: { descrizione: 'Las facturas emitidas de Lumi en QuickBooks Online: cliente encontrado o creado, líneas sobre el artículo que elijas.', 'imp.client_id': 'Client ID de la app Intuit', 'imp.client_secret': 'Client secret de la app Intuit', 'imp.realm': 'Company ID (realm) de QuickBooks (vacío: el de la conexión)', 'imp.ambiente': 'Entorno',
      'imp.articolo': 'Id del artículo (Product/Service) de las líneas', 'imp.iva': 'TaxCode de las líneas (p. ej. «22=5»; vacío: ninguno)', 'imp.giorni': 'Exportar solas las facturas de los últimos días (0 = solo a mano)', 'az.esporta': 'Exportar a QuickBooks', 'giro.esporta': 'Exportar facturas nuevas' },
    fr: { descrizione: 'Les factures émises de Lumi dans QuickBooks Online : client trouvé ou créé, lignes sur l\'article choisi.', 'imp.client_id': 'Client ID de l\'app Intuit', 'imp.client_secret': 'Client secret de l\'app Intuit', 'imp.realm': 'Company ID (realm) QuickBooks (vide : celui de la connexion)', 'imp.ambiente': 'Environnement',
      'imp.articolo': 'Id de l\'article (Product/Service) des lignes', 'imp.iva': 'TaxCode des lignes (ex. « 22=5 » ; vide : aucun)', 'imp.giorni': 'Exporter seul les factures des derniers jours (0 = à la main)', 'az.esporta': 'Exporter vers QuickBooks', 'giro.esporta': 'Exporter les nouvelles factures' },
    de: { descrizione: 'Ausgestellte Lumi-Rechnungen in QuickBooks Online: Kunde gefunden oder angelegt, Positionen auf dem gewählten Artikel.', 'imp.client_id': 'Client-ID der Intuit-App', 'imp.client_secret': 'Client-Secret der Intuit-App', 'imp.realm': 'QuickBooks-Company-ID (Realm) (leer: die der Verbindung)', 'imp.ambiente': 'Umgebung',
      'imp.articolo': 'Artikel-Id (Product/Service) der Positionen', 'imp.iva': 'TaxCode der Positionen (z. B. «22=5»; leer: keiner)', 'imp.giorni': 'Rechnungen der letzten Tage automatisch exportieren (0 = nur von Hand)', 'az.esporta': 'Nach QuickBooks exportieren', 'giro.esporta': 'Neue Rechnungen exportieren' },
    pt: { descrizione: 'As faturas emitidas do Lumi no QuickBooks Online: cliente encontrado ou criado, linhas no item que você escolher.', 'imp.client_id': 'Client ID do app Intuit', 'imp.client_secret': 'Client secret do app Intuit', 'imp.realm': 'Company ID (realm) do QuickBooks (vazio: o da conexão)', 'imp.ambiente': 'Ambiente',
      'imp.articolo': 'Id do item (Product/Service) das linhas', 'imp.iva': 'TaxCode das linhas (ex.: «22=5»; vazio: nenhum)', 'imp.giorni': 'Exportar sozinho as faturas dos últimos dias (0 = só à mão)', 'az.esporta': 'Exportar para o QuickBooks', 'giro.esporta': 'Exportar faturas novas' },
  },
};
