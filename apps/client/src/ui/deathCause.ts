import { HEAT_CAUSE, HORIZON_CAUSE, IMPACT_CAUSE, type I18nKey } from "@imperium/shared";

/** Causas de muerte sin nadie que derribe la nave (`destroyed.by`): choque, calor u horizonte de sucesos. */
const CAUSES: Record<string, { short: I18nKey; dead: I18nKey; notice: I18nKey }> = {
  [IMPACT_CAUSE]: { short: "lineage.cause.impact", dead: "lineage.dead.impact", notice: "combat.destroyedImpact" },
  [HEAT_CAUSE]: { short: "lineage.cause.heat", dead: "lineage.dead.heat", notice: "combat.destroyedHeat" },
  [HORIZON_CAUSE]: { short: "lineage.cause.horizon", dead: "lineage.dead.horizon", notice: "combat.destroyedHorizon" },
};

/** Textos de una causa de muerte natural, o undefined si la derribó alguien (su nombre; vacío: un Carroñero). */
export function naturalCause(by: string): { short: I18nKey; dead: I18nKey; notice: I18nKey } | undefined {
  return CAUSES[by];
}
