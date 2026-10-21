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
  await page.getByRole("checkbox", { name: /acepto los términos/ }).check();
  await page.getByRole("button", { name: "Enviar enlace de acceso" }).click();
  await expect(page.getByText(`Te hemos enviado un enlace a ${email}`)).toBeVisible();
  const link = await lastLoginLink(email);
  // Pasar por otra página: si solo cambiase el fragmento, el cliente no recargaría.
  await page.goto("about:blank");
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

test("nombrar al Emperador, entrar en su sistema, trasladarlo y que lo recuerde", async ({ page }) => {
  // Recorre muchas cosas (pilotar, saltar, ajustes, volver a entrar): necesita más de 60 s.
  test.setTimeout(150_000);
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

  // Al entrar, se empieza a los mandos de la nave, dentro del sistema del Emperador.
  await page.getByRole("button", { name: "Despertar" }).click();
  await expect(page.locator(".viewport canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: /Aurelia Varn/ })).toBeVisible();
  await expect(page.getByText("Exterior (T)")).toBeVisible();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/3-pilotando.png` });

  // Vuela un poco hacia delante y cambia a la cámara de cabina.
  await page.locator(".viewport canvas").click({ position: { x: 640, y: 400 } });
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1200);
  await page.keyboard.up("KeyW");
  await expect.poll(async () => Number(await page.locator(".flight-speed").innerText().then((t) => t.replace(/[^\d.]/g, "")))).toBeGreaterThan(0);
  await page.keyboard.press("KeyT");
  await expect(page.getByText("Cabina (T)")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/3b-cabina.png` });

  // M: al mapa galáctico, con su sistema seleccionado.
  await page.keyboard.press("KeyM");
  const panel = page.locator("aside.side");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(spawnName);
  await expect(panel.getByText("Tu Emperador está aquí")).toBeVisible();

  // Selecciona otro sistema (con el acceso de depuración del modo desarrollo) y salta.
  // El más cercano: el salto cuántico tiene el alcance de un depósito lleno.
  const core: StarSystemSummary[] = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) core.push(...generateSector(SEED, { x, y, z }).systems);
  const spawnId = await page.evaluate(() => {
    const w = (window as unknown as { __imperium: { world: { getState(): { myEmperorId: string; emperors: Record<string, { location: { systemId: string } }> } } } }).__imperium.world.getState();
    return w.emperors[w.myEmperorId]!.location.systemId;
  });
  const spawn = core.find((s) => s.id === spawnId)!;
  const dist = (s: StarSystemSummary) => Math.hypot(s.position.x - spawn.position.x, s.position.y - spawn.position.y, s.position.z - spawn.position.z);
  const target = core.filter((s) => s.id !== spawn.id && s.name !== spawnName).sort((a, b) => dist(a) - dist(b))[0]!;
  await page.evaluate((s: StarSystemSummary) => {
    (window as unknown as { __imperium: { store: { getState(): { select(s: StarSystemSummary): void } } } }).__imperium.store
      .getState()
      .select(s);
  }, target);
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(target.name);
  await panel.getByRole("button", { name: /Saltar aquí/ }).click();
  // Viaja: la barra superior muestra el destino y la cuenta atrás; la cámara sigue a la nave.
  // Antes del salto, la nave se alinea con el destino y carga el motor cuántico (unos segundos).
  await expect(page.getByText(`Viajando a ${target.name}`)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/4-viajando.png` });
  // Al llegar, entra pilotando en el sistema de destino.
  await expect(page.getByText(`Viajando a ${target.name}`)).toBeHidden({ timeout: 30_000 });
  await expect(page.locator(".flight-hud")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/5-llegado.png` });
  await page.keyboard.press("KeyM");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(target.name);
  await expect(panel.getByText("Tu Emperador está aquí")).toBeVisible();

  // Ajustes: cambiar la tecla del mapa a K y comprobar que funciona.
  await page.getByRole("button", { name: "Abrir los ajustes" }).click();
  await page.getByRole("tab", { name: "Controles" }).click();
  await page.getByRole("button", { name: "Mapa / pilotar 1" }).click();
  await expect(page.getByText("Pulsa una tecla…")).toBeVisible();
  await page.keyboard.press("KeyK");
  await page.screenshot({ path: `${SHOTS}/6-ajustes.png` });
  await page.getByRole("button", { name: "Cerrar", exact: true }).last().click();
  await page.keyboard.press("KeyK");
  await expect(page.locator(".flight-hud")).toBeVisible();

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
