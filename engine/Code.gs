/**
 * Starverse Infinitas · private feeds
 *
 * Each nation gets a small spreadsheet of its own, readable only by whoever holds its link.
 * The star map reads it when opened through that nation's private map link, and shows the
 * nation's own systems world by world.
 *
 * Run once, from the master workbook (Extensions → Apps Script):
 *   1. setupFeeds()     creates a feed for every nation that has none, and writes its link
 *                       to Nations BA (feed) and BB (private map link)
 *   2. installTrigger() every hour from then on, gives any newly registered nation its feed
 *                       and refreshes every feed, with no further action needed
 * Run setupFeeds() by hand whenever you want it done at once (e.g. after a turn or a new registration).
 */
var SITE = 'https://morifinweundome.github.io/Starverse-Infinitas/';
var FEED_FOLDER_ID = '1blvHnwAMiM7OGsOc0-eoHAZ3FpmF454C';   // feeds are filed here; each is shared on its own
var FEED_COL = 53, LINK_COL = 54;                       // Nations BA, BB
var FEED_MASTER = '19rSS34i3DaqVRJGxT9O4gFmILYCP8HHX_TAWcuMtK-k';
function book_() { return SpreadsheetApp.getActive() || SpreadsheetApp.openById(FEED_MASTER); }
var HEAD = ['System ID', 'System', 'World', 'Orbit', 'Kind', 'Environment', 'Habitable', 'Settled',
            'Population (bn)', 'Buildings here', 'Industry', 'Energy', 'Research', 'Influence', 'Description'];

function nations_() {
  var sh = book_().getSheetByName('Nations');
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, LINK_COL).getValues();
  return v.map(function (r, i) { return { row: i + 2, id: String(r[0]).trim(), name: String(r[1]).trim(), feed: String(r[FEED_COL - 1]).trim() }; })
          .filter(function (n) { return n.id && n.name; });
}

function setupFeeds() {
  var sh = book_().getSheetByName('Nations');
  var folder = null; try { folder = DriveApp.getFolderById(FEED_FOLDER_ID); } catch (e) {}
  nations_().forEach(function (n) {
    if (n.feed) return;
    var ss = SpreadsheetApp.create('Starverse Infinitas · ' + n.name + ' · private record');
    var f = DriveApp.getFileById(ss.getId());
    if (folder) f.moveTo(folder);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    ss.getSheets()[0].setName('Worlds');
    sh.getRange(n.row, FEED_COL).setValue(ss.getId());
    sh.getRange(n.row, LINK_COL).setValue(SITE + '?feed=' + ss.getId() + '#map');
  });
  pushFeeds();
}

function pushFeeds() {
  var book = book_();
  var sys = book.getSheetByName('Systems').getDataRange().getValues(), sh = sys.shift();
  var iId = sh.indexOf('System ID'), iName = sh.indexOf('Name');
  var sysName = {}; sys.forEach(function (r) { sysName[r[iId]] = r[iName]; });
  var w = book.getSheetByName('Worlds').getDataRange().getValues(), wh = w.shift();
  var col = function (k) { return wh.indexOf(k); };
  nations_().forEach(function (n) {
    if (!n.feed) return;
    var rows = w.filter(function (r) { return String(r[col('Owner')]).trim() === n.id && r[col('World')] !== ''; })
      .sort(function (a, b) { return a[col('System ID')] < b[col('System ID')] ? -1 : a[col('System ID')] > b[col('System ID')] ? 1 : a[col('Orbit')] - b[col('Orbit')]; })
      .map(function (r) {
        return [r[col('System ID')], sysName[r[col('System ID')]] || '', r[col('World')], r[col('Orbit')], r[col('Kind')], r[col('Environment')],
                r[col('Habitable')], r[col('Settled')], r[col('Population (bn)')], r[col('Buildings here')],
                r[col('Industry')], r[col('Energy')], r[col('Research')], r[col('Influence')], r[col('Description')]];
      });
    var out;
    try { out = SpreadsheetApp.openById(n.feed).getSheetByName('Worlds'); } catch (e) { return; }
    out.clearContents();
    out.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    if (rows.length) out.getRange(2, 1, rows.length, HEAD.length).setValues(rows);
  });
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (['pushFeeds', 'setupFeeds'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('setupFeeds').timeBased().everyHours(1).create();
}
