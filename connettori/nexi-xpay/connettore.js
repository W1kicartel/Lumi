// Nexi XPay (il POS virtuale delle banche italiane), «Pagamento semplice»: il link porta il cliente alla pagina di
// pagamento Nexi con alias, importo in centesimi, codTrans e il MAC = SHA1("codTrans=…divisa=…importo=…" + chiave segreta).
// L'esito torna a Kubo due volte: in POST server-to-server su «urlpost» e in GET sul ritorno del cliente («url»), con
// MAC = SHA1("codTrans=…esito=…importo=…divisa=…data=…orario=…codAut=…" + chiave). Si crede solo a un MAC giusto.
// codTrans è unico per tentativo: Kubo ricorda quale vendita o fattura c'è dietro (stato «aperti»).
import { createHash, randomBytes } from 'node:crypto';
import { azioniLink, testiLink, incassa, RICHIEDE_INCASSI, PERMESSI_INCASSI } from '../_soldi/comuni.js';
import { stessoSegreto } from '../../server/moduli/connettori-rete.js';

const sha1 = s => createHash('sha1').update(s, 'utf8').digest('hex');
const base = k => k.base || (k.imp.ambiente === 'produzione' ? 'https://ecommerce.nexi.it' : 'https://int-ecommerce.nexi.it');
export const macAvvio = (p, chiave) => sha1(`codTrans=${p.codTrans}divisa=${p.divisa}importo=${p.importo}${chiave}`);
export const macEsito = (p, chiave) => sha1(`codTrans=${p.codTrans ?? ''}esito=${p.esito ?? ''}importo=${p.importo ?? ''}divisa=${p.divisa ?? ''}data=${p.data ?? ''}orario=${p.orario ?? ''}codAut=${p.codAut ?? ''}${chiave}`);
const macGiusto = (p, chiave) => !!p?.mac && !!chiave && stessoSegreto(String(p.mac).toLowerCase(), macEsito(p, chiave));
const pubblico = k => String(k.imp.indirizzo || '').replace(/\/$/, '');

// un esito con il MAC giusto: OK → incasso della riga dietro il codTrans
async function esito(k, p) {
  if (p.esito !== 'OK') return `ignorato: esito ${p.esito}`;
  const aperti = k.stato.leggi('aperti') || [], x = aperti.find(a => a.codTrans === p.codTrans);
  if (!x) return k.avvisa(`esito OK per un codice transazione sconosciuto (${String(p.codTrans).slice(0, 40)})`);
  const quando = /^\d{8}$/.test(p.data || '') ? Date.parse(`${p.data.slice(0, 4)}-${p.data.slice(4, 6)}-${p.data.slice(6, 8)}T12:00:00Z`) : Date.now();
  const e = await incassa(k, x.rif, { importo: Number(p.importo) / 100, valuta: p.divisa, quando, metodo: 'carta' });
  k.stato.scrivi('aperti', aperti.filter(a => a.codTrans !== p.codTrans));
  return e;
}

export default {
  id: 'nexi-xpay', nome: 'Nexi XPay', versione: 1, icona: 'cassa',
  descrizione: 'Link di pagamento sulla pagina sicura Nexi XPay (il POS virtuale della banca): l\'esito con il MAC segna pagate vendite e fatture.',
  impostazioni: [
    { id: 'alias', nome: 'Alias del terminale (es. ALIAS_WEB_00012345)', schema: /^[\w-]{3,40}$/ },
    { id: 'chiave', nome: 'Chiave segreta per il calcolo del MAC', segreto: true },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (https, per ricevere l\'esito)', schema: /^https:\/\/[^\s]+$/ },
  ],
  richiede: RICHIEDE_INCASSI,
  permessi: PERMESSI_INCASSI,
  azioni: azioniLink('Nexi', async (k, { cent, rif, descrizione }) => {
    if (!k.imp.alias || !k.segreti.chiave) throw new Error('Mancano alias e chiave MAC');
    if (!pubblico(k)) throw new Error('Serve l\'indirizzo pubblico di Kubo: Nexi manda lì l\'esito');
    const codTrans = `K${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
    const ritorno = `${pubblico(k)}/api/connettori/nexi-xpay/pub/esito`;
    const p = { alias: k.imp.alias, importo: String(cent), divisa: 'EUR', codTrans, url: ritorno, url_back: ritorno, urlpost: `${pubblico(k)}/api/connettori/nexi-xpay/in`, descrizione: descrizione.slice(0, 2000) };
    p.mac = macAvvio(p, k.segreti.chiave);
    k.stato.scrivi('aperti', [...(k.stato.leggi('aperti') || []), { codTrans, rif, creato: Date.now() }].filter(a => Date.now() - a.creato < 30 * 864e5).slice(-1000));
    return { url: `${base(k)}/ecomm/ecomm/DispatcherServlet?${new URLSearchParams(p)}`, id: codTrans };
  }),
  // l'esito server-to-server (urlpost): form-urlencoded con il MAC
  entrata: {
    firma: { tipo: 'mac', segreto: 'chiave', verifica: ({ grezzo, segreto }) => macGiusto(Object.fromEntries(new URLSearchParams(grezzo.toString('utf8'))), segreto) },
    idempotenza: ev => `${ev?.codTrans}:${ev?.esito}`,
    gestisci: (ev, k) => esito(k, ev),
  },
  // il ritorno del cliente: stessi parametri in GET, pagina di cortesia
  pubbliche: {
    async esito({ q, k }) {
      const p = Object.fromEntries(q), ok = macGiusto(p, k.segreti.chiave);
      if (ok) k.annota('entrata', 'ok', `ritorno ${String(p.codTrans).slice(0, 40)}`, await esito(k, p));
      const t = ok && p.esito === 'OK' ? 'Pagamento ricevuto, grazie!' : 'Il pagamento non è andato a buon fine.';
      return { tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${t}</title><p style="font:18px system-ui;margin:3em auto;max-width:30em;text-align:center">${t}</p>` };
    },
  },
  catalogo: {
    categoria: 'pagamenti', sito: 'https://www.nexi.it/it/negozi-online',
    costo: 'contratto', costoNota: 'Le commissioni dipendono dal contratto con Nexi o con la tua banca (XPay è incluso nei pacchetti e-commerce Nexi; le offerte standard partono da un canone mensile più una percentuale per transazione). Kubo non aggiunge costi.',
    serve: [
      { cosa: 'Alias del terminale e chiave segreta per il calcolo del MAC (Pagamento semplice)', dove: 'Back office Nexi XPay › Admin › Chiavi e alias (in prova: le credenziali dell\'ambiente di test che manda Nexi)', link: 'https://ecommerce.nexi.it/area-riservata' },
      { cosa: 'Un indirizzo pubblico https di Kubo', dove: 'Il tuo dominio o un tunnel verso il computer di Kubo', link: 'https://ecommerce.nexi.it/specifiche-tecniche/' },
    ],
    passi: ['Chiedi a Nexi (o alla tua banca) l\'attivazione di XPay per il commercio elettronico.', 'Nel back office XPay copia alias e chiave MAC (prima quelli di test).', 'In Kubo incolla alias e chiave, scegli l\'ambiente e scrivi l\'indirizzo pubblico https di Kubo.', 'Accendi il connettore.', 'Dalla vendita o dalla fattura crea il link: il cliente paga sulla pagina Nexi e Kubo riceve l\'esito.'],
    difficolta: 'media', zone: ['IT'],
    fonti: ['https://ecommerce.nexi.it/specifiche-tecniche/codicebase/pagamentosemplice.html', 'https://ecommerce.nexi.it/sites/default/files/specifichetecniche.NEXI.20.4.pdf'],
    prova: 'finto', parole: ['nexi', 'xpay', 'cartasi', 'pos virtuale', 'banca', 'carta di credito', 'pay by link', 'link di pagamento', 'virtual pos', 'mac'],
  },
  testi: {
    en: { descrizione: 'Payment links on the secure Nexi XPay page (the bank\'s virtual POS): the outcome with its MAC marks sales and invoices paid.', 'imp.alias': 'Terminal alias (e.g. ALIAS_WEB_00012345)', 'imp.chiave': 'Secret key for the MAC', 'imp.ambiente': 'Environment', 'imp.indirizzo': 'Public Kubo address (https, to receive the outcome)', ...testiLink('Payment link', 'sale', 'invoice'),
      'cat.costoNota': 'Fees depend on your contract with Nexi or your bank (XPay comes with the Nexi e-commerce packages; standard offers start with a monthly fee plus a percentage per transaction). Kubo adds no costs.',
      'cat.serve': [{ cosa: 'Terminal alias and secret MAC key (Simple payment)', dove: 'Nexi XPay back office › Admin › Keys and aliases (for tests: the test credentials Nexi sends)' }, { cosa: 'A public https address for Kubo', dove: 'Your domain or a tunnel to the Kubo computer' }],
      'cat.passi': ['Ask Nexi (or your bank) to enable XPay for e-commerce.', 'Copy alias and MAC key from the XPay back office (test ones first).', 'Paste alias and key into Kubo, pick the environment and enter Kubo\'s public https address.', 'Switch the connector on.', 'Create the link from the sale or invoice: the customer pays on the Nexi page and Kubo receives the outcome.'] },
    es: { descrizione: 'Enlaces de pago en la página segura de Nexi XPay (el TPV virtual del banco): el resultado con su MAC marca pagadas ventas y facturas.', 'imp.alias': 'Alias del terminal (p. ej. ALIAS_WEB_00012345)', 'imp.chiave': 'Clave secreta para el MAC', 'imp.ambiente': 'Entorno', 'imp.indirizzo': 'Dirección pública de Kubo (https, para recibir el resultado)', ...testiLink('Enlace de pago', 'venta', 'factura') },
    fr: { descrizione: 'Liens de paiement sur la page sécurisée Nexi XPay (le TPE virtuel de la banque) : le résultat avec son MAC marque ventes et factures payées.', 'imp.alias': 'Alias du terminal (ex. ALIAS_WEB_00012345)', 'imp.chiave': 'Clé secrète pour le MAC', 'imp.ambiente': 'Environnement', 'imp.indirizzo': 'Adresse publique de Kubo (https, pour recevoir le résultat)', ...testiLink('Lien de paiement', 'vente', 'facture') },
    de: { descrizione: 'Zahlungslinks auf der sicheren Nexi-XPay-Seite (das virtuelle Terminal der Bank): das Ergebnis mit MAC markiert Verkäufe und Rechnungen als bezahlt.', 'imp.alias': 'Terminal-Alias (z. B. ALIAS_WEB_00012345)', 'imp.chiave': 'Geheimer Schlüssel für den MAC', 'imp.ambiente': 'Umgebung', 'imp.indirizzo': 'Öffentliche Kubo-Adresse (https, für das Ergebnis)', ...testiLink('Zahlungslink', 'Verkauf', 'Rechnung') },
    pt: { descrizione: 'Links de pagamento na página segura Nexi XPay (o POS virtual do banco): o resultado com o MAC marca vendas e faturas como pagas.', 'imp.alias': 'Alias do terminal (ex.: ALIAS_WEB_00012345)', 'imp.chiave': 'Chave secreta para o MAC', 'imp.ambiente': 'Ambiente', 'imp.indirizzo': 'Endereço público do Kubo (https, para receber o resultado)', ...testiLink('Link de pagamento', 'venda', 'fatura') },
  },
};
