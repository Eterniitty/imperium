# Flying the ship

Your Emperor always travels in their ship, and you fly it yourself in real time, with no loading screens between space and the systems. When you press **Awaken** you start at the controls inside the system where your ship is.

## Controls

Every key can be changed in **Settings → Controls** (up to two per action). These are the defaults:

### Flying the ship

{{tabla:teclas-vuelo}}

**Starting the engines.** When you take the controls, the ship's engines are off: the HUD is dimmed and reminds you of the key in the centre. Press [[I]] to start them (a few seconds): reactor, pumps and status lights come on, the turbine spools up, the nozzles ignite and the HUD powers up. Without engines there is no thrust, no turning and no pulse drive (the ship only keeps its momentum and feels gravity). The same key shuts them down. If you order a quantum jump with the engines off, they start by themselves before the ship aligns; when you arrive from a jump they are already running.

**The camera and the ship are separate.** Dragging with the mouse **moves the camera around the ship** (above, below, to the sides, in front) without turning it; the wheel zooms the camera and [[B]] brings it back behind the ship. The ship only changes its orientation with the flight controls: arrows (pitch and yaw) and [[Q]]/[[E]] (roll). If you prefer, **mouse flight** ([[G]] or in Settings) makes a left-button drag turn the ship like a stick (the further from the point you pressed, the faster); the right button still moves the camera. In the cockpit, the mouse looks around.

### Inertia and flight assist

The ship moves with thrusters: the main one pushes forward, weaker ones brake and move it sideways and up or down, and the manoeuvring thrusters turn it (turns speed up and slow down smoothly, never at once).

- With **flight assist** on (default; [[Z]] toggles it), the thrusters bring the ship to the speed you ask for and, with no keys pressed, brake it to a stop.
- With it off, the ship **keeps its velocity** (pure inertia): to brake you have to thrust the other way.
- In **Settings → Controls** you can change the acceleration, the inertia and the maximum manoeuvring speed, and invert the camera's vertical axis.

{{tabla:modelo-vuelo}}

### Galaxy map

{{tabla:teclas-mapa}}

### At any time

{{tabla:teclas-general}}

## Speeds

{{tabla:vuelo}}

- **Normal speed**: for manoeuvring and fighting.
- **Boost** ([[Shift]], hold): multiplies normal speed.
- The server checks every position you send: nobody can go faster than their ship allows.

## Pulse drive

The pulse drive ([[P]], on and off) is a **supercruise** to cross the system from one planet to another (one or two minutes).

- It pushes **forward only**; while it is on you **cannot fire**.
- It can **always** be engaged, even next to a planet. Its top speed depends on the distance to the **nearest body**: heading straight at a planet it goes slowly (hundreds of m/s) and brakes by itself as you approach; **moving away**, the limit is several times higher; in open space it reaches the maximum speed in the table.
- It speeds up and slows down **smoothly**. The bottom panel shows the current limit and the **estimated time** to the selected planet, the locked ship or the body ahead.
- It uses **fuel** and some **energy**: without fuel it does not work.

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

## Parked ship

When you leave the controls, your ship stays where it was and **orbits the star** like the planets. Others see it and can attack it; pirates only chase piloted ships. When you come back, you start from where it is.

## Cameras

[[T]] switches between the **chase** camera (third person, the default) and the **cockpit** camera (first person). In both, the mouse moves the camera, not the ship; [[B]] returns to the chase view (or to looking ahead).

## Leaving the system

Fly to the **edge of the system** (a few thousand kilometres beyond the outermost planet) to reach **interstellar space**: you switch to the galaxy map with the star behind you.

## Quantum travel to another star

1. At the controls, press [[J]]: you see the systems **within range of your fuel**, with distance, duration and the fuel the jump uses. You can also **select a star on the map** and press [[J]] or **Jump here**.
2. The ship **aligns** with the destination by itself and **charges the quantum drive** (a few seconds). [[J]] or Esc cancel. While it charges, a **rift in space** opens ahead of the nose: a seam of light that grows, cracks and bends the background around it. When you jump it opens fully, the ship flies in and vanishes; on arrival another one opens at the destination and the ship comes out of it. The rift is in space, not on your screen: **other pilots in the system see it** (charging, entering and leaving). If flashes bother you, turn on **Reduce visual effects** in Settings.
3. During the trip you see the **quantum tunnel** with the time left; [[M]] switches between the tunnel and the map. On arrival you appear **at the edge of the destination system**, at the controls.

- Jump speed is in the table above: a few minutes to nearby stars and up to about **40 minutes** for the longest jump. **Range** is set by your fuel: to go further, jump in stages and refuel at your colonies.
- On arrival, your scanner [discovers](/wiki/niebla) the system and those within range.
- You can jump to any star within range, discovered or not.

## Shared flight

Inside a system you see the other Emperors flying there, and they see you. Outside the Human Core you may run into pirates. See [Combat](/wiki/combate).
