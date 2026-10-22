/**
 * STARVERSE INFINITAS: TURN PROCESSOR
 * ===================================
 * Paste this whole file into Extensions > Apps Script of the master workbook,
 * save, run setup() once and authorise. See INSTALL.md for the steps.
 *
 * WHAT IT DOES
 *   prepareTurn()  Sunday 18:05 SGT. Reads the Orders inbox, keeps each nation's
 *                  last submission that counts for the deadline, writes one Actions
 *                  row per order line, prices every order the rules settle, checks
 *                  legality and affordability in the order written, and lists on the
 *                  "Rulings" tab everything the GM must decide.
 *   resolveTurn()  Monday 10:00 SGT. Refuses to run until every Rulings row for the
 *                  turn has a GM decision or reads Settled. Then saves a snapshot copy,
 *                  and resolves Diplomacy, Income, Upkeep, Spending, Movement,
 *                  Population, World toll, Infamy decay and Stability, in that order.
 *   Dry run        Everything goes to the "Preview" tab; no game tab is touched.
 *   Control tab    A remote switch: write a Command (Prepare / Resolve / Prepare and
 *                  resolve / Dry run) and the one-minute poller runs it.
 *
 * GM DECISIONS ON THE RULINGS TAB
 *   Write in "GM decision":
 *     Approve ...  the order is carried out as priced on its Actions row (edit the
 *                  Actions cost columns first if you want a different price).
 *     Reject ...   the order is not carried out.
 *     anything else  recorded as settled; nothing is applied automatically, so apply
 *                  it by hand (a battle, a covert roll, a contact roll, an answer).
 *   For a "Stability during war" row, "Hold" stops recovery, "Fall" takes 1 point,
 *   "Approve" or "Normal" moves one point toward the target as usual.
 *   Or set Status to "Settled" yourself.
 *
 * WHERE THE RULES AND THE SHEET DISAGREE (the script follows the sheet, as asked)
 *   1. Upkeep. Rules: fuel 1 Energy per 4 ship capacity (rounded up) plus wages
 *      1 Mark per 4 capacity, paid in any mix, largest stockpiles first; ground wages
 *      per formation (Infantry 0.25 ...); Static Defence 1 Mark per 4 points;
 *      installations as listed. The worked first turn pays 2 Energy fuel and 3 Marks
 *      wages from Industry. Calculations!X instead charges ROUNDUP(capacity/2) +
 *      ROUNDUP(Ground Power/4), all as Energy, with no Static Defence or installation
 *      wages. The script charges Calculations!X to Energy.
 *   2. Ground formations. Forces records one "Ground Power" number per row, not
 *      formations. New formations add their defence value to Ground Power and are
 *      listed in the Note column; Army Capacity is checked against Ground Power.
 *   3. Buildings missing from Tables (T_BUILD): Military College, Habitat Station,
 *      Arcology, the major installations and the signature works. Their costs and
 *      requirements are taken from the rules (RULE_BUILDINGS below).
 *   4. Ship cost. Calculations has no ship-cost column. The script uses
 *      Calculations "Fiscal ship cost %" plus Military Junta -25%, floored at -50%.
 *   5. Systems "Change this turn" (AQ) does not include the +0.5 Degradation an
 *      overcrowded world gains; the script adds it.
 *   6. Ground formation and Development costs: the rules say every cost is a whole
 *      number but not how to round; the script rounds half up, as the colony-cost
 *      formulas in Calculations do.
 *   7. Ideology shifts and civic replacements: Collectivist "costs double",
 *      Dictatorial "-25%", Oligarchic "-25%", Secular "half", Necrophage "half as
 *      much again". The rules do not say whether these touch the Stability part of
 *      the cost. With COST_MULTIPLIERS_NEED_RULING = true such orders go to Rulings
 *      with a suggested price (multiplier on Influence only).
 *   8. Filling an empty civic slot has no cost in the rules: always a ruling.
 *   9. Debt instalments are paid from Industry, Energy and Influence, largest first
 *      (the rules allow any resource; the sheet prices them all at 1 Mark).
 *  10. Population: migration between worlds (3% of crowded worlds) and between
 *      nations is not automated; growth uses Systems "Growth due" as it stood at
 *      the start of the resolution, so a colony founded this turn does not grow yet.
 *  11. In a dry run, Calculations cannot recalculate, so the Stability step uses the
 *      targets as they stood at the start of the run.
 *
 * NOTHING HERE WRITES TO A FORMULA CELL. Each tab's writable columns are listed in
 * TURN_CONFIG.WRITABLE, by header text, following the README.
 */

// =====================================================================
// CONFIGURATION
// =====================================================================
var TURN_CONFIG = {
  TIMEZONE: 'Asia/Singapore',
  SGT_OFFSET_HOURS: 8,                 // Singapore keeps UTC+8 all year
  DRY_RUN_DEFAULT: true,               // used when the Control tab's Dry run cell is blank
  DEADLINE_OVERRIDE: '',               // leave blank; to prepare an earlier week type e.g. '2026-10-25 18:00' (SGT)
  COST_MULTIPLIERS_NEED_RULING: true,  // see note 7 above
  SNAPSHOT_PREFIX: 'Snapshot T',

  SHEETS: {
    nations: 'Nations', civic: 'Civic', systems: 'Systems', worlds: 'Worlds', lanes: 'Lanes',
    forces: 'Forces', treaties: 'Treaties', debts: 'Debts', actions: 'Actions', ledger: 'Ledger',
    calc: 'Calculations', turnlog: 'Turn log', inbox: 'Orders inbox', wars: 'Wars',
    rulings: 'Rulings', runlog: 'Run log', preview: 'Preview', works: 'Works in progress',
    control: 'Control'
  },

  // Tabs the script creates when missing, with their headers.
  NEW_TABS: {
    'Rulings': ['Turn', 'Nation', 'Source', 'Item', 'Why it needs a ruling', 'Suggested ruling', 'GM decision', 'Status'],
    'Run log': ['Time', 'Function', 'Mode', 'Turn', 'Result', 'Detail'],
    'Preview': ['Run at', 'Tab', 'Row', 'Column', 'Before', 'After', 'Note'],
    'Works in progress': ['Turn ordered', 'Nation', 'Kind', 'Item', 'System', 'Completes at end of turn', 'Action row', 'Status']
  },

  // Columns the script may write, by header text. '*' = any column.
  WRITABLE: {
    'Ledger': ['Turn', 'Phase', 'Nation', 'Resource', 'Amount', 'Reason', 'Working', 'Action row', 'Shown to player'],
    'Actions': ['Turn', 'Nation', 'Channel', 'Posted text', 'Verb', 'Details', 'Industry', 'Energy', 'Research', 'Influence',
                'Strategic', 'Status', 'Flag', 'GM ruling', 'Elaboration summary', 'Ledger lines'],
    'Systems': ['Owner', 'Name', 'Development', 'Designation', 'Buildings', 'Discovered by'],
    'Worlds': ['System ID', 'World', 'Orbit', 'Kind', 'Environment', 'Habitable', 'Settled', 'Population (bn)', 'Buildings here', 'Description'],
    'Forces': ['Force ID', 'Owner', 'Name', 'Location', 'Escorts', 'Cruisers', 'Battleships', 'Dreadnoughts', 'Transports',
               'Ground Power', 'Static Defence', 'Note'],
    'Nations': ['Status', 'Government', 'Order–Liberty', 'Sacred–Secular', 'Martial–Pacific', 'Outward–Inward',
                'Civic 1', 'Civic 2', 'Civic 3', 'Civic 4', 'Military tier', 'Industry tier', 'Society tier', 'Logistics tier'],
    'Turn log': '*', 'Rulings': '*', 'Run log': '*', 'Works in progress': '*', 'Control': '*', 'Preview': '*'
  },

  RESOURCES: ['Industry', 'Energy', 'Research', 'Influence'],
  STRATEGIC: ['Adamant ore', 'Lattice crystals', 'Antimatter', 'Volatile isotopes', 'Living compounds', 'Void matter'],
  NET_INCOME_HEADERS: { Industry: 'Net Industry', Energy: 'Net Energy', Research: 'Net Research', Influence: 'Net Influence' },
  GROSS_HEADERS: { Industry: 'Gross Industry', Energy: 'Gross Energy', Research: 'Gross Research', Influence: 'Gross Influence' },
  PCT_HEADERS: { Industry: 'Industry %', Energy: 'Energy %', Research: 'Research %', Influence: 'Influence %' },
  FISCAL_PCT_HEADERS: { Industry: 'Fiscal Industry %', Energy: 'Fiscal Energy %', Research: 'Fiscal Research %', Influence: 'Fiscal Influence %' },

  VERBS: ['DEVELOP', 'DESIGNATE', 'BUILD', 'SHIP', 'GROUND', 'DEFENCE', 'RESEARCH', 'COLONIZE', 'CONTACT', 'MOVE',
          'SHIFT', 'CIVIC', 'REFORM', 'TRANSFER', 'STABILITY', 'FATE', 'BURN', 'BREAK'],
  VERB_ALIASES: { DEFENSE: 'DEFENCE', COLONISE: 'COLONIZE' },

  // Rules: Development to level N costs 3 x N Industry.
  DEVELOPMENT_COST_PER_LEVEL: 3,
  // Rules: colonization needs Stability above Unrest (4 or more).
  UNREST_AT_OR_BELOW: 3,
  COLONY_SETTLERS_BN: 0.3,
  BASE_JUMP_RANGE: 3,
  STABILITY_PURCHASE_INFLUENCE: 5,
  SHIFT_COST: { Influence: 15, Stability: 1 },
  CIVIC_REPLACE_COST: { Influence: 20, Stability: 1 },
  REFORM_COST: { Influence: 30, Stability: 2 },
  STATIC_DEFENCE_INDUSTRY_PER_POINT: 2,
  STATIC_DEFENCE_MILITARY_TIER: 3,
  STATIC_DEFENCE_POINTS_PER_DEVELOPMENT: 2,
  TECH_BRANCH_RESOURCE: { Military: 'Antimatter', Industry: 'Lattice crystals', Society: 'Lattice crystals', Logistics: 'Volatile isotopes' },
  TECH_BRANCH_COLUMN: { Military: 'Military tier', Industry: 'Industry tier', Society: 'Society tier', Logistics: 'Logistics tier' },
  SHIP_COLUMNS: { Escort: 'Escorts', Cruiser: 'Cruisers', Battleship: 'Battleships', Dreadnought: 'Dreadnoughts', Transport: 'Transports' },
  SHIP_TURNS: { Dreadnought: 2 },
  MILITARY_JUNTA_SHIP_PCT: -25,
  COST_FLOOR_PCT: -50,

  // Ground formations (rules, Ground Formations table).
  FORMATIONS: {
    'Infantry':             { attack: 1,   defence: 1,   capacity: 1, industry: 2,  strat: {},                                         military: 1, turns: 1 },
    'Specialised Infantry': { attack: 1.5, defence: 1.5, capacity: 1, industry: 4,  strat: {},                                         military: 2, turns: 1, needsEnvironment: true },
    'Armour':               { attack: 3,   defence: 2,   capacity: 2, industry: 7,  strat: { 'Adamant ore': 1 },                       military: 2, turns: 1 },
    'Heavy Armour':         { attack: 6,   defence: 4,   capacity: 4, industry: 16, strat: { 'Adamant ore': 2, 'Lattice crystals': 1 }, military: 4, turns: 2 },
    'Artillery':            { attack: 1,   defence: 3,   capacity: 2, industry: 5,  strat: {},                                         military: 2, turns: 1 },
    'Heavy Artillery':      { attack: 2,   defence: 5,   capacity: 4, industry: 14, strat: { 'Adamant ore': 1, 'Antimatter': 1 },      military: 4, turns: 2 },
    'Special Forces':       { attack: 1.5, defence: 1,   capacity: 1, industry: 6,  strat: {},                                         military: 3, turns: 1, needsCollege: true }
  },

  // Buildings the rules list that Tables!T_BUILD does not. T_BUILD wins where both exist.
  RULE_BUILDINGS: {
    'Military College':       { industry: 15, strat: {}, req: { military: 2 }, turns: 2, slot: true },
    'Habitat Station':        { industry: 12, strat: {}, req: { society: 2 }, turns: 1, slot: true },
    'Arcology':               { industry: 20, strat: { 'Lattice crystals': 1 }, req: { industry: 4, development: 3 }, turns: 2, slot: true },
    'Planetary Shield':       { industry: 20, strat: { 'Lattice crystals': 2 }, req: { military: 4 }, turns: 2, slot: true, installation: true },
    'Orbital Fortress':       { industry: 25, strat: { 'Adamant ore': 2 }, req: { military: 3 }, turns: 2, slot: true, installation: true },
    'Gravity Well Generator': { industry: 20, strat: { 'Antimatter': 2, 'Lattice crystals': 1 }, req: { logistics: 4 }, turns: 2, slot: true, installation: true }
  },
  TWO_TURN_BUILDINGS: ['Military College', 'Arcology', 'Planetary Shield', 'Orbital Fortress', 'Gravity Well Generator'],
  // Signature works (rules, Partnerships): need the habitat's expertise.
  SIGNATURE_WORKS: {
    'Core Tap':        { industry: 20, expertise: 'Subterranean', notOceanic: true, minDevelopment: 2 },
    'Deep Bastion':    { industry: 15, expertise: 'Subterranean' },
    'Underway':        { industry: 15, expertise: 'Subterranean', notOceanic: true },
    'Abyssal Forge':   { industry: 20, expertise: 'Aquatic', oceanicOnly: true },
    'Sea-City':        { industry: 20, expertise: 'Aquatic', oceanicOnly: true },
    'Brine Refinery':  { industry: 15, expertise: 'Aquatic', oceanicOnly: true }
  },
  MEGAPROJECTS: ['Dyson Swarm', 'Grand Archive', 'Concord Spire', 'Gateway', 'Citadel World', 'Orbital Ring'],

  // Contact strategies (rules, Contact Strategies). Cost is charged only when the GM approves.
  CONTACT_COSTS: {
    'Observe': {}, 'Divine Mandate': { Influence: 10 }, 'Patronage': { Industry: 10, Influence: 10 },
    'Guided Ascent': { Influence: 3 }, 'Federation': { Influence: 20 }
  },
  UPLIFT_COST_BY_ERA: { Hearth: 10, Foundation: 15, Dominion: 20, Engine: 25, Threshold: 30 },

  GOVERNMENTS: ['Democratic', 'Oligarchic', 'Dictatorial', 'Imperial', 'Collective'],
  AXES: [
    { col: 'Order–Liberty', poles: ['Order', 'Liberty'] },
    { col: 'Sacred–Secular', poles: ['Sacred', 'Secular'] },
    { col: 'Martial–Pacific', poles: ['Martial', 'Pacific'] },
    { col: 'Outward–Inward', poles: ['Outward', 'Inward'] }
  ],
  // Civic requirements (rules, Civics table).
  CIVICS: {
    'Constitutional Charter': { notGov: 'Democratic' },
    'Theocracy': { pole: 'Sacred' }, 'Enlightened Creed': { pole: 'Sacred' }, 'Technocracy': { pole: 'Secular' },
    'Military Junta': { pole: 'Martial' }, 'Realpolitik Doctrine': { neutralAxis: 'Outward–Inward' },
    'Planned Economy': {}, 'Free Market': {}, 'Merchant Guilds': {}, 'Work Ethic': {}, 'Warrior Culture': {},
    'Citizen Militia': {}, 'Espionage Directorate': {}, 'Federal Charter': {},
    'Psionic Tradition': { trait: 'Psionic-Latent', organic: true },
    'Synthetic Directive': { biology: ['Synthetic', 'Cybernetic'] },
    'Civil Religion': { neutralAxis: 'Sacred–Secular' },
    'Song of the Stone': { habitat: 'Subterranean' }
  },
  CIVIC_COLUMNS: ['Civic 1', 'Civic 2', 'Civic 3', 'Civic 4'],

  // Control tab labels (column A) and defaults (column B).
  CONTROL_ROWS: [
    ['Mode', 'Sandbox', 'Live: the Sunday and Monday triggers run. Sandbox: only commands written here run.'],
    ['Command', '', 'Blank, Prepare, Resolve, Prepare and resolve, Dry run, or Refresh player sheets. Cleared when the run ends.'],
    ['Requested at', '', 'Optional: when the command was written.'],
    ['Status', 'Idle', 'Idle, Running, Done or Failed.'],
    ['Last result', '', 'One-line summary of the last run.'],
    ['Last run at', '', ''],
    ['Current turn', '', 'The highest turn in the Turn log.'],
    ['Dry run', 'Yes', 'Yes: Prepare and Resolve write to the Preview tab only. No: they write to the game tabs.'],
    ['Deadline override', '', 'Optional, Sandbox use: the deadline the next Prepare reads, e.g. 2026-11-01 18:00 (SGT). Blank in Live play.'],
    ['Snapshots', 'Yes', 'Yes: Resolve saves a Snapshot copy first. No: skip it (Sandbox).'],
    ['Sandbox orders since', '', 'Sandbox only: submissions after this time count for the next Prepare, whatever their real deadline. Written by each Prepare.']
  ]
};

// =====================================================================
// MENU, SETUP, TRIGGERS
// =====================================================================
function starverseTurnMenu() {
  SpreadsheetApp.getUi().createMenu('Starverse')
    .addItem('Prepare turn', 'menuPrepare')
    .addItem('Resolve turn', 'menuResolve')
    .addItem('Dry run (prepare and resolve to Preview)', 'menuDryRun')
    .addSeparator()
    .addItem('Run setup (menu, triggers, Control tab)', 'setup')
    .addToUi();
}

/** Run once after pasting. Creates the Control tab and installs the triggers. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  tpEnsureControlTab_(ss);
  Object.keys(TURN_CONFIG.NEW_TABS).forEach(function (name) {
    if (name !== 'Preview') tpEnsureTab_(ss, name, TURN_CONFIG.NEW_TABS[name]);
  });
  // The poller always runs; the weekly triggers follow the Control tab's Mode.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollControl') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pollControl').timeBased().everyMinutes(1).create();
  tpSyncWeeklyTriggers_(ss);
  tpSetControl_(ss, 'Current turn', tpCurrentTurn_(ss));
  // The menu is added by an installable open trigger, so it can sit beside other scripts in this project.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'starverseTurnMenu') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('starverseTurnMenu').forSpreadsheet(ss).onOpen().create();
  try { starverseTurnMenu(); } catch (e) { /* no UI when run from a trigger */ }
  tpLogRun_(ss, 'setup', '', '', 'Done', 'Mode ' + tpGetControl_(ss, 'Mode') + '; poller installed');
}

/** Installs the Sunday/Monday triggers in Live mode and removes them in Sandbox mode. */
function tpSyncWeeklyTriggers_(ss) {
  var live = String(tpGetControl_(ss, 'Mode') || '').trim().toLowerCase() === 'live';
  var handlers = ['scheduledPrepare', 'scheduledResolve'];
  var existing = ScriptApp.getProjectTriggers().filter(function (t) { return handlers.indexOf(t.getHandlerFunction()) >= 0; });
  if (live && existing.length >= 2) return;
  if (!live && existing.length === 0) return;
  existing.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  if (!live) return;
  ScriptApp.newTrigger('scheduledPrepare').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(18).nearMinute(5).inTimezone(TURN_CONFIG.TIMEZONE).create();
  ScriptApp.newTrigger('scheduledResolve').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(10).nearMinute(0).inTimezone(TURN_CONFIG.TIMEZONE).create();
}

/** Weekly trigger, Sunday. Time triggers fire within about 15 minutes of the hour set,
 *  so if it fires before 18:05 SGT it re-schedules itself for 18:05 exactly. */
function scheduledPrepare() {
  var target = tpSgtToday_(18, 5);
  if (tpNow_() < target) { ScriptApp.newTrigger('scheduledPrepare').timeBased().at(target).create(); return; }
  tpRunCommand_('Prepare', 'Sunday trigger');
}
/** Weekly trigger, Monday. Waits for 10:00 SGT the same way. */
function scheduledResolve() {
  var target = tpSgtToday_(10, 0);
  if (tpNow_() < target) { ScriptApp.newTrigger('scheduledResolve').timeBased().at(target).create(); return; }
  tpRunCommand_('Resolve', 'Monday trigger');
}

function menuPrepare() { tpRunCommand_('Prepare', 'Menu'); }
function menuResolve() { tpRunCommand_('Resolve', 'Menu'); }
function menuDryRun() { tpRunCommand_('Dry run', 'Menu'); }

/** Public entry points (also usable from the Apps Script editor). */
function prepareTurn() { return tpRunCommand_('Prepare', 'Editor'); }
function resolveTurn() { return tpRunCommand_('Resolve', 'Editor'); }
function dryRun() { return tpRunCommand_('Dry run', 'Editor'); }

/**
 * Runs every minute. If the Control tab holds a Command and nothing is running,
 * runs it once, writes Done or Failed with a one-line result, and clears Command.
 */
function pollControl() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    tpEnsureControlTab_(ss);
    tpSyncWeeklyTriggers_(ss);
    var cmd = String(tpGetControl_(ss, 'Command') || '').trim();
    if (!cmd) return;
    var status = String(tpGetControl_(ss, 'Status') || '').trim();
    if (status === 'Running') {
      // A run that died without finishing leaves Running behind; release it after 30 minutes.
      var since = tpGetControl_(ss, 'Last run at');
      if (since instanceof Date && tpNow_() - since > 30 * 60000) {
        tpSetControl_(ss, 'Status', 'Failed');
        tpSetControl_(ss, 'Last result', 'Previous run did not finish; reset after 30 minutes');
      }
      return;
    }
    tpExecuteControlCommand_(ss, cmd, 'Control tab');
  } finally {
    lock.releaseLock();
  }
}

/** Runs a command under the script lock (menu, editor and weekly triggers). */
function tpRunCommand_(cmd, source) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another run is in progress.');
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    tpEnsureControlTab_(ss);
    return tpExecuteControlCommand_(ss, cmd, source);
  } finally {
    lock.releaseLock();
  }
}

function tpExecuteControlCommand_(ss, cmd, source) {
  var known = { 'prepare': 'Prepare', 'resolve': 'Resolve', 'prepare and resolve': 'Prepare and resolve', 'dry run': 'Dry run', 'refresh player sheets': 'Refresh player sheets' };
  var key = known[cmd.toLowerCase()];
  tpSetControl_(ss, 'Status', 'Running');
  tpSetControl_(ss, 'Last run at', tpNow_());
  if (source === 'Control tab') tpSetControl_(ss, 'Command', '');
  tpFlush_();
  var result;
  try {
    if (!key) throw new Error('Unknown command "' + cmd + '"');
    var dryCell = String(tpGetControl_(ss, 'Dry run') || '').trim().toLowerCase();
    var dry = dryCell ? (dryCell === 'yes' || dryCell === 'true') : TURN_CONFIG.DRY_RUN_DEFAULT;
    var parts = [];
    if (key === 'Refresh player sheets') {
      if (typeof pfRefresh !== 'function') throw new Error('The PlayerSheets script is not in this project.');
      var n = pfRefresh();
      result = { ok: true, summary: 'Player sheets refreshed' + (n ? ' (' + n + ')' : '') };
    } else if (key === 'Dry run') {
      var r0 = tpDoResolve_(ss, { dry: true, source: source });
      parts.push(r0.summary);
      result = { ok: r0.ok, summary: parts.join(' | ') };
    } else {
      var ok = true;
      if (key === 'Prepare' || key === 'Prepare and resolve') {
        var r1 = tpDoPrepare_(ss, { dry: dry, source: source });
        parts.push(r1.summary); ok = ok && r1.ok;
      }
      if (ok && (key === 'Resolve' || key === 'Prepare and resolve')) {
        var r2 = tpDoResolve_(ss, { dry: dry, source: source });
        parts.push(r2.summary); ok = ok && r2.ok;
      }
      result = { ok: ok, summary: parts.join(' | ') };
      // Player interfaces: refresh every nation's private record once the game tabs have changed.
      if (!dry && typeof pfRefresh === 'function') {
        try { pfRefresh(); } catch (pe) { tpLogRun_(ss, 'pfRefresh', 'Live', '', 'Failed', String(pe && pe.stack ? pe.stack : pe)); }
      }
    }
  } catch (e) {
    result = { ok: false, summary: 'Error: ' + (e && e.message ? e.message : e) };
    tpLogRun_(ss, cmd, '', '', 'Failed', String(e && e.stack ? e.stack : e));
  }
  tpSetControl_(ss, 'Status', result.ok ? 'Done' : 'Failed');
  tpSetControl_(ss, 'Last result', result.summary);
  tpSetControl_(ss, 'Last run at', tpNow_());
  tpSetControl_(ss, 'Current turn', tpCurrentTurn_(ss));
  tpFlush_();
  return result;
}

// =====================================================================
// PREPARE
// =====================================================================
function tpDoPrepare_(ss, opts) {
  var model = new tpModel_(ss, { dry: opts.dry });
  var turn = tpCurrentTurn_(ss) + 1;
  var mode = opts.dry ? 'Dry run' : 'Live';
  if (opts.dry) model.startPreview('Prepare turn ' + turn);
  var existing = model.tab('Actions').rows().filter(function (r) { return tpNum_(model.tab('Actions').get(r, 'Turn')) === turn && model.tab('Actions').get(r, 'Nation') !== ''; });
  if (existing.length && !opts.dry) {
    var msg = 'Turn ' + turn + ' already has ' + existing.length + ' Actions rows; not prepared again. Delete them and the turn\'s Rulings rows to redo.';
    tpLogRun_(ss, 'prepareTurn', mode, turn, 'Refused', msg);
    return { ok: false, summary: 'Prepare T' + turn + ' refused: already prepared' };
  }
  var res = tpPrepareInModel_(model, turn);
  model.commit();
  if (!opts.dry && String(tpGetControl_(ss, 'Mode') || '').trim().toLowerCase() === 'sandbox') tpSetControl_(ss, 'Sandbox orders since', tpNow_());
  var s = res.stats;
  var summary = 'Prepare T' + turn + ' (' + mode.toLowerCase() + '): ' + s.actions + ' actions (' + s.ready + ' ready, ' + s.ruling +
    ' need ruling, ' + s.rejected + ' rejected), ' + s.rulings + ' rulings open, ' + s.errors + ' errors';
  tpLogRun_(ss, 'prepareTurn', mode, turn, 'Prepared', summary);
  return { ok: s.errors === 0, summary: summary, stats: s };
}

/** Builds the turn's Actions and Rulings rows in the model. */
function tpPrepareInModel_(model, turn) {
  var stats = { actions: 0, ready: 0, ruling: 0, rejected: 0, rulings: 0, errors: 0 };
  var world = new tpWorld_(model);
  var deadline = tpCurrentDeadline_();
  var subs = tpPickSubmissions_(model, world, deadline);
  var A = model.tab('Actions');
  var R = model.tab('Rulings');

  // Held submissions (serial does not match the nation).
  subs.held.forEach(function (h) {
    tpAddRuling_(R, turn, h.nation || '?', 'Orders inbox', 'Submission at ' + tpFmtDate_(h.submitted), h.identity || 'Serial not recognised',
      'Check the serial with the player; if genuine, copy its orders in by hand.');
    stats.rulings++;
  });

  // Nations with no submission enter Caretaker; nations that return leave it.
  world.nations.forEach(function (n) {
    if (n.status === 'Eliminated' || n.status === 'Minor Power') return;
    var has = !!subs.byNation[n.id];
    if (!has && n.status !== 'Caretaker') { model.tab('Nations').set(n.row, 'Status', 'Caretaker'); n.status = 'Caretaker'; }
    if (has && n.status === 'Caretaker') { model.tab('Nations').set(n.row, 'Status', 'Active'); n.status = 'Active'; }
    if (!has && tpCountPriorCaretaker_(model, n.id, turn) >= 5) {
      tpAddRuling_(R, turn, n.id, 'Caretaker', 'Sixth consecutive Caretaker turn', 'After six Caretaker turns the nation becomes a GM-run independent power.',
        'Mark the nation a Minor Power (Nations Status) or keep it waiting.');
      stats.rulings++;
    }
  });

  world.nations.forEach(function (n) {
    var sub = subs.byNation[n.id];
    var sim = world.newSim(n, 'prepare');
    if (sub) {
      var orders = tpSplitSubmission_(sub, n.id);
      var evaluated = [];
      orders.forEach(function (o) {
        var row = A.add('Nation', {
          'Turn': turn, 'Nation': n.id, 'Channel': o.channel, 'Posted text': o.text, 'Verb': o.verb || '',
          'Details': '', 'Status': ''
        });
        o.actionRow = row; // sheet row index (0-based model index)
        o.actionNo = row;  // Actions!A shows ROW()-1, which equals the model index
        var ev;
        try {
          ev = tpEvaluateOrder_(world, sim, o, evaluated, 'prepare');
        } catch (e) {
          ev = { status: 'Needs ruling', flag: 'Script error: ' + e.message, why: 'The script could not read this order', suggest: 'Rule by hand' };
          stats.errors++;
        }
        o.ev = ev;
        evaluated.push(o);
        tpWriteActionEval_(A, row, o, ev);
        stats.actions++;
        if (ev.status === 'Ready') stats.ready++;
        else if (ev.status === 'Needs ruling') stats.ruling++;
        else stats.rejected++;
        if (ev.status === 'Needs ruling') {
          tpAddRuling_(R, turn, n.id, 'Actions row ' + o.actionNo, o.text, ev.why || ev.flag, ev.suggest || '');
          stats.rulings++;
        }
      });
      // Covert operations that support an order: point the order at its operation.
      orders.forEach(function (o) {
        if (o.verb === 'COVERT' && o.supports) {
          var target = evaluated.filter(function (p) { return p !== o && tpNorm_(tpStripCondition_(p.text).body) === tpNorm_(tpStripCondition_(o.supports).body); })[0];
          if (target) {
            var f = A.get(target.actionRow, 'Flag');
            A.set(target.actionRow, 'Flag', (f ? f + '; ' : '') + 'Supported by covert operation on Actions row ' + o.actionNo);
          }
        }
      });
      if (sub.questions && String(sub.questions).trim()) {
        tpAddRuling_(R, turn, n.id, 'Questions for the GM', String(sub.questions).trim(), 'A question for the GM', 'Answer before the turn opens.');
        stats.rulings++;
      }
    }
    // Upkeep the nation cannot pay after income.
    var shortfall = world.upkeepShortfall(n);
    if (shortfall) {
      tpAddRuling_(R, turn, n.id, 'Upkeep', 'Upkeep ' + shortfall.text, 'Projected Energy after income cannot pay upkeep.',
        'By the rules: disband ships, smallest first, until upkeep can be paid; -1 Stability. The script does this at resolution.');
      stats.rulings++;
    }
    if (world.atWar(n.id)) {
      tpAddRuling_(R, turn, n.id, 'Stability', 'Stability during war', 'War exhaustion depends on how long the war has run and the nation\'s war appetite.',
        'Normal (one point toward target) unless war exhaustion has begun: then "Fall".');
      stats.rulings++;
    }
  });
  return { stats: stats };
}

function tpWriteActionEval_(A, row, o, ev) {
  var c = ev.cost || {};
  A.set(row, 'Verb', o.verb || '');
  A.set(row, 'Details', ev.details || '');
  ['Industry', 'Energy', 'Research', 'Influence'].forEach(function (r) { A.set(row, r, c[r] ? tpRound1_(c[r]) : ''); });
  A.set(row, 'Strategic', tpStratText_(ev.strat));
  A.set(row, 'Status', ev.status);
  A.set(row, 'Flag', ev.flag || '');
  A.set(row, 'Elaboration summary', [o.planLabel, ev.elab].filter(function (x) { return x; }).join(' — '));
}

function tpAddRuling_(R, turn, nation, source, item, why, suggest) {
  return R.add('Turn', { 'Turn': turn, 'Nation': nation, 'Source': source, 'Item': item, 'Why it needs a ruling': why,
    'Suggested ruling': suggest, 'GM decision': '', 'Status': 'Open' });
}

/** Chooses, for each nation, the submission that counts for this deadline. */
function tpSandboxSince_() {
  // In Sandbox mode, turns run faster than the calendar: the latest submission after the last Prepare counts.
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (String(tpGetControl_(ss, 'Mode') || '').trim().toLowerCase() !== 'sandbox') return null;
    var v = tpGetControl_(ss, 'Sandbox orders since');
    if (v instanceof Date) return v;
    if (!v) return null; // not set: the ordinary deadline rule applies
    var d = new Date(v);
    return isNaN(d) ? null : d;
  } catch (e) { return null; }
}
function tpPickSubmissions_(model, world, deadline) {
  var T = model.tab('Orders inbox');
  var out = { byNation: {}, held: [] };
  var since = tpSandboxSince_();
  T.rows().forEach(function (r) {
    var submitted = T.get(r, 'Submitted');
    if (!(submitted instanceof Date)) { if (!submitted) return; submitted = new Date(submitted); }
    if (since) {
      if (submitted <= since) return;
    } else {
      var dl = T.get(r, 'Counts for the deadline');
      dl = dl instanceof Date ? dl : (dl ? new Date(dl) : tpDeadlineFor_(submitted));
      if (Math.abs(dl - deadline) > 60000) return;
    }
    var status = String(T.get(r, 'Status') || '').trim();
    var nationText = String(T.get(r, 'Nation') || '').trim();
    var nat = world.nationByName(nationText);
    if (status.indexOf('Held') === 0 || /^Held/.test(String(T.get(r, 'Identity') || ''))) {
      out.held.push({ nation: nat ? nat.id : nationText, submitted: submitted, identity: T.get(r, 'Identity') });
      return;
    }
    if (status && status !== 'Counts' && !since) return; // Replaced (in Sandbox the latest by time wins below)
    if (!nat) { out.held.push({ nation: nationText, submitted: submitted, identity: 'Nation not found on Nations tab' }); return; }
    var prev = out.byNation[nat.id];
    if (prev && prev.submitted > submitted) return;
    out.byNation[nat.id] = {
      submitted: submitted, routine: T.get(r, 'Routine orders'),
      plans: [1, 2, 3, 4, 5].map(function (k) { return T.get(r, 'Plan ' + k); }),
      covert: T.get(r, 'Other covert orders'), questions: T.get(r, 'Questions for the GM')
    };
  });
  return out;
}

/** Splits a submission into order lines: routine, plans 1 to 5, then covert work. */
function tpSplitSubmission_(sub, nid) {
  var out = [];
  function lines(text) {
    return String(text || '').split(/\r?\n/).map(function (s) { return s.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').trim(); })
      .filter(function (s) { return s; });
  }
  lines(sub.routine).forEach(function (t) { out.push(tpMakeOrder_(t, 'Routine', '')); });
  sub.plans.forEach(function (p, i) {
    if (!p || !String(p).trim()) return;
    var plan = tpParsePlan_(String(p));
    var label = 'Plan ' + (i + 1) + ' "' + plan.name + '"' + (plan.objective ? ': ' + plan.objective : '');
    plan.orders.forEach(function (t) { out.push(tpMakeOrder_(t, 'Plan ' + (i + 1), label)); });
    if (plan.covert) {
      var o = { text: plan.covert, channel: 'Covert', verb: 'COVERT', planLabel: label, supports: plan.supports };
      out.push(o);
    }
  });
  if (sub.covert && String(sub.covert).trim()) out.push({ text: String(sub.covert).trim(), channel: 'Covert', verb: 'COVERT', planLabel: 'No plan' });
  return out;
}

function tpMakeOrder_(text, channel, planLabel) {
  var first = (text.split(/\s+/)[0] || '').toUpperCase().replace(/[^A-Z]/g, '');
  var verb = TURN_CONFIG.VERB_ALIASES[first] || first;
  if (TURN_CONFIG.VERBS.indexOf(verb) < 0) verb = '';
  return { text: text, channel: channel, verb: verb, planLabel: planLabel };
}

/** Plan cells are built by the Orders inbox as: name / Objective: ... / Orders: lines / Covert: ... [supports: ...] */
function tpParsePlan_(text) {
  var ls = text.split(/\r?\n/);
  var plan = { name: (ls[0] || '').trim(), objective: '', orders: [], covert: '', supports: '' };
  var mode = 'head';
  for (var i = 1; i < ls.length; i++) {
    var l = ls[i];
    var t = l.trim();
    if (/^Objective:/i.test(t)) { plan.objective = t.replace(/^Objective:\s*/i, ''); mode = 'objective'; continue; }
    if (/^Orders:?$/i.test(t)) { mode = 'orders'; continue; }
    if (/^Covert:/i.test(t)) { plan.covert = t.replace(/^Covert:\s*/i, ''); mode = 'covert'; continue; }
    if (mode === 'orders') { if (t) plan.orders.push(t.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '')); }
    else if (mode === 'covert') plan.covert += '\n' + l;
    else if (mode === 'objective') plan.objective += ' ' + t;
    else if (t) plan.orders.push(t);
  }
  var m = plan.covert.match(/\[supports:\s*([\s\S]*?)\]\s*$/i);
  if (m) { plan.supports = m[1].trim(); plan.covert = plan.covert.slice(0, m.index).trim(); }
  plan.covert = plan.covert.trim();
  plan.objective = plan.objective.trim();
  return plan;
}

// =====================================================================
// ORDER EVALUATION (shared by prepare and resolve)
// =====================================================================
/**
 * Returns { status, flag, details, elab, cost, strat, stab, spec, why, suggest }.
 * status: Ready, Needs ruling, Rejected, Condition failed, Duplicate.
 * On Ready, the projected state in sim is updated.
 */
function tpEvaluateOrder_(world, sim, o, earlier, phase) {
  if (o.verb === 'COVERT') {
    return { status: 'Needs ruling', flag: 'Covert operation', details: o.planLabel + (o.supports ? '; supports: ' + o.supports : ''),
      why: 'Covert operations are rolled by the GM', suggest: 'Roll per Covert Action; charge its cost if attempted (hidden line).' };
  }
  var sc = tpStripCondition_(o.text);
  // Duplicate: an order written in two places is carried out once.
  var dup = earlier.filter(function (p) { return p.verb !== 'COVERT' && tpNorm_(p.text) === tpNorm_(o.text); })[0];
  if (dup) return { status: 'Duplicate', flag: 'Same order as Actions row ' + dup.actionNo + '; carried out once' };
  if (!o.verb) {
    return { status: 'Needs ruling', flag: 'No recognised verb', why: 'The line does not begin with one of the fixed verbs',
      suggest: 'Read as the player intended or treat as not an order.' };
  }
  // Condition
  var depNote = '';
  if (sc.cond) {
    var c = tpCheckCondition_(world, sim, sc.cond, earlier);
    if (c.result === 'false') return { status: 'Condition failed', flag: 'Condition not met: ' + c.note, details: 'IF ' + sc.cond };
    if (c.result === 'unknown') {
      var inner = tpEvaluateBody_(world, sim, o.verb, sc.body, Object.assign({}, o, { dryCheck: true }), phase);
      // An order the rules refuse anyway needs no ruling on its condition.
      if (inner.status === 'Rejected') return inner;
      return { status: 'Needs ruling', flag: 'Condition the script cannot judge: IF ' + sc.cond, details: inner.details, elab: inner.elab,
        cost: inner.cost, strat: inner.strat, stab: inner.stab, spec: inner.spec,
        why: 'Condition the rules cannot settle: ' + c.note, suggest: inner.status === 'Ready' ? 'If the condition holds: carry out as priced.' : (inner.flag || '') };
    }
    if (c.result === 'pending') {
      var inner2 = tpEvaluateBody_(world, sim, o.verb, sc.body, Object.assign({}, o, { dryCheck: true }), phase);
      return { status: 'Needs ruling', flag: 'Depends on Actions row ' + c.row + ', which needs a ruling', details: inner2.details, elab: inner2.elab,
        cost: inner2.cost, strat: inner2.strat, stab: inner2.stab, spec: inner2.spec, dependsOn: c.row,
        why: 'Its condition depends on an order that needs a ruling', suggest: 'Approve if Actions row ' + c.row + ' is approved.' };
    }
    depNote = 'Condition met: ' + c.note;
    o.dependsOn = c.row;
  }
  var ev = tpEvaluateBody_(world, sim, o.verb, sc.body, o, phase);
  if (depNote) ev.flag = ev.flag ? ev.flag + '; ' + depNote : depNote;
  if (o.dependsOn) ev.dependsOn = o.dependsOn;
  if (ev.status === 'Ready') {
    var aff = tpAffordable_(sim, ev);
    if (!aff.ok) return Object.assign(ev, { status: 'Rejected', flag: 'Unaffordable: ' + aff.text, spec: ev.spec });
    tpCommitSim_(sim, ev);
  }
  return ev;
}

/** Splits "ORDER IF condition". The rules write the condition after the order, starting with IF. */
function tpStripCondition_(text) {
  var m = String(text).match(/^(.*?)\s+IF\s+(.+)$/);
  if (!m) return { body: String(text).trim(), cond: '' };
  return { body: m[1].trim(), cond: m[2].trim() };
}

function tpCheckCondition_(world, sim, cond, earlier) {
  var m = cond.match(/^(.+?)\s+(?:is|has been|was)\s+(founded|colonized|colonised|settled|held|ours|taken)\.?$/i);
  if (m) {
    var sys = world.findSystem(m[1]);
    if (!sys) return { result: 'unknown', note: 'system "' + m[1] + '" not found' };
    if (sim.owned[sys.id] && !sim.colonized[sys.id]) return { result: 'true', note: tpSysLabel_(sys) + ' already held' };
    var col = earlier.filter(function (p) { return p.verb === 'COLONIZE' && p.ev && p.ev.spec && p.ev.spec.sys === sys.id; }).pop();
    if (!col) return { result: 'false', note: 'no order founds ' + tpSysLabel_(sys) };
    return tpDepResult_(col);
  }
  m = cond.match(/^(.+?)\s+(?:succeeds|is carried out|happens|is built|is done|is completed|goes ahead)\.?$/i);
  var subject = m ? m[1] : cond;
  var target = earlier.filter(function (p) { return p.verb !== 'COVERT' && tpNorm_(tpStripCondition_(p.text).body) === tpNorm_(subject); }).pop();
  if (target) return tpDepResult_(target);
  return { result: 'unknown', note: '"' + cond + '"' };
}
function tpDepResult_(p) {
  var st = p.ev ? p.ev.status : '';
  if (st === 'Ready' || st === 'Applied') return { result: 'true', note: 'Actions row ' + p.actionNo + ' goes ahead', row: p.actionNo };
  if (st === 'Needs ruling') return { result: 'pending', note: 'Actions row ' + p.actionNo + ' needs a ruling', row: p.actionNo };
  return { result: 'false', note: 'Actions row ' + p.actionNo + ' does not go ahead (' + st + ')', row: p.actionNo };
}

function tpEvaluateBody_(world, sim, verb, body, o, phase) {
  var args = body.replace(/^\S+\s*/, '').trim();
  switch (verb) {
    case 'DEVELOP': return tpEvDevelop_(world, sim, args);
    case 'DESIGNATE': return tpEvDesignate_(world, sim, args);
    case 'BUILD': return tpEvBuild_(world, sim, args);
    case 'SHIP': return tpEvShip_(world, sim, args);
    case 'GROUND': return tpEvGround_(world, sim, args);
    case 'DEFENCE': return tpEvDefence_(world, sim, args);
    case 'RESEARCH': return tpEvResearch_(world, sim, args);
    case 'COLONIZE': return tpEvColonize_(world, sim, args);
    case 'MOVE': return tpEvMove_(world, sim, args, phase);
    case 'SHIFT': return tpEvShift_(world, sim, args);
    case 'CIVIC': return tpEvCivic_(world, sim, args);
    case 'REFORM': return tpEvReform_(world, sim, args);
    case 'TRANSFER': return tpEvTransfer_(world, sim, args);
    case 'STABILITY': return tpEvStability_(world, sim, args);
    case 'CONTACT': return tpEvContact_(world, sim, args);
    case 'FATE': return tpRuling_('Fate of a conquered system', 'Fates follow a peace treaty and the GM\'s ruling on its terms', 'Apply the fate chosen per The Fate Of The Conquered.');
    case 'BURN': var e = tpRuling_('Burning archives', 'Only before a peace treaty cedes the system', 'If a cession is pending: -1 Stability, Absorb unavailable.'); e.stab = 1; e.spec = { type: 'STAB_ONLY' }; return e;
    case 'BREAK': var b = tpRuling_('Breaking a treaty', 'Breaking a treaty carries Stability, Infamy and casus belli effects the GM confirms',
      '-2 Stability (more for Sacred, Espionage Directorate or taboo), Infamy +3, casus belli to the other party.'); b.stab = 2; b.spec = { type: 'STAB_ONLY' }; return b;
  }
  return tpRuling_('Unknown verb', 'Not a recognised verb', '');
}

function tpRuling_(flag, why, suggest, extra) {
  return Object.assign({ status: 'Needs ruling', flag: flag, why: why, suggest: suggest }, extra || {});
}
function tpReject_(flag, extra) { return Object.assign({ status: 'Rejected', flag: flag }, extra || {}); }
function tpReady_(details, elab, cost, strat, spec, extra) {
  return Object.assign({ status: 'Ready', details: details, elab: elab, cost: cost || {}, strat: strat || {}, stab: 0, spec: spec }, extra || {});
}

// ---------- DEVELOP <system> [level] ----------
function tpEvDevelop_(world, sim, args) {
  var m = args.match(/^(.*?)(?:\s+(?:to\s+)?(\d))?\s*$/i);
  var sys = world.findSystem(m[1]);
  if (!sys) return tpRuling_('System not found: "' + m[1] + '"', 'The script cannot find this system', 'Identify the system.');
  if (!sim.ownsActive(sys.id)) return tpReject_('Not held by this nation: ' + tpSysLabel_(sys));
  var cur = sim.devOf(sys.id);
  var level = m[2] ? Number(m[2]) : cur + 1;
  if (sim.devRaised[sys.id]) return tpReject_('A system may rise only one level per turn');
  if (level !== cur + 1) return tpReject_('Development ' + cur + ' can rise only to ' + (cur + 1) + ' this turn (ordered ' + level + ')');
  var cap = tpNum_(sys.get('Effective Development cap')) || tpNum_(sys.get('Development cap'));
  if (level > cap) return tpReject_('Above the Development cap of ' + cap);
  // Development waits for people: at least half the workforce the level needs.
  var factor = Math.max(world.popConst('Workforce floor (x need)', 0.25), 1 + tpNum_(sim.calc['Workforce modifier %']) / 100);
  var need = world.popConst('Workforce per Development squared (bn)', 0.25) * level * level * factor;
  var pop = world.systemPopulation(sys.id) - (sim.settlersFrom[sys.id] || 0);
  if (pop < need / 2) return tpReject_('Development waits for people: ' + tpRound2_(pop) + ' bn held, ' + tpRound2_(need / 2) + ' bn needed (half of ' + tpRound2_(need) + ')');
  var pct = tpNum_(sim.calc['Development cost %']);
  var notes = [];
  if (/Underway/i.test(sys.get('Buildings'))) { pct += -25; notes.push('Underway -25%'); }
  pct = Math.max(TURN_CONFIG.COST_FLOOR_PCT, pct);
  var base = TURN_CONFIG.DEVELOPMENT_COST_PER_LEVEL * level;
  var cost = tpRoundHalfUp_(base * (1 + pct / 100));
  return tpReady_(tpSysLabel_(sys) + ': Development ' + cur + ' to ' + level,
    '3 x ' + level + ' = ' + base + ' Industry, Development cost ' + tpSigned_(pct) + '% = ' + tpRound2_(base * (1 + pct / 100)) + ' -> ' + cost + (notes.length ? ' (' + notes.join(', ') + ')' : ''),
    { Industry: cost }, {}, { type: 'DEVELOP', sys: sys.id, level: level });
}

// ---------- DESIGNATE <system> [as] <designation> ----------
function tpEvDesignate_(world, sim, args) {
  var desigs = world.designations();
  var found = null, rest = args;
  desigs.forEach(function (d) {
    var re = new RegExp('(?:^|\\s|:)(?:as\\s+|to\\s+)?' + tpEscapeRe_(d) + '\\s*$', 'i');
    if (!found && re.test(args)) { found = d; rest = args.replace(re, '').replace(/[:,]\s*$/, ''); }
  });
  if (!found) return tpRuling_('Designation not recognised', 'No designation from the table at the end of the line', 'Identify the designation.');
  var sys = world.findSystem(rest);
  if (!sys) return tpRuling_('System not found: "' + rest + '"', 'The script cannot find this system', 'Identify the system.');
  if (!sim.ownsActive(sys.id)) return tpReject_('Not held by this nation: ' + tpSysLabel_(sys));
  var cur = sim.desigOf(sys.id);
  if (cur === 'Capital') return tpReject_('The Capital designation cannot be changed');
  if (found === 'Capital') return tpReject_('Capital is the homeworld\'s designation only');
  if (cur === found) return tpReject_('Already designated ' + found);
  if (sim.desigChanged[sys.id]) return tpReject_('Already redesignated this turn');
  var cost = {}, parts = [];
  if (sim.hasCivic('Planned Economy')) {
    parts.push('Planned Economy: no output lost');
  } else if (!sim.colonized[sys.id]) {
    TURN_CONFIG.RESOURCES.forEach(function (r) {
      var gross = tpNum_(sys.get(r));
      if (!gross) return;
      var pct = tpNum_(sim.calc[TURN_CONFIG.PCT_HEADERS[r]]);
      var v = tpRound1_(gross * (1 + pct / 100));
      if (v > 0) { cost[r] = v; parts.push(r + ' ' + gross + ' x (1 ' + (pct >= 0 ? '+ ' : '- ') + Math.abs(pct) + '%) = ' + v); }
    });
    if (!parts.length) parts.push('the system produces nothing yet');
  } else parts.push('founded this turn: no output yet');
  return tpReady_(tpSysLabel_(sys) + ': ' + (cur || 'none') + ' to ' + found, 'One turn of the system\'s output: ' + parts.join('; '),
    cost, {}, { type: 'DESIGNATE', sys: sys.id, desig: found });
}

// ---------- BUILD <building> @ <system> ----------
function tpEvBuild_(world, sim, args) {
  var p = tpSplitAt_(args);
  if (!p) return tpRuling_('No system given (write BUILD <building> @ <system>)', 'The system is missing', 'Identify the system.');
  var name = p.what.replace(/^(?:an?|the)\s+/i, '').trim();
  if (TURN_CONFIG.MEGAPROJECTS.some(function (mp) { return tpNorm_(mp) === tpNorm_(name); })) {
    return tpRuling_('Megaproject', 'Megaprojects are built over several turns under limits the GM checks', 'Check Megaprojects: requirements, cost paid when work begins, turns listed.');
  }
  var sys = world.findSystem(p.where);
  if (!sys) return tpRuling_('System not found: "' + p.where + '"', 'The script cannot find this system', 'Identify the system.');
  if (!sim.ownsActive(sys.id)) return tpReject_('Not held by this nation: ' + tpSysLabel_(sys));
  var sig = tpFindKey_(TURN_CONFIG.SIGNATURE_WORKS, name);
  if (sig) return tpEvSignatureWork_(world, sim, sys, sig);
  var b = world.building(name);
  if (!b) return tpRuling_('Building not recognised: "' + name + '"', 'Not in Tables or the rules', 'Identify the building or treat as lore.');
  return tpBuildChecks_(world, sim, sys, b);
}

function tpBuildChecks_(world, sim, sys, b) {
  var existing = sim.buildingsOf(sys.id);
  if (existing.some(function (x) { return tpNorm_(x) === tpNorm_(b.name); })) return tpReject_(b.name + ' already stands (or is ordered) in ' + tpSysLabel_(sys) + '; once per system');
  var r = b.req || {};
  var tiers = sim.tiers;
  if (r.military && tiers.Military < r.military) return tpReject_('Requires Military Tier ' + r.military);
  if (r.industry && tiers.Industry < r.industry) return tpReject_('Requires Industry Tier ' + r.industry);
  if (r.society && tiers.Society < r.society) return tpReject_('Requires Society Tier ' + r.society);
  if (r.logistics && tiers.Logistics < r.logistics) return tpReject_('Requires Logistics Tier ' + r.logistics);
  if (r.development && tpNum_(sys.get('Development')) < r.development) return tpReject_('Requires Development ' + r.development);
  if (r.tradeHub && sim.desigOf(sys.id) !== 'Trade Hub') return tpReject_('Requires a Trade Hub designation');
  if (r.collective && sim.gov !== 'Collective') return tpReject_('Requires Collective government');
  if (r.deposit && !String(sys.get('Deposits') || '').trim()) return tpReject_('Requires a strategic deposit in the system');
  if (r.unknown) return tpRuling_('Requirement the script cannot read: ' + r.unknown, 'Unreadable requirement in Tables', 'Check the requirement.');
  var free = tpNum_(sys.get('Slots')) - tpNum_(sys.get('Slots used')) - (sim.slotsAdded[sys.id] || 0);
  if (b.slot !== false && free < 1) return tpReject_('No free building slot in ' + tpSysLabel_(sys));
  var ex = sim.calc['Extractor cost (Industry)'];
  var industry = b.name === 'Extractor' && ex !== '' && ex !== undefined && ex !== null ? tpNum_(ex) : b.industry;
  var notes = [];
  if (b.oncePerNation && sim.nationHasBuilding(b.name)) notes.push('counts once per nation: no further effect');
  var turns = b.turns || 1;
  return tpReady_(b.name + ' at ' + tpSysLabel_(sys) + (turns > 1 ? ' (' + turns + ' turns)' : ''),
    'Cost ' + industry + ' Industry' + (tpStratText_(b.strat) ? ' and ' + tpStratText_(b.strat) : '') + (notes.length ? '; ' + notes.join('; ') : ''),
    { Industry: industry }, b.strat || {}, { type: 'BUILD', sys: sys.id, building: b.name, turns: turns });
}

function tpEvSignatureWork_(world, sim, sys, name) {
  var w = TURN_CONFIG.SIGNATURE_WORKS[name];
  var env = sys.get('Environment');
  var expertise = String(sim.calc['Expertise'] || '');
  if (expertise.indexOf(w.expertise) < 0) return tpRuling_('No ' + w.expertise + ' expertise for ' + name, 'Without the expertise it needs a works contract with a builder that has it',
    'Works contract: Industry cost + 20% to the builder, then 2 Influence a turn.');
  if (w.oceanicOnly && env !== 'Oceanic') return tpReject_(name + ' needs an Oceanic world');
  if (w.notOceanic && env === 'Oceanic') return tpReject_(name + ' cannot stand on an Oceanic world');
  if (w.minDevelopment && tpNum_(sys.get('Development')) < w.minDevelopment) return tpReject_(name + ' needs Development ' + w.minDevelopment);
  var all = Object.keys(TURN_CONFIG.SIGNATURE_WORKS);
  if (sim.buildingsOf(sys.id).some(function (x) { return all.indexOf(x) >= 0; })) return tpReject_('A system may hold only one signature work');
  return tpBuildChecks_(world, sim, sys, { name: name, industry: w.industry, strat: {}, req: {}, turns: 1, slot: true });
}

// ---------- SHIP <category> x<n> @ <system> ----------
function tpEvShip_(world, sim, args) {
  var p = tpSplitAt_(args);
  if (!p) return tpRuling_('No shipyard system given (write SHIP <category> x<n> @ <system>)', 'The system is missing', 'Identify the system.');
  var q = tpParseQty_(p.what);
  var cat = world.shipCategory(q.name);
  if (!cat) return tpRuling_('Ship category not recognised: "' + q.name + '"', 'Players name classes in lore; the category decides cost', 'Identify the category.');
  var sys = world.findSystem(p.where);
  if (!sys) return tpRuling_('System not found: "' + p.where + '"', 'The script cannot find this system', 'Identify the system.');
  if (!sim.ownsActive(sys.id)) return tpReject_('Not held by this nation: ' + tpSysLabel_(sys));
  if (!/Shipyard/i.test(sys.get('Buildings'))) return tpReject_('No Shipyard at ' + tpSysLabel_(sys));
  var req = String(cat.requires || '');
  var mt = req.match(/Military T(\d)/i);
  if (mt && sim.tiers.Military < Number(mt[1])) return tpReject_('Requires Military Tier ' + mt[1]);
  var sd = req.match(/Shipyard Dev (\d)/i);
  if (sd && tpNum_(sys.get('Development')) < Number(sd[1])) return tpReject_('Requires a Shipyard at Development ' + sd[1] + ' or more');
  var capAdd = cat.capacity * q.n;
  var used = tpNum_(sim.calc['Ship capacity used']) + sim.shipCapAdded;
  var fc = tpNum_(sim.calc['Fleet Capacity']);
  if (used + capAdd > fc) return tpReject_('Over Fleet Capacity: ' + tpRound2_(used) + ' used + ' + capAdd + ' > ' + fc);
  var pct = tpNum_(sim.calc['Fiscal ship cost %']) + (sim.hasCivic('Military Junta') ? TURN_CONFIG.MILITARY_JUNTA_SHIP_PCT : 0);
  pct = Math.max(TURN_CONFIG.COST_FLOOR_PCT, pct);
  var base = cat.industry * q.n;
  var cost = tpRoundHalfUp_(base * (1 + pct / 100));
  var strat = {};
  TURN_CONFIG.STRATEGIC.forEach(function (s) { if (cat.strat[s]) strat[s] = cat.strat[s] * q.n; });
  var turns = TURN_CONFIG.SHIP_TURNS[cat.name] || 1;
  return tpReady_(q.n + ' ' + cat.name + (q.n > 1 ? 's' : '') + ' at ' + tpSysLabel_(sys) + (turns > 1 ? ' (' + turns + ' turns)' : ''),
    q.n + ' x ' + cat.industry + ' = ' + base + ' Industry' + (pct ? ', ship cost ' + tpSigned_(pct) + '% -> ' + cost : '') +
    (tpStratText_(strat) ? '; ' + tpStratText_(strat) : '') + '; capacity ' + capAdd + ' (' + tpRound2_(used + capAdd) + ' of ' + fc + ')',
    { Industry: cost }, strat, { type: 'SHIP', sys: sys.id, cat: cat.name, n: q.n, turns: turns }, { capAdd: capAdd });
}

// ---------- GROUND <formation> x<n> @ <system> ----------
function tpEvGround_(world, sim, args) {
  var p = tpSplitAt_(args);
  if (!p) return tpRuling_('No world given (write GROUND <formation> x<n> @ <system>)', 'The system is missing', 'Identify the system.');
  var q = tpParseQty_(p.what);
  var env = '';
  var em = q.name.match(/\(([^)]+)\)/);
  if (em) { env = em[1].trim(); q.name = q.name.replace(/\([^)]*\)/, '').trim(); }
  var fname = tpFindKey_(TURN_CONFIG.FORMATIONS, q.name) || tpFindKey_(TURN_CONFIG.FORMATIONS, q.name.replace(/ies$/i, 'y').replace(/s$/i, ''));
  if (!fname && /specialized/i.test(q.name)) fname = 'Specialised Infantry';
  if (!fname) return tpRuling_('Formation not recognised: "' + q.name + '"', 'Not a formation in the rules', 'Identify the formation.');
  var f = TURN_CONFIG.FORMATIONS[fname];
  var sys = world.findSystem(p.where);
  if (!sys) return tpRuling_('System not found: "' + p.where + '"', 'The script cannot find this system', 'Identify the system.');
  if (!sim.ownsActive(sys.id)) return tpReject_('Formations are raised at worlds the nation holds');
  if (sim.tiers.Military < f.military) return tpReject_('Requires Military Tier ' + f.military);
  if (f.needsCollege && !sim.nationHasBuilding('Military College')) return tpReject_('Special Forces need a Military College');
  if (f.needsEnvironment && !env) return tpRuling_('Specialised Infantry needs its environment named', 'Write e.g. GROUND Specialised Infantry (Frozen) x2 @ ...', 'Ask the player for the environment.');
  var capAdd = f.capacity * q.n;
  var used = tpNum_(sim.calc['Ground Power']) + sim.armyCapAdded;
  var ac = tpNum_(sim.calc['Army Capacity']);
  if (used + capAdd > ac) return tpReject_('Over Army Capacity: ' + used + ' + ' + capAdd + ' > ' + ac);
  var cost = f.industry * q.n;
  var strat = {};
  Object.keys(f.strat).forEach(function (s) { strat[s] = f.strat[s] * q.n; });
  return tpReady_(q.n + ' ' + fname + (env ? ' (' + env + ')' : '') + ' at ' + tpSysLabel_(sys) + (f.turns > 1 ? ' (' + f.turns + ' turns)' : ''),
    q.n + ' x ' + f.industry + ' = ' + cost + ' Industry' + (tpStratText_(strat) ? '; ' + tpStratText_(strat) : '') + '; capacity ' + capAdd + ' (' + (used + capAdd) + ' of ' + ac + ')',
    { Industry: cost }, strat, { type: 'GROUND', sys: sys.id, form: fname, n: q.n, env: env, turns: f.turns }, { armyAdd: capAdd });
}

// ---------- DEFENCE [Static Defence] <points> @ <system>  |  DEFENCE <installation> @ <system> ----------
function tpEvDefence_(world, sim, args) {
  var p = tpSplitAt_(args);
  if (!p) return tpRuling_('No system given (write DEFENCE <points> @ <system>)', 'The system is missing', 'Identify the system.');
  var inst = tpFindKey_(TURN_CONFIG.RULE_BUILDINGS, p.what.replace(/^(?:an?|the)\s+/i, ''));
  if (inst && TURN_CONFIG.RULE_BUILDINGS[inst].installation) {
    var s0 = world.findSystem(p.where);
    if (!s0) return tpRuling_('System not found: "' + p.where + '"', 'The script cannot find this system', 'Identify the system.');
    if (!sim.ownsActive(s0.id)) return tpReject_('Not held by this nation: ' + tpSysLabel_(s0));
    return tpBuildChecks_(world, sim, s0, world.building(inst));
  }
  var m = p.what.match(/(\d+)/);
  if (!m || !/^(?:static\s+defen[cs]e\s*)?\d+(?:\s*(?:points?|pts?))?(?:\s*(?:of\s+)?static\s+defen[cs]e)?$/i.test(p.what.trim())) {
    return tpRuling_('Defence not recognised: "' + p.what + '"', 'Not Static Defence or a listed installation', 'Identify the defence.');
  }
  var pts = Number(m[1]);
  var sys = world.findSystem(p.where);
  if (!sys) return tpRuling_('System not found: "' + p.where + '"', 'The script cannot find this system', 'Identify the system.');
  if (!sim.ownsActive(sys.id)) return tpReject_('Not held by this nation: ' + tpSysLabel_(sys));
  if (sim.tiers.Military < TURN_CONFIG.STATIC_DEFENCE_MILITARY_TIER) return tpReject_('Static Defence requires Military Tier ' + TURN_CONFIG.STATIC_DEFENCE_MILITARY_TIER);
  var have = world.staticDefenceAt(sim.nid, sys.id) + (sim.staticAdded[sys.id] || 0);
  var max = TURN_CONFIG.STATIC_DEFENCE_POINTS_PER_DEVELOPMENT * tpNum_(sys.get('Development'));
  if (have + pts > max) return tpReject_('At most ' + max + ' Static Defence points in ' + tpSysLabel_(sys) + ' (holds ' + have + ')');
  var cost = TURN_CONFIG.STATIC_DEFENCE_INDUSTRY_PER_POINT * pts;
  return tpReady_(pts + ' Static Defence at ' + tpSysLabel_(sys), pts + ' x 2 = ' + cost + ' Industry', { Industry: cost }, {},
    { type: 'DEFENCE', sys: sys.id, points: pts }, { staticAdd: pts });
}

// ---------- RESEARCH <branch> [tier] ----------
function tpEvResearch_(world, sim, args) {
  var m = args.match(/^(Military|Industry|Society|Logistics)\b(?:\s+(?:tier\s+|to\s+|T)?(\d))?/i);
  if (!m) return tpRuling_('Branch not recognised', 'Branches are Military, Industry, Society, Logistics', 'Identify the branch.');
  var branch = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  var cur = sim.tiers[branch];
  var tier = m[2] ? Number(m[2]) : cur + 1;
  if (sim.researched[branch]) return tpReject_('One tier per branch per turn');
  if (tier !== cur + 1) return tpReject_(branch + ' is at Tier ' + cur + '; only Tier ' + (cur + 1) + ' can be researched (ordered ' + tier + ')');
  var t = world.techTier(tier);
  if (!t) return tpReject_('No Tier ' + tier);
  var mult = tpNum_(sim.calc['Tech cost multiplier']) || 1;
  var cost = tpRoundHalfUp_(t.research * mult);
  var strat = {};
  if (t.units) strat[TURN_CONFIG.TECH_BRANCH_RESOURCE[branch]] = t.units;
  var ev = tpReady_(branch + ' Tier ' + cur + ' to ' + tier,
    t.research + ' Research x ' + mult + ' (tech cost multiplier) = ' + tpRound2_(t.research * mult) + ' -> ' + cost + (t.units ? '; ' + tpStratText_(strat) : ''),
    { Research: cost }, strat, { type: 'RESEARCH', branch: branch, tier: tier });
  if (tpNum_(sim.calc['Technology pacts']) > 0) {
    return Object.assign(ev, { status: 'Needs ruling', flag: 'Technology pact in force', why: 'A pact cuts 25% off tiers the partner has reached',
      suggest: 'If the partner already holds ' + branch + ' Tier ' + tier + ': ' + tpRoundHalfUp_(t.research * mult * 0.75) + ' Research; otherwise ' + cost + '.' });
  }
  return ev;
}

// ---------- COLONIZE <system> [as <designation>] ----------
function tpEvColonize_(world, sim, args) {
  var desig = '';
  var dm = args.match(/\s+as\s+(.+)$/i);
  if (dm) { desig = world.designations().filter(function (d) { return tpNorm_(d) === tpNorm_(dm[1]); })[0] || ''; args = args.slice(0, dm.index); }
  var idm = args.match(/\(([A-Z]+-\d+)\)/i);
  var sys = world.findSystem(idm ? idm[1] : args);
  var given = args.replace(/\([^)]*\)/, '').trim();
  if (!sys) return tpRuling_('System not found: "' + args + '"', 'The script cannot find this system', 'Identify the system.');
  if (dm && !desig) return tpRuling_('Designation not recognised: "' + dm[1] + '"', 'Not in the designation table', 'Identify the designation.');
  if (desig === 'Capital') return tpReject_('Capital is the homeworld\'s designation only');
  if (sim.stability <= TURN_CONFIG.UNREST_AT_OR_BELOW) return tpReject_('No colonization in Unrest or worse (Stability ' + sim.stability + ')');
  if (sys.get('Owner') || sim.taken[sys.id]) return tpReject_(tpSysLabel_(sys) + ' is already claimed');
  if (/Necrophage/i.test(sim.traits)) return tpRuling_('Necrophage colony needs a Ruler', 'Every new Necrophage colony needs one Ruler', 'Check Rulers and charge one.');
  if (String(sys.get('Native era') || '').trim()) return tpRuling_('Natives present', 'A native world joins by a contact strategy, not colonization', 'Treat as CONTACT.');
  var reach = sim.tiers.Logistics >= 4 ? 2 : 1;
  var d = world.distanceFromSet(Object.keys(sim.owned).filter(function (k) { return sim.ownsActive(k); }), sys.id, reach);
  if (d < 0) return tpRuling_('Beyond reach: an expedition', 'The target is more than ' + reach + ' lane(s) from the nation\'s systems',
    'Expedition: pay the colony cost now; it travels at the jump range like a fleet.');
  var env = sys.get('Environment');
  var col = env === 'Oceanic' ? 'Colony cost: Oceanic world' : env === 'Garden' ? 'Colony cost: Garden world' :
    (['Barren', 'Frozen', 'Arid', 'Volcanic', 'Toxic'].indexOf(env) >= 0 ? 'Colony cost: Barren, Frozen, Arid, Volcanic or Toxic world' : '');
  if (!col) return tpRuling_('No colony cost for environment "' + env + '"', 'Calculations prices Oceanic, Garden and the hostile five only', 'Price the colony.');
  var c = tpNum_(sim.calc[col]);
  var avail = sim.totalPopulation();
  if (avail < TURN_CONFIG.COLONY_SETTLERS_BN) return tpReject_('Not enough people to send ' + TURN_CONFIG.COLONY_SETTLERS_BN + ' bn settlers');
  return tpReady_(tpSysLabel_(sys) + ' (' + env + ')' + (desig ? ' as ' + desig : '') + '; ' + TURN_CONFIG.COLONY_SETTLERS_BN + ' bn settlers',
    'Colony cost (' + env + '): ' + c + ' Influence and ' + c + ' Energy' + (desig ? '' : '; no designation given, so it produces nothing until designated'),
    { Influence: c, Energy: c }, {}, { type: 'COLONIZE', sys: sys.id, name: (given && tpNorm_(given) !== tpNorm_(sys.id)) ? given : '', desig: desig });
}

// ---------- MOVE <force>[: <from>] > <to> ----------
function tpEvMove_(world, sim, args, phase) {
  var m = args.match(/^(.*?)\s*:\s*(.*)$/);
  var forceText, route;
  if (m) { forceText = m[1]; route = m[2]; }
  else {
    var m2 = args.match(/^(.*?)\s+(?:to|>|→|->)\s+(.*)$/i);
    if (!m2) return tpRuling_('Route not readable (write MOVE <force>: <from> > <to>)', 'No destination found', 'Identify the move.');
    forceText = m2[1]; route = '> ' + m2[2];
  }
  var f = world.findForce(sim.nid, forceText);
  if (!f) return tpRuling_('Force not found: "' + forceText + '"', 'No force of this nation by that name or ID', 'Identify the force.');
  if (sim.moved[f.row]) return tpReject_('This force already moves this turn');
  var pts = route.split(/\s*(?:>|→|->|\bto\b)\s*/i).map(function (s) { return s.trim(); });
  var from = pts[0], waypoints = pts.slice(1).filter(function (s) { return s; });
  if (!waypoints.length) return tpRuling_('No destination', 'Route has no destination', 'Identify the move.');
  var loc = f.location;
  if (from) {
    var fs = world.findSystem(from);
    if (!fs || fs.id !== loc) return tpRuling_('The force is at ' + world.label(loc) + ', not "' + from + '"', 'Its stated starting point does not match the Forces tab', 'Confirm where it starts.');
  }
  var stops = [];
  for (var i = 0; i < waypoints.length; i++) {
    var s = world.findSystem(waypoints[i]);
    if (!s) return tpRuling_('System not found: "' + waypoints[i] + '"', 'The script cannot find this system', 'Identify the system.');
    stops.push(s.id);
  }
  var dest = stops[stops.length - 1];
  if (dest === loc) return tpReject_('Already at ' + world.label(dest));
  var ships = f.ships, gp = f.groundPower;
  if (gp > 0 && f.transports * 2 < gp) return tpRuling_('Ground formations need Transports', 'Formations cross lanes only aboard Transports, 2 capacity each (' + f.transports + ' Transports for ' + gp + ')', 'Confirm which formations move.');
  var range = TURN_CONFIG.BASE_JUMP_RANGE + Math.max(0, sim.tiers.Logistics - 1);
  var path = [loc], contested = [];
  var cur = loc;
  for (var j = 0; j < stops.length; j++) {
    var leg = world.shortestPath(cur, stops[j], function (sid) { return world.passable(sim.nid, sid); });
    var legAny = leg || world.shortestPath(cur, stops[j], function () { return true; });
    if (!legAny) return tpReject_('No lane route to ' + world.label(stops[j]));
    if (!leg) contested.push('route to ' + world.label(stops[j]) + ' crosses foreign-held space');
    path = path.concat((leg || legAny).slice(1));
    cur = stops[j];
  }
  var jumps = path.length - 1;
  if (jumps > range) return tpReject_('Beyond jump range: ' + jumps + ' jumps, range ' + range);
  path.slice(1).forEach(function (sid) {
    var owner = world.ownerOf(sid);
    if (owner && owner !== sim.nid) contested.push(world.label(sid) + ' is held by ' + owner);
    var foreign = world.foreignForcesAt(sim.nid, sid);
    if (foreign.length) contested.push('foreign forces at ' + world.label(sid) + ' (' + foreign.join(', ') + ')');
  });
  var details = f.name + ' (' + f.id + '): ' + path.map(function (x) { return world.label(x); }).join(' > ') + ' (' + jumps + ' of ' + range + ' jumps)';
  var spec = { type: 'MOVE', force: f.id, from: loc, to: dest, path: path };
  if (contested.length) {
    return { status: 'Needs ruling', flag: 'Contested move', details: details, spec: spec, cost: {}, strat: {}, stab: 0,
      why: contested.join('; '), suggest: 'Passage, blockade or battle per Movement And Blockade; approve to move it there.' };
  }
  var ev = tpReady_(details, 'Uncontested; within jump range', {}, {}, spec);
  ev.moveRow = f.row;
  return ev;
}

// ---------- SHIFT [<axis>] toward <pole> ----------
function tpEvShift_(world, sim, args) {
  if (sim.gov === 'Collective') return tpReject_('A Collective has no ideology axes');
  var poles = [];
  TURN_CONFIG.AXES.forEach(function (a) { poles = poles.concat(a.poles); });
  var tm = args.match(/toward(?:s)?\s+(\w+)/i);
  var poleText = tm ? tm[1] : (args.match(new RegExp('\\b(' + poles.join('|') + ')\\b', 'ig')) || []).pop();
  var pole = poles.filter(function (p) { return poleText && p.toLowerCase() === String(poleText).toLowerCase(); })[0];
  if (!pole) return tpRuling_('Pole not recognised (write SHIFT <axis> toward <pole>)', 'No ideology pole found', 'Identify the shift.');
  if (sim.shifted) return tpReject_('One ideology shift per turn');
  var axis = TURN_CONFIG.AXES.filter(function (a) { return a.poles.indexOf(pole) >= 0; })[0];
  var curVal = sim.axes[axis.col] || 'Neutral';
  var idx = tpAxisIndex_(axis, curVal);
  var step = axis.poles.indexOf(pole) === 0 ? -1 : 1;
  var nidx = idx + step;
  if (Math.abs(nidx) > 2) return tpReject_('Already Fervent ' + pole);
  var newVal = tpAxisValue_(axis, nidx);
  var trial = Object.assign({}, sim.axes); trial[axis.col] = newVal;
  var fervent = Object.keys(trial).filter(function (k) { return /^Fervent/.test(trial[k]); }).length;
  if (fervent > 2) return tpReject_('At most two Fervent positions');
  if (newVal === 'Fervent Order' && sim.gov === 'Democratic') return tpReject_('Democratic government cannot hold Fervent Order');
  if (newVal === 'Fervent Liberty' && (sim.gov === 'Dictatorial' || sim.gov === 'Imperial')) return tpReject_(sim.gov + ' government cannot hold Fervent Liberty');
  if (axis.col === 'Outward–Inward' && /^Fervent/.test(newVal) && sim.hasCivic('Realpolitik Doctrine')) return tpReject_('Realpolitik Doctrine allows no Fervent position on Outward–Inward');
  var broken = sim.civics.filter(function (c) { return !tpCivicAllowed_(c, sim, trial, sim.gov).ok; });
  // Cost
  var inf = TURN_CONFIG.SHIFT_COST.Influence, stab = TURN_CONFIG.SHIFT_COST.Stability, mults = [];
  if (sim.gov === 'Dictatorial') mults.push(['Dictatorial -25%', 0.75]);
  if (sim.disp === 'Collectivist' || sim.gov === 'Collective') mults.push(['Collectivist x2', 2]);
  if (/Necrophage/i.test(sim.traits)) mults.push(['Necrophage x1.5', 1.5]);
  var awayFromSacred = axis.col === 'Sacred–Secular' && step === 1 && idx <= -1 + 0 && /Sacred/.test(curVal);
  if (sim.hasCivic('Enlightened Creed') && axis.col === 'Sacred–Secular' && step === 1) { stab = stab * 2; }
  var factor = mults.reduce(function (a, b) { return a * b[1]; }, 1);
  factor = Math.max(1 + TURN_CONFIG.COST_FLOOR_PCT / 100, factor);
  var infCost = tpRoundHalfUp_(inf * factor);
  var details = axis.col + ': ' + curVal + ' to ' + newVal;
  var elab = inf + ' Influence' + (mults.length ? ' x ' + factor + ' (' + mults.map(function (x) { return x[0]; }).join(', ') + ') = ' + infCost : '') + ' and ' + stab + ' Stability' + (stab > 1 ? ' (Enlightened Creed: shifting away from Sacred costs double Stability)' : '');
  var spec = { type: 'SHIFT', col: axis.col, value: newVal };
  var ev = tpReady_(details, elab, { Influence: infCost }, {}, spec);
  ev.stab = stab;
  if (broken.length) return Object.assign(ev, { status: 'Needs ruling', flag: 'Civic requirement would fail: ' + broken.join(', '),
    why: 'The shift breaks the requirement of ' + broken.join(', ') + '; the rules do not say what follows', suggest: 'Refuse, or allow and replace the civic.' });
  if (mults.length && TURN_CONFIG.COST_MULTIPLIERS_NEED_RULING) return Object.assign(ev, { status: 'Needs ruling', flag: 'Cost modifier: ' + mults.map(function (x) { return x[0]; }).join(', '),
    why: 'The rules do not say whether the modifier also applies to the Stability cost', suggest: infCost + ' Influence and ' + stab + ' Stability (modifier on Influence only).' });
  return ev;
}

function tpAxisIndex_(axis, val) {
  val = String(val || 'Neutral');
  if (val === 'Fervent ' + axis.poles[0]) return -2;
  if (val === 'Leaning ' + axis.poles[0]) return -1;
  if (val === 'Leaning ' + axis.poles[1]) return 1;
  if (val === 'Fervent ' + axis.poles[1]) return 2;
  return 0;
}
function tpAxisValue_(axis, i) {
  return i === -2 ? 'Fervent ' + axis.poles[0] : i === -1 ? 'Leaning ' + axis.poles[0] : i === 1 ? 'Leaning ' + axis.poles[1] : i === 2 ? 'Fervent ' + axis.poles[1] : 'Neutral';
}

function tpCivicAllowed_(civic, sim, axes, gov) {
  var r = TURN_CONFIG.CIVICS[civic];
  if (!r) return { ok: false, why: 'not a civic in the rules' };
  function holds(pole) {
    if (sim.civics.indexOf('Civil Religion') >= 0 && (pole === 'Sacred' || pole === 'Secular')) return true;
    return Object.keys(axes).some(function (k) { return new RegExp('^(Leaning|Fervent) ' + pole + '$').test(axes[k]); });
  }
  if (r.notGov && gov === r.notGov) return { ok: false, why: 'not allowed with ' + gov + ' government' };
  if (r.pole && !holds(r.pole)) return { ok: false, why: 'requires ' + r.pole };
  if (r.neutralAxis && (axes[r.neutralAxis] || 'Neutral') !== 'Neutral') return { ok: false, why: 'requires Neutral on ' + r.neutralAxis };
  if (r.trait && sim.traits.indexOf(r.trait) < 0) return { ok: false, why: 'requires the ' + r.trait + ' trait' };
  if (r.organic && sim.bio !== 'Organic') return { ok: sim.bio === 'Cybernetic' ? 'ask' : false, why: 'requires a species at least 50% organic' };
  if (r.biology && r.biology.indexOf(sim.bio) < 0) return { ok: false, why: 'requires ' + r.biology.join(' or ') + ' biology' };
  if (r.habitat && sim.habitat !== r.habitat) return { ok: false, why: 'requires ' + r.habitat + ' habitat' };
  return { ok: true };
}

// ---------- CIVIC replace <old> with <new> | CIVIC <new> [for|replacing <old>] ----------
function tpEvCivic_(world, sim, args) {
  var names = Object.keys(TURN_CONFIG.CIVICS);
  var m = args.match(/^(?:replace\s+)?(.+?)\s+(?:with|by|->|→|>)\s+(.+)$/i);
  var oldC = '', newC = '';
  if (m && /^replace/i.test(args)) { oldC = m[1]; newC = m[2]; }
  else {
    var m2 = args.match(/^(?:adopt\s+|add\s+)?(.+?)\s+(?:for|replacing|in place of|instead of)\s+(.+)$/i);
    if (m2) { newC = m2[1]; oldC = m2[2]; } else if (m) { oldC = m[1]; newC = m[2]; } else newC = args.replace(/^(?:adopt|add)\s+/i, '');
  }
  var nc = names.filter(function (x) { return tpNorm_(x) === tpNorm_(newC); })[0];
  if (!nc) return tpRuling_('Civic not recognised: "' + newC + '"', 'Not a civic in the rules', 'Identify the civic.');
  var oc = oldC ? names.filter(function (x) { return tpNorm_(x) === tpNorm_(oldC); })[0] : '';
  if (oldC && !oc) return tpRuling_('Civic not recognised: "' + oldC + '"', 'Not a civic in the rules', 'Identify the civic.');
  if (sim.civics.indexOf(nc) >= 0) return tpReject_('Already holds ' + nc);
  if (oc && sim.civics.indexOf(oc) < 0) return tpReject_('Does not hold ' + oc);
  var after = sim.civics.filter(function (c) { return c !== oc; }).concat([nc]);
  var allowed = tpCivicAllowed_(nc, Object.assign({}, sim, { civics: after }), sim.axes, sim.gov);
  if (allowed.ok === false) return tpReject_(nc + ' ' + allowed.why);
  var slots = 2 + (sim.tiers.Society >= 3 ? 1 : 0) + (sim.tiers.Society >= 5 ? 1 : 0);
  if (!oc) {
    if (sim.civics.length >= slots) return tpReject_('All ' + slots + ' civic slots are full; name the civic to replace');
    var col0 = TURN_CONFIG.CIVIC_COLUMNS[sim.civics.length];
    return tpRuling_('Filling an empty civic slot', 'The rules give no cost for adopting a civic in a free slot', 'Free, or the replacement price (20 Influence, 1 Stability).',
      { details: 'Adopt ' + nc + ' in ' + col0, spec: { type: 'CIVIC', col: col0, value: nc, old: '' }, cost: {}, strat: {}, stab: 0 });
  }
  var col = TURN_CONFIG.CIVIC_COLUMNS.filter(function (c) { return sim.civicCols[c] === oc; })[0];
  var inf = TURN_CONFIG.CIVIC_REPLACE_COST.Influence, stab = TURN_CONFIG.CIVIC_REPLACE_COST.Stability, mults = [];
  if (sim.gov === 'Oligarchic') mults.push(['Oligarchic -25%', 0.75]);
  var sec = sim.axes['Sacred–Secular'] || '';
  if (/Secular$/.test(sec)) mults.push([sec + ': half', 0.5]);
  if (sim.disp === 'Collectivist' || sim.gov === 'Collective') mults.push(['Collectivist x2', 2]);
  if (/Necrophage/i.test(sim.traits)) mults.push(['Necrophage x1.5', 1.5]);
  var factor = Math.max(1 + TURN_CONFIG.COST_FLOOR_PCT / 100, mults.reduce(function (a, b) { return a * b[1]; }, 1));
  var infCost = tpRoundHalfUp_(inf * factor);
  var ev = tpReady_(col + ': ' + oc + ' to ' + nc, inf + ' Influence' + (mults.length ? ' x ' + factor + ' (' + mults.map(function (x) { return x[0]; }).join(', ') + ') = ' + infCost : '') + ' and ' + stab + ' Stability',
    { Influence: infCost }, {}, { type: 'CIVIC', col: col, value: nc, old: oc });
  ev.stab = stab;
  if (allowed.ok === 'ask') return Object.assign(ev, { status: 'Needs ruling', flag: nc + ': ' + allowed.why, why: 'Cybernetic biology may or may not be 50% organic', suggest: 'Rule on the species.' });
  if (sim.gov === 'Democratic') return Object.assign(ev, { status: 'Needs ruling', flag: 'Democratic election', why: 'A Democracy replaces one civic free every 4 turns', suggest: 'Free if an election is due; otherwise ' + infCost + ' Influence and ' + stab + ' Stability.' });
  if (mults.length && TURN_CONFIG.COST_MULTIPLIERS_NEED_RULING) return Object.assign(ev, { status: 'Needs ruling', flag: 'Cost modifier: ' + mults.map(function (x) { return x[0]; }).join(', '),
    why: 'The rules do not say whether the modifier also applies to the Stability cost', suggest: infCost + ' Influence and ' + stab + ' Stability (modifier on Influence only).' });
  return ev;
}

// ---------- REFORM <government> ----------
function tpEvReform_(world, sim, args) {
  var g = args.replace(/^(?:to|into|as)\s+/i, '').trim();
  var gov = TURN_CONFIG.GOVERNMENTS.filter(function (x) { return tpNorm_(x) === tpNorm_(g) || tpNorm_(g).indexOf(tpNorm_(x)) === 0; })[0];
  if (!gov) return tpRuling_('Reform not of a Government Type', 'Fiscal and other reforms are ruled by the GM', 'Rule per The Fiscal Code (1 current Stability per line changed, at most 3) or as described.');
  if (gov === sim.gov) return tpReject_('Already ' + gov);
  if (sim.reformed) return tpReject_('Already reforming the government this turn');
  if (gov === 'Collective') {
    if (sim.disp !== 'Collectivist') return tpReject_('Collective government is for Collectivist species only');
    return tpRuling_('Reform to Collective', 'A Collective holds no ideology axes; the GM sets how the axes are cleared', '30 Influence and 2 Stability; set all four axes to Neutral.',
      { cost: { Influence: TURN_CONFIG.REFORM_COST.Influence }, stab: TURN_CONFIG.REFORM_COST.Stability, spec: { type: 'REFORM', gov: gov }, details: sim.gov + ' to ' + gov });
  }
  if (gov === 'Democratic' && sim.axes['Order–Liberty'] === 'Fervent Order') return tpReject_('Democratic government cannot hold Fervent Order');
  if ((gov === 'Dictatorial' || gov === 'Imperial') && sim.axes['Order–Liberty'] === 'Fervent Liberty') return tpReject_(gov + ' government cannot hold Fervent Liberty');
  var broken = sim.civics.filter(function (c) { return tpCivicAllowed_(c, sim, sim.axes, gov).ok === false; });
  var ev = tpReady_(sim.gov + ' to ' + gov, '30 Influence and 2 Stability; check the Fiscal tab: a line put out of bounds falls to the highest permitted intensity',
    { Influence: TURN_CONFIG.REFORM_COST.Influence }, {}, { type: 'REFORM', gov: gov });
  ev.stab = TURN_CONFIG.REFORM_COST.Stability;
  if (broken.length) return Object.assign(ev, { status: 'Needs ruling', flag: 'Civic not allowed under ' + gov + ': ' + broken.join(', '), why: 'The new government breaks a civic requirement', suggest: 'Refuse, or allow and replace the civic.' });
  return ev;
}

// ---------- TRANSFER <amount> <resource>[, ...] to <nation> ----------
function tpEvTransfer_(world, sim, args) {
  var m = args.match(/^(.*)\s+to\s+(.+)$/i);
  if (!m) return tpRuling_('Recipient not found (write TRANSFER <amount> <resource> to <nation>)', 'No recipient', 'Identify the transfer.');
  var to = world.nationByName(m[2].trim());
  if (!to) return tpRuling_('Nation not found: "' + m[2] + '"', 'No such nation on the Nations tab', 'Identify the recipient.');
  if (to.id === sim.nid) return tpReject_('Cannot transfer to itself');
  var items = {}, ok = true;
  m[1].split(/\s*(?:,|\band\b|\+)\s*/i).forEach(function (part) {
    var pm = part.trim().match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (!pm) { ok = false; return; }
    var res = TURN_CONFIG.RESOURCES.concat(TURN_CONFIG.STRATEGIC).filter(function (r) { return tpNorm_(r) === tpNorm_(pm[2]) || tpNorm_(r) === tpNorm_(pm[2]).replace(/s$/, ''); })[0];
    if (!res) { ok = false; return; }
    items[res] = (items[res] || 0) + Number(pm[1]);
  });
  if (!ok || !Object.keys(items).length) return tpRuling_('Amounts not readable', 'Write amounts as "10 Industry, 2 Adamant ore"', 'Identify the transfer.');
  var cost = {}, strat = {};
  Object.keys(items).forEach(function (r) { if (TURN_CONFIG.RESOURCES.indexOf(r) >= 0) cost[r] = items[r]; else strat[r] = items[r]; });
  return tpReady_(Object.keys(items).map(function (r) { return items[r] + ' ' + r; }).join(', ') + ' to ' + to.id, 'Diplomacy phase', cost, strat,
    { type: 'TRANSFER', to: to.id, items: items });
}

// ---------- STABILITY ----------
function tpEvStability_(world, sim, args) {
  if (args && !/^\+?1?\s*$/.test(args)) return tpRuling_('Only one point of Stability may be bought a turn', 'Unreadable amount', 'Treat as one point.');
  if (sim.gov === 'Collective') return tpReject_('A Collective cannot buy Stability with Influence');
  if (sim.stabBought) return tpReject_('Stability may be bought once a turn');
  var target = tpNum_(sim.calc['Stability target']);
  if (sim.stability + 1 > target) return tpReject_('Bought Stability never raises it above its target (' + sim.stability + ' of ' + target + ')');
  var ev = tpReady_('+1 Stability (' + sim.stability + ' to ' + (sim.stability + 1) + ', target ' + target + ')', '5 Influence', { Influence: TURN_CONFIG.STABILITY_PURCHASE_INFLUENCE }, {}, { type: 'STABILITY' });
  ev.stab = -1;
  return ev;
}

// ---------- CONTACT <strategy> @ <system> ----------
function tpEvContact_(world, sim, args) {
  var strategies = Object.keys(TURN_CONFIG.CONTACT_COSTS).concat(['Uplift', 'Integrate', 'Ascension']);
  var strat = strategies.filter(function (s) { return tpNorm_(args).indexOf(tpNorm_(s)) >= 0; })[0];
  var p = tpSplitAt_(args);
  var sys = p ? world.findSystem(p.where) : null;
  var cost = {};
  var note = 'Roll per Contact Strategies';
  if (strat && TURN_CONFIG.CONTACT_COSTS[strat]) cost = Object.assign({}, TURN_CONFIG.CONTACT_COSTS[strat]);
  if (strat === 'Uplift' && sys) {
    var era = String(sys.get('Native era') || '');
    if (TURN_CONFIG.UPLIFT_COST_BY_ERA[era]) cost = { Influence: TURN_CONFIG.UPLIFT_COST_BY_ERA[era] };
  }
  if (strat === 'Integrate') note = 'A ground battle';
  return tpRuling_('Contact: ' + (strat || 'strategy not named'), 'Contact strategies are rolled by the GM', (Object.keys(cost).length ? 'Cost ' + tpCostText_(cost) + ' (charged on Approve); ' : '') + note + '.',
    { details: (strat || '?') + (sys ? ' at ' + tpSysLabel_(sys) : ''), cost: cost, strat: {}, stab: 0, spec: { type: 'CHARGE_ONLY' } });
}

// ---------- shared checks ----------
function tpAffordable_(sim, ev) {
  var short = [];
  var c = ev.cost || {}, s = ev.strat || {};
  Object.keys(c).forEach(function (r) { if (c[r] > 0 && (sim.stock[r] || 0) + 1e-9 < c[r]) short.push(c[r] + ' ' + r + ' needed, ' + tpRound1_(sim.stock[r] || 0) + ' projected'); });
  Object.keys(s).forEach(function (r) { if (s[r] > 0 && (sim.stock[r] || 0) + 1e-9 < s[r]) short.push(s[r] + ' ' + r + ' needed, ' + tpRound1_(sim.stock[r] || 0) + ' held'); });
  return { ok: !short.length, text: short.join('; ') };
}

function tpCommitSim_(sim, ev) {
  var c = ev.cost || {}, s = ev.strat || {};
  Object.keys(c).forEach(function (r) { sim.stock[r] = tpRound2_((sim.stock[r] || 0) - c[r]); });
  Object.keys(s).forEach(function (r) { sim.stock[r] = (sim.stock[r] || 0) - s[r]; });
  sim.stability = Math.max(0, Math.min(10, sim.stability - (ev.stab || 0)));
  var sp = ev.spec || {};
  switch (sp.type) {
    case 'DEVELOP': sim.devRaised[sp.sys] = sp.level; break;
    case 'DESIGNATE': sim.desigChanged[sp.sys] = sp.desig; sim.desigNow[sp.sys] = sp.desig; break;
    case 'BUILD': sim.slotsAdded[sp.sys] = (sim.slotsAdded[sp.sys] || 0) + 1; (sim.newBuildings[sp.sys] = sim.newBuildings[sp.sys] || []).push(sp.building); break;
    case 'SHIP': sim.shipCapAdded += ev.capAdd || 0; break;
    case 'GROUND': sim.armyCapAdded += ev.armyAdd || 0; break;
    case 'DEFENCE': sim.staticAdded[sp.sys] = (sim.staticAdded[sp.sys] || 0) + (sp.points || 0); break;
    case 'RESEARCH': sim.researched[sp.branch] = sp.tier; break;
    case 'COLONIZE': sim.owned[sp.sys] = true; sim.colonized[sp.sys] = true; sim.taken[sp.sys] = true; sim.settlersOut += TURN_CONFIG.COLONY_SETTLERS_BN; if (sp.desig) sim.desigNow[sp.sys] = sp.desig; break;
    case 'MOVE': sim.moved[ev.moveRow] = true; break;
    case 'SHIFT': sim.shifted = true; sim.axes[sp.col] = sp.value; break;
    case 'CIVIC': sim.civicCols[sp.col] = sp.value; sim.civics = TURN_CONFIG.CIVIC_COLUMNS.map(function (k) { return sim.civicCols[k]; }).filter(function (x) { return x; }); break;
    case 'REFORM': sim.reformed = true; sim.gov = sp.gov; break;
    case 'STABILITY': sim.stabBought = true; break;
  }
}

// =====================================================================
// RESOLVE
// =====================================================================
function tpDoResolve_(ss, opts) {
  var dry = !!opts.dry;
  var mode = dry ? 'Dry run' : 'Live';
  var turn = tpCurrentTurn_(ss) + 1;
  var model = new tpModel_(ss, { dry: dry });
  if (dry) model.startPreview('Resolve turn ' + turn);
  var stats = { ledger: 0, applied: 0, outstanding: 0, errors: 0, notes: [] };

  var A = model.tab('Actions');
  var prepared = A.rows().some(function (r) { return tpNum_(A.get(r, 'Turn')) === turn && A.get(r, 'Nation') !== ''; }) || tpPreparedInRunLog_(model, turn);
  if (!prepared) {
    if (!dry) {
      tpLogRun_(ss, 'resolveTurn', mode, turn, 'Refused', 'Turn ' + turn + ' has not been prepared.');
      return { ok: false, summary: 'Resolve T' + turn + ' refused: not prepared' };
    }
    tpPrepareInModel_(model, turn);
    stats.notes.push('prepared in memory first');
  }
  // GM-decision gate.
  var R = model.tab('Rulings');
  var open = R.rows().filter(function (r) {
    return tpNum_(R.get(r, 'Turn')) === turn && R.get(r, 'Item') !== '' &&
      !String(R.get(r, 'GM decision') || '').trim() && String(R.get(r, 'Status') || '').trim() !== 'Settled';
  });
  stats.outstanding = open.length;
  if (open.length && !dry) {
    var list = open.map(function (r) { return R.get(r, 'Nation') + ': ' + String(R.get(r, 'Item')).slice(0, 60); }).join('; ');
    tpLogRun_(ss, 'resolveTurn', mode, turn, 'Refused', open.length + ' ruling(s) await a GM decision: ' + list);
    return { ok: false, summary: 'Resolve T' + turn + ' refused: ' + open.length + ' rulings outstanding' };
  }
  if (open.length) stats.notes.push(open.length + ' undecided rulings treated as not applied');
  if (model.tab('Turn log').rows().some(function (r) { return tpNum_(model.tab('Turn log').get(r, 'Turn')) === turn && model.tab('Turn log').get(r, 'Event') !== ''; })) {
    tpLogRun_(ss, 'resolveTurn', mode, turn, 'Refused', 'The Turn log already holds lines for turn ' + turn + '; restore the snapshot before running again.');
    return { ok: false, summary: 'Resolve T' + turn + ' refused: Turn log already has turn ' + turn };
  }
  // Snapshot.
  if (!dry && String(tpGetControl_(ss, 'Snapshots') || 'Yes').trim().toLowerCase() !== 'no') {
    var file = DriveApp.getFileById(ss.getId());
    var parents = file.getParents();
    var folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    file.makeCopy(TURN_CONFIG.SNAPSHOT_PREFIX + turn, folder);
  }

  var ctx = new tpResolver_(model, turn, stats);
  try {
    ctx.run(dry);
  } catch (e) {
    stats.errors++;
    tpLogRun_(ss, 'resolveTurn', mode, turn, 'Failed', String(e && e.stack ? e.stack : e));
    if (!dry) { model.commit(); }
    return { ok: false, summary: 'Resolve T' + turn + ' failed: ' + e.message };
  }
  model.commit();
  var summary = 'Resolve T' + turn + ' (' + mode.toLowerCase() + '): ' + stats.ledger + ' Ledger lines, ' + stats.applied + ' actions applied, ' +
    stats.outstanding + ' rulings outstanding, ' + stats.errors + ' errors' + (stats.notes.length ? ' (' + stats.notes.join('; ') + ')' : '');
  tpLogRun_(ss, 'resolveTurn', mode, turn, 'Resolved', summary);
  return { ok: stats.errors === 0, summary: summary, stats: stats };
}

function tpPreparedInRunLog_(model, turn) {
  var L = model.tab('Run log');
  return L.rows().some(function (r) { return L.get(r, 'Function') === 'prepareTurn' && tpNum_(L.get(r, 'Turn')) === turn && L.get(r, 'Mode') === 'Live' && L.get(r, 'Result') === 'Prepared'; });
}

function tpResolver_(model, turn, stats) {
  this.model = model; this.turn = turn; this.stats = stats;
  this.world = new tpWorld_(model);
  this.L = model.tab('Ledger'); this.A = model.tab('Actions'); this.R = model.tab('Rulings'); this.TL = model.tab('Turn log');
  this.completions = [];
}

tpResolver_.prototype.run = function (dry) {
  var w = this.world, self = this;
  // Values as they stand at the start of the resolution.
  this.startGrowth = {}; this.startToll = {};
  w.systems.forEach(function (s) {
    self.startGrowth[s.id] = tpNum_(s.get('Growth due (bn)'));
    var aq = s.get('Change this turn');
    self.startToll[s.id] = { change: aq === '' ? 0 : tpNum_(aq), crowded: String(s.get('Overcrowded')) === 'Yes', owner: s.get('Owner') };
  });
  this.decisions = this.readDecisions();
  this.actions = this.readActions();

  this.phaseDiplomacy();
  this.phaseIncome();
  this.phaseUpkeep();
  this.phaseSpending();
  this.phaseMovement();
  this.phasePopulation();
  this.phaseWorldToll();
  this.phaseInfamy();
  this.phaseCompletions();
  if (!dry) { this.model.commit(); tpFlush_(); this.model.reload('Calculations'); this.world.reloadCalc(); }
  this.phaseStability();
  this.log('Resolution', 'All', 'Turn resolved', 'Turn ' + this.turn + ' resolved', 'Yes', '');
};

/** Ledger line (columns B to I and K only). */
tpResolver_.prototype.ledger = function (phase, nation, resource, amount, reason, working, actionRow, shown) {
  if (!amount && amount !== 0) return;
  this.L.add('Nation', { 'Turn': this.turn, 'Phase': phase, 'Nation': nation, 'Resource': resource, 'Amount': tpRound2_(amount),
    'Reason': reason, 'Working': working || '', 'Action row': actionRow || '', 'Shown to player': shown === false ? 'No' : 'Yes' });
  this.stats.ledger++;
  return this.L.lastAdded;
};
tpResolver_.prototype.log = function (phase, nations, event, desc, isPublic, actionRow) {
  this.TL.add('Event', { 'Turn': this.turn, 'Phase': phase, 'Nations': nations, 'Event': event, 'Description': desc, 'Roll': '',
    'Public': isPublic || 'No', 'Action row': actionRow || '' });
};

tpResolver_.prototype.readDecisions = function () {
  var R = this.R, turn = this.turn, out = {};
  R.rows().forEach(function (r) {
    if (tpNum_(R.get(r, 'Turn')) !== turn) return;
    var src = String(R.get(r, 'Source') || '');
    var dec = String(R.get(r, 'GM decision') || '').trim();
    var st = String(R.get(r, 'Status') || '').trim();
    var m = src.match(/Actions row (\d+)/);
    var key = m ? 'A' + m[1] : src + '|' + R.get(r, 'Nation');
    out[key] = { row: r, decision: dec, settled: st === 'Settled', kind: /^approve/i.test(dec) ? 'approve' : /^reject/i.test(dec) ? 'reject' : (dec || st === 'Settled') ? 'other' : 'open' };
  });
  return out;
};

tpResolver_.prototype.readActions = function () {
  var A = this.A, turn = this.turn, list = [];
  A.rows().forEach(function (r) {
    if (tpNum_(A.get(r, 'Turn')) !== turn || A.get(r, 'Nation') === '') return;
    list.push({ row: r, actionNo: r, nation: A.get(r, 'Nation'), channel: A.get(r, 'Channel'), text: String(A.get(r, 'Posted text')),
      verb: A.get(r, 'Verb') === 'COVERT' ? 'COVERT' : tpMakeOrder_(String(A.get(r, 'Posted text')), '', '').verb,
      status: String(A.get(r, 'Status')) });
  });
  return list;
};

tpResolver_.prototype.costFromRow = function (r) {
  var A = this.A, cost = {};
  TURN_CONFIG.RESOURCES.forEach(function (res) { var v = A.get(r, res); if (v !== '' && tpNum_(v)) cost[res] = tpNum_(v); });
  return { cost: cost, strat: tpParseStrat_(A.get(r, 'Strategic')) };
};

tpResolver_.prototype.setStatus = function (a, status, flagAdd) {
  this.A.set(a.row, 'Status', status);
  if (flagAdd) { var f = this.A.get(a.row, 'Flag'); this.A.set(a.row, 'Flag', (f ? f + '; ' : '') + flagAdd); }
  a.status = status;
};

/** Decides whether an action goes ahead; returns 'go', or sets its status and returns 'stop'. */
tpResolver_.prototype.gate = function (a) {
  var d = this.decisions['A' + a.actionNo];
  if (a.status === 'Ready') return 'go';
  if (a.status === 'Needs ruling') {
    if (!d || d.kind === 'open') { this.setStatus(a, 'Not applied', 'No GM decision'); return 'stop'; }
    this.A.set(a.row, 'GM ruling', d.decision || 'Settled');
    if (d.kind === 'approve') { this.settleRuling(d); return 'go'; }
    if (d.kind === 'reject') { this.setStatus(a, 'Rejected by GM'); this.settleRuling(d); return 'stop'; }
    this.setStatus(a, 'Settled by GM'); this.settleRuling(d); return 'stop';
  }
  return 'stop'; // Rejected, Duplicate, Condition failed, Applied ...
};
tpResolver_.prototype.settleRuling = function (d) { if (d) this.R.set(d.row, 'Status', 'Settled'); };

tpResolver_.prototype.simFor = function (nid) {
  this.sims = this.sims || {};
  if (!this.sims[nid]) {
    var n = this.world.nation(nid);
    this.sims[nid] = this.world.newSim(n, 'resolve', this);
  }
  return this.sims[nid];
};

/** Re-reads an action against the current state; costs come from the Actions row. */
tpResolver_.prototype.reevaluate = function (a) {
  var sim = this.simFor(a.nation);
  var self = this;
  var earlier = this.actions.filter(function (b) { return b.nation === a.nation && b.row < a.row; }).map(function (b) {
    return { text: b.text, verb: b.verb, actionNo: b.actionNo, ev: { status: b.status === 'Applied' ? 'Applied' : b.status, spec: b.spec } };
  });
  var sc = tpStripCondition_(a.text);
  if (sc.cond) {
    var c = tpCheckCondition_(this.world, sim, sc.cond, earlier);
    if (c.result === 'false') return { status: 'Condition failed', flag: c.note };
    if (c.result === 'pending') return { status: 'Condition failed', flag: c.note + ' (not applied)' };
  }
  var ev = tpEvaluateBody_(this.world, sim, a.verb, sc.body, a, 'resolve');
  var fromRow = this.costFromRow(a.row);
  if (ev.status !== 'Rejected') { ev.cost = fromRow.cost; ev.strat = fromRow.strat; }
  return ev;
};

// ---------------- Phase 1: Diplomacy ----------------
tpResolver_.prototype.phaseDiplomacy = function () {
  var self = this;
  this.actions.filter(function (a) { return a.verb === 'TRANSFER'; }).forEach(function (a) {
    if (self.gate(a) !== 'go') return;
    var ev = self.reevaluate(a);
    if (ev.status === 'Rejected' || ev.status === 'Condition failed' || !ev.spec) { self.setStatus(a, 'Failed', ev.flag); return; }
    // Transfers are checked against the stockpile projected after this turn's income and upkeep.
    var sim = self.simFor(a.nation);
    var proj = self.world.projectedStock(a.nation);
    var items = ev.spec.items, short = [];
    Object.keys(items).forEach(function (r) { if ((proj[r] || 0) - (sim.spent[r] || 0) + 1e-9 < items[r]) short.push(items[r] + ' ' + r); });
    if (short.length) { self.setStatus(a, 'Failed', 'Unaffordable at resolution: ' + short.join(', ')); return; }
    var lines = [];
    Object.keys(items).forEach(function (r) {
      sim.spent[r] = (sim.spent[r] || 0) + items[r];
      lines.push(self.ledger('Diplomacy', a.nation, r, -items[r], 'Transfer to ' + ev.spec.to, a.text, a.actionNo));
      lines.push(self.ledger('Diplomacy', ev.spec.to, r, items[r], 'Transfer from ' + a.nation, a.text, a.actionNo));
    });
    self.A.set(a.row, 'Ledger lines', lines.join(', '));
    self.setStatus(a, 'Applied'); a.spec = ev.spec;
    self.settleRuling(self.decisions['A' + a.actionNo]);
    self.stats.applied++;
  });
  // Treaty fees (Treaties: Fee payer, Fee payee, Fee per turn, Fee resource).
  var T = this.model.tab('Treaties');
  T.rows().forEach(function (r) {
    if (T.get(r, 'Status') !== 'Active') return;
    var payer = T.get(r, 'Fee payer'), payee = T.get(r, 'Fee payee'), fee = tpNum_(T.get(r, 'Fee per turn')), res = T.get(r, 'Fee resource') || 'Influence';
    if (!payer || !payee || !fee) return;
    self.ledger('Diplomacy', payer, res, -fee, 'Treaty fee ' + T.get(r, 'Treaty ID') + ' to ' + payee, T.get(r, 'Type'), '');
    self.ledger('Diplomacy', payee, res, fee, 'Treaty fee ' + T.get(r, 'Treaty ID') + ' from ' + payer, T.get(r, 'Type'), '');
  });
};

// ---------------- Phase 2: Income ----------------
tpResolver_.prototype.phaseIncome = function () {
  var self = this, w = this.world;
  w.activeNations().forEach(function (n) {
    var c = w.calc(n.id);
    if (!c) return;
    TURN_CONFIG.RESOURCES.forEach(function (r) {
      var net = tpNum_(c[TURN_CONFIG.NET_INCOME_HEADERS[r]]);
      self.ledger('Income', n.id, r, net, r + ' income', tpIncomeWorking_(c, r, n), '');
    });
    TURN_CONFIG.STRATEGIC.forEach(function (r) {
      var v = tpNum_(c[r]);
      if (v) self.ledger('Income', n.id, r, v, r + ' from deposits', 'Systems output (Calculations ' + r + ')', '');
    });
  });
};

function tpIncomeWorking_(c, r, n) {
  var gross = tpNum_(c[TURN_CONFIG.GROSS_HEADERS[r]]);
  var pct = tpNum_(c[TURN_CONFIG.PCT_HEADERS[r]]);
  var net = tpNum_(c[TURN_CONFIG.NET_INCOME_HEADERS[r]]);
  var parts = [];
  var cons = tpNum_(c['Consolidation %']); if (cons) parts.push('consolidation ' + tpSigned_(cons));
  var band = tpNum_(c['Stability band %']); if (band) parts.push('Stability ' + tpSigned_(band));
  var trade = 5 * Math.min(tpNum_(c['Trade agreements']), tpNum_(c['Trade slots'])); if (trade) parts.push('trade ' + tpSigned_(trade));
  var tariff = tpNum_(c['Tariff losses %']); if (tariff) parts.push('tariffs ' + tpSigned_(-tariff));
  var fr = tpNum_(c['Fiscal revenue %']); if (fr) parts.push('fiscal revenue ' + tpSigned_(fr));
  var fres = tpNum_(c[TURN_CONFIG.FISCAL_PCT_HEADERS[r]]); if (fres) parts.push('fiscal ' + r + ' ' + tpSigned_(fres));
  var renown = r === 'Influence' ? tpNum_(c['Renown Influence %']) : 0; if (renown) parts.push('Renown ' + tpSigned_(renown));
  var listed = cons + band + trade - tariff + fr + fres + renown;
  var other = tpRound2_(pct - listed); if (other) parts.push('government, ideology, civics, species and technology ' + tpSigned_(other));
  var raw = gross * (1 + pct / 100);
  var caretaker = n.status === 'Caretaker' ? ' x 50% (Caretaker)' : '';
  return 'Gross ' + gross + ' x (1 ' + (pct >= 0 ? '+ ' : '- ') + Math.abs(pct) + '%)' + caretaker + ' = ' + tpRound2_(raw * (caretaker ? 0.5 : 1)) + ' -> ' + net +
    (parts.length ? '. Modifiers: ' + parts.join(', ') : '');
}

// ---------------- Phase 3: Upkeep ----------------
tpResolver_.prototype.phaseUpkeep = function () {
  var self = this, w = this.world;
  w.activeNations().forEach(function (n) {
    var c = w.calc(n.id);
    if (!c) return;
    var energy = tpRound2_(w.stock(n.id, 'Energy'));
    var U = tpNum_(c['Ship capacity used']), W = tpNum_(c['Ground Power']);
    var X = tpNum_(c['Upkeep Energy']);
    var Y = tpNum_(c['Upkeep Volatile isotopes']);
    var militia = n.civics.indexOf('Citizen Militia') >= 0;
    if (X > energy + 1e-9) {
      var dis = w.disbandFor(n.id, energy, militia);
      self.log('Upkeep', n.id, 'Disbanded', 'Upkeep ' + X + ' Energy, ' + energy + ' held: disbanded ' + dis.text + '; new upkeep ' + dis.upkeep, 'No', '');
      self.ledger('Upkeep', n.id, 'Stability', -1, 'Failing to pay upkeep', 'Disbanded ' + dis.text, '');
      U = dis.U; W = dis.W; X = dis.upkeep;
    }
    if (X) self.ledger('Upkeep', n.id, 'Energy', -X, 'Upkeep of forces',
      'Ship capacity ' + U + ' -> ROUNDUP(' + U + '/2) = ' + Math.ceil(U / 2) + (militia ? '; Citizen Militia: no ground wages' : '; Ground Power ' + W + ' -> ROUNDUP(' + W + '/4) = ' + Math.ceil(W / 4)) + ' (Calculations Upkeep Energy)', '');
    if (Y) {
      var iso = w.stock(n.id, 'Volatile isotopes');
      if (Y > iso) {
        var d2 = w.disbandDreadnoughts(n.id, Y - iso);
        self.log('Upkeep', n.id, 'Disbanded', 'Dreadnought upkeep ' + Y + ' Volatile isotopes, ' + iso + ' held: disbanded ' + d2 + ' Dreadnought(s)', 'No', '');
        self.ledger('Upkeep', n.id, 'Stability', -1, 'Failing to pay upkeep', 'Disbanded ' + d2 + ' Dreadnought(s)', '');
        Y = Y - d2;
      }
      if (Y) self.ledger('Upkeep', n.id, 'Volatile isotopes', -Y, 'Dreadnought upkeep', '1 per Dreadnought', '');
    }
    var BW = tpNum_(c['Upkeep Influence']);
    if (BW) {
      var infl = w.stock(n.id, 'Influence');
      var pay = Math.min(BW, Math.max(0, infl));
      if (pay) self.ledger('Upkeep', n.id, 'Influence', -pay, 'Trade agreement upkeep', BW + ' agreement(s) in force x 1 Influence', '');
      if (pay < BW) self.log('Upkeep', n.id, 'Unpaid upkeep', 'Trade agreement upkeep short by ' + tpRound2_(BW - pay) + ' Influence: GM to rule', 'No', '');
    }
    self.payDebts(n);
  });
};

/** Debt instalments: taken with upkeep, from the largest of Industry, Energy and Influence first. */
tpResolver_.prototype.payDebts = function (n) {
  var self = this, D = this.model.tab('Debts'), w = this.world;
  D.rows().forEach(function (r) {
    if (D.get(r, 'Debtor') !== n.id || D.get(r, 'Status') !== 'Active') return;
    var inst = tpNum_(D.get(r, 'Instalment (SM)')), issued = tpNum_(D.get(r, 'Issued (turn)')), term = tpNum_(D.get(r, 'Term (turns)'));
    if (!inst || self.turn <= issued || self.turn > issued + term) return;
    var id = D.get(r, 'Debt ID'), creditor = D.get(r, 'Creditor');
    var left = inst, parts = [];
    while (left > 0.0001) {
      var best = ['Industry', 'Energy', 'Influence'].map(function (k) { return [k, w.stock(n.id, k)]; }).sort(function (a, b) { return b[1] - a[1]; })[0];
      if (best[1] <= 0) break;
      var take = tpRound2_(Math.min(left, best[1]));
      self.ledger('Upkeep', n.id, best[0], -take, 'Instalment ' + id, 'Instalment ' + inst + ' SM, paid from the largest stockpile', '');
      if (creditor && creditor !== 'Domestic') self.ledger('Upkeep', creditor, best[0], take, 'Instalment ' + id + ' from ' + n.id, '', '');
      parts.push(take + ' ' + best[0]);
      left = tpRound2_(left - take);
    }
    if (left > 0.0001) self.log('Upkeep', n.id, 'Arrears', id + ' short by ' + left + ' SM: -1 current Stability while in arrears (GM to confirm)', 'No', '');
  });
};

// ---------------- Phase 4: Spending ----------------
tpResolver_.prototype.phaseSpending = function () {
  var self = this;
  this.actions.forEach(function (a) {
    if (a.verb === 'TRANSFER' || a.verb === 'MOVE') return;
    if (a.verb === 'COVERT') {
      var d = self.decisions['A' + a.actionNo];
      if (d && d.kind !== 'open') { self.A.set(a.row, 'GM ruling', d.decision || 'Settled'); self.setStatus(a, 'Settled by GM'); self.settleRuling(d); }
      else self.setStatus(a, 'Not applied', 'No GM decision');
      return;
    }
    if (self.gate(a) !== 'go') return;
    var ev = self.reevaluate(a);
    var approved = a.status === 'Needs ruling';
    if (ev.status === 'Condition failed') { self.setStatus(a, 'Condition failed', ev.flag); return; }
    if (ev.status === 'Rejected' || ev.status === 'Duplicate') { self.setStatus(a, 'Failed', ev.flag); return; }
    if (ev.status === 'Needs ruling' && !approved) { self.setStatus(a, 'Not applied', ev.flag); return; }
    if (!ev.spec) { self.setStatus(a, 'Settled by GM', 'Approved; nothing the script can apply'); self.settleRuling(self.decisions['A' + a.actionNo]); return; }
    var sim = self.simFor(a.nation);
    var aff = tpAffordable_(sim, ev);
    if (!aff.ok) { self.setStatus(a, 'Failed', 'Unaffordable at resolution: ' + aff.text); return; }
    tpCommitSim_(sim, ev);
    var lines = [];
    var reason = a.verb + ' ' + (ev.details || '');
    Object.keys(ev.cost || {}).forEach(function (r) { if (ev.cost[r]) lines.push(self.ledger('Spending', a.nation, r, -ev.cost[r], reason, ev.elab || '', a.actionNo)); });
    Object.keys(ev.strat || {}).forEach(function (r) { if (ev.strat[r]) lines.push(self.ledger('Spending', a.nation, r, -ev.strat[r], reason, ev.elab || '', a.actionNo)); });
    if (ev.stab) lines.push(self.ledger('Spending', a.nation, 'Stability', -ev.stab, reason, ev.stab > 0 ? 'Stability cost' : 'Bought with 5 Influence', a.actionNo));
    self.apply(a, ev.spec);
    self.A.set(a.row, 'Ledger lines', lines.join(', '));
    self.setStatus(a, 'Applied'); a.spec = ev.spec;
    self.settleRuling(self.decisions['A' + a.actionNo]);
    self.stats.applied++;
  });
};

tpResolver_.prototype.apply = function (a, sp) {
  var w = this.world, n = a.nation, turn = this.turn, self = this;
  var N = this.model.tab('Nations'), nat = w.nation(n);
  switch (sp.type) {
    case 'DEVELOP': this.completions.push({ kind: 'Development', nation: n, sys: sp.sys, level: sp.level, row: a.actionNo }); break;
    case 'DESIGNATE': w.sys(sp.sys).set('Designation', sp.desig); this.log('Spending', n, 'Designation', w.label(sp.sys) + ' designated ' + sp.desig, 'No', a.actionNo); break;
    case 'BUILD':
      if ((sp.turns || 1) > 1) this.addWork(n, 'Building', sp.building, sp.sys, turn + sp.turns - 1, a.actionNo);
      else this.completions.push({ kind: 'Building', nation: n, sys: sp.sys, item: sp.building, row: a.actionNo });
      break;
    case 'SHIP':
      if ((sp.turns || 1) > 1) this.addWork(n, 'Ships', sp.n + ' ' + sp.cat, sp.sys, turn + sp.turns - 1, a.actionNo);
      else this.completions.push({ kind: 'Ships', nation: n, sys: sp.sys, cat: sp.cat, n: sp.n, row: a.actionNo });
      break;
    case 'GROUND':
      var item = sp.n + ' ' + sp.form + (sp.env ? ' (' + sp.env + ')' : '');
      if ((sp.turns || 1) > 1) this.addWork(n, 'Formations', item, sp.sys, turn + sp.turns - 1, a.actionNo);
      else this.completions.push({ kind: 'Formations', nation: n, sys: sp.sys, form: sp.form, n: sp.n, env: sp.env, row: a.actionNo });
      break;
    case 'DEFENCE': this.completions.push({ kind: 'Static Defence', nation: n, sys: sp.sys, points: sp.points, row: a.actionNo }); break;
    case 'RESEARCH': this.completions.push({ kind: 'Research', nation: n, branch: sp.branch, tier: sp.tier, row: a.actionNo }); break;
    case 'COLONIZE': this.colonize(n, sp, a.actionNo); break;
    case 'SHIFT': N.set(nat.row, sp.col, sp.value); nat.axes[sp.col] = sp.value; this.log('Spending', n, 'Ideology', sp.col + ' now ' + sp.value, 'Yes', a.actionNo); break;
    case 'CIVIC': N.set(nat.row, sp.col, sp.value); this.log('Spending', n, 'Civic', (sp.old ? sp.old + ' replaced by ' : 'Adopted ') + sp.value, 'Yes', a.actionNo); break;
    case 'REFORM':
      N.set(nat.row, 'Government', sp.gov);
      if (sp.gov === 'Collective') TURN_CONFIG.AXES.forEach(function (x) { N.set(nat.row, x.col, 'Neutral'); });
      this.log('Spending', n, 'Reform', 'Government now ' + sp.gov + '; check the Fiscal tab for lines out of bounds', 'Yes', a.actionNo);
      break;
    case 'STABILITY': case 'CHARGE_ONLY': case 'STAB_ONLY': break;
  }
};

tpResolver_.prototype.addWork = function (n, kind, item, sys, completes, row) {
  this.model.tab('Works in progress').add('Nation', { 'Turn ordered': this.turn, 'Nation': n, 'Kind': kind, 'Item': item, 'System': sys,
    'Completes at end of turn': completes, 'Action row': row, 'Status': 'Under way' });
};

tpResolver_.prototype.colonize = function (n, sp, row) {
  var w = this.world, S = w.sys(sp.sys), self = this;
  S.set('Owner', n);
  if (sp.name && !S.get('Name')) S.set('Name', sp.name);
  S.set('Development', 1);
  if (sp.desig) S.set('Designation', sp.desig);
  w.addDiscoverer(sp.sys, n);
  w.neighbours(sp.sys).forEach(function (nb) { if (w.addDiscoverer(nb, n)) self.log('Spending', n, 'Discovery', w.label(nb) + ' discovered', 'No', row); });
  // Settlers: 0.3 bn from the nation's other worlds, pro rata.
  var moved = w.moveSettlers(n, sp.sys, TURN_CONFIG.COLONY_SETTLERS_BN);
  this.log('Spending', n, 'Colony founded', w.label(sp.sys) + ' founded at Development 1' + (sp.desig ? ' as ' + sp.desig : ' (no designation yet)') + '; ' + moved, 'Yes', row);
};

// ---------------- Phase 5: Movement ----------------
tpResolver_.prototype.phaseMovement = function () {
  var self = this, w = this.world;
  this.actions.filter(function (a) { return a.verb === 'MOVE'; }).forEach(function (a) {
    if (self.gate(a) !== 'go') return;
    var approved = a.status === 'Needs ruling';
    var ev = self.reevaluate(a);
    if (ev.status === 'Condition failed') { self.setStatus(a, 'Condition failed', ev.flag); return; }
    if (!ev.spec || ev.status === 'Rejected' || (ev.status === 'Needs ruling' && !approved)) { self.setStatus(a, approved ? 'Failed' : 'Not applied', ev.flag); return; }
    var f = w.forceById(ev.spec.force);
    w.forcesTab.set(f.row, 'Location', ev.spec.to);
    f.location = ev.spec.to;
    self.simFor(a.nation).moved[f.row] = true;
    self.log('Movement', a.nation, 'Moved', f.name + ' (' + f.id + '): ' + ev.spec.path.map(function (x) { return w.label(x); }).join(' > ') + (approved ? ' (GM ruling)' : ''), 'No', a.actionNo);
    self.setStatus(a, 'Applied'); a.spec = ev.spec;
    self.settleRuling(self.decisions['A' + a.actionNo]);
    self.stats.applied++;
  });
};

// ---------------- Phase 6: Population ----------------
tpResolver_.prototype.phasePopulation = function () {
  var self = this, w = this.world;
  w.systems.forEach(function (s) {
    if (!s.get('Owner')) return;
    var g = self.startGrowth[s.id];
    if (!g) return;
    var rows = w.worldRows(s.id).filter(function (r) { return tpNum_(w.worldsTab.get(r, 'Population (bn)')) > 0; });
    var total = rows.reduce(function (t, r) { return t + tpNum_(w.worldsTab.get(r, 'Population (bn)')); }, 0);
    if (!total) return;
    var desc = [];
    rows.forEach(function (r) {
      var p = tpNum_(w.worldsTab.get(r, 'Population (bn)'));
      var np = tpRound2_(p + g * p / total);
      w.worldsTab.set(r, 'Population (bn)', np);
      desc.push(w.worldsTab.get(r, 'World') + ' ' + p + ' -> ' + np);
    });
    self.log('Population', s.get('Owner'), 'Growth', w.label(s.id) + ': growth ' + g + ' bn; ' + desc.join(', '), 'No', '');
  });
};

// ---------------- Phase 7: World toll ----------------
tpResolver_.prototype.phaseWorldToll = function () {
  var self = this, w = this.world;
  w.systems.forEach(function (s) {
    var t = self.startToll[s.id];
    var change = t.change + (t.crowded ? 0.5 : 0);
    if (!change) return;
    var parts = [];
    if (t.change > 0) parts.push('Strain ' + s.get('Strain') + ' over Capacity ' + s.get('Capacity') + ': +' + t.change);
    if (t.change < 0) parts.push('Recovery ' + t.change);
    if (t.crowded) parts.push('overcrowded +0.5');
    self.ledger('World toll', s.id, 'Degradation', tpRound2_(change), 'Degradation this turn' + (t.owner ? ' (' + t.owner + ')' : ''), parts.join('; '), '');
  });
};

// ---------------- Phase 8: Infamy decay ----------------
tpResolver_.prototype.phaseInfamy = function () {
  var self = this, w = this.world;
  w.activeNations().forEach(function (n) {
    var inf = w.stock(n.id, 'Infamy');
    if (inf <= 0) return;
    var c = w.calc(n.id) || {};
    var decay = tpNum_(c['Infamy decay per turn']) || 1;
    self.ledger('Infamy', n.id, 'Infamy', -Math.min(inf, decay), 'Infamy decay', 'Infamy ' + inf + ' - ' + decay + ' per turn', '');
  });
};

// ---------------- Completions (start of next turn) ----------------
tpResolver_.prototype.phaseCompletions = function () {
  var self = this, w = this.world, turn = this.turn;
  var WIP = this.model.tab('Works in progress');
  WIP.rows().forEach(function (r) {
    if (WIP.get(r, 'Status') !== 'Under way' || tpNum_(WIP.get(r, 'Completes at end of turn')) !== turn) return;
    var kind = WIP.get(r, 'Kind'), item = String(WIP.get(r, 'Item'));
    var c = { nation: WIP.get(r, 'Nation'), sys: WIP.get(r, 'System'), row: WIP.get(r, 'Action row') };
    if (kind === 'Building') { c.kind = 'Building'; c.item = item; }
    else if (kind === 'Ships') { var m = item.match(/^(\d+)\s+(.+)$/); c.kind = 'Ships'; c.n = Number(m[1]); c.cat = m[2]; }
    else if (kind === 'Formations') { var m2 = item.match(/^(\d+)\s+([^(]+?)(?:\s+\((.+)\))?$/); c.kind = 'Formations'; c.n = Number(m2[1]); c.form = m2[2]; c.env = m2[3] || ''; }
    self.completions.push(c);
    WIP.set(r, 'Status', 'Completed');
  });
  this.completions.forEach(function (c) {
    var S = c.sys ? w.sys(c.sys) : null;
    switch (c.kind) {
      case 'Development':
        S.set('Development', c.level);
        self.log('Completion', c.nation, 'Development', w.label(c.sys) + ' reaches Development ' + c.level, 'No', c.row); break;
      case 'Building':
        var b = String(S.get('Buildings') || '').trim();
        S.set('Buildings', b ? b + ', ' + c.item : c.item);
        self.log('Completion', c.nation, 'Building', c.item + ' completed at ' + w.label(c.sys), 'No', c.row); break;
      case 'Ships':
        var f = w.fleetAt(c.nation, c.sys, true);
        var col = TURN_CONFIG.SHIP_COLUMNS[c.cat];
        w.forcesTab.set(f.row, col, tpNum_(w.forcesTab.get(f.row, col)) + c.n);
        self.log('Completion', c.nation, 'Ships', c.n + ' ' + c.cat + ' join ' + f.id + ' at ' + w.label(c.sys), 'No', c.row); break;
      case 'Formations':
        var army = w.armyAt(c.nation, c.sys);
        var def = TURN_CONFIG.FORMATIONS[c.form].defence * c.n;
        w.forcesTab.set(army.row, 'Ground Power', tpRound2_(tpNum_(w.forcesTab.get(army.row, 'Ground Power')) + def));
        var note = String(w.forcesTab.get(army.row, 'Note') || '');
        w.forcesTab.set(army.row, 'Note', (note ? note + '; ' : '') + '+' + c.n + ' ' + c.form + (c.env ? ' (' + c.env + ')' : '') + ' T' + turn);
        self.log('Completion', c.nation, 'Formations', c.n + ' ' + c.form + ' raised at ' + w.label(c.sys) + ' (' + army.id + ', Ground Power +' + def + ')', 'No', c.row); break;
      case 'Static Defence':
        var d = w.defenceRowAt(c.nation, c.sys);
        w.forcesTab.set(d.row, 'Static Defence', tpNum_(w.forcesTab.get(d.row, 'Static Defence')) + c.points);
        self.log('Completion', c.nation, 'Static Defence', c.points + ' points at ' + w.label(c.sys), 'No', c.row); break;
      case 'Research':
        var nat = w.nation(c.nation);
        self.model.tab('Nations').set(nat.row, TURN_CONFIG.TECH_BRANCH_COLUMN[c.branch], c.tier);
        self.log('Completion', c.nation, 'Technology', c.branch + ' Tier ' + c.tier + ' reached', 'No', c.row); break;
    }
  });
};

// ---------------- Phase 9: Stability ----------------
tpResolver_.prototype.phaseStability = function () {
  var self = this, w = this.world;
  w.activeNations().forEach(function (n) {
    var c = w.calc(n.id);
    if (!c) return;
    var raw = w.stock(n.id, 'Stability');
    var cur = Math.max(0, Math.min(10, raw));
    var target = tpNum_(c['Stability target']);
    var step = target > cur ? 1 : target < cur ? -1 : 0;
    var note = '';
    var war = self.decisions['Stability|' + n.id];
    if (war && war.kind !== 'open') {
      var d = war.decision.toLowerCase();
      if (/hold|no change/.test(d)) { step = 0; note = ' (GM: recovery held by war)'; }
      else if (/fall|-1|−1|drop/.test(d)) { step = -1; note = ' (GM: war exhaustion)'; }
      self.settleRuling(war);
    }
    if (raw !== cur) self.ledger('Stability', n.id, 'Stability', tpRound2_(cur - raw), 'Stability held within 0 to 10', 'Ledger total ' + raw + ' -> ' + cur, '');
    if (step) self.ledger('Stability', n.id, 'Stability', step, 'Stability moves toward its target', 'Current ' + cur + ', target ' + target + ' -> ' + (cur + step) + note, '');
    var after = cur + step;
    if (after <= 3 && cur > 3) self.log('Stability', n.id, 'Revolt', 'Stability falls to Unrest (' + after + '): the GM chooses one system to rise (most recently acquired, else lowest Development)', 'No', '');
    else if (after <= 3 && after >= 2) self.log('Stability', n.id, 'Revolt check', 'Still in Unrest (' + after + '): another system rises every 3 turns', 'No', '');
    if (after === 1) self.log('Stability', n.id, 'Revolt check', 'Crisis: one system rises every turn', 'No', '');
    if (after <= 0) self.log('Stability', n.id, 'Collapse', 'Stability 0: the state collapses (see Collapse)', 'No', '');
    if (n.status === 'Caretaker') self.log('Stability', n.id, 'Caretaker', 'Caretaker this turn', 'No', '');
  });
  // Upkeep and other open info rulings are settled by running the turn.
  Object.keys(this.decisions).forEach(function (k) {
    var d = self.decisions[k];
    if (!/^A/.test(k) && d.kind !== 'open') self.settleRuling(d);
  });
};

// =====================================================================
// WORLD STATE (reads the tabs; shared by prepare and resolve)
// =====================================================================
function tpWorld_(model) {
  var self = this;
  this.model = model;
  this.nationsTab = model.tab('Nations');
  this.systemsTab = model.tab('Systems');
  this.worldsTab = model.tab('Worlds');
  this.forcesTab = model.tab('Forces');
  this.ledgerTab = model.tab('Ledger');
  this.reloadCalc();
  // Nations
  this.nations = [];
  var N = this.nationsTab;
  N.rows().forEach(function (r) {
    var id = String(N.get(r, 'Nation ID') || '').trim();
    if (!id) return;
    var axes = {};
    TURN_CONFIG.AXES.forEach(function (a) { axes[a.col] = String(N.get(r, a.col) || 'Neutral').trim() || 'Neutral'; });
    var civicCols = {};
    TURN_CONFIG.CIVIC_COLUMNS.forEach(function (c) { civicCols[c] = String(N.get(r, c) || '').trim(); });
    self.nations.push({
      id: id, row: r, name: String(N.get(r, 'Nation') || ''), status: String(N.get(r, 'Status') || '').trim(),
      gov: String(N.get(r, 'Government') || '').trim(), axes: axes, civicCols: civicCols,
      civics: TURN_CONFIG.CIVIC_COLUMNS.map(function (c) { return civicCols[c]; }).filter(function (x) { return x; }),
      traits: String(N.get(r, 'Traits') || ''), disp: String(N.get(r, 'Self–group') || '').trim(), bio: String(N.get(r, 'Biology') || '').trim(),
      habitat: String(N.get(r, 'Habitat') || 'Surface').trim() || 'Surface',
      tiers: { Military: tpNum_(N.get(r, 'Military tier')) || 1, Industry: tpNum_(N.get(r, 'Industry tier')) || 1, Society: tpNum_(N.get(r, 'Society tier')) || 1, Logistics: tpNum_(N.get(r, 'Logistics tier')) || 1 }
    });
  });
  var C = model.tab('Civic');
  this.shortNames = {};
  C.rows().forEach(function (r) {
    var id = C.get(r, 'Nation ID'); if (!id) return;
    ['Official name', 'Short name', 'Demonym', 'Adjective'].forEach(function (h) { var v = C.get(r, h); if (v) self.shortNames[tpNorm_(v)] = id; });
  });
  // Systems
  var S = this.systemsTab;
  this.systems = []; this.sysById = {};
  S.rows().forEach(function (r) {
    var id = String(S.get(r, 'System ID') || '').trim();
    if (!id) return;
    var o = { id: id, row: r, get: function (h) { return S.get(r, h); }, set: function (h, v) { S.set(r, h, v); } };
    self.systems.push(o); self.sysById[id] = o;
  });
  // Lanes
  this.adj = {};
  var L = model.tab('Lanes');
  L.rows().forEach(function (r) {
    var a = String(L.get(r, 'From') || '').trim(), b = String(L.get(r, 'To') || '').trim();
    if (!a || !b) return;
    (self.adj[a] = self.adj[a] || []).push(b); (self.adj[b] = self.adj[b] || []).push(a);
  });
  // Name index: system IDs, system names, world names.
  this.nameIndex = {};
  this.systems.forEach(function (s) { self.nameIndex[tpNorm_(s.id)] = s.id; var nm = s.get('Name'); if (nm) self.nameIndex[tpNorm_(nm)] = s.id; });
  var Wt = this.worldsTab;
  Wt.rows().forEach(function (r) { var sid = Wt.get(r, 'System ID'), wn = Wt.get(r, 'World'); if (sid && wn && !self.nameIndex[tpNorm_(wn)]) self.nameIndex[tpNorm_(wn)] = sid; });
  // Tables
  this.tables = {};
}

tpWorld_.prototype.reloadCalc = function () {
  var Ct = this.model.tab('Calculations'), self = this;
  this.calcById = {};
  Ct.rows().forEach(function (r) {
    var id = Ct.get(r, 'Nation ID'); if (!id) return;
    var o = {};
    Ct.headers.forEach(function (h, i) { if (h) o[h] = Ct.values[r][i]; });
    self.calcById[id] = o;
  });
};
tpWorld_.prototype.calc = function (id) { return this.calcById[id]; };
tpWorld_.prototype.nation = function (id) { return this.nations.filter(function (n) { return n.id === id; })[0]; };
tpWorld_.prototype.activeNations = function () { return this.nations.filter(function (n) { return n.status !== 'Eliminated' && n.status !== ''; }); };
tpWorld_.prototype.nationByName = function (text) {
  var t = tpNorm_(text), self = this;
  var n = this.nations.filter(function (x) { return tpNorm_(x.id) === t || tpNorm_(x.name) === t; })[0];
  if (!n && this.shortNames[t]) n = this.nation(this.shortNames[t]);
  return n || null;
};
tpWorld_.prototype.sys = function (id) { return this.sysById[id]; };
tpWorld_.prototype.label = function (id) { var s = this.sysById[id]; return s ? tpSysLabel_(s) : id; };
tpWorld_.prototype.findSystem = function (text) {
  var t = tpNorm_(String(text || '').replace(/^(?:the\s+)?system\s+/i, ''));
  var id = this.nameIndex[t];
  return id ? this.sysById[id] : null;
};
tpWorld_.prototype.ownerOf = function (id) { var s = this.sysById[id]; return s ? String(s.get('Owner') || '') : ''; };
tpWorld_.prototype.neighbours = function (id) { return this.adj[id] || []; };
tpWorld_.prototype.passable = function (nid, sid) { var o = this.ownerOf(sid); return !o || o === nid; };
tpWorld_.prototype.shortestPath = function (from, to, ok) {
  if (from === to) return [from];
  var prev = {}, q = [from], seen = {}; seen[from] = true;
  while (q.length) {
    var u = q.shift();
    var nb = this.adj[u] || [];
    for (var i = 0; i < nb.length; i++) {
      var v = nb[i];
      if (seen[v]) continue;
      if (v !== to && !ok(v)) continue;
      if (v === to && !ok(v) && ok !== null) { /* destination may be foreign; contest is judged separately */ }
      seen[v] = true; prev[v] = u;
      if (v === to) { var p = [to]; while (p[0] !== from) p.unshift(prev[p[0]]); return p; }
      q.push(v);
    }
  }
  return null;
};
tpWorld_.prototype.distanceFromSet = function (sources, target, maxD) {
  var self = this, best = -1;
  sources.forEach(function (s) {
    var p = self.shortestPath(s, target, function () { return true; });
    if (p && p.length - 1 <= maxD && (best < 0 || p.length - 1 < best)) best = p.length - 1;
  });
  return best;
};
tpWorld_.prototype.addDiscoverer = function (sid, nid) {
  var s = this.sysById[sid]; if (!s) return false;
  var cur = String(s.get('Discovered by') || '');
  var list = cur.split(/\s*,\s*/).filter(function (x) { return x; });
  if (list.indexOf(nid) >= 0) return false;
  list.push(nid); s.set('Discovered by', list.join(', '));
  return true;
};
tpWorld_.prototype.designations = function () {
  if (!this.tables.desig) this.tables.desig = this.model.named('T_DESIG').map(function (r) { return String(r[0]).trim(); }).filter(function (x) { return x; });
  return this.tables.desig;
};
tpWorld_.prototype.building = function (name) {
  if (!this.tables.build) {
    var t = {};
    this.model.named('T_BUILD').forEach(function (r) {
      if (!r[0]) return;
      t[tpNorm_(r[0])] = { name: String(r[0]).trim(), industry: tpNum_(r[1]), strat: tpParseStrat_(r[2]), req: tpParseReq_(r[3]), effect: r[4],
        turns: TURN_CONFIG.TWO_TURN_BUILDINGS.indexOf(String(r[0]).trim()) >= 0 ? 2 : 1, slot: true, oncePerNation: /counts once per nation/i.test(String(r[4])) };
    });
    Object.keys(TURN_CONFIG.RULE_BUILDINGS).forEach(function (k) {
      if (!t[tpNorm_(k)]) { var b = TURN_CONFIG.RULE_BUILDINGS[k]; t[tpNorm_(k)] = Object.assign({ name: k, oncePerNation: k === 'Military College' }, b); }
    });
    this.tables.build = t;
  }
  var key = tpNorm_(name);
  return this.tables.build[key] || this.tables.build[key.replace(/s$/, '')] || null;
};
tpWorld_.prototype.shipCategory = function (name) {
  if (!this.tables.ships) {
    var t = {};
    this.model.named('T_SHIPS').forEach(function (r) {
      if (!r[0]) return;
      t[tpNorm_(r[0])] = { name: String(r[0]).trim(), power: tpNum_(r[1]), capacity: tpNum_(r[2]), industry: tpNum_(r[3]),
        strat: { 'Adamant ore': tpNum_(r[4]), 'Lattice crystals': tpNum_(r[5]), 'Antimatter': tpNum_(r[6]) }, requires: r[7] };
    });
    this.tables.ships = t;
  }
  var k = tpNorm_(name);
  return this.tables.ships[k] || this.tables.ships[k.replace(/s$/, '')] || null;
};
tpWorld_.prototype.techTier = function (tier) {
  if (!this.tables.tech) {
    var t = {};
    this.model.named('T_TECH').forEach(function (r) { if (r[0] !== '') t[tpNum_(r[0])] = { research: tpNum_(r[1]), units: tpNum_(r[2]) }; });
    this.tables.tech = t;
  }
  return this.tables.tech[tier];
};
tpWorld_.prototype.popConst = function (label, dflt) {
  if (!this.tables.pop) {
    var t = {};
    this.model.named('T_POP').forEach(function (r) { if (r[0]) t[String(r[0]).trim()] = tpNum_(r[1]); });
    this.tables.pop = t;
  }
  return this.tables.pop[label] !== undefined ? this.tables.pop[label] : dflt;
};

// Ledger stocks
tpWorld_.prototype.stock = function (nid, res) {
  var L = this.ledgerTab, total = 0;
  L.rows().forEach(function (r) { if (L.get(r, 'Nation') === nid && L.get(r, 'Resource') === res) total += tpNum_(L.get(r, 'Amount')); });
  return tpRound2_(total);
};
tpWorld_.prototype.projectedStock = function (nid) {
  var c = this.calc(nid) || {}, self = this, out = {};
  TURN_CONFIG.RESOURCES.forEach(function (r) { out[r] = self.stock(nid, r) + tpNum_(c[TURN_CONFIG.NET_INCOME_HEADERS[r]]); });
  TURN_CONFIG.STRATEGIC.forEach(function (r) { out[r] = self.stock(nid, r) + tpNum_(c[r]); });
  out.Energy -= tpNum_(c['Upkeep Energy']);
  out['Volatile isotopes'] -= tpNum_(c['Upkeep Volatile isotopes']);
  out.Influence -= tpNum_(c['Upkeep Influence']);
  // Debt instalments due this turn (taken from the largest stockpiles; projected against Industry first).
  var D = this.model.tab('Debts'), turn = tpCurrentTurnFromModel_(this.model) + 1;
  D.rows().forEach(function (r) {
    if (D.get(r, 'Debtor') !== nid || D.get(r, 'Status') !== 'Active') return;
    var inst = tpNum_(D.get(r, 'Instalment (SM)')), issued = tpNum_(D.get(r, 'Issued (turn)')), term = tpNum_(D.get(r, 'Term (turns)'));
    if (inst && turn > issued && turn <= issued + term) {
      var best = ['Industry', 'Energy', 'Influence'].sort(function (a, b) { return out[b] - out[a]; })[0];
      out[best] -= inst;
    }
  });
  Object.keys(out).forEach(function (k) { out[k] = tpRound2_(out[k]); });
  return out;
};
tpWorld_.prototype.upkeepShortfall = function (n) {
  var c = this.calc(n.id); if (!c) return null;
  var e = this.stock(n.id, 'Energy') + tpNum_(c['Net Energy']);
  var X = tpNum_(c['Upkeep Energy']);
  if (X > e + 1e-9) return { text: X + ' Energy against ' + tpRound2_(e) + ' projected' };
  return null;
};
tpWorld_.prototype.atWar = function (nid) {
  var W = this.model.tab('Wars');
  return W.rows().some(function (r) {
    if (String(W.get(r, 'Status') || '').trim() !== 'Active') return false;
    var sides = (String(W.get(r, 'Side A (IDs)')) + ',' + String(W.get(r, 'Side B (IDs)')) + ',' + String(W.get(r, 'Joined later (ID:A or B:turn; ...)'))).split(/[,;:\s]+/);
    return sides.indexOf(nid) >= 0;
  });
};

// Population
tpWorld_.prototype.worldRows = function (sid) {
  var Wt = this.worldsTab;
  return Wt.rows().filter(function (r) { return Wt.get(r, 'System ID') === sid; });
};
tpWorld_.prototype.systemPopulation = function (sid) {
  var Wt = this.worldsTab;
  return tpRound2_(this.worldRows(sid).reduce(function (t, r) { return t + tpNum_(Wt.get(r, 'Population (bn)')); }, 0));
};
tpWorld_.prototype.nationPopulation = function (nid) {
  var self = this;
  return tpRound2_(this.systems.filter(function (s) { return s.get('Owner') === nid; }).reduce(function (t, s) { return t + self.systemPopulation(s.id); }, 0));
};
tpWorld_.prototype.moveSettlers = function (nid, toSys, amount) {
  var Wt = this.worldsTab, self = this;
  var src = [];
  this.systems.forEach(function (s) {
    if (s.get('Owner') !== nid || s.id === toSys) return;
    self.worldRows(s.id).forEach(function (r) { var p = tpNum_(Wt.get(r, 'Population (bn)')); if (p > 0) src.push([r, p]); });
  });
  var total = src.reduce(function (t, x) { return t + x[1]; }, 0);
  var taken = 0, parts = [];
  src.forEach(function (x, i) {
    var share = i === src.length - 1 ? tpRound2_(amount - taken) : tpRound2_(amount * x[1] / total);
    taken = tpRound2_(taken + share);
    var np = tpRound2_(x[1] - share);
    Wt.set(x[0], 'Population (bn)', np);
    parts.push(Wt.get(x[0], 'World') + ' ' + x[1] + ' -> ' + np);
  });
  var dest = this.worldRows(toSys).filter(function (r) { return String(Wt.get(r, 'Habitable')) === 'Yes'; })[0];
  var S = this.sys(toSys);
  if (dest) {
    Wt.set(dest, 'Population (bn)', tpRound2_(tpNum_(Wt.get(dest, 'Population (bn)')) + amount));
    Wt.set(dest, 'Settled', 'Yes');
  } else {
    Wt.add('System ID', { 'System ID': toSys, 'World': S.get('Name') || toSys, 'Kind': '', 'Environment': S.get('Environment') || '',
      'Habitable': 'Yes', 'Settled': 'Yes', 'Population (bn)': amount, 'Description': 'Colony; main world (row added when founded)' });
  }
  return amount + ' bn settlers from ' + parts.join(', ');
};

// Forces
tpWorld_.prototype.forceList = function () {
  var F = this.forcesTab, out = [];
  F.rows().forEach(function (r) {
    var id = String(F.get(r, 'Force ID') || '').trim(); if (!id) return;
    out.push({ row: r, id: id, owner: F.get(r, 'Owner'), name: String(F.get(r, 'Name') || ''), location: F.get(r, 'Location'),
      ships: tpNum_(F.get(r, 'Escorts')) + tpNum_(F.get(r, 'Cruisers')) + tpNum_(F.get(r, 'Battleships')) + tpNum_(F.get(r, 'Dreadnoughts')),
      transports: tpNum_(F.get(r, 'Transports')), groundPower: tpNum_(F.get(r, 'Ground Power')), staticDefence: tpNum_(F.get(r, 'Static Defence')) });
  });
  return out;
};
tpWorld_.prototype.findForce = function (nid, text) {
  var t = tpNorm_(text);
  return this.forceList().filter(function (f) { return f.owner === nid && (tpNorm_(f.id) === t || tpNorm_(f.name) === t); })[0] || null;
};
tpWorld_.prototype.forceById = function (id) { return this.forceList().filter(function (f) { return f.id === id; })[0]; };
tpWorld_.prototype.foreignForcesAt = function (nid, sid) {
  return this.forceList().filter(function (f) { return f.owner !== nid && f.location === sid && (f.ships + f.transports + f.groundPower) > 0; })
    .map(function (f) { return f.owner + ' ' + f.id; });
};
tpWorld_.prototype.staticDefenceAt = function (nid, sid) {
  return this.forceList().filter(function (f) { return f.owner === nid && f.location === sid; }).reduce(function (t, f) { return t + f.staticDefence; }, 0);
};
tpWorld_.prototype.newForceId_ = function (nid, letter) {
  var ids = this.forceList().map(function (f) { return f.id; }), k = 1;
  while (ids.indexOf(nid + '-' + letter + k) >= 0) k++;
  return nid + '-' + letter + k;
};
tpWorld_.prototype.fleetAt = function (nid, sid) {
  var f = this.forceList().filter(function (x) { return x.owner === nid && x.location === sid && (x.ships + x.transports) > 0; })[0] ||
          this.forceList().filter(function (x) { return x.owner === nid && x.location === sid && x.groundPower === 0 && x.staticDefence === 0; })[0];
  if (f) return f;
  var id = this.newForceId_(nid, 'F');
  var row = this.forcesTab.add('Force ID', { 'Force ID': id, 'Owner': nid, 'Name': 'New squadron at ' + this.label(sid), 'Location': sid,
    'Escorts': 0, 'Cruisers': 0, 'Battleships': 0, 'Dreadnoughts': 0, 'Transports': 0 });
  return { row: row, id: id };
};
tpWorld_.prototype.armyAt = function (nid, sid) {
  var f = this.forceList().filter(function (x) { return x.owner === nid && x.location === sid && x.groundPower > 0; })[0];
  if (f) return f;
  var id = this.newForceId_(nid, 'A');
  var row = this.forcesTab.add('Force ID', { 'Force ID': id, 'Owner': nid, 'Name': 'New formations at ' + this.label(sid), 'Location': sid, 'Ground Power': 0 });
  return { row: row, id: id };
};
tpWorld_.prototype.defenceRowAt = function (nid, sid) {
  var f = this.forceList().filter(function (x) { return x.owner === nid && x.location === sid && x.staticDefence > 0; })[0] ||
          this.forceList().filter(function (x) { return x.owner === nid && x.location === sid; })[0];
  if (f) return f;
  var id = this.newForceId_(nid, 'D');
  var row = this.forcesTab.add('Force ID', { 'Force ID': id, 'Owner': nid, 'Name': 'Defences at ' + this.label(sid), 'Location': sid, 'Static Defence': 0 });
  return { row: row, id: id };
};
/** Disbands ships, smallest first, then ground formations, until the sheet's upkeep formula fits the Energy held. */
tpWorld_.prototype.disbandFor = function (nid, energy, militia) {
  var F = this.forcesTab, self = this;
  var forces = this.forceList().filter(function (f) { return f.owner === nid; });
  var U = forces.reduce(function (t, f) { return t + tpNum_(F.get(f.row, 'Escorts')) + 2.5 * tpNum_(F.get(f.row, 'Cruisers')) + 4.5 * tpNum_(F.get(f.row, 'Battleships')) + 10 * tpNum_(F.get(f.row, 'Dreadnoughts')); }, 0);
  var W = forces.reduce(function (t, f) { return t + f.groundPower; }, 0);
  function upkeep() { return Math.ceil(U / 2) + (militia ? 0 : Math.ceil(W / 4)); }
  var gone = [];
  var order = [['Escorts', 1], ['Cruisers', 2.5], ['Battleships', 4.5], ['Dreadnoughts', 10]];
  for (var i = 0; i < order.length && upkeep() > energy; i++) {
    forces.forEach(function (f) {
      while (upkeep() > energy && tpNum_(F.get(f.row, order[i][0])) > 0) {
        F.set(f.row, order[i][0], tpNum_(F.get(f.row, order[i][0])) - 1);
        U -= order[i][1]; gone.push('1 ' + order[i][0].replace(/s$/, '') + ' (' + f.id + ')');
      }
    });
  }
  forces.forEach(function (f) {
    while (upkeep() > energy && tpNum_(F.get(f.row, 'Ground Power')) > 0) {
      F.set(f.row, 'Ground Power', tpNum_(F.get(f.row, 'Ground Power')) - 1); W -= 1; gone.push('1 Ground Power (' + f.id + ')');
    }
  });
  return { text: gone.join(', ') || 'nothing', U: U, W: W, upkeep: upkeep() };
};
tpWorld_.prototype.disbandDreadnoughts = function (nid, count) {
  var F = this.forcesTab, done = 0;
  this.forceList().filter(function (f) { return f.owner === nid; }).forEach(function (f) {
    while (done < count && tpNum_(F.get(f.row, 'Dreadnoughts')) > 0) { F.set(f.row, 'Dreadnoughts', tpNum_(F.get(f.row, 'Dreadnoughts')) - 1); done++; }
  });
  return done;
};

/** The projected state of one nation while its orders are read in the order written. */
tpWorld_.prototype.newSim = function (n, phase, resolver) {
  var self = this, c = this.calc(n.id) || {};
  var stock;
  if (phase === 'prepare') stock = this.projectedStock(n.id);
  else {
    stock = {};
    var w = this;
    // In resolution the stock is read live from the Ledger as it stands.
    TURN_CONFIG.RESOURCES.concat(TURN_CONFIG.STRATEGIC).forEach(function (r) {
      Object.defineProperty(stock, r, { enumerable: true, configurable: true,
        get: function () { return w.stock(n.id, r) - (sim.pendingSpend[r] || 0); },
        set: function (v) { /* spending is written to the Ledger by the resolver */ } });
    });
  }
  var owned = {};
  this.systems.forEach(function (s) { if (s.get('Owner') === n.id) owned[s.id] = true; });
  var stab = Math.max(0, Math.min(10, this.stock(n.id, 'Stability')));
  var sim = {
    nid: n.id, calc: c, stock: stock, spent: {}, pendingSpend: {}, gov: n.gov, axes: Object.assign({}, n.axes),
    civicCols: Object.assign({}, n.civicCols), civics: n.civics.slice(), traits: n.traits, disp: n.disp, bio: n.bio, habitat: n.habitat,
    tiers: Object.assign({}, n.tiers), stability: stab, owned: owned, colonized: {}, taken: {}, devRaised: {}, desigChanged: {}, desigNow: {},
    slotsAdded: {}, newBuildings: {}, shipCapAdded: 0, armyCapAdded: 0, staticAdded: {}, researched: {}, moved: {},
    shifted: false, stabBought: false, reformed: false, settlersOut: 0, settlersFrom: {},
    ownsActive: function (sid) { var s = self.sys(sid); return !!(owned[sid] && s && !String(s.get('Status') || '').trim()); },
    devOf: function (sid) { return tpNum_(self.sys(sid).get('Development')); },
    desigOf: function (sid) { return this.desigNow[sid] || String(self.sys(sid).get('Designation') || '').trim(); },
    hasCivic: function (cv) { return this.civics.indexOf(cv) >= 0; },
    buildingsOf: function (sid) {
      var b = String(self.sys(sid).get('Buildings') || '').split(/\s*,\s*/).filter(function (x) { return x; });
      var wip = self.model.tab('Works in progress');
      wip.rows().forEach(function (r) { if (wip.get(r, 'System') === sid && wip.get(r, 'Status') === 'Under way' && wip.get(r, 'Kind') === 'Building') b.push(String(wip.get(r, 'Item'))); });
      return b.concat(this.newBuildings[sid] || []);
    },
    nationHasBuilding: function (name) {
      var me = this;
      return self.systems.some(function (s) { return s.get('Owner') === n.id && me.buildingsOf(s.id).some(function (x) { return tpNorm_(x) === tpNorm_(name); }); });
    },
    totalPopulation: function () { return self.nationPopulation(n.id) - this.settlersOut; }
  };
  if (phase === 'resolve') {
    // Resolution spends through the Ledger; the sim must not double-count.
    sim.stock = stock;
    sim.stability = stab;
    Object.defineProperty(sim, 'stability', { enumerable: true, configurable: true,
      get: function () { return Math.max(0, Math.min(10, self.stock(n.id, 'Stability'))); }, set: function () {} });
  }
  return sim;
};

// =====================================================================
// MODEL: in-memory copy of the tabs, written back in one pass
// =====================================================================
function tpModel_(ss, opts) {
  this.ss = ss; this.dry = !!opts.dry; this.tabs = {}; this.previewRows = []; this.runLabel = '';
}
tpModel_.prototype.startPreview = function (label) { this.runLabel = label; };
tpModel_.prototype.tab = function (name) {
  if (this.tabs[name]) return this.tabs[name];
  var sh = this.ss.getSheetByName(name);
  var t;
  if (sh) {
    var rng = sh.getDataRange();
    t = new tpTab_(this, name, sh, rng.getValues(), rng.getFormulas());
  } else {
    var headers = TURN_CONFIG.NEW_TABS[name];
    if (!headers) throw new Error('Tab "' + name + '" not found');
    if (!this.dry) {
      sh = tpEnsureTab_(this.ss, name, headers);
      t = new tpTab_(this, name, sh, [headers.slice()], [headers.map(function () { return ''; })]);
    } else {
      t = new tpTab_(this, name, null, [headers.slice()], [headers.map(function () { return ''; })]);
      this.previewRows.push([new Date(), name, '', '', '', '', 'Tab would be created']);
    }
  }
  this.tabs[name] = t;
  return t;
};
tpModel_.prototype.reload = function (name) { delete this.tabs[name]; return this.tab(name); };
tpModel_.prototype.named = function (rangeName) {
  var r = this.ss.getRangeByName(rangeName);
  if (!r) throw new Error('Named range ' + rangeName + ' not found');
  return r.getValues();
};
tpModel_.prototype.commit = function () {
  var self = this;
  Object.keys(this.tabs).forEach(function (k) { self.tabs[k].commit(); });
  if (this.dry) {
    var P = tpEnsureTab_(this.ss, TURN_CONFIG.SHEETS.preview, TURN_CONFIG.NEW_TABS['Preview']);
    if (!this.previewCleared) {
      if (P.getLastRow() > 1) P.getRange(2, 1, P.getLastRow() - 1, P.getLastColumn()).clearContent();
      this.previewCleared = true;
      this.previewRows.unshift([new Date(), '(run)', '', '', '', '', this.runLabel + ': dry run; nothing below has been written to the game tabs']);
    }
    if (this.previewRows.length) {
      var start = Math.max(P.getLastRow(), 1) + 1;
      P.getRange(start, 1, this.previewRows.length, 7).setValues(this.previewRows.map(function (r) { return r.map(tpPreviewCell_); }));
    }
    this.previewRows = [];
  }
};
function tpPreviewCell_(v) { return v instanceof Date ? v : (v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v)); }

function tpTab_(model, name, sheet, values, formulas) {
  this.model = model; this.name = name; this.sheet = sheet; this.values = values; this.formulas = formulas;
  this.headers = (values[0] || []).map(function (h) { return String(h || '').trim(); });
  this.width = this.headers.length;
  this.dirty = {}; this.newRows = {}; this.colCache = {};
  this.originalLength = values.length;
}
tpTab_.prototype.c = function (header) {
  if (this.colCache[header] !== undefined) return this.colCache[header];
  var target = tpNormHeader_(header), idx = -1;
  for (var i = 0; i < this.headers.length; i++) if (this.headers[i] === header) { idx = i; break; }
  if (idx < 0) for (var j = 0; j < this.headers.length; j++) if (tpNormHeader_(this.headers[j]) === target) { idx = j; break; }
  this.colCache[header] = idx;
  return idx;
};
tpTab_.prototype.req = function (header) {
  var i = this.c(header);
  if (i < 0) throw new Error('Column "' + header + '" not found on the ' + this.name + ' tab');
  return i;
};
tpTab_.prototype.rows = function () { var out = []; for (var r = 1; r < this.values.length; r++) out.push(r); return out; };
tpTab_.prototype.get = function (r, header) {
  var i = this.c(header);
  if (i < 0 || !this.values[r]) return '';
  var v = this.values[r][i];
  return v === null || v === undefined ? '' : v;
};
tpTab_.prototype.set = function (r, header, v) {
  var i = this.req(header);
  var allow = TURN_CONFIG.WRITABLE[this.name];
  if (allow !== '*' && (!allow || allow.indexOf(this.headers[i]) < 0)) throw new Error('The script may not write column "' + header + '" on ' + this.name);
  if (this.formulas[r] && this.formulas[r][i]) throw new Error('Refusing to overwrite a formula: ' + this.name + ' row ' + (r + 1) + ' column "' + header + '"');
  while (this.values.length <= r) { this.values.push(new Array(this.width).fill('')); this.formulas.push(new Array(this.width).fill('')); }
  var old = this.values[r][i];
  if (old === v) return;
  if (!this.newRows[r]) {
    this.dirty[r] = this.dirty[r] || {};
    if (!(i in this.dirty[r])) this.dirty[r][i] = old;
  }
  this.values[r][i] = v;
};
/** Next free row: one past the last row whose key column holds a value. */
tpTab_.prototype.nextRow = function (keyHeader) {
  var k = this.req(keyHeader), last = 0;
  for (var r = 1; r < this.values.length; r++) if (this.values[r][k] !== '' && this.values[r][k] !== null && this.values[r][k] !== undefined) last = r;
  return last + 1;
};
tpTab_.prototype.add = function (keyHeader, obj) {
  var r = this.nextRow(keyHeader), self = this;
  this.newRows[r] = true;
  Object.keys(obj).forEach(function (h) { if (self.c(h) >= 0) self.set(r, h, obj[h]); });
  this.lastAdded = r;
  return r;
};
tpTab_.prototype.commit = function () {
  var self = this, model = this.model;
  var rows = Object.keys(this.dirty).map(Number).concat(Object.keys(this.newRows).map(Number));
  rows = rows.filter(function (x, i) { return rows.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
  if (!rows.length) return;
  if (model.dry) {
    rows.forEach(function (r) {
      if (self.newRows[r]) {
        var parts = [];
        self.headers.forEach(function (h, i) { var v = self.values[r][i]; if (v !== '' && v !== null && v !== undefined && !(self.formulas[r] && self.formulas[r][i])) parts.push(h + ': ' + (v instanceof Date ? tpFmtDate_(v) : v)); });
        model.previewRows.push([new Date(), self.name, r + 1, '(new row)', '', parts.join(' | '), '']);
      } else {
        Object.keys(self.dirty[r]).forEach(function (i) {
          model.previewRows.push([new Date(), self.name, r + 1, self.headers[i], self.dirty[r][i], self.values[r][i], '']);
        });
      }
    });
  } else {
    var sh = this.sheet;
    var maxRow = rows[rows.length - 1] + 1;
    if (maxRow > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), maxRow - sh.getMaxRows());
    rows.forEach(function (r) {
      var cols = self.newRows[r] ? self.headers.map(function (h, i) { return i; }).filter(function (i) {
        var v = self.values[r][i]; return v !== '' && v !== null && v !== undefined && !(self.formulas[r] && self.formulas[r][i]);
      }) : Object.keys(self.dirty[r]).map(Number);
      cols.sort(function (a, b) { return a - b; });
      // Contiguous runs only, so no formula cell between them is touched.
      var start = null, prev = null, run = [];
      function flushRun() { if (start !== null) sh.getRange(r + 1, start + 1, 1, run.length).setValues([run]); }
      cols.forEach(function (i) {
        if (start === null || i !== prev + 1) { flushRun(); start = i; run = []; }
        run.push(self.values[r][i]); prev = i;
      });
      flushRun();
    });
  }
  this.dirty = {}; this.newRows = {};
};

// =====================================================================
// CONTROL TAB, RUN LOG, TABS
// =====================================================================
function tpEnsureTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}
function tpEnsureControlTab_(ss) {
  var sh = ss.getSheetByName(TURN_CONFIG.SHEETS.control);
  if (!sh) {
    sh = ss.insertSheet(TURN_CONFIG.SHEETS.control);
    var rows = [['Setting', 'Value', 'Notes']].concat(TURN_CONFIG.CONTROL_ROWS);
    sh.getRange(1, 1, rows.length, 3).setValues(rows);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  // Add any label that is missing (for workbooks set up by an earlier version).
  var labels = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  TURN_CONFIG.CONTROL_ROWS.forEach(function (row) {
    if (labels.indexOf(row[0]) < 0) { sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([row]); labels.push(row[0]); }
  });
  return sh;
}
function tpControlRow_(ss, label) {
  var sh = ss.getSheetByName(TURN_CONFIG.SHEETS.control);
  if (!sh) return { sh: null, row: -1 };
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() === label) return { sh: sh, row: i + 1 };
  return { sh: sh, row: -1 };
}
function tpGetControl_(ss, label) {
  var c = tpControlRow_(ss, label);
  return c.row > 0 ? c.sh.getRange(c.row, 2).getValue() : '';
}
function tpSetControl_(ss, label, value) {
  var c = tpControlRow_(ss, label);
  if (c.row > 0) c.sh.getRange(c.row, 2).setValue(value);
}
function tpLogRun_(ss, fn, mode, turn, result, detail) {
  var sh = tpEnsureTab_(ss, TURN_CONFIG.SHEETS.runlog, TURN_CONFIG.NEW_TABS['Run log']);
  sh.getRange(sh.getLastRow() + 1, 1, 1, 6).setValues([[tpNow_(), fn, mode, turn, result, String(detail || '').slice(0, 45000)]]);
}

/** The current turn is the highest turn in the Turn log (README). */
function tpCurrentTurn_(ss) {
  var sh = ss.getSheetByName(TURN_CONFIG.SHEETS.turnlog);
  if (!sh || sh.getLastRow() < 2) return 0;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  return v.reduce(function (m, r) { var x = Number(r[0]); return isFinite(x) && r[0] !== '' && x > m ? x : m; }, 0);
}
function tpCurrentTurnFromModel_(model) {
  var T = model.tab('Turn log');
  return T.rows().reduce(function (m, r) { var v = T.get(r, 'Turn'); var x = Number(v); return v !== '' && isFinite(x) && x > m ? x : m; }, 0);
}
function tpCountPriorCaretaker_(model, nid, turn) {
  var T = model.tab('Turn log'), k = 0;
  for (var t = turn - 1; t >= 1; t--) {
    var hit = T.rows().some(function (r) { return tpNum_(T.get(r, 'Turn')) === t && T.get(r, 'Event') === 'Caretaker' && T.get(r, 'Nations') === nid; });
    if (!hit) break;
    k++;
  }
  return k;
}

// =====================================================================
// TIME (Singapore keeps UTC+8 with no daylight saving)
// =====================================================================
function tpNow_() { return new Date(); }
function tpFlush_() { try { SpreadsheetApp.flush(); } catch (e) { /* not available */ } }
function tpSgtParts_(d) { var x = new Date(d.getTime() + TURN_CONFIG.SGT_OFFSET_HOURS * 3600000); return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay(), h: x.getUTCHours(), min: x.getUTCMinutes() }; }
function tpSgtDate_(y, m, d, h, min) { return new Date(Date.UTC(y, m, d, h, min) - TURN_CONFIG.SGT_OFFSET_HOURS * 3600000); }
function tpSgtToday_(h, min) { var p = tpSgtParts_(tpNow_()); return tpSgtDate_(p.y, p.m, p.d, h, min); }
/** The Sunday 18:00 SGT deadline a submission at time t counts for. */
function tpDeadlineFor_(t) {
  var p = tpSgtParts_(t);
  var daysToSunday = (7 - p.dow) % 7;
  var dl = tpSgtDate_(p.y, p.m, p.d + daysToSunday, 18, 0);
  if (t > dl) dl = new Date(dl.getTime() + 7 * 86400000);
  return dl;
}
/** The most recent Sunday 18:00 SGT at or before now (or the override). */
function tpCurrentDeadline_() {
  var ovr = TURN_CONFIG.DEADLINE_OVERRIDE;
  try {
    var cv = tpGetControl_(SpreadsheetApp.getActiveSpreadsheet(), 'Deadline override');
    if (cv instanceof Date) return cv;
    if (String(cv || '').trim()) ovr = String(cv).trim();
  } catch (e) { /* no Control tab yet */ }
  if (ovr) {
    var m = String(ovr).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
    if (m) return tpSgtDate_(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  }
  var p = tpSgtParts_(tpNow_());
  var dl = tpSgtDate_(p.y, p.m, p.d - p.dow, 18, 0);
  if (dl > tpNow_()) dl = new Date(dl.getTime() - 7 * 86400000);
  return dl;
}
function tpFmtDate_(d) {
  if (!(d instanceof Date)) return String(d);
  var p = tpSgtParts_(d);
  function z(n) { return (n < 10 ? '0' : '') + n; }
  return p.y + '-' + z(p.m + 1) + '-' + z(p.d) + ' ' + z(p.h) + ':' + z(p.min) + ' SGT';
}

// =====================================================================
// SMALL HELPERS
// =====================================================================
function tpNum_(v) { if (v === '' || v === null || v === undefined) return 0; var n = Number(v); return isFinite(n) ? n : 0; }
function tpRound1_(x) { return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 10) / 10; }
function tpRound2_(x) { return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
function tpRoundHalfUp_(x) { return Math.floor(x + 0.5 + 1e-9); }
function tpSigned_(x) { return (x >= 0 ? '+' : '') + tpRound2_(x); }
function tpEscapeRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function tpNorm_(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}
function tpNormHeader_(s) { return tpNorm_(s).replace(/[–—]/g, '-'); }
function tpFindKey_(obj, name) { var t = tpNorm_(name); return Object.keys(obj).filter(function (k) { return tpNorm_(k) === t; })[0] || null; }
function tpSysLabel_(s) { var nm = s.get('Name'); return nm ? nm + ' (' + s.id + ')' : s.id; }
function tpSplitAt_(args) {
  var m = String(args).match(/^(.*?)\s*(?:@|\bat\b|\bin\b)\s*(.+)$/i);
  return m ? { what: m[1].trim(), where: m[2].trim() } : null;
}
function tpParseQty_(text) {
  var t = String(text).trim(), n = 1;
  var m = t.match(/^(.*?)\s*[x×]\s*(\d+)$/i) || t.match(/^(.*?)\s+(\d+)$/);
  if (m) { n = Number(m[2]); t = m[1]; }
  else { var m2 = t.match(/^(\d+)\s*[x×]?\s+(.*)$/i); if (m2) { n = Number(m2[1]); t = m2[2]; } }
  return { n: n, name: t.trim() };
}
function tpParseStrat_(text) {
  var out = {};
  String(text || '').split(/\s*[;,]\s*/).forEach(function (p) {
    var m = p.match(/^(\d+(?:\.\d+)?)\s+(.+)$/) || p.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
    if (!m) return;
    var amt = /^\d/.test(m[1]) ? Number(m[1]) : Number(m[2]);
    var name = /^\d/.test(m[1]) ? m[2] : m[1];
    var r = TURN_CONFIG.STRATEGIC.filter(function (s) { return tpNorm_(s) === tpNorm_(name); })[0];
    if (r) out[r] = (out[r] || 0) + amt;
  });
  return out;
}
function tpParseReq_(text) {
  var t = String(text || '').trim(), r = {}, rest = t;
  if (!t || /^none$/i.test(t)) return r;
  function take(re, fn) { var m = rest.match(re); if (m) { fn(m); rest = rest.replace(re, ''); } }
  take(/Military T(\d)/i, function (m) { r.military = Number(m[1]); });
  take(/Industry T(\d)/i, function (m) { r.industry = Number(m[1]); });
  take(/Society T(\d)/i, function (m) { r.society = Number(m[1]); });
  take(/Logistics T(\d)/i, function (m) { r.logistics = Number(m[1]); });
  take(/Development (\d)\+?/i, function (m) { r.development = Number(m[1]); });
  take(/(?:A )?Trade Hub designation/i, function () { r.tradeHub = true; });
  take(/Collective government/i, function () { r.collective = true; });
  take(/A strategic deposit/i, function () { r.deposit = true; });
  rest = rest.replace(/[;,.\s]+/g, ' ').trim();
  if (rest) r.unknown = rest;
  return r;
}
function tpStratText_(s) { return Object.keys(s || {}).filter(function (k) { return s[k]; }).map(function (k) { return s[k] + ' ' + k; }).join('; '); }
function tpCostText_(c) { return Object.keys(c).map(function (k) { return c[k] + ' ' + k; }).join(' and '); }
