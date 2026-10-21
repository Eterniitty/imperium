# Human ships

Twelve ship classes, all **built in your colonies** (see [Economy](/wiki/economia#build-queue)). Each one appears as a **new fleet** in the system of the colony that built it; its upkeep is paid by your [capital](/wiki/colonias#the-capital). On top of that there is your own ship, the Emperor's ([Flying](/wiki/pilotar)), which is not built.

## Catalogue

{{tabla:naves}}

\* The Colonizer is consumed when it founds a colony. In the *Humans* column: colonists (Colonizer) or passenger berths (Freighter, Heavy freighter, Troopship).

| Role | Ships | What for |
|---|---|---|
| **Exploration** | Explorer | The fastest, with the biggest scanner: it leads the way and [discovers](/wiki/niebla) systems. |
| **Fighters** | Light fighter, Interceptor | Cheap and fast. The interceptor is the fastest warship: it catches convoys en route and escapes what it cannot beat. |
| **Escort** | Corvette | Rapid-fire flak cannons: many small shots against fighters and swarms. |
| **Line** | Frigate, Destroyer | The frigate does everything; the destroyer carries heavy turrets and torpedoes. |
| **Capital** | Cruiser, Carrier | The most expensive: they need an **orbital drydock**. The carrier carries wings of embarked fighters. |
| **Logistics** | Freighter, Heavy freighter | Hold for resources and berths for passengers; slow and fragile, they need escorts. |
| **Transport** | Troopship | Armoured hull and 600 berths: it moves population and will carry assault troops. |
| **Colonization** | Colonizer | Carries colonists to found a colony and is dismantled doing so. |

## What you need to build them

- Every ship needs a **shipyard** in the colony.
- The heavy ones (destroyer, heavy freighter, troopship) also need a **refinery** and cost **alloys**.
- Capital ships (cruiser, carrier) also need an **orbital drydock**, a new installation that can only be built where there is already a shipyard.

If something is missing, the ship's button is greyed out and says what it needs ("Requires: …").

## In battle

{{tabla:naves-combate}}

In [round-based fleet combat](/wiki/guerra), attack, shots per round, battle shield, target size and hull count:

- **Shots per round**: the attack is split between them and each shot picks its own target. Many small shots are not wasted on nearly destroyed ships (good against fighter swarms), but every shield absorbs its share: against shielded ships they do little.
- **Target size**: the chance that an enemy shot picks a ship is proportional to its size. Big ships draw fire and protect the small ones.

### Balance

With the same budget (checked by automated tests):

- **corvettes** sweep **fighters** away but lose to **frigates** and **destroyers**;
- a swarm of **fighters** overwhelms a lone ship's shield (especially an unescorted carrier);
- the **interceptor** pays for its speed: it loses to the frigate;
- no class wins or loses almost always against all others: **mix** them.

## Models

Every ship has its own 3D model, generated in code from its data (length, hull shape, engines, wings, turrets, containers, hangar). Cannons and launchers sit on its **hardpoints**, the same ones the server fires from. Your parked fleets are shown in formation in the system view, next to your colony.

{{tabla:naves-modelos}}

*Weapons*: cannon muzzles + missile launchers.
