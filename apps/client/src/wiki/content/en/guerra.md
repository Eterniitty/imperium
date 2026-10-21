# Fleet warfare

When fleets of hostile Emperors meet, they fight **in rounds**, resolved on the server. You do not need to be online: the battle carries on by itself.

## When a battle starts

When **a fleet arrives** at a system, if there are **stopped fleets of two Emperors who are not companions** and at least one side **can deal damage** (some ship with attack), a battle starts with **all their fleets** in that system.

- There is at most **one battle per system**. Fleets of either side that arrive later **join** their side; third parties' fleets **wait** for it to end.
- When it ends, the game checks whether other enemies remain in the system (and another battle may start).
- The Emperor's ship does not take part in these battles: it fights [in real time](/wiki/combate).

## How a round is resolved

- **All ships fire at the same time** (including those that fall in that round).
- Each ship with attack splits its attack between its **shots** (most ships, one; corvettes, cruisers and carriers, several). Each shot picks **at random** an enemy ship still standing —**bigger** ships are more likely to be picked— and deals its share of the attack **± a variation**.
- The target's **battle shield** absorbs damage until it runs out for that round; the rest goes to the **hull**. The shield is renewed every round; the hull is not.
- With its hull at 0, the ship is **destroyed**.
- The result is deterministic: the same sides with the same seed always give the same outcome.

{{tabla:batallas}}

## Ships in battle

Each ship's figures (attack, shots, battle shield, target size and hull) and the balance between classes are in [Human ships](/wiki/naves#in-battle); alien ones in [Alien ships](/wiki/naves-alienigenas). Only those figures count in rounds; the "real time" weapons and shields are those of [piloted combat](/wiki/combate).

## How it ends

| Result | When |
|---|---|
| **Victory / Defeat** | One side has no ships left. |
| **Retreat** | One side flees. |
| **Draw** | After the maximum number of rounds, or if neither side can deal damage. |

## Losses

- Destroyed ships **are gone**. If the fleet loses hold space or seats with them, **cargo that no longer fits and passengers without a seat are lost**, and this is recorded in the [resource ledger](/wiki/economia#resource-ledger).
- A fleet with no ships disappears.
- With fewer ships, your capital pays less upkeep from then on.

## Fleeing

Any **travel order** takes the fleet out of the battle: it is a **retreat**. While fighting, a fleet **cannot load, unload or colonise**; convoys on an [automatic route](/wiki/flotas#automatic-routes) wait and carry on if they survive.

## Contacts and interception

In the **Battles** panel, the **Contacts** section lists **enemy fleets in transit** leaving from or heading to a system within reach of your sensors:

- each fleet of yours that is **stopped** (the scanner of its best ship),
- your **ship** (if it is not jumping),
- each of your **colonies**.

Pick one of your fleets and press **Intercept**: it travels to the contact's **destination** and, if they meet there, they fight. If the contact is no longer within your sensors' reach, the order fails.

## Watching it in 3D

Ongoing battles are shown in the **system view**: both sides face to face, with their ship models, shots coming out of their hardpoints and explosions when a round downs ships. In the **Battles** panel, **Watch the battle in 3D** opens the system and takes the camera there (if you are not flying). It is a staging of what the server resolves each round; with many ships, a proportional part is drawn.

## The Battles panel

It shows your ongoing battles and those that ended in the last hour: the enemy, the system, the ships on each side, the round, the damage dealt and taken in the last round, and the result.

## Against aliens

Alien faction fleets fight **just like an Emperor's**, in rounds. A battle with them starts when you meet in a system **of their territory** and the faction **is hostile to you** (by nature or because of [grudge](/wiki/ia-territorios#grudge-and-tribute)); never in the Human Core. In the panel they show their faction's name. See [AI and territories](/wiki/ia-territorios).

## Independent colonies

The planets of players who delete their account remain as **independent colonies**, frozen and ownerless. See [Colonies](/wiki/colonias#independent-colonies).

> [!dev] Still to come: seeing battles in **3D**, **conquest** of planets (sieges, troops, capturing installations; phase 9b), **large-scale combat** (phase 9c) and **ship AI** (piloting, group tactics, ambushes; phase 9d).
