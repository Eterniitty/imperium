import { createHmac } from "node:crypto";
import type { DeepRegionView } from "@imperium/shared";
import { asteroidLeft, generateDeepRegion, type AsteroidDepletion, type DeepRegion } from "@imperium/sim";
import { eq, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { asteroidDepletion } from "../db/schema";

/**
 * Semilla secreta del contenido del espacio profundo: HMAC-SHA256 de una
 * etiqueta fija con `DETAIL_SEED`, recortado a 32 bits (como el territorio).
 * Solo la conoce el servidor: el cliente recibe el contenido de una región
 * solo al estar en ella.
 */
export function deepSpaceSeed(detailSecret: string): number {
  return createHmac("sha256", detailSecret).update("deepspace:v1").digest().readUInt32LE(0);
}

/** Regiones en memoria (su contenido y lo minado de cada asteroide). */
const REGION_CACHE = 512;

interface RegionState {
  region: DeepRegion;
  depletion: Map<number, AsteroidDepletion>;
  loaded: Promise<void> | null;
}

/**
 * Espacio profundo: contenido determinista de cada región (semilla secreta) y
 * estado de la minería de sus asteroides (tabla `asteroid_depletion`, con
 * copia en memoria). Lo usa `SpaceService` para el láser de minería.
 */
export class DeepSpaceService {
  private readonly seed: number;
  private readonly regions = new Map<string, RegionState>();

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "DETAIL_SEED">,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = deepSpaceSeed(config.DETAIL_SEED);
  }

  private state(regionId: string): RegionState | null {
    let s = this.regions.get(regionId);
    if (!s) {
      const region = generateDeepRegion(this.seed, regionId);
      if (!region) return null;
      s = { region, depletion: new Map(), loaded: null };
      if (this.regions.size >= REGION_CACHE) {
        const oldest = this.regions.keys().next().value;
        if (oldest !== undefined) this.regions.delete(oldest);
      }
      this.regions.set(regionId, s);
    }
    return s;
  }

  /** Contenido de una región (sin estado), o null si el id no es de una región. */
  region(regionId: string): DeepRegion | null {
    return this.state(regionId)?.region ?? null;
  }

  /** Carga (una vez) lo minado de los asteroides de una región. */
  async load(regionId: string): Promise<void> {
    const s = this.state(regionId);
    if (!s) return;
    s.loaded ??= (async () => {
      const rows = await this.db.select().from(asteroidDepletion).where(eq(asteroidDepletion.regionId, regionId));
      for (const r of rows) s.depletion.set(r.asteroid, { mined: r.mined, at: r.at.getTime() });
    })().catch((err: unknown) => {
      s.loaded = null;
      throw err;
    });
    await s.loaded;
  }

  /** Unidades que le quedan a un asteroide ahora. */
  left(regionId: string, index: number, now = this.now()): number {
    const s = this.state(regionId);
    const a = s?.region.asteroids[index];
    if (!s || !a) return 0;
    return asteroidLeft(a.amount, s.depletion.get(index), now);
  }

  /** Lo que ve el cliente al entrar: contenido y unidades que quedan en cada asteroide. */
  async view(regionId: string): Promise<DeepRegionView | null> {
    const s = this.state(regionId);
    if (!s) return null;
    await this.load(regionId);
    const now = this.now();
    return {
      regionId,
      kind: s.region.kind,
      asteroids: s.region.asteroids,
      left: s.region.asteroids.map((a) => Math.round(asteroidLeft(a.amount, s.depletion.get(a.i), now) * 10) / 10),
    };
  }

  /**
   * Extrae `units` de un asteroide (lo que quede, como mucho) y lo guarda.
   * Devuelve las unidades extraídas y las que le quedan.
   */
  async mine(regionId: string, index: number, units: number): Promise<{ taken: number; left: number }> {
    const s = this.state(regionId);
    const a = s?.region.asteroids[index];
    if (!s || !a || units <= 0) return { taken: 0, left: 0 };
    await this.load(regionId);
    const now = this.now();
    const before = asteroidLeft(a.amount, s.depletion.get(index), now);
    const taken = Math.min(units, before);
    if (taken <= 0) return { taken: 0, left: before };
    // Lo minado se cuenta desde ahora (lo regenerado hasta aquí ya está incluido).
    const dep: AsteroidDepletion = { mined: a.amount - (before - taken), at: now };
    s.depletion.set(index, dep);
    await this.db
      .insert(asteroidDepletion)
      .values({ regionId, asteroid: index, mined: dep.mined, at: new Date(now) })
      .onConflictDoUpdate({ target: [asteroidDepletion.regionId, asteroidDepletion.asteroid], set: { mined: sql`excluded.mined`, at: sql`excluded.at` } });
    return { taken, left: before - taken };
  }
}
