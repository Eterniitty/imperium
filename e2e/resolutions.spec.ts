import { expect, test, type Page } from "@playwright/test";
import { lastLoginLink } from "./mail";

const SHOTS = "test-results/capturas";
const SIZES = [
  { width: 1024, height: 640 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

/** Nada de la interfaz se sale de la ventana ni se desborda. */
async function checkLayout(page: Page, label: string) {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bar = document.querySelector(".topbar") as HTMLElement | null;
    if (bar && bar.scrollWidth > bar.clientWidth + 1) out.push(`barra superior desbordada (${bar.scrollWidth} > ${bar.clientWidth})`);
    for (const el of document.querySelectorAll<HTMLElement>(".hud .panel")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) out.push(`${el.className} fuera de la ventana`);
    }
    return out;
  });
  expect(problems, label).toEqual([]);
}

test("la interfaz cabe en distintas resoluciones, pilotando y en el mapa", { tag: "@lento" }, async ({ page }) => {
  // Cuatro tamaños con capturas: en la máquina de pruebas (2 CPU, WebGL por software) ronda los 2 minutos.
  test.setTimeout(420_000);
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill("pantallas@aeonarch.test");
  await page.getByRole("checkbox", { name: /acepto los términos/ }).check();
  await page.getByRole("button", { name: "Enviar enlace de acceso" }).click();
  const link = await lastLoginLink("pantallas@aeonarch.test");
  await page.goto("about:blank");
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Nombre del Emperador").fill("Vista Amplia");
  await page.getByRole("button", { name: "Coronar" }).click();
  await page.getByRole("button", { name: "Despertar" }).click();
  await expect(page.locator(".flight-hud")).toBeVisible();

  for (const size of SIZES) {
    const tag = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await page.waitForTimeout(600);
    await checkLayout(page, `pilotando ${tag}`);
    // Capturas solo en un tamaño: sin GPU, dibujar 2560×1440 tarda demasiado (lo que importa aquí es la maquetación).
    if (size.width === 1366) await page.screenshot({ path: `${SHOTS}/res-${tag}-pilotando.png` });

    await page.keyboard.press("KeyM");
    await expect(page.locator("aside.side")).toBeVisible();
    await page.waitForTimeout(600);
    await checkLayout(page, `mapa ${tag}`);
    if (size.width === 1366) await page.screenshot({ path: `${SHOTS}/res-${tag}-mapa.png` });

    await page.getByRole("button", { name: "Abrir los ajustes" }).click();
    await expect(page.getByRole("dialog")).toBeInViewport();
    if (size.width === 1366) await page.screenshot({ path: `${SHOTS}/res-${tag}-ajustes.png` });
    await page.keyboard.press("Escape");
    await page.keyboard.press("KeyM");
    await expect(page.locator(".flight-hud")).toBeVisible();
  }
});
