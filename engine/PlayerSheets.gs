/**
 * Starverse Infinitas · Player Interface records.
 *
 * Each nation has a private record: a small spreadsheet shared "anyone with the link can view",
 * whose ID is the nation's secret key. The site's nation.html?feed=<ID> reads it and shows the
 * nation its own sheet: stockpiles, this turn's income, upkeep and committed spending, projected
 * stockpiles, vitals, systems, worlds, forces, works under way, its fiscal code and its statement.
 * Only player-facing figures are copied. Nothing the GM keeps hidden leaves the workbook.
 *
 * INSTALL (once per workbook: the Master, and each Sandbox):
 *   1. In the workbook: Extensions > Apps Script > + beside Files > Script. Name it PlayerSheets.
 *      Paste this file, save.
 *   2. Run pfRefresh once and approve the permissions. Each nation gets its record (Nations column
 *      "Private feed"), its private map link and its "Player sheet link".
 *   3. Run pfInstallTrigger once: records refresh every hour, and the turn processor (if installed
 *      in the same project) refreshes them right after every live Prepare and Resolve.
 *
 * Safe beside the private-feeds script (Code.gs): it uses its own names (pf...) and the same
 * Nations columns, and it never touches a nation that already has a record except to refresh it.
 */

var PF_SITE = 'https://morifinweundome.github.io/Starverse-Infinitas/';
var PF_MASTER_FOLDER = '1blvHnwAMiM7OGsOc0-eoHAZ3FpmF454C';   // the Master's record folder
var PF_SANDBOX_FOLDER = '14aPkKlSxfuOn1k2u6RmiDqTgKg-ftK0J';  // the GM Folder, for sandbox records
var PF_MAIN = ['Industry', 'Energy', 'Research', 'Influence'];
var PF_STRAT = ['Adamant ore', 'Lattice crystals', 'Antimatter', 'Volatile isotopes', 'Living compounds', 'Void matter'];
var PF_ADV = [];   // advanced materials: every material named on the Recipes tab (set by pfWorkbook_)

/* ------------------------------------------------------------------ entry points */

/** Creates any missing records, then refreshes every record. */
function pfRefresh() {
  var book = SpreadsheetApp.getActive();
  var W = pfWorkbook_(book);
  pfEnsureRecords_(book, W);
  W = pfWorkbook_(book);
  var done = 0, failed = [];
  W.nations.forEach(function (n) {
    var feed = n.get('Private feed');
    if (!feed) return;
    try {
      var ss = SpreadsheetApp.openById(feed);
      var rec = pfRecord_(W, n);
      pfExtras_(W, n, rec, ss);
      pfWrite_(ss, rec); done++;
    }
    catch (e) { failed.push(n.id + ': ' + e.message); }
  });
  if (failed.length) throw new Error(done + ' records written; failed: ' + failed.join('; '));
  return done + ' records';
}

/** Hourly refresh. Removes any older copy of this trigger first. */
function pfInstallTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'pfRefresh') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pfRefresh').timeBased().everyHours(1).create();
}

/* ------------------------------------------------------------------ reading the workbook */

function pfTab_(book, name) {
  var sh = book.getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return { head: [], rows: [] };
  var v = sh.getDataRange().getDisplayValues();
  var head = v.shift().map(function (h) { return String(h).trim(); });
  return { head: head, rows: v, sheet: sh };
}
function pfRow_(head, r, rowNo) {
  return {
    row: rowNo, raw: r,
    get: function (k) { var i = head.indexOf(k); return i < 0 ? '' : String(r[i] == null ? '' : r[i]).trim(); },
    num: function (k) { var x = parseFloat(String(this.get(k)).replace(/[, ]/g, '')); return isFinite(x) ? x : 0; }
  };
}
function pfRows_(t) { return t.rows.map(function (r, i) { return pfRow_(t.head, r, i + 2); }); }

function pfWorkbook_(book) {
  var N = pfTab_(book, 'Nations');
  var W = {
    book: book, N: N,
    nations: pfRows_(N).filter(function (n) { return n.get('Nation ID') && n.get('Nation'); }),
    calc: {}, systems: pfRows_(pfTab_(book, 'Systems')), worlds: pfRows_(pfTab_(book, 'Worlds')),
    forces: pfRows_(pfTab_(book, 'Forces')), fiscal: pfRows_(pfTab_(book, 'Fiscal')),
    ledger: pfRows_(pfTab_(book, 'Ledger')), actions: pfRows_(pfTab_(book, 'Actions')),
    wip: pfRows_(pfTab_(book, 'Works in progress')),
    lanes: pfRows_(pfTab_(book, 'Lanes')), treaties: pfRows_(pfTab_(book, 'Treaties')),
    debts: pfRows_(pfTab_(book, 'Debts')), inbox: pfRows_(pfTab_(book, 'Orders inbox')),
    tables: pfTab_(book, 'Tables'), control: pfRows_(pfTab_(book, 'Control')),
    events: pfRows_(pfTab_(book, 'Events')), reports: pfRows_(pfTab_(book, 'Reports')), unlocks: pfRows_(pfTab_(book, 'Unlocks')), exchange: pfRows_(pfTab_(book, 'Exchange')), exorders: pfRows_(pfTab_(book, 'Exchange orders')), recipes: pfRows_(pfTab_(book, 'Recipes')), turnlog: pfRows_(pfTab_(book, 'Turn log'))
  };
  W.nations.forEach(function (n) { n.id = n.get('Nation ID'); });
  pfRows_(pfTab_(book, 'Calculations')).forEach(function (c) { W.calc[c.get('Nation ID')] = c; });
  W.sysName = {}; W.systems.forEach(function (s) { W.sysName[s.get('System ID')] = s.get('Name'); });
  W.turn = 0;
  W.ledger.forEach(function (l) { W.turn = Math.max(W.turn, l.num('Turn')); });
  PF_ADV = [];
  W.recipes.forEach(function (r) { var m = r.get('Recipe'); if (m && !/building/i.test(r.get('Yields')) && PF_ADV.indexOf(m) < 0) PF_ADV.push(m); });
  W.actionTurn = 0;
  W.actions.forEach(function (a) { if (a.get('Nation')) W.actionTurn = Math.max(W.actionTurn, a.num('Turn')); });
  return W;
}

/* ------------------------------------------------------------------ creating records */

function pfColumn_(N, header) {
  var i = N.head.indexOf(header);
  if (i >= 0) return i + 1;
  var col = N.head.length + 1;
  N.sheet.getRange(1, col).setValue(header);
  N.head.push(header);
  return col;
}

function pfEnsureRecords_(book, W) {
  var N = W.N; if (!N.sheet) return;
  var cFeed = pfColumn_(N, 'Private feed'), cMap = pfColumn_(N, 'Private map link'), cSheet = pfColumn_(N, 'Player sheet link');
  var sandbox = /sandbox/i.test(book.getName());
  var folder = null;
  try { folder = DriveApp.getFolderById(sandbox ? PF_SANDBOX_FOLDER : PF_MASTER_FOLDER); } catch (e) {}
  W.nations.forEach(function (n) {
    var feed = String(N.sheet.getRange(n.row, cFeed).getValue()).trim();
    if (!feed) {
      var ss = SpreadsheetApp.create((sandbox ? 'Sandbox · ' : '') + 'Starverse Infinitas · ' + n.get('Nation') + ' · private record');
      feed = ss.getId();
      N.sheet.getRange(n.row, cFeed).setValue(feed);   // written first, so a later failure never makes a second copy
      SpreadsheetApp.flush();
      try { ss.getSheets()[0].setName('Worlds'); } catch (e) {}
      var f = DriveApp.getFileById(feed);
      if (folder) { try { f.moveTo(folder); } catch (e) { Logger.log('Could not file the record: ' + e); } }
    }
    pfShare_(feed);
    if (!String(N.sheet.getRange(n.row, cMap).getValue()).trim()) N.sheet.getRange(n.row, cMap).setValue(PF_SITE + '?feed=' + feed + '#map');
    N.sheet.getRange(n.row, cSheet).setValue(PF_SITE + 'nation.html?feed=' + feed);
  });
  SpreadsheetApp.flush();
}

/** Anyone with the link can view: the page reads the record without signing in. */
function pfShare_(id) {
  var f = DriveApp.getFileById(id);
  try { if (f.getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK) return; } catch (e) {}
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); return; }
  catch (e) { Logger.log('DriveApp sharing refused for ' + id + ': ' + e); }
  // Fallback: the Drive API (Services > + > Drive API, if added to the project).
  if (typeof Drive !== 'undefined' && Drive.Permissions) {
    if (Drive.Permissions.create) Drive.Permissions.create({ role: 'reader', type: 'anyone' }, id);
    else Drive.Permissions.insert({ role: 'reader', type: 'anyone', value: '', withLink: true }, id);
    return;
  }
  throw new Error('Google refused to share the record ' + id + ' by link. Add the Drive API service (Services > + > Drive API) and run again.');
}

/* ------------------------------------------------------------------ one nation's record */

/** Strips the GM's working (seeds, ruling references, hand-application notes) from a log line. */
function pfClean_(t) {
  return String(t || '')
    .replace(/^Recorded on the player's word:\s*/i, '')
    .replace(/\s*\([^()]*(seed|Rulings row|GM ruling|GM Reference|applied by hand)[^()]*\)/gi, '')
    .replace(/\s*Applied by hand[^.]*\.?/gi, '')
    .replace(/\s+([.,;])/g, '$1').trim();
}
function pfRound_(x) { return Math.round(x * 10) / 10; }

function pfStrat_(text) {
  var out = {};
  String(text || '').split(/\s*[;,]\s*/).forEach(function (p) {
    var m = p.match(/^(-?[\d.]+)\s+(.+)$/); if (!m) return;
    var k = PF_STRAT.concat(PF_ADV).filter(function (s) { return s.toLowerCase() === m[2].toLowerCase() || s.toLowerCase().replace(/s$/, '') === m[2].toLowerCase(); })[0];
    if (k) out[k] = (out[k] || 0) + parseFloat(m[1]);
  });
  return out;
}

function pfRecord_(W, n) {
  var id = n.id, c = W.calc[id] || pfRow_([], [], 0);
  var turn = W.turn;

  // spending already committed by orders prepared for the turn now open (not yet applied)
  var committed = {};
  if (W.actionTurn > turn) W.actions.forEach(function (a) {
    if (a.get('Nation') !== id || a.num('Turn') !== W.actionTurn) return;
    var st = a.get('Status'); if (st !== 'Ready' && st !== 'Needs ruling') return;
    PF_MAIN.forEach(function (k) { committed[k] = (committed[k] || 0) + a.num(k); });
    var s = pfStrat_(a.get('Strategic')); Object.keys(s).forEach(function (k) { committed[k] = (committed[k] || 0) + s[k]; });
  });

  // stockpiles
  var income = { Industry: c.num('Net Industry'), Energy: c.num('Net Energy'), Research: c.num('Net Research'), Influence: c.num('Net Influence') };
  PF_STRAT.forEach(function (k) { income[k] = c.num(k); });
  var upkeep = { Energy: c.num('Upkeep Energy'), Influence: c.num('Upkeep Influence'), 'Volatile isotopes': c.num('Upkeep Volatile isotopes') };
  var stock = [['Resource', 'Kind', 'Stockpile', 'Income', 'Upkeep', 'Committed', 'Net this turn', 'Projected']];
  PF_MAIN.concat(PF_STRAT).forEach(function (k) {
    var s = n.num(k), inc = income[k] || 0, up = upkeep[k] || 0, com = committed[k] || 0;
    var net = inc - up - com;
    stock.push([k, PF_MAIN.indexOf(k) >= 0 ? 'Main' : 'Strategic', pfRound_(s), pfRound_(inc), pfRound_(up), pfRound_(com), pfRound_(net), pfRound_(s + net)]);
  });
  // advanced materials: held as the sum of this nation's Ledger lines for each material
  PF_ADV.forEach(function (k) {
    var s = 0, seen = false;
    W.ledger.forEach(function (l) { if (l.get('Nation') === id && l.get('Resource').toLowerCase() === k.toLowerCase()) { s += l.num('Amount'); seen = true; } });
    var com = committed[k] || 0;
    if (!seen && !com) return;
    stock.push([k, 'Advanced', pfRound_(s), 0, 0, pfRound_(com), pfRound_(-com), pfRound_(s - com)]);
  });

  // the sheet: who the nation is and how it stands
  var civics = ['Civic 1', 'Civic 2', 'Civic 3', 'Civic 4'].map(function (k) { return n.get(k); }).filter(String).join(', ');
  var sheet = [['Key', 'Value'],
    ['Nation', n.get('Nation')], ['Nation ID', id], ['Player', n.get('Player')], ['Status', n.get('Status')],
    ['Turn', turn], ['Orders open for turn', Math.max(turn + 1, W.actionTurn > turn ? W.actionTurn : turn + 1)],
    ['Orders prepared', W.actionTurn > turn ? 'Yes' : 'No'],
    ['Government', n.get('Government')],
    ['Order–Liberty', n.get('Order–Liberty')], ['Sacred–Secular', n.get('Sacred–Secular')],
    ['Martial–Pacific', n.get('Martial–Pacific')], ['Outward–Inward', n.get('Outward–Inward')],
    ['Civics', civics], ['Biology', n.get('Biology')], ['Habitat', n.get('Habitat')], ['Traits', n.get('Traits')],
    ['Self and group', n.get('Self–group')], ['The beyond', n.get('The beyond')],
    ['Signature adaptation', n.get('Signature adaptation')],
    ['Military tier', n.get('Military tier')], ['Industry tier', n.get('Industry tier')],
    ['Society tier', n.get('Society tier')], ['Logistics tier', n.get('Logistics tier')],
    ['Stability', n.get('Stability')], ['Stability target', n.get('Stability target') || c.get('Stability target')],
    ['Systems held', c.get('Systems held')], ['Total Development', c.get('Total Development')],
    ['Administrative Capacity', c.get('Administrative Capacity')], ['Capacity over', c.get('Capacity over')],
    ['Fleet Capacity', c.get('Fleet Capacity')], ['Ship capacity used', c.get('Ship capacity used')],
    ['Fleet Power', c.get('Fleet Power')], ['Ground Power', c.get('Ground Power')], ['Army Capacity', c.get('Army Capacity')],
    ['Population (bn)', c.get('Population (bn)')], ['Workforce needed (bn)', c.get('Workforce needed (bn)')],
    ['GDP (SM)', c.get('GDP (SM)')], ['Revenue (SM)', c.get('Revenue (SM)')], ['Debt (SM)', c.get('Debt (SM)')],
    ['Credit rating', c.get('Credit rating')], ['Bond rate %', c.get('Bond rate %')],
    ['Per-capita GDP (SM per bn)', c.get('Per-capita GDP (SM per bn)')],
    ['Trade agreements', c.get('Trade agreements')], ['Trade slots', c.get('Trade slots')],
    ['Active treaties', c.get('Active treaties')], ['Systems discovered', c.get('Systems discovered')],
    ['Renown standing', c.get('Renown standing')], ['Infamy standing', c.get('Infamy standing')],
    ['Order form link', n.get('Order form link')],
    ['Private map link', n.get('Private map link')],
    ['Updated', Utilities.formatDate(new Date(), 'Asia/Singapore', "yyyy-MM-dd HH:mm 'SGT'")]];

  // systems held
  var sys = [['System ID', 'Name', 'Sector', 'Class', 'Environment', 'Designation', 'Development', 'Development cap', 'Buildings',
    'Slots', 'Slots used', 'Condition', 'Strain', 'Population (bn)', 'Carrying capacity (bn)', 'Industry', 'Energy', 'Research', 'Influence', 'Growth due (bn)', 'Overcrowded', 'Orbital slots', 'Orbital used']];
  var orbital = ['Habitat Station'];
  W.unlocks.forEach(function (u) { if (/orbital/i.test(u.get('Takes a slot')) && orbital.indexOf(u.get('Building')) < 0) orbital.push(u.get('Building')); });
  W.systems.filter(function (s) { return s.get('Owner') === id; }).forEach(function (s) {
    sys.push([s.get('System ID'), s.get('Name'), s.get('Sector'), s.get('Class'), s.get('Environment'), s.get('Designation'),
      s.get('Development'), s.get('Effective Development cap') || s.get('Development cap'), s.get('Buildings'), s.get('Slots'), s.get('Slots used'),
      s.get('Condition'), s.get('Strain'), s.get('Population (bn)'), s.get('Carrying capacity (bn)'),
      s.get('Industry'), s.get('Energy'), s.get('Research'), s.get('Influence'), s.get('Growth due (bn)'), s.get('Overcrowded'),
      1 + (s.num('Development') >= 4 ? 1 : 0),
      String(s.get('Buildings')).split(/\s*,\s*/).filter(function (b) { return orbital.indexOf(b.replace(/\s*\(.*\)\s*$/, '')) >= 0; }).length]);
  });

  // worlds (same layout the star map's private link reads)
  var worlds = [['System ID', 'System', 'World', 'Orbit', 'Kind', 'Environment', 'Habitable', 'Settled', 'Population (bn)', 'Buildings here',
    'Industry', 'Energy', 'Research', 'Influence', 'Description']];
  W.worlds.filter(function (w) { return w.get('Owner') === id && w.get('World'); })
    .sort(function (a, b) { return a.get('System ID') < b.get('System ID') ? -1 : a.get('System ID') > b.get('System ID') ? 1 : a.num('Orbit') - b.num('Orbit'); })
    .forEach(function (w) {
      worlds.push([w.get('System ID'), W.sysName[w.get('System ID')] || '', w.get('World'), w.get('Orbit'), w.get('Kind'), w.get('Environment'),
        w.get('Habitable'), w.get('Settled'), w.get('Population (bn)'), w.get('Buildings here'),
        w.get('Industry'), w.get('Energy'), w.get('Research'), w.get('Influence'), w.get('Description')]);
    });

  // forces
  var forces = [['Force ID', 'Name', 'Location', 'Location name', 'Escorts', 'Cruisers', 'Battleships', 'Dreadnoughts', 'Transports', 'Ground Power', 'Static Defence', 'Fleet Power', 'Capacity']];
  W.forces.filter(function (f) { return f.get('Owner') === id; }).forEach(function (f) {
    forces.push([f.get('Force ID'), f.get('Name'), f.get('Location'), W.sysName[f.get('Location')] || '', f.get('Escorts'), f.get('Cruisers'), f.get('Battleships'),
      f.get('Dreadnoughts'), f.get('Transports'), f.get('Ground Power'), f.get('Static Defence'), f.get('Fleet Power'), f.get('Capacity')]);
  });

  // works under way
  var works = [['Kind', 'Item', 'System', 'Turn ordered', 'Completes at end of turn']];
  W.wip.filter(function (w) { return w.get('Nation') === id && w.get('Status') === 'Under way'; }).forEach(function (w) {
    works.push([w.get('Kind'), w.get('Item'), w.get('System'), w.get('Turn ordered'), w.get('Completes at end of turn')]);
  });

  // fiscal code
  var fiscal = [['Instrument', 'Intensity', 'As written', 'Since turn']];
  W.fiscal.filter(function (f) { return f.get('Nation ID') === id && f.get('Instrument'); }).forEach(function (f) {
    fiscal.push([f.get('Instrument'), f.get('Intensity'), f.get('As written'), f.get('Since turn')]);
  });

  // statement: the lines shown to the player, latest ten turns
  var statement = [['Turn', 'Phase', 'Resource', 'Amount', 'Reason', 'Balance after']];
  W.ledger.filter(function (l) { return l.get('Nation') === id && l.get('Shown to player') !== 'No' && l.num('Turn') >= turn - 9; })
    .sort(function (a, b) { return b.num('Turn') - a.num('Turn') || b.num('Entry') - a.num('Entry'); })
    .forEach(function (l) { statement.push([l.get('Turn'), l.get('Phase'), l.get('Resource'), l.get('Amount'), l.get('Reason'), l.get('Balance after')]); });

  // orders committed this turn, as the player sent them (for the "Committed" breakdown)
  var orders = [['Order', 'Status', 'Industry', 'Energy', 'Research', 'Influence', 'Strategic']];
  if (W.actionTurn > turn) W.actions.forEach(function (a) {
    if (a.get('Nation') !== id || a.num('Turn') !== W.actionTurn) return;
    var st = a.get('Status');
    if (a.get('Channel') && /covert/i.test(a.get('Channel'))) return;   // covert operations stay off the record
    orders.push([a.get('Posted text'), st === 'Needs ruling' ? 'Awaiting the GM' : st, a.get('Industry'), a.get('Energy'), a.get('Research'), a.get('Influence'), a.get('Strategic')]);
  });

  return { Sheet: sheet, Stockpiles: stock, Systems: sys, Worlds: worlds, Forces: forces, Works: works, Fiscal: fiscal, Statement: statement, Orders: orders };
}

/* ------------------------------------------------------------------ writing a record */

function pfWrite_(ss, rec) {
  Object.keys(rec).forEach(function (name) {
    var data = rec[name], width = data[0].length;
    data = data.map(function (r) { r = r.slice(0, width); while (r.length < width) r.push(''); return r.map(function (v) { return v == null ? '' : v; }); });
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clearContents();
    if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    if (sh.getMaxRows() < data.length) sh.insertRowsAfter(sh.getMaxRows(), data.length - sh.getMaxRows());
    var rng = sh.getRange(1, 1, data.length, width);
    rng.setNumberFormat('@');   // keep every value as written (no dates or numbers reinterpreted)
    rng.setValues(data.map(function (r) { return r.map(String); }));
  });
}


/* ------------------------------------------------------------------ decision aids */

var PF_TECH_STRAT = { Military: 'Antimatter', Industry: 'Lattice crystals', Society: 'Lattice crystals', Logistics: 'Volatile isotopes' };
var PF_GROUND = [   // Formation, Industry, strategic, requires, wages (Marks), capacity
  ['Infantry', 2, '', '', 0.25, 1], ['Specialised Infantry', 4, '', 'Military Tier 2', 0.4, 1],
  ['Armour', 7, '1 Adamant ore', 'Military Tier 2', 0.75, 2], ['Heavy Armour', 16, '2 Adamant ore; 1 Lattice crystals', 'Military Tier 4', 1.5, 4],
  ['Artillery', 5, '', 'Military Tier 2', 0.5, 2], ['Heavy Artillery', 14, '1 Adamant ore; 1 Antimatter', 'Military Tier 4', 1, 4],
  ['Special Forces', 6, '', 'Military Tier 3; a Military College', 0.5, 1]];

/** A block of the Tables tab that starts with a title row and a header row. */
function pfBlock_(T, title) {
  var v = T.rows.map(function (r) { return r.map(function (x) { return String(x).trim(); }); });
  var all = [T.head].concat(v), out = [];
  for (var i = 0; i < all.length; i++) {
    if (all[i][0] !== title) continue;
    var j = i + 1;
    if (title === 'Category') { j = i; }
    var head = all[j]; j++;
    for (; j < all.length && all[j][0] !== ''; j++) { var o = {}; head.forEach(function (h, k) { o[h] = all[j][k]; }); out.push(o); }
    break;
  }
  return out;
}

function pfMeets_(req, tiers) {
  var ok = true;
  String(req || '').replace(/(Military|Industry|Society|Logistics)\s*(?:Tier\s*|T)(\d)/g, function (m, b, t) { if ((tiers[b] || 1) < Number(t)) ok = false; return m; });
  return ok;
}

function pfCharted_(W, id) {
  var own = {}, ch = {};
  W.systems.forEach(function (s) { if (s.get('Owner') === id) own[s.get('System ID')] = 1; });
  Object.keys(own).forEach(function (k) { ch[k] = 1; });
  W.lanes.forEach(function (l) { var a = l.get('From'), b = l.get('To'); if (own[a]) ch[b] = 1; if (own[b]) ch[a] = 1; });
  W.systems.forEach(function (s) { if (String(s.get('Discovered by')).split(/\s*[,;]\s*/).indexOf(id) >= 0) ch[s.get('System ID')] = 1; });
  return { own: own, charted: ch };
}

function pfExtras_(W, n, rec, ss) {
  var id = n.id, c = W.calc[id] || pfRow_([], [], 0);
  var tiers = { Military: n.num('Military tier') || 1, Industry: n.num('Industry tier') || 1, Society: n.num('Society tier') || 1, Logistics: n.num('Logistics tier') || 1 };
  var range = 3 + (tiers.Logistics - 1), reachCol = tiers.Logistics >= 4 ? 2 : 1;
  var ctl = {}; W.control.forEach(function (r) { ctl[r.get('Setting')] = r.get('Value'); });
  var mode = ctl['Mode'] || 'Live';
  var add = function (k, v) { rec.Sheet.push([k, v]); };
  add('Jump range', range); add('Jump range with Volatile isotopes', range + 1); add('Colonize within lanes', reachCol);
  add('Mode', mode);
  add('Deadline', mode === 'Sandbox' ? (ctl['Deadline override'] || '') : '');

  // ---- reach
  var adj = {}; W.lanes.forEach(function (l) { var a = l.get('From'), b = l.get('To'); (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); });
  var cs = pfCharted_(W, id), sysBy = {}; W.systems.forEach(function (s) { sysBy[s.get('System ID')] = s; });
  var natName = {}; W.nations.forEach(function (x) { natName[x.id] = x.get('Nation'); });
  var origins = [];
  W.systems.forEach(function (s) { if (s.get('Owner') === id && /capital/i.test(s.get('Designation'))) origins.push([s.get('System ID'), 'Capital']); });
  W.forces.forEach(function (f) {
    if (f.get('Owner') !== id || !f.get('Location')) return;
    var ships = ['Escorts', 'Cruisers', 'Battleships', 'Dreadnoughts', 'Transports'].some(function (k) { return f.num(k) > 0; });
    if (ships) origins.push([f.get('Location'), f.get('Name') || f.get('Force ID')]);
  });
  var best = {};
  origins.forEach(function (o) {
    var dist = {}; dist[o[0]] = 0; var q = [o[0]];
    while (q.length) { var x = q.shift(); if (dist[x] >= range + 1) continue; (adj[x] || []).forEach(function (y) { if (dist[y] == null) { dist[y] = dist[x] + 1; q.push(y); } }); }
    Object.keys(dist).forEach(function (k) { if (!dist[k] || cs.own[k]) return; if (!best[k] || dist[k] < best[k].d) best[k] = { d: dist[k], from: o[1] }; });
  });
  // lanes from the nearest held system, for colonization reach
  var ownDist = {}, q2 = Object.keys(cs.own); q2.forEach(function (k) { ownDist[k] = 0; });
  while (q2.length) { var x2 = q2.shift(); if (ownDist[x2] >= 2) continue; (adj[x2] || []).forEach(function (y) { if (ownDist[y] == null) { ownDist[y] = ownDist[x2] + 1; q2.push(y); } }); }
  var reach = [['System ID', 'Name', 'Nearest', 'Jumps', 'This turn', 'Charted', 'Owner', 'Class', 'Environment', 'Deposits', 'Feature', 'Colonize']];
  Object.keys(best).sort(function (a, b) { return best[a].d - best[b].d || (a < b ? -1 : 1); }).forEach(function (k) {
    var s = sysBy[k]; if (!s) return;
    var ch = !!cs.charted[k], owner = s.get('Owner');
    // Colonization needs no discovery (rules, Colonization): uncharted systems in reach are offered too, without revealing who holds them.
    var col = (!ch || !owner) ? (ownDist[k] != null && ownDist[k] <= reachCol ? 'Direct' : 'Expedition') + (ch ? '' : ' (uncharted)') : '';
    reach.push([k, ch ? s.get('Name') : '', best[k].from, best[k].d, best[k].d <= range ? 'Yes' : 'With isotopes',
      ch ? 'Yes' : 'No', ch && owner ? (natName[owner] || owner) : '', ch ? s.get('Class') : '', ch ? s.get('Environment') : '',
      ch ? s.get('Deposits') : '', ch ? s.get('Feature') : '', col]);
  });
  rec.Reach = reach;

  // ---- price list
  var pct = function (p) { return Math.max(0.5, 1 + p / 100); };
  var r1 = function (x) { return Math.round(x * 10) / 10; };
  var devF = pct(c.num('Development cost %')), shipF = pct(c.num('Fiscal ship cost %')) * (/Military Junta/.test(['Civic 1', 'Civic 2', 'Civic 3', 'Civic 4'].map(function (k) { return n.get(k); }).join(',')) ? 0.75 : 1);
  var techF = c.num('Tech cost multiplier') || 1;
  var P = [['Group', 'Item', 'Industry', 'Energy', 'Research', 'Influence', 'Strategic', 'Requires', 'Unlocked', 'Note']];
  W.systems.filter(function (s) { return s.get('Owner') === id; }).forEach(function (s) {
    var d = s.num('Development'), cap = s.num('Effective Development cap') || s.num('Development cap');
    if (d < cap) P.push(['Development', 'Raise ' + (s.get('Name') || s.get('System ID')) + ' to ' + (d + 1), r1(3 * (d + 1) * devF), '', '', '', '', '', 'Yes', 'One level a turn; cap ' + cap]);
  });
  [['Oceanic', 'Colony cost: Oceanic world'], ['Garden', 'Colony cost: Garden world'], ['Barren, Frozen, Arid, Volcanic or Toxic', 'Colony cost: Barren, Frozen, Arid, Volcanic or Toxic world']].forEach(function (w) {
    var v = c.num(w[1]) || 5;
    P.push(['Colonies', 'Colony on ' + (/^[AEIOU]/.test(w[0]) ? 'an ' : 'a ') + w[0] + ' world', '', v, '', v, '', '', 'Yes', 'Unclaimed, within ' + reachCol + ' lane' + (reachCol > 1 ? 's' : '') + ' of a held system; farther needs an expedition at the same cost']);
  });
  pfBlock_(W.tables, 'Category').forEach(function (r) {
    if (!r['Category'] || r['Category'] === 'Category') return;
    var st = [['Adamant ore', r['Adamant ore']], ['Lattice crystals', r['Lattice crystals']], ['Antimatter', r['Antimatter']]].filter(function (x) { return Number(x[1]) > 0; }).map(function (x) { return x[1] + ' ' + x[0]; }).join('; ');
    P.push(['Ships', r['Category'], r1(Number(r['Industry']) * shipF), '', '', '', st, r['Requires'] || '', pfMeets_(r['Requires'], tiers) ? 'Yes' : 'No', 'Fleet Power ' + r['Fleet Power'] + ', capacity ' + r['Capacity']]);
  });
  PF_GROUND.forEach(function (g) { P.push(['Ground formations', g[0], g[1], '', '', '', g[2], g[3], pfMeets_(g[3], tiers) ? 'Yes' : 'No', 'Wages ' + g[4] + (g[4] === 1 ? ' Mark' : ' Marks') + ' a turn; capacity ' + g[5]]); });
  // hidden buildings this nation has unlocked (Unlocks tab): listed for it alone
  W.unlocks.forEach(function (u) {
    if (u.get('Nation') !== id || !u.get('Building') || u.get('Shown to player') === 'No') return;
    var slot = /orbital/i.test(u.get('Takes a slot')) ? 'takes an orbital slot' : /^n/i.test(u.get('Takes a slot')) ? 'takes no building slot' : 'takes a building slot';
    P.push(['Buildings', u.get('Building'), u.get('Industry'), '', '', '', u.get('Strategic'), u.get('Requires'), pfMeets_(u.get('Requires'), tiers) ? 'Yes' : 'No',
      [u.get('Effect'), slot, u.get('Strain') ? 'Strain ' + u.get('Strain') : '', Number(u.get('Turns')) > 1 ? 'takes ' + u.get('Turns') + ' turns' : ''].filter(String).join('; ')]);
  });
  pfBlock_(W.tables, 'Buildings').forEach(function (r) {
    P.push(['Buildings', r['Building'], r['Industry'], '', '', '', r['Other cost'] || '', r['Requires'] || '', pfMeets_(r['Requires'], tiers) ? 'Yes' : 'No', r['Effect'] || '']);
  });
  var tt = {}; pfBlock_(W.tables, 'Technology tiers').forEach(function (r) { tt[r['Tier']] = r; });
  ['Military', 'Industry', 'Society', 'Logistics'].forEach(function (b) {
    var next = tiers[b] + 1, r = tt[String(next)];
    if (!r) return;
    var su = Number(r['Strategic units']) || 0;
    P.push(['Technology', b + ' Tier ' + next, '', '', r1(Number(r['Research']) * techF), '', su ? su + ' ' + PF_TECH_STRAT[b] : '', '', 'Yes', '']);
  });
  rec.Prices = P;

  // ---- upkeep breakdown
  var U = [['Source', 'Fuel (Energy)', 'Wages (Marks)', 'Other']];
  var fuelT = 0, wageT = 0;
  W.forces.forEach(function (f) {
    if (f.get('Owner') !== id) return;
    var cap = f.num('Capacity');
    if (cap > 0) { var fu = Math.ceil(cap / 4), wa = Math.ceil(cap / 4); fuelT += fu; wageT += wa; U.push([f.get('Name') || f.get('Force ID'), fu, wa, f.num('Dreadnoughts') ? f.num('Dreadnoughts') + ' Volatile isotopes' : '']); }
  });
  var totalE = c.num('Upkeep Energy'), totalI = c.num('Upkeep Influence');
  var rest = r1(totalE + totalI - fuelT - wageT);
  if (rest > 0.05) U.push(['Armies, defences and installations', '', '', rest + ' (wages and power)']);
  rec.Upkeep = U;

  // ---- stability
  var S = [['Component', 'Value']];
  var base = /Collective/.test(n.get('Government')) ? 6 : 4;
  var parts = [['Base', base], ['Fiscal code', c.num('Fiscal Stability')], ['Worlds and environment', c.num('Environment Stability')], ['Renown', c.num('Renown Stability')],
    ['Pariah', c.num('Pariah Stability')], ['Overcrowding', c.num('Overcrowding Stability')]];
  var tgt = n.num('Stability target') || c.num('Stability target'), known = 0;
  parts.forEach(function (p) { known += p[1]; if (p[1] || p[0] === 'Base') S.push(p); });
  if (Math.abs(tgt - known) > 0.05) S.push(['Species, state and other', r1(tgt - known)]);
  S.push(['Target', tgt]);
  rec.Stability = S;

  // ---- order receipt (the latest submission on record)
  var mine = W.inbox.filter(function (r) { return r.get('Nation') === n.get('Nation') && r.get('Submitted'); });
  var last = mine[0];   // the inbox is sorted newest first
  var R = [['Field', 'Value']];
  if (last) ['Submitted', 'Counts for the deadline', 'Identity', 'Routine orders', 'Plan 1', 'Plan 2', 'Plan 3', 'Plan 4', 'Plan 5', 'Other covert orders', 'Questions for the GM']
    .forEach(function (k) { if (last.get(k)) R.push([k, last.get(k)]); });
  rec.Receipt = R;

  // ---- contacts, treaties, debts
  var met = {};
  W.systems.forEach(function (s) { var o = s.get('Owner'); if (o && o !== id && cs.charted[s.get('System ID')]) met[o] = met[o] || 'Neighbouring space'; });
  var T = [['Treaty ID', 'Type', 'With', 'In force from', 'Status', 'Terms']];
  W.treaties.forEach(function (t) {
    var p = [t.get('Party 1'), t.get('Party 2')].concat(String(t.get('Parties')).split(/\s*[,;]\s*/));
    if (p.indexOf(id) < 0 && p.indexOf(n.get('Nation')) < 0) return;
    var other = p.filter(function (x) { return x && x !== id && x !== n.get('Nation'); }).filter(function (x, i, a) { return a.indexOf(x) === i; });
    other.forEach(function (o) { met[o] = 'Treaty'; });
    if (t.get('Status') && !/active|in force/i.test(t.get('Status'))) return;
    T.push([t.get('Treaty ID'), t.get('Type'), other.map(function (o) { return natName[o] || o; }).join(', '), t.get('In force from'), t.get('Status'), t.get('Terms')]);
  });
  rec.Treaties = T;
  var D = [['Debt ID', 'Direction', 'With', 'Outstanding (SM)', 'Instalment (SM)', 'Instalments due', 'Arrears (SM)', 'Status']];
  W.debts.forEach(function (d) {
    var dir = d.get('Debtor') === id ? 'Owed by us' : d.get('Creditor') === id ? 'Owed to us' : '';
    if (!dir || (d.get('Status') && d.get('Status') !== 'Active')) return;
    var o = dir === 'Owed by us' ? d.get('Creditor') : d.get('Debtor'); met[o] = met[o] || 'Debt';
    D.push([d.get('Debt ID'), dir, natName[o] || o, d.get('Outstanding (SM)'), d.get('Instalment (SM)'), d.get('Instalments due'), d.get('Arrears (SM)'), d.get('Status')]);
  });
  rec.Debts = D;
  var C = [['Nation', 'Nation ID', 'Known through']];
  Object.keys(met).forEach(function (o) { if (natName[o]) C.push([natName[o], o, met[o]]); });
  rec.Contacts = C;

  // ---- events: the GM's Events tab, plus public Turn log lines that name this nation
  var E = [['Turn', 'Kind', 'Title', 'Text']];
  var names = function (s) { return String(s || '').split(/\s*[,;]\s*/); };
  W.events.forEach(function (e) {
    if (!e.get('Title') || e.get('Shown to player') === 'No') return;
    var p = names(e.get('Nations'));
    if (p.indexOf(id) < 0 && !/^all$/i.test(e.get('Nations'))) return;
    E.push([e.get('Turn'), e.get('Kind') || 'Notice', e.get('Title'), e.get('Text')]);
  });
  var AUTO = { 'Native world joined': 'Natives', 'Treaty': 'Treaty signed', 'Trade': 'Treaty signed', 'Battle': 'War', 'Ground battle': 'War',
    'Breakaway': 'Revolt', 'Revolt': 'Revolt', 'Succession': 'Succession' };
  W.turnlog.forEach(function (l) {
    var k = AUTO[l.get('Event')];
    if (!k || l.get('Public') !== 'Yes' || names(l.get('Nations')).indexOf(id) < 0) return;
    var TITLE = { 'Native world joined': 'A native world joins', 'Treaty': 'Treaty signed', 'Trade': 'Trade concluded', 'Battle': 'Battle', 'Ground battle': 'Ground battle',
      'Breakaway': 'A world breaks away', 'Revolt': 'Revolt', 'Succession': 'Succession' };
    E.push([l.get('Turn'), k, TITLE[l.get('Event')] || l.get('Event'), pfClean_(l.get('Description'))]);
  });
  E = [E[0]].concat(E.slice(1).sort(function (a, b) { return Number(b[0]) - Number(a[0]); }).slice(0, 120));
  rec.Events = E;

  // ---- recipes this nation holds (never another nation's)
  var RC = [['Recipe', 'Yields', 'Inputs', 'Variant', 'Effect', 'Learned (turn)']];
  W.recipes.forEach(function (r) {
    if (r.get('Nation') !== id || !r.get('Recipe') || r.get('Shown to player') === 'No') return;
    RC.push([r.get('Recipe'), r.get('Yields'), r.get('Inputs'), r.get('Variant'), r.get('Effect'), r.get('Learned (turn)')]);
  });
  rec.Recipes = RC;

  // ---- turn reports: accounts by turn, order outcomes, and the GM's written report
  pfReports_(W, n, rec);

  // ---- the Galactic Exchange: public prices (last ten turns), this nation's treasury and standing orders
  pfExchange_(W, n, rec);

  // ---- history: one line per turn, kept across refreshes
  var H = [['Turn', 'Industry', 'Energy', 'Research', 'Influence', 'Stability', 'Systems held', 'Fleet Power', 'Population (bn)', 'GDP (SM)']];
  var old = ss.getSheetByName('History');
  if (old && old.getLastRow() > 1) old.getRange(2, 1, old.getLastRow() - 1, H[0].length).getDisplayValues().forEach(function (r) { if (r[0] !== '' && Number(r[0]) !== W.turn) H.push(r); });
  H.push([W.turn, n.num('Industry'), n.num('Energy'), n.num('Research'), n.num('Influence'), n.num('Stability'), c.num('Systems held'), c.num('Fleet Power'), c.num('Population (bn)'), c.num('GDP (SM)')]);
  H = [H[0]].concat(H.slice(1).sort(function (a, b) { return Number(a[0]) - Number(b[0]); }).slice(-60));
  rec.History = H;
}


/* ------------------------------------------------------------------ turn reports */

/**
 * Writes three tabs for the nation page's Turn report:
 *  Accounts  - per turn and resource: opening, income, upkeep, spending, other, closing (from the Ledger)
 *  Outcomes  - each order the nation sent, with what became of it (never the GM's working)
 *  Reports   - the GM's player-facing write-up for the turn (the workbook's Reports tab)
 * The full Ledger stays in the workbook; the Statement tab keeps the last ten turns' lines.
 */
function pfReports_(W, n, rec) {
  var id = n.id, KEEP = 10, first = Math.max(0, W.turn - KEEP + 1);
  var mains = PF_MAIN.concat(PF_STRAT, PF_ADV, [PF_MARKS]);
  var lines = W.ledger.filter(function (l) { return l.get('Nation') === id && l.get('Shown to player') !== 'No' && mains.indexOf(l.get('Resource')) >= 0; })
    .sort(function (a, b) { return a.num('Turn') - b.num('Turn') || a.num('Entry') - b.num('Entry'); });
  var bal = {}, acc = {};
  lines.forEach(function (l) {
    var t = l.num('Turn'), k = l.get('Resource'), a = l.num('Amount');
    if (t >= first) {
      var key = t + '|' + k;
      var o = acc[key] || (acc[key] = { t: t, k: k, open: bal[k] || 0, Income: 0, Upkeep: 0, Spending: 0, Other: 0 });
      var ph = l.get('Phase'); o[o.hasOwnProperty(ph) && ph !== 'open' ? ph : 'Other'] += a;
    }
    bal[k] = (bal[k] || 0) + a;
  });
  var A = [['Turn', 'Resource', 'Opening', 'Income', 'Upkeep', 'Spending', 'Other', 'Closing']];
  Object.keys(acc).map(function (k) { return acc[k]; })
    .sort(function (a, b) { return b.t - a.t || mains.indexOf(a.k) - mains.indexOf(b.k); })
    .forEach(function (o) {
      var close = o.open + o.Income + o.Upkeep + o.Spending + o.Other;
      A.push([o.t, o.k, pfRound_(o.open), pfRound_(o.Income), pfRound_(o.Upkeep), pfRound_(o.Spending), pfRound_(o.Other), pfRound_(close)]);
    });
  rec.Accounts = A;

  var said = {};
  W.reports.forEach(function (r) { if (r.get('Nation') === id && r.get('Action row') && r.get('Shown to player') !== 'No') said[r.get('Action row')] = r.get('Heading') || r.get('Text'); });
  var O = [['Turn', 'Row', 'Channel', 'Order', 'Outcome', 'Note']];
  W.actions.filter(function (a) { return a.get('Nation') === id && a.num('Turn') >= first && a.num('Turn') <= W.turn; })
    .sort(function (a, b) { return b.num('Turn') - a.num('Turn') || a.num('Row') - b.num('Row'); })
    .forEach(function (a) {
      var st = a.get('Status'), row = a.get('Row'), flag = pfClean_(a.get('Flag')).replace(/^GM ruling:?\s*/i, '').replace(/[;,]\s*$/, '');
      var out, note;
      if (st === 'Applied') { out = 'Carried out'; note = flag || a.get('Elaboration summary'); }
      else if (st === 'Rejected') { out = 'Refused'; note = flag; }
      else if (st === 'Settled by GM') { out = 'Ruled'; note = said[row] || 'Ruled by the GM: see the report.'; }
      else { out = st || 'Pending'; note = ''; }
      O.push([a.get('Turn'), row, a.get('Channel'), a.get('Posted text'), out, note]);
    });
  rec.Outcomes = O;

  var R = [['Turn', 'Section', 'Action row', 'Heading', 'Text']];
  W.reports.filter(function (r) { return r.get('Nation') === id && r.get('Shown to player') !== 'No' && (r.get('Heading') || r.get('Text')); })
    .sort(function (a, b) { return b.num('Turn') - a.num('Turn') || a.row - b.row; })
    .forEach(function (r) { R.push([r.get('Turn'), r.get('Section') || 'Report', r.get('Action row'), r.get('Heading'), r.get('Text')]); });
  rec.Reports = R;
}


/* ------------------------------------------------------------------ the Galactic Exchange */

var PF_MARKS = 'Stellar Marks';
var PF_BASE = { Industry: 1, Energy: 1, Research: 2, Influence: 1 };

function pfExchange_(W, n, rec) {
  var id = n.id;
  var E = [['Turn', 'Resource', 'Base', 'Price', 'Target', 'Depth', 'Inventory', 'Bought by Exchange', 'Sold by Exchange', 'Trades']];
  var rows = W.exchange.filter(function (r) { return r.get('Resource') && r.num('Turn') > W.turn - 10; });
  if (rows.length) rows.forEach(function (r) { E.push([r.get('Turn'), r.get('Resource'), r.get('Base'), r.get('Price'), r.get('Target'), r.get('Depth'), r.get('Inventory'), r.get('Bought by Exchange'), r.get('Sold by Exchange'), r.get('Trades')]); });
  else PF_MAIN.concat(PF_STRAT).forEach(function (k) {
    var base = PF_BASE[k] || 10, strat = PF_STRAT.indexOf(k) >= 0;
    E.push([W.turn, k, base, base, base, strat ? 5 : 10, 0, 0, 0, 0]);
  });
  rec.Exchange = E;
  var O = [['Order ID', 'Side', 'Resource', 'Remaining', 'Limit', 'Slice', 'Turns left', 'Placed (turn)', 'Status', 'Note']];
  W.exorders.filter(function (r) { return r.get('Nation') === id && (r.get('Status') === 'Open' || r.num('Placed (turn)') > W.turn - 3); })
    .forEach(function (r) { O.push([r.get('Order ID'), r.get('Side'), r.get('Resource'), r.get('Remaining'), r.get('Limit'), r.get('Slice'), r.get('Turns left'), r.get('Placed (turn)'), r.get('Status'), r.get('Note')]); });
  rec['Exchange orders'] = O;
  var marks = 0;
  W.ledger.forEach(function (l) { if (l.get('Nation') === id && l.get('Resource') === PF_MARKS) marks += l.num('Amount'); });
  rec.Stockpiles.push([PF_MARKS, 'Treasury', pfRound_(marks), 0, 0, 0, 0, pfRound_(marks)]);
}
