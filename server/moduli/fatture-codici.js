// I codici della FatturaPA che servono alle fatture complete: casse previdenziali, ritenute, causali di pagamento, tipi di
// documento. Fonte di ogni elenco: lo schema ufficiale «Schema_del_file_xml_FatturaPA_v1.2.2.xsd» (fatturapa.gov.it), copiato
// in test/documenti/xsd/fatturapa-locale.xsd; test/fatture.test.mjs controlla che ogni codice qui sia nello schema.
// Il modulo non registra rotte: lo usano documenti-xml.js e fatture.js.

// TipoCassaType (XSD 1.2.2, con la descrizione dello schema accorciata)
export const TIPI_CASSA = {
  TC01: 'Cassa forense (avvocati)', TC02: 'Cassa dottori commercialisti', TC03: 'Cassa geometri', TC04: 'Inarcassa (ingegneri e architetti)',
  TC05: 'Cassa del notariato', TC06: 'Cassa ragionieri e periti commerciali', TC07: 'ENASARCO', TC08: 'ENPACL (consulenti del lavoro)',
  TC09: 'ENPAM (medici)', TC10: 'ENPAF (farmacisti)', TC11: 'ENPAV (veterinari)', TC12: 'ENPAIA (impiegati dell\'agricoltura)',
  TC13: 'Fondo imprese di spedizione e agenzie marittime', TC14: 'INPGI (giornalisti)', TC15: 'ONAOSI (orfani sanitari)', TC16: 'CASAGIT (giornalisti)',
  TC17: 'EPPI (periti industriali)', TC18: 'EPAP (pluricategoriale)', TC19: 'ENPAB (biologi)', TC20: 'ENPAPI (infermieri)', TC21: 'ENPAP (psicologi)', TC22: 'INPS',
};
// TipoRitenutaType (XSD 1.2.2)
export const TIPI_RITENUTA = { RT01: 'Ritenuta persone fisiche', RT02: 'Ritenuta persone giuridiche', RT03: 'Contributo INPS', RT04: 'Contributo ENASARCO', RT05: 'Contributo ENPAM', RT06: 'Altro contributo previdenziale' };
// CausalePagamentoType (XSD 1.2.2): le causali del modello 770 / Certificazione Unica
export const CAUSALI_RITENUTA = ['A', 'B', 'C', 'D', 'E', 'G', 'H', 'I', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'L1', 'M1', 'M2', 'O1', 'V1', 'ZO'];
// TipoDocumentoType (XSD 1.2.2): quelli che Lumi emette. TD29 non c'è nello schema 1.2.2 che validiamo: si aggiungerà con lo schema nuovo.
export const TIPI_DOCUMENTO = {
  TD01: 'Fattura', TD02: 'Acconto o anticipo su fattura', TD03: 'Acconto o anticipo su parcella', TD04: 'Nota di credito', TD05: 'Nota di debito', TD06: 'Parcella',
  TD16: 'Integrazione reverse charge interno', TD17: 'Integrazione/autofattura servizi dall\'estero', TD18: 'Integrazione beni intracomunitari',
  TD19: 'Integrazione/autofattura beni art. 17 c. 2', TD24: 'Fattura differita (DDT)',
};
// le autofatture e integrazioni: il cedente è il fornitore, il cessionario sei tu (specifiche tecniche FatturaPA, tipi TD16-TD19)
export const AUTOFATTURE = ['TD16', 'TD17', 'TD18', 'TD19'];
// quale integrazione fare per una fattura ricevuta: servizi esteri TD17, beni UE TD18, beni extra UE già in Italia TD19,
// reverse charge interno (N6.x da fornitore italiano) TD16. Fonte: Agenzia delle Entrate, «Guida alla compilazione delle
// fatture elettroniche e dell'esterometro», tabella dei tipi documento TD16-TD19.
export function tipoIntegrazione({ nazione = 'IT', beni = false, ue = true } = {}) {
  if (nazione === 'IT') return 'TD16';
  if (!beni) return 'TD17';
  return ue ? 'TD18' : 'TD19';
}
// i paesi dell'Unione europea (codici ISO a 2 lettere, più EL con cui la Grecia scrive la partita IVA), per scegliere fra TD18 e TD19
export const PAESI_UE = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];

// l'IVA del contributo della cassa: quella scritta, altrimenti quella della prima riga con l'IVA (o la natura della prima senza)
export function aliquotaCassa(f) {
  // con l'IVA della cassa a 0 (forfettario, prestazioni esenti) la natura è quella delle righe senza IVA: il modello non ha un campo apposta
  const senza = (f.righe || []).find(x => !Number(x.aliquota) && x.natura && x.natura !== 'N1');
  if (f.cassa_iva != null && f.cassa_iva !== '') return { aliquotaIva: Number(f.cassa_iva), natura: Number(f.cassa_iva) ? null : f.cassa_natura || senza?.natura || null };
  const r = (f.righe || []).find(x => Number(x.aliquota)) || senza;
  return r ? { aliquotaIva: Number(r.aliquota) || 0, natura: Number(r.aliquota) ? null : r.natura } : { aliquotaIva: 0, natura: f.cassa_natura || null };
}
