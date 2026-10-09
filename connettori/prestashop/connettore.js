// PrestaShop: articoli (anche le combinazioni con un codice) e giacenze nei due sensi, ordini pagati → vendite.
// Webservice (https://devdocs.prestashop-project.org/9/webservice/): la chiave fa da utente in Basic (password vuota),
// le risposte in JSON con output_format=JSON, la scrittura solo in XML (PUT con l'oggetto intero). Pagine con
// limit=<inizio>,<quanti>; filtri a intervallo filter[campo]=[a,b] (con date=1 sulle date). PrestaShop non manda webhook:
// gli ordini si leggono ogni 10 minuti dalla data di modifica, e lo stato decide se sono pagati (2, 3, 4, 5, 11 di serie).
// Il prezzo del prodotto è senza IVA: Kubo lo porta ivato con l'aliquota delle impostazioni.
import { documento, elemento } from '../_negozi/xml.js';
import { importaOrdine, tondo, RICHIEDE_NEGOZI, PERMESSI_NEGOZI } from '../_negozi/comune.js';

const radice = k => (k.base || k.imp.url || '').replace(/\/$/, '').replace(/\/api$/, '');
const api = (k, p, q = {}) => { const u = new URL(`${radice(k)}/api/${p}`); u.searchParams.set('output_format', 'JSON'); for (const [a, b] of Object.entries(q)) u.searchParams.set(a, b); return u.href; };
const chiave = k => ({ basic: [k.segreti.chiave, ''] });
async function leggi(k, p, q) {
  const r = await k.http.get(api(k, p, q), chiave(k));
  if (!r.ok) throw new Error(`PrestaShop ha risposto ${r.stato}${elemento(r.testo, 'message') ? ': ' + elemento(r.testo, 'message') : r.json?.errors ? ': ' + r.json.errors.map(e => e.message).join('; ') : ''}`);
  return r.json;
}
// tutte le pagine di una risorsa (PrestaShop risponde [] quando non trova niente)
async function* tutte(k, risorsa, q, quanti = 100) {
  for (let da = 0; da < 1e6; da += quanti) {
    const l = (await leggi(k, risorsa, { ...q, limit: `${da},${quanti}` }))?.[risorsa] || [];
    if (l.length) yield l;
    if (l.length < quanti) return;
  }
}
// i campi multilingua arrivano come [{ id, value }] (o come testo con language=)
const testo = (v, lingua) => Array.isArray(v) ? (v.find(x => String(x.id) === String(lingua)) || v[0])?.value ?? '' : v ?? '';
const ivato = (k, p) => tondo(Number(p || 0) * (1 + Number(k.imp.iva ?? 22) / 100));

export default {
  id: 'prestashop', nome: 'PrestaShop', versione: 1, icona: 'scatola',
  descrizione: 'Il negozio PrestaShop: catalogo e giacenze in comune, gli ordini pagati diventano vendite.',
  impostazioni: [
    { id: 'url', nome: 'Indirizzo del negozio (https://…)', tipo: 'url' },
    { id: 'chiave', nome: 'Chiave del Webservice', segreto: true, aiuto: 'Parametri avanzati › Webservice › Aggiungi nuova chiave' },
    { id: 'lingua', nome: 'Lingua dei nomi (id)', tipo: 'numero', predefinito: 1 },
    { id: 'iva', nome: 'IVA da aggiungere ai prezzi (%)', tipo: 'numero', predefinito: 22 },
    { id: 'stati', nome: 'Stati degli ordini pagati (id)', predefinito: '2,3,4,5,11', schema: /^\d+(\s*,\s*\d+)*$/ },
  ],
  richiede: RICHIEDE_NEGOZI,
  permessi: PERMESSI_NEGOZI,
  prova: async k => { const r = await k.http.get(api(k, ''), chiave(k)); return { ok: r.ok, messaggio: r.ok ? null : r.stato === 401 ? 'Chiave non valida o Webservice spento' : `HTTP ${r.stato}` }; },
  mappe: { articoli: { id: 'id', chiave: ['codice', 'codice'], campi: [
    { kubo: 'nome', remoto: 'nome' }, { kubo: 'prezzo', remoto: 'prezzo' }, { kubo: 'giacenza', remoto: 'giacenza', comanda: 'kubo' },
  ] } },
  pianificati: {
    prodotti: { nome: 'Prodotti dal negozio', ogni: '15m', async giro(k) {
      const scorte = new Map(), prodotti = new Map(), tot = { creati: 0, aggiornati: 0, uguali: 0 };
      for await (const l of tutte(k, 'stock_availables', { display: '[id,id_product,id_product_attribute,quantity]' }, 500))
        for (const s of l) scorte.set(`${s.id_product}-${s.id_product_attribute}`, Number(s.quantity) || 0);
      for await (const l of tutte(k, 'products', { display: '[id,reference,price,name]' })) {
        for (const p of l) prodotti.set(String(p.id), p);
        const r = await k.sincro.daRemoto('articoli', l.filter(p => p.reference).map(p => ({ id: String(p.id), codice: p.reference, nome: testo(p.name, k.imp.lingua),
          prezzo: ivato(k, p.price), giacenza: scorte.get(`${p.id}-0`) ?? 0 })));
        for (const x in tot) tot[x] += r[x];
      }
      // le combinazioni (taglia, colore…) con un loro codice sono articoli a sé: id «prodotto-combinazione»
      for await (const l of tutte(k, 'combinations', { display: '[id,id_product,reference,price]' })) {
        const r = await k.sincro.daRemoto('articoli', l.filter(c => c.reference).map(c => { const p = prodotti.get(String(c.id_product)) || {};
          return { id: `${c.id_product}-${c.id}`, codice: c.reference, nome: testo(p.name, k.imp.lingua), prezzo: ivato(k, Number(p.price || 0) + Number(c.price || 0)), giacenza: scorte.get(`${c.id_product}-${c.id}`) ?? 0 }; }));
        for (const x in tot) tot[x] += r[x];
      }
      return tot;
    } },
    ordini: { nome: 'Ordini dal negozio', ogni: '10m', async giro(k) {
      const stati = new Set(String(k.imp.stati || '2,3,4,5,11').split(',').map(s => s.trim()));
      const da = k.stato.leggi('ordini') || new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19).replace('T', ' ');
      let ultimo = da; const conti = { vendite: 0, ignorati: 0 };
      for await (const l of tutte(k, 'orders', { display: 'full', date: '1', 'filter[date_upd]': `[${da},2999-12-31 23:59:59]`, sort: '[date_upd_ASC]' }, 50)) {
        for (const o of l) {
          if (o.date_upd > ultimo) ultimo = o.date_upd;
          if (!stati.has(String(o.current_state))) { conti.ignorati++; continue; }
          let cli = null;
          if (!k.sincro.locale('vendite', o.id)) try {
            const c = (await leggi(k, `customers/${o.id_customer}`))?.customer, a = (await leggi(k, `addresses/${o.id_address_delivery}`))?.address;
            cli = { nome: [c?.firstname, c?.lastname].filter(Boolean).join(' '), email: c?.email, telefono: a?.phone_mobile || a?.phone, via: a?.address1, cap: a?.postcode, comune: a?.city };
          } catch { cli = null; }
          const righe = o.associations?.order_rows || [];
          const e = importaOrdine(k, { id: o.id, numero: o.reference, canale: 'PrestaShop', cliente: cli,
            linee: righe.map(x => ({ sku: x.product_reference, nome: x.product_name, q: x.product_quantity, prezzo: x.unit_price_tax_incl })) });
          if (e === 'vendita creata') conti.vendite++; else conti.ignorati++;
        }
      }
      k.stato.scrivi('ordini', ultimo);
      return conti;
    } },
  },
  uscita: { articoli: { campi: ['giacenza'], unisci: 'ultimo', async invia(riga, k) {
    const rid = k.sincro.remoto('articoli', riga.id); if (!rid) return;
    const [prodotto, comb = '0'] = String(rid).split('-');
    const s = (await leggi(k, 'stock_availables', { display: 'full', 'filter[id_product]': `[${prodotto}]`, 'filter[id_product_attribute]': `[${comb}]` }))?.stock_availables?.[0];
    if (!s) throw new Error(`Scorta del prodotto ${rid} non trovata in PrestaShop`);
    // il Webservice vuole l'oggetto intero, in XML
    const corpo = documento({ stock_available: { ...s, quantity: Math.max(0, Math.round(Number(k.valore(riga, 'articoli', 'giacenza') || 0))) } });
    const r = await k.http.put(api(k, `stock_availables/${s.id}`), { ...chiave(k), testo: corpo, intestazioni: { 'Content-Type': 'application/xml' } });
    if (!r.ok) throw new Error(`PrestaShop ha risposto ${r.stato}${elemento(r.testo, 'message') ? ': ' + elemento(r.testo, 'message') : ''}`);
  } } },
  catalogo: {
    categoria: 'negozi-online', sito: 'https://prestashop.com', costo: 'gratis',
    costoNota: 'PrestaShop è open source e gratuito; paghi solo l\'hosting e gli eventuali moduli. Il Webservice è incluso.',
    serve: [
      { cosa: 'Chiave del Webservice (32 caratteri) con i permessi su products, combinations, stock_availables, orders, customers, addresses', dove: 'Back office › Parametri avanzati › Webservice › Aggiungi nuova chiave', link: 'https://devdocs.prestashop-project.org/9/webservice/tutorials/creating-access/' },
    ],
    passi: [
      'Nel back office apri Parametri avanzati › Webservice e attiva «Abilita il Webservice di PrestaShop».',
      'Clicca «Aggiungi nuova chiave», genera la chiave e spunta GET e PUT per stock_availables, GET per products, combinations, orders, customers e addresses.',
      'In Kubo incolla l\'indirizzo del negozio e la chiave, poi premi «Prova la connessione».',
      'Controlla l\'aliquota IVA e gli stati degli ordini pagati (di serie 2, 3, 4, 5, 11).',
      'Accendi il connettore e premi «Sincronizza ora» su «Prodotti dal negozio»: gli articoli si abbinano per riferimento (codice).',
      'Se la prova risponde 401 su un hosting in CGI, attiva l\'inoltro dell\'intestazione Authorization nel file .htaccess.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://devdocs.prestashop-project.org/9/webservice/', 'https://devdocs.prestashop-project.org/9/webservice/tutorials/advanced-use/additional-list-parameters/', 'https://devdocs.prestashop-project.org/9/webservice/resources/stock_availables/'],
    prova: 'finto', parole: ['prestashop', 'negozio online', 'ecommerce', 'webservice', 'giacenze', 'ordini', 'online shop', 'stock'],
  },
  testi: {
    en: { descrizione: 'The PrestaShop store: shared catalogue and stock, paid orders become sales.', 'imp.url': 'Store address (https://…)', 'imp.chiave': 'Webservice key', 'aiuto.chiave': 'Advanced Parameters › Webservice › Add new key', 'imp.lingua': 'Language of the names (id)', 'imp.iva': 'VAT to add to prices (%)', 'imp.stati': 'Paid order states (ids)', 'giro.prodotti': 'Products from the store', 'giro.ordini': 'Orders from the store',
      'cat.costoNota': 'PrestaShop is open source and free; you only pay for hosting and any modules. The Webservice is included.',
      'cat.serve': [{ cosa: 'Webservice key (32 characters) with permissions on products, combinations, stock_availables, orders, customers, addresses', dove: 'Back office › Advanced Parameters › Webservice › Add new key' }],
      'cat.passi': ['In the back office open Advanced Parameters › Webservice and enable the PrestaShop Webservice.', 'Click «Add new key», generate it and tick GET and PUT for stock_availables, GET for products, combinations, orders, customers and addresses.', 'In Kubo paste the store address and the key, then press «Test connection».', 'Check the VAT rate and the paid order states (2, 3, 4, 5, 11 by default).', 'Switch the connector on and press «Sync now» on «Products from the store»: items match by reference (code).', 'If the test answers 401 on CGI hosting, forward the Authorization header in .htaccess.'] },
    es: { descrizione: 'La tienda PrestaShop: catálogo y existencias en común, los pedidos pagados pasan a ventas.', 'imp.url': 'Dirección de la tienda (https://…)', 'imp.chiave': 'Clave del Webservice', 'aiuto.chiave': 'Parámetros avanzados › Webservice › Añadir nueva clave', 'imp.lingua': 'Idioma de los nombres (id)', 'imp.iva': 'IVA que añadir a los precios (%)', 'imp.stati': 'Estados de pedido pagado (ids)', 'giro.prodotti': 'Productos de la tienda', 'giro.ordini': 'Pedidos de la tienda' },
    fr: { descrizione: 'La boutique PrestaShop : catalogue et stock partagés, les commandes payées deviennent des ventes.', 'imp.url': 'Adresse de la boutique (https://…)', 'imp.chiave': 'Clé du Webservice', 'aiuto.chiave': 'Paramètres avancés › Webservice › Ajouter une clé', 'imp.lingua': 'Langue des noms (id)', 'imp.iva': 'TVA à ajouter aux prix (%)', 'imp.stati': 'États de commande payée (ids)', 'giro.prodotti': 'Produits de la boutique', 'giro.ordini': 'Commandes de la boutique' },
    de: { descrizione: 'Der PrestaShop-Shop: gemeinsamer Katalog und Bestand, bezahlte Bestellungen werden Verkäufe.', 'imp.url': 'Adresse des Shops (https://…)', 'imp.chiave': 'Webservice-Schlüssel', 'aiuto.chiave': 'Erweiterte Einstellungen › Webservice › Neuen Schlüssel hinzufügen', 'imp.lingua': 'Sprache der Namen (ID)', 'imp.iva': 'MwSt. auf die Preise (%)', 'imp.stati': 'Status bezahlter Bestellungen (IDs)', 'giro.prodotti': 'Produkte aus dem Shop', 'giro.ordini': 'Bestellungen aus dem Shop' },
    pt: { descrizione: 'A loja PrestaShop: catálogo e estoque em comum, os pedidos pagos viram vendas.', 'imp.url': 'Endereço da loja (https://…)', 'imp.chiave': 'Chave do Webservice', 'aiuto.chiave': 'Parâmetros avançados › Webservice › Adicionar nova chave', 'imp.lingua': 'Idioma dos nomes (id)', 'imp.iva': 'IVA a somar aos preços (%)', 'imp.stati': 'Estados de pedido pago (ids)', 'giro.prodotti': 'Produtos da loja', 'giro.ordini': 'Pedidos da loja' },
  },
};
