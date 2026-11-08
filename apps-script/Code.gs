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
 */

var FUSO = 'Europe/Rome';

// Le schede che l'app può leggere e scrivere. «Leggimi» non si tocca mai.
var SCHEDE = ['Esercizi', 'Modelli', 'ModelliEsercizi', 'ModelliSerie', 'Sessioni',
  'SessioniEsercizi', 'Serie', 'Test', 'Impostazioni'];

// Colonne che contengono numeri veri (tutte le altre sono testo, formato @).
var COLONNE_NUMERICHE = ['recupero_s', 'ordine', 'posizione', 'peso_kg', 'rip', 'durata_s',
  'rpe', 'rpe_previsto', 'ginocchio_pienezza', 'ginocchio_dolore', 'malleolo_dolore',
  'achille_dolore', 'valore', 'dolore', 'sedute_settimana'];

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
      if (colonna === 'valore') return String(valore); // Test: valore testuale ammesso
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
      if (dal && iAgg !== -1 && !(s.testi[r][iAgg] > dal)) continue;
      var riga = {};
      s.intestazioni.forEach(function (col, c) {
        if (col) riga[col] = valoreLetto(nome, col, s.valori[r][c], s.testi[r][c]);
      });
      righe.push(riga);
    }
    uscita[nome] = { intestazioni: s.intestazioni.filter(function (h) { return h; }), righe: righe };
  });
  return { ok: true, adesso: adesso(), schede: uscita };
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
  var formati = s.intestazioni.map(function (col) {
    return col && eNumerica(nome, col) ? 'General' : '@';
  });

  var posizione = {}; // id -> indice nella matrice (0 = riga 2 del foglio)
  s.testi.forEach(function (riga, i) { if (riga[iChiave] !== '') posizione[riga[iChiave]] = i; });

  var nuove = [], scritte = 0, ignorate = 0;
  righe.forEach(function (inArrivo) {
    var id = inArrivo && inArrivo[chiave] !== undefined ? String(inArrivo[chiave]) : '';
    if (!id) throw new Error('riga senza ' + chiave + ' in ' + nome);
    var i = posizione[id];
    if (i !== undefined) {
      var presente = iAgg === -1 ? '' : s.testi[i][iAgg];
      var arriva = iAgg === -1 ? '' : String(inArrivo.aggiornato_il || '');
      if (iAgg !== -1 && arriva < presente) { ignorate++; return; }
      // Le colonne che l'app non conosce restano come sono.
      var riga = s.valori[i].slice();
      s.intestazioni.forEach(function (col, c) {
        if (col && Object.prototype.hasOwnProperty.call(inArrivo, col)) {
          riga[c] = valoreDaScrivere(nome, col, inArrivo[col]);
        }
      });
      var area = s.foglio.getRange(i + 2, 1, 1, larghezza);
      area.setNumberFormats([formati]);
      area.setValues([riga]);
      s.valori[i] = riga;
      if (iAgg !== -1) s.testi[i][iAgg] = arriva;
      scritte++;
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

  if (nuove.length) {
    var primaLibera = s.foglio.getLastRow() + 1;
    var area = s.foglio.getRange(primaLibera, 1, nuove.length, larghezza);
    area.setNumberFormats(nuove.map(function () { return formati; }));
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
