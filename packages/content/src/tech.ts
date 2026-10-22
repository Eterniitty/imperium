/**
 * Tecnología por niveles (fase 4 del plan de juego, «la guerra que
 * evoluciona»): cinco ramas que se investigan con créditos y tiempo, una a la
 * vez por Emperador. Cada nivel mejora algo y desbloquea piezas y cascos del
 * Astillero (`PartDef.tech`, `HullDef.tech`).
 */
export type TechTree = "weapons" | "shields" | "propulsion" | "quantum" | "industry";
export const TECH_TREES: readonly TechTree[] = ["weapons", "shields", "propulsion", "quantum", "industry"];

export type TechLevels = Partial<Record<TechTree, number>>;

/** Requisito de tecnología de una pieza o casco. */
export interface TechRequirement {
  tree: TechTree;
  level: number;
}

export const TECH = {
  maxLevel: 5,
  /** Créditos y horas (de juego) para pasar al nivel 1, 2… 5. */
  credits: [600, 1800, 4500, 10_000, 20_000],
  hours: [1, 3, 6, 12, 24],
  /** Mejora por nivel de cada rama (fracción). */
  perLevel: {
    /** Ataque de las naves de flota en las batallas por rondas. */
    weapons: 0.08,
    /** Escudo de las naves de flota en las batallas por rondas. */
    shields: 0.08,
    /** Velocidad de las flotas entre estrellas. */
    propulsion: 0.06,
    /** Alcance de las flotas con el mismo combustible. */
    quantum: 0.08,
    /** Menos tiempo de construcción en las colonias. */
    industry: 0.05,
  } as Record<TechTree, number>,
} as const;

/** Nivel de una rama (0 si no se ha investigado). */
export function techLevel(levels: TechLevels | null | undefined, tree: TechTree): number {
  return Math.max(0, Math.min(TECH.maxLevel, levels?.[tree] ?? 0));
}

/** Multiplicador de una rama: 1 + mejora por nivel × nivel. */
export function techBonus(levels: TechLevels | null | undefined, tree: TechTree): number {
  return 1 + TECH.perLevel[tree] * techLevel(levels, tree);
}

/** ¿Cumple el requisito? */
export function meetsTech(levels: TechLevels | null | undefined, req: TechRequirement | undefined): boolean {
  return !req || techLevel(levels, req.tree) >= req.level;
}

export function isTechTree(id: string): id is TechTree {
  return (TECH_TREES as readonly string[]).includes(id);
}
