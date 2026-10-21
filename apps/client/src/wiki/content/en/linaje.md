# Death and lineage

Your Emperor **can die**. It is not the end (Law I, [Persistence](/wiki/leyes#i-persistence)): a new body is **gestated** and returns. But death has **consequences** (Law III): time, position and what the ship carried. Everything on this page opens with the **Lineage** button in the top bar. The figures are read from the game's code.

## When the Emperor falls

The Emperor travels **in their ship**. They fall when the ship's hull reaches 0:

- in **piloted combat** (real time), against pirates or other Emperors (see [Combat](/wiki/combate));
- in a **round-based fleet battle** (see below).

When you fall, the **"Your Emperor has fallen"** screen appears, with who shot you down, where you will be reborn and the **time left**. While gestating, your Emperor **has no ship**: they cannot pilot, jump, colonize or disembark. Your colonies, fleets, routes, sieges and credits **keep working** normally.

## What is lost and what is kept

| Lost (Law III) | Kept |
|---|---|
| The **humans aboard** (they die with the ship) | Your **colonies**, their stock and installations |
| The **fuel** and **ammunition** it carried | Your **fleets** (with their cargo) and their routes |
| **Position**: you are reborn far from where you fell | Your **credits**, discoveries and companions |
| **Time**: the gestation | Your **Cradles** and your **Heirs** |

The new ship wakes up with **full hull and shield**, the **emergency fuel reserve**, the **ammunition made aboard** and a few humans: the new body generates them again on its own (Law II, [Continuity](/wiki/leyes#ii-continuity)). To fill the tank and the weapons, approach an own colony.

{{tabla:linaje}}

## Gestation

Each death **in a row** lengthens the gestation; the counter **relaxes over time without dying**. Without any Cradle, humanity rebuilds you in the **Human Core**, more slowly and far from everything.

{{tabla:linaje-gestacion}}

In the **Lineage** panel you see your **streak**, your **generation** (it goes up with each new body) and how long the gestation would last if you fell now.

## Lineage Cradles

The **Lineage Cradle** is a colony installation (built from the planet panel, like the others): it is **where you are reborn** and where your **Heirs** are gestated. When you fall, you are reborn in your **preferred Cradle** (chosen in the Lineage panel) or, if you have not chosen, in the **closest** to where you fell. The new ship appears **next to the Cradle's planet**.

Cradles are **military targets**: if you lose the colony (or the Cradle is destroyed in the capture), you can no longer be reborn there. The **Eradicators** hunt them: in their territory, they besiege colonies with a Cradle first (see [AI and territories](/wiki/ia-territorios)). If that happens during gestation, you are reborn in another of your Cradles or, without any, in the Human Core.

{{tabla:instalaciones}}

## Heirs

**Heirs** are bodies of your lineage. They are **gestated in a Cradle** (with resources and some inhabitants of that colony) and, once born, **govern the colony** they are in with the **doctrine** you choose:

- their doctrine improves the **extraction** or the **defense against sieges** of that colony;
- if you allow it, the governor **orders installations** according to their doctrine when the build queue is **empty** (they never interfere with your orders and do not spend below a reserve).

There is **one Heir per colony**. To gestate another in the same Cradle, send the one already born to **govern another colony** of yours.

{{tabla:herederos}}

{{tabla:doctrinas}}

If an Heir's colony **changes hands** (conquest or occupation), the Heir **dies** with it.

## Incarnating

You can **incarnate** in a born Heir: your Emperor wakes up in them, **in their colony**, with their ship next to the planet. The Heir **is consumed** and the colony is left without a governor.

- **Dead**: instead of waiting for the gestation, you wake up in the Heir right away (with the new ship, as when reborn).
- **Alive**: your ship and what it carries (humans, fuel, ammunition) move to the Heir's colony. You cannot do it while **travelling**, in a **battle** or in the **middle of combat** (if you were hit recently).

At most once every so often (see the table above).

## The Emperor's ship in battles

In [round-based fleet battles](/wiki/guerra), your ship **fights alongside your fleets** if they are in the battle and it is in the system (not travelling). **Outside the Human Core** it also fights **alone**: if a hostile fleet able to attack arrives where your ship is (even parked), the battle starts. Emperors' ships **do not start battles** by themselves. Its attack, shield and hull are in the table above; **the hull is the same** as in piloted combat. To escape, jump to another system.

## The hull

Your ship's hull **is saved**: it does not heal by leaving the system or simply over time. The crew **repairs it aboard** slowly (when not taking damage) and, **next to an own colony**, it is repaired quickly by paying **alloys** from its stock, while fuel and ammunition are replenished.

## AI Emperors

[AI Emperors](/wiki/ia-territorios) follow **the same rules**: they can fall, build a **Cradle** in their capital, gestate Heirs, send them to govern their colonies and, if they fall with a long gestation, **incarnate** in one.
