import { expect, test, type Page } from "@playwright/test";
import { generateSector, universeSeedFromString } from "@imperium/procgen";
import type { StarSystemSummary } from "@imperium/shared";
import { lastLoginLink } from "./mail";

const SHOTS = "test-results/capturas";
const SEED = universeSeedFromString(process.env.VITE_UNIVERSE_SEED || "imperium-alpha");

/** Pide un enlace desde la pantalla de inicio, lo abre y confirma la entrada. */
async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByRole("button", { name: "Enviar enlace de acceso" }).click();
  await expect(page.getByText(`Te hemos enviado un enlace a ${email}`)).toBeVisible();
  const link = await lastLoginLink(email);
  // Pasar por otra página: si solo cambiase el fragmento, el cliente no recargaría.
  await page.goto("about:blank");
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

test("nombrar al Emperador, entrar en su sistema, trasladarlo y que lo recuerde", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await signIn(page, "jugadora@aeonarch.test");

  // Primera vez: hay que nombrar al Emperador. Un nombre no válido no pasa.
  await expect(page.getByRole("heading", { name: "Nombra a tu Emperador" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1-nombrar.png` });
  await page.getByLabel("Nombre del Emperador").fill("-X-");
  await page.getByRole("button", { name: "Coronar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Petición no válida. Revisa los datos.");
  await page.getByLabel("Nombre del Emperador").fill("Aurelia Varn");
  await page.getByRole("button", { name: "Coronar" }).click();

  const waiting = page.getByText(/^Aurelia Varn aguarda en /);
  await expect(waiting).toBeVisible();
  const spawnName = (await waiting.textContent())!.replace("Aurelia Varn aguarda en ", "");
  await page.screenshot({ path: `${SHOTS}/2-coronado.png` });

  // Al entrar, la cámara empieza en su sistema y lo tiene seleccionado.
  await page.getByRole("button", { name: "Despertar" }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: /Aurelia Varn/ })).toBeVisible();
  const panel = page.locator("aside.side");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(spawnName);
  await expect(panel.getByText("Tu Emperador está aquí")).toBeVisible();
  await page.waitForTimeout(1500); // que se dibujen las estrellas
  await page.screenshot({ path: `${SHOTS}/3-en-su-sistema.png` });

  // Selecciona otro sistema (con el acceso de depuración del modo desarrollo) y lo traslada.
  const target = generateSector(SEED, { x: 0, y: 0, z: 0 }).systems.find((s) => s.name !== spawnName)!;
  await page.evaluate((s: StarSystemSummary) => {
    (window as unknown as { __imperium: { store: { getState(): { select(s: StarSystemSummary): void } } } }).__imperium.store
      .getState()
      .select(s);
  }, target);
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(target.name);
  await panel.getByRole("button", { name: "Trasladar al Emperador aquí" }).click();
  // Viaja: la barra superior muestra el destino y la cuenta atrás; al llegar, está allí.
  await expect(page.getByText(`Viajando a ${target.name}`)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Trasladar al Emperador aquí" })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/4-viajando.png` });
  await expect(panel.getByText("Tu Emperador está aquí")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/5-llegado.png` });

  // Al recargar (sesión en cookie), el servidor recuerda dónde está.
  await page.reload();
  await expect(page.getByText(`Aurelia Varn aguarda en ${target.name}`)).toBeVisible();

  // Y también tras cerrar sesión y volver a entrar.
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await signIn(page, "jugadora@aeonarch.test");
  await expect(page.getByText(`Aurelia Varn aguarda en ${target.name}`)).toBeVisible();

  expect(errors).toEqual([]);
});

test("dos jugadores no pueden llevar el mismo nombre", async ({ page }) => {
  await signIn(page, "otra@aeonarch.test");
  await page.getByLabel("Nombre del Emperador").fill("AURELIA varn");
  await page.getByRole("button", { name: "Coronar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Ese nombre ya lo lleva otro Emperador. Elige otro.");
});
