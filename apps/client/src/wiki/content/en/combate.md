# Real-time combat

Inside a system you fight in real time, at the controls. The **server is the authority**: it checks every shot (fire rate, ammunition, range) and works out the hits; your browser only sends orders and draws.

## Weapons

- **Cannon** ([[F]], hold): rapid bursts towards where the nose points, with unlimited ammunition. It hits the first enemy the projectile grazes (within about 30 m of its centre).
- **Missile** ([[R]]): heavy damage, and it **follows its target** inside the system. It needs a **locked target** ([[X]] locks the nearest enemy and, pressed again, the next one) that is **in range** and **ahead of the nose** (within 60°). Ammunition is limited and refills over time.
- You cannot fire with the **pulse drive** on.

{{tabla:armas}}

## Shields and hull

Damage goes first to the **shield** and, once it is depleted, to the **hull**. The shield **recharges by itself** after a few seconds without being hit; the hull does not. If the hull reaches 0, the ship is destroyed.

Your ship's combat state persists even if you leave the system: you do not heal by leaving and coming back.

## The Emperor's ship

{{tabla:nave-emperador}}

## If you are shot down

Your ship explodes, leaves the system and **you are reborn in a random system of the Human Core** with the ship repaired: hull, shield and ammunition full. You do not lose colonies, fleets or discoveries (see [Law I](/wiki/leyes#i-persistence)).

> [!dev] Death with consequences (Lineage Cradles, gestation and Heirs) will arrive with the "Death and lineage" phase.

## Against other Emperors

**PvP is open** across the whole universe, with no protection for offline players. You can damage any Emperor flying in your system **except your companions** (players who have added each other; see [Companions](/wiki/companeros)), who are marked as "companion".

## Scavengers

**Scavengers** are AI pirates (all about them in [Scavengers](/wiki/carroneros)). **There are none in the Human Core**; outside it, in some systems, prowling around one of the planets: **more and heavier the farther you go** (skiffs and raiders near the Core; harpooners, bombers, breakers and motherships in the deep zones).

- They spot you and give chase when you get close; each class keeps its own distance (harpooners close in, bombers fire missiles from afar) and fires from its hardpoints, with imperfect aim (they miss more from far away).
- Big ships are easier to hit.
- A downed Scavenger reappears after a while. With no players in the system, pirates do not move.

> [!dev] **Escorts** (up to about 5 ships per side fighting alongside your ship in real time) and switching large encounters to round-based combat (phase 9c) are still to come. Today, fleet battles are resolved separately, in rounds: see [War](/wiki/guerra).
