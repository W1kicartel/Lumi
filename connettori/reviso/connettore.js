// Reviso (Visma): la contabilità in cloud usata da molti commercialisti. Le fatture emesse in Lumi (e già inviate allo
// SDI da Lumi) entrano in Reviso come bozze di fattura, con il cliente trovato per partita IVA o creato; a scelta si
// registrano. REST su rest.reviso.com con due intestazioni: X-AppSecretToken (l'app) e X-AgreementGrantToken
// (il permesso del contratto). Endpoint: GET /self, GET /customers?filter=vatNumber$eq:…, POST /customers (obbligatori
// name, currency, customerGroup, paymentTerms, vatZone), POST /v2/invoices/drafts, POST /v2/invoices/booked { id }.
// https://api-docs.reviso.com/ · https://rest.reviso.com/schema/customers.post.schema.json
import { contiFattura, fiscaliCliente } from '../../server/moduli/documenti-xml.js';

const API = 'https://rest.reviso.com';
const base = k => k.base || API;
const si = v => v === true || v === 'true' || v === 1 || v === '1';
const num = (v, d) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : d; };
async function api(k, metodo, percorso, json) {
  const r = await k.http.richiesta(metodo, base(k) + percorso, { json, intestazioni: { 'X-AppSecretToken': k.segreti.app, 'X-AgreementGrantToken': k.segreti.contratto } });
  if (!r.ok) {
    const e = r.json?.errors ? JSON.stringify(r.json.errors) : r.json?.message || r.testo || '';
    throw new Error(`Reviso ha risposto ${r.stato}: ${String(e).slice(0, 240)}`);
  }
  return r.json;
}
// «22=V22, 10=V10, 0=E10»: l'aliquota di Lumi → il codice IVA di Reviso (vuoto: decide Reviso dal prodotto o dal cliente)
const codiciIva = k => Object.fromEntries(String(k.imp.iva || '').split(/[,;\n]/).map(x => x.split('=').map(s => s.trim())).filter(([a, c]) => a !== '' && c));

// il cliente in Reviso: collegato, trovato per partita IVA (o codice fiscale) o creato
async function cliente(k, f) {
  let cl = {}; if (f.cliente?.id) { try { cl = k.dati.leggi('clienti', f.cliente.id); } catch { cl = {}; } }
  const gia = cl.id && k.sincro.remoto('clienti', cl.id); if (gia) return { numero: Number(gia), c: fiscaliCliente(cl) };
  const c = fiscaliCliente(cl); if (!c.nome) throw new Error('La fattura non ha un cliente con il nome');
  const filtro = c.piva ? `vatNumber$eq:${c.piva}` : c.cf ? `corporateIdentificationNumber$eq:${c.cf}` : null;
  // la lista arriva in «collection» (la forma delle API e-conomic/Reviso); un array nudo si accetta lo stesso
  const lista = x => x?.collection || (Array.isArray(x) ? x : []);
  let o = filtro ? lista(await api(k, 'GET', `/customers?filter=${encodeURIComponent(filtro)}&pagesize=1`))[0] : null;
  if (!o) o = await api(k, 'POST', '/customers', { name: c.nome.slice(0, 255), currency: 'EUR',
    customerGroup: { customerGroupNumber: num(k.imp.gruppo, 1) }, paymentTerms: { paymentTermsNumber: num(k.imp.pagamento, 1) }, vatZone: { vatZoneNumber: num(k.imp.zona, 1) },
    ...(c.via ? { address: c.via } : {}), ...(c.cap ? { zip: c.cap } : {}), ...(c.comune ? { city: c.comune } : {}), ...(c.piva ? { vatNumber: c.piva } : {}),
    ...(c.cf ? { corporateIdentificationNumber: c.cf } : {}), ...(cl.email ? { email: cl.email } : {}), ...(c.pec ? { italianCertifiedEmail: c.pec } : {}) });
  if (!o?.customerNumber) throw new Error('Reviso non ha restituito il cliente');
  if (cl.id) k.sincro.collega('clienti', cl.id, o.customerNumber);
  return { numero: o.customerNumber, c };
}

// la fattura di Lumi → una bozza di fattura in Reviso (e, se scelto, registrata). Una volta sola: poi resta collegata
export async function esporta(k, f) {
  if (k.sincro.remoto('fatture', f.id)) throw new Error('Fattura già esportata in Reviso');
  const s = k.valore(f, 'fatture', 'stato'); if (s === 'bozza' || s === 'annullata') throw new Error(`La fattura è ${s === 'bozza' ? 'ancora una bozza' : 'annullata'}: non si esporta`);
  const { numero: customerNumber, c } = await cliente(k, f), conti = contiFattura(f), iva = codiciIva(k), n = String(k.valore(f, 'fatture', 'numero') || f.id);
  const zona = { vatZoneNumber: num(k.imp.zona, 1) }, prodotto = k.imp.prodotto ? { productNumber: String(k.imp.prodotto) } : null;
  const bozza = {
    date: f.data, currency: 'EUR', customer: { customerNumber }, paymentTerms: { paymentTermsNumber: num(k.imp.pagamento, 1) },
    ...(k.imp.layout ? { layout: { layoutNumber: num(k.imp.layout) } } : {}), ...(f.scadenza ? { dueDate: f.scadenza } : {}),
    recipient: { name: c.nome, vatZone: zona, ...(c.via ? { address: c.via } : {}), ...(c.cap ? { zip: c.cap } : {}), ...(c.comune ? { city: c.comune } : {}) },
    references: { other: `Lumi ${n}` }, notes: { heading: `Fattura ${n}`, ...(f.causale ? { textLine1: String(f.causale).slice(0, 1000) } : {}) },
    // il prezzo unitario già scontato: gli sconti a importo di Lumi non hanno un campo in Reviso
    lines: conti.linee.map((l, i) => ({ lineNumber: i + 1, description: String(l.descrizione || '').slice(0, 2500), quantity: l.quantita,
      unitNetPrice: Math.round((l.prezzo * (1 - l.sconto / 100) - l.sconto_importo) * 1e6) / 1e6,
      ...(prodotto ? { product: prodotto } : {}), ...(iva[String(l.aliquota)] || iva[l.natura] ? { vatAccount: { vatCode: iva[l.natura] || iva[String(l.aliquota)] } } : {}) })),
  };
  const x = await api(k, 'POST', '/v2/invoices/drafts', bozza), id = x?.id ?? x?.draftInvoiceNumber;
  if (id == null) throw new Error('Reviso non ha restituito la bozza');
  let registrata = null;
  if (si(k.imp.registra)) registrata = (await api(k, 'POST', '/v2/invoices/booked', { id }))?.bookedInvoiceNumber ?? null;
  k.sincro.collega('fatture', f.id, registrata != null ? `registrata-${registrata}` : `bozza-${id}`);
  return { bozza: id, registrata, totale: conti.totale };
}

export default {
  id: 'reviso', nome: 'Reviso', versione: 1, icona: 'documento',
  descrizione: 'Le fatture emesse in Lumi entrano nella contabilità Reviso del commercialista, con i clienti.',
  impostazioni: [
    { id: 'app', nome: 'App secret token (X-AppSecretToken)', segreto: true },
    { id: 'contratto', nome: 'Agreement grant token (X-AgreementGrantToken)', segreto: true },
    { id: 'gruppo', nome: 'Numero del gruppo clienti per i clienti nuovi', tipo: 'numero', predefinito: 1 },
    { id: 'pagamento', nome: 'Numero dei termini di pagamento', tipo: 'numero', predefinito: 1 },
    { id: 'zona', nome: 'Numero della zona IVA (Italia)', tipo: 'numero', predefinito: 1 },
    { id: 'layout', nome: 'Numero del layout della fattura (vuoto: quello del cliente)', tipo: 'numero', obbligatorio: false },
    { id: 'prodotto', nome: 'Numero del prodotto per le righe (vuoto: righe senza prodotto)', obbligatorio: false },
    { id: 'iva', nome: 'Codici IVA di Reviso per aliquota o natura (es. 22=V22, 10=V10, N2.2=E22)', obbligatorio: false },
    { id: 'registra', nome: 'Registra subito la fattura (altrimenti resta bozza da controllare)', tipo: 'si_no', predefinito: false },
    { id: 'giorni', nome: 'Il giro esporta da solo le fatture degli ultimi N giorni (0: spento)', tipo: 'numero', predefinito: 0 },
  ],
  richiede: { fatture: { stato: { tipo: 'stato' }, numero: {}, data: { tipo: 'data' }, cliente: { tipo: 'relazione' } }, clienti: { nome: {} } },
  permessi: { fatture: { leggi: true }, clienti: { leggi: true } },
  prova: async k => { try { const x = await api(k, 'GET', '/self'); return { ok: true, messaggio: x?.company?.name || x?.agreementNumber ? `Contratto ${x.company?.name || x.agreementNumber}` : null }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: {
    esporta: {
      nome: 'Esporta in Reviso', descrizione: 'Crea in Reviso la bozza della fattura (cliente, righe, IVA) per la contabilità', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura da esportare' } },
      proponi: async ({ fattura }, k) => ({ titolo: 'Esporta in Reviso', righe: [['Fattura', k.valore(fattura, 'fatture', 'numero') || fattura.id], ['Cliente', fattura.cliente?.titolo || '—'], ['Totale', k.euro(fattura.totale)], ['In Reviso', si(k.imp.registra) ? 'registrata' : 'bozza']],
        avvisi: [...(k.sincro.remoto('fatture', fattura.id) ? ['È già in Reviso'] : []), ...(['bozza', 'annullata'].includes(k.valore(fattura, 'fatture', 'stato')) ? ['Una bozza o una fattura annullata non si esporta'] : []),
          'Se la fattura è già partita allo SDI da Lumi, non reinviarla da Reviso'] }),
      esegui: ({ fattura }, k) => esporta(k, fattura),
    },
  },
  pianificati: {
    // le fatture emesse degli ultimi N giorni non ancora in Reviso: al massimo 25 a giro
    esporta: { ogni: '1h', async giro(k) {
      const giorni = Number(k.imp.giorni || 0); if (!(giorni > 0)) return { esportate: 0, errori: 0 };
      const da = new Date(Date.now() - giorni * 864e5).toISOString().slice(0, 10), out = { esportate: 0, errori: 0 };
      const nuove = k.dati.elenca('fatture', { filtri: [{ campo: 'data', op: '>=', valore: da }], perPagina: 500 }).righe
        .filter(f => !k.sincro.remoto('fatture', f.id) && !['bozza', 'annullata'].includes(k.valore(f, 'fatture', 'stato'))).slice(0, 25);
      for (const f of nuove) { try { await esporta(k, f); out.esportate++; } catch (e) { out.errori++; k.avvisa(`fattura ${k.valore(f, 'fatture', 'numero') || f.id} non esportata in Reviso: ${e.message}`); } }
      return out;
    } },
  },
  catalogo: {
    categoria: 'contabilita', sito: 'https://www.reviso.com/it/',
    costo: 'abbonamento', costoNota: 'Serve un abbonamento Reviso (di solito lo ha lo studio del commercialista; listino su reviso.com); l\'accesso alle API richiede un\'app sviluppatore Reviso, gratuita. Lumi non aggiunge costi.',
    serve: [
      { cosa: 'L\'App secret token di un\'app sviluppatore', dove: 'Portale sviluppatori Reviso › registra un developer agreement › crea l\'app: ricevi l\'App secret token e il link di installazione', link: 'https://api-docs.reviso.com/' },
      { cosa: 'L\'Agreement grant token del contratto Reviso dell\'azienda', dove: 'Chi gestisce Reviso (tu o il commercialista) apre il link di installazione dell\'app e la autorizza: al termine compare il grant token', link: 'https://api-docs.reviso.com/' },
    ],
    passi: ['Registra un developer agreement su Reviso e crea l\'app: annota l\'App secret token.', 'Fai autorizzare l\'app sul contratto Reviso dell\'azienda (anche dal commercialista) e annota l\'Agreement grant token.', 'In Reviso guarda i numeri del gruppo clienti, dei termini di pagamento, della zona IVA e, se vuoi, i codici IVA: scrivili nella pagina del connettore.', 'Incolla i due token e premi «Prova la connessione».', 'Accendi: da ogni fattura emessa c\'è «Esporta in Reviso»; arriva come bozza, salvo che tu scelga «Registra subito».', 'Se vuoi, imposta i giorni: ogni ora il giro esporta da solo le fatture nuove.', 'Non reinviare allo SDI da Reviso le fatture già partite da Lumi.'],
    difficolta: 'media', zone: ['IT', 'UE'],
    fonti: ['https://api-docs.reviso.com/', 'https://rest.reviso.com/schema/customers.post.schema.json', 'https://www.reviso.com/it/'],
    prova: 'finto', parole: ['reviso', 'visma', 'contabilità', 'commercialista', 'prima nota', 'registrazione fatture', 'accounting', 'bookkeeping', 'invoices'],
  },
  testi: {
    en: { descrizione: 'Invoices issued in Lumi enter the accountant\'s Reviso books, with customers.', 'imp.app': 'App secret token (X-AppSecretToken)', 'imp.contratto': 'Agreement grant token (X-AgreementGrantToken)',
      'imp.gruppo': 'Customer group number for new customers', 'imp.pagamento': 'Payment terms number', 'imp.zona': 'VAT zone number (Italy)', 'imp.layout': 'Invoice layout number (empty: the customer\'s)',
      'imp.prodotto': 'Product number for lines (empty: lines without product)', 'imp.iva': 'Reviso VAT codes by rate or nature (e.g. 22=V22, 10=V10, N2.2=E22)', 'imp.registra': 'Book the invoice right away (otherwise it stays a draft to check)',
      'imp.giorni': 'The run exports invoices of the last N days by itself (0: off)', 'az.esporta': 'Export to Reviso', 'giro.esporta': 'Export new invoices',
      'cat.costoNota': 'You need a Reviso subscription (usually the accountant\'s firm has it; price list on reviso.com); API access needs a Reviso developer app, free. Lumi adds no costs.',
      'cat.serve': [{ cosa: 'The App secret token of a developer app', dove: 'Reviso developer portal › register a developer agreement › create the app: you get the App secret token and the installation link' },
        { cosa: 'The Agreement grant token of the company\'s Reviso agreement', dove: 'Whoever runs Reviso (you or the accountant) opens the app installation link and authorizes it: the grant token appears at the end' }],
      'cat.passi': ['Register a developer agreement on Reviso and create the app: note the App secret token.', 'Have the app authorized on the company\'s Reviso agreement (the accountant can do it) and note the Agreement grant token.', 'In Reviso look up the customer group, payment terms and VAT zone numbers and, if you like, the VAT codes: enter them on the connector page.', 'Paste the two tokens and press «Test connection».', 'Switch on: every issued invoice gets «Export to Reviso»; it arrives as a draft unless you choose «Book right away».', 'If you like, set the days: every hour the run exports new invoices by itself.', 'Do not resend to SDI from Reviso the invoices already sent from Lumi.'] },
    es: { descrizione: 'Las facturas emitidas en Lumi entran en la contabilidad Reviso del asesor, con los clientes.', 'imp.app': 'App secret token (X-AppSecretToken)', 'imp.contratto': 'Agreement grant token (X-AgreementGrantToken)', 'imp.gruppo': 'Número del grupo de clientes para clientes nuevos', 'imp.pagamento': 'Número de las condiciones de pago', 'imp.zona': 'Número de la zona de IVA (Italia)', 'imp.layout': 'Número del diseño de factura (vacío: el del cliente)', 'imp.prodotto': 'Número del producto para las líneas (vacío: sin producto)', 'imp.iva': 'Códigos de IVA de Reviso por tipo o naturaleza (ej. 22=V22, 10=V10)', 'imp.registra': 'Contabilizar la factura enseguida (si no, queda en borrador)', 'imp.giorni': 'El proceso exporta solo las facturas de los últimos N días (0: apagado)', 'az.esporta': 'Exportar a Reviso', 'giro.esporta': 'Exportar facturas nuevas' },
    fr: { descrizione: 'Les factures émises dans Lumi entrent dans la comptabilité Reviso du comptable, avec les clients.', 'imp.app': 'App secret token (X-AppSecretToken)', 'imp.contratto': 'Agreement grant token (X-AgreementGrantToken)', 'imp.gruppo': 'Numéro du groupe de clients pour les nouveaux clients', 'imp.pagamento': 'Numéro des conditions de paiement', 'imp.zona': 'Numéro de la zone TVA (Italie)', 'imp.layout': 'Numéro de la mise en page de facture (vide : celle du client)', 'imp.prodotto': 'Numéro du produit pour les lignes (vide : sans produit)', 'imp.iva': 'Codes TVA Reviso par taux ou nature (ex. 22=V22, 10=V10)', 'imp.registra': 'Comptabiliser la facture tout de suite (sinon elle reste en brouillon)', 'imp.giorni': 'Le cycle exporte seul les factures des N derniers jours (0 : arrêté)', 'az.esporta': 'Exporter vers Reviso', 'giro.esporta': 'Exporter les nouvelles factures' },
    de: { descrizione: 'In Lumi ausgestellte Rechnungen gelangen samt Kunden in die Reviso-Buchhaltung des Steuerberaters.', 'imp.app': 'App secret token (X-AppSecretToken)', 'imp.contratto': 'Agreement grant token (X-AgreementGrantToken)', 'imp.gruppo': 'Kundengruppennummer für neue Kunden', 'imp.pagamento': 'Nummer der Zahlungsbedingungen', 'imp.zona': 'Nummer der MwSt-Zone (Italien)', 'imp.layout': 'Nummer des Rechnungslayouts (leer: das des Kunden)', 'imp.prodotto': 'Produktnummer für die Zeilen (leer: ohne Produkt)', 'imp.iva': 'Reviso-MwSt-Codes nach Satz oder Natur (z. B. 22=V22, 10=V10)', 'imp.registra': 'Rechnung sofort buchen (sonst bleibt sie Entwurf)', 'imp.giorni': 'Der Lauf exportiert Rechnungen der letzten N Tage selbst (0: aus)', 'az.esporta': 'Nach Reviso exportieren', 'giro.esporta': 'Neue Rechnungen exportieren' },
    pt: { descrizione: 'As faturas emitidas no Lumi entram na contabilidade Reviso do contador, com os clientes.', 'imp.app': 'App secret token (X-AppSecretToken)', 'imp.contratto': 'Agreement grant token (X-AgreementGrantToken)', 'imp.gruppo': 'Número do grupo de clientes para clientes novos', 'imp.pagamento': 'Número das condições de pagamento', 'imp.zona': 'Número da zona de IVA (Itália)', 'imp.layout': 'Número do layout da fatura (vazio: o do cliente)', 'imp.prodotto': 'Número do produto para as linhas (vazio: sem produto)', 'imp.iva': 'Códigos de IVA do Reviso por alíquota ou natureza (ex. 22=V22, 10=V10)', 'imp.registra': 'Lançar a fatura logo (senão fica rascunho)', 'imp.giorni': 'A rotina exporta sozinha as faturas dos últimos N dias (0: desligada)', 'az.esporta': 'Exportar para o Reviso', 'giro.esporta': 'Exportar faturas novas' },
  },
};
