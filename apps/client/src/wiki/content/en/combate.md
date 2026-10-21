# Real-time combat

Inside a system you fight in real time, at the controls. The **server is the authority**: it checks every shot (fire rate, ammunition, range) and works out the hits; your browser only sends orders and draws.

## Weapons

- **Cannon** ([[F]] or **left click**, hold): rapid bursts, with unlimited ammunition. The cannons sit on **mounts that aim by themselves**: with a locked target they point at the **lead point** if it fits in their arc around the nose; otherwise they fire straight ahead. It hits **the first ship the projectile touches**, whichever it is (the server works out the trajectory against each ship's movement).
- **Missile** ([[R]], or left click with missiles selected): heavy damage, and it **follows its target** inside the system. It needs a **locked target** that is **in range** and **ahead of the nose** (within 60°). If another ship crosses its path, that ship takes the hit. Ammunition is limited and refills over time. On your ship, the cannons sit in the bow pods and missiles leave from the launchers at the bow of the two habitat modules, on the sides.
- **Mining laser** ([[L]], or left click with the laser selected): only in [deep space](/wiki/espacio-profundo), against asteroids.
- Without **engines** running ([[I]]) there are no weapons, and you cannot fire with the **pulse drive** on.

## Aim assist

Enemy ships are a few metres long and look like a dot: your ship helps you aim.

- **Markers**: every ship in the system has a marker even if you cannot see it, with its distance. Shape and colour tell who it is: **red diamond** = hostile (pirates), **amber square** = another Emperor, **cyan circle** = companion. The **locked target** gets a larger box with its name, shield and hull; if it is off screen, an **arrow** at the edge points to it.
- **Locking**: [[X]] locks the ship closest to the reticle (the cursor in mouse flight; otherwise the line of the nose). [[Y]] and [[U]]: next and previous (hostiles first, nearest to farthest; then other Emperors). [[V]]: the nearest. **Middle click** on a marker: lock that ship. Cycling **never locks companions**; middle click does (with a warning if your friendly fire is on).
- **Lead point**: a circle where you must shoot given the target's speed, yours and the projectile's. It turns **green** when the target is in range and inside the mounts' arc.
- **Automatic aiming**: with a locked target, the cannons aim at that point by themselves; you decide when to fire. Missiles already chase the target by themselves.
- **Auto-fire** ([[O]], also in Settings → Controls): the cannon fires by itself while the locked target is in range and in arc. It never fires by itself at a companion.
- **Mouse**: with engines on, **left click** fires the selected weapon and the **wheel** switches weapon ([[1]] cannon, [[2]] missiles, [[3]] laser). Camera distance moves to **Shift + wheel**, moving the camera to the **right button** (or Alt + drag), selecting a planet to **Alt + click** and autopilot by double click to **Alt + double click**. It can be turned off in Settings → Controls ("Mouse for combat"). All keys can be rebound.

{{tabla:punteria}}

{{tabla:armas}}

## Shields and hull

Damage goes first to the **shield** and, once it is depleted, to the **hull**. The shield **recharges by itself** after a few seconds without being hit; the hull does not. If the hull reaches 0, the ship is destroyed.

Your ship's combat state persists even if you leave the system: you do not heal by leaving and coming back.

## The Emperor's ship

{{tabla:nave-emperador}}

## If you are shot down

Your ship explodes, leaves the system and **your Emperor falls**. A new body is **gestated** in a [Lineage Cradle](/wiki/linaje) (or, if you have none, in the Human Core) for a time that grows with each death in a row. The humans aboard, fuel and ammunition are lost; you do not lose colonies, fleets or discoveries (see [Law I](/wiki/leyes#i-persistence)). Everything that happens when you die is in [Death and lineage](/wiki/linaje).

The hull **does not heal by leaving the system**: the crew repairs it slowly and, next to an own colony, it is repaired quickly with its alloys (see [Death and lineage](/wiki/linaje#the-hull)).

## Against other Emperors and friendly fire

**PvP is open** across the whole universe, with no protection for offline players: you can attack any Emperor flying in your system. **Friendly fire** is chosen in **Settings → Companions** and is **off by default**: your shots pass through your **companions** (see [Companions](/wiki/companeros)) and their escorts without harming them, and collisions between you do no damage (it is enough for one of you to have it off). If you turn it on, your shots damage any ship they touch, them too. Companions are marked as "companion" with a cyan circle. Your own ships (your ship and your escorts) never damage each other.

### Core Militia

In the **Human Core** systems the **Core Militia** patrols (AI human ships with good aim). It leaves everyone alone except whoever **attacks another human** there: for a while that Emperor (and their escorts) counts as an aggressor and the militia goes after them as a pack. If you destroy it, it comes back after a while. It also hunts any Scavenger that slips in.

{{tabla:milicia}}

## Collisions

Ships **collide** with each other: two ships that touch while closing in take damage according to the impact speed and bounce off.

Against the star, planets, moons and asteroids the ship stops at the surface and, if it arrives fast, **it is damaged too**: damage grows with the impact speed and has no cap, so crashing at full speed destroys the ship. Landing or grazing slowly does no damage. A hard hit shakes the camera (unless "reduce effects" is on). If the ship is lost this way, the cause of death is "crash".

{{tabla:choques}}

## Scavengers

**Scavengers** are AI pirates (all about them in [Scavengers](/wiki/carroneros)). **There are none in the Human Core**; outside it, in some systems, prowling around one of the planets: **more and heavier the farther you go** (skiffs and raiders near the Core; harpooners, bombers, breakers and motherships in the deep zones).

- They spot you and give chase when you get close; each class keeps its own distance (harpooners close in, bombers fire missiles from afar) and fires from its hardpoints, with imperfect aim (they miss more from far away).
- Big ships are easier to hit.
- A downed Scavenger reappears after a while. With no players in the system, pirates do not move.

> [!dev] **Escorts** (up to about 5 ships per side fighting alongside your ship in real time) and switching large encounters to round-based combat (phase 9c) are still to come. Today, fleet battles are resolved separately, in rounds: see [War](/wiki/guerra).
