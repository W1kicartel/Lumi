// Openapi imprese (company.openapi.com): dalla partita IVA italiana ragione sociale, codice fiscale, sede, PEC e codice
// destinatario SDI, i dati che servono per fatturare. GET /IT-advanced/{partita IVA} con il token Bearer di Openapi
// (OAS: https://console.openapi.com/oas/en/company.openapi.json). Per le partite IVA estere si passa al VIES, se è acceso.
import { azioniAziende, testiAziende, RICHIEDE_AZIENDE, PERMESSI_AZIENDE } from '../_soldi/aziende.js';

const base = k => k.base || (k.imp.ambiente === 'produzione' ? 'https://company.openapi.com' : 'https://test.company.openapi.com');
export async function cercaImpresa(k, { paese, numero }) {
  if (paese !== 'IT') throw new Error('Openapi imprese copre le aziende italiane: per le partite IVA estere usa il connettore VIES');
  const r = await k.http.get(`${base(k)}/IT-advanced/${encodeURIComponent(numero)}`, { bearer: k.segreti.token });
  if (r.stato === 404 || (r.ok && !r.json?.data?.length)) return { valida: false };
  if (!r.ok) throw new Error(`Openapi ha risposto ${r.stato}: ${String(r.json?.message || '').slice(0, 200)}`);
  const d = r.json.data[0], sede = d.address?.registeredOffice || {};
  return { valida: d.activityStatus ? d.activityStatus !== 'CESSATA' && !d.cessata : true, attiva: d.activityStatus || null, nome: d.companyName, piva: d.vatCode, codice_fiscale: d.taxCode,
    via: sede.streetName || [sede.toponym, sede.street, sede.streetNumber].filter(Boolean).join(' '), cap: sede.zipCode, comune: sede.town, provincia: sede.province, nazione: 'IT',
    pec: d.pec, codice_destinatario: d.sdiCode, ateco: d.atecoClassification?.ateco2022?.code || d.atecoClassification?.ateco?.code || null };
}

export default {
  id: 'openapi-imprese', nome: 'Openapi imprese', versione: 1, icona: 'documento',
  descrizione: 'Dalla partita IVA: ragione sociale, sede, PEC e codice destinatario dal Registro imprese, per compilare clienti e fornitori.',
  impostazioni: [
    { id: 'token', nome: 'Token Openapi (Bearer) con lo scope «IT-advanced»', segreto: true },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
  ],
  richiede: RICHIEDE_AZIENDE,
  permessi: PERMESSI_AZIENDE,
  // la prova costa una richiesta: si cerca una partita IVA nota (quella di Openapi, pubblica nel loro esempio)
  prova: async k => { const r = await k.http.get(`${base(k)}/IT-advanced/12485671007`, { bearer: k.segreti.token }); return { ok: r.ok, messaggio: r.ok ? null : `HTTP ${r.stato}` }; },
  azioni: azioniAziende('Openapi', cercaImpresa),
  catalogo: {
    categoria: 'dati-aziende', sito: 'https://openapi.com/products/company',
    costo: 'a-consumo', costoNota: 'A consumo: si paga a richiesta, con prezzi diversi per IT-start, IT-advanced, IT-pec e IT-sdicode (pochi centesimi l\'una; listino aggiornato su console.openapi.com). L\'ambiente di prova è gratuito.',
    serve: [{ cosa: 'Token Bearer con lo scope «IT-advanced» (company.openapi.com)', dove: 'console.openapi.com › Token › Crea token: scegli la scadenza e lo scope GET company.openapi.com/IT-advanced', link: 'https://console.openapi.com/' }],
    passi: ['Registrati su console.openapi.com e ricarica il credito (per le prove usa la sandbox).', 'Crea un token con lo scope IT-advanced di company.openapi.com.', 'Incolla il token in Lumi e scegli l\'ambiente.', 'Premi «Prova la connessione» e accendi.', 'Nella scheda di un cliente o di un fornitore usa «Compila dalla partita IVA»: Lumi aggiunge PEC, codice destinatario e sede nei campi vuoti.'],
    difficolta: 'facile', zone: ['IT'],
    fonti: ['https://console.openapi.com/apis/company/documentation', 'https://console.openapi.com/oas/en/company.openapi.json'],
    prova: 'finto', parole: ['openapi', 'registro imprese', 'visura', 'partita iva', 'pec', 'codice destinatario', 'sdi', 'ragione sociale', 'company data', 'business registry'],
  },
  testi: {
    en: { nome: 'Openapi companies', descrizione: 'From the VAT number: company name, address, PEC and SDI recipient code from the Italian business register, to fill customers and suppliers.', 'imp.token': 'Openapi token (Bearer) with the «IT-advanced» scope', 'imp.ambiente': 'Environment', ...testiAziende('Check the VAT number', 'Fill from VAT number', 'customer', 'supplier'),
      'cat.costoNota': 'Pay per use: each request is charged, with different prices for IT-start, IT-advanced, IT-pec and IT-sdicode (a few cents each; current list on console.openapi.com). The sandbox is free.',
      'cat.serve': [{ cosa: 'Bearer token with the «IT-advanced» scope (company.openapi.com)', dove: 'console.openapi.com › Tokens › Create token: pick the expiry and the GET company.openapi.com/IT-advanced scope' }],
      'cat.passi': ['Sign up at console.openapi.com and top up credit (use the sandbox for tests).', 'Create a token with the IT-advanced scope of company.openapi.com.', 'Paste the token into Lumi and pick the environment.', 'Press «Test connection» and switch on.', 'On a customer or supplier use «Fill from VAT number»: Lumi adds PEC, recipient code and address to the empty fields.'] },
    es: { nome: 'Openapi empresas', descrizione: 'Desde el NIF-IVA: razón social, sede, PEC y código destinatario del Registro mercantil italiano, para rellenar clientes y proveedores.', 'imp.token': 'Token de Openapi (Bearer) con el ámbito «IT-advanced»', 'imp.ambiente': 'Entorno', ...testiAziende('Comprobar el NIF-IVA', 'Rellenar desde el NIF-IVA', 'cliente', 'proveedor') },
    fr: { nome: 'Openapi entreprises', descrizione: 'Depuis le n° de TVA : raison sociale, siège, PEC et code destinataire du registre italien des entreprises, pour compléter clients et fournisseurs.', 'imp.token': 'Jeton Openapi (Bearer) avec la portée «IT-advanced»', 'imp.ambiente': 'Environnement', ...testiAziende('Vérifier le n° de TVA', 'Compléter depuis le n° de TVA', 'client', 'fournisseur') },
    de: { nome: 'Openapi Unternehmen', descrizione: 'Aus der USt-IdNr.: Firmenname, Sitz, PEC und SDI-Empfängercode aus dem italienischen Handelsregister, um Kunden und Lieferanten auszufüllen.', 'imp.token': 'Openapi-Token (Bearer) mit dem Scope «IT-advanced»', 'imp.ambiente': 'Umgebung', ...testiAziende('USt-IdNr. prüfen', 'Aus der USt-IdNr. ausfüllen', 'Kunde', 'Lieferant') },
    pt: { nome: 'Openapi empresas', descrizione: 'Pelo número de IVA: razão social, sede, PEC e código destinatário do registro de empresas italiano, para preencher clientes e fornecedores.', 'imp.token': 'Token Openapi (Bearer) com o escopo «IT-advanced»', 'imp.ambiente': 'Ambiente', ...testiAziende('Verificar o número de IVA', 'Preencher pelo número de IVA', 'cliente', 'fornecedor') },
  },
};
