/**
 * Course of Nations: workbook gateway (Starverse Infinitas).
 *
 * Add this file to the workbook's Apps Script project, beside the existing
 * engine code. Deploy as a web app: Execute as "Me", access "Anyone".
 * Set the Script Property GATEWAY_KEY (Project Settings -> Script Properties)
 * to the same value as the game's gateway key in Cloudflare.
 *
 * Actions (POST, JSON body, always with "key"):
 *   whoami  {discordId}                         -> {ok, nation, nationId}
 *   view    {discordId}                         -> {ok, nation, turn, deadline, tabs}
 *   submit  {discordId, submittedBy, orders}    -> {ok, row}
 *   chart   {}                                  -> {ok, chart, lanes}
 *     The public star chart (as the Standings book's Star Chart and Hyperlanes):
 *     charted systems in full, uncharted ones as position only.
 *   command {command: Prepare|Resolve|Refresh}  -> {ok, ran, status, result}
 *
 * GM's Desk (the Worker allows these to the GM only, except ask/myInquiries):
 *   gmRulings   {}                    -> {ok, turn, rulings:[{row, ref, nation, item, why, suggested, decision, status, action}]}
 *   gmDecide    {row, decision}       -> {ok}   writes Rulings!G (GM decision) for one row of the prepared turn
 *   ask         {discordId, question} -> {ok, id} a player's question, kept on the Inquiries tab
 *   myInquiries {discordId}           -> {ok, inquiries}  that nation's own questions and answers only
 *   gmInquiries {}                    -> {ok, inquiries}  every question, with suggested answers
 *   gmAnswer    {id, answer}          -> {ok}   posts the GM's answer to a question
 *     Writes the command to Control!B3 and runs the engine's pollControl()
 *     at once. Keep the timed poller slow (30 min) so the two never collide.
 *
 * Secrecy: the nation is always looked up from the Discord ID on the Players
 * tab. A caller can never name the nation it wants to see.
 */

var GW = {
  PLAYERS: 'Players',            // A: Discord ID, B: Nation ID, C: Role, D: Note
  NATIONS: 'Nations',
  CONTROL: 'Control',
  FORMS: 'Forms',
  SUBMISSIONS: 'Order submissions',
  COMMANDS: { Prepare: 'Prepare', Resolve: 'Resolve', Refresh: 'Refresh player sheets' }
};

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return gwReply_({ ok: false, error: 'Bad request' });
  }
  var key = PropertiesService.getScriptProperties().getProperty('GATEWAY_KEY');
  if (!key || req.key !== key) return gwReply_({ ok: false, error: 'Refused' });

  try {
    switch (req.action) {
      case 'whoami':  return gwReply_(gwWhoami_(req.discordId));
      case 'view':    return gwReply_(gwView_(req.discordId));
      case 'submit':  return gwReply_(gwSubmit_(req.discordId, req.submittedBy, req.orders, req));
      case 'chart':   return gwReply_(gwChart_());
      case 'command': return gwReply_(gwCommand_(req.command));
      case 'gmRulings':   return gwReply_(gwRulings_());
      case 'gmDecide':    return gwReply_(gwDecide_(req.row, req.decision));
      case 'ask':         return gwReply_(gwAsk_(req.discordId, req.submittedBy, req.question));
      case 'myInquiries': return gwReply_(gwMyInquiries_(req.discordId));
      case 'gmInquiries': return gwReply_(gwInquiries_());
      case 'gmAnswer':    return gwReply_(gwAnswer_(req.id, req.answer));
      default:        return gwReply_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return gwReply_({ ok: false, error: 'Gateway error: ' + err.message });
  }
}

function doGet() {
  return gwReply_({ ok: true, service: 'Course of Nations gateway' });
}

function gwReply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Lookups ----

function gwPlayer_(discordId) {
  if (!discordId) return null;
  var sh = SpreadsheetApp.getActive().getSheetByName(GW.PLAYERS);
  if (!sh) return null;
  var rows = sh.getDataRange().getDisplayValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(discordId)) {
      return { nationId: String(rows[i][1]).trim(), role: String(rows[i][2]).trim() || 'Player' };
    }
  }
  return null;
}

function gwNation_(nationId) {
  var sh = SpreadsheetApp.getActive().getSheetByName(GW.NATIONS);
  var rows = sh.getDataRange().getDisplayValues();
  var head = rows[0];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === nationId) {
      var rec = {};
      head.forEach(function (h, j) { rec[h] = rows[i][j]; });
      return rec;
    }
  }
  return null;
}

function gwTurn_() {
  return SpreadsheetApp.getActive().getSheetByName(GW.CONTROL).getRange('B8').getDisplayValue();
}

function gwDeadline_() {
  var rows = SpreadsheetApp.getActive().getSheetByName(GW.FORMS).getDataRange().getDisplayValues();
  for (var i = 0; i < rows.length; i++) if (rows[i][0] === 'Deadline') return rows[i][1];
  return '';
}

// ---- Actions ----

function gwWhoami_(discordId) {
  var p = gwPlayer_(discordId);
  if (!p) return { ok: true, nation: null };
  var n = gwNation_(p.nationId);
  return { ok: true, nation: n ? n['Nation'] : null, nationId: p.nationId, role: p.role };
}

function gwView_(discordId) {
  var p = gwPlayer_(discordId);
  if (!p) return { ok: false, error: 'Not enrolled in this game' };
  var n = gwNation_(p.nationId);
  if (!n) return { ok: false, error: 'Nation not found' };
  var feedId = n['Private feed'];
  if (!feedId) return { ok: false, error: 'No player record yet' };

  var feed = SpreadsheetApp.openById(feedId);
  var tabs = {};
  feed.getSheets().forEach(function (s) {
    if (s.getLastRow() === 0) return;
    tabs[s.getName()] = s.getDataRange().getDisplayValues();
  });
  tabs['Plans'] = gwPlans_(n);
  return {
    ok: true,
    nation: n['Nation'],
    nationId: p.nationId,
    turn: gwTurn_(),
    deadline: gwDeadline_(),
    tabs: tabs
  };
}

function gwSubmit_(discordId, submittedBy, orders, req) {
  var p = gwPlayer_(discordId);
  if (!p) return { ok: false, error: 'Not enrolled in this game' };
  req = req || {};
  var plans = (req.plans || []).filter(function (x) { return x && String(x.name || '').trim(); }).slice(0, 5);
  orders = orders || [];
  if (!orders.length && !plans.length && !req.covert && !req.questions) return { ok: false, error: 'No orders' };
  var n = gwNation_(p.nationId);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'Busy, try again' };
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(GW.SUBMISSIONS);
    var width = sh.getLastColumn();
    var head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
    var row = new Array(width).fill('');
    // Written by column header, as the order form writes them, so the Orders inbox reads them alike.
    function put(h, v) { var i = head.indexOf(h); if (i >= 0) row[i] = v; }
    put('Timestamp', new Date());
    put('Nation', n['Nation']);
    put('Serial number', n['Order serial']);
    put('Routine orders', orders.map(String).join('\n'));
    put('Are you running a plan this turn?', plans.length ? 'Yes' : 'No');
    plans.forEach(function (pl, i) {
      var k = 'Plan ' + (i + 1) + ': ';
      put(k + 'name', String(pl.name || ''));
      put(k + 'objective', String(pl.objective || ''));
      put(k + 'orders', String(pl.orders || ''));
      put(k + 'covert orders', String(pl.covert || ''));
      put(k + 'supports', String(pl.supports || ''));
    });
    put('Other covert orders', String(req.covert || ''));
    put('Questions for the GM', String(req.questions || ''));
    // Record who sent it in a note on the timestamp cell, out of the way of the inbox.
    sh.appendRow(row);
    var last = sh.getLastRow();
    sh.getRange(last, 1).setNote('Submitted on the Course of Nations site by ' + (submittedBy || discordId));
    return { ok: true, row: last, turn: gwTurn_() };
  } finally {
    lock.releaseLock();
  }
}

function gwCommand_(command) {
  var text = GW.COMMANDS[command];
  if (!text) return { ok: false, error: 'Unknown command' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'Busy, try again' };
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(GW.CONTROL);
    var status = String(sh.getRange('B5').getDisplayValue());
    if (/running|working|in progress/i.test(status)) {
      return { ok: false, error: 'A command is already running: ' + status };
    }
    sh.getRange('B3').setValue(text);
    sh.getRange('B4').setValue(new Date());
    SpreadsheetApp.flush();
    // Run it now through the engine's own Control handler, rather than
    // waiting for the timed poller to notice it.
    if (typeof pollControl === 'function') {
      pollControl();
      SpreadsheetApp.flush();
      return {
        ok: true,
        ran: true,
        command: text,
        status: sh.getRange('B5').getDisplayValue(),
        result: sh.getRange('B6').getDisplayValue()
      };
    }
    return { ok: true, queued: true, command: text };
  } finally {
    lock.releaseLock();
  }
}

/** The public star chart, built from Systems, Nations and Lanes. Only what the
 *  Standings book shows everyone: uncharted systems give their position alone. */
function gwChart_() {
  var ss = SpreadsheetApp.getActive();
  function table(name) {
    var v = ss.getSheetByName(name).getDataRange().getDisplayValues();
    var h = v[0].map(function (x) { return String(x).trim(); });
    return v.slice(1).filter(function (r) { return String(r[0]).trim() !== ''; })
      .map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; });
  }
  var nations = table(GW.NATIONS), byId = {}, slot = {}, byName = {};
  nations.forEach(function (n, i) { byId[n['Nation ID']] = n['Nation']; slot[n['Nation ID']] = i + 1; byName[String(n['Nation']).toLowerCase()] = n['Nation ID']; });
  // A leased system is shown as its lessee's (Owner governs it), with the sovereign in Lessor.
  var head = ['System ID', 'Sector', 'Gateway', 'Core link', 'x', 'y', 'Owner', 'Name', 'Charted', 'Class', 'Type', 'Life',
              'Native era', 'Deposits', 'Feature', 'Environment', 'Colour', 'Owner ID', 'Lessor', 'Lessor colour'];
  var rows = table('Systems').map(function (s) {
    var charted = String(s['Discovered by'] || '').trim() !== '';
    var oid = String(s['Owner'] || '').trim(), status = String(s['Status'] || '');
    var owner = oid ? (byId[oid] || oid) : (/^Independent/i.test(status) ? 'Independent' : '');
    var base = [s['System ID'], s['Sector'], s['Gateway'], s['Core link'], s['x'], s['y']];
    if (!charted) return base.concat(['', '', 'No', '', '', '', '', '', '', '', '', '', '', '']);
    var lraw = String(s['Lessor (sovereign)'] || '').trim(), lid = byId[lraw] ? lraw : (byName[lraw.toLowerCase()] || lraw);
    var leased = oid && lid && lid !== oid;
    return base.concat([owner, s['Name'], 'Yes', s['Class'], s['Type'], s['Life'], s['Native era'], s['Deposits'], s['Feature'],
      s['Environment'], oid ? String(slot[oid] || '') : '', oid, leased ? (byId[lid] || lid) : '', leased ? String(slot[lid] || '') : '']);
  });
  var lanes = table('Lanes').map(function (l) { return [l['From'], l['To'], l['Kind'] || 'lane']; });
  return { ok: true, chart: [head].concat(rows), lanes: [['From', 'To', 'Kind']].concat(lanes) };
}

/** The nation's own plans, from its past submissions: the latest version of each plan by name. */
function gwPlans_(n) {
  var sh = SpreadsheetApp.getActive().getSheetByName(GW.SUBMISSIONS);
  var v = sh.getDataRange().getValues();
  var h = v[0].map(function (x) { return String(x).trim(); });
  function col(name) { return h.indexOf(name); }
  var iT = col('Timestamp'), iN = col('Nation'), iS = col('Serial number'), latest = {};
  v.slice(1).forEach(function (r) {
    if (String(r[iN]).trim() !== n['Nation'] || String(r[iS]).replace(/\s/g, '').toUpperCase() !== String(n['Order serial']).toUpperCase()) return;
    var t = r[iT] instanceof Date ? r[iT] : new Date(r[iT]);
    for (var k = 1; k <= 5; k++) {
      var nm = String(r[col('Plan ' + k + ': name')] || '').trim();
      if (!nm) continue;
      var key = nm.toLowerCase();
      if (latest[key] && latest[key].t >= t) continue;
      latest[key] = { t: t, row: [nm, String(r[col('Plan ' + k + ': objective')] || ''),
        Utilities.formatDate(t, 'Asia/Singapore', 'yyyy-MM-dd HH:mm'),
        String(r[col('Plan ' + k + ': orders')] || ''), String(r[col('Plan ' + k + ': covert orders')] || ''),
        String(r[col('Plan ' + k + ': supports')] || '')] };
    }
  });
  var rows = Object.keys(latest).map(function (k) { return latest[k]; }).sort(function (a, b) { return b.t - a.t; }).map(function (x) { return x.row; });
  return [['Plan', 'Objective', 'Last sent', 'Last orders', 'Last covert orders', 'Last supports']].concat(rows);
}

// ---- GM's Desk: rulings ----

/** The turn being prepared: one past the last resolved turn. */
function gwOpenTurn_() { return (parseInt(gwTurn_(), 10) || 0) + 1; }

function gwTable_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) return { sh: null, head: [], rows: [] };
  var v = sh.getDataRange().getDisplayValues();
  return { sh: sh, head: v[0].map(function (h) { return String(h).trim(); }), rows: v.slice(1) };
}

/** The prepared turn's rulings, each with the order behind it. Numbered R-<turn>-<n> in sheet order. */
function gwRulings_() {
  var turn = gwOpenTurn_();
  var R = gwTable_('Rulings'), A = gwTable_('Actions');
  var ai = function (k) { return A.head.indexOf(k); };
  var byRow = {};
  A.rows.forEach(function (r) { byRow[String(r[ai('Row')])] = r; });
  var ri = function (k) { return R.head.indexOf(k); };
  var out = [], n = 0;
  R.rows.forEach(function (r, i) {
    if (String(r[ri('Turn')]) !== String(turn) || !String(r[ri('Item')]).trim()) return;
    n++;
    var src = String(r[ri('Source')] || ''), m = src.match(/Actions row (\d+)/), a = m ? byRow[m[1]] : null;
    out.push({
      row: i + 2, ref: 'R-' + turn + '-' + n, nation: r[ri('Nation')], source: src, item: r[ri('Item')],
      why: r[ri('Why it needs a ruling')], suggested: r[ri('Suggested ruling')], decision: r[ri('GM decision')], status: r[ri('Status')],
      action: a ? { channel: a[ai('Channel')], text: a[ai('Posted text')], verb: a[ai('Verb')], details: a[ai('Details')], flag: a[ai('Flag')],
        status: a[ai('Status')], cost: ['Industry', 'Energy', 'Research', 'Influence', 'Strategic'].map(function (k) { return a[ai(k)] ? a[ai(k)] + ' ' + k : ''; }).filter(String).join(', ') } : null
    });
  });
  return { ok: true, turn: turn, rulings: out };
}

/** Writes the GM's decision for one ruling of the prepared turn; refuses other turns' rows. */
function gwDecide_(row, decision) {
  row = parseInt(row, 10);
  var R = gwTable_('Rulings');
  if (!R.sh || !(row >= 2) || row > R.rows.length + 1) return { ok: false, error: 'No such ruling' };
  var r = R.rows[row - 2];
  if (String(r[R.head.indexOf('Turn')]) !== String(gwOpenTurn_())) return { ok: false, error: 'That ruling is not for the turn being prepared' };
  if (String(r[R.head.indexOf('Status')]).trim() === 'Settled') return { ok: false, error: 'Already settled at Resolve' };
  R.sh.getRange(row, R.head.indexOf('GM decision') + 1).setValue(String(decision || '').slice(0, 5000));
  return { ok: true };
}

// ---- GM's Desk: inquiries ----

var GW_INQ_HEAD = ['ID', 'Submitted', 'Turn', 'Nation', 'Asked by', 'Question', 'Suggested answer', 'Answer', 'Status', 'Answered'];

function gwInqSheet_() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName('Inquiries');
  if (!sh) { sh = ss.insertSheet('Inquiries'); sh.getRange(1, 1, 1, GW_INQ_HEAD.length).setValues([GW_INQ_HEAD]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}

function gwAsk_(discordId, askedBy, question) {
  var p = gwPlayer_(discordId);
  if (!p) return { ok: false, error: 'Not enrolled in this game' };
  question = String(question || '').trim().slice(0, 4000);
  if (!question) return { ok: false, error: 'No question' };
  var n = gwNation_(p.nationId);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'Busy, try again' };
  try {
    var sh = gwInqSheet_(), id = 'Q-' + sh.getLastRow();
    sh.appendRow([id, new Date(), gwOpenTurn_(), n ? n['Nation'] : p.nationId, askedBy || discordId, question, '', '', 'Open', '']);
    return { ok: true, id: id };
  } finally { lock.releaseLock(); }
}

function gwInqRows_() {
  var v = gwInqSheet_().getDataRange().getDisplayValues(), h = v[0];
  return v.slice(1).filter(function (r) { return String(r[0]).trim(); }).map(function (r) { var o = {}; h.forEach(function (k, j) { o[k] = r[j]; }); return o; });
}

/** A player sees only their own nation's questions and the GM's answers, never suggested answers. */
function gwMyInquiries_(discordId) {
  var p = gwPlayer_(discordId);
  if (!p) return { ok: false, error: 'Not enrolled in this game' };
  var n = gwNation_(p.nationId), name = n ? n['Nation'] : p.nationId;
  var list = gwInqRows_().filter(function (o) { return o['Nation'] === name; }).map(function (o) {
    return { id: o['ID'], submitted: o['Submitted'], turn: o['Turn'], question: o['Question'], answer: o['Answer'], status: o['Status'], answered: o['Answered'] };
  }).reverse();
  return { ok: true, inquiries: list };
}

function gwInquiries_() { return { ok: true, inquiries: gwInqRows_().reverse() }; }

function gwAnswer_(id, answer) {
  answer = String(answer || '').trim().slice(0, 6000);
  if (!answer) return { ok: false, error: 'No answer' };
  var sh = gwInqSheet_(), v = sh.getDataRange().getDisplayValues();
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] === id) {
      sh.getRange(i + 1, 8, 1, 3).setValues([[answer, 'Answered', new Date()]]);
      return { ok: true };
    }
  }
  return { ok: false, error: 'No such question' };
}
