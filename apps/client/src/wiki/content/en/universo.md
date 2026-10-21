# Universe, galaxy map and systems

## Sectors and stars

The universe is procedurally generated from a seed: the same sector always produces the same stars. It is divided into **cubic sectors 100 light years** across, each with 4 to 56 systems, and has no practical limits. Only what changes is stored (colonies, fleets, discoveries); everything else is regenerated.

The **Human Core** is the 27 sectors around the origin (−1 to 1 on each axis). New Emperors appear there and fallen ones are reborn there, and there are no pirates.

### Star classes

A star's class decides how many planets it usually has, how much **stellar energy** (0 to 5) its colonies collect and the chance of finding **crystal** on its bodies. The exact energy of each system varies by half a point around its class value.

{{tabla:estrellas}}

Exotic stars (white dwarfs, neutron stars and black holes) have few habitable worlds, but more crystal and more anomalies.

## Planets, moons and belts

Each planet has a **type**, a **habitability** (0 to 100 %) and **deposits** of metal, volatiles and crystal with a **richness** from 0 to 3. Planets can have moons (gas giants, several) with deposits of their own.

- Habitability depends on the type and on the distance to the star's habitable zone: **ocean worlds** in the habitable zone are the best (60–100 %), **rocky** ones in the zone 30–70 %, **desert** worlds 15–45 %; the rest barely reach 8 %. Around exotic stars, habitability is divided by five.
- **Crystal** can appear on any body with the chance shown in the star table, usually with richness 1.

{{tabla:depositos}}

**Asteroid belts** (up to two per system) are rich in metal, but they are not mined yet.

> [!dev] **Anomalies** (ruins of unknown origin, drifting wrecks, space rifts and nebular pockets) already appear in systems, but they cannot be explored yet.

## The galaxy map

Press [[M]] (or the **Map** button) to switch from flying to the map. You see nearby stars as dots coloured by class (the legend is on screen).

- **Click** a star to select it: the side panel shows its class, distance, coordinates and, if you have discovered it, its energy, planets, belts and anomaly. Click a planet to see its resources.
- **Double click** or [[Enter]] enters the system view. [[F]] centres the camera on the selection and [[Esc]] clears it.
- **Orbit** (default): drag to rotate, wheel to zoom, middle button or [[Shift]] + drag to pan.
- **Free camera flight** ([[V]]): move the camera like a ship with [[W]] [[A]] [[S]] [[D]], [[Q]]/[[E]] to go down and up and [[Shift]] to go faster.
- The **Go** field in the top bar takes the camera to the sector with those coordinates.

From the system panel you can **move your Emperor** there (or press [[J]]) and **send your fleets**. See [Flying](/wiki/pilotar#quantum-travel-to-another-star) and [Fleets](/wiki/flotas).

## Inside a system

Systems have a **game scale of their own**: plausible astronomical proportions, compressed so that the game is playable. Your ship is about **45 m** long; a rocky planet has a radius of **20 to 95 km** (hundreds or thousands of times the ship); a gas giant, **220 to 350 km**; moons, **4 to 35 km** (smaller than their planet, like the Moon and the Earth), and a Sun-like star, **2500 km**. Orbits lie tens of thousands of kilometres apart (they grow with the square root of the real distance) and the spheres of influence of two bodies never overlap: with the pulse drive you go from one planet to the next in under a minute.

Each body has **a single radius**: the one drawn is the same one used for collisions and gravity. Planets and moons **move by the server clock**, so every player sees them in the same place; orbits are very slow (tens of m/s), so a ship can always catch up with a planet. Claimed planets carry a label with their name (golden if they are yours).

### Stars

{{tabla:escala-estrellas}}

The stars' simulated gravity is capped (see [Piloting](/wiki/pilotar#gravity)).

### Planets and moons

{{tabla:cuerpos}}

Moons use the row of their type with their own radius.

> [!dev] **Landing** is not possible yet. Every body already defines its atmosphere, surface, entry conditions and whether it will be landable; gas giants have no surface.

## Time

The game runs **in real time**: one game hour is one real hour. Building takes hours; jumping between nearby stars, minutes; and inside a system you fly in real time.
