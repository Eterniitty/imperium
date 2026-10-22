# Shipyard: design your ships

In the **Shipyard** (top bar button) you design your own ships **part by part, like Lego**. You choose a **hull** and fit a **part** into each **mount**. The ship responds to every part: without a bridge nobody can fly it, without a reactor nothing works, without a drive it does not move and without a quantum drive it cannot jump between stars.

## How to design

1. Press **New design** and choose the **hull**. Each hull has its own mounts, mass, hull points and cargo.
2. In each **mount** choose a part. Only parts that **fit** are listed: of a type the mount accepts and of its size or smaller (an S part fits an M mount, not the other way round). Some parts need a large hull.
3. On the right you see the **statistics** live (mass, power, acceleration, cruise, pulse, turn rate, jump, hull, shield, damage, cargo…), the **problems** and the **cost**.
4. **Save the design** with a name. You can **duplicate** it to try variants and **delete** it. You can keep up to 30 designs, even unfinished ones.

## Building a design

Save the design and, below, choose the **colony** and press **Build here**. The colony needs a **shipyard**; cruiser and capital hulls also need an **orbital drydock**. You pay when you order it: **resources** come from the colony and **credits** from your wallet. The order goes into the colony's **queue** under the design's name and, when finished, the ship appears as a **new fleet** in the colony's system.

- The design is built **as it was when ordered**: if you change or delete it later, the ordered ship does not change.
- If you **cancel** the order, you get everything back if it had not started and part of it if it had (resources and credits).
- In **round-based fleet battles** its parts rule: attack = 0.4 × its weapons' damage per second, shield per round = half the recharge plus 1 % of the capacity, one shot per weapon and a target size by hull. It has the **hull points** and **berths** of its parts.
- As an **escort** or **piloted remotely** it fights with the hull, shield and weapons of its parts, and when piloted its **acceleration** and **turn rate** come from its mass and drives.
- Between stars it travels at its **quantum drive's speed** and with the **range of its tanks** (see [Fleets](/wiki/flotas#fuel)).
- Its **scanner** is that of its **sensors** (without sensors, that of the stock class closest to its hull).
- Its **3D model** comes from its parts (engines, turrets, holds, hangar…) on the shape of the stock class closest to its hull.

## The rules

- **Required**: bridge, reactor and propulsion drive. Without them the ship **cannot be built**.
- **Power**: what the parts use cannot exceed what the reactor gives.
- **Warnings** (it can be built, but beware): without a quantum drive it **cannot jump**; with a quantum drive but no tank, it **has no fuel**; without weapons, **unarmed**; without a shield, **no shield**.
- **Mass**: the heavier it is, the less it accelerates, the slower it turns and the shorter it jumps. Acceleration is thrust / mass.
- **Jump**: the fastest quantum drive sets the speed; range comes from the fuel in the tanks and the mass.

## Hulls

{{tabla:cascos}}

## Parts

{{tabla:piezas}}

> [!dev]
> **In development**: a drawing of its own for each part (for now it is drawn on the shape of its base class).
