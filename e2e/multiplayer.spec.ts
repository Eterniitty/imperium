import { expect, test, type Browser, type Page } from "@playwright/test";
import type { EmperorView, StarSystemSummary } from "@imperium/shared";
import { lastLoginLink } from "./mail";

const SHOTS = "test-results/capturas";

interface Debug {
  __imperium: {
    store: { getState(): { select(s: StarSystemSummary | null): void } };
    world: { getState(): { emperors: Record<string, EmperorView>; myEmperorId: string | null } };
  };
}

/** Un jugador en su propio navegador (cookies separadas): entra, se corona y despierta. */
async function newPlayer(browser: Browser, email: string, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    throw e;
  });
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByRole("button", { name: "Enviar enlace de acceso" }).click();
  await expect(page.getByText(`Te hemos enviado un enlace a ${email}`)).toBeVisible();
  const link = await lastLoginLink(email);
  await page.goto("about:blank");
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Nombre del Emperador").fill(name);
  await page.getByRole("button", { name: "Coronar" }).click();
  await page.getByRole("button", { name: "Despertar" }).click();
  // Se empieza pilotando: M lleva al mapa.
  await expect(page.locator(".flight-hud")).toBeVisible();
  await page.keyboard.press("KeyM");
  await expect(page.getByText(/Servidor:\s*\d+ en línea/)).toBeVisible();
  return page;
}

const myEmperor = (page: Page) =>
  page.evaluate(() => {
    const w = (window as unknown as Debug).__imperium.world.getState();
    return w.emperors[w.myEmperorId!]!;
  });

const select = (page: Page, s: StarSystemSummary) =>
  page.evaluate((sys) => (window as unknown as Debug).__imperium.store.getState().select(sys), s);

test("dos jugadores se ven en el mismo universo y se ven moverse", async ({ browser }) => {
  // Incluye un viaje real entre sistemas del Núcleo (hasta ~40 s a la velocidad de prueba).
  test.setTimeout(180_000);
  const ana = await newPlayer(browser, "ana@aeonarch.test", "Ana Prima");
  const bruno = await newPlayer(browser, "bruno@aeonarch.test", "Bruno Segundo");

  // Por defecto solo se ven los compañeros: cada uno se ve solo a sí mismo.
  await expect(ana.getByText("1 en línea")).toBeVisible();
  await expect(bruno.getByText("1 en línea")).toBeVisible();

  // Se hacen compañeros desde los ajustes: Ana añade a Bruno y Bruno acepta.
  await ana.getByRole("button", { name: "Abrir los ajustes" }).click();
  await ana.getByRole("tab", { name: "Compañeros" }).click();
  await expect(ana.getByRole("radio", { name: "Solo mis compañeros" })).toHaveAttribute("aria-checked", "true");
  await ana.getByLabel("Añadir por nombre de Emperador").fill("bruno segundo");
  await ana.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(ana.getByText("Esperando a que te añadan")).toBeVisible();
  await ana.screenshot({ path: `${SHOTS}/6a-compañeros.png` });
  await ana.keyboard.press("Escape");

  await bruno.getByRole("button", { name: "Abrir los ajustes" }).click();
  await bruno.getByRole("tab", { name: "Compañeros" }).click();
  await expect(bruno.getByText("Te han añadido")).toBeVisible();
  await bruno.locator(".social-list li", { hasText: "Ana Prima" }).getByRole("button", { name: "Añadir" }).click();
  await expect(bruno.locator(".social-list li", { hasText: "Ana Prima" })).toBeVisible();
  await expect(bruno.getByText("Te han añadido")).toBeHidden();
  await bruno.keyboard.press("Escape");

  // Ya son compañeros: los dos se ven.
  await expect(ana.getByText("2 en línea")).toBeVisible();
  await expect(bruno.getByText("2 en línea")).toBeVisible();
  const anaE = await myEmperor(ana);
  const brunoE = await myEmperor(bruno);
  const brunoSeenByAna = await ana.evaluate(
    (id) => (window as unknown as Debug).__imperium.world.getState().emperors[id],
    brunoE.id,
  );
  expect(brunoSeenByAna).toMatchObject({ name: "Bruno Segundo", online: true });

  // Ana mira el sistema de Bruno: lo ve allí, conectado.
  const anaPanel = ana.locator("aside.side");
  const brunoSystem: StarSystemSummary = await bruno.evaluate(() => {
    // El sistema seleccionado al despertar es el del Emperador propio.
    return (window as unknown as { __imperium: { store: { getState(): { selected: StarSystemSummary } } } }).__imperium.store.getState().selected;
  });
  if (brunoE.location.systemId !== anaE.location.systemId) {
    await select(ana, brunoSystem);
    await expect(anaPanel.locator(".emperor-list li", { hasText: "Bruno Segundo" })).toContainText("conectado");
  }

  // Ana viaja al sistema de Bruno; Bruno la ve venir.
  await select(bruno, brunoSystem);
  await select(ana, brunoSystem);
  if (brunoE.location.systemId === anaE.location.systemId) test.skip(true, "Los dos aparecieron en el mismo sistema");
  await anaPanel.getByRole("button", { name: /Saltar aquí/ }).click();

  const brunoPanel = bruno.locator("aside.side");
  await expect(brunoPanel.getByRole("heading", { name: "En camino hacia aquí" })).toBeVisible();
  await expect(brunoPanel.locator(".emperor-list li", { hasText: "Ana Prima" })).toBeVisible();
  await bruno.waitForTimeout(800);
  await bruno.screenshot({ path: `${SHOTS}/6-bruno-ve-venir-a-ana.png` });

  // Al llegar, Bruno la tiene en su sistema.
  await expect(brunoPanel.locator(".emperor-list li", { hasText: "Ana Prima" })).toContainText("conectado", { timeout: 60_000 });
  await expect(brunoPanel.getByRole("heading", { name: "Emperadores aquí" })).toBeVisible();
  await bruno.screenshot({ path: `${SHOTS}/7-ana-llega.png` });
  expect((await myEmperor(ana)).travel?.to.systemId).toBe(brunoSystem.id);

  // Vuelo compartido: Ana entró pilotando al llegar; Bruno pasa a pilotar en su sistema.
  // Cada uno tiene la nave del otro en su espacio local.
  await bruno.keyboard.press("KeyM");
  await expect(bruno.locator(".flight-hud")).toBeVisible();
  const spaceShips = (page: Page) =>
    page.evaluate(() => {
      const space = (window as unknown as { __imperium: { space: { getState(): { ships: Record<string, { state: { name: string } }> } } } }).__imperium.space;
      return Object.values(space.getState().ships).map((s) => s.state.name);
    });
  await expect.poll(() => spaceShips(bruno), { timeout: 15_000 }).toEqual(["Ana Prima"]);
  await expect.poll(() => spaceShips(ana), { timeout: 15_000 }).toEqual(["Bruno Segundo"]);
  await bruno.waitForTimeout(500);
  await bruno.screenshot({ path: `${SHOTS}/7b-vuelo-compartido.png` });

  // Combate: HUD con escudo y casco; X fija a Ana como objetivo; F dispara el cañón.
  await expect(bruno.locator(".combat-self")).toContainText("Escudo");
  await expect(bruno.locator(".combat-self")).toContainText("Misiles 6/6");
  await bruno.keyboard.press("KeyX");
  await expect(bruno.locator(".combat-target")).toContainText("Ana Prima");
  await bruno.keyboard.down("KeyF");
  await bruno.waitForTimeout(600);
  await bruno.screenshot({ path: `${SHOTS}/7c-combate.png` });
  await bruno.keyboard.up("KeyF");
  await bruno.keyboard.press("KeyM");

  // Ana cierra el juego: Bruno la ve desconectada y el contador baja. Si el navegador
  // corta sin avisar, el servidor lo detecta en el siguiente latido (30 s como mucho).
  await ana.context().close();
  await expect(bruno.getByText("1 en línea")).toBeVisible({ timeout: 40_000 });
  await expect(brunoPanel.locator(".emperor-list li", { hasText: "Ana Prima" })).toContainText("desconectado");
  await bruno.context().close();
});
