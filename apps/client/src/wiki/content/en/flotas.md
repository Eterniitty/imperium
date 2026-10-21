# Fleets and logistics

## Fleets

Your ships (except yours, the Emperor's) are grouped into **fleets** ("Fleet 1", "Fleet 2"…). You start with one fleet holding an Explorer, and **every ship you build appears as a new fleet** in the system of the colony that built it. The **Your fleets** panel shows where each one is, or where it is heading and how long it has left.

> [!nota] Fleets are **only visible to their owner**. Other Emperors can only detect them in transit with their sensors (see [War](/wiki/guerra#contacts-and-interception)).

## Travelling

1. Select a star on the galaxy map.
2. In the system panel, press **Send Fleet N here**.

- The fleet travels at the **speed of its slowest ship** (light years per hour; see the table). It can be sent to any star, discovered or not.
- While travelling it cannot be given another travel order.
- On arrival, its best scanner [discovers](/wiki/niebla) the system and those nearby. If there are stopped fleets of another Emperor who is not your companion, a [battle](/wiki/guerra) may start.

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
