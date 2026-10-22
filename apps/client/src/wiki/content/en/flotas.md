# Fleets and logistics

## Fleets

Your ships (except yours, the Emperor's) are grouped into **fleets** ("Fleet 1", "Fleet 2"…). You start with one fleet holding an Explorer, and **every ship you build appears as a new fleet** in the system of the colony that built it. The **Your fleets** panel shows where each one is, or where it is heading and how long it has left.

> [!nota] Fleets are **only visible to their owner**. Other Emperors can only detect them in transit with their sensors (see [War](/wiki/guerra#contacts-and-interception)).

You can **rename** each fleet with the ✎ pencil on its row in the fleets panel (empty: back to "Fleet N").

And you can **gift** it to another player with 🎁 (type their Emperor's name): it must be stopped and out of battle; it becomes theirs where it is, without route or commander.

## Travelling

1. Select a star on the galaxy map.
2. In the system panel, press **Send Fleet N here**.

- The fleet travels at the **speed of its slowest ship** (light years per hour; see the table). It can be sent to any star, discovered or not.
- While travelling it cannot be given another travel order.
- On arrival, its best scanner [discovers](/wiki/niebla) the system and those nearby. If there are stopped fleets of another Emperor who is not your companion, a [battle](/wiki/guerra) may start.

When it arrives from a jump, the fleet **comes out at the edge of the system, on the side it comes from** (like your ship) and stays there; the server keeps its spot. Newly built ones appear at the rally point next to your colony.

## Fuel

Each ship carries its own **tank**, measured in **light years of range**. A trip spends the distance on **every ship**, and the fleet **does not leave** if any of them cannot make it. The fleet's range (⛽ in the fleet list, orange if any ship has less than a quarter left) is that of the ship with the least fuel.

- **Refuelling**: in a system with **one of your colonies**, the fleet **refuels by itself on arrival** with the colony's **volatiles** (the one that has most). You can also press **Refuel** in the fleet list. If there are not enough volatiles for all, the ships that can be paid for are filled.
- Big ships use more volatiles per light year.
- [Shipyard](/wiki/astillero) ships have the range of their tanks and quantum drive: **without a quantum drive they cannot travel between stars**.
- AI Emperors do not use fuel.

{{tabla:combustible}}

## Ships

They are built in a colony with a **shipyard** (see [Economy](/wiki/economia#build-queue)). The upkeep of all your ships is paid by your [capital](/wiki/colonias#the-capital), in volatiles per hour.

There are twelve classes (exploration, fighters, escorts, line ships, capital ships, freighters, troopship and colonizer): their cost, what they need in the colony, speed, hold and combat figures are in [Human ships](/wiki/naves). Your parked fleets are shown in formation in the system view.

## Hold and passengers

- A fleet's **hold** is the sum of its ships' holds and is shared by **all resources** (metal, volatiles, crystal and alloys together).
- **Passenger seats** are separate and only transport ships (Freighter, Heavy freighter and Troopship) have them.
- Energy cannot be transported.

## Loading and unloading

With a fleet **stopped** in a system where you have a colony, the fleet's **Logistics** panel lets you **load** resources and passengers from the colony and **unload** them.

- When loading passengers, the colony **always keeps 50 inhabitants**.
- When unloading, you cannot exceed the colony's **storage** or its planet's **population cap**.
- No loading or unloading in the middle of a battle.
- Every movement goes into the [resource ledger](/wiki/economia#resource-ledger).

## Automatic routes

A fleet can repeat a trip by itself between **two of your colonies in different systems**: choose the destination colony, **which resources to carry** (and in what order) and whether it carries **passengers**, and press **Start route**.

1. At the **origin**, it loads what you chose, in order, until the hold is full.
2. It travels to the **destination** and **unloads everything** that fits.
3. It **returns** to the origin and repeats, with nothing for you to do.

- The route stops with **Stop route**, when you give the fleet another travel order, or if either colony stops being yours.
- If the fleet ends up in combat, the route **waits** and resumes if it survives.

> [!dev] **Escorts** that accompany your ship in real time and the **supply network** are still to come.

## Mercenaries

With credits you can **hire mercenaries** in the system where your ship is (in the system panel, "Mercenaries" section). The company appears there as **one more of your fleets**: you can move it, send it to intercept, besiege or pilot it remotely. It costs no upkeep (the contract covers it), but it **leaves when the contract ends**; if it is fighting, when the battle is over. The fleet list shows how long it has left. You can have 2 contracts at a time.

{{tabla:mercenarios}}
