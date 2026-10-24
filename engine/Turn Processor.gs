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
 *      ROUNDUP(Ground Power/4), all as Energy. From Turn 34 (designer's ruling, 23 Oct 2026) the script follows
 *      the rules: Calculations!X is fuel only, 1 Energy per 4 capacity rounded up per fleet; wages (ships
 *      1 per 4 capacity per fleet, ground about 1 per 4 Ground Power, Static Defence 1 per 4) are charged
 *      separately, in Marks or Industry, Energy and Influence, from the largest stockpiles first.
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
 *   8. Filling an empty civic slot has no cost in the rules: free, by the designer's precedent
 *      (Turn 34). Replacing a civic costs 20 Influence and 1 Stability, and only a line that
 *      clearly replaces (names the held civic with "replace", "for", "in place of") is priced so.
 *   9. Debt instalments are paid from Industry, Energy and Influence, largest first
 *      (the rules allow any resource; the sheet prices them all at 1 Mark).
 *  10. Population: settlement within a nation is automated (Settlement policy tab:
 *      row ALL is the rule, a nation's row overrides it); migration between nations
 *      is not. Growth uses Systems "Growth due" as it stood at the start of the
 *      resolution, so a colony founded this turn does not grow yet.
 *  12. GM-ruled per-turn effects live on the Standing effects tab and Imperial
 *      successions on the Successions tab; both are applied by the resolver.
 *  13. Extractors: one per deposit, recorded as "Extractor (<resource>)". Orbital
 *      buildings (Habitat Station) take no planetary slot.
 *  11. In a dry run, Calculations cannot recalculate, so the Stability step uses the
 *      targets as they stood at the start of the run.
 *  14. Routine free-form lines the script settles itself (from Turn 35):
 *      TREATY proposals, offers and declines to a nation in contact are delivered (Events
 *      rows for both); acceptances, war, peace, alliances and vassalage stay rulings.
 *      CONTACT <nation> is first contact (reach = jump range + 1 lanes). DISMANTLE refunds
 *      25% of the Industry cost and frees the slot at once. POLICY / INITIATIVE Remediate
 *      (or REMEDIATE <system> <points>), the Living compounds stipend and charters are
 *      priced and applied; any other POLICY or INITIATIVE line stays a ruling.
 *      Contact is read from the Turn log (First contact, Treaty, Trade), the Treaties,
 *      Debts and Events tabs. A nation seen only in neighbouring space is a ruling.
 *  15. Degradation lives in the Ledger (Nation = the system ID), as the World toll writes
 *      it; remediation writes a negative Degradation line there.
 *  16. Charter upkeep (3 Influence x systems held / 5 each) is charged from the Standing
 *      effects tab and recalculated each turn from the systems held; capacity is raised in
 *      Nations "Species Admin Capacity". The stipend's +1 is written to Nations
 *      "Temporary Stability target". Both lapse (row made inactive, column lowered) in any
 *      turn their upkeep cannot be paid. A missing column is skipped with a Turn log line.
 *  17. Leases. Systems "Owner" is the lessee, so output, Administrative Capacity, Stability,
 *      defence and builds already fall on it; "Lessor (sovereign)" names the sovereign. Each turn, after
 *      Upkeep, the resolver pays the lease: Rent (lessee to lessor; unpaid rent ends the lease), Extraction
 *      (the system's strategic output, from the Systems strategic columns, passed lessee to lessor), both, or
 *      Shared (half of the system's Industry, Energy, Research and Influence columns and half its strategic
 *      output, lessee to lessor). Payments are transfer lines (phase Diplomacy), as treaty fees are. A lease
 *      ends at the end of its "Lease ends (turn)"; war between the parties ends it at the start of the
 *      resolution (sovereignty to the lessor, Status "Occupied by <lessee> (T<turn>)"); an eliminated lessor
 *      leaves the world to the lessee outright, an eliminated lessee returns it; a world taken by a third
 *      power voids it. LEASE offers are delivered like treaty proposals; acceptances are rulings that list
 *      the cells to fill; LEASE END gives 5 turns' notice on an indefinite lease (written on approval).
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
    'Works in progress': ['Turn ordered', 'Nation', 'Kind', 'Item', 'System', 'Completes at end of turn', 'Action row', 'Status'],
    // Per-turn effects the GM has ruled (research breakthroughs, standing orders). Rows with the same Group
    // are applied together or not at all (e.g. a conversion's cost and its yield).
    'Standing effects': ['Nation', 'Resource', 'Amount per turn', 'Phase', 'Reason', 'Working', 'From turn', 'Until turn', 'Group', 'Active', 'Source'],
    // Settlement within a nation. Row "ALL" is the rule; a nation's own row overrides it.
    'Settlement policy': ['Nation', 'Threshold (x capacity)', 'Share % a turn', 'Take whole excess', 'Reason'],
    // Imperial successions. The latest row per nation dates the next one.
    'Successions': ['Nation', 'Ruler', 'From turn', 'Note'],
    // Hidden buildings a nation has unlocked (by discovery, ruling or licence). Only that nation may build them.
    'Unlocks': ['Nation', 'Building', 'Industry', 'Strategic', 'Requires', 'Takes a slot', 'Turns', 'Strain', 'Effect', 'Unlocked (turn)', 'Shown to player'],
    // Recipes each nation holds (advanced materials). A Synthesis Works makes one of them.
    'Recipes': ['Nation', 'Recipe', 'Yields', 'Inputs', 'Variant', 'Effect', 'Learned (turn)', 'How learned', 'Shown to player'],
    // The Galactic Exchange: one row per resource per turn, written at Resolve. Price is the published price for the next turn.
    'Exchange': ['Turn', 'Resource', 'Base', 'Price', 'Target', 'Demand', 'Supply', 'Depth', 'Inventory', 'Bought by Exchange', 'Sold by Exchange', 'Trades'],
    // Standing Exchange orders: limit orders left open, and sliced orders.
    'Exchange orders': ['Order ID', 'Nation', 'Side', 'Resource', 'Remaining', 'Limit', 'Slice', 'Turns left', 'Placed (turn)', 'Action row', 'Status', 'Note']
  },

  // Columns the script may write, by header text. '*' = any column.
  WRITABLE: {
    'Ledger': ['Turn', 'Phase', 'Nation', 'Resource', 'Amount', 'Reason', 'Working', 'Action row', 'Shown to player'],
    'Actions': ['Turn', 'Nation', 'Channel', 'Posted text', 'Verb', 'Details', 'Industry', 'Energy', 'Research', 'Influence',
                'Strategic', 'Status', 'Flag', 'GM ruling', 'Elaboration summary', 'Ledger lines'],
    'Systems': ['Owner', 'Name', 'Development', 'Designation', 'Buildings', 'Discovered by', 'Status',
                'Lessor (sovereign)', 'Lease treaty', 'Lease payment', 'Lease rent per turn', 'Lease ends (turn)'],
    'Treaties': ['Ended (turn)', 'Status'],
    'Worlds': ['System ID', 'World', 'Orbit', 'Kind', 'Environment', 'Habitable', 'Settled', 'Population (bn)', 'Buildings here', 'Description'],
    'Forces': ['Force ID', 'Owner', 'Name', 'Location', 'Escorts', 'Cruisers', 'Battleships', 'Dreadnoughts', 'Transports',
               'Ground Power', 'Static Defence', 'Note'],
    'Nations': ['Status', 'Government', 'Order–Liberty', 'Sacred–Secular', 'Martial–Pacific', 'Outward–Inward',
                'Civic 1', 'Civic 2', 'Civic 3', 'Civic 4', 'Military tier', 'Industry tier', 'Society tier', 'Logistics tier',
                'Temporary Stability target', 'Species Admin Capacity'],
    'Events': ['Turn', 'Nations', 'Kind', 'Title', 'Text', 'Shown to player', 'Source'],
    'Turn log': '*', 'Rulings': '*', 'Run log': '*', 'Works in progress': '*', 'Control': '*', 'Preview': '*',
    'Standing effects': '*', 'Settlement policy': '*', 'Successions': '*', 'Exchange': '*', 'Exchange orders': '*'
  },
  // The Galactic Exchange (rules, The Treasury). Marks are the Ledger resource below.
  MARKS: 'Stellar Marks',
  EXCHANGE: { s: 0.5, spread: 0.1, e: 0.5, smooth: 0.1, floor: 0.25, ceiling: 5, hoard: 0.4,
    depthMinMain: 10, depthMinStrat: 5, capShare: 0.25, glut: 2, base: { Industry: 1, Energy: 1, Research: 2, Influence: 1 }, baseStrat: 10 },

  RESOURCES: ['Industry', 'Energy', 'Research', 'Influence'],
  STRATEGIC: ['Adamant ore', 'Lattice crystals', 'Antimatter', 'Volatile isotopes', 'Living compounds', 'Void matter'],
  NET_INCOME_HEADERS: { Industry: 'Net Industry', Energy: 'Net Energy', Research: 'Net Research', Influence: 'Net Influence' },
  GROSS_HEADERS: { Industry: 'Gross Industry', Energy: 'Gross Energy', Research: 'Gross Research', Influence: 'Gross Influence' },
  PCT_HEADERS: { Industry: 'Industry %', Energy: 'Energy %', Research: 'Research %', Influence: 'Influence %' },
  FISCAL_PCT_HEADERS: { Industry: 'Fiscal Industry %', Energy: 'Fiscal Energy %', Research: 'Fiscal Research %', Influence: 'Fiscal Influence %' },

  VERBS: ['DEVELOP', 'DESIGNATE', 'BUILD', 'SHIP', 'GROUND', 'DEFENCE', 'RESEARCH', 'COLONIZE', 'CONTACT', 'MOVE',
          'SHIFT', 'CIVIC', 'REFORM', 'TRANSFER', 'STABILITY', 'FATE', 'BURN', 'BREAK', 'BUY', 'SELL', 'CANCEL',
          'TREATY', 'POLICY', 'INITIATIVE', 'DISMANTLE', 'REMEDIATE', 'LEASE'],
  VERB_ALIASES: { DEFENSE: 'DEFENCE', COLONISE: 'COLONIZE', REMEDIATION: 'REMEDIATE' },

  // Rules: Development to level N costs 3 x N Industry.
  DEVELOPMENT_COST_PER_LEVEL: 3,
  // Rules: colonization needs Stability above Unrest (4 or more).
  UNREST_AT_OR_BELOW: 3,
  COLONY_SETTLERS_BN: 0.3,
  // Rules: each colony after the first ordered in the same turn (expeditions included) costs 5 Influence more.
  COLONY_SURCHARGE_INFLUENCE: 5,
  BASE_JUMP_RANGE: 3,
  STABILITY_PURCHASE_INFLUENCE: 5,
  // Rules, Paying in Marks: +1 Stability = that turn's Influence price x 5 x 1.5; a second purchase within 3 turns costs double.
  STABILITY_MARKS_FACTOR: 1.5,
  DISMANTLE_REFUND: 0.25,
  REMEDIATION_INDUSTRY_PER_POINT: 2,
  REMEDIATION_MAX_POINTS: 10,
  STIPEND: { resource: 'Living compounds', units: 2, reason: 'Living compounds stipend: +1 Stability target' },
  CHARTER: { max: 0, society: 4, societyCollective: 3, influencePerSystem: 3, divisor: 5 },
  // Nations columns written by the stipend and by charters (skipped with a Turn log line if missing).
  TEMP_TARGET_COLUMN: 'Temporary Stability target',
  ADMIN_CAPACITY_COLUMN: 'Species Admin Capacity',
  // Leases (rules, Partnerships). Systems "Owner" is the nation that administers the system (the lessee);
  // these columns hold the sovereign and the terms. Any of them may be missing: a missing column reads blank.
  LEASE: { lessor: 'Lessor (sovereign)', treaty: 'Lease treaty', payment: 'Lease payment', rent: 'Lease rent per turn',
    ends: 'Lease ends (turn)', notice: 5, forms: ['Rent', 'Extraction', 'Rent and extraction', 'Shared'] },
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
    'Barracks':               { industry: 10, strat: {}, req: {}, turns: 1, slot: true },
    'Vehicle Factory':        { industry: 15, strat: {}, req: { military: 2 }, turns: 1, slot: true },
    'Habitat Station':        { industry: 12, strat: {}, req: { society: 2 }, turns: 1, slot: false, orbital: true },  // orbital: takes no planetary slot (ruling, Turn 26)
    'Arcology':               { industry: 20, strat: { 'Lattice crystals': 1 }, req: { industry: 4, development: 3 }, turns: 2, slot: true },
    'Planetary Shield':       { industry: 20, strat: { 'Lattice crystals': 2 }, req: { military: 4 }, turns: 2, slot: true, installation: true },
    'Orbital Fortress':       { industry: 25, strat: { 'Adamant ore': 2 }, req: { military: 3 }, turns: 2, slot: false, orbital: true, installation: true },  // orbital slot (designer, Turn 35)
    'Gravity Well Generator': { industry: 20, strat: { 'Antimatter': 2, 'Lattice crystals': 1 }, req: { logistics: 4 }, turns: 2, slot: false, orbital: true, installation: true }  // orbital slot (designer, Turn 35)
  },
  // Buildings that may stand more than once in a system (designer, Turn 36). Each copy of a yield building
  // after the first yields half (Systems formulas); each Barracks or Vehicle Factory adds its own training.
  STACKABLE: ['Foundry', 'Power Plant', 'Research Institute', 'Civic Hall', 'Barracks', 'Vehicle Factory'],
  // Ground formations are raised at a Barracks (infantry of every kind) or a Vehicle Factory (designer, Turn 36).
  // Each copy trains up to TRAIN_PER_DEV x the world's Development in capacity a turn.
  // A world under attack may muster Infantry without one, at MUSTER_COST_X the cost.
  FORMATION_SITE: { 'Infantry': 'Barracks', 'Specialised Infantry': 'Barracks', 'Special Forces': 'Barracks',
    'Armour': 'Vehicle Factory', 'Heavy Armour': 'Vehicle Factory', 'Artillery': 'Vehicle Factory', 'Heavy Artillery': 'Vehicle Factory' },
  TRAIN_PER_DEV: 2, MUSTER_COST_X: 2,
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
  world.turnNo = turn;
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

  // Nations that return leave Caretaker at once. Entering Caretaker is decided at Resolve
  // (tpResolver_.phaseCaretaker), so a Prepare run before the deadline cannot halve anyone's income.
  world.nations.forEach(function (n) {
    if (n.status === 'Eliminated' || n.status === 'Minor Power') return;
    var has = !!subs.byNation[n.id];
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
  lines(sub.routine).forEach(function (t) { tpExpandList_(t).forEach(function (x) { out.push(tpMakeOrder_(x, 'Routine', '')); }); });
  sub.plans.forEach(function (p, i) {
    if (!p || !String(p).trim()) return;
    var plan = tpParsePlan_(String(p));
    var label = 'Plan ' + (i + 1) + ' "' + plan.name + '"' + (plan.objective ? ': ' + plan.objective : '');
    plan.orders.forEach(function (t) { tpExpandList_(t).forEach(function (x) { out.push(tpMakeOrder_(x, 'Plan ' + (i + 1), label)); }); });
    if (plan.covert) {
      var o = { text: plan.covert, channel: 'Covert', verb: 'COVERT', planLabel: label, supports: plan.supports };
      out.push(o);
    }
  });
  if (sub.covert && String(sub.covert).trim()) out.push({ text: String(sub.covert).trim(), channel: 'Covert', verb: 'COVERT', planLabel: 'No plan' });
  return out;
}

/** "COLONIZE C-04, II-05 and II-19" -> one order per system (COLONIZE, CONTACT, DEVELOP only). */
function tpExpandList_(text) {
  var m = String(text).match(/^\s*(COLONI[SZ]E|CONTACT|DEVELOP)\s*:?\s+(.+)$/i);
  if (!m) return [text];
  var items = m[2].split(/\s*(?:,|;|\band\b|&)\s*/i).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
  if (items.length < 2 || !items.every(function (x) { return /^(?:C|I|II|III|IV|V|VI)-\d{1,2}(?:\s+(?:to\s+)?\d)?$/i.test(x); })) return [text];
  return items.map(function (x) { return m[1].toUpperCase() + ' ' + x; });
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
  // An expedition (a ruling) still counts toward the colony surcharge of later colonies.
  if (ev.expedition) sim.colonyCount++;
  if (depNote) ev.flag = ev.flag ? ev.flag + '; ' + depNote : depNote;
  if (o.dependsOn) ev.dependsOn = o.dependsOn;
  if (ev.status === 'Ready') {
    var aff = tpAffordable_(sim, ev);
    if (!aff.ok) return Object.assign(ev, { status: 'Rejected', flag: 'Unaffordable: ' + aff.text, spec: ev.spec });
    tpCommitSim_(sim, ev);
  }
  return ev;
}

/** Players often end a line with a remark in parentheses ("COLONIZE C-14 (Rich Toxic, one lane from C-07)").
 *  The remark is dropped when what is left still names a system (an ID, or @ <place>), so a material or
 *  environment in parentheses ("Extractor (Void matter) @ C-07") is untouched. Diplomacy and prose verbs keep it. */
function tpStripRemark_(verb, args) {
  if (/^(?:TREATY|POLICY|INITIATIVE|STABILITY|COVERT|NOTE|CONTACT|LEASE)$/.test(verb)) return args;
  var out = args, prev;
  do {
    prev = out;
    var cut = out.replace(/\s*\([^()]*\)\s*\.?\s*$/, '');
    if (cut !== out && cut && (/@/.test(cut) || /\b(?:[IVX]+|C)-\d{1,2}\b/.test(cut))) out = cut;
  } while (out !== prev);
  return out;
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
  args = tpStripRemark_(verb, args);
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
    case 'BUY': case 'SELL': return tpEvExchange_(world, sim, verb, args);
    case 'CANCEL': return tpEvCancel_(world, sim, args);
    case 'CONTACT': return tpEvContact_(world, sim, args, phase);
    case 'TREATY': return tpEvTreaty_(world, sim, args);
    case 'LEASE': return tpEvLease_(world, sim, args);
    case 'DISMANTLE': return tpEvDismantle_(world, sim, args);
    case 'REMEDIATE': return tpEvRemediate_(world, sim, args);
    case 'POLICY': case 'INITIATIVE': return tpEvPolicy_(world, sim, verb, args);
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
  // Also reads "Raise C-04 to 4", "C-04: 4" and "C-04 to Development 4".
  args = String(args).replace(/^\s*:\s*/, '').replace(/^(?:raise|level|lift|increase)\s+/i, '').replace(/[:,]/g, ' ').trim();
  var m = args.match(/^(.*?)(?:\s+(?:to\s+)?(?:development\s+|level\s+)?(\d))?\s*$/i);
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
  if (!found) {
    // Designation written first: "DESIGNATE Academy II-07".
    desigs.forEach(function (d) {
      var re2 = new RegExp('^\\s*:?\\s*' + tpEscapeRe_(d) + '\\s*(?:at|@|for|:)?\\s+', 'i');
      if (!found && re2.test(args)) { found = d; rest = args.replace(re2, ''); }
    });
  }
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
  // "Extractor (Living compounds)" or "Extractor for Living compounds" names the deposit worked.
  var depositWanted = '';
  var em = name.match(/^extractors?\s*(?:\(\s*([^)]+?)\s*\)|(?:for|on)\s+(.+))$/i);
  if (em) { depositWanted = (em[1] || em[2] || '').trim(); name = 'Extractor'; }
  if (TURN_CONFIG.MEGAPROJECTS.some(function (mp) { return tpNorm_(mp) === tpNorm_(name); })) {
    return tpRuling_('Megaproject', 'Megaprojects are built over several turns under limits the GM checks', 'Check Megaprojects: requirements, cost paid when work begins, turns listed.');
  }
  // "BUILD 1 Escort at IV-09": ships written under BUILD go to SHIP.
  var shipQ = tpParseQty_(name);
  if (!world.building(name) && world.shipCategory(shipQ.name)) return tpEvShip_(world, sim, args);
  var sys = world.findSystem(p.where);
  if (!sys) return tpRuling_('System not found: "' + p.where + '"', 'The script cannot find this system', 'Identify the system.');
  if (!sim.ownsActive(sys.id)) return tpReject_('Not held by this nation: ' + tpSysLabel_(sys));
  var sig = tpFindKey_(TURN_CONFIG.SIGNATURE_WORKS, name);
  if (sig) return tpEvSignatureWork_(world, sim, sys, sig);
  var ub = world.unlockedBuilding(sim.nid, name);
  if (ub && ub.error) return tpReject_(ub.error);
  if (ub) return tpBuildChecks_(world, sim, sys, ub, depositWanted);
  var b = world.building(name), copies = 1;
  if (!b) { var bq = tpParseQty_(name); if (bq.n > 1 && world.building(bq.name)) { b = world.building(bq.name); copies = bq.n; } }
  if (!b) return tpRuling_('Building not recognised: "' + name + '"', 'Not in Tables or the rules', 'Identify the building or treat as lore.');
  return tpBuildChecks_(world, sim, sys, b, depositWanted, copies);
}

// Extractors: one per deposit, not one per system (ruling, Turn 26). Each is recorded
// as "Extractor (<resource>)"; a legacy plain "Extractor" covers the first deposit
// not otherwise covered.
function tpExtractorPlan_(sys, existing, wanted) {
  var deps = String(sys.get('Deposits') || '').split(/\s*;\s*/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
  var covered = {}, plain = 0;
  existing.forEach(function (x) {
    var m = String(x).match(/^extractor\s*\(\s*([^)]+?)\s*\)$/i);
    if (m) covered[tpNorm_(m[1])] = true; else if (tpNorm_(x) === 'extractor') plain++;
  });
  deps.forEach(function (d) { if (plain > 0 && !covered[tpNorm_(d)]) { covered[tpNorm_(d)] = true; plain--; } });
  if (!deps.length) return { error: 'Requires a strategic deposit in the system' };
  if (wanted) {
    var hit = deps.filter(function (d) { return tpNorm_(d) === tpNorm_(wanted); })[0];
    if (!hit) return { error: tpSysLabel_(sys) + ' has no ' + wanted + ' deposit (it holds ' + deps.join(' and ') + ')' };
    if (covered[tpNorm_(hit)]) return { error: 'The ' + hit + ' deposit in ' + tpSysLabel_(sys) + ' already has an Extractor' };
    return { deposit: hit };
  }
  var free = deps.filter(function (d) { return !covered[tpNorm_(d)]; });
  if (!free.length) return { error: 'Every deposit in ' + tpSysLabel_(sys) + ' already has an Extractor; one per deposit' };
  return { deposit: free[0], note: free.length > 1 ? 'works the ' + free[0] + ' deposit (name another in brackets to choose)' : '' };
}

function tpBuildChecks_(world, sim, sys, b, depositWanted, copies) {
  var existing = sim.buildingsOf(sys.id);
  var isExtractor = tpNorm_(b.name) === 'extractor', plan = null;
  var stackable = TURN_CONFIG.STACKABLE.some(function (x) { return tpNorm_(x) === tpNorm_(b.name); });
  copies = copies || 1;
  if (copies > 1 && (!stackable || (b.turns || 1) > 1)) return tpReject_(b.name + ' may stand only once in a system');
  if (isExtractor) {
    plan = tpExtractorPlan_(sys, existing, depositWanted);
    if (plan.error) return tpReject_(plan.error);
  } else if (!stackable && existing.some(function (x) { return tpNorm_(x) === tpNorm_(b.name) || tpNorm_(String(x).replace(/\s*\(.*\)\s*$/, '')) === tpNorm_(b.name); })) return tpReject_(b.name + ' already stands (or is ordered) in ' + tpSysLabel_(sys) + '; once per system');
  var r = b.req || {};
  var tiers = sim.tiers;
  if (r.military && tiers.Military < r.military) return tpReject_('Requires Military Tier ' + r.military);
  if (r.industry && tiers.Industry < r.industry) return tpReject_('Requires Industry Tier ' + r.industry);
  if (r.society && tiers.Society < r.society) return tpReject_('Requires Society Tier ' + r.society);
  if (r.logistics && tiers.Logistics < r.logistics) return tpReject_('Requires Logistics Tier ' + r.logistics);
  if (r.development && tpNum_(sys.get('Development')) < r.development) return tpReject_('Requires Development ' + r.development);
  if (r.tradeHub && sim.desigOf(sys.id) !== 'Trade Hub') return tpReject_('Requires a Trade Hub designation');
  if (r.collective && sim.gov !== 'Collective') return tpReject_('Requires Collective government');
  if (r.deposit && !isExtractor && !String(sys.get('Deposits') || '').trim()) return tpReject_('Requires a strategic deposit in the system');
  if (r.unknown) return tpRuling_('Requirement the script cannot read: ' + r.unknown, 'Unreadable requirement in Tables', 'Check the requirement.');
  var free = tpNum_(sys.get('Slots')) - tpNum_(sys.get('Slots used')) - (sim.slotsAdded[sys.id] || 0);
  if (b.slot !== false && free < copies) return tpReject_((copies > 1 ? 'Not enough free building slots in ' + tpSysLabel_(sys) + ' for ' + copies + ' (' + Math.max(0, free) + ' free)' : 'No free building slot in ' + tpSysLabel_(sys)) + '; a system has one slot per Development level');
  if (b.orbital) {
    var hostO = world.hostileSpace(sim.nid, sys.id);
    if (hostO) return tpReject_('Hostile forces hold ' + tpSysLabel_(sys) + '\'s space (' + hostO + '): no orbital construction until they are driven off');
    // Orbital slots (ruling, 23 Oct 2026): one per system, plus one at Development 4.
    var oSlots = 1 + (tpNum_(sys.get('Development')) >= 4 ? 1 : 0);
    var oUsed = existing.filter(function (x) { return tpIsOrbital_(world, x); }).length;
    if (oUsed >= oSlots) return tpReject_('No free orbital slot in ' + tpSysLabel_(sys) + ' (' + oUsed + ' of ' + oSlots + ' used; one more opens at Development 4)');
  }
  var ex = sim.calc['Extractor cost (Industry)'];
  var industry = (b.name === 'Extractor' && ex !== '' && ex !== undefined && ex !== null ? tpNum_(ex) : b.industry) * copies;
  var notes = [];
  if (stackable && /^(Foundry|Power Plant|Research Institute|Civic Hall)$/.test(b.name) && existing.some(function (x) { return tpNorm_(x) === tpNorm_(b.name); })) notes.push('a further copy yields half');
  if (b.oncePerNation && sim.nationHasBuilding(b.name)) notes.push('counts once per nation: no further effect');
  if (b.orbital) notes.push('orbital: takes an orbital slot, not a building slot');
  var built = isExtractor ? 'Extractor (' + plan.deposit + ')' : (b.builtName || b.name);
  if (plan && plan.note) notes.push(plan.note);
  var turns = b.turns || 1;
  var bstrat = {}; Object.keys(b.strat || {}).forEach(function (k) { bstrat[k] = b.strat[k] * copies; });
  return tpReady_((copies > 1 ? copies + ' x ' : '') + built + ' at ' + tpSysLabel_(sys) + (turns > 1 ? ' (' + turns + ' turns)' : ''),
    'Cost ' + industry + ' Industry' + (tpStratText_(bstrat) ? ' and ' + tpStratText_(bstrat) : '') + (notes.length ? '; ' + notes.join('; ') : ''),
    { Industry: industry }, bstrat, { type: 'BUILD', sys: sys.id, building: built, turns: turns, orbital: !!b.orbital, copies: copies });
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
  // Military Capacity (designer, Turn 36): ships and ground formations share one pool (Calculations "Fleet Capacity").
  var used = tpNum_(sim.calc['Ship capacity used']) + tpNum_(sim.calc['Ground Power']) + sim.shipCapAdded + sim.armyCapAdded;
  var fc = tpNum_(sim.calc['Fleet Capacity']);
  if (used + capAdd > fc) return tpReject_('Over Military Capacity: ' + tpRound2_(used) + ' used + ' + capAdd + ' > ' + fc);
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
  var used = tpNum_(sim.calc['Ship capacity used']) + tpNum_(sim.calc['Ground Power']) + sim.shipCapAdded + sim.armyCapAdded;
  var ac = tpNum_(sim.calc['Fleet Capacity']);
  if (used + capAdd > ac) return tpReject_('Over Military Capacity: ' + tpRound2_(used) + ' used + ' + capAdd + ' > ' + ac);
  // Training sites (designer, Turn 36): a Barracks or a Vehicle Factory at this world, each copy training up to
  // 2 x Development capacity a turn. A world under attack may muster Infantry without one, at double cost.
  var site = TURN_CONFIG.FORMATION_SITE[fname], costX = 1, siteNote = '';
  if (site) {
    var have = sim.buildingsOf(sys.id).filter(function (x) { return tpNorm_(x) === tpNorm_(site); }).length;
    var key = sys.id + '|' + site;
    sim.trained = sim.trained || {};
    var room = have * TURN_CONFIG.TRAIN_PER_DEV * tpNum_(sys.get('Development')) - (sim.trained[key] || 0);
    var attacked = world.underAttack(sim.nid, sys.id);
    if (!have) {
      if (fname === 'Infantry' && attacked) { costX = TURN_CONFIG.MUSTER_COST_X; siteNote = 'mustered under attack (' + attacked + ') without a Barracks: double cost'; }
      else return tpReject_(fname + ' is raised at a ' + site + '; ' + tpSysLabel_(sys) + ' has none' + (fname === 'Infantry' ? ' (a world under attack may muster Infantry at double cost)' : ''));
    } else if (capAdd > room) {
      return tpReject_(tpSysLabel_(sys) + '\'s ' + (have > 1 ? have + ' ' + site + (site === 'Barracks' ? '' : 's') : site) + ' can train ' + Math.max(0, room) + ' more capacity this turn (' + TURN_CONFIG.TRAIN_PER_DEV + ' x Development each); ' + capAdd + ' ordered');
    } else siteNote = 'trained at the ' + site + ' (' + (room - capAdd) + ' capacity left there this turn)';
  }
  var cost = f.industry * q.n * costX;
  var strat = {};
  Object.keys(f.strat).forEach(function (s) { strat[s] = f.strat[s] * q.n; });
  return tpReady_(q.n + ' ' + fname + (env ? ' (' + env + ')' : '') + ' at ' + tpSysLabel_(sys) + (f.turns > 1 ? ' (' + f.turns + ' turns)' : ''),
    q.n + ' x ' + f.industry + (costX > 1 ? ' x ' + costX : '') + ' = ' + cost + ' Industry' + (tpStratText_(strat) ? '; ' + tpStratText_(strat) : '') + '; capacity ' + capAdd + ' (' + tpRound2_(used + capAdd) + ' of ' + ac + ' Military Capacity)' + (siteNote ? '; ' + siteNote : ''),
    { Industry: cost }, strat, { type: 'GROUND', sys: sys.id, form: fname, n: q.n, env: env, turns: f.turns, site: site && costX === 1 ? sys.id + '|' + site : '' }, { armyAdd: capAdd });
}

// ---------- DEFENCE [Static Defence] <points> @ <system>  |  DEFENCE <installation> @ <system> ----------
function tpEvDefence_(world, sim, args) {
  var p = tpSplitAt_(args);
  if (!p) { var dm = String(args).match(/^\s*(\S+)\s+(\d+)\s*$/); if (dm && world.findSystem(dm[1])) p = { what: dm[2], where: dm[1] }; }
  if (!p) return tpRuling_('No system given (write DEFENCE <points> @ <system>)', 'The system is missing', 'Identify the system.');
  var inst = tpFindKey_(TURN_CONFIG.RULE_BUILDINGS, p.what.replace(/^(?:an?|the)\s+/i, ''));
  if (inst && TURN_CONFIG.RULE_BUILDINGS[inst].installation) {
    var s0 = world.findSystem(p.where);
    if (!s0) return tpRuling_('System not found: "' + p.where + '"', 'The script cannot find this system', 'Identify the system.');
    if (!sim.ownsActive(s0.id)) return tpReject_('Not held by this nation: ' + tpSysLabel_(s0));
    return tpBuildChecks_(world, sim, s0, world.building(inst));
  }
  var m = p.what.match(/(\d+)/);
  if (!m || !/^(?:static\s+defen[cs]e\s*)?x?\s*\d+(?:\s*(?:points?|pts?))?(?:\s*(?:of\s+)?static\s+defen[cs]e)?$/i.test(p.what.trim())) {
    return tpRuling_('Defence not recognised: "' + p.what + '"', 'Not Static Defence or a listed installation', 'Identify the defence.');
  }
  var pts = Number(m[1]);
  var sys = world.findSystem(p.where);
  if (!sys) return tpRuling_('System not found: "' + p.where + '"', 'The script cannot find this system', 'Identify the system.');
  if (!sim.ownsActive(sys.id)) return tpReject_('Not held by this nation: ' + tpSysLabel_(sys));
  if (sim.tiers.Military < TURN_CONFIG.STATIC_DEFENCE_MILITARY_TIER) return tpReject_('Static Defence requires Military Tier ' + TURN_CONFIG.STATIC_DEFENCE_MILITARY_TIER);
  var hostD = world.hostileSpace(sim.nid, sys.id);
  if (hostD) return tpReject_('Hostile forces hold ' + tpSysLabel_(sys) + '\'s space (' + hostD + '): Static Defence cannot be raised until they are driven off');
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
  // Each colony after the first ordered this turn, expeditions included, costs 5 Influence more.
  var nth = (sim.colonyCount || 0) + 1, extra = nth > 1 ? TURN_CONFIG.COLONY_SURCHARGE_INFLUENCE : 0;
  var d = world.distanceFromSet(Object.keys(sim.owned).filter(function (k) { return sim.ownsActive(k); }), sys.id, reach);
  if (d < 0) return tpRuling_('Beyond reach: an expedition', 'The target is more than ' + reach + ' lane(s) from the nation\'s systems',
    'Expedition: pay the colony cost now' + (extra ? ' (colony ' + nth + ' ordered this turn: +' + extra + ' Influence)' : '') + '; it travels at the jump range like a fleet.', { expedition: true });
  var env = sys.get('Environment');
  var col = env === 'Oceanic' ? 'Colony cost: Oceanic world' : env === 'Garden' ? 'Colony cost: Garden world' :
    (['Barren', 'Frozen', 'Arid', 'Volcanic', 'Toxic'].indexOf(env) >= 0 ? 'Colony cost: Barren, Frozen, Arid, Volcanic or Toxic world' : '');
  if (!col) return tpRuling_('No colony cost for environment "' + env + '"', 'Calculations prices Oceanic, Garden and the hostile five only', 'Price the colony.');
  var c = tpNum_(sim.calc[col]);
  var avail = sim.totalPopulation();
  if (avail < TURN_CONFIG.COLONY_SETTLERS_BN) return tpReject_('Not enough people to send ' + TURN_CONFIG.COLONY_SETTLERS_BN + ' bn settlers');
  return tpReady_(tpSysLabel_(sys) + ' (' + env + ')' + (desig ? ' as ' + desig : '') + '; ' + TURN_CONFIG.COLONY_SETTLERS_BN + ' bn settlers',
    'Colony cost (' + env + '): ' + c + ' Influence and ' + c + ' Energy' +
    (extra ? '; colony ' + nth + ' ordered this turn: +' + extra + ' Influence (each colony after the first) = ' + (c + extra) + ' Influence' : '') +
    (desig ? '' : '; no designation given, so it produces nothing until designated'),
    { Influence: c + extra, Energy: c }, {}, { type: 'COLONIZE', sys: sys.id, name: (given && tpNorm_(given) !== tpNorm_(sys.id)) ? given : '', desig: desig });
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
  route = route.replace(/\s*\([^()]*\)/g, '').replace(/\s*[;,].*$/, '');
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
/** Reads a CIVIC line: the strict forms first, then (for prose such as "Adopt X as third civic ...")
 *  the known civic names found in the line. Returns { nc, oc } or { error: <evaluation> }. */
function tpParseCivic_(args, sim) {
  var names = Object.keys(TURN_CONFIG.CIVICS);
  var m = args.match(/^(?:replace\s+)?(.+?)\s+(?:with|by|->|→|>)\s+(.+)$/i);
  var oldC = '', newC = '';
  if (m && /^replace/i.test(args)) { oldC = m[1]; newC = m[2]; }
  else {
    var m2 = args.match(/^(?:adopt\s+|add\s+)?(.+?)\s+(?:for|replacing|in place of|instead of)\s+(.+)$/i);
    if (m2) { newC = m2[1]; oldC = m2[2]; } else if (m) { oldC = m[1]; newC = m[2]; } else newC = args.replace(/^(?:adopt|add)\s+/i, '');
  }
  var nc = names.filter(function (x) { return tpNorm_(x) === tpNorm_(newC); })[0];
  var oc = oldC ? names.filter(function (x) { return tpNorm_(x) === tpNorm_(oldC); })[0] : '';
  if (nc && (!oldC || oc)) return { nc: nc, oc: oc || '' };
  // Prose: find the civic names in the line, in the order written.
  var t = ' ' + tpNorm_(args) + ' ';
  var found = names.map(function (x) { var mm = t.match(new RegExp('[^a-z]' + tpEscapeRe_(tpNorm_(x)) + '(?=[^a-z])')); return mm ? { name: x, at: mm.index } : null; })
    .filter(function (x) { return x; }).sort(function (a, b) { return a.at - b.at; }).map(function (x) { return x.name; });
  if (!found.length) {
    if (!nc) return { error: tpRuling_('Civic not recognised: "' + newC + '"', 'Not a civic in the rules', 'Identify the civic.') };
    return { error: tpRuling_('Civic not recognised: "' + oldC + '"', 'Not a civic in the rules', 'Identify the civic.') };
  }
  var held = found.filter(function (x) { return sim.civics.indexOf(x) >= 0; });
  var fresh = found.filter(function (x) { return sim.civics.indexOf(x) < 0; });
  // A replacement only when the line clearly says so ("not a replacement" does not count).
  var replaces = /\breplac(?:e|es|ing)\b|\bin place of\b|\binstead of\b/i.test(args) && !/\bnot\s+(?:a\s+)?replac/i.test(args);
  if (!fresh.length) return { error: tpReject_('Already holds ' + held[0]) };
  if (fresh.length > 1) return { error: tpRuling_('Several civics named: ' + fresh.join(', '), 'The line names more than one civic the nation does not hold', 'Identify the civic to adopt.') };
  if (replaces && held.length > 1) return { error: tpRuling_('Civic to replace not clear: ' + held.join(', '), 'The line names more than one held civic', 'Identify the civic to replace.') };
  if (replaces && !held.length) return { error: tpRuling_('Civic to replace not named', 'The line says replace but names no civic the nation holds', 'Identify the civic to replace.') };
  return { nc: fresh[0], oc: replaces ? held[0] : '' };
}

function tpEvCivic_(world, sim, args) {
  var parsed = tpParseCivic_(String(args || ''), sim);
  if (parsed.error) return parsed.error;
  var nc = parsed.nc, oc = parsed.oc;
  if (sim.civics.indexOf(nc) >= 0) return tpReject_('Already holds ' + nc);
  if (oc && sim.civics.indexOf(oc) < 0) return tpReject_('Does not hold ' + oc);
  var after = sim.civics.filter(function (c) { return c !== oc; }).concat([nc]);
  var allowed = tpCivicAllowed_(nc, Object.assign({}, sim, { civics: after }), sim.axes, sim.gov);
  if (allowed.ok === false) return tpReject_(nc + ' ' + allowed.why);
  var slots = 2 + (sim.tiers.Society >= 3 ? 1 : 0) + (sim.tiers.Society >= 5 ? 1 : 0);
  if (!oc) {
    // Filling an empty slot is free (designer's precedent, Turn 34). The third slot opens at Society Tier 3, the fourth at Tier 5.
    var ord = String(args).match(/\b(third|3rd|fourth|4th)\b/i), col0;
    if (ord) {
      var k = /^(?:third|3rd)$/i.test(ord[1]) ? 3 : 4, word = k === 3 ? 'third' : 'fourth';
      if (k > slots) return tpReject_('The ' + word + ' civic slot opens at Society Tier ' + (k === 3 ? 3 : 5) + ' (Society Tier ' + sim.tiers.Society + ' now; a tier researched this turn arrives at the end of the turn)');
      col0 = TURN_CONFIG.CIVIC_COLUMNS[k - 1];
      if (sim.civicCols[col0]) return tpReject_('The ' + word + ' civic slot already holds ' + sim.civicCols[col0] + '; write CIVIC replace ' + sim.civicCols[col0] + ' with ' + nc);
    } else {
      col0 = TURN_CONFIG.CIVIC_COLUMNS.slice(0, slots).filter(function (c) { return !sim.civicCols[c]; })[0];
      if (!col0) return tpReject_('All ' + slots + ' civic slots are full; name the civic to replace');
    }
    var ev0 = tpReady_('Adopt ' + nc + ' in ' + col0, 'Empty civic slot (' + slots + ' open at Society Tier ' + sim.tiers.Society + '): free, by the designer\'s precedent; requirement met',
      {}, {}, { type: 'CIVIC', col: col0, value: nc, old: '' });
    if (allowed.ok === 'ask') return Object.assign(ev0, { status: 'Needs ruling', flag: nc + ': ' + allowed.why, why: 'Cybernetic biology may or may not be 50% organic', suggest: 'Rule on the species; the slot itself is free.' });
    return ev0;
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
// Also reads prose: "+1 (pay 5 Influence)", "Buy +1 for 5 Influence (only if ...)", "+1 (pay in Stellar Marks ...)".
function tpEvStability_(world, sim, args) {
  var text = String(args || ''), bare = text.replace(/\([^)]*\)/g, ' ');
  // The amount is the first number that is not a price ("5 Influence", "7.5 Marks").
  var amount = null;
  bare.replace(/([+\-−]?)\s*(\d+(?:\.\d+)?)\s*([A-Za-z]*)/g, function (all, sg, num, word) {
    if (amount === null && !/^(?:influence|stellar|marks?|sm|industry|energy|research|turns?)$/i.test(word)) amount = (sg === '-' || sg === '−' ? -1 : 1) * Number(num);
    return all;
  });
  if (amount === null) amount = 1;
  if (amount !== 1) return tpRuling_('Only one point of Stability may be bought a turn', 'Unreadable amount', 'Treat as one point.');
  var inMarks = /\b(?:in|with|using)\s+(?:stellar\s+)?marks\b/i.test(text) || (/\bmarks\b/i.test(text) && !/influence/i.test(text));
  if (sim.gov === 'Collective') return tpReject_('A Collective cannot buy Stability' + (inMarks ? ', in Marks or Influence' : ' with Influence'));
  if (sim.stabBought) return tpReject_('Stability may be bought once a turn');
  var target = tpNum_(sim.calc['Stability target']) + (sim.targetBonus || 0);
  var tnote = sim.targetBonus ? ' (includes +' + sim.targetBonus + ' ordered this turn)' : '';
  if (sim.stability + 1 > target) return tpReject_('Bought Stability never raises it above its target (' + sim.stability + ' of ' + target + tnote + ')');
  var cond = (text.match(/\bonly if\b[^);]*/i) || [])[0];
  var condNote = cond ? '; "' + cond.trim() + '" is the rule\'s own limit, checked against the target as it stands' : '';
  var details = '+1 Stability (' + sim.stability + ' to ' + (sim.stability + 1) + ', target ' + target + tnote + ')';
  var ev;
  if (inMarks) {
    var x = world.exchangeState().Influence, mult = TURN_CONFIG.STABILITY_PURCHASE_INFLUENCE * TURN_CONFIG.STABILITY_MARKS_FACTOR;
    var recent = world.recentMarksStability(sim.nid);
    var marks = tpRound2_(x.price * mult * (recent ? 2 : 1));
    var strat = {}; strat[TURN_CONFIG.MARKS] = marks;
    ev = tpReady_(details, 'Paid in Marks: Influence price ' + tpRound2_(x.price) + ' x 5 x 1.5' + (recent ? ' x 2 (second purchase in Marks within 3 turns: Turn ' + recent + ')' : '') + ' = ' + marks + ' Marks' + condNote,
      {}, strat, { type: 'STABILITY' });
    ev.stabWorking = 'Bought with ' + marks + ' Marks';
  } else {
    ev = tpReady_(details, '5 Influence' + condNote, { Influence: TURN_CONFIG.STABILITY_PURCHASE_INFLUENCE }, {}, { type: 'STABILITY' });
  }
  ev.stab = -1;
  return ev;
}

// ---------- CONTACT <strategy> @ <system>  |  CONTACT <nation> ----------
function tpEvContact_(world, sim, args, phase) {
  if (!/@/.test(args)) {
    var nt = String(args).replace(/^\s*:?\s*(?:with\s+)?/i, '').replace(/\s*\([^)]*\)\s*$/, '').replace(/[.;,]+\s*$/, '').trim();
    var tn = world.nationByName(nt);
    if (tn) return tpEvContactNation_(world, sim, tn, phase);
  }
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

// ---------- CONTACT <nation>: first contact (rules, First Contact) ----------
// Free; the other nation must hold a system within the initiator's jump range + 1 lanes.
function tpEvContactNation_(world, sim, tn, phase) {
  if (tn.id === sim.nid) return tpReject_('A nation cannot contact itself');
  if (tn.status === 'Eliminated') return tpReject_(tn.name + ' is eliminated');
  if (sim.contacted[tn.id]) return tpReject_('Contact with ' + tn.name + ' is already ordered this turn');
  var rec = world.contactWith(sim.nid, tn.id), already = false;
  if (rec) {
    // At Resolve, the other nation may have made the same contact earlier this turn.
    if (phase === 'resolve' && rec.made && rec.turn === world.turnNo) already = true;
    else return tpReject_('Already in contact with ' + tn.name + ' (' + rec.how + ')');
  }
  var range = TURN_CONFIG.BASE_JUMP_RANGE + Math.max(0, sim.tiers.Logistics - 1), reach = range + 1;
  var mine = Object.keys(sim.owned).filter(function (k) { return sim.ownsActive(k); });
  if (!mine.length) return tpReject_('Holds no system to reach from');
  var dist = world.lanesFrom(mine), best = null;
  world.systems.forEach(function (s) {
    if (String(s.get('Owner') || '') !== tn.id) return;
    var d = dist[s.id];
    if (d !== undefined && (!best || d < best.d)) best = { d: d, sys: s.id };
  });
  if (!best) return tpReject_('Out of reach: no lane route to any system ' + tn.name + ' holds');
  if (best.d > reach) return tpReject_('Out of reach: ' + tn.name + '\'s nearest system, ' + world.label(best.sys) + ', is ' + best.d + ' lanes away; reach is ' + reach + ' (jump range ' + range + ' + 1)');
  var back = world.lanesFrom([best.sys]);
  var near = mine.filter(function (k) { return back[k] === best.d; })[0];
  return tpReady_('First contact with ' + tn.name + (already ? ' (already made this turn from the other side)' : ''),
    tn.name + ' holds ' + world.label(best.sys) + ', ' + best.d + ' lane' + (best.d === 1 ? '' : 's') + (near ? ' from ' + world.label(near) : '') +
    '; reach ' + reach + ' (jump range ' + range + ' + 1). Free; contact is made this turn and diplomacy may begin next turn',
    {}, {}, { type: 'FIRST_CONTACT', target: tn.id, already: already, dist: best.d });
}

// ---------- TREATY <nation>: ... | TREATY Propose to <nation>: ... | TREATY Decline ... ----------
// Proposals, offers and declines are delivered and answered next turn. Acceptances (which make a
// treaty) and anything about war, peace, alliances or vassalage stay with the GM.
function tpEvTreaty_(world, sim, args) {
  var text = String(args || '').replace(/^\s*[:\-–—]\s*/, '').trim();
  var me = world.nation(sim.nid) || { name: sim.nid };
  var to = null, m, body = text;
  m = text.match(/^(?:propos(?:e|al|ed)|offers?|offered)\s+(?:to\s+)?(.+?)\s*(?::|\s[-–—]\s|,)\s*(.*)$/i);
  if (m) { to = world.nationByName(m[1]); if (to) body = m[2]; }
  if (!to) { m = text.match(/^(?:to\s+|with\s+)?(.+?)\s*:\s*(.*)$/i); if (m) { to = world.nationByName(m[1]); if (to) body = m[2]; } }
  if (to && to.id === sim.nid) { to = null; body = text; }
  if (!to) {
    var others = world.nationMentions(text).filter(function (id) { return id !== sim.nid; });
    if (others.length > 1) return tpRuling_('Treaty with several nations: ' + others.join(', '), 'The line names more than one other nation and no single recipient',
      'Identify the recipient (write TREATY <nation>: ...).', { details: text });
    if (others.length === 1) to = world.nation(others[0]);
  }
  if (!to) return tpRuling_('Treaty recipient not found', 'No other nation is named (write TREATY <nation>: ...)', 'Identify the recipient.', { details: text });
  var details = (/^\s*(?:decline|reject|refuse)s?\b/i.test(text) ? 'Reply to ' : 'Proposal to ') + to.name + ': ' + body;
  if (/\bwars?\b|\bpeace\b|cease-?fire|armistice|surrender|capitulat|\balliances?\b|\ballied\b|\bally\b|defensive pact|mutual defen[cs]e|\bvassal|tributar|suzerain|protectorate|\bannex/i.test(text)) {
    return tpRuling_('Treaty touching war, peace, alliance or vassalage', 'These carry consequences the GM rules', 'Deliver it and rule the terms; record any treaty on the Treaties tab.', { details: details });
  }
  var decline = /^\s*(?:decline|reject|refuse)s?\b/i.test(text);
  // A line that proposes or accepts a trade agreement (not one that merely mentions one, or ends one).
  var isTrade = /(?:^|[:;,.]|\s-\s|\b(?:propose|proposes|proposing|accept|accepts|accepting|offer|offers|sign|signs)\b)\s*(?:a\s+|the\s+|our\s+|your\s+)?trade\s+agreements?\b/i.test(text) &&
    !/\bnot\s+a\s+trade\s+agreement\b/i.test(text) && !/\b(?:end|ends|ending|cancel|terminate|withdraw)\b[^.;]*\btrade\s+agreement/i.test(text);
  if (!decline && (/^\s*(?:we\s+)?(?:accept|agree|ratif|sign|confirm)/i.test(text) || /\baccept(?:s|ed|ing)?\b|\bratif(?:y|ies|ied)\b/i.test(text))) {
    if (/\bleas(?:e|es|ed|ing)\b/i.test(text)) return tpLeaseAccept_(world, sim, body, to);
    if (isTrade) {
      // Trade slots (rules: Trade): a trade agreement needs a free slot on both sides.
      var mineS = tpTradeSlots_(world, sim.nid, sim), theirs = tpTradeSlots_(world, to.id, null);
      if (mineS.free <= 0) return tpReject_('No free trade slot: ' + mineS.used + ' of ' + mineS.slots + ' in use. End an agreement first (TREATY <nation>: end the trade agreement), or open a slot (Trade Hub, Trade Exchange)');
      if (theirs.free <= 0) return tpReject_(to.name + ' has no free trade slot (' + theirs.used + ' of ' + theirs.slots + ' in use); the agreement cannot be made until it frees one');
      sim.tradeTaken = (sim.tradeTaken || 0) + 1;
      return tpRuling_('Treaty acceptance (trade agreement)', 'Accepting makes a treaty, with terms and effects the GM confirms',
        'Slots checked: ' + me.name + ' ' + mineS.used + ' of ' + mineS.slots + ', ' + to.name + ' ' + theirs.used + ' of ' + theirs.slots + ' in use. If the other side\'s offer stands: record the trade agreement on the Treaties tab.', { details: details });
    }
    return tpRuling_('Treaty acceptance', 'Accepting makes a treaty, with terms and effects the GM confirms', 'If the other side\'s offer stands: record the treaty on the Treaties tab.', { details: details });
  }
  // Contact: no action of any kind may be aimed at a nation before first contact.
  if (sim.contacted[to.id]) return tpReject_('No contact with ' + to.name + ' yet: CONTACT is ordered this turn, and diplomacy may begin the turn after');
  var rec = world.contactWith(sim.nid, to.id);
  if (!rec) {
    var nb = world.neighbouring(sim.nid, to.id);
    if (nb) return tpRuling_('No contact with ' + to.name + ' on record', 'Neither nation has made first contact, though ' + nb,
      'Approve to deliver it (and count the two as in contact); otherwise reject: No contact with ' + to.name + '.',
      { details: details, cost: {}, strat: {}, stab: 0, spec: { type: 'TREATY', to: to.id, mode: decline ? 'reply' : 'proposal', text: body } });
    return tpReject_('No contact with ' + to.name);
  }
  var mode = decline ? 'reply' : 'proposal';
  if (isTrade && !decline) {
    // Tell both sides at once when a slot is lacking, so no one accepts what cannot be signed.
    var ms = tpTradeSlots_(world, sim.nid, sim), ts = tpTradeSlots_(world, to.id, null), notes = [];
    if (ts.free <= 0) notes.push(to.name + ' has no free trade slot (' + ts.used + ' of ' + ts.slots + ' in use): accepting means ending an agreement first');
    else notes.push(to.name + ' has ' + ts.free + ' free trade slot' + (ts.free === 1 ? '' : 's') + ' (' + ts.used + ' of ' + ts.slots + ' in use)');
    if (ms.free <= 0) notes.push(me.name + ' itself has no free slot (' + ms.used + ' of ' + ms.slots + ')');
    body = String(body).replace(/\s*$/, '') + (/[.!?)]$/.test(String(body).trim()) ? ' ' : '. ') + '[' + notes.join('; ') + '.]';
    details = (decline ? 'Reply to ' : 'Proposal to ') + to.name + ': ' + body;
  }
  return tpReady_(details, (decline ? 'Reply delivered to ' : 'Proposal delivered to ') + to.name + '; answered next turn (in contact: ' + rec.how + ')',
    {}, {}, { type: 'TREATY', to: to.id, mode: mode, text: body });
}

// ---------- LEASE <system> TO <nation>: <terms> | LEASE <system> FROM <nation>: accept | LEASE END <system> ----------
// Rules (Partnerships, Leases). An offer is delivered like a treaty proposal and answered next turn. An
// acceptance makes a treaty: it goes to the GM with the Systems and Treaties cells to fill. LEASE END gives
// 5 turns' notice on an indefinite lease; on approval the script writes the end turn and tells both parties.
function tpEvLease_(world, sim, args) {
  var text = String(args || '').replace(/^\s*[:\-–—]\s*/, '').trim();
  var m = text.match(/^(?:end|ends|ending|terminate|cancel|notice)\b\s*(?:to\s+end\b\s*)?(?:on\s+|of\s+)?(?:the\s+)?(?:lease\s+(?:of|on)\s+)?:?\s*(.+)$/i);
  if (m) return tpLeaseEnd_(world, sim, m[1]);
  if (/\baccept(?:s|ed|ing)?\b/i.test(text)) return tpLeaseAccept_(world, sim, text, null);
  // Offer: the system before " to ", the nation after it, then the terms.
  var parts = text.split(/\s+to\s+/i), sys = null, rest = '';
  for (var i = 1; i < parts.length && !sys; i++) {
    var cand = tpLeaseSystem_(world, parts.slice(0, i).join(' to '));
    if (cand) { sys = cand; rest = parts.slice(i).join(' to '); }
  }
  if (!sys) return tpRuling_('Lease not understood (write LEASE <system> TO <nation>: <terms>)', 'The script cannot find the system or the nation', 'Read the order and deliver it by hand.', { details: text });
  var to = null, terms = '';
  m = rest.match(/^(.+?)\s*(?::|\s[-–—]\s|,)\s*(.*)$/);
  if (m) { to = world.nationByName(m[1]); terms = m[2]; }
  if (!to) { to = world.nationByName(rest); terms = ''; }
  if (!to) {
    var named = world.nationMentions(rest).filter(function (id) { return id !== sim.nid; });
    if (named.length) { to = world.nation(named[0]); terms = rest; }
  }
  if (!to) return tpRuling_('Lessee not found (write LEASE <system> TO <nation>: <terms>)', 'No other nation is named', 'Identify the nation and deliver it by hand.', { details: text });
  if (to.id === sim.nid) return tpReject_('A nation cannot lease a system to itself');
  if (to.status === 'Eliminated') return tpReject_(to.name + ' is eliminated');
  var label = tpSysLabel_(sys), ls = tpLeaseOf_(world, sys), sov = ls ? ls.lessor : String(sys.get('Owner') || '').trim();
  if (sov !== sim.nid) {
    if (ls && ls.lessee === sim.nid) return tpReject_('We hold ' + label + ' on lease from ' + world.nameOf(ls.lessor) + '; only its sovereign may lease it');
    return tpReject_('Not ours to lease: ' + label + (sov ? ' is held by ' + world.nameOf(sov) : ' is unclaimed'));
  }
  var st = String(sys.get('Status') || '').trim();
  if (st) return tpReject_(label + ' cannot be leased while it stands "' + st + '"');
  if (ls && ls.lessee !== to.id) return tpReject_(label + ' is already leased to ' + world.nameOf(ls.lessee) + (ls.ends ? ' until Turn ' + ls.ends : ' (indefinite)') + '; it can be offered again when that lease ends');
  if (world.warBetween(sim.nid, to.id)) return tpReject_('At war with ' + to.name + ': war between lessor and lessee ends a lease at once');
  var body = 'Lease of ' + label + ' to ' + to.name + (terms ? ': ' + terms : '');
  if (sim.contacted[to.id]) return tpReject_('No contact with ' + to.name + ' yet: CONTACT is ordered this turn, and diplomacy may begin the turn after');
  var rec = world.contactWith(sim.nid, to.id);
  var spec = { type: 'TREATY', to: to.id, mode: 'proposal', text: body, lease: sys.id };
  if (!rec) {
    var nb = world.neighbouring(sim.nid, to.id);
    if (nb) return tpRuling_('No contact with ' + to.name + ' on record', 'Neither nation has made first contact, though ' + nb,
      'Approve to deliver the lease offer (and count the two as in contact); otherwise reject: No contact with ' + to.name + '.',
      { details: 'Proposal to ' + to.name + ': ' + body, cost: {}, strat: {}, stab: 0, spec: spec });
    return tpReject_('No contact with ' + to.name);
  }
  var t = tpLeaseTerms_(terms);
  var read = [t.form || 'payment not named', t.rentText ? 'rent ' + t.rentText + ' a turn' : '', t.turns ? t.turns + ' turns' : (t.indefinite ? 'indefinite' : 'term not named')].filter(String).join('; ');
  return tpReady_('Proposal to ' + to.name + ': ' + body,
    'Lease offer delivered to ' + to.name + '; answered next turn (in contact: ' + rec.how + '). Terms read as: ' + read +
    '. We keep sovereignty; ' + to.name + ' governs it, and it counts against ' + to.name + '\'s Administrative Capacity while leased',
    {}, {}, spec);
}

/** A lease acceptance: from LEASE ... accept, or TREATY <nation>: accept the lease of <system>. A ruling. */
function tpLeaseAccept_(world, sim, text, other) {
  var sys = tpLeaseSystemIn_(world, text);
  if (!sys) return tpRuling_('Lease acceptance: system not identified', 'The line accepts a lease but names no system the script can find',
    'Identify the system and record the lease by hand (Systems: Owner, Lessor (sovereign), Lease treaty, Lease payment, Lease rent per turn, Lease ends (turn); Treaties: a Lease row).', { details: text });
  var label = tpSysLabel_(sys), ls = tpLeaseOf_(world, sys), owner = String(sys.get('Owner') || '').trim(), sov = ls ? ls.lessor : owner;
  if (!other) {
    var named = world.nationMentions(text.replace(new RegExp(tpEscapeRe_(sys.id), 'g'), ' ')).filter(function (id) { return id !== sim.nid; });
    if (named.length) other = world.nation(named[0]);
  }
  if (!sov) return tpReject_(label + ' is unclaimed: there is no sovereign to lease it');
  var lessor, lessee;
  if (sov === sim.nid) {
    if (!other) return tpRuling_('Lease acceptance: lessee not named', 'We hold ' + label + '; the line does not say to whom it is leased', 'Identify the lessee, then record the lease.', { details: text });
    lessor = sim.nid; lessee = other.id;
  } else {
    if (other && other.id !== sov) return tpReject_(label + ' is held by ' + world.nameOf(sov) + ', not ' + other.name + ': only its sovereign may lease it');
    lessor = sov; lessee = sim.nid;
  }
  var lsr = world.nation(lessor), lse = world.nation(lessee);
  if (!lsr || !lse) return tpRuling_('Lease acceptance: nation not found', 'A party is not on the Nations tab', 'Identify the parties.', { details: text });
  if (lse.status === 'Eliminated' || lsr.status === 'Eliminated') return tpReject_((lse.status === 'Eliminated' ? lse.name : lsr.name) + ' is eliminated');
  var st = String(sys.get('Status') || '').trim();
  if (st) return tpReject_(label + ' cannot be leased while it stands "' + st + '"');
  if (ls && ls.lessee !== lessee) return tpReject_(label + ' is already leased to ' + world.nameOf(ls.lessee) + (ls.ends ? ' until Turn ' + ls.ends : ' (indefinite)'));
  if (!world.contactWith(lessor, lessee)) return tpReject_('No contact between ' + lsr.name + ' and ' + lse.name);
  if (world.warBetween(lessor, lessee)) return tpReject_(lsr.name + ' and ' + lse.name + ' are at war: war between lessor and lessee ends a lease at once');
  var turn = world.turnNo || 0, offer = tpLeaseOfferOnRecord_(world, sim.nid, sys, turn);
  var t = tpLeaseTerms_(text);
  if (offer) { var t2 = tpLeaseTerms_(offer.text); ['form', 'rentText', 'turns', 'indefinite'].forEach(function (k) { if (!t[k]) t[k] = t2[k]; }); }
  var id = tpNextTreatyId_(world), from = turn + 1;
  var ends = t.turns ? turn + t.turns : '';
  var c = world.calc(lessee) || {}, held = tpNum_(c['Systems held']), cap = tpNum_(c['Administrative Capacity']);
  var admin = c['Administrative Capacity'] === undefined || c['Administrative Capacity'] === '' ? lse.name + '\'s Administrative Capacity is not on Calculations: check it by hand' :
    lse.name + ' holds ' + held + ' system' + (held === 1 ? '' : 's') + ' against Administrative Capacity ' + cap + '; with ' + sys.id + ', ' + (held + 1) + ' of ' + cap +
    (held + 1 > cap ? ' (' + tpRound2_(held + 1 - cap) + ' over: the over-capacity penalties apply to ' + lse.name + ')' : ' (within capacity)') + '. The lessor sheds it from its own count';
  var L = TURN_CONFIG.LEASE;
  var cells = 'Systems row ' + sys.id + ': Owner = ' + lessee + '; ' + L.lessor + ' = ' + lessor + '; ' + L.treaty + ' = ' + id + '; ' + L.payment + ' = ' +
    (t.form || 'one of ' + L.forms.join(', ') + ', as agreed') + '; ' + L.rent + ' = ' + (t.rentText || (/rent/i.test(t.form) ? '(the agreed rent, e.g. 20 Stellar Marks)' : 'blank')) + '; ' + L.ends + ' = ' +
    (ends ? ends + ' (' + t.turns + ' turns from Turn ' + from + ')' : 'blank (indefinite' + (t.indefinite ? '' : ', unless a term was agreed') + ')') + '. ' +
    'Treaties: new row ' + id + ': Type Lease; Parties "' + lessor + ', ' + lessee + '"; Signed ' + turn + '; In force from ' + from + '; Ended blank; Status Active; Terms "' +
    tpLeaseTermsText_(sys, lsr, lse, t, ends) + '"; Diplomacy post link; Party 1 ' + lessor + '; Party 2 ' + lessee + '.';
  return tpRuling_('Lease acceptance', 'Accepting a lease makes a treaty: the GM confirms the terms and records it',
    'If the offer stands' + (offer ? ' (offer on record, Turn ' + offer.turn + ': "' + offer.text + '")' : ' (no lease offer found on the Events tab in the last 4 turns: check the diplomacy posts)') +
    ': ' + cells + ' Payments begin Turn ' + from + ' and the script pays them each turn. ' + admin + '.',
    { details: 'Acceptance: lease of ' + label + ' from ' + lsr.name + ' to ' + lse.name });
}

/** LEASE END <system>: 5 turns' notice on an indefinite lease, by either party. A ruling; approval writes the end turn. */
function tpLeaseEnd_(world, sim, text) {
  var sys = tpLeaseSystemIn_(world, text);
  if (!sys) return tpRuling_('Lease notice: system not identified', 'Write LEASE END <system>', 'Identify the system.', { details: text });
  var label = tpSysLabel_(sys), ls = tpLeaseOf_(world, sys);
  if (!ls) return tpReject_(label + ' is not leased');
  if (ls.lessor !== sim.nid && ls.lessee !== sim.nid) return tpReject_('Not a party to the lease of ' + label);
  if (ls.ends) return tpReject_('The lease of ' + label + ' already ends at the end of Turn ' + ls.ends + ' (a fixed term, or notice already given); ending it sooner breaks the treaty (BREAK)');
  var turn = world.turnNo || 0, ends = turn + TURN_CONFIG.LEASE.notice, L = TURN_CONFIG.LEASE;
  return tpRuling_('Notice to end a lease', 'Either party may end an indefinite lease on ' + L.notice + ' turns\' notice, without breaking a treaty',
    'Approve: the script writes ' + L.ends + ' = ' + ends + ' on Systems row ' + sys.id + ' (Turn ' + turn + ' + ' + L.notice + ') and tells both parties; ' + label +
    ' returns to ' + world.nameOf(ls.lessor) + ' at the end of Turn ' + ends + (ls.treaty ? ' (' + ls.treaty + ')' : '') + '.',
    { details: 'Notice: the lease of ' + label + ' ends at the end of Turn ' + ends, cost: {}, strat: {}, stab: 0,
      spec: { type: 'LEASE_END', sys: sys.id, ends: ends, lessor: ls.lessor, lessee: ls.lessee, treaty: ls.treaty } });
}

/** The lease on a system, or null. Owner is the lessee; Lessor (sovereign) the sovereign (an ID or a name). */
function tpLeaseOf_(world, s) {
  var L = TURN_CONFIG.LEASE, raw = String(s.get(L.lessor) || '').trim();
  if (!raw) return null;
  var n = world.nationByName(raw), ends = s.get(L.ends);
  return { sys: s.id, s: s, lessor: n ? n.id : raw, lessee: String(s.get('Owner') || '').trim(), treaty: String(s.get(L.treaty) || '').trim(),
    payment: String(s.get(L.payment) || '').trim(), rent: String(s.get(L.rent) || '').trim(),
    ends: ends === '' || ends === null || ends === undefined ? 0 : tpNum_(ends), status: String(s.get('Status') || '').trim() };
}
/** A system named by the whole text, or by an ID within it. */
function tpLeaseSystem_(world, text) {
  var t = String(text || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/^\s*(?:the\s+)?(?:system\s+(?:of\s+)?)?/i, '').replace(/[.;,:]+\s*$/, '').trim();
  return world.findSystem(t) || null;
}
function tpLeaseSystemIn_(world, text) {
  var whole = tpLeaseSystem_(world, text);
  if (whole) return whole;
  var ids = String(text || '').match(/\b[A-Z]{1,4}-\d{1,3}\b/gi) || [];
  for (var i = 0; i < ids.length; i++) { var s = world.sys(ids[i].toUpperCase()); if (s) return s; }
  var m = String(text || '').match(/\blease\s+(?:of|on)\s+(.+?)(?:\s+(?:from|to|for|at|with|on)\b|[:;,.(]|$)/i);
  return m ? tpLeaseSystem_(world, m[1]) : null;
}
/** Payment form, rent and term read from free text. */
function tpLeaseTerms_(text) {
  var t = String(text || ''), out = { form: '', rentText: '', turns: 0, indefinite: false };
  var resNames = ['stellar marks?', 'marks?', 'sm', 'industry', 'energy', 'research', 'influence'].concat(TURN_CONFIG.STRATEGIC.map(function (r) { return tpEscapeRe_(r.toLowerCase()); }));
  var resRe = '(' + resNames.join('|') + ')';
  var m = t.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*' + resRe + '\\s*(?:a|per|each|every)\\s+turn', 'i')) ||
          t.match(new RegExp('\\b(?:rent|fee)\\s*(?:of|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*' + resRe + '\\b', 'i'));
  if (m) { var res = tpLeaseResource_(m[2]); if (res) out.rentText = Number(m[1]) + ' ' + res; }
  var tm = t.match(/\b(?:for|term\s+of|lasting|over)\s+(\d+)\s+turns?\b/i) || t.match(/\b(\d+)[\s-]turns?\s+(?:lease|term)\b/i);
  if (tm) out.turns = Number(tm[1]);
  out.indefinite = /\bindefinite(?:ly)?\b|\bopen[\s-]ended\b|\bno fixed term\b/i.test(t);
  var extraction = /\bextract/i.test(t), shared = /\bshared?\b|\b50\s*\/\s*50\b|\bsplit\b/i.test(t), rent = !!out.rentText || /\brent\b/i.test(t);
  out.form = shared ? 'Shared' : extraction && rent ? 'Rent and extraction' : extraction ? 'Extraction' : rent ? 'Rent' : '';
  return out;
}
function tpLeaseResource_(name) {
  var t = tpNorm_(name).replace(/[.]$/, '');
  if (/^(?:stellar )?marks?$|^sm$/.test(t)) return TURN_CONFIG.MARKS;
  return TURN_CONFIG.RESOURCES.concat(TURN_CONFIG.STRATEGIC).filter(function (r) { return tpNorm_(r) === t || tpNorm_(r) === t.replace(/s$/, '') || tpNorm_(r).replace(/s$/, '') === t; })[0] || '';
}
/** "20 Stellar Marks" or "15 Industry, 2 Antimatter" -> { resource: amount }, or null if unreadable. */
function tpLeaseRent_(text) {
  var out = {}, n = 0, bad = false;
  String(text || '').replace(/\b(?:a|per|each|every)\s+turn\b/ig, '').split(/\s*(?:,|;|\+|\band\b)\s*/i).forEach(function (p) {
    p = p.trim(); if (!p) return;
    var m = p.match(/^(\d+(?:\.\d+)?)\s*(.+)$/), res = m ? tpLeaseResource_(m[2]) : '';
    if (!res) { bad = true; return; }
    out[res] = (out[res] || 0) + Number(m[1]); n++;
  });
  return n && !bad ? out : null;
}
/** What a lease passes from lessee to lessor in a turn, by its terms ({ resource: amount }; stockpiles not checked). */
function tpLeaseDue_(world, ls) {
  var form = tpLeaseForm_(ls), S = ls.s, out = {};
  function add(r, v) { if (v > 0) out[r] = tpRound2_((out[r] || 0) + v); }
  if (form === 'Rent' || form === 'Rent and extraction') { var rent = tpLeaseRent_(ls.rent) || {}; Object.keys(rent).forEach(function (r) { add(r, rent[r]); }); }
  if (ls.status || !(form === 'Shared' || form === 'Extraction' || form === 'Rent and extraction')) return out;
  var k = form === 'Shared' ? 0.5 : 1, strat = {};
  TURN_CONFIG.STRATEGIC.forEach(function (r) { if (world.systemsTab.c(r) >= 0) strat[r] = tpNum_(S.get(r)); });
  if (world.systemsTab.c('Strategic output') >= 0) { var p = tpParseStrat_(S.get('Strategic output')); Object.keys(p).forEach(function (r) { if (!strat[r]) strat[r] = p[r]; }); }
  Object.keys(strat).forEach(function (r) { add(r, k * strat[r]); });
  if (form === 'Shared') TURN_CONFIG.RESOURCES.forEach(function (r) { add(r, 0.5 * tpNum_(S.get(r))); });
  return out;
}
/** The payment form as written on Systems, read leniently ("rent + extraction", "50/50"). */
function tpLeaseForm_(ls) {
  var p = tpNorm_(ls.payment);
  if (!p) return ls.rent ? 'Rent' : '';
  if (/shar|50\s*\/\s*50|split/.test(p)) return 'Shared';
  if (/extract/.test(p)) return /rent|fee/.test(p) ? 'Rent and extraction' : 'Extraction';
  if (/rent|fee/.test(p)) return 'Rent';
  return '';
}
function tpLeaseTermsText_(sys, lsr, lse, t, ends) {
  return lsr.name + ' leases ' + tpSysLabel_(sys) + ' to ' + lse.name + '; ' + (t.form || 'payment as agreed') + (t.rentText ? ', rent ' + t.rentText + ' a turn' : '') +
    '; ' + (ends ? 'until the end of Turn ' + ends : 'indefinite (5 turns\' notice by either party)');
}
/** The latest lease offer delivered to a nation about a system (Events, Kind "Treaty proposed", last 4 turns). */
function tpLeaseOfferOnRecord_(world, nid, sys, turn) {
  var E = tpTryTab_(world.model, 'Events'), best = null;
  if (!E) return null;
  var nm = String(sys.get('Name') || '');
  E.rows().forEach(function (r) {
    if (tpNorm_(E.get(r, 'Kind')) !== 'treaty proposed') return;
    if (String(E.get(r, 'Nations')).split(/\s*[,;]\s*/).indexOf(nid) < 0) return;
    var tx = String(E.get(r, 'Text') || ''), et = tpNum_(E.get(r, 'Turn'));
    if (!/\blease/i.test(tx) || (tx.indexOf(sys.id) < 0 && !(nm && tx.indexOf(nm) >= 0))) return;
    if (turn && (et < turn - 4 || et >= turn)) return;
    if (!best || et >= best.turn) best = { turn: et, text: tx.replace(/\s*Answer in your next orders[\s\S]*$/, '').trim() };
  });
  return best;
}
/** The next free treaty ID on the Treaties tab (T-001 style, as wide as the widest on record). Each call
 *  in one run takes a new number, so two acceptances in a turn are not offered the same ID. */
function tpNextTreatyId_(world) {
  var T = tpTryTab_(world.model, 'Treaties'), max = 0, width = 3;
  if (T) T.rows().forEach(function (r) { var m = String(T.get(r, 'Treaty ID') || '').match(/^T-(\d+)$/i); if (m) { max = Math.max(max, Number(m[1])); width = Math.max(width, m[1].length); } });
  max = Math.max(max, world._treatyIdTaken || 0);
  world._treatyIdTaken = max + 1;
  var n = String(max + 1);
  while (n.length < width) n = '0' + n;
  return 'T-' + n;
}

// ---------- DISMANTLE <building> @ <system> ----------
// Rules: removes a building at once, refunds 25% of its Industry cost and frees its slot the same turn.
function tpEvDismantle_(world, sim, args) {
  var p = tpSplitAt_(args);
  if (!p) return tpRuling_('No system given (write DISMANTLE <building> @ <system>)', 'The system is missing', 'Identify the system.');
  var name = p.what.replace(/^(?:an?|the|one)\s+/i, '').trim();
  var sys = world.findSystem(p.where);
  if (!sys) return tpRuling_('System not found: "' + p.where + '"', 'The script cannot find this system', 'Identify the system.');
  if (!sim.ownsActive(sys.id)) return tpReject_('Not held by this nation: ' + tpSysLabel_(sys));
  var standing = String(sys.get('Buildings') || '').split(/\s*,\s*/).filter(function (x) { return x; });
  (sim.dismantled[sys.id] || []).forEach(function (d) { var i = standing.indexOf(d); if (i >= 0) standing.splice(i, 1); });
  var key = tpNorm_(name), base0 = function (x) { return tpNorm_(String(x).replace(/\s*\(.*\)\s*$/, '')); };
  var hit = standing.filter(function (x) { return tpNorm_(x) === key; })[0] ||
            standing.filter(function (x) { return base0(x) === key || base0(x) === key.replace(/s$/, ''); })[0];
  if (!hit) {
    if (sim.buildingsOf(sys.id).some(function (x) { return tpNorm_(x) === key || base0(x) === key; })) return tpReject_(name + ' is not yet complete in ' + tpSysLabel_(sys) + '; only a standing building can be dismantled');
    return tpReject_('No ' + name + ' stands in ' + tpSysLabel_(sys) + (standing.length ? ' (it holds ' + standing.join(', ') + ')' : ''));
  }
  var base = hit.replace(/\s*\(.*\)\s*$/, '');
  var def = world.unlockedBuilding(sim.nid, hit);
  if (def && def.error) def = null;
  if (!def) { var sig = tpFindKey_(TURN_CONFIG.SIGNATURE_WORKS, base); if (sig) def = { name: sig, industry: TURN_CONFIG.SIGNATURE_WORKS[sig].industry, slot: true }; }
  if (!def) def = world.building(base);
  if (!def) return tpRuling_('Building cost unknown: ' + hit, 'Not in Tables, the rules or Unlocks, so the 25% refund cannot be priced', 'Remove it and refund 25% of its Industry cost.',
    { details: hit + ' at ' + tpSysLabel_(sys) });
  var industry = def.industry;
  if (tpNorm_(base) === 'extractor') { var ex = sim.calc['Extractor cost (Industry)']; if (ex !== '' && ex !== undefined && ex !== null) industry = tpNum_(ex); }
  var refund = tpRound1_(industry * TURN_CONFIG.DISMANTLE_REFUND);
  var orbital = !!def.orbital || tpIsOrbital_(world, hit);
  var slot = def.slot !== false && !orbital;
  return tpReady_(hit + ' at ' + tpSysLabel_(sys) + ' dismantled',
    'Refund 25% of ' + industry + ' Industry = ' + refund + ' Industry (strategic resources are not refunded); ' + (slot ? 'frees its building slot this turn' : orbital ? 'frees its orbital slot this turn' : 'takes no slot'),
    refund ? { Industry: -refund } : {}, {}, { type: 'DISMANTLE', sys: sys.id, building: hit, slot: slot, refund: refund });
}

// ---------- REMEDIATE <system> <points>  |  POLICY / INITIATIVE Remediate <system>: remove N Degradation ... ----------
// Rules: 2 Industry for each point of Degradation removed from a system, up to 10 points a turn.
// Paying in Marks: that turn's Exchange selling price of the Industry it costs.
function tpEvRemediate_(world, sim, args) {
  var t = String(args || '').replace(/^\s*:?\s*remediat\w*\s*/i, '').trim();
  var sysText = t, rest = '', m = t.match(/^(.*?)\s*:\s*(.*)$/);
  if (m) { sysText = m[1]; rest = m[2]; }
  else { var m2 = t.match(/^(.*?)\s+(?:by\s+|remove\s+)?(\d+(?:\.\d+)?)\b(.*)$/i); if (m2) { sysText = m2[1]; rest = m2[2] + m2[3]; } }
  var sys = world.findSystem(sysText) || world.findSystem(String(sysText).split(/\s+/)[0]);
  if (!sys) return tpRuling_('System not found: "' + sysText + '"', 'The script cannot find this system', 'Identify the system.');
  if (!sim.ownsActive(sys.id)) return tpReject_('Not held by this nation: ' + tpSysLabel_(sys));
  var pm = rest.match(/(\d+(?:\.\d+)?)\s*(?:points?\s*(?:of\s+)?)?degradation/i) || rest.match(/^\s*(?:remove\s+)?(\d+(?:\.\d+)?)\s*(?:points?|pts?)?\s*(?:$|[,;(])/i);
  if (!pm) return tpRuling_('Points of Degradation not given', 'Write REMEDIATE <system> <points>', 'Identify how many points to remove.');
  var asked = Number(pm[1]), notes = [];
  var done = sim.remediated[sys.id] || 0, room = TURN_CONFIG.REMEDIATION_MAX_POINTS - done;
  if (asked <= 0) return tpReject_('Nothing to remove');
  if (room <= 0) return tpReject_('Already ' + TURN_CONFIG.REMEDIATION_MAX_POINTS + ' points of remediation in ' + tpSysLabel_(sys) + ' this turn');
  var pts = Math.min(asked, room);
  if (pts < asked) notes.push('at most ' + TURN_CONFIG.REMEDIATION_MAX_POINTS + ' points a turn: ' + pts + ' of ' + asked);
  if (world.systemsTab.c('Degradation') >= 0) {
    var cur = tpRound2_(tpNum_(sys.get('Degradation')) - done);
    if (cur <= 0) return tpReject_(tpSysLabel_(sys) + ' has no Degradation to remove');
    if (pts > cur) { pts = cur; notes.push('it holds only ' + cur + ' Degradation'); }
    notes.push('Degradation ' + cur + ' -> ' + tpRound2_(cur - pts));
  }
  pts = tpRound2_(pts);
  var industry = tpRound2_(TURN_CONFIG.REMEDIATION_INDUSTRY_PER_POINT * pts);
  var spec = { type: 'REMEDIATE', sys: sys.id, points: pts };
  var details = tpSysLabel_(sys) + ': remove ' + pts + ' Degradation';
  if (/\bmarks\b/i.test(t)) {
    var x = world.exchangeState().Industry, sell = x.price * (1 + TURN_CONFIG.EXCHANGE.spread);
    var marks = tpRound2_(industry * sell), strat = {};
    strat[TURN_CONFIG.MARKS] = marks;
    return tpReady_(details + ', paid in Marks', pts + ' x 2 = ' + industry + ' Industry at the Exchange selling price ' + tpRound2_(sell) + ' = ' + marks + ' Marks' + (notes.length ? '; ' + notes.join('; ') : ''),
      {}, strat, spec);
  }
  return tpReady_(details, pts + ' x 2 = ' + industry + ' Industry' + (notes.length ? '; ' + notes.join('; ') : ''), { Industry: industry }, {}, spec);
}

// ---------- POLICY / INITIATIVE ----------
// Remediation, the Living compounds stipend and charters are settled here; any other line is the GM's.
function tpEvPolicy_(world, sim, verb, args) {
  var t = String(args || '').replace(/^\s*:\s*/, '').trim();
  if (/^remediat/i.test(t)) return tpEvRemediate_(world, sim, t);
  if (/living compounds/i.test(t) && /stability/i.test(t)) return tpEvStipend_(world, sim, t);
  if (/\bcharters?\b/i.test(t.replace(/\b(?:constitutional|federal|founding)\s+charters?\b/ig, ''))) return tpEvCharters_(world, sim, t);
  return tpRuling_('Free-form order (' + verb + ')', verb + ' lines other than remediation, the Living compounds stipend and charters are ruled by the GM',
    'Rule as written, or treat as not an order.');
}

// Rules: 2 Living compounds a turn sustain +1 Stability target, at most +1 however many are paid;
// the bonus lapses when payment stops.
function tpEvStipend_(world, sim, t) {
  var S = TURN_CONFIG.STIPEND;
  if (/\b(?:stop|end|cancel|cease|halt)\b/i.test(t)) return tpRuling_('Ending the Living compounds stipend', 'Stopping the stipend ends its +1 Stability target', 'Set the Standing effects row inactive and lower Temporary Stability target by 1.');
  if (sim.stipend) return tpReject_('A Living compounds stipend is already ordered this turn; at most +1 Stability target');
  if (world.standingRows(sim.nid, function (r) { return r.res === S.resource && r.amt < 0 && /stipend|stability target/i.test(r.reason); }).length)
    return tpReject_('A Living compounds stipend is already in force (Standing effects); at most +1 Stability target however many are paid');
  var strat = {}; strat[S.resource] = S.units;
  return tpReady_('Living compounds stipend: ' + S.units + ' a turn for +1 Stability target',
    S.units + ' Living compounds this turn, then ' + S.units + ' a turn from the Standing effects tab; +1 Stability target while paid (at most +1; Nations ' +
    TURN_CONFIG.TEMP_TARGET_COLUMN + '); lapses in any turn it is not paid', {}, strat, { type: 'STIPEND' });
}

// Rules: from Society Tier 4 (a Collective from Tier 3) any number of charters (no limit since Turn 35), each +1 Administrative
// Capacity, upkeep 3 Influence x systems held / 5 each a turn, lapsing in any turn it is not paid.
function tpEvCharters_(world, sim, t) {
  var C = TURN_CONFIG.CHARTER;
  if (/\b(?:drop|end|cancel|give up|relinquish|abandon)\b/i.test(t)) return tpRuling_('Giving up a charter', 'Ending a charter lowers Administrative Capacity', 'Set the charter row on Standing effects inactive and lower ' + TURN_CONFIG.ADMIN_CAPACITY_COLUMN + ' by 1.');
  var WORDS = { one: 1, two: 2, both: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  var wm = t.match(/\b(\d+|one|two|both|three|four|five|six|seven|eight|nine|ten)\b(?=[^.;]*\bcharters?\b)|\bcharters?\b[^.;]*?\b(\d+|one|two|both|three|four|five|six|seven|eight|nine|ten)\b/i);
  var wv = wm ? (wm[1] || wm[2]).toLowerCase() : '';
  var want = Math.max(1, Math.min(20, wv ? (WORDS[wv] || Number(wv) || 1) : 1));
  var collective = sim.gov === 'Collective', need = collective ? C.societyCollective : C.society;
  if (sim.tiers.Society < need) return tpRuling_('Charters need Society Tier ' + need + (collective ? ' (Collective)' : '') + '; Society Tier ' + sim.tiers.Society + ' now',
    'The tier is not reached as the orders are read (a tier researched this turn arrives at the end of the turn)', 'Carry the order to the next turn, or reject it.', { details: t });
  var held = world.standingRows(sim.nid, function (r) { return /^charter\b/i.test(r.reason); }).length + (sim.charters || 0);
  if (C.max && held >= C.max) return tpReject_('Already holds ' + held + ' charters; at most ' + C.max);
  var take = C.max ? Math.min(want, C.max - held) : want;
  var systems = Object.keys(sim.owned).length;
  var each = tpRound1_(C.influencePerSystem * systems / C.divisor);
  return tpReady_(take + ' charter' + (take > 1 ? 's' : '') + ': +' + take + ' Administrative Capacity',
    'Each charter +1 Administrative Capacity (Nations ' + TURN_CONFIG.ADMIN_CAPACITY_COLUMN + ' +1 each); upkeep 3 Influence x ' + systems + ' systems held / 5 = ' + each +
    ' Influence a turn each, first paid now, then with upkeep from the Standing effects tab (recalculated each turn by systems held)' +
    (take < want ? '; only ' + take + ' more allowed (holds ' + held + ')' : '') + (collective ? '; a Collective may take charters from Society Tier 3' : '') + '; a charter lapses in any turn its upkeep is not paid',
    { Influence: tpRound1_(each * take) }, {}, { type: 'CHARTER', n: take, each: each, systems: systems });
}

// ---------- BUY / SELL <qty> <resource> [AT <price> OR LESS|MORE] [OVER <n> TURNS] [FOR <n> TURNS] ----------
function tpParseExchange_(verb, args) {
  var t = String(args).replace(/\s+/g, ' ').trim();
  var m = t.match(/^(\d+(?:\.\d+)?)\s+(.+?)(?:\s+AT\s+(\d+(?:\.\d+)?)(?:\s*(?:Marks?|SM))?(?:\s+OR\s+(?:MORE|LESS|BETTER))?)?(?:\s+OVER\s+(\d+)\s+TURNS?)?(?:\s+FOR\s+(\d+)\s+TURNS?)?\.?$/i);
  if (!m) return null;
  var name = m[2].trim(), all = TURN_CONFIG.RESOURCES.concat(TURN_CONFIG.STRATEGIC);
  var res = all.filter(function (r) { return tpNorm_(r) === tpNorm_(name) || tpNorm_(r).replace(/s$/, '') === tpNorm_(name).replace(/s$/, ''); })[0];
  return { side: verb, qty: Math.floor(Number(m[1])), res: res || '', name: name, limit: m[3] ? Number(m[3]) : 0, over: m[4] ? Number(m[4]) : 1, stand: m[5] ? Number(m[5]) : 0 };
}
function tpEvExchange_(world, sim, verb, args) {
  var o = tpParseExchange_(verb, args);
  if (!o) return tpRuling_('Exchange order not understood', 'Write ' + verb + ' <quantity> <resource> [AT <price> OR ' + (verb === 'SELL' ? 'MORE' : 'LESS') + '] [OVER <n> TURNS]', 'Read the order and settle it by hand.');
  if (!o.res) return tpReject_('The Exchange does not trade "' + o.name + '"');
  if (o.qty < 1) return tpReject_('Quantity must be at least 1');
  if (o.over > 1 && o.limit) return tpReject_('An order may be limited or sliced, not both');
  var st = world.exchangeState(), x = st[o.res], C = TURN_CONFIG.EXCHANGE;
  var first = Math.ceil(o.qty / o.over);
  var q = Math.min(first, x.depth);
  var fill = tpExFill_(x, verb, q);
  var est = tpRound1_(fill.value);
  var M = TURN_CONFIG.MARKS, cost = {}, strat = {};
  var isStrat = TURN_CONFIG.STRATEGIC.indexOf(o.res) >= 0;
  if (verb === 'SELL') {
    if (isStrat) strat[o.res] = first; else cost[o.res] = first;
    cost[M] = -est;
  } else {
    if (isStrat) strat[o.res] = -first; else cost[o.res] = -first;
    cost[M] = est;
  }
  var desc = verb + ' ' + o.qty + ' ' + o.res + (o.limit ? ' at ' + o.limit + ' or ' + (verb === 'SELL' ? 'more' : 'less') : '') + (o.over > 1 ? ' over ' + o.over + ' turns' : '') + (o.stand ? ', standing ' + o.stand + ' turns' : '');
  var notes = ['price ' + tpRound2_(x.price) + ' (' + (verb === 'SELL' ? 'Exchange buys at ' : 'Exchange sells at ') + tpRound2_(x.price * (1 + (verb === 'SELL' ? -C.spread : C.spread))) + ')',
    'depth ' + x.depth, (verb === 'BUY' ? 'inventory ' + x.inventory : ''), 'estimate ' + est + ' Marks for ' + q + ' this turn', 'settles in the Exchange phase at that moment\'s price'];
  if (first > x.depth) notes.push('more than one depth: only ' + x.depth + ' can trade this turn');
  if (verb === 'BUY' && x.inventory < 1) notes.push('the Exchange holds none: the order fills only if others sell first');
  return tpReady_(desc, notes.filter(String).join('; '), cost, strat, { type: 'EXCHANGE', side: verb, res: o.res, qty: o.qty, limit: o.limit, over: o.over, stand: o.stand });
}
function tpEvCancel_(world, sim, args) {
  var m = String(args).match(/^(?:ORDER\s+)?(EX-\d+)/i);
  if (!m) return tpRuling_('Cancel what?', 'Write CANCEL ORDER EX-<number>', 'Identify the standing order.');
  var X = world.model.tab('Exchange orders'), hit = null;
  X.rows().forEach(function (r) { if (String(X.get(r, 'Order ID')).toUpperCase() === m[1].toUpperCase() && X.get(r, 'Nation') === sim.nid && X.get(r, 'Status') === 'Open') hit = r; });
  if (hit === null) return tpReject_('No open order ' + m[1].toUpperCase() + ' of this nation');
  return tpReady_('Cancel ' + m[1].toUpperCase(), 'Withdrawn before this turn\'s trading', {}, {}, { type: 'EXCANCEL', id: m[1].toUpperCase() });
}
/** Fill for q units at the current state: value in Marks, average price, and the price after. */
function tpExFill_(x, side, q) {
  var C = TURN_CONFIG.EXCHANGE, D = Math.max(1, x.depth);
  if (side === 'SELL') {
    var pb = x.price * (1 - C.spread), avg = pb * (1 - C.s * q / (2 * D));
    return { value: q * avg, avg: avg, after: Math.max(x.base * C.floor, x.price * (1 - C.s * q / D)) };
  }
  var ps = x.price * (1 + C.spread), avg2 = ps * (1 + C.s * q / (2 * D));
  return { value: q * avg2, avg: avg2, after: Math.min(x.base * C.ceiling, x.price * (1 + C.s * q / D)) };
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
    case 'BUILD': for (var bc = 0; bc < (sp.copies || 1); bc++) { if (!sp.orbital) sim.slotsAdded[sp.sys] = (sim.slotsAdded[sp.sys] || 0) + 1; (sim.newBuildings[sp.sys] = sim.newBuildings[sp.sys] || []).push(sp.building); } break;
    case 'SHIP': sim.shipCapAdded += ev.capAdd || 0; break;
    case 'GROUND': sim.armyCapAdded += ev.armyAdd || 0; if (sp.site) { sim.trained = sim.trained || {}; sim.trained[sp.site] = (sim.trained[sp.site] || 0) + (ev.armyAdd || 0); } break;
    case 'DEFENCE': sim.staticAdded[sp.sys] = (sim.staticAdded[sp.sys] || 0) + (sp.points || 0); break;
    case 'RESEARCH': sim.researched[sp.branch] = sp.tier; break;
    case 'COLONIZE': sim.owned[sp.sys] = true; sim.colonized[sp.sys] = true; sim.taken[sp.sys] = true; sim.settlersOut += TURN_CONFIG.COLONY_SETTLERS_BN; if (sp.desig) sim.desigNow[sp.sys] = sp.desig; sim.colonyCount++; break;
    case 'DISMANTLE':
      (sim.dismantled[sp.sys] = sim.dismantled[sp.sys] || []).push(sp.building);
      if (sp.slot) sim.slotsAdded[sp.sys] = (sim.slotsAdded[sp.sys] || 0) - 1;
      break;
    case 'REMEDIATE': sim.remediated[sp.sys] = tpRound2_((sim.remediated[sp.sys] || 0) + sp.points); break;
    case 'FIRST_CONTACT': sim.contacted[sp.target] = true; break;
    case 'STIPEND': sim.stipend = true; sim.targetBonus = (sim.targetBonus || 0) + 1; break;
    case 'CHARTER': sim.charters = (sim.charters || 0) + sp.n; break;
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
  this.world.turnNo = turn;
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

  this.phaseLeaseBreaks(dry);
  this.phaseCaretaker(dry);
  this.phaseDiplomacy();
  this.phaseIncome();
  this.phaseUpkeep();
  this.phaseLeases();
  this.phaseStandingEffects();
  this.phaseSynthesis();
  this.phaseExchange();
  this.phaseSpending();
  this.phaseMovement();
  this.phasePopulation();
  this.phaseSettlement();
  this.phaseWorldToll();
  this.phaseInfamy();
  this.phaseCompletions();
  this.phaseLeaseEndings();
  if (!dry) { this.model.commit(); tpFlush_(); this.model.reload('Calculations'); this.world.reloadCalc(); }
  this.phaseStability();
  this.log('Resolution', 'All', 'Turn resolved', 'Turn ' + this.turn + ' resolved', 'Yes', '');
};

/** Caretaker is settled here, at Resolve, not at Prepare: a nation whose orders produced no
 *  Actions rows this turn enters Caretaker; one that has rows leaves it. */
tpResolver_.prototype.phaseCaretaker = function (dry) {
  var self = this, N = this.model.tab('Nations'), withOrders = {}, changed = false;
  this.actions.forEach(function (a) { withOrders[a.nation] = true; });
  this.world.nations.forEach(function (n) {
    if (n.status === 'Eliminated' || n.status === 'Minor Power') return;
    if (!withOrders[n.id] && n.status !== 'Caretaker') { N.set(n.row, 'Status', 'Caretaker'); n.status = 'Caretaker'; changed = true; }
    if (withOrders[n.id] && n.status === 'Caretaker') { N.set(n.row, 'Status', 'Active'); n.status = 'Active'; changed = true; }
  });
  // Income is read from Calculations, whose formulas read Nations Status: recalculate before Income.
  if (changed && !dry) { this.model.commit(); tpFlush_(); this.model.reload('Calculations'); this.world.reloadCalc(); }
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
  var strat = tpParseStrat_(A.get(r, 'Strategic'));
  // A price in Marks (Stability or remediation paid in Marks) travels in the Strategic column.
  var mk = String(A.get(r, 'Strategic') || '').match(/(\d+(?:\.\d+)?)\s+Stellar Marks/i);
  if (mk && Number(mk[1])) strat[TURN_CONFIG.MARKS] = Number(mk[1]);
  return { cost: cost, strat: strat };
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
  // TREATY lines: proposals, offers and declines are delivered (Events rows for both parties).
  this.actions.filter(function (a) { return a.verb === 'TREATY' || a.verb === 'LEASE'; }).forEach(function (a) {
    if (self.gate(a) !== 'go') return;
    var approved = a.status === 'Needs ruling';
    var ev = self.reevaluate(a);
    if (ev.status === 'Condition failed') { self.setStatus(a, 'Condition failed', ev.flag); return; }
    if (ev.status === 'Rejected' || ev.status === 'Duplicate') { self.setStatus(a, 'Failed', ev.flag); return; }
    if (!ev.spec || (ev.status !== 'Ready' && !(approved && ev.status === 'Needs ruling'))) {
      if (approved) { self.setStatus(a, 'Settled by GM', 'Approved; nothing the script can apply'); self.settleRuling(self.decisions['A' + a.actionNo]); }
      else self.setStatus(a, 'Not applied', ev.flag);
      return;
    }
    if (ev.spec.type === 'LEASE_END') self.leaseNotice(a, ev.spec); else self.treatyNotice(a, ev.spec);
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
    if (X) self.ledger('Upkeep', n.id, 'Energy', -X, 'Fuel for the fleets',
      '1 Energy per 4 ship capacity, rounded up per fleet (ship capacity ' + U + '; Calculations Upkeep Energy)', '');
    // Wages: 1 Mark per 4 ship capacity (rounded up per fleet), ground formations about 1 per 4 Ground Power
    // (none under Citizen Militia), Static Defence 1 per 4 points. Paid in Marks or Industry, Energy and
    // Influence at 1 a Mark, from the largest stockpiles first.
    var own = w.forceList().filter(function (f) { return f.owner === n.id; });
    var shipW = own.reduce(function (t, f) { var cap = tpNum_(w.forcesTab.get(f.row, 'Escorts')) + 2.5 * tpNum_(w.forcesTab.get(f.row, 'Cruisers')) + 4.5 * tpNum_(w.forcesTab.get(f.row, 'Battleships')) + 10 * tpNum_(w.forcesTab.get(f.row, 'Dreadnoughts')); return t + Math.ceil(cap / 4); }, 0);
    var groundW = militia ? 0 : Math.ceil(W / 4);
    var sdW = Math.ceil(own.reduce(function (t, f) { return t + f.staticDefence; }, 0) / 4);
    var wages = shipW + groundW + sdW;
    if (wages > 0) {
      var M = TURN_CONFIG.MARKS, src = [M, 'Industry', 'Energy', 'Influence'].map(function (r) {
        var have = w.stock(n.id, r) - (r === 'Energy' ? X : 0);
        return { r: r, have: Math.max(0, tpRound2_(have)) };
      }).sort(function (a, b2) { return b2.have - a.have; });
      var due = wages, paid = [];
      src.forEach(function (x) { if (due <= 1e-9 || x.have <= 0) return; var take = tpRound2_(Math.min(due, x.have)); due = tpRound2_(due - take); paid.push([x.r, take]); });
      var wk = 'Ships ' + shipW + (groundW ? ', ground formations ' + groundW : (militia ? ', ground formations 0 (Citizen Militia)' : '')) + (sdW ? ', Static Defence ' + sdW : '') + ' = ' + wages + ' Marks, paid from the largest stockpiles first';
      paid.forEach(function (pr) { self.ledger('Upkeep', n.id, pr[0], -pr[1], 'Wages of the forces', wk, ''); });
      if (due > 1e-9) {
        self.log('Upkeep', n.id, 'Wages unpaid', due + ' Marks of wages unpaid: the GM disbands ground formations, then ships, to fit', 'No', '');
        self.ledger('Upkeep', n.id, 'Stability', -1, 'Failing to pay wages', due + ' Marks unpaid', '');
      }
    }
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
    if (a.verb === 'TRANSFER' || a.verb === 'MOVE' || a.verb === 'BUY' || a.verb === 'SELL' || a.verb === 'CANCEL' || a.verb === 'TREATY' || a.verb === 'LEASE') return;
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
    if (ev.stab) lines.push(self.ledger('Spending', a.nation, 'Stability', -ev.stab, reason, ev.stabWorking || (ev.stab > 0 ? 'Stability cost' : 'Bought with 5 Influence'), a.actionNo));
    var more = self.apply(a, ev.spec, ev);
    if (more && more.length) lines = lines.concat(more);
    self.A.set(a.row, 'Ledger lines', lines.join(', '));
    self.setStatus(a, 'Applied'); a.spec = ev.spec;
    self.settleRuling(self.decisions['A' + a.actionNo]);
    self.stats.applied++;
  });
};

tpResolver_.prototype.apply = function (a, sp, ev) {
  var w = this.world, n = a.nation, turn = this.turn, self = this;
  var N = this.model.tab('Nations'), nat = w.nation(n);
  switch (sp.type) {
    case 'DEVELOP': this.completions.push({ kind: 'Development', nation: n, sys: sp.sys, level: sp.level, row: a.actionNo }); break;
    case 'DESIGNATE': w.sys(sp.sys).set('Designation', sp.desig); this.log('Spending', n, 'Designation', w.label(sp.sys) + ' designated ' + sp.desig, 'No', a.actionNo); break;
    case 'BUILD':
      if ((sp.turns || 1) > 1) this.addWork(n, 'Building', sp.building, sp.sys, turn + sp.turns - 1, a.actionNo);
      else for (var bc = 0; bc < (sp.copies || 1); bc++) this.completions.push({ kind: 'Building', nation: n, sys: sp.sys, item: sp.building, row: a.actionNo });
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
    case 'DISMANTLE': {
      var S = w.sys(sp.sys), list = String(S.get('Buildings') || '').split(/\s*,\s*/).filter(function (x) { return x; });
      var i = list.indexOf(sp.building);
      if (i >= 0) list.splice(i, 1);
      S.set('Buildings', list.join(', '));
      var dl = this.simFor(n).dismantled[sp.sys] || [], j = dl.indexOf(sp.building);
      if (j >= 0) dl.splice(j, 1);   // the sheet now shows it gone; the sim must not remove it twice
      this.log('Spending', n, 'Dismantled', sp.building + ' dismantled at ' + w.label(sp.sys) + '; ' + (sp.refund || 0) + ' Industry refunded' + (sp.slot ? '; its slot is free' : ''), 'No', a.actionNo);
      break;
    }
    case 'REMEDIATE':
      // Degradation is kept in the Ledger under the system's ID, as the World toll writes it.
      var line = this.ledger('Spending', sp.sys, 'Degradation', -sp.points, 'Remediation by ' + n, (ev && ev.elab) || (sp.points + ' points removed'), a.actionNo);
      this.log('Spending', n, 'Remediation', w.label(sp.sys) + ': ' + sp.points + ' Degradation removed', 'No', a.actionNo);
      return [line];
    case 'STIPEND': {
      var St = TURN_CONFIG.STIPEND;
      this.model.tab('Standing effects').add('Nation', { 'Nation': n, 'Resource': St.resource, 'Amount per turn': -St.units, 'Phase': 'Upkeep', 'Reason': St.reason,
        'Working': St.units + ' Living compounds a turn sustain +1 Stability target (at most +1); first paid Turn ' + turn + ' (Actions row ' + a.actionNo + ')',
        'From turn': turn + 1, 'Until turn': '', 'Group': '', 'Active': 'Yes', 'Source': 'Turn script' });
      var okT = this.bumpNation(n, TURN_CONFIG.TEMP_TARGET_COLUMN, 1, 'Living compounds stipend', a.actionNo);
      this.log('Spending', n, 'Stipend', 'Living compounds stipend: ' + St.units + ' a turn from now on; +1 Stability target while paid' + (okT ? '' : ' (GM: add the +1 by hand)'), 'No', a.actionNo);
      break;
    }
    case 'CHARTER': {
      var SE = this.model.tab('Standing effects'), have = w.standingRows(n, function (r) { return /^charter\b/i.test(r.reason); }).length;
      for (var k = 1; k <= sp.n; k++) {
        SE.add('Nation', { 'Nation': n, 'Resource': 'Influence', 'Amount per turn': -sp.each, 'Phase': 'Upkeep', 'Reason': 'Charter ' + (have + k),
          'Working': '3 Influence x systems held / 5, recalculated each turn (' + sp.systems + ' systems now); +1 Administrative Capacity; lapses in any turn it is not paid',
          'From turn': turn + 1, 'Until turn': '', 'Group': '', 'Active': 'Yes', 'Source': 'Turn script' });
      }
      var okC = this.bumpNation(n, TURN_CONFIG.ADMIN_CAPACITY_COLUMN, sp.n, 'Charters', a.actionNo);
      this.log('Spending', n, 'Charter', sp.n + ' charter' + (sp.n > 1 ? 's' : '') + ' taken: +' + sp.n + ' Administrative Capacity' + (okC ? '' : ' (GM: raise capacity by hand)'), 'Yes', a.actionNo);
      break;
    }
    case 'FIRST_CONTACT': {
      var tn = w.nation(sp.target), me = w.nation(n), myName = (me && me.name) || n, tName = (tn && tn.name) || sp.target;
      if (sp.already) { this.log('Spending', n + ', ' + sp.target, 'Contact', myName + ' also called on ' + tName + '; first contact was made this turn', 'No', a.actionNo); break; }
      this.log('Spending', n + ', ' + sp.target, 'First contact', myName + ' and ' + tName + ' make first contact (' + myName + ' called; ' + sp.dist + ' lanes). Diplomacy may begin next turn.', 'Yes', a.actionNo);
      w.addContact(n, sp.target, turn);
      this.event(n, 'First contact', 'First contact with ' + tName, 'We made first contact with ' + tName + '. Treaties, trade and transfers may begin next turn.', a.actionNo);
      this.event(sp.target, 'First contact', 'First contact: ' + myName, myName + ' has called on us and made first contact. We may answer or ignore the call; diplomacy may begin next turn.', a.actionNo);
      break;
    }
  }
};

/** Adds delta to a Nations column (a plain number cell). Skipped with a Turn log line if the column is
 *  missing or holds a formula. Returns true when written. */
tpResolver_.prototype.bumpNation = function (nid, col, delta, why, actionRow) {
  var N = this.model.tab('Nations'), nat = this.world.nation(nid);
  if (!nat || N.c(col) < 0) { this.log('Spending', nid, 'Column missing', 'Nations has no "' + col + '" column: ' + why + ' ' + tpSigned_(delta) + ' not written', 'No', actionRow || ''); return false; }
  try { N.set(nat.row, col, tpRound2_(tpNum_(N.get(nat.row, col)) + delta)); return true; }
  catch (e) { this.log('Spending', nid, 'Column not written', why + ' ' + tpSigned_(delta) + ': ' + e.message, 'No', actionRow || ''); return false; }
};

/** A row on the GM's Events tab (shown on the nation's page). Skipped with one Turn log line if the tab is missing. */
tpResolver_.prototype.event = function (nid, kind, title, text, actionRow) {
  if (this.eventsTab === undefined) this.eventsTab = tpTryTab_(this.model, 'Events');
  if (!this.eventsTab) {
    if (!this.eventsWarned) { this.log('Diplomacy', 'All', 'Events tab missing', 'No Events tab: notices to players are in the Turn log only', 'No', ''); this.eventsWarned = true; }
    return;
  }
  try {
    this.eventsTab.add('Turn', { 'Turn': this.turn, 'Nations': nid, 'Kind': kind, 'Title': title, 'Text': text, 'Shown to player': 'Yes', 'Source': 'Turn script' });
  } catch (e) { this.log('Diplomacy', nid, 'Event not written', title + ': ' + e.message, 'No', actionRow || ''); }
};

/** Delivers a TREATY proposal, offer or decline: an Events row for each party. */
tpResolver_.prototype.treatyNotice = function (a, sp) {
  var w = this.world, me = w.nation(a.nation), to = w.nation(sp.to);
  var myName = (me && me.name) || a.nation, toName = (to && to.name) || sp.to;
  var said = /[.!?)]$/.test(String(sp.text).trim()) ? String(sp.text).trim() : String(sp.text).trim() + '.';
  if (sp.mode === 'reply') {
    this.event(sp.to, 'Notice', 'Reply from ' + myName, myName + ': ' + said, a.actionNo);
    this.event(a.nation, 'Notice', 'Reply sent to ' + toName, 'Delivered to ' + toName + ': ' + said, a.actionNo);
  } else {
    var answer = sp.lease ? '(LEASE ' + sp.lease + ' FROM ' + myName + ': accept, or TREATY ' + myName + ': decline ...)' : '(TREATY ' + myName + ': accept / decline ...)';
    this.event(sp.to, 'Treaty proposed', 'Proposal from ' + myName, myName + ' proposes: ' + said + ' Answer in your next orders ' + answer + '.', a.actionNo);
    this.event(a.nation, 'Notice', 'Proposal sent to ' + toName, 'Delivered to ' + toName + ': ' + said + ' Answered next turn.', a.actionNo);
  }
  this.log('Diplomacy', a.nation + ', ' + sp.to, sp.mode === 'reply' ? 'Treaty reply' : 'Treaty proposed', myName + ' to ' + toName + ': ' + sp.text, 'No', a.actionNo);
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
      var np = tpRound3_(p + g * p / total);   // to the million: small worlds' growth is not rounded away
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
// ---------------- Standing effects (GM-ruled, every turn) ----------------
tpResolver_.prototype.phaseStandingEffects = function () {
  var self = this, w = this.world, turn = this.turn, T = this.model.tab('Standing effects');
  var due = [];
  T.rows().forEach(function (r) {
    if (!/^y/i.test(String(T.get(r, 'Active')))) return;
    var nid = String(T.get(r, 'Nation')).trim(), res = String(T.get(r, 'Resource')).trim(), amt = tpNum_(T.get(r, 'Amount per turn'));
    var from = T.get(r, 'From turn'), until = T.get(r, 'Until turn');
    if (!nid || !res || !amt) return;
    if (from !== '' && turn < tpNum_(from)) return;
    if (until !== '' && turn > tpNum_(until)) return;
    var n = w.nation(nid);
    if (!n || n.status === 'Eliminated') return;
    var reason = String(T.get(r, 'Reason') || 'Standing effect'), scripted = String(T.get(r, 'Source') || '') === 'Turn script';
    var kind = scripted && /^charter\b/i.test(reason) ? 'charter' : scripted && reason === TURN_CONFIG.STIPEND.reason ? 'stipend' : '';
    var working = String(T.get(r, 'Working') || '');
    if (kind === 'charter') {
      // Charter upkeep follows the systems held: 3 Influence x systems held / 5.
      var held = w.systems.filter(function (s) { return s.get('Owner') === nid; }).length;
      amt = -tpRound1_(TURN_CONFIG.CHARTER.influencePerSystem * held / TURN_CONFIG.CHARTER.divisor);
      working = '3 Influence x ' + held + ' systems held / 5 = ' + (-amt);
    }
    due.push({ r: r + 1, row: r, nid: nid, res: res, amt: amt, phase: String(T.get(r, 'Phase') || '').trim() || (amt > 0 ? 'Income' : 'Upkeep'),
      reason: reason, working: working, group: String(T.get(r, 'Group') || '').trim(), kind: kind });
  });
  var groups = {};
  due.forEach(function (e) { var k = e.nid + '|' + (e.group || ('row' + e.r)); (groups[k] = groups[k] || []).push(e); });
  Object.keys(groups).forEach(function (k) {
    var list = groups[k], short = [];
    // Every cost in the group must be payable from what the nation holds now.
    var need = {};
    list.forEach(function (e) { if (e.amt < 0) need[e.res] = (need[e.res] || 0) - e.amt; });
    Object.keys(need).forEach(function (res) { if (w.stock(list[0].nid, res) + 1e-9 < need[res]) short.push(need[res] + ' ' + res); });
    if (short.length) {
      self.log('Standing effects', list[0].nid, 'Standing effect skipped', list[0].reason + ': not applied this turn, short of ' + short.join(' and '), 'No', '');
      // A charter or a Living compounds stipend lapses at once in a turn it is not paid.
      list.forEach(function (e) {
        if (!e.kind) return;
        T.set(e.row, 'Active', 'No'); T.set(e.row, 'Until turn', turn - 1);
        if (e.kind === 'charter') self.bumpNation(e.nid, TURN_CONFIG.ADMIN_CAPACITY_COLUMN, -1, e.reason + ' lapsed', '');
        else self.bumpNation(e.nid, TURN_CONFIG.TEMP_TARGET_COLUMN, -1, 'Living compounds stipend lapsed', '');
        self.log('Standing effects', e.nid, 'Lapsed', e.reason + ' lapses: its upkeep could not be paid', 'Yes', '');
      });
      return;
    }
    list.forEach(function (e) {
      self.ledger(e.phase, e.nid, e.res, e.amt, e.reason, (e.working ? e.working + '; ' : '') + 'Standing effects row ' + e.r, '');
    });
  });
};

// ---------------- Synthesis Works (each turn, before Spending) ----------------
// Each turn a Works takes one unit of each input and yields 1 at Development 1-2, 2 at 3-4, 3 at 5
// (2, 4 or 6 for an exceptional variant). Short of an input, it makes nothing that turn.
tpResolver_.prototype.phaseSynthesis = function () {
  var self = this, w = this.world;
  w.systems.forEach(function (s) {
    var nid = s.get('Owner'); if (!nid || String(s.get('Status') || '').trim()) return;
    String(s.get('Buildings') || '').split(/\s*,\s*/).forEach(function (bn) {
      var m = bn.match(/^Synthesis Works\s*\(\s*(.+?)\s*\)$/i); if (!m) return;
      var label = tpSysLabel_(s), rc = w.recipe(nid, m[1]);
      if (!rc || rc.inputs.length < 2) { self.log('Synthesis', nid, 'Synthesis Works idle', 'Synthesis Works at ' + label + ': no recipe "' + m[1] + '" on record for ' + nid, 'No', ''); return; }
      var dev = tpNum_(s.get('Development')), tier = dev >= 1 ? Math.ceil(dev / 2) : 0;   // 1 per two Development levels, rounded up (Development to 8, designer Turn 36)
      var can = tier > 0 ? 1 : 0;
      rc.inputs.forEach(function (inp) { can = Math.min(can, Math.floor(w.stock(nid, inp) + 1e-9)); });
      if (can <= 0) { self.log('Synthesis', nid, 'Synthesis Works idle', 'Synthesis Works at ' + label + ' made no ' + rc.name + ': short of ' + rc.inputs.join(' or '), 'No', ''); return; }
      var made = tier * (rc.exceptional ? 2 : 1), why = 'Synthesis Works at ' + label + ' (' + rc.name + ')';
      var working = '1 of each input -> ' + made + ' (Development ' + dev + (rc.exceptional ? ', exceptional variant x2' : '') + ')';
      rc.inputs.forEach(function (inp) { self.ledger('Spending', nid, inp, -can, why, working, ''); });
      self.ledger('Income', nid, rc.name, made, why, working, '');
    });
  });
};

// ---------------- The Galactic Exchange (after Income, before Spending) ----------------
tpResolver_.prototype.phaseExchange = function () {
  var self = this, w = this.world, turn = this.turn, C = TURN_CONFIG.EXCHANGE, M = TURN_CONFIG.MARKS;
  var st = w.exchangeState(), X = this.model.tab('Exchange orders');
  var opening = {}; Object.keys(st).forEach(function (r) { opening[r] = st[r].price; });
  var bought = {}, sold = {}, trades = {}, tradedBy = {}, boughtBy = {};
  Object.keys(st).forEach(function (r) { bought[r] = 0; sold[r] = 0; trades[r] = 0; });
  var nextId = 1;
  X.rows().forEach(function (r) { var m = String(X.get(r, 'Order ID')).match(/EX-(\d+)/); if (m) nextId = Math.max(nextId, Number(m[1]) + 1); });
  // 1. Cancellations, then this turn's new orders.
  var queue = [];
  this.actions.forEach(function (a) {
    if (a.verb !== 'BUY' && a.verb !== 'SELL' && a.verb !== 'CANCEL') return;
    if (self.gate(a) !== 'go') return;
    var ev = self.reevaluate(a);
    if (ev.status !== 'Ready' || !ev.spec) { self.setStatus(a, ev.status === 'Rejected' ? 'Failed' : 'Not applied', ev.flag); return; }
    if (ev.spec.type === 'EXCANCEL') {
      X.rows().forEach(function (r) { if (String(X.get(r, 'Order ID')).toUpperCase() === ev.spec.id && X.get(r, 'Nation') === a.nation && X.get(r, 'Status') === 'Open') { X.set(r, 'Status', 'Cancelled'); X.set(r, 'Note', 'Cancelled by order, turn ' + turn); } });
      self.setStatus(a, 'Applied'); self.stats.applied++; return;
    }
    var sp = ev.spec, slice = Math.ceil(sp.qty / sp.over);
    queue.push({ a: a, nation: a.nation, side: sp.side, res: sp.res, want: Math.min(slice, sp.qty), total: sp.qty, limit: sp.limit, over: sp.over, stand: sp.stand, row: a.actionNo });
  });
  X.rows().forEach(function (r) {
    if (X.get(r, 'Status') !== 'Open' || tpNum_(X.get(r, 'Placed (turn)')) >= turn) return;
    var rem = tpNum_(X.get(r, 'Remaining')), slice = tpNum_(X.get(r, 'Slice')) || rem;
    queue.push({ standing: r, nation: X.get(r, 'Nation'), side: X.get(r, 'Side'), res: X.get(r, 'Resource'), want: Math.min(slice, rem), total: rem, limit: tpNum_(X.get(r, 'Limit')), id: X.get(r, 'Order ID'), row: X.get(r, 'Action row') });
  });
  // 2. Random order within the turn (seeded by the turn, so a rerun gives the same order).
  var seed = turn * 2654435761 % 4294967296;
  var rnd = function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (var i = queue.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var tmp = queue[i]; queue[i] = queue[j]; queue[j] = tmp; }
  // 3. Settle.
  queue.forEach(function (o) {
    var x = st[o.res]; if (!x) return;
    var D = Math.max(1, x.depth), key = o.nation + '|' + o.res, used = tradedBy[key] || 0, q = Math.min(o.want, D - used), why = [];
    if (q < o.want) why.push('turn limit of one depth (' + D + ')');
    if (o.side === 'SELL') {
      var have = Math.floor(w.stock(o.nation, o.res) + 1e-9);
      if (have < q) { q = have; why.push('only ' + have + ' held'); }
      var glutAt = (o.res === 'Energy' || o.res === 'Influence') ? 0.5 : 1;
      if (x.price < glutAt * x.base) { var room = Math.max(0, Math.floor(C.glut * D - x.inventory)); if (room < q) { q = room; why.push('glut brake: the Exchange is full'); } }
      if (o.limit) { var pb = x.price * (1 - C.spread); var lim = pb > o.limit ? Math.floor(2 * D * (1 - o.limit / pb) / C.s) : 0; if (lim < q) { q = Math.max(0, lim); why.push('limit ' + o.limit); } }
    } else {
      if (x.inventory < q) { q = Math.floor(x.inventory + 1e-9); why.push('the Exchange held ' + Math.floor(x.inventory)); }
      if (o.res === 'Research' || o.res === 'Influence') {
        var gross = tpNum_((w.calc(o.nation) || {})[TURN_CONFIG.GROSS_HEADERS[o.res]]), cap = Math.floor(C.capShare * gross) - (boughtBy[key] || 0);
        if (cap < q) { q = Math.max(0, cap); why.push('purchase cap of 25% of gross ' + o.res); }
      }
      if (o.limit) { var ps = x.price * (1 + C.spread); var lim2 = o.limit > ps ? Math.floor(2 * D * (o.limit / ps - 1) / C.s) : 0; if (lim2 < q) { q = Math.max(0, lim2); why.push('limit ' + o.limit); } }
      var marks = w.stock(o.nation, M);
      while (q > 0 && tpExFill_(x, 'BUY', q).value > marks + 1e-9) q--;
      if (q < o.want && marks < tpExFill_(x, 'BUY', Math.max(1, o.want)).value) why.push(tpRound1_(marks) + ' Marks in the treasury');
    }
    var filled = 0, value = 0;
    if (q > 0) {
      var f = tpExFill_(x, o.side, q);
      value = tpRound2_(f.value); filled = q;
      var reason = 'Exchange: ' + (o.side === 'SELL' ? 'sold ' : 'bought ') + q + ' ' + o.res + ' at ' + tpRound2_(f.avg) + ' Marks each';
      var working = 'price ' + tpRound2_(x.price) + ' -> ' + tpRound2_(f.after) + '; depth ' + D + (o.id ? '; standing order ' + o.id : '');
      if (o.side === 'SELL') { self.ledger('Exchange', o.nation, o.res, -q, reason, working, o.row); self.ledger('Exchange', o.nation, M, value, reason, working, o.row); x.inventory += q; bought[o.res] += q; }
      else { self.ledger('Exchange', o.nation, o.res, q, reason, working, o.row); self.ledger('Exchange', o.nation, M, -value, reason, working, o.row); x.inventory -= q; sold[o.res] += q; boughtBy[key] = (boughtBy[key] || 0) + q; }
      x.price = f.after; trades[o.res]++; tradedBy[key] = used + q;
    }
    var left = o.total - filled;
    var note = filled ? (o.side === 'SELL' ? 'Sold ' : 'Bought ') + filled + ' ' + o.res + ' for ' + tpRound1_(value) + ' Marks' : 'Nothing traded';
    if (why.length) note += ' (' + why.join('; ') + ')';
    if (o.a) {
      // A sliced order or a limit order with FOR n TURNS leaves the rest standing.
      var turnsLeft = o.over > 1 ? o.over - 1 : o.stand > 1 ? o.stand - 1 : 0;
      if (left > 0 && turnsLeft > 0) {
        var id = 'EX-' + (nextId++);
        X.add('Order ID', { 'Order ID': id, 'Nation': o.nation, 'Side': o.side, 'Resource': o.res, 'Remaining': left, 'Limit': o.limit || '',
          'Slice': o.over > 1 ? Math.ceil(o.total / o.over) : '', 'Turns left': turnsLeft, 'Placed (turn)': turn, 'Action row': o.row, 'Status': 'Open', 'Note': note });
        note += '; ' + left + ' left standing as ' + id;
      }
      self.A.set(o.a.row, 'Ledger lines', ''); self.setStatus(o.a, 'Applied', note); self.stats.applied++;
    } else {
      var tl = tpNum_(X.get(o.standing, 'Turns left')) - 1;
      X.set(o.standing, 'Remaining', left); X.set(o.standing, 'Turns left', Math.max(0, tl)); X.set(o.standing, 'Note', 'Turn ' + turn + ': ' + note);
      if (left <= 0) X.set(o.standing, 'Status', 'Filled'); else if (tl <= 0) X.set(o.standing, 'Status', 'Lapsed');
    }
  });
  // 4. Next turn's published prices.
  var EX = this.model.tab('Exchange');
  Object.keys(st).forEach(function (res) {
    var x = st[res], fl = w.exFlows(res, turn), strat = TURN_CONFIG.STRATEGIC.indexOf(res) >= 0;
    var openBuys = 0;
    X.rows().forEach(function (r) { if (X.get(r, 'Status') === 'Open' && X.get(r, 'Side') === 'BUY' && X.get(r, 'Resource') === res) openBuys += tpNum_(X.get(r, 'Remaining')); });
    // Target = Base x (Demand / Supply) ^ e: balance holds the base price (ruling, 23 Oct 2026; the divisor k was dropped).
    var demand = fl.spent + openBuys, supply = fl.income + x.inventory + 0.1 * fl.stock;
    var target = demand <= 0 && supply <= 0 ? x.base : supply > 0 ? x.base * Math.pow(Math.max(demand, 0.01) / supply, C.e) : x.base * C.ceiling;
    target = Math.max(x.base * C.floor, Math.min(x.base * C.ceiling, target));
    // Trades walk the price within the turn only; the published price moves at most 10% a turn toward its target.
    var p0 = opening[res], step = Math.max(-C.smooth * p0, Math.min(C.smooth * p0, target - p0));
    var price = Math.max(x.base * C.floor, Math.min(x.base * C.ceiling, p0 + step));
    var depth = Math.round(Math.max(fl.traded + (bought[res] + sold[res]) / 3, 0.1 * fl.income, strat ? C.depthMinStrat : C.depthMinMain));
    EX.add('Turn', { 'Turn': turn, 'Resource': res, 'Base': x.base, 'Price': tpRound2_(price), 'Target': tpRound2_(target), 'Demand': tpRound1_(demand),
      'Supply': tpRound1_(supply), 'Depth': depth, 'Inventory': tpRound1_(x.inventory), 'Bought by Exchange': bought[res], 'Sold by Exchange': sold[res], 'Trades': trades[res] });
  });
};

// ---------------- Settlement within a nation ----------------
tpResolver_.prototype.phaseSettlement = function () {
  var self = this, w = this.world, Wt = w.worldsTab, P = this.model.tab('Settlement policy');
  var policy = {};
  P.rows().forEach(function (r) {
    var nid = String(P.get(r, 'Nation')).trim(); if (!nid) return;
    policy[nid] = { threshold: tpNum_(P.get(r, 'Threshold (x capacity)')) || 1.05, share: tpNum_(P.get(r, 'Share % a turn')),
      excess: /^y/i.test(String(P.get(r, 'Take whole excess'))), reason: String(P.get(r, 'Reason') || '') };
  });
  var dflt = policy.ALL || { threshold: w.popConst('Overcrowding threshold (x capacity)', 1.05), share: w.popConst('Migration within a nation % a turn', 3), excess: false, reason: 'Migration within a nation' };
  function mainRows(sid) { return w.worldRows(sid).filter(function (r) { return String(Wt.get(r, 'Habitable')) === 'Yes'; }); }
  w.activeNations().forEach(function (n) {
    var pol = policy[n.id] || dflt;
    if (!pol.share && !pol.excess) return;
    var sys = w.systems.filter(function (s) { return s.get('Owner') === n.id && !String(s.get('Status') || '').trim(); }).map(function (s) {
      return { s: s, pop: w.systemPopulation(s.id), cap: tpNum_(s.get('Carrying capacity (bn)')) };
    }).filter(function (x) { return x.cap > 0; });
    sys.filter(function (x) { return x.pop >= pol.threshold * x.cap - 1e-9 && x.pop > 0; }).forEach(function (src) {
      var amount = Math.max(src.pop * pol.share / 100, pol.excess ? src.pop - src.cap : 0);
      var dests = sys.filter(function (x) { return x !== src && x.pop < x.cap; }).sort(function (a, b) { return a.pop / a.cap - b.pop / b.cap; });
      var room = dests.reduce(function (t, x) { return t + (x.cap - x.pop); }, 0);
      amount = tpRound2_(Math.min(amount, room));
      if (amount < 0.01) return;
      // Take from the source system's peopled worlds in proportion.
      var srcRows = w.worldRows(src.s.id).filter(function (r) { return tpNum_(Wt.get(r, 'Population (bn)')) > 0; });
      var srcTotal = srcRows.reduce(function (t, r) { return t + tpNum_(Wt.get(r, 'Population (bn)')); }, 0);
      var taken = 0;
      srcRows.forEach(function (r, i) {
        var p = tpNum_(Wt.get(r, 'Population (bn)'));
        var share = i === srcRows.length - 1 ? tpRound3_(amount - taken) : tpRound3_(amount * p / srcTotal);
        taken = tpRound3_(taken + share);
        Wt.set(r, 'Population (bn)', tpRound3_(p - share));
      });
      src.pop = tpRound2_(src.pop - amount);
      // Fill the emptiest systems first, never past their capacity.
      var left = amount, parts = [];
      dests.forEach(function (d) {
        if (left < 0.005) return;
        var give = tpRound2_(Math.min(left, d.cap - d.pop));
        if (give < 0.01) return;
        var row = mainRows(d.s.id).filter(function (r) { return tpNum_(Wt.get(r, 'Population (bn)')) > 0; })[0] || mainRows(d.s.id)[0];
        if (row === undefined) return;
        Wt.set(row, 'Population (bn)', tpRound3_(tpNum_(Wt.get(row, 'Population (bn)')) + give));
        d.pop = tpRound2_(d.pop + give); left = tpRound2_(left - give);
        parts.push(w.label(d.s.id) + ' +' + give);
      });
      self.log('Population', n.id, 'Settlement', w.label(src.s.id) + ' (' + tpRound2_(src.pop + amount) + ' of ' + src.cap + ' bn) sends ' + tpRound2_(amount - left) + ' bn: ' + parts.join(', ') + (pol.reason ? ' [' + pol.reason + ']' : ''), 'No', '');
    });
  });
};

// ---------------- Leases (rules, Partnerships) ----------------
/** Sets a cell if the column exists and is writable; false otherwise (a missing column reads blank). */
function tpSetIf_(tab, r, header, v) {
  if (tab.c(header) < 0) return v === '';
  try { tab.set(r, header, v); return true; } catch (e) { return false; }
}
/** Ends a lease. how: 'revert' (sovereignty and administration to the lessor), 'keep' (the lessee holds it
 *  outright), 'void' (the lease lapses; Owner untouched), 'war' (to the lessor, occupied by the lessee). */
tpResolver_.prototype.endLease = function (ls, how, treatyStatus, why) {
  var w = this.world, S = ls.s, L = TURN_CONFIG.LEASE, turn = this.turn, label = w.label(ls.sys), miss = [];
  if (how === 'revert' || how === 'war') { if (!tpSetIf_(w.systemsTab, S.row, 'Owner', ls.lessor)) miss.push('Owner = ' + ls.lessor); }
  if (how === 'war' && !tpSetIf_(w.systemsTab, S.row, 'Status', 'Occupied by ' + ls.lessee + ' (T' + turn + ')')) miss.push('Status = Occupied by ' + ls.lessee + ' (T' + turn + ')');
  [L.lessor, L.treaty, L.payment, L.rent, L.ends].forEach(function (h) { if (!tpSetIf_(w.systemsTab, S.row, h, '')) miss.push(h + ' cleared'); });
  var tr = w.treatyRow(ls.treaty);
  if (tr) {
    if (!tpSetIf_(tr.tab, tr.row, 'Ended (turn)', turn)) miss.push('Treaties ' + ls.treaty + ' Ended (turn) = ' + turn);
    if (!tpSetIf_(tr.tab, tr.row, 'Status', treatyStatus)) miss.push('Treaties ' + ls.treaty + ' Status = ' + treatyStatus);
  }
  var lsr = w.nameOf(ls.lessor), lse = w.nameOf(ls.lessee), ref = ls.treaty ? ' (' + ls.treaty + ')' : '';
  var after = how === 'revert' ? label + ' returns to ' + lsr + '.' : how === 'keep' ? lse + ' now holds ' + label + ' outright.' :
    how === 'war' ? label + ' returns to ' + lsr + '\'s sovereignty, occupied by ' + lse + '\'s forces.' : 'The lease is void; ' + label + ' stays with ' + (w.nameOf(String(S.get('Owner') || '')) || 'no one') + '.';
  this.log('Leases', ls.lessor + ', ' + ls.lessee, 'Lease ended', 'Lease of ' + label + ref + ' ended: ' + why + '. ' + after, 'Yes', '');
  if (miss.length) this.log('Leases', ls.lessor + ', ' + ls.lessee, 'Lease: write by hand', 'Lease of ' + label + ref + ': the script could not write ' + miss.join('; '), 'No', '');
  var text = 'The lease of ' + label + ref + ' has ended: ' + why + '. ' + after;
  [ls.lessor, ls.lessee].forEach(function (id) { var n = w.nation(id); if (n && n.status !== 'Eliminated') this.event(id, 'Treaty ended', 'Lease of ' + label + ' ended', text, ''); }, this);
};

/** Start of the resolution: war between the parties, an eliminated party, or a world lost to a third power
 *  ends a lease at once. Calculations is recalculated before Income when anything changed. */
tpResolver_.prototype.phaseLeaseBreaks = function (dry) {
  var self = this, w = this.world, changed = false;
  w.leases().forEach(function (ls) {
    var lsr = w.nation(ls.lessor), lse = w.nation(ls.lessee);
    if (ls.lessee && ls.lessee === ls.lessor) { self.endLease(ls, 'void', 'Ended', 'the sovereign already administers it'); changed = true; return; }
    if (lsr && lsr.status === 'Eliminated') { self.endLease(ls, 'keep', 'Ended: lessor eliminated', w.nameOf(ls.lessor) + ' is eliminated'); changed = true; return; }
    if (lse && lse.status === 'Eliminated') { self.endLease(ls, 'revert', 'Ended: lessee eliminated', w.nameOf(ls.lessee) + ' is eliminated'); changed = true; return; }
    var tr = w.treatyRow(ls.treaty);
    if (!ls.lessee || (tr && tr.parties.length >= 2 && tr.parties.indexOf(ls.lessee) < 0)) {
      self.endLease(ls, 'void', 'Void', ls.lessee ? w.nameOf(ls.lessee) + ', a third power, has taken the world' : 'the world is no longer held'); changed = true; return;
    }
    var war = w.warBetween(ls.lessor, ls.lessee);
    if (war) { self.endLease(ls, 'war', 'Ended by war', 'war' + (war.id ? ' (' + war.id + ')' : '') + ' between ' + w.nameOf(ls.lessor) + ' and ' + w.nameOf(ls.lessee)); changed = true; }
  });
  if (changed && !dry) { this.model.commit(); tpFlush_(); this.model.reload('Calculations'); this.world.reloadCalc(); }
};

/** After Upkeep: each lease's payment, lessee to lessor, as transfer lines. Unpaid rent and a lease reaching
 *  its last turn end it at the end of the turn (phaseLeaseEndings). */
tpResolver_.prototype.phaseLeases = function () {
  var self = this, w = this.world, turn = this.turn, M = TURN_CONFIG.MARKS;
  this.leaseEnds = [];
  var stratCols = TURN_CONFIG.STRATEGIC.filter(function (r) { return w.systemsTab.c(r) >= 0; }), stratText = w.systemsTab.c('Strategic output') >= 0;
  w.leases().forEach(function (ls) {
    var tr = w.treatyRow(ls.treaty);
    if (tr && tr.from !== '' && tpNum_(tr.from) > turn) return;   // not yet in force
    var S = ls.s, label = w.label(ls.sys), lsrName = w.nameOf(ls.lessor), lseName = w.nameOf(ls.lessee);
    var head = 'Lease of ' + ls.sys + (ls.treaty ? ' (' + ls.treaty + ')' : '') + ': ';
    var form = tpLeaseForm_(ls), idle = !!ls.status;
    function pass(res, amt, what, working) {
      amt = tpRound2_(amt);
      if (amt <= 0) return 0;
      self.ledger('Diplomacy', ls.lessee, res, -amt, head + what + ' to ' + lsrName, working, '');
      self.ledger('Diplomacy', ls.lessor, res, amt, head + what + ' from ' + lseName, working, '');
      return amt;
    }
    if (!form) self.log('Leases', ls.lessor + ', ' + ls.lessee, 'Lease: no payment', head + 'no payment form on Systems "' + TURN_CONFIG.LEASE.payment + '" (' + TURN_CONFIG.LEASE.forms.join(', ') + '): nothing paid', 'No', '');
    if (form === 'Rent' || form === 'Rent and extraction') {
      var rent = tpLeaseRent_(ls.rent);
      if (!rent) self.log('Leases', ls.lessor + ', ' + ls.lessee, 'Lease: rent unreadable', head + 'rent "' + ls.rent + '" not readable (write e.g. 20 Stellar Marks): not charged this turn', 'No', '');
      else {
        var short = Object.keys(rent).filter(function (r) { return w.stock(ls.lessee, r) + 1e-9 < rent[r]; });
        if (short.length) {
          self.leaseEnds.push({ ls: ls, how: 'revert', status: 'Ended: rent unpaid', why: 'the rent (' + ls.rent + ') went unpaid: ' + short.map(function (r) { return rent[r] + ' ' + r + ' due, ' + tpRound2_(w.stock(ls.lessee, r)) + ' held'; }).join('; ') });
        } else Object.keys(rent).forEach(function (r) { pass(r, rent[r], 'rent', 'Rent ' + ls.rent + ' a turn (Systems ' + ls.sys + ')'); });
      }
    }
    var halfStrat = form === 'Shared', allStrat = form === 'Extraction' || form === 'Rent and extraction';
    if ((halfStrat || allStrat) && !idle) {
      var out = {};
      stratCols.forEach(function (r) { var v = tpNum_(S.get(r)); if (v > 0) out[r] = v; });
      if (stratText) { var p = tpParseStrat_(S.get('Strategic output')); Object.keys(p).forEach(function (r) { if (!(r in out) && p[r] > 0) out[r] = p[r]; }); }
      if (!stratCols.length && !stratText) self.log('Leases', ls.lessor + ', ' + ls.lessee, 'Lease: write by hand', head + 'Systems has no per-system strategic output columns: ' + (halfStrat ? 'half of ' : '') + label + '\'s strategic output not passed to ' + lsrName, 'No', '');
      Object.keys(out).forEach(function (r) {
        var due = halfStrat ? out[r] / 2 : out[r], have = Math.max(0, w.stock(ls.lessee, r)), amt = Math.min(due, have);
        pass(r, amt, halfStrat ? 'half its ' + r : 'extraction of ' + r, label + ' yields ' + out[r] + ' ' + r + (halfStrat ? '; half = ' + tpRound2_(due) : '; all to the lessor') + (amt + 1e-9 < due ? '; only ' + tpRound2_(have) + ' held' : ''));
      });
    }
    if (form === 'Shared' && !idle) {
      TURN_CONFIG.RESOURCES.forEach(function (r) {
        var v = tpNum_(S.get(r)); if (v <= 0) return;
        var due = v / 2, have = Math.max(0, w.stock(ls.lessee, r)), amt = Math.min(due, have);
        pass(r, amt, 'half its ' + r, label + ' produces ' + v + ' ' + r + ' (Systems ' + r + ' column); half = ' + tpRound2_(due) + (amt + 1e-9 < due ? '; only ' + tpRound2_(have) + ' held' : ''));
      });
    }
    if (ls.ends && turn >= ls.ends && !self.leaseEnds.some(function (e) { return e.ls.sys === ls.sys; }))
      self.leaseEnds.push({ ls: ls, how: 'revert', status: 'Expired', why: 'its term ran to the end of Turn ' + ls.ends });
    else if (ls.ends && turn + 1 === ls.ends) {
      self.event(ls.lessor, 'Notice', 'Lease of ' + label + ' ends next turn', 'The lease of ' + label + ' to ' + lseName + ' ends at the end of Turn ' + ls.ends + ', and the system returns to us.', '');
      self.event(ls.lessee, 'Notice', 'Lease of ' + label + ' ends next turn', 'Our lease of ' + label + ' from ' + lsrName + ' ends at the end of Turn ' + ls.ends + ', and the system returns to ' + lsrName + '.', '');
    }
  });
};
/** End of the turn: leases that expired or went unpaid revert to the lessor. */
tpResolver_.prototype.phaseLeaseEndings = function () {
  var self = this;
  (this.leaseEnds || []).forEach(function (e) { self.endLease(e.ls, e.how, e.status, e.why); });
};
/** An approved LEASE END: writes the end turn and tells both parties. */
tpResolver_.prototype.leaseNotice = function (a, sp) {
  var w = this.world, S = w.sys(sp.sys), label = w.label(sp.sys), by = w.nameOf(a.nation), ref = sp.treaty ? ' (' + sp.treaty + ')' : '';
  var ok = S && tpSetIf_(w.systemsTab, S.row, TURN_CONFIG.LEASE.ends, sp.ends) && w.systemsTab.c(TURN_CONFIG.LEASE.ends) >= 0;
  var text = by + ' has given notice: the lease of ' + label + ref + ' ends at the end of Turn ' + sp.ends + ', and the system returns to ' + w.nameOf(sp.lessor) + '.';
  this.event(sp.lessor, 'Notice', 'Notice on the lease of ' + label, text, a.actionNo);
  this.event(sp.lessee, 'Notice', 'Notice on the lease of ' + label, text, a.actionNo);
  this.log('Diplomacy', sp.lessor + ', ' + sp.lessee, 'Lease notice', text + (ok ? '' : ' GM: write ' + TURN_CONFIG.LEASE.ends + ' = ' + sp.ends + ' on Systems ' + sp.sys + ' by hand.'), 'No', a.actionNo);
};

// ---------------- Imperial succession ----------------
tpResolver_.prototype.phaseSuccession = function () {
  var self = this, w = this.world, turn = this.turn, S = this.model.tab('Successions');
  w.activeNations().forEach(function (n) {
    if (n.gov !== 'Imperial') return;
    if (/Necrophage/i.test(String(n.bio || ''))) return;   // ageless rulers: abdication, coup or assassination only
    var traits = String(n.traits || '');
    var every = /Long-lived/i.test(traits) ? 20 : /Short-lived/i.test(traits) ? 6 : 10;
    var last = 0;
    S.rows().forEach(function (r) { if (String(S.get(r, 'Nation')).trim() === n.id) last = Math.max(last, tpNum_(S.get(r, 'From turn'))); });
    var dueAt = last + every;
    if (turn >= dueAt) {
      self.ledger('Stability', n.id, 'Stability', -2, 'Imperial succession', 'The ruler changes every ' + every + ' turns (last change Turn ' + last + ')', '');
      S.add('Nation', { 'Nation': n.id, 'Ruler': '(heir to be named)', 'From turn': turn, 'Note': 'Succession applied by the turn script' });
      self.log('Stability', n.id, 'Succession', 'Imperial succession: a new ruler takes the throne (-2 Stability). GM: record the heir on the Successions tab.', 'Yes', '');
    } else if (turn + 1 === dueAt) {
      self.log('Stability', n.id, 'Succession due', 'Imperial succession falls due next turn (Turn ' + dueAt + '): ask the player to name the heir.', 'No', '');
    }
  });
};

tpResolver_.prototype.phaseStability = function () {
  var self = this, w = this.world;
  this.phaseSuccession();
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
/** The Exchange as it stands for this turn: the latest published row per resource, or base prices if none. */
tpWorld_.prototype.exchangeState = function () {
  if (this._ex) return this._ex;
  var C = TURN_CONFIG.EXCHANGE, X = this.model.tab('Exchange'), latest = {}, self = this;
  X.rows().forEach(function (r) {
    var res = String(X.get(r, 'Resource')).trim(), t = tpNum_(X.get(r, 'Turn'));
    if (res && (!latest[res] || t >= latest[res].t)) latest[res] = { t: t, r: r };
  });
  var out = {};
  TURN_CONFIG.RESOURCES.concat(TURN_CONFIG.STRATEGIC).forEach(function (res) {
    var base = C.base[res] || C.baseStrat, L = latest[res];
    out[res] = L ? { res: res, base: base, price: tpNum_(X.get(L.r, 'Price')) || base, depth: tpNum_(X.get(L.r, 'Depth')) || self.exDepthFloor(res), inventory: tpNum_(X.get(L.r, 'Inventory')) }
                 : { res: res, base: base, price: base, depth: self.exDepthFloor(res), inventory: 0 };
  });
  this._ex = out;
  return out;
};
tpWorld_.prototype.exDepthFloor = function (res) {
  var C = TURN_CONFIG.EXCHANGE, strat = TURN_CONFIG.STRATEGIC.indexOf(res) >= 0;
  return Math.max(strat ? C.depthMinStrat : C.depthMinMain, Math.round(0.1 * this.exFlows(res).income));
};
/** Galaxy-wide flows of a resource, averaged over the last 3 turns of the Ledger (Exchange trades left out). */
tpWorld_.prototype.exFlows = function (res, uptoTurn) {
  this._flows = this._flows || {};
  var key = res + '|' + (uptoTurn || '');
  if (this._flows[key]) return this._flows[key];
  var L = this.ledgerTab, last = 0, nat = {};
  this.nations.forEach(function (n) { nat[n.id] = true; });
  L.rows().forEach(function (r) { var t = tpNum_(L.get(r, 'Turn')); if (t > last && (!uptoTurn || t <= uptoTurn)) last = t; });
  var inc = 0, spent = 0, traded = 0, stocks = {};
  L.rows().forEach(function (r) {
    if (L.get(r, 'Resource') !== res || !nat[L.get(r, 'Nation')]) return;
    var t = tpNum_(L.get(r, 'Turn')), a = tpNum_(L.get(r, 'Amount')), ph = String(L.get(r, 'Phase'));
    if (uptoTurn && t > uptoTurn) return;
    stocks[L.get(r, 'Nation')] = (stocks[L.get(r, 'Nation')] || 0) + a;
    if (t <= last - 3) return;
    if (ph === 'Exchange') { traded += Math.abs(a); return; }
    if (ph === 'Income' && a > 0) inc += a;
    else if (a < 0 && (ph === 'Spending' || ph === 'Upkeep')) spent += -a;
  });
  var total = 0; Object.keys(stocks).forEach(function (k) { total += Math.max(0, stocks[k]); });
  var counted = 0; Object.keys(stocks).forEach(function (k) { counted += Math.min(Math.max(0, stocks[k]), TURN_CONFIG.EXCHANGE.hoard * total); });
  var out = { income: inc / 3, spent: spent / 3, traded: traded / 3, stock: counted };
  this._flows[key] = out;
  return out;
};
function tpIsOrbital_(world, name) {
  var base = String(name).replace(/\s*\(.*\)\s*$/, '');
  var b = world.building(base);
  if (b && b.orbital) return true;
  var U = world.model.tab('Unlocks'), hit = false;
  U.rows().forEach(function (r) { if (tpNorm_(U.get(r, 'Building')) === tpNorm_(base) && /orbital/i.test(String(U.get(r, 'Takes a slot')))) hit = true; });
  return hit;
}
// Hidden buildings unlocked for one nation (Unlocks tab). "Synthesis Works (<recipe>)" names the recipe it makes.
tpWorld_.prototype.unlockedBuilding = function (nid, name) {
  var m = String(name).match(/^(.*?)\s*(?:\(\s*(?:making\s+)?([^)]+?)\s*\)|[\u2014\u2013-]+\s*(?:making\s+)?(.+)|\s+making\s+(.+))$/i);
  var base = m ? m[1] : String(name), recipe = m ? (m[2] || m[3] || m[4] || '').trim() : '';
  var U = this.model.tab('Unlocks'), hit = null;
  U.rows().forEach(function (r) { if (hit === null && String(U.get(r, 'Nation')).trim() === nid && tpNorm_(U.get(r, 'Building')) === tpNorm_(name)) { hit = r; base = String(name); recipe = ''; } });
  U.rows().forEach(function (r) {
    if (hit !== null || String(U.get(r, 'Nation')).trim() !== nid) return;
    var bn = String(U.get(r, 'Building')).trim();
    if (bn && (tpNorm_(bn) === tpNorm_(base) || tpNorm_(bn) === tpNorm_(base).replace(/s$/, ''))) hit = r;
  });
  if (hit === null) return null;
  var b = { name: String(U.get(hit, 'Building')).trim(), industry: tpNum_(U.get(hit, 'Industry')), strat: tpParseStrat_(U.get(hit, 'Strategic')),
    req: tpParseReq_(U.get(hit, 'Requires')), turns: tpNum_(U.get(hit, 'Turns')) || 1,
    slot: !/^(n|orbital)/i.test(String(U.get(hit, 'Takes a slot'))), orbital: /orbital/i.test(String(U.get(hit, 'Takes a slot'))), unlocked: true };
  if (/^synthesis works$/i.test(b.name)) {
    if (!recipe) return { error: 'Name the recipe the Works will make, e.g. BUILD Synthesis Works (Reactor Alloy) @ <system>' };
    var rc = this.recipe(nid, recipe);
    if (!rc || /building/i.test(rc.yields)) return { error: 'Not a material recipe this nation holds: ' + recipe };
    b.builtName = 'Synthesis Works (' + rc.name + ')';
  }
  return b;
};
tpWorld_.prototype.recipe = function (nid, name) {
  var R = this.model.tab('Recipes'), out = null;
  R.rows().forEach(function (r) {
    if (out || String(R.get(r, 'Nation')).trim() !== nid || tpNorm_(R.get(r, 'Recipe')) !== tpNorm_(name)) return;
    var inputs = String(R.get(r, 'Inputs') || '').split(/\s*\+\s*/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
    out = { name: String(R.get(r, 'Recipe')).trim(), yields: String(R.get(r, 'Yields') || 'Material'), inputs: inputs,
      exceptional: /exceptional/i.test(String(R.get(r, 'Variant') || '')) };
  });
  return out;
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
  // Lease payments due this turn: paid by the lessee to the lessor after upkeep.
  this.leases().forEach(function (ls) {
    if (ls.lessee !== nid && ls.lessor !== nid) return;
    var tr = self.treatyRow(ls.treaty);
    if (tr && tr.from !== '' && tpNum_(tr.from) > turn) return;
    var due = tpLeaseDue_(self, ls), sign = ls.lessee === nid ? -1 : 1;
    Object.keys(due).forEach(function (r) { out[r] = (out[r] || 0) + sign * due[r]; });
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
    if (!/^(?:active|ongoing)$/i.test(String(W.get(r, 'Status') || '').trim())) return false;
    var sides = (String(W.get(r, 'Side A (IDs)')) + ',' + String(W.get(r, 'Side B (IDs)')) + ',' + String(W.get(r, 'Joined later (ID:A or B:turn; ...)'))).split(/[,;:\s]+/);
    return sides.indexOf(nid) >= 0;
  });
};

tpWorld_.prototype.nameOf = function (id) { var n = this.nation(id); return (n && n.name) || id; };
/** Leases in force: one per system whose Lessor (sovereign) is filled. */
tpWorld_.prototype.leases = function () {
  var self = this;
  return this.systems.map(function (s) { return tpLeaseOf_(self, s); }).filter(function (x) { return x; });
};
/** A Treaties row by its ID, with the parties' IDs, or null. */
tpWorld_.prototype.treatyRow = function (id) {
  var T = tpTryTab_(this.model, 'Treaties'), self = this, out = null;
  if (!T || !id) return null;
  T.rows().forEach(function (r) {
    if (out || tpNorm_(T.get(r, 'Treaty ID')) !== tpNorm_(id)) return;
    out = { tab: T, row: r, parties: self.nationIds([T.get(r, 'Party 1'), T.get(r, 'Party 2'), T.get(r, 'Parties')].join(', ')), from: T.get(r, 'In force from') };
  });
  return out;
};
/** The war in which a and b stand on opposite sides (Wars: Status Active or Ongoing), or null. */
/** Hostile ships holding a system's space: a fleet of a nation at war with nid (designer's ruling, Turn 36:
 *  while hostile forces hold a system's space, no orbital construction there; ground construction goes on). */
/** An enemy at war with ships or ground formations in this system: the label of the first such force, or ''. */
tpWorld_.prototype.underAttack = function (nid, sid) {
  var self = this;
  var f = this.forceList().filter(function (x) { return x.owner !== nid && x.location === sid && (x.ships > 0 || x.groundPower > 0) && self.warBetween(nid, x.owner); })[0];
  return f ? (this.nameOf(f.owner) + ' (' + f.id + ')') : '';
};
tpWorld_.prototype.hostileSpace = function (nid, sid) {
  var self = this;
  var f = this.forceList().filter(function (x) { return x.owner !== nid && x.location === sid && x.ships > 0 && self.warBetween(nid, x.owner); })[0];
  return f ? (this.nameOf(f.owner) + ' (' + f.id + ')') : '';
};
tpWorld_.prototype.warBetween = function (a, b) {
  var W = tpTryTab_(this.model, 'Wars'), hit = null;
  if (!W) return null;
  W.rows().forEach(function (r) {
    if (hit || !/^(?:active|ongoing)$/i.test(String(W.get(r, 'Status') || '').trim())) return;
    var A = String(W.get(r, 'Side A (IDs)') || '').split(/[,;\s]+/), B = String(W.get(r, 'Side B (IDs)') || '').split(/[,;\s]+/);
    String(W.get(r, 'Joined later (ID:A or B:turn; ...)') || W.get(r, 'Joined later') || '').split(/\s*;\s*/).forEach(function (j) {
      var m = j.match(/^\s*([A-Za-z0-9]+)\s*:\s*([AB])\b/i);
      if (m) (m[2].toUpperCase() === 'A' ? A : B).push(m[1]);
    });
    if ((A.indexOf(a) >= 0 && B.indexOf(b) >= 0) || (B.indexOf(a) >= 0 && A.indexOf(b) >= 0)) hit = { row: r, id: String(W.get(r, 'War ID') || '') };
  });
  return hit;
};

// ---------- Contact between nations, lane reach, standing effects ----------
/** Lane distances from a set of systems, breadth-first over the Lanes tab (no limit). */
tpWorld_.prototype.lanesFrom = function (sources) {
  var adj = this.adj, dist = {}, q = [];
  sources.forEach(function (s) { if (dist[s] === undefined) { dist[s] = 0; q.push(s); } });
  while (q.length) {
    var u = q.shift();
    (adj[u] || []).forEach(function (v) { if (dist[v] === undefined) { dist[v] = dist[u] + 1; q.push(v); } });
  }
  return dist;
};
/** Nation IDs named in a cell such as "KRT, MRC" or "Kharos and Tessaly". */
tpWorld_.prototype.nationIds = function (text) {
  var self = this;
  return String(text || '').split(/\s*(?:[,;&\/]|\band\b)\s*/i).map(function (x) { var n = x.trim() ? self.nationByName(x.trim()) : null; return n ? n.id : ''; })
    .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
};
/** Nation IDs mentioned anywhere in a line, in the order written. Names and short names match in any
 *  case; IDs only as written (upper case), so a short ID never matches an ordinary word. */
tpWorld_.prototype.nationMentions = function (text) {
  var self = this, raw = ' ' + String(text || '') + ' ', t = ' ' + tpNorm_(text) + ' ', hits = [];
  function look(hay, needle, id) {
    var mm = hay.match(new RegExp('[^A-Za-z0-9]' + tpEscapeRe_(needle) + '(?=[^A-Za-z0-9])'));
    if (mm) hits.push({ id: id, at: mm.index });
  }
  this.nations.forEach(function (n) {
    if (n.name) look(t, tpNorm_(n.name), n.id);
    if (n.id && n.id.length >= 2) look(raw, n.id, n.id);
  });
  Object.keys(this.shortNames).forEach(function (k) { if (k.length >= 3) look(t, k, self.shortNames[k]); });
  hits.sort(function (a, b) { return a.at - b.at; });
  return hits.map(function (h) { return h.id; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
};
function tpPairKey_(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
function tpTryTab_(model, name) {
  try {
    if (!TURN_CONFIG.NEW_TABS[name] && model.ss && model.ss.getSheetByName && !model.ss.getSheetByName(name)) return null;
    return model.tab(name);
  } catch (e) { return null; }
}
/** Contact on record (rules, First Contact: once made it holds for both). Read from the Turn log
 *  (First contact, Treaty, Trade), the Treaties tab, the Debts tab and Events of Kind First contact. */
tpWorld_.prototype.contacts = function () {
  if (this._contacts) return this._contacts;
  var self = this, out = {};
  function pairAll(ids, how, turn) {
    for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
      var k = tpPairKey_(ids[i], ids[j]);
      if (!out[k]) out[k] = { how: how, turn: turn };
    }
  }
  var TL = tpTryTab_(this.model, 'Turn log');
  if (TL) TL.rows().forEach(function (r) {
    var ev = String(TL.get(r, 'Event') || '').trim();
    if (!/^(?:first contact|treaty|trade)$/i.test(ev)) return;
    pairAll(self.nationIds(TL.get(r, 'Nations')), 'Turn log: ' + ev + ', Turn ' + TL.get(r, 'Turn'), tpNum_(TL.get(r, 'Turn')));
  });
  var T = tpTryTab_(this.model, 'Treaties');
  if (T) T.rows().forEach(function (r) {
    var ids = self.nationIds([T.get(r, 'Party 1'), T.get(r, 'Party 2'), T.get(r, 'Parties'), T.get(r, 'Fee payer'), T.get(r, 'Fee payee')].join(', '));
    pairAll(ids, 'treaty ' + (T.get(r, 'Treaty ID') || 'on record'), 0);
  });
  var D = tpTryTab_(this.model, 'Debts');
  if (D) D.rows().forEach(function (r) { pairAll(self.nationIds([D.get(r, 'Debtor'), D.get(r, 'Creditor')].join(', ')), 'debt ' + (D.get(r, 'Debt ID') || 'on record'), 0); });
  var E = tpTryTab_(this.model, 'Events');
  if (E) E.rows().forEach(function (r) {
    if (tpNorm_(E.get(r, 'Kind')) !== 'first contact') return;
    // One row per side ("KRT", "First contact with Saint Oren"): the other nation is named in the title.
    var ids = self.nationIds(E.get(r, 'Nations')).concat(self.nationMentions(String(E.get(r, 'Title') || '') + ' ' + String(E.get(r, 'Text') || '')))
      .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    pairAll(ids, 'Events: First contact, Turn ' + E.get(r, 'Turn'), tpNum_(E.get(r, 'Turn')));
  });
  this._contacts = out;
  return out;
};
/** Trade slots of a nation: slots and agreements in use from Calculations, plus any accepted earlier this turn. */
function tpTradeSlots_(world, nid, sim) {
  var c = (world.calc && world.calc(nid)) || {};
  var slots = tpNum_(c['Trade slots']), used = tpNum_(c['Trade agreements']) + ((sim && sim.tradeTaken) || 0);
  return { slots: slots, used: used, free: slots - used };
}
tpWorld_.prototype.contactWith = function (a, b) { return this.contacts()[tpPairKey_(a, b)] || null; };
tpWorld_.prototype.addContact = function (a, b, turn) { this.contacts()[tpPairKey_(a, b)] = { how: 'First contact, Turn ' + turn, turn: turn, made: true }; };
/** Not contact, but a sign of it: b holds a system that a holds beside, or has discovered. Used to send
 *  a line to the GM rather than reject it. */
tpWorld_.prototype.neighbouring = function (a, b) {
  var self = this, own = {}, why = '';
  this.systems.forEach(function (s) { if (s.get('Owner') === a) own[s.id] = true; });
  this.systems.forEach(function (s) {
    if (why || s.get('Owner') !== b) return;
    var disc = String(s.get('Discovered by') || '').split(/\s*[,;]\s*/).indexOf(a) >= 0;
    var beside = (self.adj[s.id] || []).some(function (x) { return own[x]; });
    if (disc || beside) why = self.label(s.id) + ', held by ' + b + ', is ' + (beside ? 'next to ' + a + '\'s space' : 'charted by ' + a);
  });
  return why;
};
/** Active Standing effects rows of a nation that pass test({ r, res, amt, reason, source }). */
tpWorld_.prototype.standingRows = function (nid, test) {
  var T = tpTryTab_(this.model, 'Standing effects'), out = [], turn = this.turnNo || 0;
  if (!T) return out;
  T.rows().forEach(function (r) {
    if (String(T.get(r, 'Nation')).trim() !== nid || !/^y/i.test(String(T.get(r, 'Active')))) return;
    var until = T.get(r, 'Until turn');
    if (until !== '' && turn && turn > tpNum_(until)) return;
    var o = { r: r, res: String(T.get(r, 'Resource')).trim(), amt: tpNum_(T.get(r, 'Amount per turn')), reason: String(T.get(r, 'Reason') || ''), source: String(T.get(r, 'Source') || '') };
    if (!test || test(o)) out.push(o);
  });
  return out;
};
/** The turn of a Stability purchase paid in Marks within the last two turns, or 0 (a second within 3 turns costs double). */
tpWorld_.prototype.recentMarksStability = function (nid) {
  var L = this.ledgerTab, turn = this.turnNo || 0, hit = 0;
  if (!turn) return 0;
  L.rows().forEach(function (r) {
    var t = tpNum_(L.get(r, 'Turn'));
    if (t < turn - 2 || t >= turn || L.get(r, 'Nation') !== nid || L.get(r, 'Resource') !== TURN_CONFIG.MARKS) return;
    if (/^STABILITY\b/.test(String(L.get(r, 'Reason') || '')) && tpNum_(L.get(r, 'Amount')) < 0) hit = Math.max(hit, t);
  });
  return hit;
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
    var share = i === src.length - 1 ? tpRound3_(amount - taken) : tpRound3_(amount * x[1] / total);
    taken = tpRound3_(taken + share);
    var np = tpRound3_(x[1] - share);
    Wt.set(x[0], 'Population (bn)', np);
    parts.push(Wt.get(x[0], 'World') + ' ' + x[1] + ' -> ' + np);
  });
  var dest = this.worldRows(toSys).filter(function (r) { return String(Wt.get(r, 'Habitable')) === 'Yes'; })[0];
  var S = this.sys(toSys);
  if (dest) {
    Wt.set(dest, 'Population (bn)', tpRound3_(tpNum_(Wt.get(dest, 'Population (bn)')) + amount));
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
  var mine = this.forceList().filter(function (f) { return f.owner === nid; });
  function match(t) { t = tpNorm_(t); return t ? mine.filter(function (f) { return tpNorm_(f.id) === t || tpNorm_(f.name) === t; })[0] : null; }
  var hit = match(text);
  if (hit) return hit;
  // "KRT-F4 (New squadron, 25 Escorts)" or "Home Fleet (10 Escorts)": the ID at the front, or the name before the remark.
  var raw = String(text || '');
  var id = raw.match(/^\s*([A-Z]{2,4}-[A-Z]\d+)\b/);
  if (id && (hit = match(id[1]))) return hit;
  var bare = raw.replace(/\s*\(.*$/, '').trim();
  if (bare !== raw.trim() && (hit = match(bare))) return hit;
  return null;
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
/** Disbands ships, smallest first, until the fleets' fuel fits the Energy held. */
tpWorld_.prototype.disbandFor = function (nid, energy, militia) {
  var F = this.forcesTab, self = this;
  var forces = this.forceList().filter(function (f) { return f.owner === nid; });
  var U = forces.reduce(function (t, f) { return t + tpNum_(F.get(f.row, 'Escorts')) + 2.5 * tpNum_(F.get(f.row, 'Cruisers')) + 4.5 * tpNum_(F.get(f.row, 'Battleships')) + 10 * tpNum_(F.get(f.row, 'Dreadnoughts')); }, 0);
  var W = forces.reduce(function (t, f) { return t + f.groundPower; }, 0);
  function upkeep() { return Math.ceil(U / 4); }   // fuel only; ground formations burn no fuel
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
  if (phase === 'prepare') { stock = this.projectedStock(n.id); stock[TURN_CONFIG.MARKS] = tpRound2_(this.stock(n.id, TURN_CONFIG.MARKS) + (stock[TURN_CONFIG.MARKS] || 0)); }
  else {
    stock = {};
    var w = this;
    // In resolution the stock is read live from the Ledger as it stands.
    TURN_CONFIG.RESOURCES.concat(TURN_CONFIG.STRATEGIC, [TURN_CONFIG.MARKS]).forEach(function (r) {
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
    dismantled: {}, remediated: {}, colonyCount: 0, contacted: {}, stipend: false, charters: 0, targetBonus: 0,
    ownsActive: function (sid) { var s = self.sys(sid); return !!(owned[sid] && s && !String(s.get('Status') || '').trim()); },
    devOf: function (sid) { return tpNum_(self.sys(sid).get('Development')); },
    desigOf: function (sid) { return this.desigNow[sid] || String(self.sys(sid).get('Designation') || '').trim(); },
    hasCivic: function (cv) { return this.civics.indexOf(cv) >= 0; },
    buildingsOf: function (sid) {
      var b = String(self.sys(sid).get('Buildings') || '').split(/\s*,\s*/).filter(function (x) { return x; });
      // Buildings dismantled earlier in these orders are gone (their slots are free).
      (this.dismantled[sid] || []).forEach(function (d) { var i = b.indexOf(d); if (i >= 0) b.splice(i, 1); });
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
function tpRound3_(x) { return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 1000) / 1000; }
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
  // Accepts "X @ Y", "X at/in/on Y" and "X: Y". '@' wins where present; otherwise the
  // last at/in/on, so "Extractor on Living compounds at C-11" splits at "at".
  var t = String(args).replace(/^\s*:\s*/, '').trim();
  var m = t.match(/^(.*)@\s*(.+)$/) || t.match(/^(.*)\s(?:at|in|on)\s+(.+)$/i) || t.match(/^(.*?)\s*:\s*(.+)$/);
  return m && m[1].trim() ? { what: m[1].trim().replace(/[:,]\s*$/, ''), where: m[2].trim() } : null;
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
