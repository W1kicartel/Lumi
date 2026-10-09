// OpenAPI 3.1 delle API di Lumi, generato in diretta dallo schema visto da chi chiede (sezioni, campi, permessi):
//   GET /api/openapi-3.1.json      con la sessione o con «Authorization: Bearer <token personale>»
// Da importare in n8n, Make (app personalizzate), Postman, Insomnia, generatori di client. Rispetto a /api/openapi.json
// (3.0.3, import-api.js, che resta per chi lo usa già): JSON Schema 2020-12 vero (tipi con "null", "const", "examples"),
// i «webhooks» di primo livello che descrivono le consegne dei webhook di Lumi (firma X-Lumi-Firma), le rotte di storia,
// ripristino e schema, e per il titolare gli indirizzi in entrata dei connettori a ricette accesi (HTTP, Zapier, Make…).
import { istanze } from './connettori.js';
import { attive } from './connettori-ricette.js';

const TIPO = {
  numero: { type: 'number' }, valuta: { type: 'number', description: 'euro' }, percentuale: { type: 'number' }, durata: { type: 'integer', description: 'minuti' },
  si_no: { type: 'boolean' }, data: { type: 'string', format: 'date' }, data_ora: { type: 'string', format: 'date-time' }, email: { type: 'string', format: 'email' },
  url: { type: 'string', format: 'uri' }, telefono: { type: 'string' }, testo_lungo: { type: 'string' }, indirizzo: { type: 'string' }, codice_a_barre: { type: 'string' },
  scelta_multipla: { type: 'array', items: { type: 'string' } },
  file: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, nome: { type: 'string' } } } },
};
const EVENTI = ['crea', 'modifica', 'elimina', 'ripristina'];

// lo schema JSON di un campo; «nullable» in 3.1 è un tipo in più: ["string", "null"]
export function schemaCampo(c) {
  let t = TIPO[c.tipo === 'immagine' ? 'file' : c.tipo] || { type: 'string' };
  if (['scelta', 'stato'].includes(c.tipo)) t = { type: 'string', enum: (c.opzioni || []).map(o => o.id) };
  if (c.tipo === 'relazione') t = c.molti ? { type: 'array', items: { type: 'string' }, description: `id di ${c.entita}` }
    : { oneOf: [{ type: 'string', description: `id di ${c.entita}` }, { type: 'object', properties: { id: { type: 'string' }, titolo: { type: 'string' } }, description: 'in lettura' }] };
  if (c.tipo === 'righe') t = { type: 'array', items: { $ref: `#/components/schemas/${c.entita}` }, description: `righe di ${c.entita}` };
  if (c.tipo === 'calcolato') t = { description: 'calcolato' };
  if (!c.obbligatorio && typeof t.type === 'string') t = { ...t, type: [t.type, 'null'] };
  return t;
}

export default function registra({ r, db, S, P, serve }) {
  r('GET', '/api/openapi-3.1.json', ({ ctx, req }) => {
    serve(ctx);
    const entita = S.elenco(db).filter(e => P.puo(ctx, e.id, 'leggi')), paths = {}, schemas = {}, webhooks = {};
    const errore = { description: 'Errore', content: { 'application/json': { schema: { $ref: '#/components/schemas/Errore' } } } };
    const par = (name, description, inn = 'query', schema = { type: 'string' }) => ({ name, in: inn, required: inn === 'path', schema, description });
    for (const e of entita) {
      const props = {}, campi = S.campiAttivi(e).filter(c => P.statoCampo(ctx, e.id, c.id) !== 'nascosto');
      for (const c of campi) props[c.id] = { title: c.nome, ...schemaCampo(c), ...(['calcolato', 'contatore'].includes(c.tipo) || P.statoCampo(ctx, e.id, c.id) === 'lettura' ? { readOnly: true } : {}) };
      schemas[e.id] = { type: 'object', title: e.nome, properties: { id: { type: 'string', readOnly: true }, creato: { type: 'string', format: 'date-time', readOnly: true },
        modificato: { type: ['string', 'null'], format: 'date-time', readOnly: true }, creato_da: { type: ['string', 'null'], readOnly: true }, modificato_da: { type: ['string', 'null'], readOnly: true }, ...props },
        required: campi.filter(c => c.obbligatorio && !['calcolato', 'contatore'].includes(c.tipo)).map(c => c.id) };
      const rif = { $ref: `#/components/schemas/${e.id}` }, una = { description: 'OK', content: { 'application/json': { schema: rif } } };
      const corpo = { required: true, content: { 'application/json': { schema: rif } } }, tags = [e.nome];
      paths[`/api/dati/${e.id}`] = {
        get: { operationId: `elenca_${e.id}`, tags, summary: `Elenco di ${e.nome}`,
          parameters: [par('q', 'cerca nel testo'), par('f', 'filtri JSON: [{"campo":"…","op":"=","valore":…}]'), par('o', 'ordina: campo:desc,campo2'), par('p', 'pagina', 'query', { type: 'integer', minimum: 1 }),
            par('n', 'righe per pagina (al massimo 500)', 'query', { type: 'integer', minimum: 1, maximum: 500 }), par('arch', '1 = anche le archiviate', 'query', { type: 'string', enum: ['1'] })],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { righe: { type: 'array', items: rif }, totale: { type: 'integer' } } } } } }, default: errore } },
        ...(P.puo(ctx, e.id, 'crea') ? { post: { operationId: `crea_${e.id}`, tags, summary: `Crea in ${e.nome}`, requestBody: corpo, responses: { 200: una, 422: errore, default: errore } } } : {}),
      };
      paths[`/api/dati/${e.id}/{id}`] = {
        parameters: [par('id', 'id della riga', 'path')],
        get: { operationId: `leggi_${e.id}`, tags, summary: `Una riga di ${e.nome}`, responses: { 200: una, 404: errore, default: errore } },
        ...(P.puo(ctx, e.id, 'modifica') ? { patch: { operationId: `modifica_${e.id}`, tags, summary: 'Modifica (solo i campi mandati)', requestBody: corpo, responses: { 200: una, 422: errore, default: errore } } } : {}),
        ...(P.puo(ctx, e.id, 'elimina') ? { delete: { operationId: `archivia_${e.id}`, tags, summary: 'Archivia (si ripristina)', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } }, default: errore } } } : {}),
      };
      paths[`/api/dati/${e.id}/{id}/storia`] = { parameters: [par('id', 'id della riga', 'path')],
        get: { operationId: `storia_${e.id}`, tags, summary: 'Chi ha cambiato cosa e quando', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } }, default: errore } } };
      if (P.puo(ctx, e.id, 'elimina')) paths[`/api/dati/${e.id}/{id}/ripristina`] = { parameters: [par('id', 'id della riga', 'path')],
        post: { operationId: `ripristina_${e.id}`, tags, summary: 'Ripristina una riga archiviata', responses: { 200: una, default: errore } } };
      // le consegne dei webhook di Lumi («API e integrazioni»): POST JSON firmato verso l'indirizzo scelto dal titolare
      webhooks[`lumi.${e.id}`] = { post: { summary: `Un evento in ${e.nome}`, tags,
        description: 'Lumi manda POST JSON firmato: X-Lumi-Firma = "sha256=" + HMAC-SHA256(segreto, "<X-Lumi-Tempo>.<corpo>"). Rispondi 2xx; altrimenti Lumi riprova con attese crescenti.',
        parameters: [par('X-Lumi-Evento', `${e.id}.<evento>`, 'header'), par('X-Lumi-Consegna', 'numero della consegna', 'header'), par('X-Lumi-Tempo', 'secondi Unix', 'header'), par('X-Lumi-Firma', 'sha256=<hex>', 'header')],
        requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['evento', 'entita', 'id', 'tipo'], properties: {
          evento: { type: 'string', examples: [`${e.id}.crea`] }, entita: { const: e.id }, id: { type: 'string' }, tipo: { enum: EVENTI }, quando: { type: 'string', format: 'date-time' },
          da: { type: ['string', 'null'] }, consegna: { type: 'integer' }, dati: { oneOf: [rif, { type: 'null' }] }, prima: { oneOf: [rif, { type: 'null' }] } } } } } },
        responses: { 200: { description: 'Ricevuto' } } } };
    }
    paths['/api/schema'] = { get: { operationId: 'schema', tags: ['Lumi'], summary: 'Le sezioni e i campi che puoi vedere', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } } } };
    // il titolare vede anche gli indirizzi in entrata dei connettori a ricette accesi (il codice segreto non c'è: è nella loro pagina)
    const nucleo = istanze.get(db);
    if (ctx.r?.id === 'titolare' && nucleo) for (const [id, c] of nucleo.tutti()) {
      if (!c.man?.entrata?.firma?.nelPercorso || !nucleo.attivo(id)) continue;
      const ricette = attive(nucleo.k(id).imp, 'entrata'); if (!ricette.length) continue;
      paths[`/api/connettori/${id}/in/{codice}`] = { post: { operationId: `entrata_${id.replace(/-/g, '_')}`, tags: ['Connettori'], summary: `${c.man.nome}: scrivere in Lumi`, security: [],
        description: `Il codice segreto è nella pagina del connettore. Ricette: ${ricette.map(x => `${x.id} → ${x.sezione} (${x.modo})`).join('; ')}. Con più ricette aggiungi ?ricetta=<id>.`,
        parameters: [par('codice', 'codice segreto del connettore', 'path'), par('ricetta', 'id della ricetta', 'query', { enum: ricette.map(x => x.id) }), par('Idempotency-Key', 'contro i doppioni (facoltativo)', 'header')],
        requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [{ type: 'object' }, { type: 'array', items: { type: 'object' } }] } } } },
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, esito: { type: 'string' }, doppione: { type: 'boolean' } } } } } }, 401: errore, 422: errore } } };
    }
    const host = String(req.headers.host || 'localhost').replace(/[^\w.:[\]-]/g, ''), proto = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    return { openapi: '3.1.0', jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
      info: { title: 'Lumi', version: '1', summary: 'Il gestionale, generato dallo schema', license: { name: 'MIT', identifier: 'MIT' },
        description: 'Le API di Lumi come le vede chi le chiede: solo le sezioni e i campi che può leggere, e i metodi che può usare. Autenticazione: Authorization: Bearer <token personale> (Impostazioni → API e integrazioni).' },
      servers: [{ url: `${proto}://${host}` }], security: [{ token: [] }],
      components: { securitySchemes: { token: { type: 'http', scheme: 'bearer', description: 'token personale lumi_…' } },
        schemas: { Errore: { type: 'object', properties: { errore: { type: 'string' }, campi: { type: 'object' } } }, ...schemas } },
      paths, webhooks };
  });
}
