/* Gym — app per registrare gli allenamenti. JavaScript semplice, senza librerie.
 *
 * Come funziona, in breve:
 * - Tutti i dati stanno in memoria (oggetto D) e in IndexedDB, la memoria del telefono.
 * - Ogni modifica passa da salva(): aggiorna «aggiornato_il», scrive in IndexedDB
 *   e mette la riga nella «coda» delle cose da mandare al foglio.
 * - sincronizza() manda la coda al ponte (Apps Script) e poi scarica le novità dal foglio.
 */
'use strict';

/* ======================= Costanti ======================= */

const SI = 'sì', NO = 'no';
// Numero di versione mostrato nelle Impostazioni: va cambiato insieme a VERSIONE in sw.js.
const VERSIONE_APP = 17;

// Le colonne di ogni scheda del foglio: sono il «contratto», non vanno cambiate.
const COLONNE = {
  Esercizi: ['id', 'nome', 'nome_strong', 'tipo', 'attrezzo', 'gruppo', 'area', 'recupero_s', 'nota', 'origine', 'archiviato', 'aggiornato_il', 'eliminato'],
  // sedute_settimana (aggiunta l'08/11/2026, in fondo a destra): quante volte a settimana è previsto il modello.
  // Se nel foglio la colonna non c'è ancora, il ponte la ignora senza errori.
  Modelli: ['id', 'nome', 'cartella', 'ordine', 'nota', 'aggiornato_il', 'eliminato', 'sedute_settimana'],
  ModelliEsercizi: ['id', 'modello_id', 'posizione', 'esercizio_id', 'superserie_id', 'recupero_s', 'nota', 'aggiornato_il', 'eliminato'],
  ModelliSerie: ['id', 'modello_esercizio_id', 'posizione', 'tipo', 'lato', 'peso_kg', 'rip', 'durata_s', 'rpe_previsto', 'aggiornato_il', 'eliminato'],
  // pausa_s e pausa_dal (aggiunte l'08/11/2026, in fondo a destra): secondi totali di pausa e inizio della pausa in corso.
  Sessioni: ['id', 'titolo', 'modello_id', 'inizio', 'fine', 'nota', 'aggiornato_il', 'eliminato', 'pausa_s', 'pausa_dal'],
  SessioniEsercizi: ['id', 'sessione_id', 'posizione', 'esercizio_id', 'superserie_id', 'nota',
    'ginocchio_pienezza', 'ginocchio_pienezza_nota', 'ginocchio_dolore', 'ginocchio_dolore_nota',
    'malleolo_dolore', 'malleolo_dolore_nota', 'achille_dolore', 'achille_dolore_nota', 'aggiornato_il', 'eliminato'],
  Serie: ['id', 'sessione_esercizio_id', 'posizione', 'tipo', 'lato', 'peso_kg', 'rip', 'durata_s', 'rpe', 'fatta', 'aggiornato_il', 'eliminato'],
  Test: ['id', 'data', 'tipo', 'lato', 'valore', 'unita', 'dolore', 'nota', 'aggiornato_il', 'eliminato', 'origine'],
  // Diario (09/11/2026). DiarioCampi e Farmaci l'app li legge soltanto (li scrivono Giosuè o Claude in chat).
  DiarioCampi: ['id', 'sezione', 'etichetta', 'tipo', 'ha_nota', 'ordine', 'attivo', 'scala_min', 'scala_max', 'opzioni', 'aiuto', 'aggiornato_il', 'eliminato'],
  Farmaci: ['id', 'nome', 'tipo', 'dose_testo', 'previste_al_giorno', 'dal', 'al', 'nota', 'aggiornato_il', 'eliminato'],
  DiarioValori: ['id', 'giorno', 'campo_id', 'campo_etichetta', 'valore', 'nota', 'aggiornato_il', 'eliminato'],
  DiarioFarmaci: ['id', 'giorno', 'farmaco_id', 'farmaco_nome', 'previste', 'prese', 'nota', 'aggiornato_il', 'eliminato'],
};
const SCHEDE = Object.keys(COLONNE);
// Le schede del Diario si chiedono a parte, e solo al ponte versione 4 o successiva:
// un ponte più vecchio rifiuterebbe tutta la richiesta e bloccherebbe la sincronizzazione.
const SCHEDE_DIARIO = ['DiarioCampi', 'Farmaci', 'DiarioValori', 'DiarioFarmaci'];
const SCHEDE_BASE = SCHEDE.filter(s => !SCHEDE_DIARIO.includes(s));
const PONTE_DIARIO = 4;

// Per ogni scheda «figlia», la colonna che indica la riga «madre».
const PADRE = { Serie: 'sessione_esercizio_id', SessioniEsercizi: 'sessione_id', ModelliSerie: 'modello_esercizio_id', ModelliEsercizi: 'modello_id' };

// Campi di riabilitazione per area (§6 del brief).
const RIAB = {
  ginocchio: { titolo: 'Riabilitazione ginocchio', campi: [['ginocchio_pienezza', 'Pienezza'], ['ginocchio_dolore', 'Dolore']] },
  caviglia: { titolo: 'Riabilitazione caviglia', campi: [['malleolo_dolore', 'Malleolo'], ['achille_dolore', 'Achille']] },
};

const TIPI_ES = { peso_rip: 'Peso e ripetizioni', rip: 'Solo ripetizioni', durata: 'Durata', peso_durata: 'Peso e durata', cardio: 'Cardio' };
const TIPI_SERIE = { normale: 'Normale', riscaldamento: 'Riscaldamento', cedimento: 'Cedimento' };
const LATI = { entrambi: 'Entrambi', dx: 'Destro', sx: 'Sinistro' };
const AREE = { altro: 'Altro', ginocchio: 'Ginocchio', caviglia: 'Caviglia' };
// Test di riabilitazione (§5.5 del brief). Ogni prova = una riga per lato, con la stessa data (solo il giorno).
const TEST = {
  wblt: { nome: 'WBLT', breve: 'WBLT', unita: 'cm' },
  heel_raise: { nome: 'Heel raise su una gamba', breve: 'Heel raise', unita: 'rip' },
  equilibrio: { nome: 'Equilibrio a occhi chiusi', breve: 'Equilibrio', unita: 's' },
  leg_extension: { nome: 'Leg extension a 12,5 kg', breve: 'Leg extension', unita: 'rip' },
  step_down: { nome: 'Step-down', breve: 'Step-down', unita: 'rip' },
};
const COLORE_LATO = { dx: '#60a5fa', sx: '#c4b5fd' }; // due colori diversi, nessun significato di «bene» o «male»
// Quali numeri si scrivono per ogni tipo di esercizio.
const COLONNE_TIPO = {
  peso_rip: [['peso_kg', 'kg'], ['rip', 'Rip']],
  rip: [['rip', 'Rip']],
  durata: [['durata_s', 'Sec']],
  peso_durata: [['peso_kg', 'kg'], ['durata_s', 'Sec']],
  cardio: [['durata_min', 'Min']],
};

// Icone disegnate a mano (SVG), così non servono librerie esterne.
const ICONE = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  dots: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.6 1.5A3.75 3.75 0 0 1 17 18z"/>',
  barbell: '<path d="M2 12h20M5 8v8M8 6v12M16 6v12M19 8v8"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'list-search': '<path d="M4 6h12M4 12h7M4 18h7"/><circle cx="17" cy="15" r="3"/><path d="M19.2 17.2L22 20"/>',
  'ruler-measure': '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 8v3M11 8v4M15 8v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  unlink: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7"/><path d="M4 4l16 16"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  notebook: '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M9 3v18M12 8h4M12 12h4"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  swap: '<path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/>',
};
function ic(nome) { return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONE[nome] || ''}</svg>`; }

/* ======================= Piccoli aiuti ======================= */

const $ = (sel, dove = document) => dove.querySelector(sel);

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Data e ora nel fuso di Roma, formato «AAAA-MM-GG HH:mm:ss» (confrontabile come testo).
const FORMATO_ORA = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function ora(d = new Date()) { return FORMATO_ORA.format(d).replace('T', ' '); }

/* Le date nel foglio possono arrivare anche in formato italiano («05/11/2026 18:00»), per esempio se
 * scritte a mano: si riportano sempre ad «AAAA-MM-GG HH:mm:ss» (genere «ora») o «AAAA-MM-GG» («giorno»).
 * Le righe di partenza «AAAA-MM-GG HH:mm» restano come sono (il brief le considera valide). */
function normalizzaData(testo, genere = 'ora') {
  const t = String(testo == null ? '' : testo).trim();
  if (!t || /^\d{4}-\d{2}-\d{2}/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return t;
  const g = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return genere === 'giorno' ? g : `${g} ${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}`;
}
const COLONNE_DATA = { aggiornato_il: 'ora', inizio: 'ora', fine: 'ora', pausa_dal: 'ora', data: 'giorno', giorno: 'giorno', dal: 'giorno', al: 'giorno' };
function dataDa(testo) {
  const t = normalizzaData(testo);
  if (!t) return null;
  const d = new Date(t.replace(' ', 'T'));
  return isNaN(d) ? null : d;
}

function nuovoId(prefisso) {
  const lettere = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const casuali = crypto.getRandomValues(new Uint8Array(12));
  return prefisso + '-' + Array.from(casuali, b => lettere[b % lettere.length]).join('');
}

// Numeri: sul telefono si scrive con la virgola, in memoria sono numeri veri.
function fmtNum(v) { return v === '' || v == null ? '' : String(v).replace('.', ','); }
// Per scrivere un numero dentro la pagina: se dal foglio arrivasse del testo, non verrebbe mai eseguito.
function numH(v) { return esc(fmtNum(v)); }
function leggiNum(testo) {
  const t = String(testo).trim();
  if (t === '') return '';
  const n = Number(t.replace(',', '.'));
  return isNaN(n) ? null : n;
}
function num(v) { return typeof v === 'number' ? v : (v === '' || v == null ? NaN : Number(String(v).replace(',', '.'))); }

function fmtDurata(secondi) {
  secondi = Math.max(0, Math.round(secondi));
  const h = Math.floor(secondi / 3600), m = Math.floor(secondi % 3600 / 60), s = secondi % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtMinuti(secondi) {
  const m = Math.round(secondi / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
function fmtGiorno(d) { return d ? d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) : ''; }
function fmtOraBreve(d) { return d ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''; }
function fmtKg(v) { return Math.round(v).toLocaleString('it-IT') + ' kg'; }
function perPosizione(a, b) { return (num(a.posizione) || 0) - (num(b.posizione) || 0); }
function perNome(a, b) { return String(a.nome).localeCompare(String(b.nome), 'it'); }

/* ======================= IndexedDB (memoria del telefono) ======================= */

let idb;
function apriDB() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('gym', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('righe', { keyPath: 'k' });  // copia locale del foglio
      db.createObjectStore('coda', { keyPath: 'k' });   // modifiche da mandare
      db.createObjectStore('meta', { keyPath: 'chiave' }); // impostazioni e stato
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
function tutti(store) {
  return new Promise((ok, ko) => {
    const r = idb.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
function leggiUno(store, k) {
  return new Promise((ok, ko) => {
    const r = idb.transaction(store).objectStore(store).get(k);
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
function contaCoda() {
  return new Promise((ok, ko) => {
    const r = idb.transaction('coda').objectStore('coda').count();
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
// Scrive in una sola transazione: o tutto o niente.
function scriviIn(operazioni) {
  return new Promise((ok, ko) => {
    const stores = [...new Set(operazioni.map(o => o[0]))];
    if (!stores.length) return ok();
    const t = idb.transaction(stores, 'readwrite');
    operazioni.forEach(([store, tipo, valore]) => {
      if (tipo === 'put') t.objectStore(store).put(valore); else t.objectStore(store).delete(valore);
    });
    t.oncomplete = () => ok(); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error);
  });
}

/* ======================= Dati in memoria ======================= */

const D = {};               // D.Esercizi = Map(id -> riga), ecc.
SCHEDE.forEach(s => { D[s] = new Map(); });
const meta = {};            // url, token, cursore, ultimoInvio, ultimoErrore, ...
let codaQuante = 0;
let contatoreVersione = 0;
let versioneDati = 0;       // cambia a ogni modifica: serve a rifare gli indici

function vivi(scheda) { return [...D[scheda].values()].filter(r => r.eliminato !== SI); }
function riga(scheda, id) { return D[scheda].get(id); }

// Indici per trovare in fretta le righe «figlie» (rifatti solo quando i dati cambiano).
const indici = {};
function indice(scheda, campo) {
  const chiave = scheda + '.' + campo;
  let c = indici[chiave];
  if (!c || c.v !== versioneDati) {
    const m = new Map();
    D[scheda].forEach(r => {
      if (r.eliminato === SI) return;
      const k = r[campo];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    m.forEach(a => a.sort(perPosizione));
    c = indici[chiave] = { v: versioneDati, m };
  }
  return c.m;
}
function figli(scheda, padreId) { return (indice(scheda, PADRE[scheda]).get(padreId) || []).slice(); }
const serieDi = id => figli('Serie', id);
const eserciziDi = id => figli('SessioniEsercizi', id);
const vociDi = id => figli('ModelliEsercizi', id);
const previsteDi = id => figli('ModelliSerie', id);
function figliDi(scheda, r) { return scheda === 'SessioniEsercizi' ? serieDi(r.id) : previsteDi(r.id); }
function fratelliDi(scheda, r) { return figli(scheda, r[PADRE[scheda]]); }

function nuovaRiga(scheda, valori) {
  const r = {};
  COLONNE[scheda].forEach(c => { r[c] = ''; });
  r.eliminato = NO;
  return Object.assign(r, valori);
}
function soloSchema(scheda, r) {
  const pulita = {};
  COLONNE[scheda].forEach(c => { pulita[c] = r[c] === undefined || r[c] === null ? '' : r[c]; });
  return pulita;
}

/** Salva subito una o più righe: memoria, IndexedDB e coda di invio. */
function salva(...coppie) { return salvaLista(coppie); }
async function salvaLista(coppie) {
  const adesso = ora();
  const operazioni = [];
  coppie.forEach(([scheda, r]) => {
    r.aggiornato_il = adesso;
    D[scheda].set(r.id, r);
    const k = scheda + '|' + r.id;
    const copia = soloSchema(scheda, r);
    operazioni.push(['righe', 'put', { k, scheda, riga: copia }]);
    operazioni.push(['coda', 'put', { k, scheda, riga: copia, v: Date.now() + '-' + (contatoreVersione++) }]);
  });
  versioneDati++;
  await scriviIn(operazioni);
  codaQuante = await contaCoda();
  aggiornaStatoSync();
  programmaSync();
}

async function salvaMeta(chiave, valore) {
  meta[chiave] = valore;
  await scriviIn([['meta', 'put', { chiave, valore }]]);
}

async function caricaTutto() {
  (await tutti('righe')).forEach(({ scheda, riga: r }) => {
    if (!D[scheda]) return;
    // Date arrivate in passato in formato italiano: si correggono in memoria.
    Object.keys(COLONNE_DATA).forEach(c => { if (c in r) r[c] = normalizzaData(r[c], COLONNE_DATA[c]); });
    D[scheda].set(r.id, r);
  });
  (await tutti('meta')).forEach(({ chiave, valore }) => { meta[chiave] = valore; });
  codaQuante = await contaCoda();
  versioneDati++;
}

/* ======================= Sincronizzazione con il foglio ======================= */

let syncInCorso = false, syncDiNuovo = false, attesaSync = null;
let statoSync = '';

function programmaSync() {
  clearTimeout(attesaSync);
  attesaSync = setTimeout(() => sincronizza(), 4000);
}

let progressoInvio = null; // { inviate, totale } mentre si manda una coda lunga

async function chiamaPonte(corpo) {
  const controllo = new AbortController();
  const scadenza = setTimeout(() => controllo.abort(), 90000);
  try {
    // Testo semplice: così il browser non fa la richiesta preliminare CORS.
    const risposta = await fetch(meta.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: meta.token }, corpo)),
      signal: controllo.signal,
      redirect: 'follow',
      credentials: 'omit',
    });
    if (!risposta.ok) throw new Error('il ponte ha risposto ' + risposta.status);
    let dati;
    try { dati = await risposta.json(); } catch (e) { throw new Error('risposta del ponte non leggibile (indirizzo giusto?)'); }
    if (!dati.ok) throw new Error(dati.errore || 'errore del ponte');
    return dati;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('il ponte non risponde (tempo scaduto)');
    if (e instanceof TypeError) throw new Error('nessuna connessione con il ponte');
    throw e;
  } finally {
    clearTimeout(scadenza);
  }
}

async function sincronizza({ completo = false } = {}) {
  if (syncInCorso) { syncDiNuovo = true; return; }
  if (!meta.url || !meta.token) { statoSync = 'non configurato'; aggiornaStatoSync(); return; }
  if (!navigator.onLine) { statoSync = 'offline'; aggiornaStatoSync(); return; }
  syncInCorso = true; statoSync = 'in corso'; aggiornaStatoSync();
  try {
    // 1) Invio della coda, a blocchi. Se il ponte non risponde in tempo, il blocco si dimezza
    //    (fino a 25 righe) e si riprova al giro dopo: così una coda enorme non resta bloccata per sempre.
    let coda = await tutti('coda');
    const totale = coda.length;
    let inviate = 0;
    while (coda.length) {
      const dimensione = Math.max(25, Math.min(500, meta.lotto || 500));
      const lotto = coda.slice(0, dimensione);
      const righe = {};
      lotto.forEach(e => { (righe[e.scheda] = righe[e.scheda] || []).push(e.riga); });
      if (totale > 500) { progressoInvio = { inviate, totale }; aggiornaStatoSync(); }
      try {
        await chiamaPonte({ azione: 'push', righe });
      } catch (err) {
        if (/tempo scaduto/.test(err.message)) await salvaMeta('lotto', Math.max(25, Math.floor(dimensione / 2)));
        throw err;
      }
      if (dimensione < 500) await salvaMeta('lotto', Math.min(500, dimensione * 2)); // va bene: si torna a blocchi grandi
      const daTogliere = [];
      for (const e of lotto) {
        const attuale = await leggiUno('coda', e.k);
        if (attuale && attuale.v === e.v) daTogliere.push(['coda', 'delete', e.k]); // non è cambiata nel frattempo
      }
      await scriviIn(daTogliere);
      await salvaMeta('ultimoInvio', ora());
      inviate += lotto.length;
      coda = coda.slice(lotto.length);
      codaQuante = await contaCoda();
      aggiornaStatoSync();
    }
    progressoInvio = null;

    // 2) Lettura delle novità. Una volta al giorno si rilegge tutto, per sicurezza.
    const oggi = ora().slice(0, 10);
    // Se nel foglio manca una colonna nuova, si rilegge tutto finché non compare (così ci si accorge subito).
    const mancaQualcosa = Object.keys(meta.colonneMancanti || {}).length > 0;
    const tutto = completo || mancaQualcosa || !meta.cursore || meta.ultimoCompleto !== oggi;
    let dal = '';
    if (!tutto) dal = ora(new Date(dataDa(meta.cursore).getTime() - 3600 * 1000)); // un'ora di margine
    const dati = await chiamaPonte({ azione: 'pull', dal, schede: [...SCHEDE_BASE, 'Impostazioni'] });
    // Impostazioni del foglio: si legge solo la versione dello schema (per accorgersi se un giorno cambia).
    const imp = ((dati.schede || {}).Impostazioni || {}).righe || [];
    const vs = imp.find(r => r.chiave === 'versione_schema');
    if (vs) await salvaMeta('versioneSchema', String(vs.valore).trim());
    await salvaMeta('versionePonte', dati.versione_ponte || 1);
    let { cambiate, daRiinviare } = await unisci(dati.schede || {});
    // Diario: seconda lettura, solo se il ponte lo conosce (versione 4 o successiva).
    if ((dati.versione_ponte || 1) >= PONTE_DIARIO) {
      const datiDiario = await chiamaPonte({ azione: 'pull', dal: meta.diarioScaricato ? dal : '', schede: SCHEDE_DIARIO });
      const esito = await unisci(datiDiario.schede || {});
      cambiate += esito.cambiate;
      daRiinviare = daRiinviare.concat(esito.daRiinviare);
      await salvaMeta('diarioScaricato', ora());
    }
    if (daRiinviare.length) await salvaLista(daRiinviare); // colonna appena aggiunta nel foglio: si mandano i valori del telefono
    await salvaMeta('cursore', dati.adesso);
    if (tutto) await salvaMeta('ultimoCompleto', oggi);
    await salvaMeta('ultimaLettura', ora());
    await salvaMeta('ultimoErrore', '');
    statoSync = '';
    if (cambiate) ridisegnaSePossibile();
  } catch (e) {
    const rete = /nessuna connessione|tempo scaduto/.test(e.message);
    statoSync = rete ? 'offline' : 'errore'; // senza rete non è un vero errore: si riprova da soli
    await salvaMeta('ultimoErrore', rete ? '' : ora() + ' · ' + e.message);
  } finally {
    syncInCorso = false;
    aggiornaStatoSync();
    if (syncDiNuovo) { syncDiNuovo = false; programmaSync(); }
  }
}

/** Unisce le righe arrivate dal foglio: vince la più recente (aggiornato_il).
 *  Se nel foglio manca una colonna che l'app conosce, per quella colonna resta il valore del telefono;
 *  quando la colonna compare, i valori del telefono vengono rimandati al foglio. */
async function unisci(schede) {
  const operazioni = [];
  const daRiinviare = [];
  let cambiate = 0;
  const inAttesa = new Set((await tutti('coda')).map(e => e.k)); // modifiche locali non ancora inviate
  const mancantiPrima = meta.colonneMancanti || {};
  // Si aggiornano solo le schede lette in questa chiamata (il Diario si legge in una chiamata a parte).
  const mancanti = Object.assign({}, mancantiPrima);
  Object.keys(schede).forEach(s => { delete mancanti[s]; });
  Object.keys(schede).forEach(scheda => {
    if (!D[scheda]) return;
    const intest = schede[scheda].intestazioni || COLONNE[scheda];
    const manca = COLONNE[scheda].filter(c => !intest.includes(c));
    if (manca.length) mancanti[scheda] = manca;
    const appenaAggiunte = (mancantiPrima[scheda] || []).filter(c => intest.includes(c));
    (schede[scheda].righe || []).forEach(arrivata => {
      if (!arrivata.id) return;
      if (inAttesa.has(scheda + '|' + arrivata.id)) return; // la versione del telefono partirà al prossimo invio
      const r = soloSchema(scheda, arrivata);
      // Date in qualsiasi formato → sempre AAAA-MM-GG (serve anche se il ponte è ancora la versione 1).
      Object.keys(COLONNE_DATA).forEach(c => { if (c in r) r[c] = normalizzaData(r[c], COLONNE_DATA[c]); });
      const locale = D[scheda].get(r.id);
      if (locale) {
        manca.forEach(c => { r[c] = locale[c] ?? ''; });
        const daRecuperare = appenaAggiunte.filter(c => r[c] === '' && (locale[c] ?? '') !== '');
        if (daRecuperare.length) { daRecuperare.forEach(c => { r[c] = locale[c]; }); daRiinviare.push([scheda, r]); }
      }
      if (locale && String(r.aggiornato_il) < String(locale.aggiornato_il)) return; // la nostra è più nuova
      if (locale && COLONNE[scheda].every(c => String(locale[c] ?? '') === String(r[c] ?? ''))) return; // identica
      D[scheda].set(r.id, r);
      operazioni.push(['righe', 'put', { k: scheda + '|' + r.id, scheda, riga: r }]);
      cambiate++;
    });
  });
  if (cambiate) versioneDati++;
  await scriviIn(operazioni);
  await salvaMeta('colonneMancanti', mancanti);
  return { cambiate, daRiinviare };
}

function testoStatoSync() {
  if (!meta.url || !meta.token) return `<span class="errore">Ponte non configurato</span> · <a href="#" data-vai="impostazioni" style="color:var(--blu-chiaro)">Impostazioni</a>`;
  const coda = codaQuante ? `${codaQuante.toLocaleString('it-IT')} in coda` : '0 in coda';
  if (statoSync === 'in corso' && progressoInvio) return `Invio ${progressoInvio.inviate.toLocaleString('it-IT')} di ${progressoInvio.totale.toLocaleString('it-IT')} righe…`;
  if (statoSync === 'in corso') return `Sincronizzo… · ${coda}`;
  if (statoSync === 'errore' || meta.ultimoErrore) return `<a href="#" data-vai="impostazioni" class="errore">Errore di sincronizzazione</a> · ${coda}`;
  if (meta.versioneSchema && meta.versioneSchema !== '1') return `<a href="#" data-vai="impostazioni" class="errore">Lo schema del foglio è cambiato</a> · ${coda}`;
  if (statoSync === 'offline' || !navigator.onLine) return `Senza rete · ${coda}`;
  return codaQuante ? `${ic('cloud')} ${coda}` : `${ic('cloud')} Sincronizzato · 0 in coda`;
}
function aggiornaStatoSync() {
  document.querySelectorAll('[data-stato-sync]').forEach(el => { el.innerHTML = testoStatoSync(); });
  if (S.schermata === 'impostazioni' && !document.activeElement.matches('input') && $('#velo').hidden) disegna();
}

/* ======================= Timer di recupero ======================= */

let audio = null;
function sbloccaAudio() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch (e) { /* senza audio si usa solo la vibrazione */ }
}
function suona() {
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
  if (!audio) return;
  [0, 0.35, 0.7].forEach(t => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.3, audio.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.28);
    o.connect(g); g.connect(audio.destination);
    o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.3);
  });
}

// seId: l'esercizio che ha fatto partire il recupero (per «Usa sempre»); prossima: testo della prossima serie.
function avviaTimer(secondi, seId = '') {
  if (!secondi || secondi <= 0) return;
  const se = seId && riga('SessioniEsercizi', seId);
  salvaMeta('timerInfo', { seId, base: secondi, durata: secondi, prossima: se ? testoProssima(se.sessione_id) : '' });
  salvaMeta('timerFine', Date.now() + secondi * 1000);
  aggiornaTimer();
}
function cambiaTimer(delta) {
  if (!meta.timerFine) return;
  salvaMeta('timerFine', Math.max(Date.now() + 1000, meta.timerFine + delta * 1000));
  const info = meta.timerInfo;
  if (info) salvaMeta('timerInfo', Object.assign({}, info, { durata: Math.max(5, info.durata + delta) }));
  aggiornaTimer();
}
function fermaTimer() { salvaMeta('timerFine', 0); aggiornaTimer(); }

/* La prossima serie da fare della sessione, rispettando l'alternanza delle superserie (A1, B1, A2…). */
function testoProssima(sessioneId) {
  for (const b of blocchi(eserciziDi(sessioneId))) {
    const liste = b.map(se => serieDi(se.id));
    const giri = Math.max(...liste.map(l => l.length));
    for (let i = 0; i < giri; i++) {
      for (let k = 0; k < b.length; k++) {
        const s = liste[k][i];
        if (!s || s.fatta === SI) continue;
        const es = riga('Esercizi', b[k].esercizio_id);
        const tipo = tipoDi(es);
        const et = etichettaSerie(liste[k], s, b.length > 1 ? (k ? 'B' : 'A') : '').testo.replace(/<[^>]+>/g, '');
        const valori = COLONNE_TIPO[tipo].some(([c]) => (c === 'durata_min' ? s.durata_s : s[c]) !== '') ? ' · ' + fmtPrecedente(tipo, s) : '';
        return `Prossima: ${es ? es.nome : ''} ${et}${valori}`;
      }
    }
  }
  return '';
}

let timerFinitoFino = 0;
function aggiornaTimer() {
  const box = $('#timer');
  const adesso = Date.now();
  if (meta.timerFine) {
    const resto = Math.ceil((meta.timerFine - adesso) / 1000);
    if (resto <= 0) {
      if (adesso - meta.timerFine < 5000) suona(); // suona solo se è appena finito
      salvaMeta('timerFine', 0);
      timerFinitoFino = adesso + 3000;
      $('#timer-tempo').textContent = 'Via!';
      box.classList.add('finito');
    } else {
      $('#timer-tempo').textContent = fmtDurata(resto);
      box.classList.remove('finito');
    }
  }
  const visibile = !!meta.timerFine || adesso < timerFinitoFino;
  const info = meta.timerInfo || {};
  const prossima = $('#timer-prossima');
  if (prossima.textContent !== (info.prossima || '')) prossima.textContent = info.prossima || '';
  const salvaRec = $('#timer-salva');
  const cambiato = meta.timerFine && info.seId && info.durata !== info.base;
  salvaRec.hidden = !cambiato;
  if (cambiato) salvaRec.textContent = `Usa sempre ${fmtDurata(info.durata)}`;
  box.hidden = !visibile;
  document.body.classList.toggle('con-timer', visibile);
}

/** Dopo una serie fatta: parte il recupero. Nelle superserie parte solo dopo la coppia. */
function timerDopoSerie(s) {
  const se = riga('SessioniEsercizi', s.sessione_esercizio_id);
  const sess = se && riga('Sessioni', se.sessione_id);
  if (!sessioneAperta(sess)) return;
  const comp = compagno(eserciziDi(sess.id), se);
  if (comp) {
    const k = serieDi(se.id).indexOf(s);
    const sua = serieDi(comp.id)[k];
    if (sua && sua.fatta !== SI) return; // ora tocca all'altro esercizio della coppia
    const piuLungo = recuperoDi(se) >= recuperoDi(comp) ? se : comp;
    avviaTimer(recuperoDi(piuLungo), piuLungo.id);
    return;
  }
  avviaTimer(recuperoDi(se), se.id);
}

/* «Usa sempre»: il recupero cambiato con −15/+15 diventa quello predefinito.
 * Va nel modello se la sessione viene da un modello che ha un recupero suo, altrimenti nell'esercizio. */
async function salvaRecupero() {
  const info = meta.timerInfo;
  const se = info && riga('SessioniEsercizi', info.seId);
  if (!se) return;
  const me = voceModello(riga('Sessioni', se.sessione_id), se.esercizio_id);
  if (me && me.recupero_s !== '' && !isNaN(num(me.recupero_s))) { me.recupero_s = info.durata; await salva(['ModelliEsercizi', me]); }
  else { const es = riga('Esercizi', se.esercizio_id); es.recupero_s = info.durata; await salva(['Esercizi', es]); }
  await salvaMeta('timerInfo', Object.assign({}, info, { base: info.durata }));
  aggiornaTimer();
  mostraAvviso(`Recupero di ${nomeVoce('SessioniEsercizi', se)}: ${fmtDurata(info.durata)}`);
  if (S.schermata === 'sessione') ridisegnaSePossibile();
}

/* Conto alla rovescia per le serie a durata (isometrie). */
let conto = null; // { serieId, obiettivo, partenza }
function avviaConto(serieId) {
  const s = riga('Serie', serieId);
  const obiettivo = num(s.durata_s);
  conto = { serieId, obiettivo: isNaN(obiettivo) || obiettivo <= 0 ? 0 : obiettivo, partenza: Date.now() + 3000 };
  if (navigator.vibrate) navigator.vibrate(80);
  disegnaConto();
}
function disegnaConto() {
  if (!conto) return;
  const passati = (Date.now() - conto.partenza) / 1000;
  let grande, sotto;
  if (passati < 0) { grande = Math.ceil(-passati); sotto = 'Pronti…'; }
  else if (conto.obiettivo) { grande = fmtDurata(Math.max(0, conto.obiettivo - passati)); sotto = `di ${conto.obiettivo}″`; }
  else { grande = fmtDurata(passati); sotto = 'Cronometro'; }
  // Il foglio si crea una volta sola; poi si aggiornano solo i numeri (i bottoni restano fermi).
  if ($('#velo').hidden || !$('#conto-grande')) {
    apriFoglio(`<h2>Serie a durata</h2>
      <div style="text-align:center;padding:16px 0"><div id="conto-grande" style="font-size:64px;font-weight:500;font-variant-numeric:tabular-nums"></div><div class="tenue" id="conto-sotto"></div></div>
      <div class="riga-btn"><button class="btn2" data-azione="conto-annulla">Annulla</button><button class="btn verde" data-azione="conto-ferma">Ferma e registra</button></div>`);
  }
  $('#conto-grande').textContent = grande;
  $('#conto-sotto').textContent = sotto;
  if (conto.obiettivo && passati >= conto.obiettivo) chiudiConto(true);
}
async function chiudiConto(registra) {
  if (!conto) return;
  const c = conto; conto = null;
  chiudiFoglio();
  if (!registra) return;
  const s = riga('Serie', c.serieId);
  const passati = Math.max(0, Math.round((Date.now() - c.partenza) / 1000));
  s.durata_s = c.obiettivo && passati >= c.obiettivo ? c.obiettivo : passati;
  s.fatta = SI;
  await salva(['Serie', s]);
  if (c.obiettivo && passati >= c.obiettivo) suona();
  timerDopoSerie(s);
  disegna();
}

/* ======================= Schermo sempre acceso ======================= */

let wakeLock = null;
async function tieniAcceso(si) {
  try {
    if (si && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!si && wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
  } catch (e) { wakeLock = null; }
}
// Schermo acceso solo durante una sessione in corso e non in pausa.
function controllaWakeLock() { const s = sessioneInCorso(); tieniAcceso(!!s && !inPausa(s)); }

/* ======================= Domande sui dati ======================= */

function sessioneAperta(sess) { return sess && sess.eliminato !== SI && !sess.fine; }

/* ----- Pausa: pausa_dal = quando è iniziata la pausa in corso; pausa_s = secondi di pausa già finiti ----- */
function inPausa(sess) { return !!(sess && sessioneAperta(sess) && sess.pausa_dal); }
/** Durata vera della sessione in secondi, senza le pause (anche quella in corso). */
function durataSessione(sess) {
  const inizio = dataDa(sess.inizio);
  if (!inizio) return 0;
  const fine = sess.fine ? dataDa(sess.fine) : sess.pausa_dal ? dataDa(sess.pausa_dal) : new Date();
  return Math.max(0, (fine - inizio) / 1000 - (num(sess.pausa_s) || 0));
}
async function mettiInPausa(sess) {
  if (inPausa(sess)) return;
  sess.pausa_dal = ora();
  await salva(['Sessioni', sess]);
  fermaTimer(); tieniAcceso(false);
}
async function riprendiSessione(sess) {
  if (!inPausa(sess)) return;
  const pausa = Math.max(0, Math.round((Date.now() - dataDa(sess.pausa_dal)) / 1000));
  sess.pausa_s = (num(sess.pausa_s) || 0) + pausa;
  sess.pausa_dal = '';
  await salva(['Sessioni', sess]);
  controllaWakeLock();
}
/** Ultimo segno di vita della sessione: l'ultima modifica a una serie o all'esercizio, o la ripresa da una pausa. */
function ultimaAttivita(sess) {
  let ultima = normalizzaData(sess.inizio);
  const piuTardi = t => { t = String(t || ''); if (t > ultima) ultima = t; };
  piuTardi(sess.aggiornato_il);
  eserciziDi(sess.id).forEach(se => { piuTardi(se.aggiornato_il); serieDi(se.id).forEach(s => piuTardi(s.aggiornato_il)); });
  return ultima;
}
/** Minuti senza attività di una sessione in corso (0 se in pausa o finita). */
function minutiFermi(sess) {
  if (!sessioneAperta(sess) || inPausa(sess)) return 0;
  const d = dataDa(ultimaAttivita(sess));
  return d ? (Date.now() - d) / 60000 : 0;
}
const MINUTI_AVVISO = 30; // dopo 30 minuti senza serie: «hai finito?»
function sessioneInCorso() {
  return vivi('Sessioni').filter(s => !s.fine).sort((a, b) => String(b.inizio).localeCompare(String(a.inizio)))[0] || null;
}
function voceModello(sess, esercizioId) {
  if (!sess || !sess.modello_id) return null;
  return vociDi(sess.modello_id).find(m => m.esercizio_id === esercizioId) || null;
}
function recuperoDi(se) {
  const me = voceModello(riga('Sessioni', se.sessione_id), se.esercizio_id);
  const daModello = me ? num(me.recupero_s) : NaN;
  if (!isNaN(daModello)) return daModello;
  const es = riga('Esercizi', se.esercizio_id);
  const daEsercizio = es ? num(es.recupero_s) : NaN;
  return isNaN(daEsercizio) ? 0 : daEsercizio;
}
function riepilogoSessione(sess) {
  let fatte = 0, totali = 0, volume = 0;
  const nomi = [];
  eserciziDi(sess.id).forEach(se => {
    const es = riga('Esercizi', se.esercizio_id);
    nomi.push(es ? es.nome : '?');
    serieDi(se.id).forEach(s => {
      totali++;
      if (s.fatta === SI) {
        fatte++;
        const p = num(s.peso_kg), r = num(s.rip);
        if (!isNaN(p) && !isNaN(r)) volume += p * r;
      }
    });
  });
  return { fatte, totali, volume, durata: durataSessione(sess), nomi };
}

/* ----- Superserie: due esercizi con lo stesso superserie_id (solo coppie) ----- */
function compagno(lista, r) {
  if (!r || !r.superserie_id) return null;
  const altri = lista.filter(x => x !== r && x.superserie_id === r.superserie_id);
  return altri.length === 1 ? altri[0] : null;
}
// Divide l'elenco in «blocchi»: un esercizio singolo oppure una coppia di superserie.
function blocchi(lista) {
  const visti = new Set(), out = [];
  lista.forEach(r => {
    if (visti.has(r)) return;
    const c = compagno(lista, r);
    visti.add(r);
    if (c) { visti.add(c); out.push([r, c]); } else out.push([r]);
  });
  return out;
}
/* ----- Valori dell'ultima volta ----- */
// Le serie fatte dello stesso esercizio nell'ultima sessione precedente che le contiene.
function serieUltimaVolta(sess, se) {
  const candidati = (indice('SessioniEsercizi', 'esercizio_id').get(se.esercizio_id) || [])
    .map(x => ({ x, s: riga('Sessioni', x.sessione_id) }))
    .filter(({ x, s }) => x.id !== se.id && s && s.eliminato !== SI && s.id !== sess.id && String(s.inizio) < String(sess.inizio))
    .sort((a, b) => String(b.s.inizio).localeCompare(String(a.s.inizio)));
  for (const { x } of candidati) {
    const fatte = serieDi(x.id).filter(s => s.fatta === SI);
    if (fatte.length) return fatte;
  }
  return [];
}
// Abbina la serie k-esima dello stesso lato (e dello stesso genere: riscaldamento o no).
function precedenteDi(lista, s, precedenti) {
  const genere = x => (x.lato || 'entrambi') + '|' + (x.tipo === 'riscaldamento' ? 'r' : 'n');
  const k = lista.filter(x => genere(x) === genere(s)).indexOf(s);
  return precedenti.filter(x => genere(x) === genere(s))[k] || null;
}
function fmtPrecedente(tipo, p) {
  const kg = p.peso_kg === '' ? '' : fmtNum(p.peso_kg);
  if (tipo === 'rip') return `${p.rip} rip`;
  if (tipo === 'durata') return `${p.durata_s}″`;
  if (tipo === 'peso_durata') return `${kg || 0} kg × ${p.durata_s}″`;
  if (tipo === 'cardio') return `${Math.round(num(p.durata_s) / 60)} min`;
  return kg === '' ? `${p.rip} rip` : `${kg} × ${p.rip}`;
}

/* ======================= Navigazione e disegno ======================= */

const S = {
  aperti: new Set(), // esercizi finiti riaperti a mano (altrimenti si mostrano compatti)
  schermata: 'oggi', sessioneId: null, modelloId: null, bozzaEs: null,
  vistaArchivio: 'esercizi', mostraArchiviati: false,
  ricerca: '', ricercaArchivio: '', nuovoEs: null, sceltaPer: 'sessione', importazione: null,
};

/* Cronologia per il tasto «indietro» di Android:
 * - le pagine interne (sessione, modello, andamento…) aggiungono un passo;
 * - tra le schede della barra in basso no: da Oggi a un'altra scheda c'è un solo passo, tra le altre si sostituisce;
 * - un foglio dal basso aggiunge un passo, così «indietro» chiude solo il foglio;
 * - i passi doppi (stessa schermata) vengono saltati. */
const SCHEDE_BARRA = ['oggi', 'storico', 'esercizi', 'test', 'diario'];
const CHIAVI_STATO = ['schermata', 'sessioneId', 'modelloId', 'esercizioVisto', 'testTipo', 'giornoDiario'];
function statoAttuale() { const st = {}; CHIAVI_STATO.forEach(k => { st[k] = S[k] || null; }); return st; }
function stessoStato(a, b) { return !!a && !!b && CHIAVI_STATO.every(k => (a[k] || null) === (b[k] || null)); }

function vai(schermata, extra = {}) {
  const da = S.schermata;
  Object.assign(S, extra);
  S.schermata = schermata;
  const nuovo = statoAttuale();
  const traSchede = SCHEDE_BARRA.includes(schermata) && SCHEDE_BARRA.includes(da);
  if ((traSchede && da !== 'oggi') || stessoStato(history.state, nuovo)) history.replaceState(nuovo, '');
  else history.pushState(nuovo, '');
  disegna();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', e => {
  // Con un foglio aperto, «indietro» chiude solo il foglio (e ferma un eventuale conto alla rovescia).
  if (!$('#velo').hidden) {
    conto = null;
    $('#velo').hidden = true; $('#foglio').innerHTML = '';
    return;
  }
  const st = e.state || { schermata: 'oggi' };
  if (stessoStato(st, statoAttuale())) { history.back(); return; } // passo doppio: si salta
  CHIAVI_STATO.forEach(k => { if (st[k] != null) S[k] = st[k]; });
  disegna();
});

const SCHERMATE = {
  oggi: disegnaOggi, sessione: disegnaSessione, storico: disegnaStorico, esercizi: disegnaArchivio,
  esercizio: disegnaFormEsercizio, modello: disegnaModello, test: disegnaTest, impostazioni: disegnaImpostazioni,
  'test-nuovo': disegnaFormTest, 'test-andamento': disegnaAndamentoTest, 'esercizio-andamento': disegnaAndamentoEsercizio,
  diario: disegnaDiario,
};
const TAB_DI = { esercizio: 'esercizi', modello: 'esercizi', 'test-nuovo': 'test', 'test-andamento': 'test', 'esercizio-andamento': 'esercizi' };
const MODULI = ['esercizio', 'test-nuovo']; // schermate con un modulo non ancora salvato: non si ridisegnano da sole

function disegna() {
  daRidisegnare = false;
  const fn = SCHERMATE[S.schermata] || disegnaOggi;
  $('#schermo').innerHTML = fn();
  let tab = TAB_DI[S.schermata] || S.schermata;
  if (S.schermata === 'sessione') tab = sessioneAperta(riga('Sessioni', S.sessioneId)) ? 'oggi' : 'storico';
  document.querySelectorAll('#barra button').forEach(b => b.classList.toggle('attiva', b.dataset.vai === tab));
  aggiornaCronometro();
  if (S.schermata === 'impostazioni') mostraStatoMemoria();
}

let daRidisegnare = false;
function ridisegnaSePossibile() {
  const att = document.activeElement;
  if (att && att.matches('input, textarea') && $('#schermo').contains(att)) { daRidisegnare = true; return; }
  if (S.compatto) { daRidisegnare = true; return; } // si sta ordinando: si ridisegna quando il dito si alza
  if (MODULI.includes(S.schermata)) { daRidisegnare = true; return; } // modulo non ancora salvato
  disegna();
}
document.addEventListener('focusout', () => {
  setTimeout(() => {
    const att = document.activeElement;
    if (daRidisegnare && !MODULI.includes(S.schermata) && !(att && att.matches('input, textarea'))) disegna();
  }, 400);
});

/* Il telefono garantisce di non cancellare i dati dell'app? (memoria «persistente») */
async function mostraStatoMemoria() {
  const el = $('#stato-memoria');
  if (!el) return;
  try {
    const protetta = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const stima = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const mb = stima && stima.usage ? ` · ${(stima.usage / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB usati` : '';
    el.innerHTML = (protetta ? 'protetta (Chrome non la cancella da solo)' : '<span class="errore">non protetta</span>: Chrome potrebbe liberarla se il telefono è pieno. I dati già inviati al foglio sono al sicuro.') + mb;
  } catch (e) { el.textContent = 'non disponibile'; }
}

function testata(titolo, indietro, destra = '') {
  return `<div class="top">${indietro ? `<button class="icona" data-azione="${indietro}" aria-label="Indietro">${ic('arrow-left')}</button>` : ''}
    <h1 style="flex:1">${titolo}</h1>${destra}</div>`;
}

/* ---------- Oggi ---------- */
function modelliOrdinati() {
  return vivi('Modelli').sort((a, b) =>
    String(a.cartella).localeCompare(String(b.cartella), 'it') || (num(a.ordine) || 0) - (num(b.ordine) || 0) || perNome(a, b));
}
function disegnaOggi() {
  const inCorso = sessioneInCorso();
  const sessioni = vivi('Sessioni');
  let html = testata('Oggi', '', `<button class="icona" data-vai="impostazioni" aria-label="Impostazioni">${ic('settings')}</button>`) + `<div class="pila">`;
  if (inCorso) {
    const pausa = inPausa(inCorso);
    const fermi = minutiFermi(inCorso);
    const stato = pausa ? ` dalle ${fmtOraBreve(dataDa(inCorso.pausa_dal))}`
      : fermi >= MINUTI_AVVISO ? ` · <span class="errore">nessuna serie da ${fmtMinuti(fermi * 60)}</span>` : '';
    html += `<div class="card in-corso ${pausa ? 'in-pausa' : ''}"><div class="tenue">${pausa ? 'Sessione in pausa' : 'Sessione in corso'}${stato}</div>
      <div style="font-size:17px;font-weight:500;margin:2px 0 8px">${esc(inCorso.titolo)} · ${fmtMinuti(durataSessione(inCorso))} di allenamento</div>
      <button class="btn largo" data-azione="riprendi">${pausa ? ic('play') + ' Riprendi l\'allenamento' : 'Torna alla sessione'}</button></div>`;
  }
  // La settimana in corso: giorni allenati e sedute fatte (su previste, se i modelli hanno una frequenza).
  const lun = lunedi(new Date());
  const settimana = sessioni.filter(s => s.fine && dataDa(s.inizio) >= lun);
  const previste = vivi('Modelli').reduce((t, m) => t + (num(m.sedute_settimana) > 0 ? num(m.sedute_settimana) : 0), 0);
  const giorniFatti = new Set(settimana.map(s => normalizzaData(s.inizio).slice(0, 10)));
  html += `<div class="card"><div class="fila"><span class="tenue">Questa settimana</span>
      <span><b style="font-size:17px;font-weight:500">${settimana.length}</b> <span class="tenue">${settimana.length === 1 ? 'seduta' : 'sedute'}${previste ? ` su ${previste} previste` : ''}</span></span></div>
    <div class="settimana-oggi">${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((n, i) => {
      const g = new Date(lun); g.setDate(lun.getDate() + i);
      const k = chiaveGiorno(g);
      return `<span class="${giorniFatti.has(k) ? 'si' : ''} ${k === chiaveGiorno(new Date()) ? 'oggi' : ''}">${n}</span>`;
    }).join('')}</div></div>`;
  // Diario di oggi: solo lo stato, nessun obbligo di «completo».
  if (vociDiario().length) {
    const st = statoDiario(oggiG());
    html += `<button class="card modello dv-oggi" data-azione="apri-diario">
      <span class="fila"><span style="font-size:16px;font-weight:500">${ic('notebook')} Diario di oggi</span>${ic('chevron-right')}</span>
      <span class="tenue" style="display:block;margin-top:4px">${st.fatte} ${st.fatte === 1 ? 'voce' : 'voci'} su ${st.totali} compilate${st.ultima ? ' · ultima modifica ' + esc(st.ultima.slice(11, 16)) : ''}</span></button>`;
  }
  html += `<button class="btn2 largo" data-azione="nuova-vuota">${ic('plus')} Sessione vuota</button>`;
  let cartella = null;
  const modelli = modelliOrdinati();
  modelli.forEach(m => {
    if (m.cartella !== cartella) { cartella = m.cartella; html += `<div class="etichetta">${esc(cartella || 'Senza cartella')}</div>`; }
    const quanti = vociDi(m.id).length;
    const ultima = sessioni.filter(s => s.modello_id === m.id && s.fine).map(s => s.inizio).sort().pop();
    html += `<button class="card fila modello" data-azione="avvia-modello" data-id="${esc(m.id)}">
      <span><span style="display:block;font-size:16px">${esc(m.nome)}</span><span class="tenue">${quanti} esercizi${ultima ? ' · ultima ' + fmtGiorno(dataDa(ultima)) : ''}</span></span>${ic('play')}</button>`;
  });
  if (!modelli.length) html += `<div class="vuoto-msg">Nessun modello. Puoi crearne uno in Esercizi → Modelli.</div>`;
  html += `<div class="stato-sync" data-stato-sync>${testoStatoSync()}</div></div>`;
  return html;
}

/* ---------- Righe delle serie (sessione e modello) ---------- */
function etichettaSerie(lista, s, lettera = '') {
  if (s.tipo === 'riscaldamento') return { testo: lettera + 'R', classe: 'risc' };
  const n = lista.filter(x => x.tipo !== 'riscaldamento' && x.lato === s.lato && perPosizione(x, s) <= 0).length;
  return { testo: `<b>${lettera}${n}</b>${s.lato && s.lato !== 'entrambi' ? ' ' + esc(s.lato) : ''}`, classe: s.tipo === 'cedimento' ? 'ced' : '' };
}

// enterkeyhint="next": sulla tastiera compare «Avanti», che porta al campo successivo (vedi più sotto).
function campoNum(scheda, r, campo) {
  const v = campo === 'durata_min' ? (r.durata_s === '' ? '' : Math.round(num(r.durata_s) / 6) / 10) : r[campo];
  return `<input class="num" inputmode="decimal" enterkeyhint="next" autocomplete="off" data-scheda="${scheda}" data-id="${esc(r.id)}" data-campo="${campo}" value="${esc(fmtNum(v))}">`;
}
// RPE nascosto se scelto nelle Impostazioni: i numeri hanno più spazio.
function conRpe() { return !meta.nascondiRpe; }

function rigaSerie(scheda, tipo, lista, s, lettera, precedenti) {
  const sessione = scheda === 'Serie';
  const et = etichettaSerie(lista, s, lettera);
  let celle = `<button class="lab-serie ${et.classe}" data-azione="menu-serie" data-scheda="${scheda}" data-id="${esc(s.id)}">${et.testo}</button>`;
  if (sessione) {
    const p = precedenti && precedenteDi(lista, s, precedenti);
    celle += p
      ? `<button class="ultima" data-azione="usa-precedente" data-id="${esc(s.id)}" data-peso="${esc(p.peso_kg)}" data-rip="${esc(p.rip)}" data-durata="${esc(p.durata_s)}">${esc(fmtPrecedente(tipo, p))}</button>`
      : `<span class="ultima">—</span>`;
  }
  COLONNE_TIPO[tipo].forEach(([c]) => { celle += campoNum(scheda, s, c); });
  if (conRpe()) celle += campoNum(scheda, s, sessione ? 'rpe' : 'rpe_previsto');
  if (sessione) celle += `<button class="spunta" data-azione="spunta" data-id="${esc(s.id)}" aria-label="Serie fatta">${ic('check')}</button>`;
  return `<div class="scorri"><div class="scorri-fondo">${ic('trash')}${ic('trash')}</div>
    <div class="serie c-${esc(tipo)} ${sessione ? '' : 'mod'} ${conRpe() ? '' : 'no-rpe'} ${s.fatta === SI ? 'fatta' : ''}" data-scheda="${scheda}" data-id="${esc(s.id)}">${celle}</div></div>`;
}

function intestazioneSerie(tipo, sessione) {
  return `<div class="serie intest c-${esc(tipo)} ${sessione ? '' : 'mod'} ${conRpe() ? '' : 'no-rpe'}"><span>Serie</span>${sessione ? '<span>Ultima</span>' : ''}
    ${COLONNE_TIPO[tipo].map(([, t]) => `<span>${t}</span>`).join('')}${conRpe() ? '<span>RPE</span>' : ''}${sessione ? '<span></span>' : ''}</div>`;
}

/* Riassunto delle serie fatte di un esercizio, per la scheda compatta (es. «13×10 · 13×10 · 14×8»). */
function riassuntoSerie(tipo, serie) {
  const fatte = serie.filter(s => s.fatta === SI && s.tipo !== 'riscaldamento');
  const testo = fatte.slice(0, 5).map(s => fmtPrecedente(tipo, s).replace(' rip', '').replace(' × ', '×')).join(' · ');
  return testo + (fatte.length > 5 ? ` · +${fatte.length - 5}` : '');
}

function tipoDi(es) { return es && COLONNE_TIPO[es.tipo] ? es.tipo : 'peso_rip'; }

/* ---------- Sessione ---------- */
function disegnaEsercizioSessione(sess, se, lettera) {
  const es = riga('Esercizi', se.esercizio_id);
  const tipo = tipoDi(es);
  const serie = serieDi(se.id);
  const me = voceModello(sess, se.esercizio_id);
  const rec = recuperoDi(se);
  const nome = `${lettera ? lettera + ' · ' : ''}${esc(es ? es.nome : 'Esercizio non trovato (' + se.esercizio_id + ')')}`;
  // Esercizio con tutte le serie fatte, in una sessione in corso: scheda compatta (si riapre toccandola).
  const finito = sessioneAperta(sess) && serie.length > 0 && serie.every(s => s.fatta === SI);
  if (finito && !S.aperti.has(se.id)) {
    return `<div class="card fila compatta" data-se="${esc(se.id)}">
      <button class="compatta-apri" data-azione="espandi-es" data-id="${esc(se.id)}">
        <span class="es-titolo" data-tieni="SessioniEsercizi" data-id="${esc(se.id)}">${nome}</span>
        <span class="tenue" style="display:block">${ic('check')} ${serie.length} ${serie.length === 1 ? 'serie' : 'serie'} · ${esc(riassuntoSerie(tipo, serie))}</span>
      </button>${ic('chevron-down')}</div>`;
  }
  const precedenti = serieUltimaVolta(sess, se);
  let html = `<div class="card" style="padding:12px 8px" data-se="${esc(se.id)}">
    <div class="fila" style="padding:0 4px 8px;align-items:flex-start"><div>
      <div class="es-titolo" data-tieni="SessioniEsercizi" data-id="${esc(se.id)}">${nome}</div>
      ${es && RIAB[es.area] ? `<span class="tag">${esc(es.area)}</span>` : ''}
      <span class="tenue">${rec ? 'recupero ' + fmtDurata(rec) : 'senza recupero'}</span>
      ${me && me.nota ? `<p class="indicazione">${esc(me.nota)}</p>` : ''}
      ${es && es.nota ? `<p class="indicazione descrizione">${esc(es.nota)}</p>` : ''}
    </div><button class="icona" data-azione="menu-es" data-scheda="SessioniEsercizi" data-id="${esc(se.id)}" aria-label="Opzioni esercizio">${ic('dots')}</button></div>`;
  html += intestazioneSerie(tipo, true);
  serie.forEach(s => { html += rigaSerie('Serie', tipo, serie, s, lettera, precedenti); });
  html += `<div class="riga-btn" style="padding:8px 4px 0">
    <button class="btn2" style="font-size:14px" data-azione="aggiungi-serie" data-scheda="Serie" data-padre="${esc(se.id)}">${ic('plus')} Serie</button>
    <button class="btn2" style="font-size:14px" data-azione="copia-precedente" data-scheda="Serie" data-padre="${esc(se.id)}">${ic('copy')} Copia precedente</button></div>`;
  if (tipo === 'durata' || tipo === 'peso_durata') {
    const prossima = serie.find(s => s.fatta !== SI);
    if (prossima) {
      const et = etichettaSerie(serie, prossima, lettera);
      html += `<div style="padding:8px 4px 0"><button class="btn largo" data-azione="avvia-durata" data-id="${esc(prossima.id)}">${ic('timer')} Avvia serie ${et.testo.replace(/<[^>]+>/g, '')}${prossima.durata_s !== '' ? ' · ' + numH(prossima.durata_s) + '″' : ''}</button></div>`;
    }
  }
  html += `<div style="padding:8px 4px 0"><input class="testo" placeholder="Nota sull'esercizio" data-se-campo="nota" data-se="${esc(se.id)}" value="${esc(se.nota)}"></div>`;
  const riab = es && RIAB[es.area];
  if (riab) {
    const pieno = riab.campi.some(([c]) => se[c] !== '' || se[c + '_nota']);
    html += `<details class="riab" ${pieno ? 'open' : ''}><summary>${riab.titolo}${ic('chevron-down')}</summary>`;
    riab.campi.forEach(([c, nome]) => {
      html += `<div class="riab-riga"><span class="tenue">${nome}</span>
        <input class="num" inputmode="decimal" autocomplete="off" placeholder="0-10" data-se-campo="${c}" data-se="${esc(se.id)}" value="${esc(fmtNum(se[c]))}">
        <input class="testo" placeholder="nota breve" data-se-campo="${c}_nota" data-se="${esc(se.id)}" value="${esc(se[c + '_nota'])}"></div>`;
    });
    html += `</details>`;
  }
  return html + `</div>`;
}

// Disegna gli esercizi a blocchi: le coppie di superserie stanno in un riquadro comune.
function disegnaBlocchi(lista, disegnaUno) {
  return blocchi(lista).map(b => b.length === 1 ? disegnaUno(b[0], '')
    : `<div class="coppia"><div class="coppia-tit">${ic('link')} Superserie</div>${disegnaUno(b[0], 'A')}${disegnaUno(b[1], 'B')}</div>`).join('');
}

function disegnaSessione() {
  const sess = riga('Sessioni', S.sessioneId);
  if (!sess || sess.eliminato === SI) { S.schermata = 'oggi'; return disegnaOggi(); }
  const aperta = sessioneAperta(sess);
  let html = `<div class="top">
    <button style="background:none;border:none;text-align:left;padding:0;min-height:48px;cursor:pointer" data-azione="rinomina-sessione">
      <div class="tenue">${esc(sess.titolo)} ${aperta ? '' : '· ' + fmtGiorno(dataDa(sess.inizio))} ${ic('edit')}</div>
      <div style="font-size:22px;font-weight:500" id="cronometro"></div></button>
    ${aperta ? `<span style="display:flex;gap:8px">${inPausa(sess) ? '' : `<button class="btn2" data-azione="pausa" aria-label="Metti in pausa">${ic('pause')} Pausa</button>`}
      <button class="btn verde" data-azione="fine-sessione">Fine</button></span>` : `<button class="btn2" data-azione="chiudi-sessione">Chiudi</button>`}
  </div><div class="pila">`;
  // In pausa: il cronometro è fermo, il timer di recupero spento e lo schermo può spegnersi.
  if (inPausa(sess)) {
    html += `<div class="card pausa-card"><b>${ic('pause')} In pausa dalle ${fmtOraBreve(dataDa(sess.pausa_dal))}</b>
      <p class="tenue" style="margin:4px 0 10px">Il tempo di pausa non conta nella durata. Puoi chiudere l'app e tornare quando vuoi.</p>
      <button class="btn largo" data-azione="riprendi-pausa">${ic('play')} Riprendi l'allenamento</button></div>`;
  }
  // 30 minuti senza serie: forse hai finito e non hai premuto «Fine».
  const fermi = minutiFermi(sess);
  if (fermi >= MINUTI_AVVISO && S.avvisoIgnorato !== sess.id + '|' + ultimaAttivita(sess)) {
    const ultima = oraUltimaSerie(sess);
    html += `<div class="card avviso-card" id="avviso-fermo"><b>Nessuna serie da ${fmtMinuti(fermi * 60)}</b>
      <p class="tenue" style="margin:4px 0 10px">Hai finito? Puoi chiudere la sessione all'ora dell'ultima serie, o metterla in pausa.</p>
      ${ultima ? `<button class="btn largo" style="margin-bottom:8px" data-azione="fine-a" data-valore="${esc(ultima)}">Chiudi alle ${esc(ultima.slice(11, 16))}</button>` : ''}
      <div class="riga-btn"><button class="btn2" data-azione="pausa-da" data-valore="${esc(ultimaAttivita(sess))}">${ic('pause')} Pausa</button>
        <button class="btn2" data-azione="ignora-fermo">Continuo</button></div></div>`;
  }
  const esercizi = eserciziDi(sess.id);
  html += `<div class="blocchi pila">${disegnaBlocchi(esercizi, (se, lettera) => disegnaEsercizioSessione(sess, se, lettera))}</div>`;
  if (!esercizi.length) html += `<div class="vuoto-msg">Nessun esercizio. Aggiungine uno.</div>`;
  if (esercizi.length) {
    html += `<div class="riga-btn">${aperta ? '' : `<button class="btn2" data-azione="ripeti-sessione">${ic('play')} Ripeti</button>`}
      <button class="btn2" data-azione="salva-come-modello">${ic('copy')} Salva come modello</button></div>`;
  }
  html += `<button class="btn2 largo" data-azione="aggiungi-es" data-per="sessione">${ic('plus')} Esercizio</button>
    <textarea class="testo" placeholder="Nota sulla sessione" data-sess-campo="nota">${esc(sess.nota)}</textarea>
    <button class="btn2 pericolo largo" data-azione="elimina-sessione">${ic('trash')} ${aperta ? 'Annulla la sessione' : 'Elimina la sessione'}</button>
    <div class="stato-sync" data-stato-sync>${testoStatoSync()}</div></div>`;
  return html;
}

/* Ogni 30 secondi: se l'avviso «nessuna serie da 30 minuti» deve comparire (o sparire), si ridisegna.
 * Mai durante un trascinamento o mentre si scrive. */
function controllaAvvisoFermo() {
  const sess = sessioneInCorso();
  if (!sess) return;
  const chiave = sess.id + '|' + ultimaAttivita(sess);
  const serve = minutiFermi(sess) >= MINUTI_AVVISO && S.avvisoIgnorato !== chiave;
  // Vibrazione e suono una sola volta per ogni pausa lunga, e solo con l'app davanti
  // (se l'app non è in vista, Chrome la ferma: suonerebbe in ritardo al ritorno).
  if (serve && S.avvisoSuonato !== chiave && document.visibilityState === 'visible') {
    S.avvisoSuonato = chiave;
    suona();
    if (S.schermata !== 'sessione') mostraAvviso(`Nessuna serie da ${MINUTI_AVVISO} minuti: hai finito?`, () => vai('sessione', { sessioneId: sess.id }), 'Apri', 10000);
  }
  if (S.schermata !== 'sessione' || S.sessioneId !== sess.id || trascina || presa || S.compatto || !$('#velo').hidden) return;
  if (serve !== !!$('#avviso-fermo')) ridisegnaSePossibile();
}

// Ora dell'ultima serie spuntata di una sessione («AAAA-MM-GG HH:mm:ss»), oppure '' se nessuna.
function oraUltimaSerie(sess) {
  let ultima = '';
  eserciziDi(sess.id).forEach(se => serieDi(se.id).forEach(s => {
    if (s.fatta === SI && String(s.aggiornato_il) > ultima) ultima = String(s.aggiornato_il);
  }));
  return ultima && ultima > String(sess.inizio) ? ultima : '';
}

function aggiornaCronometro() {
  const el = $('#cronometro');
  if (!el) return;
  const sess = riga('Sessioni', S.sessioneId);
  if (!sess) return;
  el.textContent = fmtDurata(durataSessione(sess)) + (inPausa(sess) ? ' · in pausa' : '');
}

/* ---------- Storico ---------- */
function lunedi(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
function sessioniFinite() {
  return vivi('Sessioni').filter(s => s.fine).sort((a, b) => String(b.inizio).localeCompare(String(a.inizio)));
}
function chiaveGiorno(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/* Calendario di un mese: i giorni con sessioni sono pieni (verdi), oggi ha il bordo blu. */
function disegnaCalendario(sessioni) {
  const mese = S.meseStorico || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const giorni = new Map();
  sessioni.forEach(s => { const k = String(s.inizio).slice(0, 10); giorni.set(k, (giorni.get(k) || 0) + 1); });
  const oggi = chiaveGiorno(new Date());
  const primo = new Date(mese.getFullYear(), mese.getMonth(), 1);
  const ultimo = new Date(mese.getFullYear(), mese.getMonth() + 1, 0);
  // Settimane sempre complete: si parte dal lunedì della prima settimana e si arriva alla domenica dell'ultima.
  const inizio = new Date(primo); inizio.setDate(1 - (primo.getDay() + 6) % 7);
  const fine = new Date(ultimo); fine.setDate(ultimo.getDate() + (7 - ultimo.getDay()) % 7);
  const titolo = primo.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const quante = [...giorni.entries()].filter(([k]) => k.startsWith(chiaveGiorno(primo).slice(0, 7))).reduce((t, [, n]) => t + n, 0);
  let html = `<div class="card"><div class="fila"><button class="icona" data-azione="mese" data-valore="-1" aria-label="Mese precedente">${ic('arrow-left')}</button>
    <span style="text-align:center"><span style="display:block;font-size:16px;font-weight:500;text-transform:capitalize">${titolo}</span><span class="tenue">${quante} ${quante === 1 ? 'seduta' : 'sedute'}</span></span>
    <button class="icona" data-azione="mese" data-valore="1" aria-label="Mese successivo" style="transform:scaleX(-1)">${ic('arrow-left')}</button></div>
    <div class="calendario">${['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].map(n => `<span class="tenue">${n}</span>`).join('')}`;
  for (const d = new Date(inizio); d <= fine; d.setDate(d.getDate() + 1)) {
    const k = chiaveGiorno(d);
    const fuori = d.getMonth() !== primo.getMonth(); // giorno del mese prima o dopo: in grigio
    const classi = ['giorno', giorni.has(k) ? 'si' : '', k === oggi ? 'oggi' : '', k === S.giornoStorico ? 'scelto' : '', fuori ? 'fuori' : ''].join(' ');
    html += giorni.has(k)
      ? `<button class="${classi}" data-azione="giorno-storico" data-valore="${k}">${d.getDate()}</button>`
      : `<span class="${classi}">${d.getDate()}</span>`;
  }
  return html + `</div></div>`;
}

function cardSessione(s) {
  const d = dataDa(s.inizio);
  const r = riepilogoSessione(s);
  const elenco = r.nomi.slice(0, 3).join(' · ') + (r.nomi.length > 3 ? ` +${r.nomi.length - 3}` : '');
  return `<button class="card modello" data-azione="apri-sessione" data-id="${esc(s.id)}">
    <span class="fila"><span style="font-size:16px;font-weight:500">${esc(s.titolo)}</span><span class="tenue">${fmtGiorno(d)}</span></span>
    <span class="tenue" style="display:block;margin-top:4px">${fmtMinuti(r.durata)} · ${r.fatte} serie${r.volume ? ' · ' + fmtKg(r.volume) : ''}</span>
    ${elenco ? `<span style="display:block;font-size:13px;margin-top:6px;color:#cbd2dc">${esc(elenco)}</span>` : ''}</button>`;
}

function disegnaStorico() {
  const sessioni = sessioniFinite();
  const vista = S.vistaStorico || 'sessioni';
  let html = testata('Storico') + `<div class="pila">
    <div class="scelte" style="margin:0">
      <button class="scelta ${vista === 'sessioni' ? 'si' : ''}" data-azione="vista-storico" data-valore="sessioni">Sessioni</button>
      <button class="scelta ${vista === 'statistiche' ? 'si' : ''}" data-azione="vista-storico" data-valore="statistiche">Statistiche</button></div>`;
  if (vista === 'statistiche') return html + disegnaStatistiche(sessioni) + `</div>`;
  html += disegnaCalendario(sessioni);
  if (S.giornoStorico) {
    const delGiorno = sessioni.filter(s => String(s.inizio).startsWith(S.giornoStorico));
    html += `<div class="fila etichetta"><span>${fmtGiorno(giornoDa(S.giornoStorico))}</span>
      <button class="scelta" data-azione="giorno-storico" data-valore="${S.giornoStorico}">Mostra tutte</button></div>`;
    return html + delGiorno.map(cardSessione).join('') + `</div>`;
  }
  const lun = lunedi(new Date());
  // Con tanto storico (per esempio dopo l'importazione da Strong) si mostrano le ultime 100.
  const mostrate = sessioni.slice(0, S.storicoTutte ? sessioni.length : 100);
  const perSettimana = new Map();
  sessioni.forEach(s => { const k = lunedi(dataDa(s.inizio)).getTime(); perSettimana.set(k, (perSettimana.get(k) || 0) + 1); });
  let gruppo = null;
  mostrate.forEach(s => {
    const d = dataDa(s.inizio);
    const lunS = lunedi(d);
    const settimane = Math.round((lun - lunS) / (7 * 864e5));
    const nomeGruppo = settimane === 0 ? 'Questa settimana' : settimane === 1 ? 'Settimana scorsa' : 'Settimana dal ' + lunS.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    if (nomeGruppo !== gruppo) {
      gruppo = nomeGruppo;
      const quante = perSettimana.get(lunS.getTime());
      html += `<div class="etichetta">${nomeGruppo} · ${quante} ${quante === 1 ? 'seduta' : 'sedute'}</div>`;
    }
    html += cardSessione(s);
  });
  if (sessioni.length > mostrate.length) html += `<button class="btn2 largo" data-azione="storico-tutte">Mostra tutte (${sessioni.length})</button>`;
  if (!sessioni.length) html += `<div class="vuoto-msg">Le sessioni finite compariranno qui.</div>`;
  return html + `</div>`;
}

/* ---------- Statistiche ---------- */
// Grafico a barre semplice (SVG): valori [{ etichetta, v }].
function graficoBarre(valori, formato = v => fmtNum(v)) {
  const L = 320, A = 150, su = 18, giu = 22, sx = 6, dx = 6;
  const max = Math.max(1, ...valori.map(x => x.v));
  const larg = (L - sx - dx) / valori.length;
  let svg = `<svg viewBox="0 0 ${L} ${A}" width="100%" role="img" aria-label="Grafico a barre">`;
  valori.forEach((x, i) => {
    const h = x.v / max * (A - su - giu), xx = sx + i * larg + larg * 0.18, w = larg * 0.64, y = A - giu - h;
    svg += `<rect x="${xx.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, x.v ? 2 : 0).toFixed(1)}" rx="3" fill="#60a5fa"/>`;
    if (x.v) svg += `<text x="${(xx + w / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" fill="#cbd2dc" font-size="11">${formato(x.v)}</text>`;
    if (x.etichetta) svg += `<text x="${(xx + w / 2).toFixed(1)}" y="${A - 6}" text-anchor="middle" fill="#9aa3af" font-size="10">${esc(x.etichetta)}</text>`;
  });
  return svg + '</svg>';
}

function disegnaStatistiche(sessioni) {
  if (!sessioni.length) return `<div class="vuoto-msg">Le statistiche compariranno dopo le prime sessioni.</div>`;
  const lunOggi = lunedi(new Date());
  const settimana = s => Math.round((lunOggi - lunedi(dataDa(s.inizio))) / (7 * 864e5)); // 0 = questa settimana
  let html = '';

  // 1) Sedute a settimana, ultime 12 settimane.
  const perSett = Array(12).fill(0);
  sessioni.forEach(s => { const k = settimana(s); if (k >= 0 && k < 12) perSett[k]++; });
  const barre = perSett.map((v, k) => {
    const l = new Date(lunOggi); l.setDate(l.getDate() - 7 * k);
    return { v, etichetta: k % 3 === 0 ? `${l.getDate()}/${l.getMonth() + 1}` : '' };
  }).reverse();
  const media = perSett.slice(1, 9).reduce((a, b) => a + b, 0) / 8;
  html += `<div class="card"><h2>Sedute a settimana</h2>
    <p class="tenue" style="margin:2px 0 6px">Ultime 12 settimane · media delle 8 settimane precedenti: ${fmtNum(Math.round(media * 10) / 10)}</p>
    ${graficoBarre(barre)}</div>`;

  // 2) Aderenza ai modelli: sedute fatte su sedute previste (colonna «sedute_settimana» del modello).
  //    Si guardano la settimana in corso e le 4 settimane complete prima. Solo numeri, nessun colore di giudizio.
  const conFrequenza = vivi('Modelli').filter(m => num(m.sedute_settimana) > 0).sort(perNome);
  if (conFrequenza.length) {
    const righeAd = conFrequenza.map(m => {
      const prev = num(m.sedute_settimana);
      const fatte = sessioni.filter(s => s.modello_id === m.id);
      const ora0 = fatte.filter(s => settimana(s) === 0).length;
      const ult4 = fatte.filter(s => settimana(s) >= 1 && settimana(s) <= 4).length;
      return `<tr><td>${esc(m.nome)}</td><td>${ora0} di ${prev}</td><td>${ult4} di ${prev * 4} · ${Math.round(ult4 / (prev * 4) * 100)}%</td></tr>`;
    }).join('');
    html += `<div class="card"><h2>Aderenza ai modelli</h2><p class="tenue" style="margin:2px 0 6px">Sedute fatte su previste</p>
      <table class="tabella"><tr><th>Modello</th><th>questa sett.</th><th>4 sett. prima</th></tr>${righeAd}</table></div>`;
  } else {
    html += `<div class="card"><h2>Aderenza ai modelli</h2><p class="tenue" style="margin:6px 0 0">Per vederla, scrivi le «sedute previste a settimana» nei modelli (Esercizi → Modelli).</p></div>`;
  }

  // 3) Sedute per modello, ultime 4 settimane.
  const perModello = new Map();
  sessioni.filter(s => settimana(s) < 4 && settimana(s) >= 0).forEach(s => {
    const m = s.modello_id && riga('Modelli', s.modello_id);
    const nome = m ? m.nome : s.modello_id ? 'Modello eliminato' : 'Senza modello';
    perModello.set(nome, (perModello.get(nome) || 0) + 1);
  });
  html += `<div class="card"><h2>Sedute per modello</h2><p class="tenue" style="margin:2px 0 6px">Ultime 4 settimane</p>
    <table class="tabella">${[...perModello.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => `<tr><td>${esc(n)}</td><td>${v}</td></tr>`).join('') || '<tr><td>Nessuna seduta</td><td></td></tr>'}</table></div>`;

  // 4) Volume settimanale per gruppo muscolare (kg × ripetizioni delle serie fatte, senza riscaldamento).
  const vol = new Map(); // gruppo (senza maiuscole e accenti) -> { nome, v: [sett0..sett3] }
  const senzaGruppo = new Set();
  sessioni.forEach(s => {
    const k = settimana(s);
    if (k < 0 || k > 3) return;
    eserciziDi(s.id).forEach(se => {
      const es = riga('Esercizi', se.esercizio_id);
      const nomeGruppo = String((es && es.gruppo) || '').trim();
      if (!nomeGruppo && es) senzaGruppo.add(es.id);
      const chiave = semplifica(nomeGruppo) || 'senza gruppo';
      serieDi(se.id).forEach(x => {
        if (x.fatta !== SI || x.tipo === 'riscaldamento') return;
        const p = num(x.peso_kg), r = num(x.rip);
        if (isNaN(p) || isNaN(r) || !p || !r) return;
        if (!vol.has(chiave)) vol.set(chiave, { nome: nomeGruppo ? nomeGruppo[0].toUpperCase() + nomeGruppo.slice(1) : 'Senza gruppo', v: [0, 0, 0, 0] });
        vol.get(chiave).v[k] += p * r;
      });
    });
  });
  const kg = v => v ? Math.round(v).toLocaleString('it-IT') : '–';
  html += `<div class="card"><h2>Volume per gruppo</h2><p class="tenue" style="margin:2px 0 6px">kg × ripetizioni delle serie fatte</p>
    <table class="tabella"><tr><th>Gruppo</th><th>questa sett.</th><th>scorsa</th><th>media 4 sett.</th></tr>
    ${[...vol.values()].sort((a, b) => b.v.reduce((x, y) => x + y) - a.v.reduce((x, y) => x + y)).map(({ nome, v }) =>
      `<tr><td>${esc(nome)}</td><td>${kg(v[0])}</td><td>${kg(v[1])}</td><td>${kg(v.reduce((a, b) => a + b) / 4)}</td></tr>`).join('') || '<tr><td colspan="4">Nessuna serie con peso nelle ultime 4 settimane</td></tr>'}
    </table>
    ${senzaGruppo.size ? `<button class="btn2 largo" style="margin-top:8px" data-azione="vai-da-completare">${senzaGruppo.size} ${senzaGruppo.size === 1 ? 'esercizio usato non ha' : 'esercizi usati non hanno'} il gruppo: completali</button>` : ''}</div>`;
  html += `<p class="tenue" style="text-align:center">Record e grafici di ogni esercizio: scheda Esercizi, tocca un esercizio.</p>`;
  return html;
}

/* ---------- Andamento di un esercizio ---------- */
const COLORE_SERIE = { dx: '#60a5fa', sx: '#c4b5fd', entrambi: '#60a5fa' };
const COLORE_RIAB = ['#5eead4', '#f9a8d4']; // pienezza/malleolo e dolore/Achille: colori neutri, nessun semaforo
const PERIODI = { '3m': ['3 mesi', 92], '1a': ['1 anno', 366], tutto: ['tutto', 0] };

/** Per ogni sessione con l'esercizio: data, misure per lato (solo serie fatte, senza riscaldamento) e valori di riabilitazione. */
function storicoEsercizio(esercizioId) {
  const out = [];
  (indice('SessioniEsercizi', 'esercizio_id').get(esercizioId) || []).forEach(se => {
    const sess = riga('Sessioni', se.sessione_id);
    if (!sess || sess.eliminato === SI) return;
    const lati = {};
    serieDi(se.id).forEach(x => {
      if (x.fatta !== SI || x.tipo === 'riscaldamento') return;
      const lato = x.lato === 'dx' || x.lato === 'sx' ? x.lato : 'entrambi';
      const m = lati[lato] = lati[lato] || { maxPeso: null, ripMaxPeso: null, ripTot: 0, maxRip: null, volume: 0, maxDurata: null, durTot: 0, serie: 0 };
      const p = num(x.peso_kg), r = num(x.rip), d = num(x.durata_s);
      m.serie++;
      if (!isNaN(p) && (m.maxPeso === null || p > m.maxPeso || (p === m.maxPeso && r > m.ripMaxPeso))) { m.maxPeso = p; m.ripMaxPeso = isNaN(r) ? null : r; }
      if (!isNaN(r)) { m.ripTot += r; m.maxRip = Math.max(m.maxRip ?? 0, r); }
      if (!isNaN(p) && !isNaN(r)) m.volume += p * r;
      if (!isNaN(d)) { m.durTot += d; m.maxDurata = Math.max(m.maxDurata ?? 0, d); }
    });
    out.push({ sess, se, t: dataDa(sess.inizio), lati });
  });
  return out.filter(x => x.t).sort((a, b) => a.t - b.t);
}

function disegnaAndamentoEsercizio() {
  const es = riga('Esercizi', S.esercizioVisto);
  if (!es) { S.schermata = 'esercizi'; return disegnaArchivio(); }
  const tipo = tipoDi(es);
  const periodo = S.periodo || '1a';
  const giorni = PERIODI[periodo][1];
  const tutto = storicoEsercizio(es.id);
  const dati = giorni ? tutto.filter(x => (Date.now() - x.t) / 864e5 <= giorni) : tutto;
  const latiPresenti = ['dx', 'sx', 'entrambi'].filter(l => dati.some(x => x.lati[l]));
  const nomeLato = { dx: 'destro', sx: 'sinistro', entrambi: latiPresenti.length > 1 ? 'entrambi' : '' };
  // «entrambi» con dx/sx presenti usa un terzo colore, per non confonderlo con il destro.
  const colore = l => l === 'entrambi' && latiPresenti.length > 1 ? '#e5e7eb' : COLORE_SERIE[l];

  let html = testata(esc(es.nome), 'indietro', `<button class="icona" data-azione="apri-esercizio" data-id="${esc(es.id)}" aria-label="Modifica esercizio">${ic('edit')}</button>`) + `<div class="pila">
    <div class="tenue">${esc(TIPI_ES[tipo])}${es.gruppo ? ' · ' + esc(es.gruppo) : ''}${RIAB[es.area] ? ` <span class="tag">${esc(es.area)}</span>` : ''} · ${tutto.length} ${tutto.length === 1 ? 'sessione' : 'sessioni'}</div>
    <div class="scelte" style="margin:0">${Object.entries(PERIODI).map(([k, [n]]) =>
      `<button class="scelta ${periodo === k ? 'si' : ''}" data-azione="periodo" data-valore="${k}">${n}</button>`).join('')}</div>`;
  if (!tutto.length) return html + `<div class="vuoto-msg">Questo esercizio non è ancora in nessuna sessione.</div></div>`;

  const legenda = latiPresenti.length > 1 ? `<div class="legenda">${latiPresenti.map(l => `<span style="color:${colore(l)}">● ${nomeLato[l]}</span>`).join('')}</div>` : '';
  const grafico = (titolo, unita, valore) => {
    const serie = latiPresenti.map(l => ({ nome: nomeLato[l], colore: colore(l), punti: dati.filter(x => x.lati[l] && valore(x.lati[l]) != null).map(x => ({ t: x.t, y: valore(x.lati[l]) })) }));
    const punti = serie.reduce((t, s) => t + s.punti.length, 0);
    if (!punti) return '';
    return `<div class="card"><h2>${titolo} <span class="tenue">(${unita})</span></h2>${legenda}
      ${punti > 1 ? graficoLinee(serie, unita) : '<p class="tenue">Il grafico compare dalla seconda sessione.</p>'}</div>`;
  };
  const graficiPerTipo = {
    peso_rip: [['Carico massimo', 'kg', m => m.maxPeso], ['Ripetizioni totali', 'rip', m => m.ripTot || null], ['Volume', 'kg', m => m.volume || null]],
    rip: [['Ripetizioni totali', 'rip', m => m.ripTot || null], ['Massimo in una serie', 'rip', m => m.maxRip]],
    durata: [['Durata massima', 's', m => m.maxDurata], ['Durata totale', 's', m => m.durTot || null]],
    peso_durata: [['Carico massimo', 'kg', m => m.maxPeso], ['Durata massima', 's', m => m.maxDurata]],
    cardio: [['Durata totale', 'min', m => m.durTot ? Math.round(m.durTot / 6) / 10 : null]],
  }[tipo];
  graficiPerTipo.forEach(([titolo, unita, f], i) => {
    html += grafico(titolo, unita, f);
    if (i === 0) html += graficoRiabilitazione(es, dati); // pienezza e dolore accanto ai carichi
  });
  if (!dati.length) html += `<div class="vuoto-msg">Nessuna sessione in questo periodo.</div>`;
  html += disegnaRecord(tipo, tutto, latiPresenti.length ? latiPresenti : ['entrambi'], nomeLato);
  return html + `</div>`;
}

function graficoRiabilitazione(es, dati) {
  const riab = RIAB[es.area];
  if (!riab) return '';
  const serie = riab.campi.map(([c, n], i) => ({ nome: n.toLowerCase(), colore: COLORE_RIAB[i], punti: dati.filter(x => x.se[c] !== '' && !isNaN(num(x.se[c]))).map(x => ({ t: x.t, y: num(x.se[c]) })) }));
  const punti = serie.reduce((t, s) => t + s.punti.length, 0);
  if (!punti) return `<div class="card"><h2>${riab.titolo.replace('Riabilitazione', 'Sensazioni')}</h2><p class="tenue">Nessun valore registrato in questo periodo.</p></div>`;
  return `<div class="card"><h2>${riab.titolo.replace('Riabilitazione', 'Sensazioni')} <span class="tenue">(0-10)</span></h2>
    <div class="legenda">${riab.campi.map(([, n], i) => `<span style="color:${COLORE_RIAB[i]}">● ${n.toLowerCase()}</span>`).join('')}</div>
    ${punti > 1 ? graficoLinee(serie, '0-10') : '<p class="tenue">Il grafico compare dal secondo valore.</p>'}</div>`;
}

/* Record: il valore più alto mai registrato (su tutto lo storico), con la data. Solo numeri, nessun giudizio. */
function disegnaRecord(tipo, tutto, lati, nomeLato) {
  const migliore = (lato, f) => {
    let top = null;
    tutto.forEach(x => { const m = x.lati[lato]; const v = m && f(m); if (v != null && v !== 0 && (!top || v > top.v)) top = { v, m, t: x.t }; });
    return top;
  };
  const voci = {
    peso_rip: [['Carico massimo', m => m.maxPeso, r => `${fmtNum(r.v)} kg${r.m.ripMaxPeso != null ? ' × ' + r.m.ripMaxPeso : ''}`],
      ['Più ripetizioni in una serie', m => m.maxRip, r => `${r.v}`], ['Volume in una sessione', m => m.volume, r => fmtKg(r.v)]],
    rip: [['Più ripetizioni in una serie', m => m.maxRip, r => `${r.v}`], ['Ripetizioni in una sessione', m => m.ripTot, r => `${r.v}`]],
    durata: [['Durata massima', m => m.maxDurata, r => `${r.v} s`], ['Durata totale in una sessione', m => m.durTot, r => `${r.v} s`]],
    peso_durata: [['Carico massimo', m => m.maxPeso, r => `${fmtNum(r.v)} kg`], ['Durata massima', m => m.maxDurata, r => `${r.v} s`]],
    cardio: [['Durata più lunga', m => m.durTot, r => fmtMinuti(r.v)]],
  }[tipo];
  let righe = '';
  voci.forEach(([nome, f, testo]) => lati.forEach(l => {
    const r = migliore(l, f);
    if (r) righe += `<tr><td>${nome}${nomeLato[l] ? ` <span style="color:${l === 'entrambi' ? '#e5e7eb' : COLORE_SERIE[l]}">${nomeLato[l]}</span>` : ''}</td><td>${testo(r)}</td><td class="tenue">${r.t.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: '2-digit' })}</td></tr>`;
  }));
  return righe ? `<div class="card"><h2>Record</h2><table class="tabella" style="margin-top:4px">${righe}</table></div>` : '';
}

/* ---------- Esercizi e modelli (archivio) ---------- */
// Testo semplificato per le ricerche: minuscole e senza accenti («àlzate» trova «alzate»).
function semplifica(t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function elencoEsercizi(filtro, conArchiviati = false) {
  const f = semplifica(filtro);
  return vivi('Esercizi').filter(e => (conArchiviati || e.archiviato !== SI) && (!f || semplifica(e.nome).includes(f) || semplifica(e.gruppo).includes(f)))
    .sort(perNome);
}
// Esercizi «da completare»: senza gruppo muscolare o senza recupero (tipicamente quelli arrivati da Strong).
function daCompletare(e) { return e.archiviato !== SI && (!String(e.gruppo || '').trim() || !(num(e.recupero_s) > 0)); }
function disegnaArchivio() {
  const vista = S.vistaArchivio;
  let html = testata('Esercizi') + `<div class="pila">
    <div class="scelte" style="margin:0">
      <button class="scelta ${vista === 'esercizi' ? 'si' : ''}" data-azione="vista-archivio" data-valore="esercizi">Esercizi</button>
      <button class="scelta ${vista === 'modelli' ? 'si' : ''}" data-azione="vista-archivio" data-valore="modelli">Modelli</button></div>`;
  if (vista === 'modelli') {
    html += `<button class="btn2 largo" data-azione="nuovo-modello">${ic('plus')} Nuovo modello</button>`;
    let cartella = null;
    const modelli = modelliOrdinati();
    modelli.forEach(m => {
      if (m.cartella !== cartella) { cartella = m.cartella; html += `<div class="etichetta">${esc(cartella || 'Senza cartella')}</div>`; }
      html += `<button class="card fila modello" data-azione="apri-modello" data-id="${esc(m.id)}">
        <span><span style="display:block;font-size:16px">${esc(m.nome)}</span><span class="tenue">${vociDi(m.id).length} esercizi</span></span>${ic('chevron-right')}</button>`;
    });
    if (!modelli.length) html += `<div class="vuoto-msg">Nessun modello.</div>`;
    return html + `</div>`;
  }
  const quanti = vivi('Esercizi').filter(daCompletare).length;
  html += `<input class="testo" type="search" placeholder="Cerca un esercizio" data-ricerca="archivio" value="${esc(S.ricercaArchivio)}">
    <div class="riga-btn"><button class="btn2" data-azione="nuovo-esercizio">${ic('plus')} Nuovo esercizio</button>
      <button class="btn2" data-azione="mostra-archiviati">${S.mostraArchiviati ? 'Nascondi archiviati' : 'Mostra archiviati'}</button></div>
    ${quanti || S.daCompletare ? `<button class="scelta ${S.daCompletare ? 'si' : ''}" data-azione="da-completare" style="align-self:flex-start">Da completare (${quanti})</button>` : ''}
    ${S.daCompletare ? `<p class="tenue" style="margin:0">Esercizi senza gruppo muscolare o senza recupero: le statistiche per gruppo e il timer ne hanno bisogno.</p>
      ${vivi('Esercizi').some(e => e.archiviato !== SI && !(num(e.recupero_s) > 0)) ? `<button class="btn2 largo" data-azione="recupero-90">Recupero 90 s a quelli che non ce l'hanno</button>` : ''}` : ''}
    <div id="lista-archivio" class="pila">${righeArchivio()}</div></div>`;
  return html;
}
function righeArchivio() {
  let lista = elencoEsercizi(S.ricercaArchivio, S.mostraArchiviati);
  if (S.daCompletare) lista = lista.filter(daCompletare);
  if (!lista.length) return `<div class="vuoto-msg">Nessun esercizio trovato.</div>`;
  return lista.map(e => `<button class="card modello" data-azione="vedi-esercizio" data-id="${esc(e.id)}">
    <span style="display:block;font-size:16px">${esc(e.nome)}${e.archiviato === SI ? ' <span class="tenue">(archiviato)</span>' : ''}</span>
    <span class="tenue">${esc(TIPI_ES[e.tipo] || e.tipo)}${e.gruppo ? ' · ' + esc(e.gruppo) : ''}${e.attrezzo ? ' · ' + esc(e.attrezzo) : ''}${RIAB[e.area] ? ` <span class="tag">${esc(e.area)}</span>` : ''}</span></button>`).join('');
}

/* ---------- Modulo di un esercizio (nuovo o da modificare) ---------- */
function datalist(id, valori) {
  return `<datalist id="${id}">${[...new Set(valori.filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
}
function disegnaFormEsercizio() {
  const b = S.bozzaEs;
  if (!b) { S.schermata = 'esercizi'; return disegnaArchivio(); }
  const scelte = (campo, opzioni) => `<div class="scelte">${Object.entries(opzioni).map(([v, t]) =>
    `<button class="scelta ${b[campo] === v ? 'si' : ''}" data-azione="bozza-scelta" data-campo="${campo}" data-valore="${v}">${t}</button>`).join('')}</div>`;
  const tutti = vivi('Esercizi');
  return testata(b.id ? 'Modifica esercizio' : 'Nuovo esercizio', 'indietro') + `<div class="pila"><div class="card">
    <div class="campo-modulo"><label for="f-nome">Nome</label><input class="testo" id="f-nome" value="${esc(b.nome)}"></div>
    <div class="tenue">Tipo</div>${scelte('tipo', TIPI_ES)}
    ${b.id && b.tipoOriginale && b.tipo !== b.tipoOriginale ? '<p class="tenue">Cambiare il tipo non modifica le serie già registrate.</p>' : ''}
    <div class="tenue">Area</div>${scelte('area', AREE)}
    <div class="campo-modulo"><label for="f-attrezzo">Attrezzo</label><input class="testo" id="f-attrezzo" list="l-attrezzi" value="${esc(b.attrezzo)}"></div>
    <div class="campo-modulo"><label for="f-gruppo">Gruppo muscolare</label><input class="testo" id="f-gruppo" list="l-gruppi" value="${esc(b.gruppo)}"></div>
    <div class="campo-modulo"><label for="f-recupero">Recupero predefinito (secondi, 0 = nessun timer)</label><input class="testo" id="f-recupero" inputmode="numeric" value="${esc(b.recupero_s)}"></div>
    <div class="campo-modulo"><label for="f-nota">Nota</label><textarea class="testo" id="f-nota">${esc(b.nota)}</textarea></div>
    <div class="campo-modulo"><label for="f-strong">Nomi in Strong (separati da «; »)</label><input class="testo" id="f-strong" value="${esc(b.nome_strong)}"></div>
    <div class="tenue">Archiviato (nascosto dalla ricerca, resta nello storico)</div>${scelte('archiviato', { no: 'No', 'sì': 'Sì' })}
    <p class="errore" id="f-errore" style="font-size:13px"></p>
    <button class="btn largo" data-azione="salva-esercizio">Salva</button>
    ${datalist('l-attrezzi', tutti.map(e => e.attrezzo))}${datalist('l-gruppi', tutti.map(e => e.gruppo))}
  </div></div>`;
}
function leggiFormEsercizio() {
  const b = S.bozzaEs;
  b.nome = $('#f-nome').value; b.attrezzo = $('#f-attrezzo').value; b.gruppo = $('#f-gruppo').value;
  b.recupero_s = $('#f-recupero').value; b.nota = $('#f-nota').value; b.nome_strong = $('#f-strong').value;
}

/* ---------- Modello (modifica) ---------- */
function disegnaVoceModello(me, lettera) {
  const es = riga('Esercizi', me.esercizio_id);
  const tipo = tipoDi(es);
  const serie = previsteDi(me.id);
  const recEs = es ? num(es.recupero_s) : NaN;
  let html = `<div class="card" style="padding:12px 8px">
    <div class="fila" style="padding:0 4px 8px;align-items:flex-start"><div>
      <div class="es-titolo" data-tieni="ModelliEsercizi" data-id="${esc(me.id)}">${lettera ? lettera + ' · ' : ''}${esc(es ? es.nome : 'Esercizio non trovato (' + me.esercizio_id + ')')}</div>
      ${es && RIAB[es.area] ? `<span class="tag">${esc(es.area)}</span>` : ''}<span class="tenue">${esc(TIPI_ES[tipo])}</span>
    </div><button class="icona" data-azione="menu-es" data-scheda="ModelliEsercizi" data-id="${esc(me.id)}" aria-label="Opzioni esercizio">${ic('dots')}</button></div>
    <div class="riab-riga" style="grid-template-columns:84px minmax(0,1fr);padding:0 4px"><span class="tenue">Recupero (s)</span>
      <input class="testo" inputmode="numeric" data-me-campo="recupero_s" data-id="${esc(me.id)}" value="${esc(fmtNum(me.recupero_s))}" placeholder="${isNaN(recEs) ? 'nessuno' : recEs + ' (dell\'esercizio)'}"></div>
    <div style="padding:0 4px 8px"><input class="testo" placeholder="Indicazione per la sessione (es. lento in discesa)" data-me-campo="nota" data-id="${esc(me.id)}" value="${esc(me.nota)}"></div>`;
  html += intestazioneSerie(tipo, false);
  serie.forEach(s => { html += rigaSerie('ModelliSerie', tipo, serie, s, lettera, null); });
  html += `<div class="riga-btn" style="padding:8px 4px 0">
    <button class="btn2" style="font-size:14px" data-azione="aggiungi-serie" data-scheda="ModelliSerie" data-padre="${esc(me.id)}">${ic('plus')} Serie</button>
    <button class="btn2" style="font-size:14px" data-azione="copia-precedente" data-scheda="ModelliSerie" data-padre="${esc(me.id)}">${ic('copy')} Copia precedente</button></div>`;
  return html + `</div>`;
}
function disegnaModello() {
  const m = riga('Modelli', S.modelloId);
  if (!m || m.eliminato === SI) { S.schermata = 'esercizi'; return disegnaArchivio(); }
  const voci = vociDi(m.id);
  let html = testata('Modello', 'torna-modelli', `<button class="icona" data-azione="menu-modello" aria-label="Opzioni modello">${ic('dots')}</button>`) + `<div class="pila">
    <div class="card">
      <div class="campo-modulo"><label for="m-nome">Nome</label><input class="testo" id="m-nome" data-mod-campo="nome" value="${esc(m.nome)}"></div>
      <div class="campo-modulo"><label for="m-cartella">Cartella</label><input class="testo" id="m-cartella" list="l-cartelle" data-mod-campo="cartella" value="${esc(m.cartella)}"></div>
      <div class="riga-btn">
        <div class="campo-modulo"><label for="m-ordine">Ordine nella cartella</label><input class="testo" id="m-ordine" inputmode="numeric" data-mod-campo="ordine" value="${esc(fmtNum(m.ordine))}"></div>
        <div class="campo-modulo"><label for="m-sedute">Sedute previste a settimana</label><input class="testo" id="m-sedute" inputmode="numeric" placeholder="nessuna" data-mod-campo="sedute_settimana" value="${esc(fmtNum(m.sedute_settimana))}"></div>
      </div>
      ${((meta.colonneMancanti || {}).Modelli || []).includes('sedute_settimana')
        ? `<p class="tenue" style="margin:0 0 10px">Nel foglio manca ancora la colonna «sedute_settimana» (scheda Modelli): il numero resta sul telefono e parte da solo appena la aggiungi.</p>` : ''}
      <div class="campo-modulo" style="margin:0"><label for="m-nota">Nota</label><textarea class="testo" id="m-nota" data-mod-campo="nota">${esc(m.nota)}</textarea></div>
      ${datalist('l-cartelle', vivi('Modelli').map(x => x.cartella))}
    </div>`;
  html += `<div class="blocchi pila">${disegnaBlocchi(voci, disegnaVoceModello)}</div>`;
  if (!voci.length) html += `<div class="vuoto-msg">Nessun esercizio nel modello.</div>`;
  html += `<button class="btn2 largo" data-azione="aggiungi-es" data-per="modello">${ic('plus')} Esercizio</button>
    <button class="btn largo" data-azione="avvia-modello" data-id="${esc(m.id)}">${ic('play')} Inizia una sessione</button></div>`;
  return html;
}

/* ---------- Test ---------- */
// Data del test: solo il giorno, «AAAA-MM-GG». Si legge a mezzogiorno per non cambiare giorno col fuso.
function giornoDa(t) {
  const g = normalizzaData(t, 'giorno');
  return /^\d{4}-\d{2}-\d{2}/.test(g) ? new Date(g.slice(0, 10) + 'T12:00:00') : null;
}
function fmtGiornoBreve(t) {
  const d = giornoDa(t);
  if (!d) return esc(String(t || ''));
  const stessoAnno = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('it-IT', stessoAnno ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
function giorniFa(data) {
  const d = giornoDa(data);
  if (!d) return '';
  const n = Math.round((giornoDa(chiaveGiorno(new Date())) - d) / 864e5);
  return n <= 0 ? 'ultima prova oggi' : n === 1 ? 'ultima prova ieri' : `ultima prova ${n} giorni fa`;
}
function infoTest(tipo) { return TEST[tipo] || { nome: tipo, breve: tipo, unita: '' }; }
function unitaTest(tipo, righe) { return infoTest(tipo).unita || (righe.find(r => r.unita) || {}).unita || ''; }

/** Le prove di un tipo di test, dalla più recente: [{ data, dx, sx, altri[] }]. Per lato vince la riga modificata per ultima. */
function proveDi(tipo) {
  const perData = new Map();
  vivi('Test').filter(r => r.tipo === tipo).forEach(r => {
    const data = normalizzaData(r.data, 'giorno').slice(0, 10);
    if (!perData.has(data)) perData.set(data, { data, dx: null, sx: null, altri: [] });
    const p = perData.get(data);
    if (r.lato === 'dx' || r.lato === 'sx') {
      if (!p[r.lato] || String(r.aggiornato_il) > String(p[r.lato].aggiornato_il)) p[r.lato] = r;
    } else p.altri.push(r);
  });
  return [...perData.values()].sort((a, b) => b.data.localeCompare(a.data));
}
function tipiTest() {
  const presenti = new Set(vivi('Test').map(r => r.tipo).filter(Boolean));
  return [...Object.keys(TEST), ...[...presenti].filter(t => !TEST[t]).sort()];
}
function valoreConUnita(r, unita) { return r && r.valore !== '' ? esc(`${fmtNum(r.valore)}${unita ? ' ' + unita : ''}`) : '–'; }

/* ---------- Grafico a linee (SVG fatto a mano), riusabile ---------- */
// serie: [{ nome, colore, punti: [{ t: Date, y: numero }] }]
function graficoLinee(serie, unita) {
  const tutti = serie.flatMap(s => s.punti);
  if (!tutti.length) return '';
  const L = 320, A = 170, sx = 34, dx = 10, su = 12, giu = 24;
  // Asse verticale con numeri «tondi»: passo di 1, 2 o 5 (per 10, 100…), circa tre intervalli.
  const vMin = Math.min(...tutti.map(p => p.y)), vMax = Math.max(...tutti.map(p => p.y));
  const grezzo = Math.max((vMax - vMin) / 3, 0.5);
  const potenza = Math.pow(10, Math.floor(Math.log10(grezzo)));
  const passo = [1, 2, 5, 10].map(m => m * potenza).find(p => p >= grezzo);
  let yMin = Math.floor(vMin / passo) * passo, yMax = Math.ceil(vMax / passo) * passo;
  if (yMin === vMin && yMin - passo >= 0) yMin -= passo; // un po' d'aria sotto il valore più basso
  if (yMax === vMax) yMax += passo;                         // e sopra il più alto
  const tMin = Math.min(...tutti.map(p => +p.t)), tMax = Math.max(...tutti.map(p => +p.t));
  const X = t => tMax === tMin ? (sx + L - dx) / 2 : sx + (t - tMin) / (tMax - tMin) * (L - sx - dx);
  const Y = y => su + (yMax - y) / (yMax - yMin) * (A - su - giu);
  // Ogni grafico si ricorda i suoi dati: toccandolo si vede il valore del giorno più vicino.
  const id = 'g' + (++contaGrafici);
  GRAFICI.set(id, { serie, unita, tMin, tMax, sx, dx, L, X, A, su, giu });
  let svg = `<svg viewBox="0 0 ${L} ${A}" width="100%" role="img" aria-label="Andamento nel tempo${unita ? ' in ' + esc(unita) : ''}. Tocca per vedere i valori." data-grafico="${id}" style="cursor:pointer">`;
  for (let v = yMin; v <= yMax + passo / 2; v += passo) {
    const y = Y(v);
    svg += `<line x1="${sx}" y1="${y}" x2="${L - dx}" y2="${y}" stroke="#2a2e36"/><text x="${sx - 6}" y="${y + 4}" text-anchor="end" fill="#9aa3af" font-size="11">${fmtNum(Math.round(v * 10) / 10)}</text>`;
  }
  const date = [...new Set(tutti.map(p => +p.t))].sort((a, b) => a - b);
  const etichette = date.length <= 3 ? date : [date[0], date[Math.floor(date.length / 2)], date[date.length - 1]];
  etichette.forEach((t, i) => {
    const anc = etichette.length === 1 ? 'middle' : i === 0 ? 'start' : i === etichette.length - 1 ? 'end' : 'middle';
    svg += `<text x="${X(t)}" y="${A - 6}" text-anchor="${anc}" fill="#9aa3af" font-size="11">${new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}</text>`;
  });
  serie.forEach(s => {
    const punti = s.punti.slice().sort((a, b) => a.t - b.t);
    if (punti.length > 1) svg += `<polyline fill="none" stroke="${s.colore}" stroke-width="2.5" stroke-linejoin="round" points="${punti.map(p => `${X(+p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}"/>`;
    // Con tanti punti si disegna solo la linea (e l'ultimo punto), altrimenti i pallini si accavallano.
    (punti.length > 30 ? punti.slice(-1) : punti).forEach(p => { svg += `<circle cx="${X(+p.t).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.5" fill="${s.colore}"/>`; });
  });
  svg += `<line class="segno" x1="0" y1="${su}" x2="0" y2="${A - giu}" stroke="#cbd2dc" stroke-dasharray="3 3" visibility="hidden"/>`;
  return svg + `</svg><div class="valore-grafico" data-valore-di="${id}">Tocca il grafico per vedere i valori</div>`;
}
const GRAFICI = new Map();
let contaGrafici = 0;
// Tocco su un grafico: giorno più vicino, con i valori di ogni linea in quel giorno.
document.addEventListener('click', e => {
  const svg = e.target.closest('svg[data-grafico]');
  if (!svg) return;
  const g = GRAFICI.get(svg.dataset.grafico);
  if (!g) return;
  const b = svg.getBoundingClientRect();
  const x = (e.clientX - b.left) / b.width * g.L;
  const giorni = [...new Set(g.serie.flatMap(s => s.punti.map(p => +p.t)))];
  const t = giorni.reduce((m, d) => Math.abs(g.X(d) - x) < Math.abs(g.X(m) - x) ? d : m, giorni[0]);
  const valori = g.serie.map(s => {
    const p = s.punti.find(q => +q.t === t);
    return p ? `<span style="color:${s.colore}">${s.nome ? esc(s.nome) + ' ' : ''}<b>${numH(Math.round(p.y * 10) / 10)}</b></span>` : '';
  }).filter(Boolean);
  const testo = svg.nextElementSibling;
  if (testo) testo.innerHTML = `${new Date(t).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${valori.join(' · ')}${g.unita ? ' <span class="tenue">' + esc(g.unita) + '</span>' : ''}`;
  const segno = svg.querySelector('.segno');
  segno.setAttribute('x1', g.X(t)); segno.setAttribute('x2', g.X(t)); segno.setAttribute('visibility', 'visible');
});

/* ---------- Test ---------- */
function disegnaTest() {
  let html = testata('Test') + `<div class="pila">
    <button class="btn largo" data-azione="nuovo-test">${ic('plus')} Nuovo test</button>`;
  tipiTest().forEach(tipo => {
    const info = infoTest(tipo), prove = proveDi(tipo), u = unitaTest(tipo, vivi('Test').filter(r => r.tipo === tipo));
    const ultima = prove[0], prima = prove[1];
    html += `<button class="card modello" data-azione="apri-test" data-valore="${esc(tipo)}">
      <span class="fila"><span style="font-size:16px">${esc(info.nome)}</span><span class="tenue">${ultima ? fmtGiornoBreve(ultima.data) + ' ' + ic('chevron-right') : 'mai fatto'}</span></span>
      ${ultima ? `<span class="tenue" style="display:block">${giorniFa(ultima.data)}</span>` : ''}`;
    if (ultima) {
      html += `<span class="valori-test"><span><span class="tenue lato-test">destro</span><b style="color:${COLORE_LATO.dx}">${ultima.dx && ultima.dx.valore !== '' ? numH(ultima.dx.valore) : '–'}</b> ${esc(u)}</span>
        <span><span class="tenue lato-test">sinistro</span><b style="color:${COLORE_LATO.sx}">${ultima.sx && ultima.sx.valore !== '' ? numH(ultima.sx.valore) : '–'}</b> ${esc(u)}</span></span>`;
      if (prima) html += `<span class="tenue" style="display:block;margin-top:4px">il ${fmtGiornoBreve(prima.data)}: ${prima.dx ? numH(prima.dx.valore) : '–'} · ${prima.sx ? numH(prima.sx.valore) : '–'} ${esc(u)}</span>`;
    }
    html += `</button>`;
  });
  return html + `</div>`;
}

function disegnaAndamentoTest() {
  const tipo = S.testTipo;
  const info = infoTest(tipo), prove = proveDi(tipo), u = unitaTest(tipo, vivi('Test').filter(r => r.tipo === tipo));
  let html = testata(esc(info.breve), 'torna-test', `<button class="icona" data-azione="nuovo-test" data-valore="${esc(tipo)}" aria-label="Nuovo test">${ic('plus')}</button>`) + `<div class="pila">`;
  if (!prove.length) return html + `<div class="vuoto-msg">Nessuna prova registrata.</div></div>`;
  const serie = ['dx', 'sx'].map(lato => ({
    nome: lato === 'dx' ? 'destro' : 'sinistro',
    colore: COLORE_LATO[lato],
    punti: prove.filter(p => p[lato] && p[lato].valore !== '' && !isNaN(num(p[lato].valore))).map(p => ({ t: giornoDa(p.data), y: num(p[lato].valore) })),
  }));
  html += `<div class="card"><div class="fila tenue" style="margin-bottom:6px"><span>${esc(u)}</span>
      <span><span style="color:${COLORE_LATO.dx}">● destro</span> &nbsp; <span style="color:${COLORE_LATO.sx}">● sinistro</span></span></div>
    ${prove.length > 1 ? graficoLinee(serie, u) : '<p class="tenue">Il grafico compare dalla seconda prova.</p>'}</div>`;
  html += `<div class="card" style="padding:6px 8px"><table class="tabella">
    <tr><th>Data</th><th style="color:${COLORE_LATO.dx}">dx</th><th style="color:${COLORE_LATO.sx}">sx</th><th>dolore dx · sx</th></tr>`;
  prove.forEach(p => {
    const dol = r => r && r.dolore !== '' ? numH(r.dolore) : '–';
    const note = [p.dx && p.dx.nota ? 'dx: ' + p.dx.nota : '', p.sx && p.sx.nota ? 'sx: ' + p.sx.nota : '', ...p.altri.map(r => `${r.lato || '?'}: ${fmtNum(r.valore)} ${r.nota || ''}`)].filter(Boolean);
    html += `<tr data-azione="modifica-test" data-valore="${esc(p.data)}"><td>${fmtGiornoBreve(p.data)}</td>
      <td>${p.dx ? numH(p.dx.valore) || '–' : '–'}</td><td>${p.sx ? numH(p.sx.valore) || '–' : '–'}</td><td>${dol(p.dx)} · ${dol(p.sx)}</td></tr>`;
    if (note.length) html += `<tr data-azione="modifica-test" data-valore="${esc(p.data)}" class="riga-nota"><td colspan="4">${note.map(esc).join(' · ')}</td></tr>`;
  });
  return html + `</table></div><p class="tenue" style="text-align:center;margin:0">Tocca una riga per correggerla o eliminarla.</p></div>`;
}

/* Modulo di un test: destro e sinistro insieme. */
function bozzaTest(tipo, data) {
  const lato = r => r ? { id: r.id, valore: fmtNum(r.valore), dolore: fmtNum(r.dolore), nota: r.nota } : { id: '', valore: '', dolore: '', nota: '' };
  const prova = data ? proveDi(tipo).find(p => p.data === data) : null;
  return { tipo, data: data || ora().slice(0, 10), dataOriginale: data || '', modifica: !!prova, dx: lato(prova && prova.dx), sx: lato(prova && prova.sx) };
}
function disegnaFormTest() {
  const b = S.bozzaTest;
  if (!b) { S.schermata = 'test'; return disegnaTest(); }
  const u = unitaTest(b.tipo, vivi('Test').filter(r => r.tipo === b.tipo));
  const precedente = lato => proveDi(b.tipo).find(p => p.data < b.data && p[lato] && p[lato].valore !== '');
  let html = testata(b.modifica ? 'Modifica test' : 'Nuovo test', b.modifica ? 'torna-andamento' : 'torna-test') + `<div class="pila">`;
  html += b.modifica ? `<div style="font-size:17px;font-weight:500">${esc(infoTest(b.tipo).nome)}</div>`
    : `<div class="scelte" style="margin:0">${tipiTest().map(t => `<button class="scelta ${b.tipo === t ? 'si' : ''}" data-azione="bozza-test-tipo" data-valore="${esc(t)}">${esc(infoTest(t).breve)}</button>`).join('')}</div>`;
  html += `<div class="fila"><label class="tenue" for="t-data">Data</label><input class="testo" id="t-data" type="date" style="width:auto" value="${esc(b.data)}"></div>`;
  ['dx', 'sx'].forEach(lato => {
    const v = b[lato], prec = precedente(lato);
    html += `<div class="card">
      <div class="fila"><span style="font-weight:500;color:${COLORE_LATO[lato]}">${lato === 'dx' ? 'Destro' : 'Sinistro'}</span>
        <span class="tenue">${prec ? `ultima volta ${valoreConUnita(prec[lato], u)} (${fmtGiornoBreve(prec.data)})` : ''}</span></div>
      <div class="riga-btn" style="margin-top:8px">
        <div><div class="tenue">${esc(u || 'valore')}</div><input class="num grande-test" inputmode="decimal" autocomplete="off" id="t-${lato}-valore" value="${esc(v.valore)}"></div>
        <div><div class="tenue">dolore 0-10</div><input class="num grande-test" inputmode="decimal" autocomplete="off" id="t-${lato}-dolore" placeholder="–" value="${esc(v.dolore)}"></div>
      </div>
      <input class="testo" style="margin-top:8px" id="t-${lato}-nota" placeholder="nota breve" value="${esc(v.nota)}">
    </div>`;
  });
  html += `<p class="errore" id="t-errore" style="font-size:13px;margin:0"></p>
    <button class="btn largo" data-azione="salva-test">Salva</button>
    ${b.modifica ? `<button class="btn2 pericolo largo" data-azione="elimina-test">${ic('trash')} Elimina questa prova</button>` : ''}</div>`;
  return html;
}
function leggiFormTest() {
  const b = S.bozzaTest;
  b.data = $('#t-data').value || b.data;
  ['dx', 'sx'].forEach(lato => ['valore', 'dolore', 'nota'].forEach(c => { b[lato][c] = $(`#t-${lato}-${c}`).value; }));
}

/* ======================= Diario (guidato dal foglio) =======================
 * Le voci NON sono scritte qui: si leggono dalla scheda DiarioCampi (attivo = sì, ordinate per «ordine»,
 * raggruppate per «sezione»). Le risposte vanno in DiarioValori (id «DV-giorno-voce»), i farmaci si leggono
 * da Farmaci e le assunzioni vanno in DiarioFarmaci (id «DF-giorno-farmaco»). Nessuna soglia, nessun giudizio. */

// «sì» scritto in modi diversi nel foglio (sì, si, Sì, true…).
function siVero(v) { return ['si', 'yes', 'true', '1', 'x'].includes(semplifica(v)); }
function oggiG() { return ora().slice(0, 10); }
function vociDiario() {
  return vivi('DiarioCampi').filter(c => siVero(c.attivo))
    .sort((a, b) => (num(a.ordine) || 0) - (num(b.ordine) || 0) || String(a.id).localeCompare(String(b.id)));
}
// Un farmaco è «in elenco» per un giorno se dal <= giorno <= al (al vuoto = senza fine).
function farmaciDel(g) {
  return vivi('Farmaci').filter(f => {
    const dal = normalizzaData(f.dal, 'giorno'), al = normalizzaData(f.al, 'giorno');
    return (!dal || dal <= g) && (!al || g <= al);
  }).sort(perNome);
}
const idValore = (g, campoId) => `DV-${g}-${campoId}`;
const idFarmaco = (g, farmacoId) => `DF-${g}-${farmacoId}`;
function valoreDiario(g, campoId) { const r = riga('DiarioValori', idValore(g, campoId)); return r && r.eliminato !== SI ? r : null; }
function rigaFarmaco(g, farmacoId) { const r = riga('DiarioFarmaci', idFarmaco(g, farmacoId)); return r && r.eliminato !== SI ? r : null; }
function haValore(r) { return !!r && r.valore !== '' && r.valore != null; }

/** Salva il valore e/o la nota di una voce. Se valore e nota restano vuoti, la riga è segnata eliminata (vuoto ≠ 0). */
async function salvaValoreDiario(g, campo, cambi) {
  const id = idValore(g, campo.id);
  const esistente = riga('DiarioValori', id);
  const r = esistente || nuovaRiga('DiarioValori', { id, giorno: g, campo_id: campo.id });
  if ('valore' in cambi) r.valore = cambi.valore;
  if ('nota' in cambi) r.nota = cambi.nota;
  const vuota = (r.valore === '' || r.valore == null) && !String(r.nota || '').trim();
  if (vuota && (!esistente || esistente.eliminato === SI)) return; // mai creata o già vuota: nessuna riga inutile
  r.giorno = g;
  // Copia leggibile «sezione – etichetta», anche se la voce cambia nome (una sola volta se sono uguali).
  const sez = String(campo.sezione || '').trim(), et = String(campo.etichetta || '').trim();
  r.campo_etichetta = sez && et && sez !== et ? `${sez} – ${et}` : (et || sez);
  r.eliminato = vuota ? SI : NO;
  await salva(['DiarioValori', r]);
}

/** Assunzioni di un farmaco: la riga nasce al primo tocco; «prese» resta tra 0 e le previste. */
async function salvaFarmaco(g, f, cambi) {
  const id = idFarmaco(g, f.id);
  const r = riga('DiarioFarmaci', id) || nuovaRiga('DiarioFarmaci', { id, giorno: g, farmaco_id: f.id, prese: 0, nota: '' });
  const previste = num(f.previste_al_giorno);
  r.farmaco_nome = f.nome;
  r.previste = isNaN(previste) ? '' : previste;
  if ('delta' in cambi) {
    const max = isNaN(previste) || previste <= 0 ? Infinity : previste;
    r.prese = Math.max(0, Math.min(max, (num(r.prese) || 0) + cambi.delta));
  }
  if ('nota' in cambi) r.nota = cambi.nota;
  r.eliminato = NO;
  await salva(['DiarioFarmaci', r]);
}

/** «x voci su y»: voci di tipo scala, sino ed elenco con un valore, più i farmaci del giorno presi almeno una volta. */
function statoDiario(g) {
  const voci = vociDiario().filter(c => ['scala', 'sino', 'elenco'].includes(semplifica(c.tipo)));
  const farmaci = vociDiario().some(c => semplifica(c.tipo) === 'farmaci') ? farmaciDel(g) : [];
  const fatte = voci.filter(c => haValore(valoreDiario(g, c.id))).length + farmaci.filter(f => (num((rigaFarmaco(g, f.id) || {}).prese) || 0) >= 1).length;
  let ultima = '';
  vivi('DiarioValori').concat(vivi('DiarioFarmaci')).forEach(r => { if (normalizzaData(r.giorno, 'giorno') === g && String(r.aggiornato_il) > ultima) ultima = String(r.aggiornato_il); });
  return { fatte, totali: voci.length + farmaci.length, ultima };
}

function fmtGiornoDiario(g) {
  const d = giornoDa(g);
  if (!d) return esc(g);
  const testo = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  if (g === oggiG()) return 'oggi, ' + testo;
  const ieri = new Date(giornoDa(oggiG()) - 864e5);
  return (chiaveGiorno(ieri) === g ? 'ieri, ' : '') + testo + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
}

function controlloVoce(g, c) {
  const tipo = semplifica(c.tipo);
  const r = valoreDiario(g, c.id);
  const v = r ? r.valore : '';
  const attr = `data-campo="${esc(c.id)}"`;
  if (tipo === 'scala') {
    let min = num(c.scala_min), max = num(c.scala_max);
    if (isNaN(min)) min = 0;
    if (isNaN(max)) max = 10;
    if (max - min <= 10) {
      let bottoni = '';
      for (let n = min; n <= max; n++) bottoni += `<button class="dv-num ${String(v) === String(n) ? 'si' : ''}" data-azione="dv-scelta" ${attr} data-valore="${n}">${n}</button>`;
      return `<div class="dv-scala">${bottoni}</div>`;
    }
    // Scala ampia: cursore con il numero grande, e un tasto per toglierlo.
    return `<div class="dv-cursore"><b>${v === '' ? '–' : numH(v)}</b>
      <input type="range" min="${min}" max="${max}" step="1" value="${v === '' ? Math.round((min + max) / 2) : esc(v)}" data-dv-range ${attr} aria-label="${esc(c.etichetta)}">
      ${v === '' ? '' : `<button class="scelta" data-azione="dv-scelta" ${attr} data-valore="${esc(v)}">Togli</button>`}</div>`;
  }
  if (tipo === 'sino') {
    return `<div class="dv-scelte">${[['sì', 'Sì'], ['no', 'No']].map(([val, t]) =>
      `<button class="scelta ${semplifica(v) === semplifica(val) && v !== '' ? 'si' : ''}" data-azione="dv-scelta" ${attr} data-valore="${val}">${t}</button>`).join('')}</div>`;
  }
  if (tipo === 'elenco') {
    const opzioni = String(c.opzioni || '').split(';').map(x => x.trim()).filter(Boolean);
    return `<div class="dv-scelte">${opzioni.map(o =>
      `<button class="scelta ${String(v) === o ? 'si' : ''}" data-azione="dv-scelta" ${attr} data-valore="${esc(o)}">${esc(o)}</button>`).join('') || '<span class="tenue">Nessuna opzione nel foglio.</span>'}</div>`;
  }
  if (tipo === 'testo') {
    return `<textarea class="testo" rows="3" placeholder="scrivi qui…" data-dv-campo ${attr} data-parte="valore">${esc(v)}</textarea>`;
  }
  if (tipo === 'farmaci') {
    const farmaci = farmaciDel(g);
    if (!farmaci.length) return `<p class="tenue" style="margin:0">Nessun farmaco in elenco per questo giorno.</p>`;
    return farmaci.map(f => {
      const rf = rigaFarmaco(g, f.id);
      const prese = rf ? num(rf.prese) || 0 : 0;
      const previste = num(f.previste_al_giorno);
      const completo = !isNaN(previste) && previste > 0 && prese >= previste;
      return `<div class="dv-farmaco">
        <div class="fila"><span><span style="display:block">${esc(f.nome)}</span><span class="tenue">${esc(f.dose_testo)}</span></span>
          <span class="dv-contatore ${completo ? 'fatto' : ''}">
            <button class="dv-cbtn" data-azione="df-meno" data-farmaco="${esc(f.id)}" aria-label="Togli un'assunzione di ${esc(f.nome)}">−</button>
            <b>${prese}${isNaN(previste) ? '' : ' / ' + previste}</b>
            <button class="dv-cbtn" data-azione="df-piu" data-farmaco="${esc(f.id)}" aria-label="Aggiungi un'assunzione di ${esc(f.nome)}">+</button></span></div>
        <input class="testo" placeholder="nota (facoltativa)" data-df-nota data-farmaco="${esc(f.id)}" value="${esc(rf ? rf.nota : '')}">
      </div>`;
    }).join('');
  }
  return `<p class="tenue" style="margin:0">Tipo non supportato: aggiorna l'app.</p>`;
}

function disegnaDiario() {
  const g = S.giornoDiario || oggiG();
  let html = testata('Diario');
  const voci = vociDiario();
  if (!voci.length) {
    let msg;
    if (meta.versionePonte && meta.versionePonte < PONTE_DIARIO) msg = `Per il Diario serve il ponte aggiornato (versione ${PONTE_DIARIO}). Oggi è la versione ${esc(meta.versionePonte)}: ripubblica <b>Code.gs</b> come spiegato nel README.`;
    else if (!meta.diarioScaricato) msg = 'Le voci del diario non sono ancora state scaricate dal foglio. Collegati a internet e riapri l\'app.';
    else msg = 'Nella scheda DiarioCampi del foglio non c\'è nessuna voce attiva.';
    return html + `<div class="vuoto-msg">${msg}</div>`;
  }
  const st = statoDiario(g);
  html += `<div class="pila">
    <div class="dv-giorno">
      <button class="icona" data-azione="giorno-diario" data-valore="-1" aria-label="Giorno prima">${ic('arrow-left')}</button>
      <label class="dv-data"><span>${fmtGiornoDiario(g)}</span><input type="date" id="diario-data" max="${oggiG()}" value="${g}" aria-label="Scegli il giorno"></label>
      <button class="icona" data-azione="giorno-diario" data-valore="1" aria-label="Giorno dopo" ${g >= oggiG() ? 'disabled' : ''} style="transform:scaleX(-1)">${ic('arrow-left')}</button>
    </div>
    <p class="tenue" style="margin:0 4px">${st.fatte} ${st.fatte === 1 ? 'voce' : 'voci'} su ${st.totali} compilate${st.ultima ? ' · ultima modifica ' + esc(st.ultima.slice(11, 16)) : ''} · si salva da solo</p>`;
  let sezione = null, aperta = false;
  voci.forEach(c => {
    if (!aperta || c.sezione !== sezione) {
      if (aperta) html += `</div>`;
      sezione = c.sezione;
      html += `${sezione ? `<div class="sez-diario">${esc(sezione)}</div>` : ''}<div class="card dv-card">`;
      aperta = true;
    }
    const r = valoreDiario(g, c.id);
    html += `<div class="dv-voce">
      ${c.etichetta && c.etichetta !== c.sezione ? `<div class="dv-etichetta">${esc(c.etichetta)}</div>` : ''}
      ${c.aiuto ? `<div class="tenue dv-aiuto">${esc(c.aiuto)}</div>` : ''}
      ${controlloVoce(g, c)}
      ${siVero(c.ha_nota) ? `<input class="testo dv-nota" placeholder="nota breve" data-dv-campo data-campo="${esc(c.id)}" data-parte="nota" value="${esc(r ? r.nota : '')}">` : ''}
    </div>`;
  });
  if (aperta) html += `</div>`;
  html += disegnaAllenamentoDelGiorno(g);
  return html + `</div>`;
}

/* Sola lettura: i valori registrati durante l'allenamento quel giorno (pienezza, dolore, malleolo, Achille). */
function disegnaAllenamentoDelGiorno(g) {
  const righe = [];
  vivi('Sessioni').filter(s => normalizzaData(s.inizio).slice(0, 10) === g).forEach(sess => {
    eserciziDi(sess.id).forEach(se => {
      const es = riga('Esercizi', se.esercizio_id);
      const valori = Object.values(RIAB).flatMap(a => a.campi).filter(([c]) => se[c] !== '' && se[c] != null || se[c + '_nota'])
        .map(([c, nome]) => `${nome.toLowerCase()} <b>${se[c] !== '' && se[c] != null ? numH(se[c]) : '–'}</b>${se[c + '_nota'] ? ` <span class="tenue">«${esc(se[c + '_nota'])}»</span>` : ''}`);
      if (valori.length) righe.push(`<div class="dv-sola">${esc(es ? es.nome : 'Esercizio')} · ${valori.join(' · ')}</div>`);
    });
  });
  return `<div class="sez-diario" style="color:var(--tenue)">Durante l'allenamento (sola lettura)</div>
    <div class="card">${righe.join('') || '<p class="tenue" style="margin:0">Nessun valore registrato durante l\'allenamento in questo giorno.</p>'}</div>`;
}

/* ---------- Impostazioni ---------- */
function disegnaImpostazioni() {
  return testata('Impostazioni', 'torna-oggi') + `<div class="pila">
    <div class="card">
      <h2>Ponte con il foglio</h2>
      <div class="campo-modulo" style="margin-top:10px"><label for="imp-url">Indirizzo dell'app web (Apps Script)</label>
        <input class="testo" id="imp-url" type="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(meta.url || '')}"></div>
      <div class="campo-modulo"><label for="imp-token">Token</label>
        <input class="testo" id="imp-token" type="password" autocomplete="off" placeholder="${meta.token ? 'già impostato: scrivi per cambiarlo' : 'la chiave che hai messo in GYM_TOKEN'}"></div>
      <div class="riga-btn"><button class="btn" data-azione="imp-salva">Salva</button><button class="btn2" data-azione="imp-prova">Prova</button></div>
      <p class="tenue" id="imp-esito"></p>
    </div>
    <div class="card">
      <h2>Sincronizzazione</h2>
      <p class="tenue" style="margin:8px 0">Modifiche in coda: <b>${codaQuante}</b><br>
        Ultimo invio: ${esc(meta.ultimoInvio || 'mai')}<br>Ultima lettura dal foglio: ${esc(meta.ultimaLettura || 'mai')}<br>
        ${meta.ultimoErrore ? `<span class="errore">Ultimo errore: ${esc(meta.ultimoErrore)}</span>` : 'Nessun errore'}<br>
        Memoria del telefono: <span id="stato-memoria">…</span></p>
      <div class="riga-btn"><button class="btn2" data-azione="imp-sync">Sincronizza ora</button><button class="btn2" data-azione="imp-riscarica">Rileggi tutto</button></div>
    </div>
    <div class="card">
      <h2>Sessione</h2>
      <p class="tenue" style="margin:8px 0">Colonna RPE nelle serie. Se non la usi, nascondila: i numeri hanno più spazio. I valori già scritti restano nel foglio.</p>
      <div class="scelte" style="margin:0">
        <button class="scelta ${conRpe() ? 'si' : ''}" data-azione="rpe" data-valore="mostra">Mostra RPE</button>
        <button class="scelta ${conRpe() ? '' : 'si'}" data-azione="rpe" data-valore="nascondi">Nascondi RPE</button></div>
    </div>
    <div class="card">
      <h2>Storico di Strong</h2>
      <p class="tenue" style="margin:8px 0">In Strong, dalle impostazioni, usa la voce per esportare i dati (export): ottieni un file CSV. Poi sceglilo qui. Prima di scrivere ti mostro un riepilogo. Le sessioni già importate non vengono ripetute.</p>
      <button class="btn2 largo" data-azione="scegli-csv">${ic('upload')} Scegli il file CSV</button>
      <input type="file" id="file-strong" accept=".csv,text/csv,text/comma-separated-values,text/plain" hidden>
    </div>
    <div class="card">
      <h2>Copia di sicurezza</h2>
      <p class="tenue" style="margin:8px 0">Scarica in un file tutti i dati presenti sul telefono (senza il token).</p>
      <button class="btn2 largo" data-azione="imp-esporta">Esporta i dati</button>
    </div>
    <div class="card">
      <h2>Versione</h2>
      <p class="tenue" style="margin:8px 0">Gym · versione <b>${VERSIONE_APP}</b> · unità di peso: kg<br>
        Ponte (Code.gs): ${meta.versionePonte ? `versione <b>${esc(meta.versionePonte)}</b>${meta.versionePonte < PONTE_DIARIO ? ' · <span class="errore">da aggiornare</span>' : ''}` : 'non ancora letto'}<br>
        Schema del foglio: ${meta.versioneSchema ? `versione ${esc(meta.versioneSchema)}${meta.versioneSchema !== '1' ? ' · <span class="errore">diversa da quella che l\'app conosce (1)</span>' : ''}` : '–'}</p>
      <button class="btn2 largo" data-azione="cerca-aggiornamenti">Cerca aggiornamenti</button>
    </div>
  </div>`;
}

/* ======================= Importazione da Strong ======================= */

function leggiCSV(testo) {
  testo = testo.replace(/^﻿/, '');
  const fineRiga = testo.indexOf('\n');
  const prima = fineRiga === -1 ? testo : testo.slice(0, fineRiga);
  const sep = (prima.match(/;/g) || []).length > (prima.match(/,/g) || []).length ? ';' : ',';
  const righe = [];
  let campo = '', r = [], virgolette = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (virgolette) {
      if (c === '"') { if (testo[i + 1] === '"') { campo += '"'; i++; } else virgolette = false; }
      else campo += c;
    } else if (c === '"') virgolette = true;
    else if (c === sep) { r.push(campo); campo = ''; }
    else if (c === '\n') { r.push(campo); righe.push(r); r = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || r.length) { r.push(campo); righe.push(r); }
  return righe.filter(x => x.some(v => v.trim() !== ''));
}

// Data e ora complete «AAAA-MM-GG HH:mm:ss» (sempre con i secondi), per riconoscere le sessioni già importate.
// Accetta anche il formato italiano; restituisce null se non è una data con l'ora.
function dataOraStrong(t) {
  const n = normalizzaData(t, 'ora');
  const m = n.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}`;
}
function secondiDaDurata(t) {
  const s = String(t || '');
  const h = s.match(/(\d+)\s*h/), m = s.match(/(\d+)\s*m(?!s)/), sec = s.match(/(\d+)\s*s/);
  return (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0) + (sec ? +sec[1] : 0);
}

/** Analizza il CSV di Strong senza scrivere nulla. Restituisce le righe da salvare e un riepilogo. */
function analizzaStrong(testo) {
  const righe = leggiCSV(testo);
  if (righe.length < 2) throw new Error('il file è vuoto');
  const intest = righe[0].map(h => h.trim());
  const col = nome => intest.indexOf(nome);
  const servono = ['Date', 'Workout Name', 'Exercise Name', 'Set Order', 'Weight', 'Reps'];
  const mancano = servono.filter(n => col(n) === -1);
  if (mancano.length) throw new Error('mancano le colonne: ' + mancano.join(', '));
  const val = (r, nome) => (col(nome) === -1 ? '' : String(r[col(nome)] ?? '').trim());

  // Esercizi conosciuti, cercati per nome di Strong (anche più nomi separati da «;»).
  const perNomeStrong = new Map();
  vivi('Esercizi').forEach(e => String(e.nome_strong || '').split(';').map(n => n.trim().toLowerCase()).filter(Boolean)
    .forEach(n => { if (!perNomeStrong.has(n)) perNomeStrong.set(n, e.id); }));
  // Sessioni già presenti (anche eliminate): stessa ora di inizio e stesso titolo.
  const giaPresenti = new Set([...D.Sessioni.values()].map(s => dataOraStrong(s.inizio) + '|' + String(s.titolo).trim()));

  const sessioni = new Map(); // chiave -> { sess, esercizi: Map(nome -> {se, serie[]}) }
  const nuoviEsercizi = new Map();
  let saltate = 0, distanze = 0, lbs = 0, gia = 0;
  const giaViste = new Set();
  for (let i = 1; i < righe.length; i++) {
    const r = righe[i];
    const inizio = dataOraStrong(val(r, 'Date'));
    const titolo = val(r, 'Workout Name') || 'Allenamento';
    const nomeEs = val(r, 'Exercise Name');
    if (!inizio || !nomeEs) { saltate++; continue; }
    const chiave = inizio + '|' + titolo;
    if (giaPresenti.has(chiave)) { if (!giaViste.has(chiave)) { giaViste.add(chiave); gia++; } continue; }
    const ordine = val(r, 'Set Order').toUpperCase();
    let tipoSerie;
    if (/^\d+$/.test(ordine) || ordine === 'D') tipoSerie = 'normale';
    else if (ordine === 'W') tipoSerie = 'riscaldamento';
    else if (ordine === 'F') tipoSerie = 'cedimento';
    else { saltate++; continue; } // per esempio le righe del timer di riposo

    let gruppo = sessioni.get(chiave);
    if (!gruppo) {
      const dur = secondiDaDurata(val(r, 'Workout Duration'));
      const fine = dur ? ora(new Date(dataDa(inizio).getTime() + dur * 1000)) : inizio;
      gruppo = { sess: nuovaRiga('Sessioni', { id: nuovoId('SE'), titolo, modello_id: '', inizio, fine, nota: '' }), esercizi: new Map() };
      sessioni.set(chiave, gruppo);
    }
    const notaSess = val(r, 'Workout Notes');
    if (notaSess && !gruppo.sess.nota) gruppo.sess.nota = notaSess;

    let esId = perNomeStrong.get(nomeEs.toLowerCase());
    if (!esId) {
      let nuovo = nuoviEsercizi.get(nomeEs.toLowerCase());
      if (!nuovo) {
        // Recupero predefinito 90 s, così il timer parte anche per gli esercizi arrivati da Strong.
        nuovo = nuovaRiga('Esercizi', { id: nuovoId('EX'), nome: nomeEs, nome_strong: nomeEs, tipo: 'peso_rip', area: 'altro', recupero_s: 90, origine: 'app', archiviato: NO });
        nuoviEsercizi.set(nomeEs.toLowerCase(), nuovo);
      }
      esId = nuovo.id;
    }
    let es = gruppo.esercizi.get(esId);
    if (!es) {
      es = { se: nuovaRiga('SessioniEsercizi', { id: nuovoId('SX'), sessione_id: gruppo.sess.id, posizione: gruppo.esercizi.size + 1, esercizio_id: esId }), serie: [], note: [] };
      gruppo.esercizi.set(esId, es);
    }
    const nota = val(r, 'Notes');
    if (nota && !es.note.includes(nota)) es.note.push(nota);

    let peso = leggiNum(val(r, 'Weight'));
    if (peso === null) peso = '';
    if (peso !== '' && /lb/i.test(val(r, 'Weight Unit'))) { peso = Math.round(peso * 0.45359237 * 100) / 100; lbs++; }
    let rip = leggiNum(val(r, 'Reps')); if (rip === null) rip = '';
    let sec = leggiNum(val(r, 'Seconds')); if (sec === null || sec === 0) sec = '';
    if (rip === 0 && sec !== '') rip = '';
    let rpe = leggiNum(val(r, 'RPE')); if (rpe === null || rpe === 0) rpe = '';
    if (leggiNum(val(r, 'Distance'))) distanze++;
    es.serie.push(nuovaRiga('Serie', { id: nuovoId('SR'), sessione_esercizio_id: es.se.id, posizione: es.serie.length + 1,
      tipo: tipoSerie, lato: 'entrambi', peso_kg: peso, rip: rip === '' ? '' : Math.round(rip), durata_s: sec === '' ? '' : Math.round(sec), rpe, fatta: SI }));
  }

  const daSalvare = [];
  nuoviEsercizi.forEach(e => daSalvare.push(['Esercizi', e]));
  let nSerie = 0;
  sessioni.forEach(g => {
    daSalvare.push(['Sessioni', g.sess]);
    g.esercizi.forEach(es => {
      es.se.nota = es.note.join('\n'); // le note restano testo: nessuna interpretazione
      daSalvare.push(['SessioniEsercizi', es.se]);
      es.serie.forEach(s => { daSalvare.push(['Serie', s]); nSerie++; });
    });
  });
  return {
    daSalvare, sessioni: sessioni.size, serie: nSerie, gia, saltate, distanze, lbs,
    nuovi: [...nuoviEsercizi.values()].map(e => e.nome).sort((a, b) => a.localeCompare(b, 'it')),
  };
}

function foglioRiepilogoImport(r) {
  const nomi = r.nuovi.slice(0, 40).map(esc).join('<br>') + (r.nuovi.length > 40 ? `<br>… e altri ${r.nuovi.length - 40}` : '');
  return `<h2>Importazione da Strong</h2>
    <div class="riepilogo" style="margin:14px 0"><div><b>${r.sessioni}</b><span class="tenue">sessioni</span></div>
      <div><b>${r.serie}</b><span class="tenue">serie</span></div><div><b>${r.nuovi.length}</b><span class="tenue">esercizi nuovi</span></div></div>
    ${r.gia ? `<p class="tenue">${r.gia} ${r.gia === 1 ? 'sessione era già importata e viene saltata' : 'sessioni erano già importate e vengono saltate'}.</p>` : ''}
    ${r.saltate ? `<p class="tenue">${r.saltate} righe saltate (senza data o esercizio, oppure righe del timer di riposo).</p>` : ''}
    ${r.distanze ? `<p class="tenue">${r.distanze} serie hanno una distanza: il foglio non ha una colonna per la distanza, quindi non viene importata.</p>` : ''}
    ${r.lbs ? `<p class="tenue">${r.lbs} pesi erano in libbre e sono stati convertiti in kg.</p>` : ''}
    ${r.nuovi.length ? `<p class="tenue">Esercizi senza corrispondenza in «nome_strong»: verranno creati come «peso e ripetizioni», area «altro». Potrai correggerli in Esercizi.</p>
      <div class="card" style="max-height:30vh;overflow:auto;font-size:14px">${nomi}</div>` : ''}
    <p class="errore" id="imp-errore" style="font-size:13px"></p>
    <div class="riga-btn" style="margin-top:12px"><button class="btn2" data-azione="chiudi-foglio">Annulla</button>
      ${r.sessioni ? `<button class="btn" data-azione="conferma-import">Importa</button>` : ''}</div>`;
}

/* ======================= Fogli dal basso ======================= */

function apriFoglio(html) {
  $('#foglio').innerHTML = html;
  if ($('#velo').hidden) {
    $('#velo').hidden = false;
    history.pushState(Object.assign(statoAttuale(), { foglio: true }), ''); // «indietro» chiuderà il foglio
  }
}
function chiudiFoglio() {
  if ($('#velo').hidden) return;
  $('#velo').hidden = true; $('#foglio').innerHTML = '';
  // Il passo del foglio diventa un passo normale (doppio), che «indietro» poi salta.
  if (history.state && history.state.foglio) history.replaceState(statoAttuale(), '');
}

/* ----- Ordinare gli esercizi: tenendo premuto sul nome, le schede si compattano qui stesso ----- */
// S.compatto = { scheda, padre } mentre il dito tiene premuto; quando si alza, le schede si riaprono.
function vociCompatte() {
  const { scheda, padre } = S.compatto;
  return `<div id="ordina-lista">${blocchi(figli(scheda, padre)).map(b => {
    const nomi = b.map((x, i) => `${b.length > 1 ? (i ? 'B' : 'A') + ' · ' : ''}${esc(nomeVoce(scheda, x))}`).join('<br>');
    return `<div class="ord-voce ${b.length > 1 ? 'ord-coppia' : ''}" data-ids="${b.map(x => esc(x.id)).join(',')}">
      <span class="ord-maniglia">${ic('grip')}</span><span style="flex:1">${nomi}</span></div>`;
  }).join('')}</div>`;
}
async function salvaOrdine(ids) {
  const { scheda } = S.compatto;
  const cambiate = [];
  ids.forEach((id, k) => {
    const r = riga(scheda, id);
    if (num(r.posizione) !== k + 1) { r.posizione = k + 1; cambiate.push([scheda, r]); }
  });
  if (cambiate.length) await salvaLista(cambiate);
}
async function invertiCoppia(scheda, id) {
  const a = riga(scheda, id);
  const b = compagno(fratelliDi(scheda, a), a);
  if (!b) return;
  [a.posizione, b.posizione] = [b.posizione, a.posizione];
  await salva([scheda, a], [scheda, b]);
}

/* Trascinamento fluido nell'elenco compatto.
 * Nessuna riga cambia posto nel documento mentre si trascina: la riga presa segue il dito
 * (spostamento continuo) e le altre scivolano via con una piccola animazione. Il nuovo ordine
 * si applica quando il dito si alza. */
let presa = null;
const metaAltezza = x => { const b = x.getBoundingClientRect(); return b.top + b.height / 2; };
function prendi(el, pid, y) {
  const voci = [...el.parentNode.children];
  const sy = window.scrollY;
  // Posizioni di partenza di tutte le righe, misurate sulla pagina (non sullo schermo).
  const pos = voci.map(v => { const b = v.getBoundingClientRect(); return { el: v, top: b.top + sy, h: b.height }; });
  const spazio = pos.length > 1 ? pos[1].top - pos[0].top - pos[0].h : 8;
  presa = { el, pid, pos, spazio, i0: voci.indexOf(el), ordine: voci, mosso: false, y, y0: y, sy0: sy, arrivo: 0, frame: 0 };
  el.classList.add('presa');
  muoviPresa();
  presa.frame = setInterval(scorriAlBordo, 16); // circa 60 volte al secondo
}
function muoviPresa() {
  const p = presa;
  const io = p.pos[p.i0];
  // Il centro della riga presa si sposta quanto il dito (e quanto la pagina, se scorre da sola).
  const spostamento = (p.y - p.y0) + (window.scrollY - p.sy0);
  const centro = io.top + io.h / 2 + spostamento;
  p.el.style.transform = `translateY(${spostamento}px)`;
  // Nuovo ordine: le altre righe restano in fila, la presa va dove cade il suo centro.
  const altre = p.pos.filter((_, k) => k !== p.i0);
  const posto = altre.filter(x => x.top + x.h / 2 < centro).length;
  const ordine = altre.map(x => x.el);
  ordine.splice(posto, 0, p.el);
  if (ordine.some((v, k) => v !== p.ordine[k])) {
    p.ordine = ordine; p.mosso = true;
    if (navigator.vibrate) navigator.vibrate(8); // un piccolo «tic» a ogni cambio di posto
  }
  // Ogni riga scivola verso il suo nuovo posto; per la presa si ricorda dove dovrà posarsi.
  let top = p.pos[0].top;
  p.ordine.forEach(v => {
    const o = p.pos.find(x => x.el === v);
    if (v === p.el) p.arrivo = top - o.top;
    else v.style.transform = Math.abs(top - o.top) < 0.5 ? '' : `translateY(${Math.round(top - o.top)}px)`;
    top += o.h + p.spazio;
  });
}
// Se il dito arriva vicino al bordo dello schermo, la pagina scorre da sola.
function scorriAlBordo() {
  if (!presa) return;
  const alto = 80, basso = window.innerHeight - 150; // sopra la barra in basso
  let v = 0;
  if (presa.y < alto) v = -Math.ceil((alto - presa.y) / 5);
  else if (presa.y > basso) v = Math.ceil((presa.y - basso) / 5);
  if (v) {
    const prima = window.scrollY;
    window.scrollBy(0, v);
    if (window.scrollY !== prima) muoviPresa();
  }
}
document.addEventListener('pointermove', e => {
  if (!presa || e.pointerId !== presa.pid) return;
  presa.y = e.clientY;
  muoviPresa();
});
// Quando il dito si alza: la riga si posa al suo posto, si salva l'ordine e le schede si riaprono.
async function lasciaPresa() {
  if (!presa) return;
  const p = presa;
  presa = null;
  clearInterval(p.frame);
  p.el.classList.remove('presa'); // torna l'animazione: la riga scivola nel posto libero
  p.el.style.transform = p.arrivo ? `translateY(${p.arrivo}px)` : '';
  if (!S.compatto) return;
  const el = p.el;
  const primo = el.dataset.ids.split(',')[0];
  await new Promise(r => setTimeout(r, 170));
  if (p.mosso) await salvaOrdine(p.ordine.flatMap(v => v.dataset.ids.split(',')));
  S.compatto = null;
  $('#schermo').classList.remove('in-ordine');
  disegna();
  // Si torna alla scheda dell'esercizio appena spostato.
  const titolo = document.querySelector(`[data-tieni][data-id="${CSS.escape(primo)}"]`);
  if (titolo) titolo.scrollIntoView({ block: 'center' });
}
document.addEventListener('pointerup', lasciaPresa);
document.addEventListener('pointercancel', lasciaPresa);
// Mentre si trascina, la pagina non deve scorrere sotto il dito.
document.addEventListener('touchmove', e => { if (presa || (pressione && pressione.scattata)) e.preventDefault(); }, { passive: false });

// Pressione lunga sul nome di un esercizio: tutte le schede si compattano e si trascina subito.
let pressione = null;
document.addEventListener('pointerdown', e => {
  const t = e.target.closest('[data-tieni]');
  if (!t || e.button > 0) return;
  pressione = {
    x: e.clientX, y: e.clientY, scattata: false,
    timer: setTimeout(() => {
      pressione.scattata = true;
      if (navigator.vibrate) navigator.vibrate(30);
      const scheda = t.dataset.tieni, id = t.dataset.id;
      const blocchiEl = $('#schermo .blocchi');
      if (!blocchiEl) return;
      S.compatto = { scheda, padre: riga(scheda, id)[PADRE[scheda]] };
      // Le schede vengono solo nascoste (non tolte): il nome premuto resta nella pagina finché il dito è giù,
      // altrimenti il telefono perderebbe il tocco e farebbe scorrere la pagina.
      blocchiEl.insertAdjacentHTML('beforebegin', vociCompatte());
      $('#schermo').classList.add('in-ordine');
      // La riga dell'esercizio premuto viene messa sotto il dito, che la trascina senza alzarsi.
      const voce = [...document.querySelectorAll('.ord-voce')].find(v => v.dataset.ids.split(',').includes(id));
      // Se la riga è più in alto del dito, si lascia spazio sopra l'elenco; se è più in basso, la pagina scorre.
      const scarto = pressione.y - metaAltezza(voce);
      if (scarto > 0) $('#ordina-lista').style.marginTop = Math.round(scarto) + 'px';
      else window.scrollBy(0, -scarto);
      prendi(voce, e.pointerId, pressione.y);
    }, 450),
  };
});
document.addEventListener('pointermove', e => {
  if (pressione && !pressione.scattata && Math.hypot(e.clientX - pressione.x, e.clientY - pressione.y) > 10) {
    clearTimeout(pressione.timer); pressione = null;
  }
});
function finePressione() {
  if (!pressione) return;
  clearTimeout(pressione.timer);
  if (pressione.scattata) ultimoTrascinamento = Date.now(); // il dito che si alza non deve toccare altro
  pressione = null;
}
document.addEventListener('pointerup', finePressione);
document.addEventListener('pointercancel', finePressione);
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-tieni]')) e.preventDefault(); });
$('#velo').addEventListener('click', e => { if (e.target.id === 'velo' && !conto) chiudiFoglio(); });

let avvisoTimeout = null, avvisoAzione = null;
// «durata» 0 = l'avviso resta finché non si tocca il bottone.
function mostraAvviso(testo, annulla, etichetta = 'Annulla', durata = 6000) {
  $('#avviso-testo').textContent = testo;
  $('#avviso-azione').textContent = etichetta;
  avvisoAzione = annulla || null;
  $('#avviso-azione').hidden = !annulla;
  $('#avviso').hidden = false;
  clearTimeout(avvisoTimeout);
  if (durata) avvisoTimeout = setTimeout(() => { $('#avviso').hidden = true; avvisoAzione = null; }, durata);
}
$('#avviso-azione').addEventListener('click', async () => {
  const f = avvisoAzione; avvisoAzione = null; $('#avviso').hidden = true;
  if (f) { await f(); disegna(); }
});

function foglioScelteSerie(scheda, s) {
  const gruppo = (nome, opzioni, attuale) => `<div class="scelte">${Object.entries(opzioni).map(([v, t]) =>
    `<button class="scelta ${attuale === v ? 'si' : ''}" data-azione="serie-${nome}" data-scheda="${scheda}" data-id="${esc(s.id)}" data-valore="${v}">${t}</button>`).join('')}</div>`;
  return `<h2>Serie</h2>
    <div class="tenue">Tipo</div>${gruppo('tipo', TIPI_SERIE, s.tipo || 'normale')}
    <div class="tenue">Lato</div>${gruppo('lato', LATI, s.lato || 'entrambi')}
    <button class="voce" data-azione="serie-copia" data-scheda="${scheda}" data-id="${esc(s.id)}">${ic('copy')} Duplica questa serie</button>
    <button class="voce" data-azione="serie-elimina" data-scheda="${scheda}" data-id="${esc(s.id)}" style="color:var(--rosso)">${ic('trash')} Elimina la serie</button>`;
}

function foglioSceltaEsercizio() {
  return `<h2>Aggiungi un esercizio</h2>
    <input class="testo" type="search" placeholder="Cerca" data-ricerca="scelta" value="${esc(S.ricerca)}" style="margin-bottom:8px">
    <button class="voce" data-azione="nuovo-es" style="color:var(--blu-chiaro)">${ic('plus')} Nuovo esercizio</button>
    <div id="lista-scelta">${righeScelta()}</div>`;
}
// Gli ultimi esercizi usati (dalle sessioni più recenti), senza doppioni.
function eserciziRecenti(quanti = 8) {
  const visti = [];
  for (const s of vivi('Sessioni').sort((a, b) => String(b.inizio).localeCompare(String(a.inizio)))) {
    for (const se of eserciziDi(s.id)) {
      const e = riga('Esercizi', se.esercizio_id);
      if (e && e.eliminato !== SI && e.archiviato !== SI && !visti.includes(e)) visti.push(e);
      if (visti.length >= quanti) return visti;
    }
  }
  return visti;
}
function righeScelta() {
  const voce = e => `<button class="voce" data-azione="scegli-es" data-id="${esc(e.id)}"><span>${esc(e.nome)}<br><span class="tenue">${esc(TIPI_ES[e.tipo] || e.tipo)}${RIAB[e.area] ? ' · ' + esc(e.area) : ''}</span></span></button>`;
  const lista = elencoEsercizi(S.ricerca);
  if (!lista.length) return `<div class="vuoto-msg">Nessun esercizio trovato.</div>`;
  // Senza ricerca: prima i recenti, poi tutti in ordine alfabetico.
  if (!S.ricerca.trim()) {
    const recenti = eserciziRecenti();
    if (recenti.length) return `<div class="sotto-titolo">Recenti</div>${recenti.map(voce).join('')}<div class="sotto-titolo">Tutti</div>${lista.map(voce).join('')}`;
  }
  return lista.map(voce).join('');
}

function foglioNuovoEsercizio() {
  const n = S.nuovoEs;
  const gruppo = (campo, opzioni) => `<div class="scelte">${Object.entries(opzioni).map(([v, t]) =>
    `<button class="scelta ${n[campo] === v ? 'si' : ''}" data-azione="nuovo-es-scelta" data-campo="${campo}" data-valore="${v}">${t}</button>`).join('')}</div>`;
  return `<h2>Nuovo esercizio</h2>
    <div class="campo-modulo"><label for="nes-nome">Nome</label><input class="testo" id="nes-nome" value="${esc(n.nome)}"></div>
    <div class="tenue">Tipo</div>${gruppo('tipo', TIPI_ES)}
    <div class="tenue">Area</div>${gruppo('area', AREE)}
    <div class="campo-modulo"><label for="nes-rec">Recupero (secondi, 0 = nessun timer)</label><input class="testo" id="nes-rec" inputmode="numeric" value="${esc(n.recupero_s)}"></div>
    <p class="tenue errore" id="nes-errore"></p>
    <div class="riga-btn"><button class="btn2" data-azione="aggiungi-es">Indietro</button><button class="btn" data-azione="salva-nuovo-es">Crea e aggiungi</button></div>`;
}

/* ======================= Azioni ======================= */

async function creaSessioneDaModello(modello) {
  const sess = nuovaRiga('Sessioni', { id: nuovoId('SE'), titolo: modello.nome, modello_id: modello.id, inizio: ora(), fine: '' });
  const daSalvare = [['Sessioni', sess]];
  // Copia del modello: cambiare il modello dopo non tocca questa sessione.
  const voci = vociDi(modello.id);
  const nuoviSS = {};
  voci.forEach((me, i) => {
    const ss = compagno(voci, me) ? (nuoviSS[me.superserie_id] = nuoviSS[me.superserie_id] || nuovoId('SS')) : '';
    const se = nuovaRiga('SessioniEsercizi', { id: nuovoId('SX'), sessione_id: sess.id, posizione: i + 1, esercizio_id: me.esercizio_id, superserie_id: ss });
    daSalvare.push(['SessioniEsercizi', se]);
    const previste = previsteDi(me.id);
    (previste.length ? previste : [{}]).forEach((ms, j) => {
      daSalvare.push(['Serie', nuovaRiga('Serie', {
        id: nuovoId('SR'), sessione_esercizio_id: se.id, posizione: j + 1,
        tipo: ms.tipo || 'normale', lato: ms.lato || 'entrambi',
        peso_kg: ms.peso_kg ?? '', rip: ms.rip ?? '', durata_s: ms.durata_s ?? '', rpe: '', fatta: NO,
      })]);
    });
  });
  await salvaLista(daSalvare);
  return sess;
}

async function aggiungiEsercizio(esercizioId) {
  let nuova;
  if (S.sceltaPer === 'modello') {
    const voci = vociDi(S.modelloId);
    nuova = nuovaRiga('ModelliEsercizi', { id: nuovoId('ME'), modello_id: S.modelloId, posizione: voci.length + 1, esercizio_id: esercizioId, recupero_s: '' });
    const ms = nuovaRiga('ModelliSerie', { id: nuovoId('MS'), modello_esercizio_id: nuova.id, posizione: 1, tipo: 'normale', lato: 'entrambi' });
    await salva(['ModelliEsercizi', nuova], ['ModelliSerie', ms]);
  } else {
    const sess = riga('Sessioni', S.sessioneId);
    const esistenti = eserciziDi(S.sessioneId);
    nuova = nuovaRiga('SessioniEsercizi', { id: nuovoId('SX'), sessione_id: S.sessioneId, posizione: esistenti.length + 1, esercizio_id: esercizioId });
    // Si ripropongono le serie dell'ultima volta (stesso numero, lati e valori, da spuntare);
    // se l'esercizio non è mai stato fatto, una serie vuota.
    const prima = serieUltimaVolta(sess, { id: nuova.id, esercizio_id: esercizioId });
    const modelli = prima.length ? prima : [{ tipo: 'normale', lato: 'entrambi', peso_kg: '', rip: '', durata_s: '' }];
    const daSalvare = [['SessioniEsercizi', nuova]];
    modelli.forEach((p, i) => daSalvare.push(['Serie', nuovaRiga('Serie', {
      id: nuovoId('SR'), sessione_esercizio_id: nuova.id, posizione: i + 1, tipo: p.tipo || 'normale', lato: p.lato || 'entrambi',
      peso_kg: p.peso_kg ?? '', rip: p.rip ?? '', durata_s: p.durata_s ?? '', fatta: NO,
    })]));
    await salvaLista(daSalvare);
  }
  chiudiFoglio();
  disegna();
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function avvisoSessioneGiaAperta() {
  apriFoglio(`<h2>C'è già una sessione in corso</h2><p class="tenue">Riprendila o terminala prima di iniziarne un'altra.</p>
    <button class="btn largo" data-azione="riprendi">Riprendi</button>`);
}

/* «Ripeti»: una sessione nuova, in corso, con gli stessi esercizi e serie (valori copiati, da spuntare). */
async function ripetiSessione(origine) {
  const sess = nuovaRiga('Sessioni', { id: nuovoId('SE'), titolo: origine.titolo, modello_id: origine.modello_id, inizio: ora(), fine: '' });
  const daSalvare = [['Sessioni', sess]];
  const voci = eserciziDi(origine.id);
  const nuoviSS = {};
  voci.forEach((se, i) => {
    const ss = compagno(voci, se) ? (nuoviSS[se.superserie_id] = nuoviSS[se.superserie_id] || nuovoId('SS')) : '';
    const nse = nuovaRiga('SessioniEsercizi', { id: nuovoId('SX'), sessione_id: sess.id, posizione: i + 1, esercizio_id: se.esercizio_id, superserie_id: ss });
    daSalvare.push(['SessioniEsercizi', nse]);
    serieDi(se.id).forEach((s, j) => daSalvare.push(['Serie', nuovaRiga('Serie', {
      id: nuovoId('SR'), sessione_esercizio_id: nse.id, posizione: j + 1, tipo: s.tipo || 'normale', lato: s.lato || 'entrambi',
      peso_kg: s.peso_kg, rip: s.rip, durata_s: s.durata_s, fatta: NO,
    })]));
  });
  await salvaLista(daSalvare);
  return sess;
}
/* «Salva come modello»: un modello nuovo con gli esercizi e le serie della sessione come serie previste. */
async function modelloDaSessione(sess) {
  const m = nuovaRiga('Modelli', { id: nuovoId('MOD'), nome: sess.titolo, cartella: '', ordine: vivi('Modelli').length + 1 });
  const daSalvare = [['Modelli', m]];
  const voci = eserciziDi(sess.id);
  const nuoviSS = {};
  voci.forEach((se, i) => {
    const ss = compagno(voci, se) ? (nuoviSS[se.superserie_id] = nuoviSS[se.superserie_id] || nuovoId('SS')) : '';
    const me = nuovaRiga('ModelliEsercizi', { id: nuovoId('ME'), modello_id: m.id, posizione: i + 1, esercizio_id: se.esercizio_id, superserie_id: ss, recupero_s: '' });
    daSalvare.push(['ModelliEsercizi', me]);
    serieDi(se.id).forEach((s, j) => daSalvare.push(['ModelliSerie', nuovaRiga('ModelliSerie', {
      id: nuovoId('MS'), modello_esercizio_id: me.id, posizione: j + 1, tipo: s.tipo || 'normale', lato: s.lato || 'entrambi',
      peso_kg: s.peso_kg, rip: s.rip, durata_s: s.durata_s, rpe_previsto: '',
    })]));
  });
  await salvaLista(daSalvare);
  return m;
}

async function chiudiSessione(fine) {
  const sess = riga('Sessioni', S.sessioneId);
  // Se era in pausa, la sessione finisce quando è iniziata la pausa (il tempo in pausa non conta).
  if (inPausa(sess)) {
    if (normalizzaData(sess.pausa_dal) < fine) fine = normalizzaData(sess.pausa_dal);
    sess.pausa_dal = '';
  }
  sess.fine = fine;
  await salva(['Sessioni', sess]);
  chiudiFoglio(); fermaTimer(); tieniAcceso(false);
  S.aperti.clear();
  mostraAvviso('Sessione salvata');
  vai('oggi');
  sincronizza();
}

/* Spunta di una serie vuota: si riempie con i valori dell'ultima volta (stesso lato e posto)
 * oppure, se non ci sono, con quelli della serie prima. Restituisce true se ha riempito qualcosa. */
function riempiSeVuota(s) {
  const se = riga('SessioniEsercizi', s.sessione_esercizio_id);
  const tipo = tipoDi(riga('Esercizi', se.esercizio_id));
  const campi = COLONNE_TIPO[tipo].map(([c]) => c === 'durata_min' ? 'durata_s' : c);
  if (campi.some(c => s[c] !== '' && s[c] != null)) return false;
  const lista = serieDi(se.id);
  const prec = precedenteDi(lista, s, serieUltimaVolta(riga('Sessioni', se.sessione_id), se));
  const primaDiQuesta = lista.slice(0, lista.indexOf(s)).reverse().find(x => campi.some(c => x[c] !== '' && x[c] != null));
  const fonte = prec || primaDiQuesta;
  if (!fonte) return false;
  campi.forEach(c => { s[c] = fonte[c] ?? ''; });
  return true;
}

async function eliminaRiga(scheda, id) {
  const r = riga(scheda, id);
  r.eliminato = SI; await salva([scheda, r]);
  disegna();
  mostraAvviso(scheda.includes('Serie') ? 'Serie eliminata' : 'Eliminato', async () => { r.eliminato = NO; await salva([scheda, r]); });
}

async function duplicaModello(m) {
  const copia = nuovaRiga('Modelli', Object.assign(soloSchema('Modelli', m), { id: nuovoId('MOD'), nome: m.nome + ' (copia)', eliminato: NO }));
  const daSalvare = [['Modelli', copia]];
  const voci = vociDi(m.id);
  const nuoviSS = {};
  voci.forEach(me => {
    const ss = compagno(voci, me) ? (nuoviSS[me.superserie_id] = nuoviSS[me.superserie_id] || nuovoId('SS')) : '';
    const nme = nuovaRiga('ModelliEsercizi', Object.assign(soloSchema('ModelliEsercizi', me), { id: nuovoId('ME'), modello_id: copia.id, superserie_id: ss, eliminato: NO }));
    daSalvare.push(['ModelliEsercizi', nme]);
    previsteDi(me.id).forEach(ms => daSalvare.push(['ModelliSerie',
      nuovaRiga('ModelliSerie', Object.assign(soloSchema('ModelliSerie', ms), { id: nuovoId('MS'), modello_esercizio_id: nme.id, eliminato: NO }))]));
  });
  await salvaLista(daSalvare);
  return copia;
}

function nomeVoce(scheda, r) {
  const es = riga('Esercizi', r.esercizio_id);
  return es ? es.nome : 'Esercizio';
}

const AZIONI = {
  'torna-oggi': () => vai('oggi'),
  'torna-esercizi': () => vai('esercizi', { vistaArchivio: 'esercizi' }),
  'torna-modelli': () => vai('esercizi', { vistaArchivio: 'modelli' }),
  'riprendi': async () => {
    chiudiFoglio();
    const s = sessioneInCorso();
    if (!s) return;
    if (inPausa(s)) { await riprendiSessione(s); mostraAvviso('Allenamento ripreso'); }
    vai('sessione', { sessioneId: s.id }); controllaWakeLock();
  },
  'pausa': async () => {
    await mettiInPausa(riga('Sessioni', S.sessioneId));
    disegna(); mostraAvviso('Sessione in pausa');
  },
  // Pausa che parte dall'ultima attività: i minuti passati fermi non contano nella durata.
  'pausa-da': async el => {
    const sess = riga('Sessioni', S.sessioneId);
    await mettiInPausa(sess);
    if (el.dataset.valore && el.dataset.valore < sess.pausa_dal) { sess.pausa_dal = el.dataset.valore; await salva(['Sessioni', sess]); }
    disegna(); mostraAvviso('Sessione in pausa');
  },
  'riprendi-pausa': async () => {
    await riprendiSessione(riga('Sessioni', S.sessioneId));
    disegna(); mostraAvviso('Allenamento ripreso');
  },
  'ignora-fermo': () => {
    const sess = riga('Sessioni', S.sessioneId);
    S.avvisoIgnorato = sess.id + '|' + ultimaAttivita(sess); // ricompare dopo altri 30 minuti senza serie
    disegna();
  },
  'nuova-vuota': async () => {
    if (sessioneInCorso()) return avvisoSessioneGiaAperta();
    const sess = nuovaRiga('Sessioni', { id: nuovoId('SE'), titolo: 'Allenamento', modello_id: '', inizio: ora(), fine: '' });
    await salva(['Sessioni', sess]);
    vai('sessione', { sessioneId: sess.id }); controllaWakeLock();
    S.ricerca = ''; S.sceltaPer = 'sessione'; apriFoglio(foglioSceltaEsercizio());
  },
  'avvia-modello': async el => {
    if (sessioneInCorso()) return avvisoSessioneGiaAperta();
    const sess = await creaSessioneDaModello(riga('Modelli', el.dataset.id));
    vai('sessione', { sessioneId: sess.id }); controllaWakeLock();
  },
  'apri-sessione': el => vai('sessione', { sessioneId: el.dataset.id }),
  'chiudi-sessione': () => vai('storico'),
  'storico-tutte': () => { S.storicoTutte = true; disegna(); },
  // Titolo e orari della sessione (per correggere una sessione dimenticata aperta, o finita alla mezzanotte).
  'rinomina-sessione': () => {
    const sess = riga('Sessioni', S.sessioneId);
    const locale = t => normalizzaData(t).slice(0, 16).replace(' ', 'T');
    apriFoglio(`<h2>Sessione</h2>
      <div class="campo-modulo"><label for="titolo-sess">Titolo</label><input class="testo" id="titolo-sess" value="${esc(sess.titolo)}"></div>
      <div class="campo-modulo"><label for="inizio-sess">Inizio</label><input class="testo" id="inizio-sess" type="datetime-local" value="${esc(locale(sess.inizio))}"></div>
      ${sess.fine ? `<div class="campo-modulo"><label for="fine-sess">Fine</label><input class="testo" id="fine-sess" type="datetime-local" value="${esc(locale(sess.fine))}"></div>` : ''}
      <p class="errore" id="sess-errore" style="font-size:13px;margin:0 0 8px"></p>
      <button class="btn largo" data-azione="salva-titolo">Salva</button>`);
  },
  'salva-titolo': async () => {
    const sess = riga('Sessioni', S.sessioneId);
    const t = $('#titolo-sess').value.trim();
    const daCampo = id => { const v = $(id) && $(id).value; return v ? v.replace('T', ' ') + ':00' : ''; };
    const inizio = daCampo('#inizio-sess'), fine = sess.fine ? daCampo('#fine-sess') : '';
    const errore = m => { $('#sess-errore').textContent = m; };
    if (!t) return errore('Scrivi un titolo.');
    if (!inizio) return errore("Scegli l'ora di inizio.");
    if (sess.fine && !fine) return errore("Scegli l'ora di fine.");
    if (fine && fine <= inizio) return errore("La fine deve venire dopo l'inizio.");
    if (inizio > ora()) return errore("L'inizio è nel futuro.");
    sess.titolo = t;
    if (inizio.slice(0, 16) !== normalizzaData(sess.inizio).slice(0, 16)) sess.inizio = inizio;
    if (fine && fine.slice(0, 16) !== normalizzaData(sess.fine).slice(0, 16)) sess.fine = fine;
    await salva(['Sessioni', sess]);
    chiudiFoglio(); disegna();
  },
  'fine-sessione': () => {
    const sess = riga('Sessioni', S.sessioneId);
    const r = riepilogoSessione(sess);
    const nonFatte = r.totali - r.fatte;
    // Promemoria (solo un elenco, nessun giudizio): esercizi di ginocchio o caviglia senza valori di riabilitazione.
    const senzaRiab = eserciziDi(sess.id).filter(se => {
      const es = riga('Esercizi', se.esercizio_id);
      return es && RIAB[es.area] && RIAB[es.area].campi.every(([c]) => se[c] === '' || se[c] == null);
    });
    const ultima = minutiFermi(sess) >= MINUTI_AVVISO ? oraUltimaSerie(sess) : '';
    apriFoglio(`<h2>Fine della sessione</h2>
      <div class="riepilogo" style="margin:14px 0"><div><b>${fmtMinuti(r.durata)}</b><span class="tenue">durata</span></div>
        <div><b>${r.fatte}</b><span class="tenue">serie fatte</span></div><div><b>${r.volume ? fmtKg(r.volume) : '—'}</b><span class="tenue">volume</span></div></div>
      ${nonFatte ? `<p class="tenue">${nonFatte} ${nonFatte === 1 ? 'serie non spuntata resta registrata' : 'serie non spuntate restano registrate'} come non fatta.</p>` : ''}
      ${senzaRiab.length ? `<div class="card avviso-card" style="margin-bottom:10px"><b>Riabilitazione da compilare</b>
        <p class="tenue" style="margin:4px 0 8px">${senzaRiab.map(se => esc(nomeVoce('SessioniEsercizi', se))).join(', ')}</p>
        <button class="btn2 largo" data-azione="vai-riab" data-id="${esc(senzaRiab[0].id)}">Compila adesso</button></div>` : ''}
      ${ultima
        // Fermo da almeno 30 minuti: «Salva» chiude all'ora dell'ultima serie; «Salva adesso» usa l'ora attuale.
        ? `<p class="tenue">Nessuna serie da ${fmtMinuti(minutiFermi(sess) * 60)}: la sessione finisce alle ${esc(ultima.slice(11, 16))}, l'ora dell'ultima serie.</p>
          <button class="btn verde largo" style="margin-bottom:8px" data-azione="fine-a" data-valore="${esc(ultima)}">Salva (fine alle ${esc(ultima.slice(11, 16))})</button>
          <div class="riga-btn"><button class="btn2" data-azione="chiudi-foglio">Continua</button><button class="btn2" data-azione="conferma-fine">Salva adesso</button></div>`
        : `<div class="riga-btn"><button class="btn2" data-azione="chiudi-foglio">Continua</button><button class="btn verde" data-azione="conferma-fine">Salva</button></div>`}`);
  },
  'vai-riab': el => {
    chiudiFoglio();
    S.aperti.add(el.dataset.id); disegna();
    const card = document.querySelector(`[data-se="${CSS.escape(el.dataset.id)}"]`);
    if (card) {
      const det = card.querySelector('details.riab'); if (det) det.open = true;
      card.scrollIntoView({ block: 'center' });
      const campo = card.querySelector('details.riab input'); if (campo) campo.focus();
    }
  },
  'conferma-fine': el => chiudiSessione(ora()),
  'fine-a': el => chiudiSessione(el.dataset.valore),
  'elimina-sessione': () => {
    const aperta = sessioneAperta(riga('Sessioni', S.sessioneId));
    apriFoglio(`<h2>${aperta ? 'Annullare la sessione?' : 'Eliminare la sessione?'}</h2>
      <p class="tenue">Resta nel foglio segnata come eliminata. Puoi annullare subito dopo.</p>
      <div class="riga-btn"><button class="btn2" data-azione="chiudi-foglio">No</button><button class="btn" style="background:#b91c1c" data-azione="conferma-elimina-sessione">Sì, elimina</button></div>`);
  },
  'conferma-elimina-sessione': async () => {
    const sess = riga('Sessioni', S.sessioneId);
    const eraAperta = sessioneAperta(sess);
    sess.eliminato = SI;
    await salva(['Sessioni', sess]);
    chiudiFoglio();
    if (eraAperta) { fermaTimer(); tieniAcceso(false); }
    vai(eraAperta ? 'oggi' : 'storico');
    mostraAvviso('Sessione eliminata', async () => { sess.eliminato = NO; await salva(['Sessioni', sess]); controllaWakeLock(); });
  },

  /* --- Serie (della sessione o previste nel modello) --- */
  'spunta': async el => {
    const s = riga('Serie', el.dataset.id);
    s.fatta = s.fatta === SI ? NO : SI;
    const riempita = s.fatta === SI && riempiSeVuota(s);
    await salva(['Serie', s]);
    const se = riga('SessioniEsercizi', s.sessione_esercizio_id);
    const es = se && riga('Esercizi', se.esercizio_id);
    if (s.fatta === SI) {
      if (navigator.vibrate) navigator.vibrate(30);
      timerDopoSerie(s);
    }
    const sess = riga('Sessioni', se.sessione_id);
    const tutteFatte = serieDi(se.id).every(x => x.fatta === SI);
    if (s.fatta === SI && tutteFatte && sessioneAperta(sess)) {
      // Esercizio finito: si compatta e la pagina porta al prossimo esercizio da fare.
      S.aperti.delete(se.id);
      disegna();
      const prossimo = eserciziDi(sess.id).find(x => serieDi(x.id).some(y => y.fatta !== SI));
      const card = prossimo && document.querySelector(`[data-se="${CSS.escape(prossimo.id)}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (riempita || (es && (es.tipo === 'durata' || es.tipo === 'peso_durata'))) { disegna(); return; } // valori nuovi o «Avvia serie»
    const r = document.querySelector(`.serie[data-id="${CSS.escape(s.id)}"]`);
    if (r) r.classList.toggle('fatta', s.fatta === SI);
  },
  'espandi-es': el => { S.aperti.add(el.dataset.id); disegna(); },

  /* --- Diario --- */
  'apri-diario': () => vai('diario', { giornoDiario: oggiG() }),
  'giorno-diario': el => {
    const d = giornoDa(S.giornoDiario || oggiG());
    d.setDate(d.getDate() + Number(el.dataset.valore));
    const g = chiaveGiorno(d);
    if (g > oggiG()) return;
    S.giornoDiario = g; history.replaceState(statoAttuale(), ''); disegna();
  },
  // Tocco su un numero, su Sì/No o su un'opzione; toccare di nuovo la scelta la toglie (vuoto, mai 0).
  'dv-scelta': async el => {
    const g = S.giornoDiario || oggiG();
    const campo = riga('DiarioCampi', el.dataset.campo);
    if (!campo) return;
    const attuale = valoreDiario(g, campo.id);
    const scala = semplifica(campo.tipo) === 'scala';
    const nuovo = scala ? Number(el.dataset.valore) : el.dataset.valore;
    const uguale = attuale && haValore(attuale) && semplifica(attuale.valore) === semplifica(nuovo);
    await salvaValoreDiario(g, campo, { valore: uguale ? '' : nuovo });
    disegna();
  },
  'df-piu': async el => { const f = riga('Farmaci', el.dataset.farmaco); if (f) { await salvaFarmaco(S.giornoDiario || oggiG(), f, { delta: 1 }); disegna(); } },
  'df-meno': async el => { const f = riga('Farmaci', el.dataset.farmaco); if (f) { await salvaFarmaco(S.giornoDiario || oggiG(), f, { delta: -1 }); disegna(); } },
  'ripeti-sessione': async () => {
    if (sessioneInCorso()) return avvisoSessioneGiaAperta();
    const nuova = await ripetiSessione(riga('Sessioni', S.sessioneId));
    vai('sessione', { sessioneId: nuova.id }); controllaWakeLock();
    mostraAvviso('Sessione ripetuta: le serie sono da spuntare');
  },
  'salva-come-modello': async () => {
    const m = await modelloDaSessione(riga('Sessioni', S.sessioneId));
    vai('modello', { modelloId: m.id });
    mostraAvviso('Modello creato: controlla nome e cartella');
  },
  'usa-precedente': async el => {
    const s = riga('Serie', el.dataset.id);
    const se = riga('SessioniEsercizi', s.sessione_esercizio_id);
    const tipo = tipoDi(riga('Esercizi', se.esercizio_id));
    const campi = { peso_kg: 'peso', rip: 'rip', durata_s: 'durata' };
    COLONNE_TIPO[tipo].forEach(([c]) => {
      const reale = c === 'durata_min' ? 'durata_s' : c;
      const v = el.dataset[campi[reale]];
      if (v !== undefined && v !== '') s[reale] = Number(v);
    });
    await salva(['Serie', s]); disegna();
  },
  'menu-serie': el => apriFoglio(foglioScelteSerie(el.dataset.scheda, riga(el.dataset.scheda, el.dataset.id))),
  'serie-tipo': async el => { const s = riga(el.dataset.scheda, el.dataset.id); s.tipo = el.dataset.valore; await salva([el.dataset.scheda, s]); chiudiFoglio(); disegna(); },
  'serie-lato': async el => { const s = riga(el.dataset.scheda, el.dataset.id); s.lato = el.dataset.valore; await salva([el.dataset.scheda, s]); chiudiFoglio(); disegna(); },
  'serie-copia': async el => {
    const scheda = el.dataset.scheda;
    const s = riga(scheda, el.dataset.id);
    const lista = fratelliDi(scheda, s);
    const copia = nuovaRiga(scheda, Object.assign(soloSchema(scheda, s), { id: nuovoId(scheda === 'Serie' ? 'SR' : 'MS'), eliminato: NO }));
    if (scheda === 'Serie') copia.fatta = NO;
    lista.splice(lista.indexOf(s) + 1, 0, copia);
    lista.forEach((r, i) => { r.posizione = i + 1; });
    await salvaLista(lista.map(r => [scheda, r]));
    chiudiFoglio(); disegna();
  },
  'serie-elimina': el => { chiudiFoglio(); return eliminaRiga(el.dataset.scheda, el.dataset.id); },
  'aggiungi-serie': async el => {
    const scheda = el.dataset.scheda;
    const lista = figli(scheda, el.dataset.padre);
    const ultima = lista[lista.length - 1];
    // Se l'ultima era per un lato, la nuova va sull'altro lato (le serie per lato si alternano).
    const lato = !ultima ? 'entrambi' : ultima.lato === 'dx' ? 'sx' : ultima.lato === 'sx' ? 'dx' : ultima.lato;
    const nuova = nuovaRiga(scheda, { id: nuovoId(scheda === 'Serie' ? 'SR' : 'MS'), [PADRE[scheda]]: el.dataset.padre, posizione: lista.length + 1,
      tipo: ultima && ultima.tipo !== 'riscaldamento' ? ultima.tipo : 'normale', lato });
    if (scheda === 'Serie') nuova.fatta = NO;
    await salva([scheda, nuova]); disegna();
  },
  'copia-precedente': async el => {
    const scheda = el.dataset.scheda;
    const lista = figli(scheda, el.dataset.padre);
    const ultima = lista[lista.length - 1];
    const nuova = nuovaRiga(scheda, ultima
      ? Object.assign(soloSchema(scheda, ultima), { id: nuovoId(scheda === 'Serie' ? 'SR' : 'MS'), posizione: lista.length + 1, eliminato: NO })
      : { id: nuovoId(scheda === 'Serie' ? 'SR' : 'MS'), [PADRE[scheda]]: el.dataset.padre, posizione: 1, tipo: 'normale', lato: 'entrambi' });
    if (scheda === 'Serie') nuova.fatta = NO;
    await salva([scheda, nuova]); disegna();
  },
  'avvia-durata': el => avviaConto(el.dataset.id),
  'conto-ferma': () => chiudiConto(true),
  'conto-annulla': () => chiudiConto(false),

  /* --- Esercizi dentro una sessione o un modello --- */
  'menu-es': el => {
    const scheda = el.dataset.scheda;
    const r = riga(scheda, el.dataset.id);
    const comp = compagno(fratelliDi(scheda, r), r);
    const attr = `data-scheda="${scheda}" data-id="${esc(r.id)}"`;
    apriFoglio(`<h2>${esc(nomeVoce(scheda, r))}</h2>
      ${comp ? `<button class="voce" data-azione="inverti-coppia" ${attr}>${ic('swap')} Inverti A e B</button>
        <button class="voce" data-azione="scollega" ${attr}>${ic('unlink')} Scollega la superserie</button>`
        : `<button class="voce" data-azione="collega-scegli" ${attr}>${ic('link')} Collega in superserie</button>`}
      <button class="voce" data-azione="vedi-esercizio" data-id="${esc(r.esercizio_id)}">${ic('history')} Andamento e record</button>
      <button class="voce" data-azione="rimuovi-es" ${attr} style="color:var(--rosso)">${ic('trash')} Rimuovi</button>
      <p class="tenue">Per spostare gli esercizi: tieni premuto sul nome e trascina.</p>`);
  },
  'inverti-coppia': async el => {
    await invertiCoppia(el.dataset.scheda, el.dataset.id);
    chiudiFoglio(); disegna();
  },
  'collega-scegli': el => {
    const scheda = el.dataset.scheda;
    const r = riga(scheda, el.dataset.id);
    const lista = fratelliDi(scheda, r);
    const liberi = lista.filter(x => x !== r && !compagno(lista, x));
    apriFoglio(`<h2>Superserie con…</h2>
      ${liberi.length ? liberi.map(x => `<button class="voce" data-azione="collega" data-scheda="${scheda}" data-id="${esc(r.id)}" data-altro="${esc(x.id)}">${ic('link')} ${esc(nomeVoce(scheda, x))}</button>`).join('')
        : '<p class="tenue">Non ci sono altri esercizi liberi da collegare.</p>'}`);
  },
  'collega': async el => {
    const scheda = el.dataset.scheda;
    const a = riga(scheda, el.dataset.id), b = riga(scheda, el.dataset.altro);
    const id = nuovoId('SS');
    a.superserie_id = id; b.superserie_id = id;
    // B si sposta subito dopo A.
    const lista = fratelliDi(scheda, a).filter(x => x !== b);
    lista.splice(lista.indexOf(a) + 1, 0, b);
    lista.forEach((x, k) => { x.posizione = k + 1; });
    await salvaLista(lista.map(x => [scheda, x]));
    chiudiFoglio(); disegna();
  },
  'scollega': async el => {
    const scheda = el.dataset.scheda;
    const a = riga(scheda, el.dataset.id);
    const b = compagno(fratelliDi(scheda, a), a);
    a.superserie_id = '';
    const daSalvare = [[scheda, a]];
    if (b) { b.superserie_id = ''; daSalvare.push([scheda, b]); }
    await salvaLista(daSalvare);
    chiudiFoglio(); disegna();
  },
  'rimuovi-es': async el => {
    const scheda = el.dataset.scheda;
    const r = riga(scheda, el.dataset.id);
    r.eliminato = SI; await salva([scheda, r]);
    chiudiFoglio(); disegna();
    mostraAvviso('Esercizio rimosso', async () => { r.eliminato = NO; await salva([scheda, r]); });
  },
  'aggiungi-es': el => {
    if (el.dataset.per) S.sceltaPer = el.dataset.per;
    S.ricerca = ''; apriFoglio(foglioSceltaEsercizio());
  },
  'scegli-es': el => aggiungiEsercizio(el.dataset.id),
  'nuovo-es': () => { S.nuovoEs = { nome: S.ricerca, tipo: 'peso_rip', area: 'altro', recupero_s: '90' }; apriFoglio(foglioNuovoEsercizio()); },
  'nuovo-es-scelta': el => {
    S.nuovoEs.nome = $('#nes-nome').value; S.nuovoEs.recupero_s = $('#nes-rec').value;
    S.nuovoEs[el.dataset.campo] = el.dataset.valore; apriFoglio(foglioNuovoEsercizio());
  },
  'salva-nuovo-es': async () => {
    const nome = $('#nes-nome').value.trim();
    const rec = leggiNum($('#nes-rec').value);
    if (!nome) { $('#nes-errore').textContent = 'Scrivi il nome.'; return; }
    if (vivi('Esercizi').some(e => String(e.nome).toLowerCase() === nome.toLowerCase())) { $('#nes-errore').textContent = 'Esiste già un esercizio con questo nome.'; return; }
    if (rec === null || rec < 0) { $('#nes-errore').textContent = 'Il recupero deve essere un numero di secondi.'; return; }
    const es = nuovaRiga('Esercizi', { id: nuovoId('EX'), nome, tipo: S.nuovoEs.tipo, area: S.nuovoEs.area, recupero_s: rec === '' ? 0 : Math.round(rec), origine: 'app', archiviato: NO });
    await salva(['Esercizi', es]);
    await aggiungiEsercizio(es.id);
  },

  /* --- Archivio: esercizi e modelli --- */
  'vista-archivio': el => { S.vistaArchivio = el.dataset.valore; disegna(); },
  'vedi-esercizio': el => { chiudiFoglio(); vai('esercizio-andamento', { esercizioVisto: el.dataset.id }); },
  'periodo': el => { S.periodo = el.dataset.valore; disegna(); },
  'indietro': () => history.back(),
  /* --- Storico --- */
  'vista-storico': el => { S.vistaStorico = el.dataset.valore; disegna(); },
  'mese': el => {
    const m = S.meseStorico || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    S.meseStorico = new Date(m.getFullYear(), m.getMonth() + Number(el.dataset.valore), 1);
    S.giornoStorico = null; disegna();
  },
  'giorno-storico': el => { S.giornoStorico = S.giornoStorico === el.dataset.valore ? null : el.dataset.valore; disegna(); },
  'mostra-archiviati': () => { S.mostraArchiviati = !S.mostraArchiviati; disegna(); },
  'da-completare': () => { S.daCompletare = !S.daCompletare; disegna(); },
  'vai-da-completare': () => vai('esercizi', { vistaArchivio: 'esercizi', daCompletare: true }),
  'recupero-90': () => {
    const senza = vivi('Esercizi').filter(e => e.archiviato !== SI && !(num(e.recupero_s) > 0));
    apriFoglio(`<h2>Recupero di 90 secondi</h2>
      <p class="tenue">Lo imposto a ${senza.length} ${senza.length === 1 ? 'esercizio che non ha' : 'esercizi che non hanno'} un recupero. Potrai sempre cambiarlo esercizio per esercizio.</p>
      <div class="riga-btn"><button class="btn2" data-azione="chiudi-foglio">Annulla</button><button class="btn" data-azione="conferma-recupero-90">Imposta</button></div>`);
  },
  'conferma-recupero-90': async () => {
    const senza = vivi('Esercizi').filter(e => e.archiviato !== SI && !(num(e.recupero_s) > 0));
    senza.forEach(e => { e.recupero_s = 90; });
    await salvaLista(senza.map(e => ['Esercizi', e]));
    chiudiFoglio(); disegna();
    mostraAvviso(`Recupero impostato a ${senza.length} esercizi`);
  },
  'nuovo-esercizio': () => vai('esercizio', { bozzaEs: { id: '', nome: S.ricercaArchivio, tipo: 'peso_rip', area: 'altro', attrezzo: '', gruppo: '', recupero_s: '90', nota: '', nome_strong: '', archiviato: NO } }),
  'apri-esercizio': el => {
    const e = riga('Esercizi', el.dataset.id);
    vai('esercizio', { bozzaEs: Object.assign(soloSchema('Esercizi', e), { recupero_s: fmtNum(e.recupero_s), tipoOriginale: e.tipo, archiviato: e.archiviato === SI ? SI : NO }) });
  },
  'bozza-scelta': el => { leggiFormEsercizio(); S.bozzaEs[el.dataset.campo] = el.dataset.valore; disegna(); },
  'salva-esercizio': async () => {
    leggiFormEsercizio();
    const b = S.bozzaEs;
    const errore = t => { $('#f-errore').textContent = t; };
    const nome = b.nome.trim();
    const rec = leggiNum(b.recupero_s);
    if (!nome) return errore('Scrivi il nome.');
    if (vivi('Esercizi').some(e => e.id !== b.id && String(e.nome).trim().toLowerCase() === nome.toLowerCase())) return errore('Esiste già un esercizio con questo nome.');
    if (rec === null || rec < 0) return errore('Il recupero deve essere un numero di secondi.');
    const e = b.id ? riga('Esercizi', b.id) : nuovaRiga('Esercizi', { id: nuovoId('EX'), origine: 'app' });
    Object.assign(e, {
      nome, tipo: b.tipo, area: b.area, attrezzo: b.attrezzo.trim(), gruppo: b.gruppo.trim(),
      recupero_s: rec === '' ? 0 : Math.round(rec), nota: b.nota.trim(),
      nome_strong: b.nome_strong.split(';').map(x => x.trim()).filter(Boolean).join('; '),
      archiviato: b.archiviato === SI ? SI : NO,
    });
    await salva(['Esercizi', e]);
    mostraAvviso('Esercizio salvato');
    S.bozzaEs = null;
    if (b.id) history.back(); // si torna da dove si era venuti (andamento dell'esercizio o elenco)
    else vai('esercizio-andamento', { esercizioVisto: e.id });
  },
  'nuovo-modello': async () => {
    const modelli = vivi('Modelli');
    const m = nuovaRiga('Modelli', { id: nuovoId('MOD'), nome: 'Nuovo modello', cartella: '', ordine: modelli.length + 1 });
    await salva(['Modelli', m]);
    vai('modello', { modelloId: m.id });
    const campo = $('#m-nome'); if (campo) campo.select();
  },
  'apri-modello': el => vai('modello', { modelloId: el.dataset.id }),
  'menu-modello': () => apriFoglio(`<h2>Modello</h2>
    <button class="voce" data-azione="duplica-modello">${ic('copy')} Duplica il modello</button>
    <button class="voce" data-azione="elimina-modello" style="color:var(--rosso)">${ic('trash')} Elimina il modello</button>
    <p class="tenue">Le sessioni già fatte con questo modello non cambiano.</p>`),
  'duplica-modello': async () => {
    const copia = await duplicaModello(riga('Modelli', S.modelloId));
    chiudiFoglio();
    mostraAvviso('Modello duplicato');
    vai('modello', { modelloId: copia.id });
    S.schermata = 'modello'; disegna();
  },
  'elimina-modello': async () => {
    const m = riga('Modelli', S.modelloId);
    m.eliminato = SI; await salva(['Modelli', m]);
    chiudiFoglio();
    vai('esercizi', { vistaArchivio: 'modelli' });
    mostraAvviso('Modello eliminato', async () => { m.eliminato = NO; await salva(['Modelli', m]); });
  },

  /* --- Varie --- */
  /* --- Test --- */
  'nuovo-test': el => vai('test-nuovo', { bozzaTest: bozzaTest(el.dataset.valore || 'wblt') }),
  'apri-test': el => vai('test-andamento', { testTipo: el.dataset.valore }),
  'modifica-test': el => vai('test-nuovo', { bozzaTest: bozzaTest(S.testTipo, el.dataset.valore) }),
  'torna-test': () => vai('test'),
  'torna-andamento': () => vai('test-andamento'),
  'bozza-test-tipo': el => { leggiFormTest(); S.bozzaTest.tipo = el.dataset.valore; disegna(); },
  'salva-test': async () => {
    leggiFormTest();
    const b = S.bozzaTest;
    const errore = t => { $('#t-errore').textContent = t; };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data)) return errore('Scegli una data.');
    if (b.data > ora().slice(0, 10)) return errore('La data è nel futuro.');
    if (b.data !== b.dataOriginale && proveDi(b.tipo).some(p => p.data === b.data)) {
      return errore('In quella data c\'è già una prova di questo test: aprila dall\'andamento per correggerla.');
    }
    const u = unitaTest(b.tipo, vivi('Test').filter(r => r.tipo === b.tipo));
    const daSalvare = [];
    for (const lato of ['dx', 'sx']) {
      const v = b[lato];
      const valore = leggiNum(v.valore), dolore = leggiNum(v.dolore);
      const nome = lato === 'dx' ? 'destro' : 'sinistro';
      if (valore === null || (valore !== '' && valore < 0)) return errore(`Il valore del lato ${nome} non è un numero valido.`);
      if (dolore === null || (dolore !== '' && (dolore < 0 || dolore > 10))) return errore(`Il dolore del lato ${nome} va da 0 a 10.`);
      const esistente = v.id ? riga('Test', v.id) : null;
      if (valore === '') {
        if (dolore !== '' || v.nota.trim()) return errore(`Manca il valore del lato ${nome}.`);
        if (esistente) { esistente.eliminato = SI; daSalvare.push(['Test', esistente]); } // valore cancellato: la riga si elimina
        continue;
      }
      const r = esistente || nuovaRiga('Test', { id: nuovoId('TS'), origine: 'app' });
      Object.assign(r, { data: b.data, tipo: b.tipo, lato, valore, unita: u, dolore, nota: v.nota.trim() });
      daSalvare.push(['Test', r]);
    }
    if (!daSalvare.some(([, r]) => r.eliminato !== SI) && !b.modifica) return errore('Scrivi almeno un valore.');
    await salvaLista(daSalvare);
    mostraAvviso('Test salvato');
    vai('test-andamento', { testTipo: b.tipo, bozzaTest: null });
  },
  'elimina-test': async () => {
    const b = S.bozzaTest;
    const righe = ['dx', 'sx'].map(l => b[l].id && riga('Test', b[l].id)).filter(Boolean);
    righe.forEach(r => { r.eliminato = SI; });
    await salvaLista(righe.map(r => ['Test', r]));
    vai('test-andamento', { bozzaTest: null });
    mostraAvviso('Prova eliminata', async () => { righe.forEach(r => { r.eliminato = NO; }); await salvaLista(righe.map(r => ['Test', r])); });
  },

  'chiudi-foglio': () => chiudiFoglio(),
  'timer-meno': () => cambiaTimer(-15),
  'timer-piu': () => cambiaTimer(15),
  'timer-stop': () => fermaTimer(),
  'timer-salva': () => salvaRecupero(),
  'rpe': async el => { await salvaMeta('nascondiRpe', el.dataset.valore === 'nascondi'); disegna(); },
  'imp-salva': async () => {
    const url = $('#imp-url').value.trim();
    const token = $('#imp-token').value;
    if (url && !/^https:\/\//.test(url)) { $('#imp-esito').textContent = "L'indirizzo deve iniziare con https://"; return; }
    await salvaMeta('url', url);
    if (token) await salvaMeta('token', token);
    await salvaMeta('cursore', ''); // nuovo ponte: si rilegge tutto
    await salvaMeta('diarioScaricato', '');
    $('#imp-esito').textContent = 'Salvato.';
    sincronizza({ completo: true });
  },
  'imp-prova': async () => {
    $('#imp-esito').textContent = 'Provo…';
    try { await chiamaPonte({ azione: 'ping' }); $('#imp-esito').textContent = 'Connessione riuscita.'; }
    catch (e) { $('#imp-esito').textContent = 'Non riesco: ' + e.message; }
  },
  'imp-sync': () => sincronizza(),
  'imp-riscarica': () => sincronizza({ completo: true }),
  'cerca-aggiornamenti': async () => {
    if (!registrazioneSW) { mostraAvviso('Aggiornamenti non disponibili qui'); return; }
    mostraAvviso('Cerco…');
    await cercaAggiornamenti();
    const reg = registrazioneSW;
    if (reg.installing || reg.waiting) mostraAvviso('Sto scaricando la versione nuova…');
    else mostraAvviso(`Hai già l'ultima versione (${VERSIONE_APP})`);
  },
  'imp-esporta': () => {
    const dati = { esportato_il: ora(), versione_schema: 1, schede: {} };
    SCHEDE.forEach(s => { dati.schede[s] = [...D[s].values()]; });
    const blob = new Blob([JSON.stringify(dati, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gym-backup-' + ora().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  'scegli-csv': () => { const f = $('#file-strong'); f.value = ''; f.click(); },
  'conferma-import': async () => {
    const imp = S.importazione;
    if (!imp) return;
    const bottone = $('[data-azione="conferma-import"]');
    if (bottone) { bottone.disabled = true; bottone.textContent = 'Importo…'; }
    // Si ricontrolla subito prima di scrivere, nel caso il foglio sia cambiato nel frattempo.
    const giaPresenti = new Set([...D.Sessioni.values()].map(s => dataOraStrong(s.inizio) + '|' + String(s.titolo).trim()));
    const doppie = imp.daSalvare.some(([sc, r]) => sc === 'Sessioni' && giaPresenti.has(dataOraStrong(r.inizio) + '|' + String(r.titolo).trim()));
    if (doppie) { $('#imp-errore').textContent = 'Alcune sessioni risultano già importate: riapri il file.'; return; }
    await salvaLista(imp.daSalvare);
    S.importazione = null;
    chiudiFoglio();
    mostraAvviso(`Importate ${imp.sessioni} sessioni. Le invio al foglio…`);
    disegna();
    sincronizza();
  },
};

/* Scelta del file CSV di Strong. */
document.addEventListener('change', async e => {
  // Diario: giorno scelto dal calendario del telefono (mai nel futuro).
  if (e.target.id === 'diario-data') {
    const g = normalizzaData(e.target.value, 'giorno');
    if (/^\d{4}-\d{2}-\d{2}$/.test(g) && g <= oggiG()) { S.giornoDiario = g; history.replaceState(statoAttuale(), ''); }
    disegna();
    return;
  }
  if (e.target.id !== 'file-strong' || !e.target.files.length) return;
  try {
    const testo = await e.target.files[0].text();
    S.importazione = analizzaStrong(testo);
    apriFoglio(foglioRiepilogoImport(S.importazione));
  } catch (err) {
    apriFoglio(`<h2>Non riesco a leggere il file</h2><p class="tenue">${esc(err.message)}</p><button class="btn2 largo" data-azione="chiudi-foglio">Chiudi</button>`);
  }
});

/* Trascinamento di una serie verso destra o sinistra: oltre il 40% della larghezza si elimina. */
let trascina = null, ultimoTrascinamento = 0;
document.addEventListener('pointerdown', e => {
  const r = e.target.closest('.scorri > .serie');
  if (!r || e.button > 0) return;
  trascina = { r, x0: e.clientX, y0: e.clientY, dx: 0, attivo: false, oltre: false, pid: e.pointerId };
});
document.addEventListener('pointermove', e => {
  const t = trascina;
  if (!t || e.pointerId !== t.pid) return;
  const dx = e.clientX - t.x0, dy = e.clientY - t.y0;
  if (!t.attivo) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { trascina = null; return; } // sta scorrendo la pagina
    if (Math.abs(dx) < 12) return;
    t.attivo = true;
    try { t.r.setPointerCapture(e.pointerId); } catch (err) { /* non indispensabile */ }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    t.r.parentNode.classList.add('in-trascinamento');
  }
  t.dx = dx;
  t.r.style.transform = `translateX(${dx}px)`;
  const oltre = Math.abs(dx) > t.r.offsetWidth * 0.4;
  if (oltre !== t.oltre && navigator.vibrate) navigator.vibrate(15); // avvisa quando si supera la soglia
  t.oltre = oltre;
  t.r.parentNode.classList.toggle('oltre', oltre);
});
function fineTrascina() {
  const t = trascina;
  trascina = null;
  if (!t || !t.attivo) return;
  ultimoTrascinamento = Date.now();
  const largo = t.r.offsetWidth;
  t.r.style.transition = 'transform .18s ease-out';
  if (t.oltre) {
    t.r.style.transform = `translateX(${Math.sign(t.dx) * largo}px)`;
    setTimeout(() => eliminaRiga(t.r.dataset.scheda, t.r.dataset.id), 180);
  } else {
    t.r.style.transform = '';
    setTimeout(() => { t.r.style.transition = ''; t.r.parentNode.classList.remove('in-trascinamento', 'oltre'); }, 200);
  }
}
document.addEventListener('pointerup', fineTrascina);
document.addEventListener('pointercancel', fineTrascina);
// Dopo un trascinamento il «clic» finale non deve spuntare la serie né aprire il menu.
document.addEventListener('click', e => {
  if (Date.now() - ultimoTrascinamento < 350) { e.stopPropagation(); e.preventDefault(); }
}, true);

document.addEventListener('click', async e => {
  sbloccaAudio();
  const vaiA = e.target.closest('[data-vai]');
  if (vaiA) {
    e.preventDefault(); chiudiFoglio();
    if (vaiA.dataset.vai === 'esercizi' && TAB_DI[S.schermata] !== 'esercizi') S.vistaArchivio = 'esercizi';
    vai(vaiA.dataset.vai); return;
  }
  const el = e.target.closest('[data-azione]');
  if (!el || !AZIONI[el.dataset.azione]) return;
  try { await AZIONI[el.dataset.azione](el); }
  catch (err) { mostraAvviso('Qualcosa non va: ' + err.message); }
});

/* Comodità della tastiera:
 * - toccando un numero viene selezionato, così si riscrive senza cancellare;
 * - il tasto «Avanti» della tastiera porta al numero successivo (kg → rip → riga dopo);
 * - mentre si scrive, la barra in basso sparisce per lasciare spazio. */
document.addEventListener('focusin', e => {
  const el = e.target;
  if (el.matches('input, textarea')) document.body.classList.add('scrivendo');
  if (el.matches('input.num')) setTimeout(() => { try { el.select(); } catch (err) { /* alcuni campi non lo permettono */ } }, 0);
});
document.addEventListener('focusout', () => {
  setTimeout(() => { if (!document.activeElement || !document.activeElement.matches('input, textarea')) document.body.classList.remove('scrivendo'); }, 100);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('input.num')) return;
  e.preventDefault();
  const campi = [...document.querySelectorAll('#schermo input.num, #foglio input.num')].filter(x => x.offsetParent);
  const prossimo = campi[campi.indexOf(e.target) + 1];
  if (prossimo) { prossimo.focus(); prossimo.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  else e.target.blur();
});

/* Scrittura nei campi: si salva a ogni modifica, senza ridisegnare (il cursore resta dov'è). */
const LIMITI = { rpe: [0, 10], rpe_previsto: [0, 10], peso_kg: [0, 1000], rip: [0, 1000], durata_s: [0, 86400], durata_min: [0, 1440] };
function segnaValido(el, valido) { el.style.outline = valido ? '' : '2px solid var(--rosso)'; return valido; }
document.addEventListener('input', async e => {
  const el = e.target;
  if (el.dataset.ricerca === 'scelta') { S.ricerca = el.value; $('#lista-scelta').innerHTML = righeScelta(); return; }
  if (el.dataset.ricerca === 'archivio') { S.ricercaArchivio = el.value; $('#lista-archivio').innerHTML = righeArchivio(); return; }

  // Numeri di una serie (della sessione o prevista nel modello).
  if (el.dataset.scheda && el.dataset.campo && el.dataset.id) {
    const scheda = el.dataset.scheda, campo = el.dataset.campo;
    const s = riga(scheda, el.dataset.id);
    const v = leggiNum(el.value);
    const lim = LIMITI[campo];
    if (!segnaValido(el, v !== null && (v === '' || (v >= lim[0] && v <= lim[1])))) return;
    if (campo === 'durata_min') s.durata_s = v === '' ? '' : Math.round(v * 60);
    else s[campo] = (campo === 'rip' || campo === 'durata_s') && v !== '' ? Math.round(v) : v;
    await salva([scheda, s]);
    return;
  }
  // Campi dell'esercizio nella sessione: nota e riabilitazione.
  if (el.dataset.se && el.dataset.seCampo) {
    const se = riga('SessioniEsercizi', el.dataset.se);
    const campo = el.dataset.seCampo;
    if (campo === 'nota' || campo.endsWith('_nota')) se[campo] = el.value;
    else {
      const v = leggiNum(el.value);
      if (!segnaValido(el, v !== null && (v === '' || (v >= 0 && v <= 10)))) return;
      se[campo] = v;
    }
    await salva(['SessioniEsercizi', se]);
    return;
  }
  // Campi dell'esercizio nel modello: recupero e indicazione.
  if (el.dataset.meCampo) {
    const me = riga('ModelliEsercizi', el.dataset.id);
    if (el.dataset.meCampo === 'recupero_s') {
      const v = leggiNum(el.value);
      if (!segnaValido(el, v !== null && (v === '' || (v >= 0 && v <= 3600)))) return;
      me.recupero_s = v === '' ? '' : Math.round(v);
    } else me.nota = el.value;
    await salva(['ModelliEsercizi', me]);
    return;
  }
  // Campi del modello.
  if (el.dataset.modCampo) {
    const m = riga('Modelli', S.modelloId);
    const campo = el.dataset.modCampo;
    if (campo === 'ordine') {
      const v = leggiNum(el.value);
      if (!segnaValido(el, v !== null)) return;
      m.ordine = v;
    } else if (campo === 'sedute_settimana') {
      const v = leggiNum(el.value);
      if (!segnaValido(el, v !== null && (v === '' || (Number.isInteger(v) && v >= 0 && v <= 14)))) return;
      m.sedute_settimana = v;
    } else if (campo === 'nome') {
      if (!segnaValido(el, el.value.trim() !== '')) return;
      m.nome = el.value.trim();
    } else m[campo] = campo === 'cartella' ? el.value.trim() : el.value;
    await salva(['Modelli', m]);
    return;
  }
  // Diario: testo libero e note delle voci, nota dei farmaci, cursore delle scale ampie. Si salva a ogni lettera.
  if ('dvCampo' in el.dataset) {
    const campo = riga('DiarioCampi', el.dataset.campo);
    if (campo) await salvaValoreDiario(S.giornoDiario || oggiG(), campo, { [el.dataset.parte]: el.value });
    return;
  }
  if ('dvRange' in el.dataset) {
    const campo = riga('DiarioCampi', el.dataset.campo);
    const b = el.parentNode.querySelector('b'); if (b) b.textContent = el.value;
    if (campo) await salvaValoreDiario(S.giornoDiario || oggiG(), campo, { valore: Number(el.value) });
    return;
  }
  if ('dfNota' in el.dataset) {
    const f = riga('Farmaci', el.dataset.farmaco);
    if (f) await salvaFarmaco(S.giornoDiario || oggiG(), f, { nota: el.value });
    return;
  }
  if (el.dataset.sessCampo) {
    const sess = riga('Sessioni', S.sessioneId);
    sess[el.dataset.sessCampo] = el.value;
    await salva(['Sessioni', sess]);
  }
});

/* ======================= Avvio ======================= */

async function avvio() {
  document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = ic(el.dataset.ic); });
  try {
    idb = await apriDB();
    await caricaTutto();
  } catch (e) {
    $('#schermo').innerHTML = `<div class="vuoto-msg errore">Non riesco ad aprire la memoria del telefono: ${esc(e.message)}</div>`;
    return;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  history.replaceState(statoAttuale(), '');
  const inCorso = sessioneInCorso();
  if (inCorso) { S.schermata = 'sessione'; S.sessioneId = inCorso.id; history.pushState(statoAttuale(), ''); }
  disegna();
  controllaWakeLock();
  aggiornaTimer();
  setInterval(() => { aggiornaTimer(); aggiornaCronometro(); if (conto) disegnaConto(); }, 250);
  setInterval(() => sincronizza(), 120000);
  setInterval(controllaAvvisoFermo, 30000);
  window.addEventListener('online', () => sincronizza());
  window.addEventListener('offline', () => aggiornaStatoSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { controllaWakeLock(); aggiornaTimer(); sincronizza(); cercaAggiornamenti(); }
  });
  sincronizza();
  avviaAggiornamenti();
}

/* ======================= Aggiornamenti dell'app ======================= */

let registrazioneSW = null;
function avviaAggiornamenti() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const giaInstallata = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => { registrazioneSW = reg; cercaAggiornamenti(); }).catch(() => {});
  // Quando la versione nuova è scaricata e pronta, lo si dice: un tocco su «Aggiorna» ricarica l'app.
  // I dati non si perdono: sono già salvati nel telefono.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (giaInstallata) mostraAvviso('Nuova versione pronta', () => location.reload(), 'Aggiorna', 0);
  });
}
function cercaAggiornamenti() {
  if (registrazioneSW) return registrazioneSW.update().catch(() => {});
}
avvio();
