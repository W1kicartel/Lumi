// La WhatsApp Cloud API di Meta: i corpi dei messaggi, i modelli e gli eventi del webhook. La usano il connettore «whatsapp»
// (Meta diretta, graph.facebook.com) e «360dialog» (che ospita la stessa API su waba-v2.360dialog.io).
// Fonti: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
//        https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
//        https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
import { randomBytes } from 'node:crypto';

const a = n => String(n).replace(/^\+/, '');   // la Cloud API vuole il numero con il prefisso del paese, senza «+»
const base = to => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to: a(to) });
export const corpoTesto = (to, testo) => ({ ...base(to), type: 'text', text: { preview_url: false, body: String(testo) } });
// documento: l'intestazione DOCUMENT del modello (il PDF caricato prima), l'unico modo di mandare un file fuori dalla finestra
export function corpoModello(to, { nome, lingua = 'it', valori = [], documento = null }) {
  const componenti = [...(documento ? [{ type: 'header', parameters: [{ type: 'document', document: { id: documento.id, filename: documento.nome } }] }] : []),
    ...(valori.length ? [{ type: 'body', parameters: valori.map(v => ({ type: 'text', text: String(v) })) }] : [])];
  return { ...base(to), type: 'template', template: { name: nome, language: { code: lingua }, ...(componenti.length ? { components: componenti } : {}) } };
}
export const corpoDocumento = (to, { id, link, nome, didascalia }) => ({ ...base(to), type: 'document', document: { ...(id ? { id } : { link }), filename: nome, ...(didascalia ? { caption: didascalia } : {}) } });

// il caricamento di un file (POST /<numero>/media): multipart con messaging_product, type e file
export function multipart(campi, file) {
  const confine = `----kubo${randomBytes(12).toString('hex')}`, parti = [];
  for (const [k, v] of Object.entries(campi)) parti.push(Buffer.from(`--${confine}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parti.push(Buffer.from(`--${confine}\r\nContent-Disposition: form-data; name="file"; filename="${String(file.nome).replace(/["\r\n]/g, '')}"\r\nContent-Type: ${file.tipo}\r\n\r\n`),
    Buffer.from(file.dati), Buffer.from(`\r\n--${confine}--\r\n`));
  return { testo: Buffer.concat(parti), intestazioni: { 'Content-Type': `multipart/form-data; boundary=${confine}` } };
}

export const errore = r => r.json?.error?.error_user_msg || r.json?.error?.message || r.json?.meta?.developer_message || `HTTP ${r.stato}`;
export const idRisposta = r => { if (!r.ok) throw new Error(errore(r)); return { id: r.json?.messages?.[0]?.id || null }; };

// gli stati dei modelli di Meta → quelli di Kubo
export const statoModello = s => ({ APPROVED: 'approvato', PENDING: 'in_attesa', IN_APPEAL: 'in_attesa', REJECTED: 'rifiutato', PAUSED: 'in_pausa',
  DISABLED: 'disattivato', PENDING_DELETION: 'disattivato', LIMIT_EXCEEDED: 'rifiutato' }[String(s || '').toUpperCase()] || 'in_attesa');
export const modelloDa = t => ({ nome: t.name, lingua: t.language, stato: statoModello(t.status), categoria: String(t.category || 'utility').toLowerCase(),
  corpo: (t.components || []).find(c => String(c.type).toUpperCase() === 'BODY')?.text || '',
  intestazione: (t.components || []).find(c => String(c.type).toUpperCase() === 'HEADER')?.format || null, idRemoto: t.id || null, motivo: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null });
export const corpoNuovoModello = ({ nome, lingua = 'it', categoria = 'utility', corpo, esempi = [], intestazione = null, esempioFile = null }) => ({ name: nome, language: lingua, category: String(categoria).toUpperCase(),
  components: [...(intestazione === 'DOCUMENT' && esempioFile ? [{ type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [esempioFile] } }] : []),
    { type: 'BODY', text: corpo, ...(esempi.length ? { example: { body_text: [esempi.map(String)] } } : {}) }] });

// il webhook → eventi di Kubo: { tipo: 'messaggio' | 'stato' | 'modello', … }
const STATI = { sent: 'inviato', delivered: 'consegnato', read: 'letto', failed: 'fallito' };
const quando = ts => (ts ? new Date(Number(ts) * 1000).toISOString() : new Date().toISOString());
export function eventi(ev) {
  const out = [];
  for (const e of ev?.entry || []) for (const c of e.changes || []) {
    const v = c.value || {};
    if (c.field === 'message_template_status_update') { out.push({ tipo: 'modello', nome: v.message_template_name, lingua: v.message_template_language, stato: statoModello(v.event), motivo: v.reason && v.reason !== 'NONE' ? v.reason : null }); continue; }
    const nomi = Object.fromEntries((v.contacts || []).map(x => [x.wa_id, x.profile?.name || null]));
    for (const m of v.messages || []) out.push({ tipo: 'messaggio', da: `+${a(m.from)}`, nome: nomi[m.from] || null, id: m.id, quando: quando(m.timestamp),
      testo: m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m[m.type]?.caption ?? null,
      media: ['image', 'document', 'audio', 'video', 'sticker', 'location', 'contacts'].includes(m.type) ? m.type : null });
    for (const s of v.statuses || []) out.push({ tipo: 'stato', id: s.id, stato: STATI[s.status] || s.status, quando: quando(s.timestamp), categoria: s.pricing?.category || null,
      errore: s.errors?.[0] ? `${s.errors[0].code} ${s.errors[0].title || s.errors[0].message || ''}`.trim() : null });
  }
  return out;
}
// la chiave dell'evento contro i doppioni (Meta rimanda lo stesso webhook se non risponde 200 in tempo)
export const idempotenza = ev => {
  const v = ev?.entry?.[0]?.changes?.[0]?.value || {};
  return v.messages?.[0]?.id || (v.statuses?.[0] ? `${v.statuses[0].id}:${v.statuses[0].status}` : v.message_template_name ? `${v.message_template_name}:${v.event}:${ev.entry[0].time || ''}` : null);
};
// consegna gli eventi al modulo WhatsApp (whatsapp-bus.js); senza modulo (o senza eventi) l'evento è «ignorato»
export async function consegna(bus, k, lista) {
  const m = bus.get(k.db); if (!m || !lista.length) return 'ignorato';
  return m.ricevi(k.id, lista);
}

// i metodi comuni a Meta e 360dialog: chiama(k, metodo, percorso, opz) aggiunge l'indirizzo e l'autenticazione
export function api({ chiama, percorsoMessaggi, percorsoMedia, percorsoModelli, listaModelli }) {
  async function carica(k, d) {
    const r = await chiama(k, 'post', percorsoMedia(k), multipart({ messaging_product: 'whatsapp', type: d.tipo }, d));
    if (!r.ok || !r.json?.id) throw new Error(errore(r)); return r.json.id;
  }
  return {
    testo: async (k, to, testo) => idRisposta(await chiama(k, 'post', percorsoMessaggi(k), { json: corpoTesto(to, testo) })),
    async modello(k, to, m) {
      const documento = m.documento ? { id: await carica(k, m.documento), nome: m.documento.nome } : null;
      return idRisposta(await chiama(k, 'post', percorsoMessaggi(k), { json: corpoModello(to, { ...m, documento }) }));
    },
    async documento(k, to, d) {
      const up = { json: { id: await carica(k, d) } };
      return idRisposta(await chiama(k, 'post', percorsoMessaggi(k), { json: corpoDocumento(to, { id: up.json.id, nome: d.nome, didascalia: d.didascalia }) }));
    },
    async modelli(k) {
      const out = []; let url = percorsoModelli(k, true);
      for (let i = 0; url && i < 20; i++) {
        const r = await chiama(k, 'get', url); if (!r.ok) throw new Error(errore(r));
        out.push(...listaModelli(r.json).map(modelloDa)); url = r.json?.paging?.next || null;
      }
      return out;
    },
    async creaModello(k, def) {
      const r = await chiama(k, 'post', percorsoModelli(k, false), { json: corpoNuovoModello(def) }); if (!r.ok) throw new Error(errore(r));
      return { idRemoto: r.json?.id || null, stato: statoModello(r.json?.status || 'PENDING'), categoria: String(r.json?.category || def.categoria).toLowerCase() };
    },
  };
}
