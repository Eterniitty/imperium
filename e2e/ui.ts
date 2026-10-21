import type { Page } from "@playwright/test";

/**
 * Pulsa «Despertar» en la portada. Tras crear el Emperador sale una vez el aviso de
 * fotosensibilidad, que tapa la portada: si aparece, se cierra con «Continuar».
 */
export async function awaken(page: Page): Promise<void> {
  const notice = page.getByRole("alertdialog", { name: "Aviso de fotosensibilidad" });
  await notice.waitFor({ state: "visible", timeout: 3_000 }).then(
    () => page.getByRole("button", { name: "Continuar" }).click(),
    () => undefined,
  );
  await page.getByRole("button", { name: "Despertar" }).click();
}
