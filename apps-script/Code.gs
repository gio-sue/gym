/**
 * Ponte dell'app «Gym» verso il foglio «App allenamento – Dati».
 *
 * Va incollato in Estensioni → Apps Script del foglio (script legato al foglio).
 * Il token NON sta qui: si imposta in Impostazioni progetto → Proprietà script,
 * con la chiave GYM_TOKEN.
 *
 * Una sola porta d'ingresso: doPost. Il corpo è JSON spedito come testo semplice:
 *   { "token": "...", "azione": "ping" | "pull" | "push", ... }
 * Risposta: { "ok": true, ... } oppure { "ok": false, "errore": "..." }.
 *
 * Versione 2 (08/11/2026): date lette in qualsiasi formato e restituite come AAAA-MM-GG;
 * aggiornamenti scritti a gruppi di righe vicine (molto più veloce).
 * Versione 3 (08/11/2026): colonne della pausa in Sessioni (pausa_s numero, pausa_dal data e ora).
 * Versione 4 (09/11/2026): schede del Diario (DiarioCampi, Farmaci in sola lettura; DiarioValori,
 * DiarioFarmaci in lettura e scrittura). La colonna «valore» prende il formato cella per cella:
 * un numero resta numero, un testo resta testo (così «1/2» non diventa una data).
 */

var FUSO = 'Europe/Rome';
var VERSIONE_PONTE = 4;

// Colonne con date o orari: «ora» = AAAA-MM-GG HH:mm:ss, «giorno» = AAAA-MM-GG.
var COLONNE_DATA = { aggiornato_il: 'ora', inizio: 'ora', fine: 'ora', pausa_dal: 'ora', data: 'giorno', giorno: 'giorno', dal: 'giorno', al: 'giorno' };

// Schede che l'app legge soltanto: un eventuale invio viene ignorato (non rifiutato, per non bloccare la coda).
var SOLO_LETTURA = ['DiarioCampi', 'Farmaci'];

/**
 * Riporta una data al formato dell'app, qualunque sia il modo in cui è finita nel foglio:
 * vera data di Google Fogli, testo «05/11/2026 18:00» oppure già «2026-11-05 18:00:00».
 * Le righe di partenza «AAAA-MM-GG HH:mm» (senza secondi) restano come sono, come chiede il brief.
 */
function normalizzaData(valore, testo, genere) {
  if (valore instanceof Date && !isNaN(valore)) {
    return Utilities.formatDate(valore, FUSO, genere === 'giorno' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  }
  var t = String(testo == null ? '' : testo).trim();
  if (!t || /^\d{4}-\d{2}-\d{2}/.test(t)) return t;
  var m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return t; // formato sconosciuto: si lascia com'è
  var g = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  if (genere === 'giorno') return g;
  return g + ' ' + ('0' + (m[4] || '0')).slice(-2) + ':' + (m[5] || '00') + ':' + (m[6] || '00');
}

// Le schede che l'app può leggere e scrivere. «Leggimi» non si tocca mai.
var SCHEDE = ['Esercizi', 'Modelli', 'ModelliEsercizi', 'ModelliSerie', 'Sessioni',
  'SessioniEsercizi', 'Serie', 'Test', 'Impostazioni',
  'DiarioCampi', 'Farmaci', 'DiarioValori', 'DiarioFarmaci'];

// Colonne che contengono numeri veri (tutte le altre sono testo, formato @).
// «valore» può essere numero o testo (Test, DiarioValori): il formato si decide cella per cella.
var COLONNE_NUMERICHE = ['recupero_s', 'ordine', 'posizione', 'peso_kg', 'rip', 'durata_s',
  'rpe', 'rpe_previsto', 'ginocchio_pienezza', 'ginocchio_dolore', 'malleolo_dolore',
  'achille_dolore', 'valore', 'dolore', 'sedute_settimana', 'pausa_s',
  'scala_min', 'scala_max', 'previste_al_giorno', 'previste', 'prese'];

/** Formato di una cella da scrivere: numero vero → «General», tutto il resto → testo «@». */
function formatoCella(nomeScheda, colonna, valoreScritto) {
  return eNumerica(nomeScheda, colonna) && typeof valoreScritto === 'number' ? 'General' : '@';
}

// In «Impostazioni» la chiave è «chiave» e il valore resta testo.
function chiaveDi(nomeScheda) {
  return nomeScheda === 'Impostazioni' ? 'chiave' : 'id';
}

function eNumerica(nomeScheda, colonna) {
  if (nomeScheda === 'Impostazioni') return false;
  return COLONNE_NUMERICHE.indexOf(colonna) !== -1;
}

function adesso() {
  return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd HH:mm:ss');
}

function risposta(oggetto) {
  return ContentService.createTextOutput(JSON.stringify(oggetto))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return risposta({ ok: false, errore: 'usa POST' });
}

function doPost(e) {
  var corpo;
  try {
    corpo = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '');
  } catch (err) {
    return risposta({ ok: false, errore: 'richiesta non valida' });
  }
  var atteso = PropertiesService.getScriptProperties().getProperty('GYM_TOKEN');
  if (!atteso || !corpo || typeof corpo.token !== 'string' || corpo.token !== atteso) {
    return risposta({ ok: false, errore: 'non autorizzato' });
  }
  try {
    if (corpo.azione === 'ping') return risposta({ ok: true, adesso: adesso() });
    if (corpo.azione === 'pull') return risposta(pull(corpo));
    if (corpo.azione === 'push') return risposta(push(corpo));
    return risposta({ ok: false, errore: 'azione sconosciuta' });
  } catch (err) {
    // Il messaggio non contiene mai il token: arriva solo da questo script.
    return risposta({ ok: false, errore: String(err && err.message ? err.message : err) });
  }
}

/** Legge una scheda: intestazioni e righe come oggetti {colonna: valore}. */
function leggiScheda(nomeScheda) {
  var foglio = SpreadsheetApp.getActive().getSheetByName(nomeScheda);
  if (!foglio) throw new Error('scheda mancante: ' + nomeScheda);
  var ultimaColonna = foglio.getLastColumn();
  var ultimaRiga = foglio.getLastRow();
  var intestazioni = foglio.getRange(1, 1, 1, ultimaColonna).getDisplayValues()[0]
    .map(function (h) { return String(h).trim(); });
  var valori = [], testi = [];
  if (ultimaRiga > 1) {
    var area = foglio.getRange(2, 1, ultimaRiga - 1, ultimaColonna);
    valori = area.getValues();
    testi = area.getDisplayValues();
  }
  return { foglio: foglio, intestazioni: intestazioni, valori: valori, testi: testi };
}

/** Converte una cella letta dal foglio nel valore da mandare all'app. */
function valoreLetto(nomeScheda, colonna, valore, testo) {
  if (COLONNE_DATA[colonna] && nomeScheda !== 'Impostazioni') return normalizzaData(valore, testo, COLONNE_DATA[colonna]);
  if (!eNumerica(nomeScheda, colonna)) return testo;
  if (valore === '' || valore === null) return '';
  if (typeof valore === 'number') return valore;
  var n = Number(String(valore).replace(',', '.'));
  return isNaN(n) ? String(testo) : n;
}

/** Converte un valore arrivato dall'app nella cella da scrivere. */
function valoreDaScrivere(nomeScheda, colonna, valore) {
  if (valore === undefined || valore === null) return '';
  if (eNumerica(nomeScheda, colonna)) {
    if (valore === '') return '';
    var n = typeof valore === 'number' ? valore : Number(String(valore).replace(',', '.'));
    if (isNaN(n)) {
      if (colonna === 'valore') return String(valore); // Test e Diario: valore testuale ammesso («sì», testo libero…)
      throw new Error('numero non valido in ' + nomeScheda + '.' + colonna);
    }
    return n;
  }
  return String(valore);
}

function pull(corpo) {
  var dal = typeof corpo.dal === 'string' ? corpo.dal : '';
  var richieste = Array.isArray(corpo.schede) ? corpo.schede : [];
  var uscita = {};
  richieste.forEach(function (nome) {
    if (SCHEDE.indexOf(nome) === -1) throw new Error('scheda non ammessa: ' + nome);
    var s = leggiScheda(nome);
    var chiave = chiaveDi(nome);
    var iChiave = s.intestazioni.indexOf(chiave);
    var iAgg = s.intestazioni.indexOf('aggiornato_il');
    var righe = [];
    for (var r = 0; r < s.valori.length; r++) {
      if (iChiave === -1 || s.testi[r][iChiave] === '') continue;
      if (dal && iAgg !== -1 && !(normalizzaData(s.valori[r][iAgg], s.testi[r][iAgg], 'ora') > dal)) continue;
      var riga = {};
      s.intestazioni.forEach(function (col, c) {
        if (col) riga[col] = valoreLetto(nome, col, s.valori[r][c], s.testi[r][c]);
      });
      righe.push(riga);
    }
    uscita[nome] = { intestazioni: s.intestazioni.filter(function (h) { return h; }), righe: righe };
  });
  return { ok: true, adesso: adesso(), versione_ponte: VERSIONE_PONTE, schede: uscita };
}

function push(corpo) {
  var pacchetto = corpo.righe;
  if (!pacchetto || typeof pacchetto !== 'object') throw new Error('righe mancanti');
  var lucchetto = LockService.getScriptLock();
  lucchetto.waitLock(30000);
  try {
    var scritte = 0, ignorate = 0;
    Object.keys(pacchetto).forEach(function (nome) {
      if (SCHEDE.indexOf(nome) === -1) throw new Error('scheda non ammessa: ' + nome);
      if (SOLO_LETTURA.indexOf(nome) !== -1) { // l'app non le scrive mai: si ignora senza errore
        ignorate += Array.isArray(pacchetto[nome]) ? pacchetto[nome].length : 0;
        return;
      }
      var esito = scriviScheda(nome, pacchetto[nome]);
      scritte += esito.scritte;
      ignorate += esito.ignorate;
    });
    segnaUltimoSalvataggio();
    return { ok: true, scritte: scritte, ignorate: ignorate, adesso: adesso() };
  } finally {
    lucchetto.releaseLock();
  }
}

/** Upsert per id: sostituisce se aggiornato_il in arrivo >= quello presente, altrimenti aggiunge. */
function scriviScheda(nome, righe) {
  if (!Array.isArray(righe) || !righe.length) return { scritte: 0, ignorate: 0 };
  var s = leggiScheda(nome);
  var chiave = chiaveDi(nome);
  var iChiave = s.intestazioni.indexOf(chiave);
  var iAgg = s.intestazioni.indexOf('aggiornato_il');
  if (iChiave === -1) throw new Error('colonna ' + chiave + ' mancante in ' + nome);
  var larghezza = s.intestazioni.length;
  // Formati di una riga nuova: cella per cella, secondo il valore che ci va.
  function formatiDi(riga) {
    return riga.map(function (v, c) { return s.intestazioni[c] ? formatoCella(nome, s.intestazioni[c], v) : '@'; });
  }

  var posizione = {}; // id -> indice nella matrice (0 = riga 2 del foglio)
  s.testi.forEach(function (riga, i) { if (riga[iChiave] !== '') posizione[riga[iChiave]] = i; });

  var nuove = [], scritte = 0, ignorate = 0;
  var cambiate = {}; // indice della riga -> { riga, formati } (scritti tutti insieme alla fine)
  var formatiOriginali = null; // letti solo se servono: le colonne sconosciute tengono il loro formato
  righe.forEach(function (inArrivo) {
    var id = inArrivo && inArrivo[chiave] !== undefined ? String(inArrivo[chiave]) : '';
    if (!id) throw new Error('riga senza ' + chiave + ' in ' + nome);
    var i = posizione[id];
    if (i !== undefined) {
      var presente = iAgg === -1 ? '' : normalizzaData(s.valori[i][iAgg], s.testi[i][iAgg], 'ora');
      var arriva = iAgg === -1 ? '' : String(inArrivo.aggiornato_il || '');
      if (iAgg !== -1 && arriva < presente) { ignorate++; return; }
      // Le colonne che l'app non conosce restano come sono.
      if (!formatiOriginali) formatiOriginali = s.foglio.getRange(2, 1, s.valori.length, larghezza).getNumberFormats();
      var riga = s.valori[i].slice();
      var formatiRiga = formatiOriginali[i].slice();
      s.intestazioni.forEach(function (col, c) {
        if (col && Object.prototype.hasOwnProperty.call(inArrivo, col)) {
          riga[c] = valoreDaScrivere(nome, col, inArrivo[col]);
          formatiRiga[c] = formatoCella(nome, col, riga[c]);
        }
      });
      s.valori[i] = riga;
      if (iAgg !== -1) s.testi[i][iAgg] = arriva;
      if (!cambiate[i]) scritte++;
      cambiate[i] = { riga: riga, formati: formatiRiga };
    } else if (nuove.some(function (n) { return n.id === id; })) {
      // Stessa riga due volte nello stesso invio: tiene la più recente.
      var doppia = nuove.filter(function (n) { return n.id === id; })[0];
      if (String(inArrivo.aggiornato_il || '') >= doppia.agg) {
        doppia.riga = costruisciRiga(nome, s.intestazioni, inArrivo);
        doppia.agg = String(inArrivo.aggiornato_il || '');
      }
    } else {
      nuove.push({ id: id, agg: String(inArrivo.aggiornato_il || ''), riga: costruisciRiga(nome, s.intestazioni, inArrivo) });
    }
  });

  // Righe aggiornate: si scrivono a gruppi di righe consecutive, una sola operazione per gruppo.
  var indici = Object.keys(cambiate).map(Number).sort(function (a, b) { return a - b; });
  for (var k = 0; k < indici.length;) {
    var inizio = indici[k], fine = inizio;
    while (k + 1 < indici.length && indici[k + 1] === fine + 1) { k++; fine++; }
    k++;
    var blocco = [];
    for (var r = inizio; r <= fine; r++) blocco.push(cambiate[r]);
    var zona = s.foglio.getRange(inizio + 2, 1, blocco.length, larghezza);
    zona.setNumberFormats(blocco.map(function (b) { return b.formati; }));
    zona.setValues(blocco.map(function (b) { return b.riga; }));
  }

  if (nuove.length) {
    var primaLibera = s.foglio.getLastRow() + 1;
    var area = s.foglio.getRange(primaLibera, 1, nuove.length, larghezza);
    area.setNumberFormats(nuove.map(function (n) { return formatiDi(n.riga); }));
    area.setValues(nuove.map(function (n) { return n.riga; }));
    scritte += nuove.length;
  }
  return { scritte: scritte, ignorate: ignorate };
}

function costruisciRiga(nome, intestazioni, inArrivo) {
  return intestazioni.map(function (col) {
    return col && Object.prototype.hasOwnProperty.call(inArrivo, col)
      ? valoreDaScrivere(nome, col, inArrivo[col]) : '';
  });
}

/** Aggiorna il valore della riga «ultimo_salvataggio» di Impostazioni, se c'è. */
function segnaUltimoSalvataggio() {
  var foglio = SpreadsheetApp.getActive().getSheetByName('Impostazioni');
  if (!foglio || foglio.getLastRow() < 2) return;
  var intestazioni = foglio.getRange(1, 1, 1, foglio.getLastColumn()).getDisplayValues()[0];
  var iChiave = intestazioni.indexOf('chiave'), iValore = intestazioni.indexOf('valore');
  if (iChiave === -1 || iValore === -1) return;
  var chiavi = foglio.getRange(2, iChiave + 1, foglio.getLastRow() - 1, 1).getDisplayValues();
  for (var r = 0; r < chiavi.length; r++) {
    if (chiavi[r][0] === 'ultimo_salvataggio') {
      var cella = foglio.getRange(r + 2, iValore + 1, 1, 1);
      cella.setNumberFormats([['@']]);
      cella.setValues([[adesso()]]);
      return;
    }
  }
}
