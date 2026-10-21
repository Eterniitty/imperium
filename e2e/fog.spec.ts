import { awaken } from "./ui";
import { expect, test } from "@playwright/test";
import { generateSector, universeSeedFromString } from "@imperium/procgen";
import { distance, type StarSystemSummary } from "@imperium/shared";
import { lastLoginLink } from "./mail";

const SHOTS = "test-results/capturas";
const SEED = universeSeedFromString(process.env.VITE_UNIVERSE_SEED || "imperium-alpha");

type Imperium = {
  store: { getState(): { select(s: StarSystemSummary): void } };
  world: { getState(): { fleets: Record<string, { location: { systemId: string } }>; discovered: Record<string, true> } };
};

test("niebla de guerra: un sistema lejano sale sin explorar y, al llegar la flota, muestra sus planetas", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill("exploradora@aeonarch.test");
  await page.getByRole("checkbox", { name: /acepto los términos/ }).check();
  await page.getByRole("button", { name: "Enviar enlace de acceso" }).click();
  const link = await lastLoginLink("exploradora@aeonarch.test");
  await page.goto("about:blank");
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Nombre del Emperador").fill("Exploradora Nim");
  await page.getByRole("button", { name: "Coronar" }).click();
  await awaken(page);
  await expect(page.locator(".flight-hud")).toBeVisible();
  await page.keyboard.press("KeyM");

  const panel = page.locator("aside.side");
  const fleets = page.locator(".fleets");
  await expect(fleets.getByText("Flota 1")).toBeVisible();
  // El sistema propio está descubierto: se ven sus planetas (la lista llega del servidor).
  await expect(panel.getByRole("heading", { name: /^Planetas/ })).toBeVisible();
  await expect(panel.getByText("Sin explorar")).toHaveCount(0);

  // Un sistema del Núcleo Humano fuera del alcance de los escáneres, pero cerca para que la flota llegue pronto.
  const { home, discovered } = await page.evaluate(() => {
    const w = (window as unknown as { __imperium: Imperium }).__imperium.world.getState();
    return { home: Object.values(w.fleets)[0]!.location.systemId, discovered: Object.keys(w.discovered) };
  });
  const core: StarSystemSummary[] = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) core.push(...generateSector(SEED, { x, y, z }).systems);
  const homeSystem = core.find((s) => s.id === home)!;
  const target = core
    .filter((s) => !discovered.includes(s.id) && distance(s.position, homeSystem.position) > 30)
    .sort((a, b) => distance(a.position, homeSystem.position) - distance(b.position, homeSystem.position))[0]!;

  await page.evaluate((s: StarSystemSummary) => {
    (window as unknown as { __imperium: Imperium }).__imperium.store.getState().select(s);
  }, target);
  await expect(panel.getByRole("heading", { level: 2, name: target.name })).toBeVisible();
  await expect(panel.getByText("Sin explorar")).toBeVisible();
  await expect(panel.getByRole("heading", { name: /^Planetas/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/10-sin-explorar.png` });

  // Se envía la flota; al llegar, su escáner lo descubre y el panel muestra los planetas.
  await panel.getByRole("button", { name: "Enviar Flota 1 aquí" }).click();
  await expect(fleets.getByText(`En ${target.name}`)).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByRole("heading", { name: /^Planetas/ })).toBeVisible();
  await expect(panel.getByText("Sin explorar")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/11-explorado.png` });
  expect(errors).toEqual([]);
});
