# Conquest

Other players' planets **are not destroyed: they are captured**. To take a colony from another Emperor (or an [independent](/wiki/colonias#independent-colonies) one) you have to **besiege** it with armed ships, keep your presence until the siege is complete and **land troops**: humans you carry in your ships (Law II). What you conquer becomes yours with its population, installations and stock, with some losses.

## 1. Starting the siege

Select the planet on the map or in the system view and press **Besiege**. You need:

- an **armed fleet of yours parked** in that system (some ship with attack; not in battle);
- the defender must have **no armed ships** parked there (defeat them first in [battle](/wiki/guerra));
- the colony must not already be under siege.

You cannot besiege a **companion**, nor the colonies of an **Emperor in their first hours** (newcomer protection). The AI (alien factions and AI Emperors) **never attacks inside the Human Core**; between players, war is free across the universe.

The defender gets a **notice** as soon as it starts, and the siege shows in their **Battles** panel and on their planet.

## 2. Sustained presence

Every so often the server resolves the siege. **Progress** rises every game hour:

> progress per hour = attack / (attack + defense) / base duration

- **Attack** (siege strength): the sum of the attack of your armed ships parked there.
- **Defense** of the colony: a base, plus a little per inhabitant, plus its **defense platforms**.

With attack equal to defense, the siege lasts twice as long as with overwhelming strength. Progress **only advances** while your armed ships stay in the system and there are no armed defender ships (**contested**) nor fighting (**paused**). If you run out of armed ships there, the siege **breaks**. You can **lift** it whenever you want.

{{tabla:asedio}}

## Colony defenses

The **defense platform** is one more installation (built in the colony): it adds defense, **fires at the besieging ships** (each platform, one hit per resolution on a random ship; ships that fall are lost with their cargo) and provides **soldiers** against landings.

{{tabla:defensas}}

To break a siege on your colony, **bring armed ships** to the system: they will fight the besiegers.

## 3. Landing troops

With the siege **complete** (100 %) and your armed ships still in orbit, press **Land troops** and choose where the troops come from:

- the **passengers** of a freighter, heavy freighter or [troopship](/wiki/naves) and the **colonists** of a colonizer in one of your fleets parked there;
- or the **humans aboard your ship**, if it is in the system.

The planet is defended by its **militia** (a share of its population) and the **garrison** of its platforms.

- **More troops than defenders**: you take the planet. Some of your soldiers fall per defender, and the whole militia falls; **the survivors stay as colonists**.
- **Fewer or equal**: the landing fails, all your troops fall and take part of the militia with them. The siege goes on: you can try again.

## 4. Capture

The colony becomes yours **with losses**: part of the population, part of the stock and, at random, some installations. Also:

- its **build queue** is lost (what was paid is not refunded);
- its **market orders** are cancelled: what a sell order held returns to its warehouses (and is yours with the colony); the credits of a buy order go back to its former owner. Shipments already on their way to it are lost on arrival;
- **automatic routes** using it end;
- for your capital it counts from the conquest: it does not become your capital even if it is older;
- an **independent** colony produces again from the conquest, without collecting the time it spent frozen.

Everything is recorded in the [resource ledger](/wiki/economia#resource-ledger).

## Aliens

Hostile alien factions **besiege human colonies in their territory** (see [AI and territories](/wiki/ia-territorios#attacks-on-colonies)). They land no humans: when the siege is complete they **occupy** the colony and more of the population dies. You can **take it back** by besieging it yourself; besieging a colony they occupy raises their grudge.

{{tabla:asedio-alien}}

## AI Emperors

All AI Emperors defend their besieged colonies; **militarists** also conquer (independent colonies and Emperors who are not their companions, outside the Core). See [AI and territories](/wiki/ia-territorios#ai-human-emperors).

> [!dev] Still to come: conquering **installation by installation** (today the whole planet is taken), the **supply network** (isolated installations that weaken) and seeing sieges in **3D**.
