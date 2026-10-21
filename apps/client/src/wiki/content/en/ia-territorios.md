# AI and territories

Alien factions hold **territories** and defend them with **fleets** moved by an **artificial intelligence** on the server. The AI does not cheat: it uses the **same fleets, travel orders, round-based combat and market** as players, and it does not see what the fog of war hides.

## Territories

- The galaxy is divided into cubic **regions**. Each region belongs to **one species or to nobody**, chosen among those that can live at that distance from the Core and according to the star density they prefer.
- Within its region, a species holds **part of the systems**, above all those of its **preferred stars** (see each card in [Species](/wiki/especies#cards)).
- **The Human Core is safe**: no species lives in it or enters it. The most dangerous live **farther away**.
- The layout is **deterministic** (always the same) but **secret**: the server computes it with a seed the client does not have.
- Territories also **grow slowly**: from time to time each species adds a nearby free system of its region (never where there are colonies).

{{tabla:anillos}}

### On the map

Territory shows as a **soft halo in the species' colour** around the systems **you have discovered**. What you have not explored stays hidden: the border you know is the one you have seen. **Precursor ruins** are marked with a golden dot. When you select a system, the panel shows its **alien presence**: whose it is, whether there are ruins and which fleets are there (if your sensors cover it right now).

## How the AI wakes up

The AI does not roam the whole universe: **it only wakes up where there are humans**.

1. When one of your fleets or your ship reaches a system in its territory, **the region wakes up** and its **garrison** appears (more and bigger fleets the farther from the Core).
2. While awake, the AI **decides every so often**: **reinforcements** arrive if it has lost fleets, its fleets **patrol** the territory and, sometimes, it **expands**.
3. If a faction is **hostile** to you and its response is to **attack**, it sends fleets against your intruding fleet according to its **aggression**. On arrival you fight [in rounds](/wiki/guerra).
4. With no humans nearby for a while, the region **falls asleep** (its fleets stay where they are).

{{tabla:ia-alienigena}}

> [!nota] **Grace for newcomers**: during their first hours, nobody sends fleets against a newly arrived Emperor (garrisons in the system they enter do fight). And there are never fights with aliens in the Human Core.

## Grudge and tribute

Each faction keeps a **grudge** against each Emperor. Factions **hostile** by nature (the Pale Verdict, the Tide, House Solenne, the Quiet End, Rust Tide) always attack; **neutral** and **potential ally** factions only when the grudge reaches the threshold.

- **Intercepting** one of their fleets adds a lot of grudge (you become hostile at once).
- **Founding a colony** in their territory adds the grudge shown on their card (the Nomads do not tolerate cut routes; the Greys, expansion into their space).
- The grudge is **forgotten** little by little.
- **Tribute** (basic diplomacy): in the **Battles → Known factions** panel you can pay credits to erase the grudge. Those who **never make pacts** (Eradicators, Tharaxi) refuse it. If the faction trades, the credits go to its wallet.

## Void Nomad trade

The **Void Nomads** have a **habitat** in their territory and a credit wallet. When their region is awake, they **sell volatiles and metal** and **buy crystal** on the [global market](/wiki/mercado), close to the last price, with the same orders as any Emperor. What you buy from them **travels** from their habitat, far from the Core: it takes longer.

## Alien contacts

In the **Battles** panel:

- **Contacts**: alien fleets **in transit** detected by your sensors show their faction's name. You can intercept them (and they will hold a grudge).
- **Alien sightings**: their **parked** fleets within range of your sensors.
- **Known factions**: those you have met, whether they are hostile and their grudge, with the tribute button.

## AI human Emperors

So the universe is not empty with few players, there are a few **AI human Emperors**. They show on the map like any Emperor, marked **AI**, and play with **the same orders and rules** as you: they claim planets with the humans on their ship, build installations in order, make colonizers to found more colonies, send their explorer to discover nearby systems and, the merchants, sell their surplus on the [market](/wiki/mercado). They only know what they have discovered and avoid colonising known alien territory. **They start no fights in the Human Core.**

{{tabla:ia-emperadores}}

> [!dev] They do not wage war on their own yet nor accept companions, and the piloting AI for ships in 3D (phase 9d) is designed but not built.
