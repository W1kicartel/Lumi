// PROVA (ramo prova-documenti, non per main): il file FatturaPA di Kubo contro lo schema XSD UFFICIALE 1.2.2
// (scaricato da www.fatturapa.gov.it, import di xmldsig reso locale) e contro i controlli di coerenza che lo SDI fa
// dopo lo schema (codici 00411, 00417, 00419, 00421, 00422, 00423, 00427, 00429, 00430 delle specifiche tecniche).
// I test «todo» descrivono cosa servirebbe per legge e Kubo non fa ancora: falliscono senza far fallire la suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { xml, controlla, contiFattura } from '../server/moduli/documenti-xml.js';

const QUI = dirname(fileURLToPath(import.meta.url));
const XSD = join(QUI, 'documenti', 'xsd', 'fatturapa-locale.xsd');
const CARTELLA = mkdtempSync(join(tmpdir(), 'kubo-xsd-'));
export const USCITA = process.env.KUBO_PROVA_XML || CARTELLA;   // dove restano i file generati, per guardarli

function valida(nome, testo) {
  const f = join(USCITA, nome); writeFileSync(f, testo);
  try { execFileSync('xmllint', ['--noout', '--nonet', '--schema', XSD, f], { stdio: 'pipe' }); return { ok: true, f }; }
  catch (e) { return { ok: false, f, errore: String(e.stderr || e.message) }; }
}

// ---------- i controlli dello SDI dopo lo schema (versione ridotta, sugli elementi che Kubo scrive) ----------
const blocchi = (x, tag) => [...x.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1]);
const val = (x, tag) => x.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];
const n = s => Number(s);
export function controlliSdi(x) {
  const e = [], linee = blocchi(x, 'DettaglioLinee'), riep = blocchi(x, 'DatiRiepilogo');
  const formato = x.match(/versione="(FP[AR]12)"/)?.[1], cod = val(x, 'CodiceDestinatario');
  if (formato === 'FPR12' && cod?.length !== 7) e.push(`00427 CodiceDestinatario «${cod}» di ${cod?.length} caratteri con FPR12`);
  if (formato === 'FPA12' && cod?.length !== 6) e.push(`00427 CodiceDestinatario «${cod}» con FPA12`);
  const cess = blocchi(x, 'CessionarioCommittente')[0] || '';
  if (/<IdPaese>IT<\/IdPaese>/.test(cess) || /<Nazione>IT<\/Nazione>/.test(cess)) if (!/<IdFiscaleIVA>|<CodiceFiscale>/.test(cess)) e.push('00417 cessionario italiano senza P.IVA né CF');
  const gruppi = new Map();
  for (const l of linee) {
    const pu = n(val(l, 'PrezzoUnitario')), q = n(val(l, 'Quantita') ?? 1), pt = n(val(l, 'PrezzoTotale')), al = n(val(l, 'AliquotaIVA')), nat = val(l, 'Natura') || '';
    let prezzo = pu; for (const s of blocchi(l, 'ScontoMaggiorazione')) { const p = n(val(s, 'Percentuale')); prezzo = prezzo * (1 + (val(s, 'Tipo') === 'MG' ? p : -p) / 100); }
    if (Math.abs(prezzo * q - pt) > 0.01 + 1e-9) e.push(`00423 riga ${val(l, 'NumeroLinea')}: PrezzoTotale ${pt} ≠ ${(prezzo * q).toFixed(4)}`);
    if (al === 0 && !nat) e.push(`00400 riga ${val(l, 'NumeroLinea')}: aliquota 0 senza Natura`);
    if (al !== 0 && nat) e.push(`00401 riga ${val(l, 'NumeroLinea')}: aliquota e Natura insieme`);
    const k = `${al}|${nat}`; gruppi.set(k, (gruppi.get(k) || 0) + pt);
  }
  let somma = 0;
  for (const r of riep) {
    const al = n(val(r, 'AliquotaIVA')), nat = val(r, 'Natura') || '', imp = n(val(r, 'ImponibileImporto')), iva = n(val(r, 'Imposta'));
    somma += imp + iva;
    if (al === 0 && !nat) e.push('00429 riepilogo con aliquota 0 senza Natura');
    if (al !== 0 && nat) e.push('00430 riepilogo con aliquota e Natura');
    if (Math.abs(iva - Math.round(imp * al) / 100) > 0.01 + 1e-9) e.push(`00421 imposta ${iva} ≠ ${imp} × ${al}%`);
    const k = `${al}|${nat}`; if (!gruppi.has(k)) e.push(`00422 riepilogo ${k} senza righe`);
    else { if (Math.abs(gruppi.get(k) - imp) > 1) e.push(`00422 imponibile ${imp} ≠ righe ${gruppi.get(k).toFixed(2)} (${k})`); gruppi.delete(k); }
  }
  for (const k of gruppi.keys()) e.push(`00419 manca il riepilogo per ${k}`);
  const ritSi = linee.some(l => val(l, 'Ritenuta') === 'SI'), ritBlocco = /<DatiRitenuta>/.test(x);
  if (ritSi !== ritBlocco) e.push('00411 DatiRitenuta e righe con Ritenuta=SI non coincidono');
  if (/<DatiCassaPrevidenziale>/.test(x) && blocchi(x, 'DatiCassaPrevidenziale').some(c => val(c, 'Ritenuta') === 'SI') && !ritBlocco) e.push('00415 cassa con ritenuta senza DatiRitenuta');
  const tot = n(val(x, 'ImportoTotaleDocumento'));
  if (Number.isFinite(tot) && Math.abs(tot - somma) > 0.01 + 1e-9) e.push(`(coerenza) ImportoTotaleDocumento ${tot} ≠ riepiloghi ${somma.toFixed(2)}`);
  return e;
}

// ---------- i soggetti ----------
const AZ = { ragione_sociale: 'Studio Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via Roma 1', cap: '20121', comune: 'Milano', provincia: 'MI', iban: 'IT60X0542811101000000123456', banca: 'Banca Prova', email: 'info@prova.it' };
const AZ_FORF = { ...AZ, ragione_sociale: 'Anna Bianchi grafica', piva: '00743110157', codice_fiscale: 'RSSMRA85T10A562S', regime: 'RF19' };
const ROSSI = { nome: 'Rossi Srl', piva: '00743110157', codice_destinatario: 'ABC1234', via: 'Via Verdi 2', cap: '00184', comune: 'Roma', provincia: 'RM', nazione: 'IT' };
const PRIVATO = { nome: 'Mario Rossi', codice_fiscale: 'RSSMRA85T10A562S', via: 'Via Po 3', cap: '10121', comune: 'Torino', provincia: 'TO' };
const MULLER = { nome: 'Müller GmbH', piva: 'DE123456789', nazione: 'DE', via: 'Hauptstraße 5', cap: '10115', comune: 'Berlin' };
const ACME = { nome: 'Acme Inc.', nazione: 'US', via: '1 Main Street', cap: 'NY 10001', comune: 'New York' };
const COMUNE = { nome: 'Comune di Prova', codice_fiscale: '12345678903', codice_destinatario: 'UFABCD', via: 'Piazza Municipio 1', cap: '20121', comune: 'Milano', provincia: 'MI' };
const base = { stato: 'emessa', numero: '12', data: '2026-10-07', tipo: 'TD01', modalita: 'MP05', scadenza: '2026-11-06' };

function prova(nome, az, f, cliente) {
  const errori = controlla(az, f, cliente), out = xml(az, f, cliente, { progressivo: '0000A' }), v = valida(`${nome}.xml`, out.xml);
  return { errori, x: out.xml, v, sdi: controlliSdi(out.xml), conti: contiFattura(f) };
}

test('lo schema ufficiale c\'è e il file atteso dei test di Kubo lo rispetta', () => {
  assert.match(readFileSync(XSD, 'utf8'), /version="1\.2\.2"/);
  const v = valida('fattura-attesa.xml', readFileSync(join(QUI, 'documenti', 'fattura-attesa.xml'), 'utf8'));
  assert.ok(v.ok, v.errore);
});

test('1. forfettario (RF19) senza IVA, N2.2, dicitura di legge e bollo virtuale', () => {
  const f = { ...base, bollo: true, righe: [{ descrizione: 'Progetto logo e immagine coordinata', quantita: 1, prezzo: 500, aliquota: 0, natura: 'N2.2' }] };
  const p = prova('1-forfettario', AZ_FORF, f, ROSSI);
  assert.deepEqual(p.errori, []); assert.ok(p.v.ok, p.v.errore); assert.deepEqual(p.sdi, []);
  assert.match(p.x, /<RegimeFiscale>RF19<\/RegimeFiscale>/);
  assert.match(p.x, /<RiferimentoNormativo>Operazione in franchigia da IVA ai sensi dell'art\. 1, commi 54-89, L\. 190\/2014<\/RiferimentoNormativo>/);
  assert.match(p.x, /<DatiBollo>\s*<BolloVirtuale>SI<\/BolloVirtuale>\s*<ImportoBollo>2\.00<\/ImportoBollo>/);
  // senza la spunta del bollo il controllo avverte (sopra 77,47 €)
  assert.ok(controlla(AZ_FORF, { ...f, bollo: false }, ROSSI).some(x => /Bollo/.test(x)));
  // con l'IVA in una riga il controllo avverte
  assert.ok(controlla(AZ_FORF, { ...f, righe: [{ descrizione: 'x', prezzo: 10, aliquota: 22 }] }, ROSSI).some(x => /forfettario/.test(x)));
});

test('1b. forfettario: il bollo addebitato al cliente entra nel totale documento', { todo: 'Kubo non somma i 2 € del bollo (né una riga di rivalsa) a ImportoTotaleDocumento e al netto da pagare' }, () => {
  const f = { ...base, bollo: true, righe: [{ descrizione: 'Progetto', prezzo: 500, aliquota: 0, natura: 'N2.2' }] };
  assert.equal(prova('1b-bollo', AZ_FORF, f, ROSSI).conti.netto, 502);
});

const PRO = { ...base, ritenuta: 20, ritenuta_tipo: 'RT01', ritenuta_causale: 'A',
  righe: [{ descrizione: 'Consulenza fiscale settembre', quantita: 1, prezzo: 1000, aliquota: 22 }, { descrizione: 'Spese anticipate in nome e per conto del cliente (marche)', quantita: 1, prezzo: 50, aliquota: 0, natura: 'N1' }] };
test('2. professionista con ritenuta d\'acconto: schema e controlli SDI', () => {
  const p = prova('2-professionista', AZ, PRO, ROSSI);
  assert.deepEqual(p.errori, []); assert.ok(p.v.ok, p.v.errore); assert.deepEqual(p.sdi, []);
  assert.match(p.x, /<DatiRitenuta>\s*<TipoRitenuta>RT01<\/TipoRitenuta>/);
});
test('2b. la ritenuta si calcola solo sui compensi, non sulle spese anticipate escluse art. 15 (N1)', { todo: 'Kubo calcola il 20% su tutto l\'imponibile (1.050 €) e mette Ritenuta=SI anche sulla riga N1' }, () => {
  const p = prova('2b-ritenuta', AZ, PRO, ROSSI);
  assert.equal(p.conti.ritenuta, 200);
  const rigaN1 = blocchi(p.x, 'DettaglioLinee').find(l => /N1/.test(l)); assert.ok(!/<Ritenuta>SI/.test(rigaN1));
});
test('2c. cassa previdenziale (es. INPS 4% o Cassa forense) in DatiCassaPrevidenziale', { todo: 'non c\'è: né campo né elemento XML; il professionista non può fare la fattura completa' }, () => {
  const p = prova('2c-cassa', AZ, { ...PRO, cassa: 4, cassa_tipo: 'TC22' }, ROSSI);
  assert.match(p.x, /<DatiCassaPrevidenziale>/);
});

test('3. nota di credito (TD04) collegata alla fattura stornata', () => {
  const f = { ...base, tipo: 'TD04', numero: '13', collegata_dati: { numero: '12', data: '2026-10-01' }, righe: [{ descrizione: 'Storno consulenza', quantita: 3, prezzo: 80, aliquota: 22 }] };
  const p = prova('3-nota-credito', AZ, f, ROSSI);
  assert.deepEqual(p.errori, []); assert.ok(p.v.ok, p.v.errore); assert.deepEqual(p.sdi, []);
  assert.match(p.x, /<TipoDocumento>TD04<\/TipoDocumento>/);
  assert.match(p.x, /<DatiFattureCollegate>\s*<IdDocumento>12<\/IdDocumento>\s*<Data>2026-10-01<\/Data>/);
  assert.match(p.x, /<ImportoTotaleDocumento>292\.80<\/ImportoTotaleDocumento>/);
});

test('4. clienti esteri: UE con partita IVA (N3.2) ed extra UE senza (N3.1), codice XXXXXXX', () => {
  const ue = prova('4a-estero-ue', AZ, { ...base, righe: [{ descrizione: 'Anelli in argento', quantita: 10, prezzo: 45, aliquota: 0, natura: 'N3.2' }] }, MULLER);
  const senzaBollo = e => e.filter(x => !/Bollo/.test(x));   // vedi 4c: Kubo chiede il bollo anche dove non è dovuto
  assert.deepEqual(senzaBollo(ue.errori), []); assert.ok(ue.v.ok, ue.v.errore); assert.deepEqual(ue.sdi, []);
  assert.match(ue.x, /<CodiceDestinatario>XXXXXXX<\/CodiceDestinatario>/);
  assert.match(ue.x, /<IdPaese>DE<\/IdPaese>\s*<IdCodice>123456789<\/IdCodice>/);
  assert.match(ue.x, /<Denominazione>Müller GmbH<\/Denominazione>/);   // latin-1: lo SDI lo accetta
  const extra = prova('4b-estero-extraue', AZ, { ...base, righe: [{ descrizione: 'Export collana', quantita: 1, prezzo: 1200, aliquota: 0, natura: 'N3.1' }] }, ACME);
  assert.deepEqual(senzaBollo(extra.errori), []); assert.ok(extra.v.ok, extra.v.errore); assert.deepEqual(extra.sdi, []);
  assert.match(extra.x, /<CAP>00000<\/CAP>/);
});

test('4c. niente bollo su cessioni intra UE (N3.2), esportazioni (N3.1) e inversione contabile (N6)', { todo: 'controlla() pretende il bollo su ogni riga a IVA 0 sopra 77,47 € e blocca l\'esportazione finché non lo spunti' }, () => {
  for (const [natura, cliente] of [['N3.2', MULLER], ['N3.1', ACME], ['N6.7', ROSSI]])
    assert.deepEqual(controlla(AZ, { ...base, righe: [{ descrizione: 'x', prezzo: 500, aliquota: 0, natura }] }, cliente).filter(x => /Bollo/.test(x)), [], natura);
});

test('5. Pubblica Amministrazione: Kubo si ferma prima (FPA12 non supportato)', () => {
  const f = { ...base, righe: [{ descrizione: 'Servizio', prezzo: 1000, aliquota: 22 }] };
  const p = prova('5-pa', AZ, f, COMUNE);
  assert.ok(p.errori.some(x => /Pubblica Amministrazione.*FPA12/.test(x)), 'il controllo blocca l\'esportazione');
  // se si forzasse xml() senza controlli, il file passa lo schema (che ammette 6 o 7 caratteri) ma lo SDI lo scarta
  assert.ok(p.v.ok, p.v.errore);
  assert.ok(p.sdi.some(x => x.startsWith('00427')));
});
test('5b. PA: FPA12, scissione dei pagamenti (EsigibilitaIVA S), CIG e CUP', { todo: 'mancano formato FPA12, split payment, DatiOrdineAcquisto/DatiContratto con CIG e CUP' }, () => {
  const f = { ...base, split_payment: true, cig: 'Z1234567AB', cup: 'B12C34000560006', righe: [{ descrizione: 'Servizio', prezzo: 1000, aliquota: 22 }] };
  const p = prova('5b-pa', AZ, f, COMUNE);
  assert.match(p.x, /versione="FPA12"/); assert.match(p.x, /<EsigibilitaIVA>S<\/EsigibilitaIVA>/); assert.match(p.x, /<CodiceCIG>Z1234567AB<\/CodiceCIG>/);
});

test('6. privato consumatore con il solo codice fiscale', () => {
  const p = prova('6-privato', AZ, { ...base, righe: [{ descrizione: 'Riparazione orologio', prezzo: 120, aliquota: 22 }] }, PRIVATO);
  assert.deepEqual(p.errori, []); assert.ok(p.v.ok, p.v.errore); assert.deepEqual(p.sdi, []);
  assert.match(p.x, /<CodiceDestinatario>0000000<\/CodiceDestinatario>/); assert.match(p.x, /<CodiceFiscale>RSSMRA85T10A562S<\/CodiceFiscale>/);
});

test('7. righe con sconti e maggiorazioni, quantità con decimali', () => {
  const f = { ...base, righe: [
    { descrizione: 'Ore di lavoro', quantita: 2.5, prezzo: 38.9, sconto: 10, aliquota: 22 },
    { descrizione: 'Materiale', quantita: 3, prezzo: 19.99, sconto: 33.33, aliquota: 22 },
    { descrizione: 'Urgenza', quantita: 1, prezzo: 50, sconto: -15, aliquota: 22 },
    { descrizione: 'Libro', quantita: 7, prezzo: 12.35, sconto: 5, aliquota: 4 },
  ] };
  const p = prova('7-sconti', AZ, f, ROSSI);
  assert.deepEqual(p.errori, []); assert.ok(p.v.ok, p.v.errore); assert.deepEqual(p.sdi, []);
  assert.match(p.x, /<Tipo>MG<\/Tipo>\s*<Percentuale>15\.00<\/Percentuale>/);
});
test('7b. sconto in valore (es. 5 € sulla riga) e sconto sul totale documento', { todo: 'solo sconti in percentuale per riga: niente ScontoMaggiorazione/Importo né sconto a piede' }, () => {
  const p = prova('7b-sconto-valore', AZ, { ...base, sconto_importo: 5, righe: [{ descrizione: 'x', prezzo: 100, sconto_importo: 5, aliquota: 22 }] }, ROSSI);
  assert.match(p.x, /<Importo>5\.00<\/Importo>/);
});

test('8. arrotondamenti su 300 righe con aliquote miste: schema e controlli SDI', () => {
  const al = [22, 10, 4, 5, 0], righe = [];
  for (let i = 0; i < 300; i++) {
    const a = al[i % al.length];
    righe.push({ descrizione: `Articolo ${i + 1}`, quantita: [1, 3, 0.5, 7, 2.75, 11][i % 6], prezzo: Number(((i * 7.37) % 97 + 0.01).toFixed(2)), sconto: [0, 0, 7.5, 12.5, 0][i % 5], aliquota: a, ...(a ? {} : { natura: 'N4' }) });
  }
  const f = { ...base, bollo: true, righe };
  const p = prova('8-trecento-righe', AZ, f, ROSSI);
  assert.deepEqual(p.errori, []); assert.ok(p.v.ok, p.v.errore); assert.deepEqual(p.sdi, []);
  // l'imposta è per aliquota (una sola volta), mai riga per riga
  for (const g of p.conti.riepilogo) assert.equal(g.imposta, Math.round(g.imponibile * g.aliquota) / 100);
});
test('8b. prezzi unitari con più di 2 decimali (es. 0,125 €) restano come scritti', { todo: 'Kubo arrotonda il prezzo unitario ai centesimi: 1000 × 0,125 € diventa 130 € invece di 125 €' }, () => {
  const p = prova('8b-decimali', AZ, { ...base, righe: [{ descrizione: 'Viti', quantita: 1000, prezzo: 0.125, aliquota: 22 }] }, ROSSI);
  assert.equal(p.conti.imponibile, 125);
});

test('9. autofatture e integrazioni (TD16-TD19), fattura semplificata (TD07), acconto (TD02)', { todo: 'il modello ammette solo TD01, TD24, TD04, TD05, TD06; per TD16-19 il cedente deve essere il fornitore, non la tua azienda' }, () => {
  const tipi = JSON.parse(readFileSync(join(QUI, '..', 'modelli', 'fatture.json'), 'utf8')).entita.find(e => e.id === 'fatture').campi.find(c => c.id === 'tipo').opzioni.map(o => o.id);
  for (const t of ['TD02', 'TD07', 'TD16', 'TD17', 'TD18', 'TD19']) assert.ok(tipi.includes(t), t);
});

test('10. lo stesso file non passa se lo si rompe (la prova XSD morde davvero)', () => {
  const buono = xml(AZ, { ...base, righe: [{ descrizione: 'x', prezzo: 10, aliquota: 22 }] }, ROSSI).xml;
  for (const [nome, rotto] of [['data', buono.replace('<Data>2026-10-07</Data>', '<Data>07/10/2026</Data>')], ['ordine', buono.replace(/(<Divisa>EUR<\/Divisa>)\s*(<Data>[^<]*<\/Data>)/, '$2$1')],
    ['natura', buono.replace('<AliquotaIVA>22.00</AliquotaIVA>\n', '<AliquotaIVA>22.00</AliquotaIVA><Natura>N9</Natura>\n')]]) assert.equal(valida(`10-rotto-${nome}.xml`, rotto).ok, false, nome);
});
