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
 *   command {command: Prepare|Resolve|Refresh}  -> {ok, ran, status, result}
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
      case 'command': return gwReply_(gwCommand_(req.command));
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
