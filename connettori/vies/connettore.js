// VIES: il controllo delle partite IVA europee della Commissione UE, gratis e senza chiave. Dice se la partita IVA è attiva
// per le operazioni intracomunitarie e, per molti Paesi (Italia compresa), dà ragione sociale e indirizzo.
// REST: GET /rest-api/ms/{paese}/vat/{numero} → { isValid, name, address, userError, requestDate }
// (https://ec.europa.eu/taxation_customs/vies/#/technical-information). «---» vuol dire «dato non fornito dal Paese».
import { azioniAziende, testiAziende, indirizzoIt, RICHIEDE_AZIENDE, PERMESSI_AZIENDE } from '../_soldi/aziende.js';

const pieno = s => (s && s.trim() !== '---' ? s.trim() : null);
export async function cercaVies(k, { paese, numero }) {
  const r = await k.http.get(`${k.base}/rest-api/ms/${encodeURIComponent(paese)}/vat/${encodeURIComponent(numero)}`);
  if (!r.ok) throw new Error(`VIES ha risposto ${r.stato}`);
  const j = r.json || {};
  // MS_UNAVAILABLE, TIMEOUT…: il servizio del Paese è giù, non vuol dire che la partita IVA sia falsa
  if (j.userError && !['VALID', 'INVALID'].includes(j.userError)) throw new Error(`VIES non risponde per ${paese} (${j.userError}): riprova più tardi`);
  if (!j.isValid) return { valida: false };
  const ind = paese === 'IT' ? indirizzoIt(pieno(j.address)) : { via: pieno(j.address)?.replace(/\n+/g, ', ') };
  return { valida: true, nome: pieno(j.name), piva: `${paese}${numero}`.replace(/^IT/, ''), nazione: paese === 'EL' ? 'GR' : paese, ...ind, data: j.requestDate };
}

export default {
  id: 'vies', nome: 'VIES (partite IVA UE)', versione: 1, icona: 'documento', base: 'https://ec.europa.eu/taxation_customs/vies',
  descrizione: 'Controlla le partite IVA europee e compila clienti e fornitori con ragione sociale e indirizzo. Gratis, senza chiave.',
  impostazioni: [],
  richiede: RICHIEDE_AZIENDE,
  permessi: PERMESSI_AZIENDE,
  prova: async k => { const r = await k.http.get(`${k.base}/rest-api/check-status`); return { ok: r.ok, messaggio: r.ok ? null : `HTTP ${r.stato}` }; },
  azioni: azioniAziende('VIES', cercaVies),
  catalogo: {
    categoria: 'dati-aziende', sito: 'https://ec.europa.eu/taxation_customs/vies/',
    costo: 'gratis', costoNota: 'Gratis: è il servizio pubblico della Commissione europea. Non serve nessuna chiave.',
    serve: [{ cosa: 'Niente: il servizio è pubblico', dove: '—', link: 'https://ec.europa.eu/taxation_customs/vies/' }],
    passi: ['Accendi il connettore: non chiede chiavi.', 'Nella scheda di un cliente o di un fornitore con la partita IVA usa «Compila dalla partita IVA».', 'Kubo mostra cosa aggiungerà (solo i campi vuoti) e aspetta la conferma.', 'Chiedi a Lumi «controlla la partita IVA 01234567890» per una verifica al volo.'],
    difficolta: 'facile', zone: ['IT', 'UE'],
    fonti: ['https://ec.europa.eu/taxation_customs/vies/#/technical-information', 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/IT/vat/00000000000'],
    prova: 'finto', parole: ['vies', 'partita iva', 'p.iva', 'vat', 'vat number', 'intracomunitario', 'ragione sociale', 'verifica', 'eu vat check'],
  },
  testi: {
    en: { nome: 'VIES (EU VAT numbers)', descrizione: 'Checks EU VAT numbers and fills customers and suppliers with company name and address. Free, no key.', ...testiAziende('Check the VAT number', 'Fill from VAT number', 'customer', 'supplier'),
      'cat.costoNota': 'Free: it is the public service of the European Commission. No key needed.',
      'cat.serve': [{ cosa: 'Nothing: the service is public', dove: '—' }],
      'cat.passi': ['Switch the connector on: it asks for no keys.', 'On a customer or supplier with a VAT number use «Fill from VAT number».', 'Kubo shows what it will add (only empty fields) and waits for confirmation.', 'Ask Lumi «check VAT number 01234567890» for a quick check.'] },
    es: { nome: 'VIES (NIF-IVA UE)', descrizione: 'Comprueba los NIF-IVA europeos y rellena clientes y proveedores con razón social y dirección. Gratis, sin clave.', ...testiAziende('Comprobar el NIF-IVA', 'Rellenar desde el NIF-IVA', 'cliente', 'proveedor') },
    fr: { nome: 'VIES (TVA intracom.)', descrizione: 'Vérifie les numéros de TVA européens et complète clients et fournisseurs avec raison sociale et adresse. Gratuit, sans clé.', ...testiAziende('Vérifier le n° de TVA', 'Compléter depuis le n° de TVA', 'client', 'fournisseur') },
    de: { nome: 'VIES (USt-IdNr. EU)', descrizione: 'Prüft europäische USt-IdNr. und ergänzt Kunden und Lieferanten mit Firmenname und Adresse. Kostenlos, ohne Schlüssel.', ...testiAziende('USt-IdNr. prüfen', 'Aus der USt-IdNr. ausfüllen', 'Kunde', 'Lieferant') },
    pt: { nome: 'VIES (NIF-IVA UE)', descrizione: 'Verifica os números de IVA europeus e preenche clientes e fornecedores com razão social e endereço. Grátis, sem chave.', ...testiAziende('Verificar o número de IVA', 'Preencher pelo número de IVA', 'cliente', 'fornecedor') },
  },
};
