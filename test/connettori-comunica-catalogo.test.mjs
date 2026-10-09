// Il contratto del catalogo per i connettori di comunicazione e lavoro quotidiano: ogni manifesto ha il blocco
// «catalogo» completo, le traduzioni brevi nelle cinque lingue e la guida (costo, passi, chiavi) almeno in inglese.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { carica, CARTELLA_UFFICIALI } from '../server/moduli/connettori.js';

const NOSTRI = ['brevo', 'twilio', 'skebby', 'telegram', 'slack', 'teams', 'discord', 'google-chat', 'ntfy', 'pushover', 'webhook',
  'sendgrid', 'postmark', 'mailgun', 'resend', 'amazon-ses', 'gmail', 'outlook-posta', 'mailjet', 'mailersend',
  'google-drive', 'dropbox', 'onedrive', 's3', 'webdav', 'outlook', 'caldav', 'calendly', 'cal-com', 'zoom',
  'google-sheets', 'airtable', 'notion', 'mailchimp', 'hubspot', 'meta-lead', 'google-business', 'trustpilot',
  'typeform', 'tally', 'jotform', 'google-ads-lead', 'acuity', 'jitsi', 'vonage', 'aruba-sms', 'smshosting', 'clicksend', 'gotify',
  'trello', 'todoist', 'asana', 'pipedrive', 'mailerlite', 'baserow', 'carddav', 'google-contatti', 'excel-online',
  'box', 'pcloud', 'clickup', 'microsoft-todo', 'google-tasks',
  'mailup', 'activecampaign', 'zoho-crm',
  'simplybook', 'aircall', 'whereby', 'teams-riunioni'];
const CATEGORIE = ['email', 'sms', 'messaggi', 'calendario', 'prenotazioni', 'archivio', 'produttivita', 'marketing', 'recensioni', 'ia'];
const LINGUE = ['en', 'es', 'fr', 'de', 'pt'];

test('catalogo dei connettori di comunicazione: contratto, guide e traduzioni', async () => {
  const tutti = await carica(CARTELLA_UFFICIALI, 'ufficiale'), visti = [];
  for (const id of NOSTRI) {
    if (!existsSync(`${CARTELLA_UFFICIALI}/${id}/connettore.js`)) continue;
    const c = tutti.find(x => x.id === id); assert.ok(c?.man, `${id}: ${c?.rotto || 'non caricato'}`); visti.push(id);
    const { man } = c, k = man.catalogo, dove = `${id}.catalogo`;
    assert.ok(k, `${id}: manca il catalogo`);
    assert.ok(CATEGORIE.includes(k.categoria), `${dove}.categoria ${k.categoria}`);
    assert.match(k.sito, /^https:\/\//, `${dove}.sito`);
    assert.ok(['gratis', 'a-consumo', 'abbonamento', 'contratto'].includes(k.costo), `${dove}.costo`);
    assert.ok(k.costoNota?.length > 20, `${dove}.costoNota`);
    assert.ok(Array.isArray(k.serve) && k.serve.length && k.serve.every(s => s.cosa && s.dove && /^https:\/\//.test(s.link || 'https://')), `${dove}.serve`);
    assert.ok(Array.isArray(k.passi) && k.passi.length >= 3 && k.passi.length <= 8, `${dove}.passi: ${k.passi?.length}`);
    assert.ok(['facile', 'media', 'difficile'].includes(k.difficolta), `${dove}.difficolta`);
    assert.ok(k.zone?.length && k.zone.every(z => ['IT', 'UE', 'mondo'].includes(z)), `${dove}.zone`);
    assert.ok(k.fonti?.length && k.fonti.every(f => /^https:\/\//.test(f)), `${dove}.fonti`);
    assert.equal(k.prova, 'finto', `${dove}.prova`);
    assert.ok(k.parole?.length >= 3, `${dove}.parole`);
    // la guida in inglese
    const en = man.testi?.en || {};
    assert.ok(typeof en['cat.costoNota'] === 'string' && en['cat.costoNota'].length > 20, `${id}: en cat.costoNota`);
    assert.equal(en['cat.passi']?.length, k.passi.length, `${id}: en cat.passi`);
    assert.equal(en['cat.serve']?.length, k.serve.length, `${id}: en cat.serve`); assert.ok(en['cat.serve'].every(s => s.cosa && s.dove), `${id}: en cat.serve cosa/dove`);
    // le stringhe brevi in tutte le lingue
    const chiavi = ['nome', 'descrizione', ...(man.impostazioni || []).map(i => `imp.${i.id}`), ...(man.impostazioni || []).filter(i => i.aiuto).map(i => `aiuto.${i.id}`),
      ...Object.keys(man.azioni || {}).map(a => `az.${a}`), ...Object.keys(man.pianificati || {}).map(g => `giro.${g}`)];
    for (const l of LINGUE) for (const ch of chiavi) assert.ok(man.testi?.[l]?.[ch], `${id}: manca ${l} ${ch}`);
    // i nomi degli strumenti di Lumi restano sotto i 64 caratteri
    for (const a of Object.keys(man.azioni || {})) assert.ok(`connettore_${id}_${a}`.replace(/-/g, '_').length <= 64, `${id}.${a}: nome dello strumento troppo lungo`);
  }
  assert.ok(visti.length >= 38, `connettori trovati: ${visti.length}`);
});
