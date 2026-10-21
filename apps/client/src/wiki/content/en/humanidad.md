# Humanity: credits, treasury and projects

No Emperor rules humanity: each follows their own path (see [Lore](/wiki/lore)). But all are part of it, and above each one's colonies there is a **common economy**: that of all humanity, centred on the **Human Core**. Open it with the **Humanity** button in the top bar. Every figure on this page is read from the game's code.

## Credits

**Credits** (₢) are humanity's currency. They come from people's work: **every colony generates credits according to its population**, and its Emperor collects them. Every Emperor starts with a balance, so they can buy before having colonies.

Credits are not matter: they take no cargo space and need no transport. Your balance is shown in the top bar and grows on its own with your income. They are used on the [market](/wiki/mercado) and to contribute to the treasury.

{{tabla:humanidad}}

### How it is calculated

Like [colony production](/wiki/economia#how-production-is-calculated), the wallet is resolved **lazily**: the server stores your balance at one instant and your income per hour, and the balance at any moment is `balance + net income × hours`. Every game hour (and whenever you buy, sell or contribute) it recalculates your income with the current population of your colonies. That way nobody walks through every colony in the universe every second.

## The Human Core treasury

A fixed share of every colony's credits (the **contribution**) goes to the **common treasury of the Human Core**. The treasury also receives the **fee on every sale** on the market and Emperors' credit **donations**.

The treasury belongs to everyone and nobody controls it: it only pays the credit part of the **common projects**. Its balance and income per hour are public.

## Aggregates of all humanity

The panel shows every player the figures of all humanity: Emperors with colonies, number of colonies (including [independent](/wiki/cuenta) ones), population, stock and net production of each resource, and credits in circulation. They are updated with each Emperor's recalculation, so they may lag up to an hour.

## Common projects

Projects are works of all humanity. Each has several **levels**; each level needs **resources**, contributed by Emperors, and **credits**, paid by the treasury. When a level is completed, **every** Emperor gets its effect, whether they contributed or not.

{{tabla:proyectos}}

### Contributing

1. Open **Humanity**, pick a project and expand **Contribute**.
2. Choose the colony the resources leave from and how much of each. You cannot send more than the level still needs (counting what is already on the way).
3. The resources **leave the colony now** and travel to the Core through its transport network; the time depends on the distance (see the table above). On arrival they are added to the project.
4. You can also donate **credits**: they go to the treasury at once.

When a level has all its resources, the treasury pays its credits and the level is complete. If the treasury does not have enough yet, the project is left **waiting for credits** and completes on its own as soon as it does. Anything contributed beyond the need carries over to the next level.

Each project shows its **top contributors** (resources and credits added up). If an Emperor deletes their account, their contributions stay, anonymous.

### Effects

- **Core Defences**: more shield for fleets fighting in a Human Core system (see [War](/wiki/guerra)).
- **Core Research**: every colony extracts more metal, volatiles and crystal. It applies from each colony's last calculation.
- **Colony Grants**: new colonies start with more stock (never above storage).
- **Transport Network**: Core shipments (contributions and [market](/wiki/mercado) purchases) arrive sooner.

## Resource ledger

Every movement of credits is recorded in the same **insert-only ledger** as resources ([Economy](/wiki/economia#resource-ledger)): starting balance, contributions, donations, purchases, sales, fees and what the treasury pays for each level.

> [!dev] Later on, AI Emperors will also contribute and trade, through the same pipeline as players.
