# The economy in detail

Each colony has its **own inventory**: there is no global store. What a colony produces stays there until a fleet [carries it away](/wiki/flotas). Every figure on this page is read from the game's code.

## Resources

| Resource | What it is for |
|---|---|
| **Metal** | The basis of almost every construction. Plentiful. |
| **Volatiles** | Fuel and upkeep for ships and installations. |
| **Rare crystal** | Scarce; the shipyard and almost every ship need it. |
| **Alloys** | Made in the refinery from metal and volatiles. |
| **Rare metals** | No colony produces them: they are mined in [deep space](/wiki/espacio-profundo) or bought on the market. Capital ships need them. |
| **Exotic matter** | Very scarce; only in some deep space asteroids (or on the market). |
| **Energy** | Produced and used in the colony itself; **it is neither stored nor transported**. |

Each storable resource has a **storage cap** per colony. **Whatever does not fit is lost**, so spend it or ship it out in freighters.

{{tabla:recursos}}

## How production is calculated

The economy is resolved **lazily**: the server stores each colony's stock and population at a given moment and, whenever needed (when you look at it, build, load…), works out the current state from the elapsed time, in steps of at most one hour. That is why your colony keeps producing while you are offline, and the panel's figures tick up by themselves.

### Richness

Each planet has a **richness** from 0 to 3 in metal, volatiles and crystal (see [Universe](/wiki/universo#planets-moons-and-belts)). **Half of its moons' richness** is added to the planet's.

### Extraction

For each richness point, a colony extracts every hour:

`(base extraction + extraction per mine × mines × energy efficiency) × labour`

**Crystal** is extracted at a quarter of that rate. Mines boost metal, volatiles and crystal at the same time.

{{tabla:produccion}}

Extraction per richness point by number of mines (with enough energy and a population of 500 or more):

{{tabla:minas}}

### Energy

- A colony collects energy from its star: `stellar energy × (2 + 4 × power plants)`. Each system's stellar energy (0–5) is shown in the system panel.
- Installations **use** energy (see the installations table). If they use more than there is, **they all slow down in the same proportion** (efficiency = produced / used). Base extraction, the part that does not depend on mines, needs no energy.
- With stellar energy 0 (some black holes) nothing is collected and, without energy, mines add nothing and the refinery does not work.

### Labour

Output grows with population up to 1 at **500 inhabitants**: `population / 500`, with a minimum of 25 % (automation). It affects extraction and the refinery.

### Refinery

Each refinery turns metal and volatiles into alloys every hour (at full output; multiplied by energy efficiency and labour). If it runs out of metal or volatiles in storage, it works at the rate they come in; with the alloys store full, it stops.

## Installations

They are built in the colony (*Build installation* section). Each one has a per-colony maximum.

{{tabla:instalaciones}}

## Upkeep

- Each installation uses **volatiles per hour** from its colony for as long as it exists.
- Your **capital** (your oldest colony) also pays the **upkeep of all your ships** (see the ships table in [Fleets](/wiki/flotas#ships)).
- Upkeep is paid **before** the refinery. If the volatiles store is empty and the colony extracts less than it owes, it shows as **"Undersupplied"**: it pays what it can, the refinery stops and volatiles do not go up. An overstretched empire bleeds out.

## Example

A colony on a planet with richness 2 in metal, 1 in volatiles and 1 in crystal, with a moon of richness 1 in metal and 2 in volatiles, around a star with energy 3, with 500 inhabitants, **2 mines, 1 refinery and 1 power plant** (and stores half full):

{{tabla:ejemplo}}

## Build queue

- Installations and ships are **ordered** in the colony and go into a **queue** (at most 5 orders, including the one under way).
- **You pay when ordering**, with the stock at that moment. Without enough resources, you cannot order.
- Only **one is built at a time**, the first in the queue; when it finishes, the next one starts.
- **Ships** need a **shipyard** in the colony. Each finished ship appears as a **new fleet** in the colony's system. When a colonizer is finished, colonists from the colony board it (see [Humans](/wiki/humanos#moving-humans)).
- **Cancelling** an order: if it had not started, you get **everything** back; if it was already under construction, **half**, and the next one starts.

Ship costs and build times are in [Fleets](/wiki/flotas#ships).

## Resource ledger

Every discrete movement of resources or humans is recorded in an **insert-only ledger** that nobody can modify or delete: foundations, orders, cancellations, colonists boarding or landing, fleet loading and unloading, battle losses, colonies becoming independent and, with the [economy of humanity](/wiki/humanidad), credits, contributions and [market](/wiki/mercado) trades. Continuous production is not recorded (that is the lazy calculation). It is used to audit and rebuild balances, and it is included in your [data download](/wiki/cuenta).

Above the colonies there is the [economy of all humanity](/wiki/humanidad): colonies generate **credits** according to their population, part of them goes to the Human Core treasury and pays for common projects. Credits buy and sell resources on the [global market](/wiki/mercado).

> [!dev] The **supply network** (isolated installations that weaken) is planned for later.
