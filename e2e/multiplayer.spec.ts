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
  // Incluye un viaje real entre sistemas del Núcleo (hasta ~30 s a la velocidad de prueba).
  test.setTimeout(120_000);
  const ana = await newPlayer(browser, "ana@aeonarch.test", "Ana Prima");
  const bruno = await newPlayer(browser, "bruno@aeonarch.test", "Bruno Segundo");

  // Los dos están en línea y cada uno ve al otro.
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
  await anaPanel.getByRole("button", { name: "Trasladar al Emperador aquí" }).click();

  const brunoPanel = bruno.locator("aside.side");
  await expect(brunoPanel.getByRole("heading", { name: "En camino hacia aquí" })).toBeVisible();
  await expect(brunoPanel.locator(".emperor-list li", { hasText: "Ana Prima" })).toBeVisible();
  await bruno.waitForTimeout(800);
  await bruno.screenshot({ path: `${SHOTS}/6-bruno-ve-venir-a-ana.png` });

  // Al llegar, Bruno la tiene en su sistema.
  await expect(brunoPanel.locator(".emperor-list li", { hasText: "Ana Prima" })).toContainText("conectado", { timeout: 30_000 });
  await expect(brunoPanel.getByRole("heading", { name: "Emperadores aquí" })).toBeVisible();
  await bruno.screenshot({ path: `${SHOTS}/7-ana-llega.png` });
  expect((await myEmperor(ana)).travel?.to.systemId).toBe(brunoSystem.id);

  // Ana cierra el juego: Bruno la ve desconectada y el contador baja. Si el navegador
  // corta sin avisar, el servidor lo detecta en el siguiente latido (30 s como mucho).
  await ana.context().close();
  await expect(bruno.getByText("1 en línea")).toBeVisible({ timeout: 40_000 });
  await expect(brunoPanel.locator(".emperor-list li", { hasText: "Ana Prima" })).toContainText("desconectado");
  await bruno.context().close();
});
