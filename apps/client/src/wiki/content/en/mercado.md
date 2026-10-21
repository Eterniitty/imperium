# Global market

The **global market** lets you buy and sell resources (metal, volatiles, crystal and alloys) with other Emperors for [credits](/wiki/humanidad#credits). Open it by clicking your credits in the top bar (or **Humanity** → **Market** tab). Energy is not traded: it cannot be transported. Every figure on this page is read from the game's code.

{{tabla:mercado}}

## The order book

Each resource has its own **book**: buy orders (the most someone will pay per unit) and sell orders (the least someone will accept). The panel shows the best price on each side, the last traded price, the units of the last 24 hours and a **chart of the hourly average price** with the volume below it. Prices are set by players: they rise when there are more buyers than sellers and fall the other way round.

## Buying and selling

1. Choose the resource, **Buy** or **Sell**, the colony, the quantity (whole units) and the price per unit (two decimals at most).
2. When you place the order, **what you offer is held**: if you sell, the resources leave your colony now; if you buy, the credits leave your wallet.
3. If the book already has an opposite order at your price or better, **it fills at once**, at the price of the order that was already there (the best first and, at the same price, the oldest). If you buy and it fills cheaper than you offered, you get the difference back.
4. Whatever does not fill stays in the book until someone takes it or you cancel it. **Cancelling** returns whatever is still held: resources to their colony (anything that does not fit in storage is lost) and credits to your wallet.

Two orders of the same Emperor never fill against each other.

## Delivery: logistics matter

Resources do not teleport. When a trade fills, **the seller is paid at once** (minus the fee, which goes to the [Core treasury](/wiki/humanidad#the-human-core-treasury)) and the goods **travel through the Core's transport network** from the seller's colony to the buyer's. The time depends on the distance between the two systems (speed in the table of [Economy of humanity](/wiki/humanidad#credits); the [Transport Network](/wiki/humanidad#common-projects) speeds it up). The panel shows your **shipments on the way** with their countdown.

On arrival, they are added to the destination colony's storage; anything that does not fit is lost. If that colony is no longer yours when the shipment arrives, the cargo is lost.

## Protection against abuse

- The server checks everything: that the colony is yours, that you have the resources or credits, price and quantity within limits, and a cap on open orders.
- Each order is filled in **a single transaction**: either everything happens (credits, resources, shipment and ledger entries) or nothing does.
- Every movement is recorded in the insert-only **resource ledger** ([Economy](/wiki/economia#resource-ledger)): holds, sales, fees, refunds and deliveries.
- If you delete your account, your orders are cancelled and whatever was held returns to your colonies before they become [independent](/wiki/cuenta).

> [!dev] The **Void Nomads** and AI Emperors will trade on this same market later on. You will also be able to collect purchases with your own fleets.
