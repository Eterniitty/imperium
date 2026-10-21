import { createHmac } from "node:crypto";
import { ALIEN_AI, territoryRules } from "@imperium/content";
import {
  baseSystemTerritory,
  generateSector,
  isRelicSite,
  regionKey,
  regionOf,
  regionOwner,
  regionSectors,
  universeSeedFromString,
  type RegionCoord,
  type TerritoryOwner,
  type TerritoryRules,
} from "@imperium/procgen";
import { getFaction } from "@imperium/content";
import type { StarSystemSummary } from "@imperium/shared";
import { eq } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { alienClaims } from "../db/schema";
import { findSystem } from "../emperor/world";
import type { Tx } from "../events/queue";

/**
 * Semilla secreta de la capa de territorio: HMAC-SHA256 de una etiqueta fija
 * con `DETAIL_SEED`, recortado a 32 bits. Como el detalle de los sistemas, solo
 * la conoce el servidor (niebla de guerra). No cambia el detalle ya generado.
 */
export function territorySeed(detailSecret: string): number {
  return createHmac("sha256", detailSecret).update("territory:v1").digest().readUInt32LE(0);
}

/** Regiones con su dueño ya calculado (las cuentas son baratas, pero se repiten mucho). */
const OWNER_CACHE = 20_000;
/** Sistemas de una región (generar 8 sectores cuesta algo más). */
const REGION_CACHE = 256;

/**
 * Territorio alienígena (Fase 11): capa determinista de `@imperium/procgen`
 * con la semilla secreta, más los sistemas ganados por expansión (tabla
 * `alien_claims`, en memoria tras cargarla). No hace bucles por tick: todo se
 * calcula al consultarse.
 */
export class TerritoryService {
  readonly rules: TerritoryRules = territoryRules();
  readonly seed: number;
  readonly universeSeed: number;
  private claims = new Map<string, string>();
  private loading: Promise<void> | null = null;
  private owners = new Map<string, TerritoryOwner | null>();
  private regions = new Map<string, StarSystemSummary[]>();

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED" | "DETAIL_SEED">,
  ) {
    this.seed = territorySeed(config.DETAIL_SEED);
    this.universeSeed = universeSeedFromString(config.UNIVERSE_SEED);
  }

  /** Carga una vez la expansión guardada. */
  ensure(): Promise<void> {
    return (this.loading ??= (async () => {
      const rows = await this.db.select().from(alienClaims);
      this.claims = new Map(rows.map((r) => [r.systemId, r.factionId]));
    })().catch((err: unknown) => {
      this.loading = null;
      throw err;
    }));
  }

  regionOf(summary: Pick<StarSystemSummary, "sector">): RegionCoord {
    return regionOf(summary.sector, this.rules.regionSizeSectors);
  }

  /** Dueño de una región en la capa base (null = de nadie). */
  regionOwner(r: RegionCoord): TerritoryOwner | null {
    const key = regionKey(r);
    let o = this.owners.get(key);
    if (o === undefined) {
      o = regionOwner(this.seed, this.universeSeed, r, this.rules);
      if (this.owners.size >= OWNER_CACHE) this.owners.clear();
      this.owners.set(key, o);
    }
    return o;
  }

  /** Dueño de un sistema: la expansión manda sobre la capa base. Hay que haber llamado a `ensure`. */
  owner(summary: StarSystemSummary): TerritoryOwner | null {
    const claimed = this.claims.get(summary.id);
    if (claimed) {
      const f = getFaction(claimed);
      if (f) return { speciesId: f.speciesId, factionId: f.id };
    }
    return baseSystemTerritory(this.seed, this.universeSeed, summary, this.rules, this.regionOwner(this.regionOf(summary)));
  }

  /** ¿Hay ruinas precursoras? */
  relic(summary: StarSystemSummary): boolean {
    return isRelicSite(this.seed, summary, this.rules);
  }

  /** Dueño de un sistema por su id (null si no existe o es de nadie). */
  ownerOf(systemId: string): TerritoryOwner | null {
    const s = findSystem(this.universeSeed, systemId);
    return s ? this.owner(s) : null;
  }

  /** Todos los sistemas de una región. */
  regionSystems(key: string): StarSystemSummary[] {
    let list = this.regions.get(key);
    if (!list) {
      const [x, y, z] = key.split(":").map(Number) as [number, number, number];
      list = regionSectors({ x, y, z }, this.rules.regionSizeSectors).flatMap((c) => generateSector(this.universeSeed, c).systems);
      if (this.regions.size >= REGION_CACHE) this.regions.clear();
      this.regions.set(key, list);
    }
    return list;
  }

  /** Sistemas de una facción en una región (capa base y expansión). */
  factionSystems(key: string, factionId: string): StarSystemSummary[] {
    return this.regionSystems(key).filter((s) => this.owner(s)?.factionId === factionId);
  }

  /** Suma un sistema al territorio de una facción (expansión), dentro de la transacción del evento. */
  async addClaim(tx: Tx, systemId: string, factionId: string): Promise<boolean> {
    const rows = await tx.insert(alienClaims).values({ systemId, factionId }).onConflictDoNothing().returning({ systemId: alienClaims.systemId });
    if (rows.length === 0) return false;
    this.claims.set(systemId, factionId);
    return true;
  }

  /** Quita un sistema ganado (para los tests). */
  async removeClaim(systemId: string): Promise<void> {
    await this.db.delete(alienClaims).where(eq(alienClaims.systemId, systemId));
    this.claims.delete(systemId);
  }

  /** Vuelve a leer la expansión (tras borrar la base de datos en los tests). */
  async reload(): Promise<void> {
    this.loading = null;
    this.owners.clear();
    await this.ensure();
  }

  /** Lado de una región en sectores. */
  get regionSize(): number {
    return ALIEN_AI.regionSizeSectors;
  }
}
