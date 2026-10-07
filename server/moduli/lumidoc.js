// Lumi per i documenti: gli strumenti dedicati alle fatture, registrati con il contratto k.lumi (lumi/registro.js).
//   fattura_nuova             (scrivi) cliente per nome, righe a parole; IVA, natura, ritenuta, cassa e bollo dedotti
//                             dall'azienda, dal cliente e dalle fatture già emesse; i controlli dello SDI PRIMA della conferma
//   fattura_emetti            (scrivi) la bozza prende il numero; si ferma se l'esportazione non passerebbe
//   fattura_nota_di_credito   (scrivi) storno totale o parziale (righe scelte o un importo), mai oltre il totale della fattura
//   fattura_controlla         (leggi)  gli stessi controlli dell'esportazione FatturaPA, in italiano semplice
//   fattura_esporta_xml       (leggi)  il file FatturaPA: arriva al browser come file da salvare, al modello solo il nome
//   fattura_stampa            (leggi)  la stampa in HTML (dal browser «Stampa → Salva come PDF»)
//   fatture_da_incassare      (leggi)  quanto devono i clienti: emesse non pagate, scadute, per cliente
//   fatture_da_pagare         (leggi)  quanto devi ai fornitori: ricevute da pagare, scadute, per fornitore
// In più, la scheda di conferma dei crea_fatture / modifica_fatture generati dallo schema mostra righe, IVA e totale, e su una
// fattura emessa ferma la modifica e propone la nota di credito. Le etichette della scheda passano dai cataloghi del server
// (lingue/<cod>.js, chiavi «lumidoc-…»); quello che legge solo il modello resta in italiano.
// Ogni lettura e scrittura passa da dati.js con il ctx di chi chiede: permessi e campi nascosti sono quelli dell'interfaccia.
import { azienda, notaDiCredito, preparaXml, stampa } from './documenti.js';
import { controlla, contiFattura, xml, progressivoDa, fiscaliCliente } from './documenti-xml.js';
import { NATURE } from './documenti-calcoli.js';
import { bloccata, MODIFICABILI } from './fatture-regole.js';
import { pivaValida } from './documenti-italia.js';
import { giornoDi } from './agenda-aggregati.js';
import { testo, traduci } from './lingue.js';

const FATTURE = 'fatture', RICEVUTE = 'fatture_ricevute';
const ID = /^[0-9A-HJKMNP-TV-Z]{17}$/;
// Le aliquote IVA italiane: 22% ordinaria, 10% e 5% ridotte, 4% minima. Fonte: DPR 633/72, art. 16 e Tabella A (parti II, II-bis
// e III), agenziaentrate.gov.it «Aliquote IVA». Un'altra aliquota non si rifiuta (operazioni con l'estero), ma si segnala.
const ALIQUOTE = [22, 10, 5, 4];
// Il regime forfettario: niente IVA (natura N2.2) e compensi non soggetti a ritenuta d'acconto. Fonte: L. 190/2014, art. 1
// c. 54-89 (c. 58 lett. a per l'IVA, c. 67 per la ritenuta); specifiche FatturaPA: RegimeFiscale RF19.
const FORFETTARIO = 'RF19';
const LOCALE = { it: 'it-IT', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR' };
const STORNI = ['TD04'];   // la nota di credito (TipoDocumento TD04, XSD FatturaPA 1.2.2)

// un problema che il modello deve leggere e risolvere (chiedere un dato, cercare meglio): torna come { errore }
class Problema extends Error {}

export default function registra({ db, S, D, P, meta, lumi }) {
  if (!lumi) return;
  const c = (l, k, p) => testo(l, `lumidoc-${k}`, p);
  const soldi = (n, l = 'it') => new Intl.NumberFormat(LOCALE[l] || 'it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
  const num = (n, l = 'it') => new Intl.NumberFormat(LOCALE[l] || 'it-IT', { maximumFractionDigits: 4 }).format(Number(n) || 0);
  const dataIt = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v)) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : String(v ?? ''));
  const c2 = x => Math.round(Number(x) * 100) / 100;
  const sezione = id => { const d = S.leggi(db, id); return d && !d.archiviata ? d : null; };
  const puo = (ctx, e, az) => !!sezione(e) && P.puo(ctx, e, az);
  const campo = (def, id) => def?.campi.some(x => x.id === id && !x.archiviato);
  // ogni strumento risponde { errore } ai problemi da risolvere, e lascia passare gli errori veri (dati, permessi)
  const prova = f => async x => { try { return await f(x); } catch (e) { if (e instanceof Problema) return { errore: e.message }; throw e; } };

  // ---------- trovare cliente e fattura ----------
  const entClienti = () => sezione(FATTURE)?.campi.find(x => x.id === 'cliente')?.entita || 'clienti';
  function trovaCliente(ctx, chi) {
    const s = String(chi ?? '').trim(), ent = entClienti();
    if (!s) throw new Problema('Manca il cliente: chiedi a chi va la fattura.');
    if (ID.test(s)) { try { return D.leggi(db, ent, s, ctx, { conRighe: false }); } catch { /* non è un id: si cerca per nome */ } }
    const r = D.elenca(db, ent, { cerca: s, perPagina: 8 }, ctx).righe;
    const esatti = r.filter(x => String(x.nome ?? '').trim().toLowerCase() === s.toLowerCase()), scelti = esatti.length ? esatti : r;
    if (scelti.length === 1) return D.leggi(db, ent, scelti[0].id, ctx, { conRighe: false });
    if (!scelti.length) throw new Problema(`Non trovo il cliente «${s}». Chiedi se è un cliente nuovo: crealo con crea_${ent} con i dati che ti dà la persona (nome, partita IVA o codice fiscale, indirizzo), poi rifai la fattura. Non inventare i dati fiscali.`);
    throw new Problema(`Per «${s}» ci sono più clienti (${scelti.map(x => `${x.nome} = ${x.id}`).join('; ')}): chiedi quale e usa l'id.`);
  }
  function trovaFattura(ctx, rif, anno) {
    const s = String(rif ?? '').trim();
    if (!s) throw new Problema('Quale fattura? Serve il numero (per esempio 12) o l\'id.');
    if (ID.test(s)) { try { return D.leggi(db, FATTURE, s, ctx); } catch { /* si cerca per numero */ } }
    const n = s.replace(/^(n\.?|nr\.?|numero)\s*/i, '');
    const filtri = [{ campo: 'numero', op: '=', valore: n }];
    if (anno) filtri.push({ campo: 'data', op: 'tra', valore: [`${anno}-01-01`, `${anno}-12-31`] });
    const r = D.elenca(db, FATTURE, { filtri, perPagina: 10 }, ctx).righe;
    if (!r.length) throw new Problema(`Non trovo la fattura numero ${n}${anno ? ` del ${anno}` : ''}: cercala con cerca_fatture.`);
    if (r.length > 1) throw new Problema(`Ci sono più documenti numero ${n} (${r.map(x => `${x.nome_documento || x.numero} del ${dataIt(x.data)} = ${x.id}`).join('; ')}): chiedi quale e usa l'id o l'anno.`);
    return D.leggi(db, FATTURE, r[0].id, ctx);
  }
  const clienteDi = (ctx, f) => { if (!f.cliente?.id) return {}; try { return D.leggi(db, entClienti(), f.cliente.id, ctx, { conRighe: false }); } catch { return {}; } };

  // ---------- i controlli: gli stessi dell'esportazione, come se la fattura fosse già emessa ----------
  // (si tolgono solo quelli sul numero e sulla bozza, che si sistemano da soli all'emissione)
  const BOZZA = /ancora in bozza|Manca il numero della fattura/;
  const controlli = (f, cliente) => controlla(azienda(db, meta), { ...f, stato: 'emessa', numero: f.numero || '1' }, cliente).filter(x => !BOZZA.test(x));

  // ---------- la scheda di conferma: cliente, righe con i prezzi, imponibile, IVA, cassa, ritenuta, bollo, totale ----------
  function righeScheda(f, conti, l, { cliente, max = 5 } = {}) {
    const out = [];
    if (cliente) out.push([c(l, 'cliente'), cliente]);
    const linee = conti.linee.filter(x => !x.bollo), iva = x => (x.aliquota ? `${num(x.aliquota, l)}%` : x.natura || '0%');
    for (const x of linee.slice(0, linee.length > max ? max - 1 : max)) out.push([x.descrizione || '—', c(l, 'riga', { quantita: num(x.quantita, l), prezzo: soldi(x.prezzo, l), iva: iva(x), totale: soldi(x.totale, l) })]);
    if (linee.length > max) out.push([c(l, 'altre-righe', { n: linee.length - max + 1 }), soldi(linee.slice(max - 1).reduce((s, x) => s + x.totale, 0), l)]);
    if (conti.cassa) out.push([c(l, 'cassa', { aliquota: num(conti.cassa.aliquota, l) }), soldi(conti.cassa.importo, l)]);
    out.push([c(l, 'imponibile'), soldi(conti.imponibile - (conti.bollo && !f.bollo_tuo ? conti.bollo : 0), l)]);
    out.push([c(l, 'iva'), soldi(conti.imposta, l)]);
    if (conti.bollo) out.push([c(l, 'bollo'), f.bollo_tuo ? c(l, 'bollo-tuo') : soldi(conti.bollo, l)]);
    out.push([c(l, 'totale'), soldi(conti.totale, l)]);
    if (conti.ritenuta) out.push([c(l, 'ritenuta', { aliquota: num(f.ritenuta, l) }), `− ${soldi(conti.ritenuta, l)}`]);
    if (conti.netto !== conti.totale) out.push([c(l, 'netto'), soldi(conti.netto, l)]);
    return out;
  }
  const avvisiSdi = (errori, l) => errori.map(x => c(l, 'av-sdi', { _messaggio: traduci(x, l) }));

  // ---------- fattura nuova: dalle parole ai valori ----------
  const RIGA = { type: 'object', additionalProperties: false, properties: {
    descrizione: { type: 'string', maxLength: 1000, description: 'cosa (es. «Consulenza»)' }, quantita: { type: 'number', description: 'quantità (ore, pezzi); predefinito 1' },
    prezzo: { type: 'number', description: 'prezzo unitario in euro, SENZA IVA (salvo prezzi_ivati)' }, sconto: { type: 'number', minimum: 0, maximum: 100, description: 'sconto %' },
    aliquota: { type: 'number', minimum: 0, maximum: 100, description: 'IVA %: solo se la persona la dice; altrimenti la decide Kubo' },
    natura: { type: 'string', enum: Object.keys(NATURE), description: 'perché è senza IVA: solo se la persona lo dice (mai sceglierla tu)' },
    no_ritenuta: { type: 'boolean', description: 'riga esclusa dalla ritenuta (spese anticipate)' } }, required: ['descrizione', 'prezzo'] };
  function storico(ctx, cliente) {
    // l'ultima fattura emessa a un cliente con partita IVA: ritenuta e cassa di solito sono le stesse (si dice nella scheda)
    try {
      const r = D.elenca(db, FATTURE, { filtri: [{ campo: 'stato', op: 'in', valore: ['emessa', 'inviata', 'pagata'] }, { campo: 'tipo', op: 'in', valore: ['TD01', 'TD06', 'TD24'] }], perPagina: 200 }, ctx).righe;
      const conCliente = r.sort((a, b) => String(b.data).localeCompare(String(a.data)));
      return conCliente.find(x => x.cliente?.id === cliente.id) || conCliente[0] || null;
    } catch { return null; }
  }
  function preparaNuova(ctx, a, l) {
    const fdef = sezione(FATTURE);
    if (!fdef) throw new Problema('Qui non ci sono le fatture: si aggiunge il modello «Fatture e fattura elettronica» da Personalizza.');
    const az = azienda(db, meta), forf = az.regime === FORFETTARIO, avvisi = [];
    const cl = trovaCliente(ctx, a.cliente), fc = fiscaliCliente(cl);
    if (!(a.righe || []).length) throw new Problema('Mancano le righe: chiedi cosa va in fattura e a che prezzo.');
    let aliquotaStrana = null;
    const righe = a.righe.map((r, i) => {
      const nome = r.descrizione || `riga ${i + 1}`;
      if (!Number.isFinite(Number(r.prezzo))) throw new Problema(`Manca il prezzo di «${nome}»: chiedilo.`);
      let aliquota = r.aliquota, natura = r.natura || null;
      if (forf) { aliquota = 0; natura = 'N2.2'; }
      else if (aliquota == null) aliquota = natura ? 0 : Number(az.aliquota ?? 22);
      aliquota = Number(aliquota);
      if (!aliquota && !natura) throw new Problema(`«${nome}» è senza IVA ma manca la natura, cioè il motivo (N2.2 fuori campo, N4 esente, N3.x non imponibile, N6.x inversione contabile…). Chiedila alla persona o al suo commercialista: non sceglierla tu.`);
      if (aliquota && natura) natura = null;
      if (aliquota && !ALIQUOTE.includes(aliquota)) aliquotaStrana = aliquota;
      const prezzo = a.prezzi_ivati && aliquota ? Math.round(Number(r.prezzo) / (1 + aliquota / 100) * 1e8) / 1e8 : Number(r.prezzo);
      return { descrizione: String(r.descrizione).slice(0, 1000), quantita: r.quantita == null ? 1 : Number(r.quantita), prezzo, ...(r.sconto ? { sconto: Number(r.sconto) } : {}),
        aliquota, ...(natura ? { natura } : {}), ...(r.no_ritenuta ? { no_ritenuta: true } : {}) };
    });
    if (forf) avvisi.push(c(l, 'av-forfettario'));
    if (aliquotaStrana != null) avvisi.push(c(l, 'av-aliquota', { aliquota: num(aliquotaStrana, l) }));
    const f = { tipo: a.tipo || 'TD01', cliente: cl.id, data: a.data || giornoDi(new Date()), righe };
    if (a.scadenza) f.scadenza = a.scadenza;
    if (a.causale) f.causale = String(a.causale).slice(0, 2000);
    // ritenuta e cassa: dette dalla persona, altrimenti come nelle fatture già emesse. La ritenuta non si deduce mai verso un
    // privato (un consumatore non è sostituto d'imposta: art. 25 DPR 600/73) e non c'è mai nel forfettario
    const prima = storico(ctx, cl);
    let pct = null, dedotta = false;
    if (forf) { if (a.ritenuta) avvisi.push(c(l, 'av-no-ritenuta')); }
    else if (typeof a.ritenuta === 'number' && a.ritenuta > 0) pct = a.ritenuta;
    else if (a.ritenuta === true) { pct = Number(prima?.ritenuta) || null; if (!pct) throw new Problema('Di quanto è la ritenuta d\'acconto? Chiedilo alla persona (per un professionista di solito è il 20%).'); }
    else if (a.ritenuta == null && !fc.privato && Number(prima?.ritenuta)) { pct = Number(prima.ritenuta); dedotta = true; }
    if (pct) {
      // il tipo dipende da chi emette: persona fisica (codice fiscale di 16 caratteri) RT01, società RT02 (TipoRitenutaType, XSD 1.2.2)
      const tipoDa = String(az.codice_fiscale || '').length === 16 ? 'RT01' : pivaValida(az.codice_fiscale || '').valore ? 'RT02' : 'RT01';
      const causale = a.ritenuta_causale || prima?.ritenuta_causale;
      if (!causale) throw new Problema('Per la ritenuta d\'acconto serve la causale del pagamento del modello 770/CU (per un lavoro autonomo abituale di solito è «A»): chiedila alla persona.');
      Object.assign(f, { ritenuta: pct, ritenuta_tipo: a.ritenuta_tipo || (prima?.ritenuta_tipo) || tipoDa, ritenuta_causale: causale });
      if (dedotta) avvisi.push(c(l, 'av-ritenuta', { aliquota: num(pct, l) }));
    }
    const cassa = a.cassa || (prima?.cassa_tipo && Number(prima.cassa) ? { tipo: prima.cassa_tipo, aliquota: prima.cassa, iva: prima.cassa_iva } : null);
    if (cassa && a.cassa !== false) {
      Object.assign(f, { cassa_tipo: cassa.tipo, cassa: Number(cassa.aliquota), ...(cassa.iva != null && cassa.iva !== '' ? { cassa_iva: Number(cassa.iva) } : {}) });
      if (!a.cassa) avvisi.push(c(l, 'av-cassa', { aliquota: num(cassa.aliquota, l) }));
    }
    if (forf && f.cassa_tipo && f.cassa_iva == null) f.cassa_iva = 0;
    // il bollo: dovuto se le operazioni senza IVA superano 77,47 € (documenti-calcoli.js, con la fonte); di solito lo paga il cliente
    if (contiFattura(f).serveBollo) { f.bollo = true; if (a.bollo_tuo) f.bollo_tuo = true; avvisi.push(c(l, 'av-bollo')); }
    for (const k of Object.keys(f)) if (k !== 'righe' && !campo(fdef, k)) delete f[k];
    const errori = controlli(f, cl);
    return { f, cliente: cl, conti: contiFattura(f), avvisi: [...avvisi, ...avvisiSdi(errori, l)], errori };
  }

  const FATTURA = { fattura: { type: 'string', maxLength: 40, description: 'il numero (es. 12 o 12/A) o l\'id' }, anno: { type: 'integer', minimum: 2000, maximum: 2100, description: 'se ci sono numeri uguali in anni diversi' } };
  const perFatture = az => ctx => puo(ctx, FATTURE, az);

  lumi.strumento({
    nome: 'fattura_nuova', tipo: 'scrivi', permesso: perFatture('crea'),
    descrizione: 'Prepara una fattura nuova (in bozza) per un cliente, dalle parole della persona: «3 ore di consulenza a 80 euro più IVA» = una riga quantita 3, prezzo 80. IVA, natura, ritenuta, cassa e bollo li decide Kubo dalle impostazioni dell\'azienda, dal cliente e dalle fatture già emesse: passali solo se la persona li dice. La scheda mostra i conti e i controlli dello SDI.',
    schema: { type: 'object', additionalProperties: false, properties: {
      cliente: { type: 'string', maxLength: 200, description: 'il nome del cliente (o il suo id)' }, righe: { type: 'array', minItems: 1, maxItems: 100, items: RIGA },
      prezzi_ivati: { type: 'boolean', description: 'true se i prezzi detti comprendono già l\'IVA («IVA inclusa»)' },
      data: { type: 'string', maxLength: 10, description: 'AAAA-MM-GG, predefinita oggi' }, scadenza: { type: 'string', maxLength: 10, description: 'scadenza del pagamento AAAA-MM-GG' },
      tipo: { type: 'string', enum: ['TD01', 'TD06', 'TD24'], description: 'TD01 fattura (predefinito), TD06 parcella, TD24 differita' },
      ritenuta: { type: ['number', 'boolean'], description: 'ritenuta d\'acconto %, o false per nessuna; solo se la persona lo dice' },
      ritenuta_tipo: { type: 'string', enum: ['RT01', 'RT02'] }, ritenuta_causale: { type: 'string', maxLength: 2, description: 'causale 770/CU (es. A): solo se la dice la persona' },
      cassa: { type: 'object', properties: { tipo: { type: 'string', pattern: '^TC\\d\\d$' }, aliquota: { type: 'number' }, iva: { type: 'number' } }, required: ['tipo', 'aliquota'] },
      bollo_tuo: { type: 'boolean', description: 'true se il bollo lo paghi tu e non lo addebiti al cliente' }, causale: { type: 'string', maxLength: 2000 },
    }, required: ['cliente', 'righe'] },
    anteprima: prova(async ({ ctx, args, lingua: l }) => {
      const x = preparaNuova(ctx, args, l);
      return { titolo: c(l, 'nuova'), righe: righeScheda(x.f, x.conti, l, { cliente: x.cliente.nome }), avvisi: x.avvisi, nota: c(l, 'in-bozza') };
    }),
    esegui: prova(async ({ ctx, args }) => {
      const x = preparaNuova(ctx, args, 'it'), nuova = D.crea(db, FATTURE, x.f, ctx);
      return { testo: `Fatto: fattura in bozza per ${x.cliente.nome}, totale ${soldi(x.conti.totale)}.`, entita: FATTURE, id: nuova.id, stato: nuova.stato, totale: x.conti.totale, netto: x.conti.netto,
        ...(x.errori.length ? { da_sistemare_prima_di_emettere: x.errori } : {}) };
    }),
  });

  lumi.strumento({
    nome: 'fattura_emetti', tipo: 'scrivi', permesso: perFatture('modifica'),
    descrizione: 'Emette una fattura in bozza: prende il suo numero e da lì non si modifica più. Se i controlli dello SDI non passano, dice cosa sistemare.',
    schema: { type: 'object', additionalProperties: false, properties: FATTURA, required: ['fattura'] },
    anteprima: prova(async ({ ctx, args, lingua: l }) => {
      const f = trovaFattura(ctx, args.fattura, args.anno);
      if (bloccata(f)) throw new Problema(`${f.nome_documento || `La fattura ${f.numero}`} è già emessa. Per correggerla proponi una nota di credito (fattura_nota_di_credito).`);
      const cliente = clienteDi(ctx, f), errori = controlli(f, cliente);
      if (errori.length) throw new Problema(`Prima di emetterla va sistemato: ${errori.join(' ')} Dillo alla persona; i dati del cliente si correggono con modifica_${entClienti()}, quelli della fattura con modifica_fatture.`);
      return { titolo: c(l, 'emetti'), righe: [[c(l, 'numero'), c(l, 'numero-nuovo')], [c(l, 'data'), dataIt(f.data || giornoDi(new Date()))], ...righeScheda(f, contiFattura(f), l, { cliente: cliente.nome, max: 3 })], avvisi: [], nota: c(l, 'dopo-emissione') };
    }),
    esegui: prova(async ({ ctx, args }) => {
      const f = trovaFattura(ctx, args.fattura, args.anno);
      if (bloccata(f)) throw new Problema(`È già emessa con il numero ${f.numero}.`);
      const errori = controlli(f, clienteDi(ctx, f)); if (errori.length) throw new Problema(`Non emessa: ${errori.join(' ')}`);
      const x = D.modifica(db, FATTURE, f.id, { stato: 'emessa' }, ctx);
      return { testo: `Fatto: emessa con il numero ${x.numero}.`, entita: FATTURE, id: x.id, numero: x.numero, data: x.data };
    }),
  });

  // la nota di credito: totale (come il bottone «Nota di credito») o parziale, con le righe scelte o un importo
  function preparaNota(ctx, a, l) {
    const f = trovaFattura(ctx, a.fattura, a.anno);
    if (!bloccata(f)) throw new Problema(`${f.nome_documento || 'Questa fattura'} è ancora in bozza: si corregge direttamente con modifica_fatture, senza nota di credito.`);
    if (STORNI.includes(f.tipo)) throw new Problema('È già una nota di credito: non si storna una nota di credito.');
    let righe = (f.righe || []).map(r => ({ descrizione: r.descrizione, quantita: r.quantita, prezzo: r.prezzo, sconto: r.sconto, sconto_importo: r.sconto_importo, aliquota: r.aliquota, natura: r.natura, no_ritenuta: r.no_ritenuta }));
    if (a.righe?.length) {
      righe = a.righe.map(x => {
        if (x.n != null) {
          const o = righe[x.n - 1]; if (!o) throw new Problema(`La fattura ${f.numero} ha ${righe.length} righe: la riga ${x.n} non c'è.`);
          const q = x.quantita ?? o.quantita; if (Number(q) > Number(o.quantita ?? 1)) throw new Problema(`Della riga ${x.n} si stornano al massimo ${o.quantita}.`);
          return { ...o, quantita: q };
        }
        const aliquote = [...new Set(righe.map(r => `${Number(r.aliquota) || 0}|${r.natura || ''}`))];
        if (x.aliquota == null && aliquote.length > 1) throw new Problema(`La fattura ${f.numero} ha più aliquote IVA: chiedi su quale si fa lo storno di «${x.descrizione}».`);
        const [al, nat] = x.aliquota != null ? [Number(x.aliquota), Number(x.aliquota) ? '' : righe.find(r => !Number(r.aliquota))?.natura || ''] : aliquote[0].split('|');
        if (!Number(al) && !nat) throw new Problema('Lo storno è senza IVA ma manca la natura: chiedila.');
        return { descrizione: x.descrizione || `Storno parziale della fattura ${f.numero}`, quantita: x.quantita ?? 1, prezzo: Number(x.prezzo), aliquota: Number(al), ...(nat ? { natura: nat } : {}) };
      });
    }
    for (const r of righe) for (const k of Object.keys(r)) if (r[k] == null) delete r[k];
    const nc = { tipo: 'TD04', cliente: f.cliente?.id ?? null, collegata: f.id, data: giornoDi(new Date()), riferimento: `Storno della fattura ${f.numero} del ${dataIt(f.data)}${a.motivo ? `: ${String(a.motivo).slice(0, 120)}` : ''}`,
      ritenuta: f.ritenuta, ritenuta_tipo: f.ritenuta_tipo, ritenuta_causale: f.ritenuta_causale, bollo: f.bollo, bollo_tuo: f.bollo_tuo, modalita: f.modalita,
      cassa_tipo: f.cassa_tipo, cassa: f.cassa, cassa_iva: f.cassa_iva, esigibilita: f.esigibilita, cig: f.cig, cup: f.cup, righe };
    const fdef = sezione(FATTURE); for (const k of Object.keys(nc)) if (k !== 'righe' && (nc[k] == null || !campo(fdef, k))) delete nc[k];
    // il bollo della nota segue il suo importo, non quello della fattura
    if (nc.bollo && !contiFattura({ ...nc, bollo: false }).serveBollo) delete nc.bollo;
    const conti = contiFattura(nc), originale = contiFattura(f);
    // quanto è già stato stornato con altre note di credito: lo storno non supera mai la fattura
    const gia = D.elenca(db, FATTURE, { filtri: [{ campo: 'collegata', op: '=', valore: f.id }, { campo: 'tipo', op: '=', valore: 'TD04' }], perPagina: 100 }, ctx).righe
      .filter(x => x.stato !== 'annullata').reduce((s, x) => s + (Number(x.totale) || 0), 0);
    if (c2(gia + conti.totale) > c2(originale.totale)) throw new Problema(`Lo storno (${soldi(conti.totale)}) supera quello che resta della fattura ${f.numero}: totale ${soldi(originale.totale)}, già stornati ${soldi(gia)}.`);
    const avvisi = gia ? [c(l, 'av-gia-stornato', { importo: soldi(gia, l) })] : [];
    return { f, nc, conti, avvisi, parziale: !!a.righe?.length, cliente: f.cliente?.titolo || '' };
  }
  lumi.strumento({
    nome: 'fattura_nota_di_credito', tipo: 'scrivi', permesso: perFatture('crea'),
    descrizione: 'Prepara la nota di credito (TD04, in bozza) che storna una fattura emessa: tutta, oppure in parte con «righe» (n = numero della riga della fattura, con la quantità da stornare; oppure descrizione e prezzo per uno sconto o un abbuono). È il modo giusto per correggere una fattura emessa.',
    schema: { type: 'object', additionalProperties: false, properties: { ...FATTURA, motivo: { type: 'string', maxLength: 200 },
      righe: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, properties: {
        n: { type: 'integer', minimum: 1, description: 'riga della fattura da stornare (1 = la prima)' }, quantita: { type: 'number' },
        descrizione: { type: 'string', maxLength: 1000 }, prezzo: { type: 'number', description: 'importo senza IVA da stornare' }, aliquota: { type: 'number' } } } } }, required: ['fattura'] },
    anteprima: prova(async ({ ctx, args, lingua: l }) => {
      const x = preparaNota(ctx, args, l);
      return { titolo: c(l, x.parziale ? 'nota-parziale' : 'nota'), righe: [[c(l, 'storna'), c(l, 'storna-di', { numero: x.f.numero, data: dataIt(x.f.data) })], ...righeScheda(x.nc, x.conti, l, { cliente: x.cliente, max: 4 })], avvisi: x.avvisi, nota: c(l, 'in-bozza') };
    }),
    esegui: prova(async ({ ctx, args }) => {
      const x = preparaNota(ctx, args, 'it');
      const nota = x.parziale ? D.crea(db, FATTURE, x.nc, ctx) : notaDiCredito(db, { S, D, P, ErroreHttp: Errore }, x.f.id, ctx);
      return { testo: `Fatto: nota di credito in bozza per la fattura ${x.f.numero}, ${soldi(x.conti.totale)}. Va emessa come una fattura.`, entita: FATTURE, id: nota.id, totale: x.conti.totale };
    }),
  });

  lumi.strumento({
    nome: 'fattura_controlla', tipo: 'leggi', permesso: perFatture('leggi'),
    descrizione: 'Controlla una fattura come farebbe lo SDI (dati dell\'azienda e del cliente, nature, ritenuta, bollo, totali) e dice cosa manca, in italiano semplice.',
    schema: { type: 'object', additionalProperties: false, properties: FATTURA, required: ['fattura'] },
    esegui: prova(async ({ ctx, args }) => {
      const f = trovaFattura(ctx, args.fattura, args.anno), errori = controlli(f, clienteDi(ctx, f)), k = contiFattura(f);
      return { fattura: f.nome_documento || f.numero, stato: f.stato, pronta: !errori.length && bloccata(f), errori, ...(bloccata(f) ? {} : { nota: 'è in bozza: va emessa (fattura_emetti)' }),
        imponibile: k.imponibile, iva: k.imposta, ritenuta: k.ritenuta, bollo: k.bollo, totale: k.totale, netto: k.netto };
    }),
  });
  lumi.strumento({
    nome: 'fattura_esporta_xml', tipo: 'leggi', permesso: perFatture('leggi'),
    descrizione: 'Prepara il file XML FatturaPA di una fattura emessa e lo dà da salvare alla persona (per caricarlo sul portale dell\'Agenzia o mandarlo al suo intermediario). Se qualcosa non va, dice cosa sistemare.',
    schema: { type: 'object', additionalProperties: false, properties: FATTURA, required: ['fattura'] },
    esegui: prova(async ({ ctx, args }) => {
      const f0 = trovaFattura(ctx, args.fattura, args.anno);
      const { errori, az, f, cliente } = preparaXml(db, { S, D, meta }, f0.id, ctx);
      if (errori.length) return { errore: `Il file non si può ancora fare: ${errori.join(' ')}`, errori };
      const n = Number(D.prossimoNumero(db, 'fatturapa', '{N}'));   // lo stesso progressivo d'invio del bottone: mai ripetuto
      const file = xml(az, f, cliente, { progressivo: progressivoDa(n) });
      return { testo: `File ${file.nome} pronto.`, nome: file.nome, formato: file.formato, scarica: { nome: file.nome, tipo: 'application/xml', contenuto: file.xml } };
    }),
  });
  lumi.strumento({
    nome: 'fattura_stampa', tipo: 'leggi', permesso: perFatture('leggi'),
    descrizione: 'Prepara la stampa di una fattura (anche in bozza) come pagina da aprire: da lì «Stampa → Salva come PDF».',
    schema: { type: 'object', additionalProperties: false, properties: FATTURA, required: ['fattura'] },
    esegui: prova(async ({ ctx, args }) => {
      const f = trovaFattura(ctx, args.fattura, args.anno), s = stampa(db, { S, D, meta }, FATTURE, f.id, ctx);
      const nome = `${s.titolo || 'Fattura'}`.replace(/[^\p{L}\p{N} ._-]+/gu, '-').slice(0, 80) + '.html';
      return { testo: `Stampa pronta: ${nome}.`, nome, scarica: { nome, tipo: 'text/html', contenuto: s.html } };
    }),
  });

  // ---------- da incassare e da pagare ----------
  function aperte(ctx, ent, filtri) {
    const out = []; for (let p = 1; p <= 20; p++) { const r = D.elenca(db, ent, { filtri, perPagina: 500, pagina: p }, ctx); out.push(...r.righe); if (out.length >= r.totale || !r.righe.length) break; }
    return out;
  }
  function riassumi(righe, chi, segno = () => 1) {
    const oggi = giornoDi(new Date()), gruppi = new Map(); let totale = 0, scaduto = 0, nScadute = 0;
    const elenco = righe.map(x => {
      const importo = c2(segno(x) * (Number(x.netto ?? x.totale) || 0)), scad = !!x.scadenza && x.scadenza < oggi;
      totale += importo; if (scad) { scaduto += importo; nScadute++; }
      const g = gruppi.get(x[chi]?.titolo || '—') || { importo: 0, documenti: 0, scaduto: 0 }; g.importo += importo; g.documenti++; if (scad) g.scaduto += importo; gruppi.set(x[chi]?.titolo || '—', g);
      return { documento: x.nome_documento || x.numero, id: x.id, data: x.data, [chi]: x[chi]?.titolo, importo, scadenza: x.scadenza || null, scaduta: scad };
    });
    return { totale: c2(totale), documenti: righe.length, scadute: { documenti: nScadute, importo: c2(scaduto) },
      [`per_${chi}`]: [...gruppi].map(([nome, g]) => ({ [chi]: nome, importo: c2(g.importo), documenti: g.documenti, scaduto: c2(g.scaduto) })).sort((a, b) => b.importo - a.importo).slice(0, 15),
      elenco: elenco.sort((a, b) => String(a.scadenza || a.data).localeCompare(String(b.scadenza || b.data))).slice(0, 20) };
  }
  lumi.strumento({
    nome: 'fatture_da_incassare', tipo: 'leggi', permesso: perFatture('leggi'),
    descrizione: 'Quanto devono i clienti: le fatture emesse o inviate e non ancora pagate (al netto di ritenuta e note di credito), le scadute e il totale per cliente. Per «quanto mi devono», «chi non ha pagato».',
    schema: { type: 'object', additionalProperties: false, properties: { cliente: { type: 'string', maxLength: 200, description: 'solo questo cliente (nome o id)' } } },
    esegui: prova(async ({ ctx, args }) => {
      const filtri = [{ campo: 'stato', op: 'in', valore: ['emessa', 'inviata'] }];
      if (args.cliente) filtri.push({ campo: 'cliente', op: '=', valore: trovaCliente(ctx, args.cliente).id });
      // le rate già segnate pagate di una fattura pagata solo in parte si tolgono (fino a 500 fatture aperte, poi si dice)
      const righe = aperte(ctx, FATTURE, filtri), rate = campo(sezione(FATTURE), 'rate');
      if (rate && righe.length <= 500) for (const x of righe) {
        let r; try { r = D.leggi(db, FATTURE, x.id, ctx).rate || []; } catch { r = []; }
        const pagato = r.filter(y => y.pagata).reduce((t, y) => t + (Number(y.importo) || 0), 0);
        if (pagato) x.netto = c2((Number(x.netto ?? x.totale) || 0) - pagato);
      }
      return { ...riassumi(righe, 'cliente', x => (STORNI.includes(x.tipo) ? -1 : 1)), ...(rate && righe.length > 500 ? { nota: 'oltre 500 fatture aperte le rate già pagate non sono tolte' } : {}) };
    }),
  });
  lumi.strumento({
    nome: 'fatture_da_pagare', tipo: 'leggi', permesso: ctx => puo(ctx, RICEVUTE, 'leggi'),
    descrizione: 'Quanto devi ai fornitori: le fatture ricevute da pagare, le scadute e il totale per fornitore. Per «quanto devo pagare», «cosa scade».',
    schema: { type: 'object', additionalProperties: false, properties: {} },
    esegui: prova(async ({ ctx }) => riassumi(aperte(ctx, RICEVUTE, [{ campo: 'stato', op: '=', valore: 'da_pagare' }]), 'fornitore')),
  });

  // ---------- i crea_fatture / modifica_fatture generati dallo schema ----------
  lumi.sostituisce('crea_fatture');   // per una fattura nuova c'è fattura_nuova, che deduce e controlla
  lumi.scheda(FATTURE, prova(async ({ ctx, valori, id, lingua: l }) => {
    const prima = id ? D.leggi(db, FATTURE, id, ctx) : null;
    if (bloccata(prima) && Object.keys(valori).some(k => !MODIFICABILI.has(k)))
      return { errore: `${prima.nome_documento || `La fattura ${prima.numero}`} è emessa: non si modifica più, nemmeno a parole. Proponi una nota di credito con fattura_nota_di_credito (totale o con le righe da stornare).` };
    const f = { ...(prima || {}), ...valori };
    if (!Array.isArray(f.righe) || !f.righe.length) return {};
    const cid = f.cliente?.id ?? f.cliente, cliente = cid ? clienteDi(ctx, { cliente: { id: cid } }) : {};
    return { righe: righeScheda(f, contiFattura(f), l).filter(([k]) => k !== c(l, 'cliente')), avvisi: avvisiSdi(controlli(f, cliente), l) };
  }));

  lumi.istruzioni([
    'Fatture e documenti: per una fattura nuova usa fattura_nuova con il cliente per nome e le righe come le dice la persona («3 ore di consulenza a 80 euro più IVA» = quantita 3, prezzo 80; «IVA inclusa» = prezzi_ivati). IVA, natura, ritenuta, cassa e bollo li decide Kubo dalle impostazioni dell\'azienda, dal cliente e dalle fatture già emesse: non passarli se la persona non li dice. La fattura nasce in bozza: dopo chiedi se emetterla (fattura_emetti).',
    'Non inventare mai partite IVA, codici fiscali, codici destinatario, PEC, aliquote, nature IVA, causali o codici tributo: se uno strumento dice che manca un dato, chiedilo alla persona. «Senza IVA» in regime ordinario vuole il motivo (la natura): chiedilo.',
    'Una fattura emessa non si cambia, nemmeno a parole: proponi la nota di credito (fattura_nota_di_credito, totale o con le righe da stornare). Per i controlli dello SDI usa fattura_controlla; per il file XML fattura_esporta_xml; per la stampa o il PDF fattura_stampa; per «quanto mi devono» fatture_da_incassare; per «quanto devo pagare» fatture_da_pagare. Per spedire la fattura al cliente o allo SDI non hai uno strumento: di\' alla persona di salvare il file e caricarlo dal suo canale (portale dell\'Agenzia delle Entrate o intermediario).',
    'Quando serve un professionista dillo con una frase chiara, senza giri: visto di conformità, dichiarazioni dei redditi o IVA presentate per conto di altri, scelta o cambio del regime fiscale, concordato, ravvedimenti, bilanci e ogni consulenza fiscale li fa un commercialista o un CAF. Tu puoi preparare i numeri da portargli.',
  ].join('\n'));
}

// l'ErroreHttp che notaDiCredito() vuole: qui le sue frasi diventano problemi da leggere per il modello
class Errore extends Problema { constructor(stato, m) { super(m); this.stato = stato; } }
