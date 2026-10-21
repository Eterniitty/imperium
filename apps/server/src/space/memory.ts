/**
 * Memoria de posición por sistema (tabla `system_parks`): el último punto donde
 * estuvo la nave de cada Emperador en cada sistema. Al volver, la nave llega
 * ahí (`EmperorService.move`), y un compañero puede pedir llegar a su lado.
 * Las regiones de espacio profundo no se recuerdan (no se salta a ellas).
 */
import { isDeepId, type Vec3 } from "@imperium/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { systemParks } from "../db/schema";
import type { Tx } from "../events/queue";

type Db = Database | Tx;

/** Guarda (o actualiza) el último punto de la nave de `emperorId` en `systemId`. */
export async function rememberPosition(db: Db, emperorId: string, systemId: string, p: readonly number[]): Promise<void> {
  if (isDeepId(systemId) || p.length !== 3 || !p.every(Number.isFinite)) return;
  const [x, y, z] = p as [number, number, number];
  await db
    .insert(systemParks)
    .values({ emperorId, systemId, x, y, z })
    .onConflictDoUpdate({ target: [systemParks.emperorId, systemParks.systemId], set: { x, y, z, updatedAt: sql`now()` } });
}

/** Último punto conocido de la nave de `emperorId` en `systemId`, o null si nunca estuvo. */
export async function recallPosition(db: Db, emperorId: string, systemId: string): Promise<Vec3 | null> {
  const [row] = await db
    .select({ x: systemParks.x, y: systemParks.y, z: systemParks.z })
    .from(systemParks)
    .where(and(eq(systemParks.emperorId, emperorId), eq(systemParks.systemId, systemId)))
    .limit(1);
  return row ? [row.x, row.y, row.z] : null;
}

/** Sistemas que recuerda un Emperador (para mostrar a sus compañeros dónde estuvo). */
export async function rememberedSystems(db: Db, emperorId: string): Promise<string[]> {
  const rows = await db.select({ systemId: systemParks.systemId }).from(systemParks).where(eq(systemParks.emperorId, emperorId));
  return rows.map((r) => r.systemId);
}
