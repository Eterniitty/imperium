# Flying the ship

Your Emperor always travels in their ship, and you fly it yourself in real time, with no loading screens between space and the systems. When you press **Awaken** you start at the controls inside the system where your ship is.

## Controls

Only the actions used constantly with your hands on the controls have a default key (moving, turning, firing, engines, pulse, jump, camera). Everything else is in the **action bar**, on the left above the ship status: engines, pulse, assist, mouse mode, camera, cruise, follow, dock, targets, auto fire and call for help. Active buttons show in gold and, if the action has a key, they show it. Any action can be bound to a key in **Settings → Controls** (up to two per action). These are the defaults:

### Flying the ship

{{tabla:teclas-vuelo}}

**Starting the engines.** When you take the controls, the ship's engines are off: the HUD is dimmed and reminds you of the key in the centre. Press [[I]] to start them (a few seconds): reactor, pumps and status lights come on, the turbine spools up, the nozzles ignite and the HUD powers up. Without engines there is no thrust, no turning, no pulse drive, no weapons and no mining laser (the ship only keeps its momentum and feels gravity). The same key shuts them down. If you order a quantum jump with the engines off, they start by themselves before the ship aligns; when you arrive from a jump they are already running.

**The camera and the ship are separate.** The mouse has two modes, switched with the **Mouse** button in the action bar (it shows which one is active):

- **Free camera** (default): dragging with the mouse **moves the camera around the ship** (above, below, to the sides, in front) without turning it; the wheel zooms (with engines on, left click fires and Ctrl + wheel switches weapon: then drag with the right button; see [Combat](/wiki/combate#aim-assist)) and [[B]] puts the camera back behind the ship. You fly with the keyboard: arrow keys (pitch and yaw) and [[Q]]/[[E]] (roll).
- **Mouse flight**: a **virtual reticle** in the centre of the screen. The ship turns towards where the cursor points relative to the centre, without dragging: the further from the centre, the faster (up to the outer circle); inside the small circle (dead zone) it does not turn. The camera follows behind the ship; hold the right button to look around for a moment. Arrow keys and [[Q]]/[[E]] still work.

In **Settings → Controls** you can change the mouse flight sensitivity and dead zone and invert its vertical axis. In the cockpit, in free camera mode, the mouse looks around.

### Flight model: arcade or Newtonian

By default you fly in **arcade** mode (Settings → Flight → Flight model):

- The ship always flies where its nose points: no drifting.
- **W** speeds up and **S** brakes to a stop; there is no reverse (the engines push forwards).
- When you take the controls it is stopped. After pressing W, releasing the keys keeps cruise speed (30 % of the maximum); after S it stays stopped until you press W again.
- **A/D** turn left and right and the ship banks by itself in turns; release and it levels out.
- The **mouse** aims the ship (mouse flight is on by default); **Shift**, boost.
- **Gears** (**Z** key or the speedometer button in the action bar): **close** (100 m/s, for manoeuvring next to planets, ships and motherships), **normal** (250 m/s) and **fast** (1 km/s, or whatever you set in Settings → Flight). With **Shift** (boost), double in close and normal. Acceleration follows the gear: always about 8 s to its top.
- It is heavy: the Emperor's ship takes about 8 s to go from standstill to top speed. Fleet ships you pilot remotely handle according to their size: fighters accelerate and turn much faster; capitals, more slowly.
- With weapons ready, the camera moves a little closer and lower (combat camera).
- With mouse flight, a click on the view **captures the mouse**: the cursor (a golden circle) cannot leave the steering circle or the window. The ship only steers with the mouse while it is captured: **Esc** or **Alt** release it (the ship holds its heading) to use the interface; it is also released when a window or panel opens (planet, cruise, settings…), and when you switch off the engines or mouse flight.

The **Newtonian** mode is the classic one: real inertia, strafe thrusters, up/down and reverse.

### Inertia and flight assist

The ship moves with thrusters: the main one pushes forward, weaker ones brake and move it sideways and up or down, and the manoeuvring thrusters turn it (turns speed up and slow down smoothly, never at once).

- With **flight assist** on (default; the **Assist** button toggles it), the thrusters bring the ship to the speed you ask for and, with no keys pressed, brake it to a stop.
- With it off, the ship **keeps its velocity** (pure inertia): to brake you have to thrust the other way.
- In **Settings → Controls** you can change the acceleration, the inertia and the maximum manoeuvring speed, and invert the camera's vertical axis.

{{tabla:modelo-vuelo}}

### Galaxy map

{{tabla:teclas-mapa}}

At the bottom left, the map bar: **⊡** zooms to the sector around the focus and **◎** shows the whole galaxy; below, the layers switch on and off (Emperors, fleets, names, faction territories and the distant galaxy), and your choice is remembered. Your fleets stopped in the same system show as a single mark ("Fleet 1 +2"), and names that overlap on screen are grouped ("Name +N"). The star class legend folds with a click.

### At any time

{{tabla:teclas-general}}

## Speeds

{{tabla:vuelo}}

- **Normal speed**: for manoeuvring and fighting.
- **Boost** ([[Shift]], hold): multiplies normal speed.
- The server checks every position you send: nobody can go faster than their ship allows.

## Pulse drive

The pulse drive ([[P]], on and off) is a **supercruise** to cross the system from one planet to another (a few minutes).

- It pushes **forward only**; while it is on you **cannot fire**.
- It can **always** be engaged, even next to a planet. Its top speed depends on the distance to the **nearest body**: heading straight at a planet it goes slowly (hundreds of m/s) and brakes by itself as you approach; **moving away**, the limit is several times higher; in open space it reaches the maximum speed in the table.
- When you press it, the engine **charges for 5 seconds** (the HUD counts down; pressing again cancels) and then **builds up speed gradually** (about 5 s to its maximum); it slows down smoothly. The bottom panel shows the current limit and the **estimated time** to the selected planet, the locked ship or the body ahead.
- It uses **fuel** and some **energy**: without fuel it does not work.

## Cruise autopilot

The cruise notice minimises with **▁** into a pill ("→ destination · arrival") and expands with a click; it is remembered.

Cruise **keeps going with the galaxy map open** (M): the ship keeps flying to its destination and, when you come back (M or "Pilot"), you find it where it is, with the cruise notice. Viewing another system from the map does stop it (the ship stays parked).

And if you **close the tab** mid-cruise towards a planet or moon, the ship **keeps going there without you**: in a straight line, at most at pulse speed (the server works out the time; never less than flying would take) and spending the pulse fuel for the whole trip (if there is not enough, it stays where it was). When you come back you find it on its way or already there; if it had not arrived, cruise resumes by itself.

Inside a system (or a deep-space region) the ship can fly itself to a place or follow another ship. It works the same controls you do —turning, thrusters, boost and pulse drive—, so it flies at the same speeds and other players see it fly normally.

- **Choose a destination**: the **Cruise** button opens the list of planets, moons, asteroid belts, the system's anomaly and, in deep space, the nearest asteroids, plus the ships in sight (your [companions](/wiki/companeros) first). You can also press **Cruise here** in the panel of the selected planet, or **double-click** a planet, moon, ship or an empty point of the system plane (a marked point) in the view (with engines on, **Alt + double-click**, since left click fires).
- **Go to a place**: the ship turns, engages the pulse drive if the destination is far (throttling it to brake in time), drops it when close and finishes on thrusters until it **stops at a safe distance** (above a planet or moon, at half its radius of altitude, between 5 and 120 km; next to an asteroid, within mining-laser range). It flies around the star, planets and moons in the way. On arrival it disengages and tells you.
- **Speed**: the circular dial in the panel (and in the notice while the autopilot is on) sets its top speed, from 1 km/s to the pulse drive's; all the way right, "max". Drag around it or turn the mouse wheel over it.
- **Orbit**: in the list, next to a planet or a moon, **Orbit** takes the ship there and leaves it circling its equator at the same safe altitude, nose along the orbit, until you cancel.
- **Follow a ship**: the **Follow** button follows the locked ship ([[X]]) or, if there is none, the nearest ship in sight (companions first); press it again to switch to the next one. Your ship takes up formation behind and to one side, matching its speed (with the pulse drive if it uses it). If it jumps out of the system or goes out of sight, the autopilot disengages with a notice.
- **Cancel**: **Stop cruise**, Esc or **any flight control** (move, turn, boost, pulse, engines; in mouse flight, moving the cursor out of the dead zone). A HUD notice shows the mode, destination, distance and the key to cancel.
- If the engines are off, they start on their own. Without fuel it uses thrusters only (much slower). Firing and mining do not cancel it.

## Gravity

Planets, moons and the star **pull the ship**, but only inside their **sphere of influence** (about eight times their radius, more if they have moons): in the space between planets there is no gravity and you do not fall towards anything. The HUD shows the region you are in:

- **Deep space**: outside every sphere, no gravity.
- **Orbital approach**: inside a body's sphere; the pull grows as you get closer (as 1/r²).
- **Surface proximity**: very close to the ground or inside the atmosphere.

Without flight assist you fall towards the body; with it, the thrusters compensate the pull, though not entirely (the ship slowly gives way, more so near giants). With the right speed you can orbit. The pulse drive ignores gravity. Each body type's gravity is in [Universe](/wiki/universo#inside-a-system).

> [!dev] Gravity assist (slingshot) does not exist yet, and the stars' gravity is capped so that you can always escape with your thrusters.

## Instruments and ship resources

In the cockpit you see the **artificial horizon** (relative to the orbital plane) and, always, the **heading** (0° = towards the star), the **speed** and the **altitude** (distance to the surface of the nearest body). Bottom left: **shield**, **hull**, **energy** and **fuel**; bottom right: cannon **rounds**, **missiles** and the target with its distance.

- **Energy**: the reactor recharges it; the cannon (each shot), shield recharge and pulse drive use it. Sustained fire drains it and the cannon falls silent.
- **Fuel**: used by the pulse drive and quantum jumps. Below the emergency reserve it regenerates **very slowly** on board, so nobody gets stranded.
- **Rounds and missiles**: limited. Only a small reserve is made on board.
- **Resupply**: within 150 km of a planet with **one of your colonies**, the ship refills by itself from the colony's stock (volatiles for fuel, metal for rounds, alloys for missiles).

## Escorts

When you take the controls in a system where you have stationary fleets (not in battle), their **armed ships come out to escort you**: the biggest ones, up to the cap in the table. They fly in a wedge behind you and, if a Scavenger comes close, go after the nearest one (with their own aim, and holding fire when you or another escort is in the line of fire). With the pulse drive they travel with you in formation (or wait, if you choose; see below).

- Escorts are real ships of your fleet: if they are destroyed, **the fleet loses them**; when you park, jump or leave the system they return to their fleet with whatever hull they have left.
- Scavengers attack them too, and other ships see them with your name.
- If you remotely pilot one of them, it stops escorting you and comes under your control.
- **Orders**: at the bottom right you have **Follow** (the default), **Attack target** (they go after your locked ship, another player too, and then come back), **Hold** (they stay where they are and defend that spot) and **Fall back** (they return to your side without fighting).
- **With the pulse drive**: the **Pulse: with me / Pulse: they wait** button decides whether the escort **travels with you in formation** when you engage the pulse drive, or **waits** where it is and follows you again when you come back close.

{{tabla:escoltas}}

## Docking in a mothership

The **mothership** is the biggest ship you can build (1600 m, in an orbital drydock; see [Human ships](/wiki/naves)). When one of your fleets with a mothership is stationary in the system where you are flying, get close to it and press [[Enter]] (dock): your ship enters its hangar and **resupplies from the fleet's hold** as it would next to one of your colonies (volatiles → fuel, metal → ammunition, alloys → missiles and hull). Fill the fleet's hold at a colony first (see [Fleets](/wiki/flotas)).

**Designing it with its modules:** the [Shipyard](/wiki/astillero) has a **mothership hull** (it needs Industry 5 and is built in an orbital drydock): you choose its reactors, drives, shields, weapons and bays (holds, hangar, armour…) and it keeps the docking, the fighter wing and the workshop.

**Where it is:** next to your colony in that system, between the planet and the star (without a colony there, in the parking orbit next to the first planet). To get there without searching, open cruise (the **Cruise** button in the action bar): it is listed as “Mothership · fleet N” and the autopilot leaves you beside it, within docking range.

- While docked your ship does not move on its own; press [[Enter]] again to leave.
- You undock automatically if the fleet sets off or your ship moves away.
- **Risk**: if the mothership falls in a battle while you are docked (parked inside too), **your Emperor falls with it** (see [Death and lineage](/wiki/linaje)).
- **Command bridge**: while docked, on the left you have the empire summary and the fleet, battle and colony panels, as in the tunnel.
- **Hangar**: when you fly in the system where its fleet waits, the mothership launches a **fighter wing** that escorts you like your other escorts (and follows their orders). A downed fighter is ready again after a while; the mothership itself stays with its fleet.
- **Workshop**: every minute the mothership repairs the hull of the damaged ships in its fleet (outside battles), with alloys from the fleet's hold.

{{tabla:taller}}

- **Travelling docked**: with your ship in the hangar, open the map ([[M]]) and give the mothership's fleet a travel order. You travel with it through the tunnel, spending no fuel, and arrive **still docked**, next to the fleet at the destination.

## Remotely piloting your fleets' ships

In the **Fleets** panel (also on the command bridge during a quantum trip), stationary fleets that are not in battle have a **Pilot** button: you take the controls of their biggest armed ship, in the system where the fleet is, even if your own ship is far away or travelling. Your Emperor's ship stays parked.

- The ship fights in real time like any other (its weapons, shield and hull are those of its class), collides, burns near the star, and pirates attack it.
- It makes no quantum jumps and does not leave the system: at the edge, or with [[M]], you go back to your ship (or to the tunnel, if you are travelling).
- When you leave it, it returns to its fleet with whatever hull it has left. If it is destroyed, **the fleet loses it** (your Emperor does not die).
- If the fleet sets off (travel order or interception), you stop piloting it.

## Parked ship

When you disconnect or leave the controls, your ship **does not vanish**: it stays in space, where you left it. If it was next to a planet or moon (inside its sphere of influence), it moves along with it and you find it in the same spot relative to it; in open space it orbits the star like the planets. It keeps its orientation and its **engines as you left them**: leave them on and they are still on when you return; switch them off and they stay off. Others see it and can attack it; pirates only chase piloted ships.

## Sound

In Settings → Sound, **Engines** turns only the engine hum and the pulse wind up or down. With the engines running you hear their hum, which rises in pitch with thrust, and a background rumble. The pulse drive sounds like a wind that grows with speed, with a tone that rises while it charges. The autopilot chimes twice when it arrives or enters orbit. Everything follows the effects volume in Settings.

## Cameras

[[T]] switches between the **chase** camera (third person, the default) and the **cockpit** camera (first person). In both, the mouse moves the camera, not the ship; the **Recenter camera** button returns to the chase view (or to looking ahead).

## Leaving the system

Fly to the **edge of the system** (a few thousand kilometres beyond the outermost planet) to reach **interstellar space**: you switch to the galaxy map with the star behind you.

## Quantum travel to another star

1. At the controls, press [[J]]: you see the systems **within range of your fuel**, with distance, duration and the fuel the jump uses. You can also **select a star on the map** and press [[J]] or **Jump here**.
2. The ship **aligns** with the destination by itself and **charges the quantum drive**: aligning plus charging, the jump takes about **20 seconds** to prepare. [[J]] or Esc cancel. While it charges, a **rift in space** opens ahead of the nose: a seam of light that grows, cracks and bends the background around it. When you jump it opens fully and the ship, accelerating to nearly the speed of light, **stretches towards it** into a thread of light and vanishes inside in under a second; on arrival another one opens at the destination, **a beam of light shoots out of it** and collapses into your ship with a flash. The camera follows by opening up a little, smoothly. The rift is in space, not on your screen: **other pilots in the system see it** (charging, entering and leaving). If flashes bother you, turn on **Reduce visual effects** in Settings: flashes and the beam are dimmer.
3. During the trip you see the **quantum tunnel** with the time left; [[M]] switches between the tunnel and the map. In the tunnel you have the **command bridge**: humans aboard, fleets, colonies and alerts for what needs attention (battles, sieges, colonies short of supplies), with the fleet, battle and colony panels so you can keep ruling during the trip; clicking a fleet or colony opens the map. On arrival you appear at the controls **where you last were in that system**; the first time, **at its edge**, on the side you come from.

- Jump speed is in the table above: a few minutes to nearby stars and up to about **40 minutes** for the longest jump. **Range** is set by your fuel: to go further, jump in stages and refuel at your colonies.
- On arrival, your scanner [discovers](/wiki/niebla) the system and those within range.
- You can jump to any star within range, discovered or not.
- **Jumping does not need you to watch the screen.** You can pick the destination and switch to another tab or window: the jump still happens (without the animation), and the server handles the trip and the arrival. When you come back, you see the tunnel if you are still travelling, or your ship already at the destination.
- **Position memory:** the game remembers where your ship was in each system (when you jump away, when you park it and every minute while you fly). When you return to a system, you arrive there and the rift opens there.
- **Next to a companion:** if a [companion](/wiki/companeros) is or was in a system, the jump selector ([[J]]) and the system panel on the map show **"Next to …"**: you arrive beside them, where they are now or where they last were.

If you **close the tab** while the ship is aligning or charging the jump, the server **jumps anyway** when it would have left (never earlier: the preparation is completed in full).

The arrival rift **opens in the destination system about 3 s before** the ship comes out: those there see it open. In those last 3 s you can no longer leave the tunnel.

### Dropping out halfway

In the tunnel, the **Drop out here** button stops the trip: you stay in **deep space**, between the two stars, and only spend the fuel for the distance covered. There may be asteroids there to mine with [[L]]. See [Deep space and mining](/wiki/espacio-profundo).

## Shared flight

Inside a system you see the other Emperors flying there, and they see you. Outside the Human Core you may run into pirates. See [Combat](/wiki/combate).
