/** Tests de la cola de eventos programados. Usan TEST_DATABASE_URL, que se vacía. */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { scheduledEvents } from "../src/db/schema";
import { EventWorker, schedule } from "../src/events/queue";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const silent = { error() {}, info() {}, warn() {}, debug() {} } as unknown as ConstructorParameters<typeof EventWorker>[1];

describe.skipIf(!TEST_DATABASE_URL)("cola de eventos", () => {
  const database = createDb(TEST_DATABASE_URL ?? "");
  const db = database.db;

  beforeAll(() => resetTestDatabase(database));
  beforeEach(() => db.execute(sql`TRUNCATE scheduled_events`));
  afterAll(() => database.close());

  it("procesa solo los vencidos, en orden, y los borra", async () => {
    const worker = new EventWorker(db, silent);
    const seen: string[] = [];
    worker.on("fleet.arrive", async (_tx, { fleetId }) => {
      seen.push(fleetId);
    });
    const now = Date.now();
    await schedule(db, "fleet.arrive", new Date(now - 1000), { fleetId: "segundo" });
    await schedule(db, "fleet.arrive", new Date(now - 2000), { fleetId: "primero" });
    await schedule(db, "fleet.arrive", new Date(now + 60_000), { fleetId: "futuro" });

    expect(await worker.drain()).toBe(2);
    expect(seen).toEqual(["primero", "segundo"]);
    expect((await db.select().from(scheduledEvents)).map((e) => (e.payload as { fleetId: string }).fleetId)).toEqual(["futuro"]);
  });

  it("un evento que falla deshace lo suyo, se aplaza y no bloquea a los demás", async () => {
    const worker = new EventWorker(db, silent);
    const notified: string[] = [];
    worker.on("fleet.arrive", async (tx, { fleetId }) => {
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS prueba_eventos (id text)`);
      await tx.execute(sql`INSERT INTO prueba_eventos VALUES (${fleetId})`);
      if (fleetId === "roto") throw new Error("fallo provocado");
      return () => notified.push(fleetId);
    });
    await schedule(db, "fleet.arrive", new Date(Date.now() - 2000), { fleetId: "roto" });
    await schedule(db, "fleet.arrive", new Date(Date.now() - 1000), { fleetId: "sano" });

    await worker.drain();
    expect(notified).toEqual(["sano"]);
    const rows = await db.execute(sql`SELECT id FROM prueba_eventos`);
    expect(rows.map((r) => r.id)).toEqual(["sano"]);
    const [pending] = await db.select().from(scheduledEvents);
    expect((pending!.payload as { fleetId: string }).fleetId).toBe("roto");
    expect(pending!.dueAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    await db.execute(sql`DROP TABLE prueba_eventos`);
  });

  it("dos trabajadores a la vez no procesan el mismo evento", async () => {
    const seen: string[] = [];
    const make = () => {
      const w = new EventWorker(db, silent);
      w.on("fleet.arrive", async (_tx, { fleetId }) => {
        await new Promise((r) => setTimeout(r, 20));
        seen.push(fleetId);
      });
      return w;
    };
    for (let i = 0; i < 10; i++) await schedule(db, "fleet.arrive", new Date(Date.now() - 1000 + i), { fleetId: `e${i}` });
    const [a, b] = await Promise.all([make().drain(), make().drain()]);
    expect(a + b).toBe(10);
    expect(new Set(seen).size).toBe(10);
  });
});
