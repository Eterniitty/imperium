import { expect, test } from "@playwright/test";
import { lastLoginLink } from "./mail";

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
  await expect(installations.getByRole("cell", { name: "Astillero", exact: true })).toBeVisible();
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

  // Naves: humanas, alienígenas y Carroñeros, con sus tablas generadas.
  await page.goto("/wiki/naves-alienigenas");
  await expect(page.getByRole("heading", { level: 1, name: "Naves alienígenas" })).toBeVisible();
  await expect(page.locator('table[data-table="naves-alienigenas"]').getByRole("cell", { name: "Arca de la Estela" })).toBeVisible();
  await page.goto("/wiki/naves");
  await expect(page.getByRole("heading", { level: 1, name: "Naves humanas" })).toBeVisible();
  await expect(page.locator('table[data-table="naves"]').getByRole("cell", { name: "Portanaves", exact: true })).toBeVisible();
  await expect(page.locator('table[data-table="naves"]').getByRole("cell", { name: "Astillero, Dique orbital, Refinería de aleaciones" }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/wiki-naves.png`, fullPage: true });
  await page.goto("/wiki/carroneros");
  await expect(page.getByRole("heading", { level: 1, name: "Carroñeros" })).toBeVisible();
  await expect(page.locator('table[data-table="carroneros-peligro"]').getByRole("cell", { name: "Nave nodriza (50 %)" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/wiki-carroneros.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("Wiki: panel de edición para administradores (editar, historial, restaurar, artículo nuevo y ocultarlo)", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => void d.accept());

  // Sin sesión no hay panel.
  await page.goto("/wiki/leyes");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Editar/ })).toHaveCount(0);

  // Entra con la cuenta de administrador (ADMIN_EMAILS del servidor de pruebas): la Wiki usa la misma sesión.
  const email = "wiki-admin@aeonarch.test";
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByRole("checkbox", { name: /acepto los términos/ }).check();
  await page.getByRole("button", { name: "Enviar enlace de acceso" }).click();
  const link = await lastLoginLink(email);
  await page.goto("about:blank");
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByLabel("Nombre del Emperador")).toBeVisible();

  // Editar «Las tres leyes»: vista previa en vivo y publicar.
  await page.goto("/wiki/leyes");
  await page.getByRole("button", { name: /Editar/ }).click();
  const text = page.getByLabel(/Texto del artículo en Markdown/);
  const original = await text.inputValue();
  await text.fill(`${original}\n\nLínea añadida en la prueba.\n\n{{tabla:minas}}`);
  await expect(page.locator(".wiki-editor-preview").getByText("Línea añadida en la prueba.")).toBeVisible();
  await expect(page.locator('.wiki-editor-preview table[data-table="minas"]')).toBeVisible();
  await page.getByLabel("Nota de la edición").fill("prueba e2e");
  await page.screenshot({ path: `${SHOTS}/wiki-editor.png`, fullPage: true });
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Publicado.")).toBeVisible();
  // Aviso: el inglés es anterior a esta edición en español.
  await expect(page.getByText(/La versión en inglés es anterior/)).toBeVisible();
  await page.getByRole("button", { name: "Cerrar el editor" }).click();
  await expect(page.locator(".wiki-article").getByText("Línea añadida en la prueba.")).toBeVisible();

  // Cualquiera (sin sesión) ve la versión publicada.
  const anon = await browser.newContext();
  const other = await anon.newPage();
  await other.goto("/wiki/leyes");
  await expect(other.locator(".wiki-article").getByText("Línea añadida en la prueba.")).toBeVisible();

  // Historial: diferencias con el texto del repositorio y volver a él.
  await page.getByRole("button", { name: /Editar/ }).click();
  await page.getByRole("tab", { name: "Historial" }).click();
  await expect(page.getByText("prueba e2e")).toBeVisible();
  await page.getByRole("button", { name: /Texto del repositorio/ }).click();
  await expect(page.getByTestId("wiki-diff").getByText("− Línea añadida en la prueba.")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/wiki-historial.png`, fullPage: true });
  await page.getByRole("button", { name: "Restaurar esta versión" }).click();
  await expect(page.getByText("Publicado.")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar el editor" }).click();
  await expect(page.locator(".wiki-article").getByText("Línea añadida en la prueba.")).toHaveCount(0);

  // Artículo nuevo, con una tabla del juego; se carga también directamente.
  await page.getByRole("button", { name: /Artículo nuevo/ }).click();
  await page.getByLabel("Título").fill("Rutas de prueba");
  await page.getByLabel("Dirección").fill("rutas-prueba");
  await page.getByLabel("Grupo del índice").selectOption("empire");
  await page.getByRole("button", { name: "Crear" }).click();
  await expect(page).toHaveURL(/\/wiki\/\?p=rutas-prueba$/);
  await page.getByLabel(/Texto del artículo en Markdown/).fill("# Rutas de prueba\n\nUn artículo nuevo.\n\n{{tabla:minas}}");
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Publicado.")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar el editor" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Rutas de prueba" })).toBeVisible();
  await expect(page.locator('.wiki-article table[data-table="minas"]')).toBeVisible();
  await expect(page.locator("#wiki-nav").getByRole("link", { name: "Rutas de prueba" })).toBeVisible();

  // Ocultarlo: los demás dejan de verlo.
  await page.getByRole("button", { name: /Editar/ }).click();
  await page.getByText("Artículo", { exact: true }).click();
  await page.getByRole("button", { name: "Ocultar el artículo" }).click();
  await expect(page.getByText("Artículo oculto: solo lo ven los administradores.")).toBeVisible();
  await other.goto("/wiki/?p=rutas-prueba");
  await expect(other.getByText("Ese artículo no existe")).toBeVisible();
  await anon.close();

  // En el móvil el editor cabe sin desbordar.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/wiki/leyes");
  await page.getByRole("button", { name: /Editar/ }).click();
  await expect(page.getByLabel(/Texto del artículo en Markdown/)).toBeVisible();
  await page.getByRole("tab", { name: "Vista previa" }).click();
  await expect(page.locator(".wiki-editor-preview h1")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/wiki-editor-movil.png`, fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
