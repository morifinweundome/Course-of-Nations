# Material effects

The turn script (`engine/Turn Processor.gs`) applies the effects of advanced materials and synthesis
buildings from a GM-only tab, **Material effects**, read at every Prepare and Resolve. The script names
no material, recipe or building and holds no effect number: it knows only the generic effect keywords
below. Which item does what, and by how much, lives on the tab alone.

The tab is created with its headers when missing (it is in `TURN_CONFIG.NEW_TABS`). While it is empty,
nothing in this document happens and turns resolve exactly as before.

Keep the tab out of every player feed. It is not read by `PlayerSheets.gs`.

## Columns

One effect per row. An item may have several rows (for instance an upkeep row and a yield row).

| Column | Meaning |
|---|---|
| **Item** | The material, building or fiscal instrument, as it is written in the game (Systems "Buildings", Ledger resource names, the Recipes tab, the Fiscal tab). Matched without regard to case, accents or extra spaces; a trailing "s" and a trailing "(...)" are tolerated. |
| **Applies** | `Building`, `Use`, `Fitting`, `Holding` or `Fiscal` (a trailing "s" is ignored). Says when the row acts: each turn for a standing building, on a USE order, on a ship built FITTED with it, each turn for stocks held, or for a fiscal line. |
| **Effect** | The effect keyword (below). Spaces or hyphens are read as underscores. A keyword the script does not know is ignored on Building, Fitting, Holding and Fiscal rows (write `manual` for effects the GM applies by hand); on a Use row it sends every USE of that item to a ruling. |
| **Resource** | The resource the effect touches, written as on the Ledger: Industry, Energy, Research, Influence, a strategic resource, Stellar Marks, Stability, Infamy, Degradation, a material, or any other name for a record-only line. |
| **Value** | The effect's number. Its unit depends on the keyword (an amount, a fraction, or a percentage); each keyword states it. |
| **Units** | Units of the material one application takes (Use rows) or one ship takes (Fitting rows). Blank = 1. Where an item has several rows, the largest Units is used. |
| **Per** | A qualifier: `Development` (multiply by the system's Development), `System`, `Building`, `Turn`, `World`, `<n> ships`, or a fiscal intensity. Each keyword states which it reads. |
| **Cap** | A ceiling, where the keyword reads one. Blank = none. |
| **Ship classes** | Fitting rows: the ship categories the fitting may go on, e.g. `Battleship, Dreadnought` (singular or plural). The union over the item's rows limits where it may be fitted; a row's own classes also limit where that row acts. Blank on every row = any class. |
| **Input** | `convert` rows: what one step consumes, e.g. `5 Energy` (several as `5 Energy; 1 Antimatter`). |
| **Requires** | Use rows: a building that must stand (complete, not ordered) in the named system, e.g. `Research Institute`. |
| **Notes** | Free text for the GM. For `system_record` it is the instruction written into the ruling the script raises. |

## Building rows (each turn at Resolve)

A building acts in a system held by a nation that is not eliminated, with a blank Systems "Status",
for each copy listed in Systems "Buildings". The new phase **Building effects** runs after Standing
effects and before Synthesis.

| Effect | Reads | What happens |
|---|---|---|
| `upkeep` | Resource, Value, Per | Charges Value (x Development when Per is `Development`) of Resource as an Upkeep line, reason `<Building> at <system>`. If the nation cannot pay every upkeep row of the building from what it holds, nothing is charged and the building is **dark** this turn: none of its rows act (a public Turn log line names it). |
| `yield_mult` | Resource, Value | Income line: Value x the system's own output of Resource, read from the Systems column named after the resource (e.g. Systems "Research"). Value 2 = +200%. |
| `yield_add` | Resource, Value, Per | Income line of Value (x Development when Per is `Development`). |
| `convert` | Resource, Value, Input, Per | Steps = Development when Per is `Development`, else 1. Each step consumes Input (Upkeep lines) and yields Value of Resource (Income line). Only whole steps the nation can pay for are taken; none, and a Turn log line says so. |
| `strain_capacity` | Value | In the World toll, the system bears Value more Strain before Degradation accrues (see "Degradation" below). |
| `heal` | Value | In the World toll, while the system's Strain is within its Capacity plus any `strain_capacity`, it recovers Value Degradation a turn on any environment. |
| `unlimited_containment` | | Every dangerous stock of the building's owner is contained (Holding rows). |
| `thinking` | Value | Adds Value percentage points to the owner's Thinking Machines chance for each lit building standing. |
| `manual` (or any other word) | | Ignored by the script; adjudicated by hand (battle, covert, storage effects). |

All lines are written with Shown to player = Yes.

### Degradation (World toll)

Degradation accrual and recovery come from the Systems formulas ("Change this turn", read at the start
of the resolution). The script does not change those formulas; a lit building with `strain_capacity` or
`heal` adds one compensating Degradation line under the system's ID (phase World toll, reason
`<Building> at <system>`), after the ordinary toll line:

* Raised capacity = Systems "Capacity" + the sum of `strain_capacity` values. Systems "Strain" is read at
  the start of the resolution.
* If "Change this turn" is an accrual (positive): when Strain is within the raised capacity the whole
  accrual is cancelled; otherwise up to `strain_capacity` of it is cancelled (assumes the sheet accrues
  1 Degradation per point of Strain over Capacity).
* If Strain is within the raised capacity, recovery is brought up to the `heal` value: the line adds
  `heal` less any recovery the sheet already gave this turn.
* The line never takes the system's Degradation below 0 (Systems "Degradation" at the start of the
  resolution plus this turn's Ledger lines for the system).
* The +0.5 for an overcrowded world is left as it is.

If Systems has no "Strain" or "Capacity" column, the effect is skipped with a Turn log line.

## Use rows (USE orders)

Order text: `USE <n> <material> [@ <system or world>]: <purpose>`. The `@` part is optional; without
it a system ID written in the purpose (e.g. `... at C-04`) is used. The older builder text
`USE <n> <material>: <purpose>` is still read.

* **Prepare** checks the order, prices the material (Actions "Strategic", charged at Resolve from the
  Ledger like any strategic cost) and refuses what the rows forbid. `n` must be a whole multiple of
  Units; applications = n / Units.
* **Resolve** charges the material in Spending and applies each row of the item.
* An item with **no Use row**, or with a Use row whose keyword is not one below, stays a ruling as
  before: approving it charges nothing; the GM charges and applies it by hand.
* A system-bound row needs a system the nation holds (not occupied). If Requires is set, that building
  must stand there.

| Effect | Reads | What happens |
|---|---|---|
| `standing_add` | Resource, Value, Units, Per, Cap, Requires | Writes one Standing effects row per application: Nation, Resource, Amount per turn = Value, From turn = next turn, Source `Material effects`, Reason `<Material> at <system>`; it then pays every turn through the Standing effects phase. **Cap**: the total Value a turn from this item in one system (existing rows plus this turn's orders) may not exceed Cap. **Per `Building`** with Requires: at most one application per such building standing in the system. |
| `develop_discount` | Value (percent), Units | One lot per Development rise. The nation must order a DEVELOP of the named system earlier in the same orders (the order builder sends USE lines last). The rise's Industry cost is recomputed with Value percentage points more discount, within the -50% floor; the difference is returned as a negative Industry cost on the USE line. |
| `system_ledger` | Resource, Value, Units, Per | Writes a Ledger line of Value of Resource under the system's ID (as Degradation is kept). Per `Turn` (or blank): once per system a turn. Per `System` or `World`: once per system ever (checked on the Ledger). A Degradation removal never takes the system below 0 and is refused at Prepare when the system has none. One lot per order. |
| `system_record` | Resource, Value, Units, Per, Notes | As `system_ledger`, and raises a Rulings row for the next turn telling the GM to apply the effect by hand, with Notes as the instruction. For effects the sheet cannot yet read (e.g. a workforce change): the Ledger line is a durable record a Systems formula may later SUMIFS. |
| `gain` | Resource, Value, Units | Income line of Value x applications to the nation. No system needed. |

## Holding rows (each turn at Resolve)

The new phase **Holdings** runs after Synthesis. Stocks are each nation's Ledger totals, in whole units.

| Effect | Reads | What happens |
|---|---|---|
| `danger` | Value (percent) | A dangerous material: Value % a turn chance of an incident while any of it is uncontained. Several rows for one material: the highest is used. |
| `containment` | Value | Each unit held contains Value units of dangerous material. Containment is given to the most dangerous materials first. |
| `thinking` | Value | Adds Value percentage points to the Thinking Machines chance per unit held. |

**Danger roll.** For each dangerous material with an uncontained amount, the script rolls once (a
private Turn log line in phase Holdings with the roll in the Roll column). On an incident it raises a
Rulings row for the **next** turn (Source `Danger: <material>`, Item `Material incident: <nation>,
<amount> uncontained <material>`). Nothing is applied. Because the row is dated next turn, the next
Resolve waits for the GM's decision on it. A nation with a lit `unlimited_containment` building has
all its stocks contained and does not roll.

**Thinking Machines roll.** Only a nation with a matching fiscal line rolls (see Fiscal rows). Chance =
the fiscal value + every `thinking` Holding row (per unit held) + every lit `thinking` building, at most
100. Each roll is logged privately with its chance; an event raises a Rulings row for the next turn
(Source `Thinking Machines`, Item `Thinking Machines event: <nation>, chance X%`). Nothing is applied.
The chance appears only on the Rulings and Turn log tabs, never in a player feed.

**Dice.** Rolls use the same linear congruential generator as the Exchange's order shuffle, seeded by
the turn and a key (nation and material), so a rerun of the same turn after restoring its snapshot rolls
the same.

## Fiscal rows

| Effect | Reads | What happens |
|---|---|---|
| `thinking` | Item = the instrument, Per = the intensity, Value (percent) | The base Thinking Machines chance of a nation whose Fiscal tab has a row with Nation ID, Instrument = Item and Intensity = Per. Blank Per matches any intensity. Several matches: the highest. |

## Fitting rows (ships)

Order text: `SHIP <category> x<n> @ <system> FITTED <material>[, <material> ...]` (also accepted:
`FITTED WITH`, `and`, `+`, and `FITTED ... @ <system>`). Each fitting is charged Units x n from the
Ledger with the ship's cost. A fitting with no Fitting row is a ruling; one on a class outside its Ship
classes is refused.

New ships record their fittings on Forces **Fittings** as `<fitting> x<ships> (<class>s)`, joined by
`; `, e.g. `Item A x2 (Battleships); Item B x4 (Escorts)`. Ships merging into a squadron add to the
count for the same fitting and class. The column, and **Fitted Fleet Power**, are added at the right of
Forces the first time a fitted ship is recorded (in a dry run they are previewed only). Two-turn ships
carry their fittings in Works in progress (`1 Dreadnought fitted A, B`).

A fitting counts on at most as many ships of its class as the force still has; one recorded without a
class is taken as on the force's average ship. When the GM splits or merges forces by hand, move the
Fittings text with the ships.

| Effect | Reads | What happens |
|---|---|---|
| `cost_cut` | Resource, Value, Ship classes | Each fitted ship of a listed class costs Value less of Resource: Industry off the final ship cost, a strategic resource off the ship's strategic cost (never below 0). |
| `capacity_mult` | Value (fraction) | Each fitted ship takes (1 + Value) of its class capacity: the SHIP order's capacity is reduced, and every Military Capacity check (SHIP, GROUND) subtracts what existing fitted ships save from Calculations "Ship capacity used". Value -0.2 = -20%. |
| `fuel_mult` | Value (fraction) | After Upkeep, each force with such fittings is refunded the fuel its fitted ships did not burn: ceil(capacity / 4) - ceil((capacity - saved) / 4) Energy, where saved = -Value x fitted ships x class capacity (warships only, as the fuel rule counts them). Value -0.5 = half fuel. |
| `fp_mult` | Value (fraction) | Fitted Fleet Power + Value x the class's Fleet Power, per fitted ship. Value 2 = +200%. |
| `fp_add` | Value | Fitted Fleet Power + Value per fitted ship. |
| `fp_per_n` | Value, Per (`<n> ships`) | Fitted Fleet Power + Value for every n fitted ships of the force (rounded down). |
| `range_pct` | Value (percent) | When **every** ship of the force (warships and Transports) carries it, MOVE's jump range + Value % of the nation's technological range, rounded down. |
| `double_move` | | When every ship carries it, the force may move twice a turn (two MOVE lines; the second starts where the first ends). |
| `flag` | | MOVE lines of a force carrying it say so in the Actions Flag and in a contested move's ruling text: `carries <fitting> (k of n ships)`. Its effect is adjudicated by hand. |
| `manual` (or any other word) | | Ignored. |

**Fitted Fleet Power** is recomputed each turn after Completions for every force with Fittings: the base
is the sum of ships x T_SHIPS Fleet Power, plus the fp_* effects above. Battle effects stay manual.

## Things the GM checks by hand

* Strain added by a hidden building comes from the sheet (Unlocks "Strain" and the Systems Strain
  formula); the script does not compute Strain.
* Standing effects rows written by a USE belong to the nation, not the system: if the system is lost,
  set its rows inactive.
* `system_record` rulings say exactly what to apply.
