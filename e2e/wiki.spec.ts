import { expect, test } from "@playwright/test";

const SHOTS = "test-results/capturas";

test("Wiki: página aparte, sin entrar al juego, con índice, enlaces, tablas del juego y buscador", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/wiki");
  await expect(page.getByRole("heading", { level: 1, name: "Wiki de Aeonarch" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/wiki-portada.png`, fullPage: true });

  // Enlace interno: cambia de artículo sin recargar y la URL es la del artículo.
  await page.locator(".wiki-article").getByRole("link", { name: "Economía en detalle" }).click();
  await expect(page).toHaveURL(/\/wiki\/economia\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Economía en detalle" })).toBeVisible();
  // Tabla generada con los datos del juego (instalaciones de @imperium/content).
  const installations = page.locator('table[data-table="instalaciones"]');
  await expect(installations.getByRole("cell", { name: "Refinería de aleaciones" })).toBeVisible();
  await expect(installations.getByRole("cell", { name: "Astillero" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/wiki-economia.png`, fullPage: true });

  // Carga directa de un artículo (y la ruta sin barra final).
  await page.goto("/wiki/pilotar");
  await expect(page.getByRole("heading", { level: 1, name: "Pilotar la nave" })).toBeVisible();
  await expect(page.locator('table[data-table="teclas-vuelo"]').getByRole("cell", { name: "Motor de pulso (encender / apagar)" })).toBeVisible();

  // Buscador.
  await page.getByLabel("Buscar en la Wiki").fill("cristal");
  await expect(page.getByRole("heading", { name: "Resultados de «cristal»" })).toBeVisible();
  await page.locator(".wiki-results").getByRole("link", { name: "Economía en detalle" }).click();
  await expect(page).toHaveURL(/\/wiki\/economia\/$/);

  // Cambio de idioma.
  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The economy in detail" })).toBeVisible();
  await page.getByRole("button", { name: "ES" }).click();

  // Artículo inexistente.
  await page.goto("/wiki/no-existe");
  await expect(page.getByText("Ese artículo no existe")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Wiki en el móvil: el índice se abre con el botón de menú", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/wiki/especies");
  await expect(page.getByRole("heading", { level: 1, name: "Especies" })).toBeVisible();
  await expect(page.locator(".wiki-card").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/wiki-movil.png`, fullPage: false });
  await page.getByRole("button", { name: "Índice" }).click();
  const nav = page.locator("#wiki-nav");
  await nav.getByRole("link", { name: "Guerra entre flotas" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Guerra entre flotas" })).toBeVisible();
  await page.getByRole("button", { name: "Índice" }).click();
  // Espera a que acabe la animación de entrada del índice.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/wiki-movil-indice.png`, fullPage: false });
  // Sin desbordamiento horizontal de la página.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("la portada del juego enlaza la Wiki", async ({ page }) => {
  await page.goto("/");
  const link = page.locator(".start-footer").getByRole("link", { name: "Wiki" });
  await expect(link).toHaveAttribute("href", "/wiki/");
  await expect(link).toHaveAttribute("target", "_blank");
});

test("Wiki: especies alienígenas e IA y territorios, con tablas generadas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/wiki/especies");
  await expect(page.getByRole("heading", { level: 1, name: "Especies" })).toBeVisible();
  await expect(page.locator('table[data-table="especies-resumen"]').getByRole("cell", { name: "Los Erradicadores" })).toBeVisible();
  await expect(page.locator('table[data-table="naves-alienigenas"]').getByRole("cell", { name: "Arca de la Estela" })).toBeVisible();
  // Ficha ampliada: filosofía, territorio y naves propias.
  const tharaxi = page.locator(".wiki-card").filter({ hasText: "THARAXI" });
  await expect(tharaxi.getByText("Filosofía")).toBeVisible();
  await expect(tharaxi.getByRole("cell", { name: "Zángano" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/wiki-especies.png`, fullPage: true });
  await page.goto("/wiki/ia-territorios");
  await expect(page.getByRole("heading", { level: 1, name: "IA y territorios" })).toBeVisible();
  await expect(page.locator('table[data-table="anillos"]')).toBeVisible();
  await expect(page.locator('table[data-table="ia-emperadores"]').getByRole("cell", { name: "Expansionista" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/wiki-ia-territorios.png`, fullPage: true });
  expect(errors).toEqual([]);
});
