// Registratore telematico Epson (FP-81 II RT, FP-90 III RT, RT Server): dalla vendita di Lumi al documento commerciale
// senza ribattere niente. Il registratore è sulla rete del negozio e parla XML «ePOS-Print Fiscal» via HTTP:
// POST http://<ip>/cgi-bin/fpmate.cgi?devid=local_printer&timeout=10000 con una busta SOAP (printerFiscalReceipt,
// printerFiscalReport, printerCommand); risponde <response success="true|false" code="…" status="…"> con addInfo
// (fiscalReceiptNumber, zRepNumber). È rete interna: va permessa per questo connettore nella sua pagina.
// Un documento già emesso non si ristampa: la vendita resta collegata al numero «Z-scontrino».
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const virgola = (n, d = 2) => Number(n || 0).toFixed(d).replace('.', ',');
const busta = corpo => `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${corpo}</s:Body></s:Envelope>`;
// i pagamenti di Lumi → paymentType Epson (0 contanti, 2 carta/elettronico con index 1)
const PAGAMENTO = { contanti: ['0', '0', 'CONTANTI'], carta: ['2', '1', 'PAGAMENTO ELETTRONICO'], bonifico: ['2', '1', 'PAGAMENTO ELETTRONICO'] };
// «22:1, 10:2, 4:3, 0:4» → { 22: '1', … }: l'aliquota IVA dell'articolo sceglie il reparto
const reparti = s => Object.fromEntries(String(s || '').split(/[,;\s]+/).map(x => x.split(':')).filter(x => x.length === 2 && /^\d+(\.\d+)?$/.test(x[0]) && /^\d{1,2}$/.test(x[1])).map(([a, r]) => [Number(a), r]));

async function manda(k, xml) {
  const u = `${String(k.imp.indirizzo || '').replace(/\/$/, '')}/cgi-bin/fpmate.cgi?devid=${encodeURIComponent(k.imp.dispositivo || 'local_printer')}&timeout=10000`;
  const r = await k.http.post(u, { testo: busta(xml), intestazioni: { 'Content-Type': 'text/xml; charset=utf-8', Accept: 'text/xml', SOAPAction: '""' } });
  const t = r.testo || '', ok = /<response[^>]*\bsuccess="true"/i.test(t), v = tag => new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(t)?.[1] ?? null;
  if (!r.ok || !ok) throw new Error(`Il registratore ha risposto ${r.stato}: ${/code="([^"]*)"/.exec(t)?.[1] || 'errore'} ${v('printerStatus') || ''}`.trim());
  return { scontrino: v('fiscalReceiptNumber'), z: v('zRepNumber'), data: v('fiscalReceiptDate'), ora: v('fiscalReceiptTime'), totale: v('fiscalReceiptAmount') };
}
// il documento commerciale di una vendita: una riga per articolo (con lo sconto), il totale con il pagamento
export function xmlScontrino(k, v) {
  const op = esc(k.imp.operatore || '1'), rep = reparti(k.imp.reparti), pred = String(k.imp.reparto || '1'), righe = [];
  for (const r of v.righe || []) {
    let iva = null; const aid = r.articolo?.id;
    if (aid && k.campo('articoli', 'iva')) { try { iva = k.valore(k.dati.leggi('articoli', aid), 'articoli', 'iva'); } catch { iva = null; } }
    const q = Number(r.quantita || 1), prezzo = Number(r.prezzo || 0), nome = esc(String(r.articolo?.titolo || r.descrizione || 'Articolo').toUpperCase().slice(0, 38));
    righe.push(`<printRecItem operator="${op}" description="${nome}" quantity="${virgola(q, 3)}" unitPrice="${virgola(prezzo)}" department="${esc(rep[Number(iva)] || pred)}" justification="1" />`);
    const sc = Number(r.sconto || 0); if (sc > 0) righe.push(`<printRecItemAdjustment operator="${op}" adjustmentType="0" description="SCONTO ${virgola(sc, 0)}%" amount="${virgola(q * prezzo * sc / 100)}" department="${esc(rep[Number(iva)] || pred)}" justification="1" />`);
  }
  const [tipo, indice, descr] = PAGAMENTO[k.valore(v, 'vendite', 'pagamento')] || PAGAMENTO[k.imp.pagamento] || PAGAMENTO.contanti;
  return `<printerFiscalReceipt><beginFiscalReceipt operator="${op}" />${righe.join('')}<printRecTotal operator="${op}" description="${descr}" payment="${virgola(k.valore(v, 'vendite', 'totale'))}" paymentType="${tipo}" index="${indice}" justification="1" /><endFiscalReceipt operator="${op}" /></printerFiscalReceipt>`;
}
async function scontrino(k, v) {
  const gia = k.sincro.remoto('vendite', v.id); if (gia) throw new Error(`Scontrino già emesso (${gia})`);
  if (k.valore(v, 'vendite', 'stato') === 'annullata') throw new Error('La vendita è annullata');
  if (!(v.righe || []).length) throw new Error('La vendita non ha righe');
  const x = await manda(k, xmlScontrino(k, v)), num = `${x.z || '?'}-${x.scontrino || '?'}`;
  k.sincro.collega('vendite', v.id, num);
  const m = { ...(k.valore(v, 'vendite', 'stato') !== 'pagata' ? { stato: 'pagata' } : {}), ...(k.campo('vendite', 'scontrino') ? { scontrino: num } : {}) };
  if (Object.keys(m).length) k.dati.modifica('vendite', v.id, m);
  return { ...x, numero: x.scontrino, scontrino: num };
}

export default {
  id: 'epson-rt', nome: 'Registratore telematico Epson', versione: 1, icona: 'cassa',
  descrizione: 'Dalla vendita di Lumi al documento commerciale sul registratore telematico Epson del negozio, e la chiusura giornaliera.',
  impostazioni: [
    { id: 'indirizzo', nome: 'Indirizzo del registratore (es. http://192.168.1.50)', tipo: 'url' },
    { id: 'dispositivo', nome: 'ID del dispositivo (devid)', predefinito: 'local_printer', schema: /^[\w-]{1,40}$/ },
    { id: 'operatore', nome: 'Operatore', predefinito: '1', schema: /^\d{1,2}$/ },
    { id: 'reparto', nome: 'Reparto predefinito', predefinito: '1', schema: /^\d{1,2}$/ },
    { id: 'reparti', nome: 'Reparti per aliquota IVA (es. 22:1, 10:2, 4:3, 0:4)', obbligatorio: false },
    { id: 'pagamento', nome: 'Pagamento se la vendita non lo dice', tipo: 'scelta', opzioni: ['contanti', 'carta'], predefinito: 'contanti' },
    { id: 'automatico', nome: 'Emetti lo scontrino quando una vendita diventa pagata', tipo: 'si_no', predefinito: false },
    { id: 'chiusura', nome: 'Chiusura giornaliera automatica alle 23:30', tipo: 'si_no', predefinito: false },
  ],
  richiede: { vendite: { stato: { tipo: 'stato' }, totale: {}, righe: { tipo: 'righe' }, pagamento: { tipo: 'scelta', facoltativo: true }, scontrino: { facoltativo: true } }, articoli: { iva: { facoltativo: true } } },
  permessi: { vendite: { leggi: true, modifica: true }, articoli: { leggi: true } },
  prova: async k => { try { await manda(k, '<printerCommand><queryPrinterStatus operator="1" statusType="1" /></printerCommand>'); return { ok: true }; } catch (e) { return { ok: false, messaggio: e.message }; } },
  azioni: {
    scontrino: {
      nome: 'Emetti lo scontrino', descrizione: 'Stampa il documento commerciale della vendita sul registratore telematico', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'relazione', entita: 'vendite', nome: 'La vendita' } },
      proponi: async ({ vendita }, k) => ({ titolo: 'Documento commerciale', righe: [['Vendita', vendita.numero || vendita.id], ['Righe', String((vendita.righe || []).length)], ['Totale', k.euro(k.valore(vendita, 'vendite', 'totale'))]],
        avvisi: [...(k.sincro.remoto('vendite', vendita.id) ? [`Scontrino già emesso (${k.sincro.remoto('vendite', vendita.id)})`] : []), ...(k.valore(vendita, 'vendite', 'stato') === 'annullata' ? ['La vendita è annullata'] : [])] }),
      esegui: ({ vendita }, k) => scontrino(k, vendita),
    },
    chiusura: {
      nome: 'Chiusura giornaliera', descrizione: 'Stampa la chiusura giornaliera (Z) e manda i corrispettivi all\'Agenzia delle Entrate',
      proponi: async () => ({ titolo: 'Chiusura giornaliera', righe: [], avvisi: ['Dopo la chiusura gli scontrini di oggi non si possono più annullare dal registratore'] }),
      esegui: async (_, k) => manda(k, '<printerFiscalReport><printZReport operator="1" /></printerFiscalReport>'),
    },
  },
  // con «automatico»: la vendita che diventa pagata in Lumi va in coda (con i tentativi del nucleo) e si stampa una volta
  uscita: { vendite: { campi: ['stato'], quando: (r, k) => !!k.imp.automatico && k.valore(r, 'vendite', 'stato') === 'pagata' && !k.sincro.remoto('vendite', r.id),
    async invia(r, k) { if (!k.sincro.remoto('vendite', r.id)) await scontrino(k, k.dati.leggi('vendite', r.id)); } } },
  pianificati: { chiusura: { alle: '23:30', giro: async k => (k.imp.chiusura ? manda(k, '<printerFiscalReport><printZReport operator="1" /></printerFiscalReport>') : 'spenta') } },
  catalogo: {
    categoria: 'cassa', sito: 'https://www.epson.it/it_IT/prodotti/stampanti/stampanti-fiscali/c/s14000',
    costo: 'gratis', costoNota: 'Il collegamento è gratis: serve un registratore telematico Epson (FP-81 II RT, FP-90 III RT o RT Server), acquistato e attivato dal tuo rivenditore (da circa 400–700 € più l\'assistenza annuale obbligatoria).',
    serve: [{ cosa: 'L\'indirizzo IP del registratore sulla rete del negozio', dove: 'Sul registratore: menu Impostazioni › Rete (o lo scontrino di configurazione); meglio un IP fisso assegnato dal router', link: 'https://www.epson.it/it_IT/assistenza' },
      { cosa: 'La tabella dei reparti con le aliquote IVA', dove: 'Chiedila al tuo rivenditore o stampala dal registratore (programmazione reparti)', link: 'https://www.agenziaentrate.gov.it/portale/web/guest/schede/comunicazioni/corrispettivi-telematici' }],
    passi: ['Collega il registratore alla stessa rete del computer di Lumi e annota il suo indirizzo IP.', 'Nella pagina del connettore scrivi l\'indirizzo (es. http://192.168.1.50) e spunta «permetti la rete interna».', 'Scrivi i reparti per aliquota (es. 22:1, 10:2, 4:3, 0:4) come sono programmati sul registratore.', 'Premi «Prova la connessione»: Lumi chiede lo stato del registratore.', 'Dalla vendita usa «Emetti lo scontrino», oppure accendi «automatico» per stamparlo quando la vendita diventa pagata.', 'A fine giornata premi «Chiusura giornaliera» o accendi la chiusura automatica alle 23:30.'],
    difficolta: 'difficile', zone: ['IT'],
    fonti: ['https://www.scontrinosmart.it/en/fp81ii/documents/epos-fiscal-print-solution-dev-guide/info', 'https://www.agenziaentrate.gov.it/portale/documents/20143/4952835/Specifiche_Tecniche_RT_V11.pdf/246859ea-1586-5164-daf9-af01779de295'],
    prova: 'finto', parole: ['registratore telematico', 'rt', 'scontrino', 'documento commerciale', 'corrispettivi', 'epson', 'fp-81', 'fp-90', 'cassa', 'chiusura', 'fiscal printer', 'receipt'],
  },
  testi: {
    en: { nome: 'Epson fiscal printer (RT)', descrizione: 'From a Lumi sale to the commercial document on the shop\'s Epson fiscal printer, plus the daily closure.', 'imp.indirizzo': 'Fiscal printer address (e.g. http://192.168.1.50)', 'imp.dispositivo': 'Device ID (devid)', 'imp.operatore': 'Operator', 'imp.reparto': 'Default department', 'imp.reparti': 'Departments by VAT rate (e.g. 22:1, 10:2, 4:3, 0:4)', 'imp.pagamento': 'Payment when the sale does not say', 'imp.automatico': 'Issue the receipt when a sale becomes paid', 'imp.chiusura': 'Automatic daily closure at 23:30', 'az.scontrino': 'Issue the receipt', 'az.chiusura': 'Daily closure', 'giro.chiusura': 'Daily closure',
      'cat.costoNota': 'The link is free: you need an Epson fiscal printer (FP-81 II RT, FP-90 III RT or RT Server), bought and activated by your dealer (about €400–700 plus the mandatory yearly service).',
      'cat.serve': [{ cosa: 'The printer IP address on the shop network', dove: 'On the printer: Settings › Network menu (or the configuration receipt); better a fixed IP from the router' }, { cosa: 'The department table with VAT rates', dove: 'Ask your dealer or print it from the printer (department programming)' }],
      'cat.passi': ['Connect the printer to the same network as the Lumi computer and note its IP address.', 'On the connector page enter the address (e.g. http://192.168.1.50) and tick «allow the internal network».', 'Enter the departments by VAT rate (e.g. 22:1, 10:2, 4:3, 0:4) as programmed on the printer.', 'Press «Test connection»: Lumi asks the printer status.', 'From a sale use «Issue the receipt», or switch «automatic» on to print it when the sale becomes paid.', 'At day end press «Daily closure» or switch on the automatic closure at 23:30.'] },
    es: { nome: 'Impresora fiscal Epson (RT)', descrizione: 'De la venta de Lumi al documento comercial en la impresora fiscal Epson de la tienda, y el cierre diario.', 'imp.indirizzo': 'Dirección de la impresora (p. ej. http://192.168.1.50)', 'imp.dispositivo': 'ID del dispositivo (devid)', 'imp.operatore': 'Operador', 'imp.reparto': 'Departamento predeterminado', 'imp.reparti': 'Departamentos por tipo de IVA (p. ej. 22:1, 10:2, 4:3, 0:4)', 'imp.pagamento': 'Pago si la venta no lo indica', 'imp.automatico': 'Emitir el tique cuando una venta pasa a pagada', 'imp.chiusura': 'Cierre diario automático a las 23:30', 'az.scontrino': 'Emitir el tique', 'az.chiusura': 'Cierre diario', 'giro.chiusura': 'Cierre diario' },
    fr: { nome: 'Imprimante fiscale Epson (RT)', descrizione: 'De la vente Lumi au document commercial sur l\'imprimante fiscale Epson du magasin, et la clôture journalière.', 'imp.indirizzo': 'Adresse de l\'imprimante (ex. http://192.168.1.50)', 'imp.dispositivo': 'ID de l\'appareil (devid)', 'imp.operatore': 'Opérateur', 'imp.reparto': 'Rayon par défaut', 'imp.reparti': 'Rayons par taux de TVA (ex. 22:1, 10:2, 4:3, 0:4)', 'imp.pagamento': 'Paiement si la vente ne le dit pas', 'imp.automatico': 'Émettre le ticket quand une vente devient payée', 'imp.chiusura': 'Clôture journalière automatique à 23h30', 'az.scontrino': 'Émettre le ticket', 'az.chiusura': 'Clôture journalière', 'giro.chiusura': 'Clôture journalière' },
    de: { nome: 'Epson-Fiskaldrucker (RT)', descrizione: 'Vom Lumi-Verkauf zum Handelsbeleg auf dem Epson-Fiskaldrucker des Ladens, dazu der Tagesabschluss.', 'imp.indirizzo': 'Adresse des Druckers (z. B. http://192.168.1.50)', 'imp.dispositivo': 'Geräte-ID (devid)', 'imp.operatore': 'Bediener', 'imp.reparto': 'Standard-Warengruppe', 'imp.reparti': 'Warengruppen nach MwSt.-Satz (z. B. 22:1, 10:2, 4:3, 0:4)', 'imp.pagamento': 'Zahlungsart, wenn der Verkauf keine angibt', 'imp.automatico': 'Beleg ausgeben, wenn ein Verkauf bezahlt wird', 'imp.chiusura': 'Automatischer Tagesabschluss um 23:30', 'az.scontrino': 'Beleg ausgeben', 'az.chiusura': 'Tagesabschluss', 'giro.chiusura': 'Tagesabschluss' },
    pt: { nome: 'Impressora fiscal Epson (RT)', descrizione: 'Da venda do Lumi ao documento comercial na impressora fiscal Epson da loja, e o fechamento diário.', 'imp.indirizzo': 'Endereço da impressora (ex.: http://192.168.1.50)', 'imp.dispositivo': 'ID do dispositivo (devid)', 'imp.operatore': 'Operador', 'imp.reparto': 'Departamento padrão', 'imp.reparti': 'Departamentos por alíquota de IVA (ex.: 22:1, 10:2, 4:3, 0:4)', 'imp.pagamento': 'Pagamento se a venda não indicar', 'imp.automatico': 'Emitir o cupom quando uma venda fica paga', 'imp.chiusura': 'Fechamento diário automático às 23:30', 'az.scontrino': 'Emitir o cupom', 'az.chiusura': 'Fechamento diário', 'giro.chiusura': 'Fechamento diário' },
  },
};
