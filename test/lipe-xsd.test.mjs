// La Comunicazione liquidazioni periodiche IVA generata da Kubo contro gli schemi UFFICIALI dell'Agenzia delle Entrate
// (test/fisco/lipe, fonte in test/fisco/lipe/FONTE.md) e la nomenclatura del file del documento «Modalità di trasmissione
// dati» (provv. 27/3/2017): IT + identificativo fiscale del trasmittente (11-16 caratteri) + _LI_ + progressivo [A-Za-z0-9]{1,5}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { lipe } from '../server/moduli/fisco-file.js';

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), 'fisco', 'lipe', 'sco', 'ivp', 'fornituraIvp_2018_v1.xsd');
let xmllint = true; try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); } catch { xmllint = false; }
const cartella = mkdtempSync(join(tmpdir(), 'kubo-lipe-'));
const valida = (nome, xml) => { const f = join(cartella, nome); writeFileSync(f, xml); execFileSync('xmllint', ['--noout', '--schema', SCHEMA, f], { stdio: 'pipe' }); };
const base = { cf: 'RSSMRA80A01H501U', piva: '12345678903', anno: 2026 };
const p = { attive: 10000, passive: 4000, ivaEsigibile: 2200, ivaDetratta: 880, ivaDovuta: 1320, interessi: 13.2, importoDaVersare: 1333.2 };
const CASI = {
  'trimestrale con interessi': lipe({ ...base, periodicita: 'trimestrale', trimestre: 1, periodi: [p] }),
  'quarto trimestre con acconto (Trimestre 5)': lipe({ ...base, periodicita: 'trimestrale', trimestre: 4, periodi: [{ ...p, acconto: 200 }], metodoAcconto: 1 }),
  'mensile, tre moduli': lipe({ ...base, periodicita: 'mensile', trimestre: 2, periodi: [4, 5, 6].map(m => ({ ...p, periodo: m, interessi: 0, importoDaVersare: 1320 })) }),
  'a credito con credito del periodo prima': lipe({ ...base, periodicita: 'trimestrale', trimestre: 2, periodi: [{ attive: 1000, passive: 5000, ivaEsigibile: 220, ivaDetratta: 1100, ivaCredito: 880, creditoPeriodoPrecedente: 150, importoACredito: 1030 }] }),
};

for (const [nome, f] of Object.entries(CASI)) {
  test(`LIPE valida con lo schema ufficiale: ${nome}`, { skip: !xmllint && 'xmllint non c\'è' }, () => { valida(f.nome.replace(/\.xml$/, `-${Object.keys(CASI).indexOf(nome)}.xml`), f.xml); });
  test(`LIPE: nome del file secondo le modalità di trasmissione (${nome})`, () => { assert.match(f.nome, /^IT[A-Z0-9]{11,16}_LI_[A-Za-z0-9]{1,5}\.xml$/); });
}
test('LIPE: uno schema rotto viene davvero rifiutato (la validazione non è finta)', { skip: !xmllint && 'xmllint non c\'è' }, () => {
  const rotta = CASI['trimestrale con interessi'].xml.replace('<iv:CodiceFornitura>IVP18</iv:CodiceFornitura>', '<iv:CodiceFornitura>XXX</iv:CodiceFornitura>');
  assert.throws(() => valida('rotta.xml', rotta));
});
