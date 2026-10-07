// Persone e permessi: chi entra, con che ruolo; i ruoli dicono cosa si può fare in ogni sezione e quali campi si vedono.
import { h, api, get, toast } from './ui.js';

export async function utenti(contenitore, { schema }) {
  const [persone, ruoli] = await Promise.all([get('/utenti'), get('/ruoli')]);
  const nomeRuolo = id => ruoli.find(r => r.id === id)?.nome || id;
  const f = { nome: h('input.campo', { placeholder: 'Nome' }), email: h('input.campo', { type: 'email', placeholder: 'Email' }), password: h('input.campo', { type: 'password', placeholder: 'Password (8+)', autocomplete: 'new-password' }),
    ruolo: h('select.campo', ruoli.filter(r => r.id !== 'titolare').map(r => h('option', { value: r.id, testo: r.nome }))) };
  const aggiungi = h('button.btn.pieno', { testo: 'Aggiungi', on: { click: async () => {
    try { await api('POST', '/utenti', { nome: f.nome.value, email: f.email.value, password: f.password.value, ruolo: f.ruolo.value }); toast('Aggiunto'); utenti(contenitore, { schema }); }
    catch (e) { toast(e.message, true); }
  } } });
  const righe = persone.map(p => h('tr',
    h('td', p.nome), h('td', p.email),
    h('td', h('select.campo', { disabled: p.ruolo === 'titolare' && persone.filter(x => x.ruolo === 'titolare' && x.attivo).length < 2,
      on: { change: async ev => { try { await api('PATCH', `/utenti/${p.id}`, { ruolo: ev.target.value }); toast('Ruolo cambiato'); } catch (e) { toast(e.message, true); } } } },
      ruoli.map(r => h('option', { value: r.id, testo: r.nome, selected: r.id === p.ruolo })))),
    h('td', h('button.btn.piccolo', { testo: p.attivo ? 'Disattiva' : 'Riattiva', on: { click: async () => { try { await api('PATCH', `/utenti/${p.id}`, { attivo: !p.attivo }); utenti(contenitore, { schema }); } catch (e) { toast(e.message, true); } } } }))));
  contenitore.replaceChildren(
    h('div.testa', h('h1', 'Persone e permessi')),
    h('div.corpo',
      h('table.tabella', h('thead', h('tr', h('th', 'Nome'), h('th', 'Email'), h('th', 'Ruolo'), h('th'))), h('tbody', righe)),
      h('div.foglio', { stile: { marginTop: '16px' } }, h('div.etichetta', 'Nuova persona'), h('div.griglia', f.nome, f.email, f.password, f.ruolo, aggiungi)),
      h('h2', { stile: { fontSize: '17px', marginTop: '28px' } }, 'Ruoli'),
      h('p.nota', 'Il titolare può tutto. Per gli altri ruoli scegli, sezione per sezione, cosa possono fare.'),
      ...ruoli.filter(r => r.id !== 'titolare').map(r => editorRuolo(r, schema)),
      h('button.btn', { testo: '+ Nuovo ruolo', on: { click: async () => { const n = prompt('Nome del ruolo (es. Banco, Laboratorio)'); if (!n) return; const id = n.toLowerCase().replace(/[^a-z0-9]+/g, '_'); await api('PUT', `/ruoli/${id}`, { nome: n, entita: { '*': { leggi: true } } }); utenti(contenitore, { schema }); } } })));
}

function editorRuolo(r, schema) {
  const lavoro = structuredClone(r); lavoro.entita ||= {};
  const g = lavoro.entita['*'] || {};
  const AZ = [['leggi', 'Vede'], ['crea', 'Crea'], ['modifica', 'Modifica'], ['elimina', 'Archivia']];
  const cella = (e, a) => {
    const s = lavoro.entita[e.id]?.[a]; const val = s ?? g[a] ?? false;
    return h('td', { stile: { textAlign: 'center' } }, h('input', { type: 'checkbox', checked: !!val, on: { change: ev => { lavoro.entita[e.id] = { ...(lavoro.entita[e.id] || {}), [a]: ev.target.checked }; } } }));
  };
  const nascosti = e => {
    const camp = lavoro.entita[e.id]?.campi || {};
    return h('td', h('select.campo', { multiple: true, size: 1, title: 'Campi nascosti a questo ruolo', stile: { minWidth: '160px' }, on: { change: ev => {
      const campi = Object.fromEntries([...ev.target.selectedOptions].map(o => [o.value, 'nascosto'])); lavoro.entita[e.id] = { ...(lavoro.entita[e.id] || {}), campi }; } } },
      e.campi.filter(c => !c.archiviato).map(c => h('option', { value: c.id, testo: c.nome, selected: camp[c.id] === 'nascosto' }))));
  };
  const salva = h('button.btn.pieno.piccolo', { testo: 'Salva il ruolo', on: { click: async () => { try { await api('PUT', `/ruoli/${r.id}`, lavoro); toast('Ruolo salvato'); } catch (e) { toast(e.message, true); } } } });
  return h('div.foglio', { stile: { marginBottom: '14px', overflowX: 'auto' } },
    h('div', { stile: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } }, h('b', r.nome),
      h('label', { stile: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } }, h('input', { type: 'checkbox', checked: !!lavoro.schema, on: { change: ev => { lavoro.schema = ev.target.checked; } } }), 'Può personalizzare'), salva),
    h('table.righe', h('thead', h('tr', h('th', 'Sezione'), AZ.map(([, n]) => h('th', { stile: { textAlign: 'center' } }, n)), h('th', 'Campi nascosti (⌘/Ctrl per sceglierne più d\'uno)'))),
      h('tbody', schema.filter(e => !e.nascosta).map(e => h('tr', h('td', e.nome), AZ.map(([a]) => cella(e, a)), nascosti(e))))));
}
