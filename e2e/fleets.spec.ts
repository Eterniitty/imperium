import { awaken } from "./ui";
import { expect, test } from "@playwright/test";
import { generateSector, universeSeedFromString } from "@imperium/procgen";
import type { StarSystemSummary } from "@imperium/shared";
import { lastLoginLink } from "./mail";

const SHOTS = "test-results/capturas";
const SEED = universeSeedFromString(process.env.VITE_UNIVERSE_SEED || "imperium-alpha");

test("la flota inicial aparece, se envía a otro sistema y llega", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill("almirante@aeonarch.test");
  await page.getByRole("checkbox", { name: /acepto los términos/ }).check();
  await page.getByRole("button", { name: "Enviar enlace de acceso" }).click();
  const link = await lastLoginLink("almirante@aeonarch.test");
  await page.goto("about:blank");
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Nombre del Emperador").fill("Almirante Vex");
  await page.getByRole("button", { name: "Coronar" }).click();
  await awaken(page);
  // Se empieza pilotando: M lleva al mapa.
  await expect(page.locator(".flight-hud")).toBeVisible();
  await page.keyboard.press("KeyM");

  // La flota inicial: un explorador, en el sistema del Emperador.
  const fleets = page.locator(".fleets");
  await expect(fleets.getByText("Flota 1")).toBeVisible();
  await expect(fleets.getByText("1 × Explorador")).toBeVisible();
  const panel = page.locator("aside.side");
  await expect(panel.getByRole("heading", { name: "Tus flotas aquí" })).toBeVisible();

  // Selecciona otro sistema y envía la flota.
  const home = await panel.getByRole("heading", { level: 2 }).textContent();
  const target = generateSector(SEED, { x: 0, y: 0, z: 0 }).systems.find((s) => s.name !== home)!;
  await page.evaluate((s: StarSystemSummary) => {
    (window as unknown as { __imperium: { store: { getState(): { select(s: StarSystemSummary): void } } } }).__imperium.store.getState().select(s);
  }, target);
  await panel.getByRole("button", { name: "Enviar Flota 1 aquí" }).click();
  await expect(fleets.getByText(`Rumbo a ${target.name}`)).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/8-flota-en-camino.png` });

  // Llega: la cola de eventos del servidor la deja allí y el panel lo refleja.
  await expect(fleets.getByText(`En ${target.name}`)).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByRole("heading", { name: "Tus flotas aquí" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/9-flota-llegada.png` });
  expect(errors).toEqual([]);
});
