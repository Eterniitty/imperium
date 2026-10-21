# Fog of war and discovery

The positions and classes of every star are public: you see them on the map from the start. What lies **inside** each system (planets, moons, belts, resources and anomalies) stays hidden until your empire discovers it.

## How it works

- Each system's details are generated on the server with a **secret seed of that system's own**. Your browser cannot compute them: it asks the server, and the server **only answers if you have discovered the system**.
- An undiscovered system shows as **"Unexplored"** in the panel; in its 3D view only the star is visible.

## How to discover

The system where a ship or fleet is **and every system within its scanner range** (a sphere of that radius, in light years) is discovered:

1. **When your Emperor is created**: your home system and whatever your ship and starting fleet cover.
2. **When your ship arrives** at another star after a jump (the Emperor's ship scanner).
3. **When a fleet arrives** at a system (the scanner of its best ship).

{{tabla:escaneres}}

Full ship data is in [Fleets](/wiki/flotas#ships). That is why the **Explorer** is the best ship to scout ahead: it is fast and has the largest scanner.

## Exploration probes

To see a system without going there, select it on the map and press **Send probe**. The probe is paid with credits and leaves from your ship (wherever it is, even in the middle of a quantum trip) or from your colony nearest to the target; it flies on its own and, on arrival, discovers the system and the neighbours its scanner covers. Then it is lost. On the command bridge you see the ones in flight and how long they have left.

{{tabla:sondas}}

## What others see

- Discoveries are **yours**: another player cannot see the details of a system only you have discovered.
- Who owns each planet (and its name) is visible to **anyone who has discovered that system**. A colony's population and stock, **only to its owner**.
- The sensors used to detect enemy fleets in transit are explained in [War](/wiki/guerra#contacts-and-interception).

> [!dev] Sharing discoveries with your organisation and publishing them for everyone will arrive with organisations (phase 12).
