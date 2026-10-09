// DocuSign contro un finto servizio: JWT Grant verificato con la chiave pubblica, userinfo → conto, busta con il PDF del
// preventivo, Connect firmato in HMAC → preventivo accettato. Nessuna chiamata vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';

const IK = '0f6a2b6e-1111-4c2d-9e3f-123456789abc', UTENTE = '7d1e9a40-2222-4b5c-8d6e-abcdefabcdef', CONTO = 'a1b2c3d4-3333-4e5f-9a0b-0123456789ab';

test('DocuSign: JWT Grant firmato, conto da userinfo, busta con il PDF e la firma ancorata, Connect HMAC → accettato, doppione, firma sbagliata', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const K = await kubo(['professionista']); let busta = null, token = 0, url = '';
  const S = await finto({
    'POST /oauth/token': (p, c) => {
      assert.equal(c.grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const [h, b, f] = c.assertion.split('.'), x = JSON.parse(Buffer.from(b, 'base64url'));
      assert.ok(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(f, 'base64url')), 'firma del JWT');
      assert.equal(x.iss, IK); assert.equal(x.sub, UTENTE); assert.equal(x.aud, new URL(url).host); assert.equal(x.scope, 'signature impersonation'); assert.ok(x.exp - x.iat <= 3600);
      token++; return { access_token: 'ds-acc', expires_in: 3600, token_type: 'Bearer' };
    },
    'GET /oauth/userinfo': (p, c, { intestazioni }) => { assert.equal(intestazioni.authorization, 'Bearer ds-acc'); return { sub: UTENTE, accounts: [{ account_id: 'altro', is_default: false, base_uri: 'https://na1.docusign.net' }, { account_id: CONTO, is_default: true, base_uri: url }] }; },
    [`POST /restapi/v2.1/accounts/${CONTO}/envelopes`]: (p, c) => { busta = c; return { envelopeId: 'env-0001', status: 'sent' }; },
  });
  url = S.url;
  try {
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Studio Bianchi', referente: 'Laura Bianchi', email: 'laura@studio.example' })).json;
    const p = (await K.chiama('POST', '/api/dati/preventivi', { cliente: cl.id, oggetto: 'Sito web', voci: [{ descrizione: 'Progetto grafico', quantita: 1, prezzo: 800 }] })).json;
    await accendi(K, 'docusign', { base: S.url, segreti: { chiave_privata: privateKey, hmac: 'chiave-hmac-connect' }, impostazioni: { integrazione: IK, utente: UTENTE } });
    const c = (await K.chiama('POST', '/api/connettori/docusign/azioni/consenso', { args: {} })).json;
    assert.match(c.url, /\/oauth\/auth\?response_type=code&scope=signature\+impersonation&client_id=0f6a2b6e/);
    assert.equal((await K.chiama('POST', '/api/connettori/docusign/prova')).json.ok, true);
    const r = await K.chiama('POST', '/api/connettori/docusign/azioni/firma', { args: { preventivo: p.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.busta, 'env-0001'); assert.equal(token, 1);
    assert.equal(busta.status, 'sent'); assert.equal(busta.recipients.signers[0].email, 'laura@studio.example'); assert.equal(busta.recipients.signers[0].name, 'Laura Bianchi');
    assert.equal(busta.recipients.signers[0].tabs.signHereTabs[0].anchorString, 'Firma per accettazione');
    const pdf = Buffer.from(busta.documents[0].documentBase64, 'base64').toString('latin1');
    assert.match(pdf, /^%PDF-/); assert.match(pdf, /Firma per accettazione/); assert.match(pdf, /Progetto grafico/);
    assert.equal(busta.customFields.textCustomFields[0].value, `kubo-p-${p.id}`);
    assert.equal((await K.chiama('GET', `/api/dati/preventivi/${p.id}`)).json.stato, 'inviato');
    const ev = JSON.stringify({ event: 'envelope-completed', apiVersion: 'v2.1', generatedDateTime: '2026-10-09T10:00:00Z', data: { accountId: CONTO, envelopeId: 'env-0001' } });
    assert.equal((await manda(K, '/api/connettori/docusign/in', ev, { 'X-DocuSign-Signature-1': firmaHmacDi('altra', ev) })).stato, 401);
    const w = await manda(K, '/api/connettori/docusign/in', ev, { 'X-DocuSign-Signature-1': firmaHmacDi('chiave-hmac-connect', ev) });
    assert.equal(w.stato, 200, JSON.stringify(w.json)); assert.equal(w.json.esito, 'accettato');
    const dopo = (await K.chiama('GET', `/api/dati/preventivi/${p.id}`)).json; assert.equal(dopo.stato, 'accettato'); assert.equal(dopo.modificato_da, 'servizio:docusign');
    assert.equal((await manda(K, '/api/connettori/docusign/in', ev, { 'X-DocuSign-Signature-1': firmaHmacDi('chiave-hmac-connect', ev) })).json.doppione, true);
    assert.equal((await K.chiama('POST', '/api/connettori/docusign/azioni/firma', { args: { preventivo: p.id } })).stato, 502);   // già in firma
  } finally { await K.chiudi(); await S.chiudi(); }
});
