import { awaken } from "./ui";
import { expect, test } from "@playwright/test";
import { lastLoginLink } from "./mail";

const SHOTS = "test-results/capturas";

/** Entra con un Emperador nuevo. */
async function enter(page: import("@playwright/test").Page, email: string, name: string) {
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByRole("checkbox", { name: /acepto los términos/ }).check();
  await page.getByRole("button", { name: "Enviar enlace de acceso" }).click();
  const link = await lastLoginLink(email);
  await page.goto("about:blank");
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Nombre del Emperador").fill(name);
  await page.getByRole("button", { name: "Coronar" }).click();
  await awaken(page);
}

test("economía de la humanidad: créditos, tesoro, aportar y mercado", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await enter(page, "tesoro@aeonarch.test", "Tesorera Uno");

  // Los créditos se ven en la barra superior y abren el mercado.
  const credits = page.getByRole("button", { name: /Créditos/ });
  await expect(credits).toContainText("₢", { timeout: 20_000 });
  await page.getByRole("button", { name: "Humanidad", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Tesoro del Núcleo Humano" })).toBeVisible();
  await expect(dialog.getByText("Investigación del Núcleo")).toBeVisible();

  // Donar créditos a un proyecto: van al tesoro y aparece entre los contribuyentes.
  const project = dialog.locator("section.project", { hasText: "Investigación del Núcleo" });
  await project.getByText("Aportar").click();
  await project.getByLabel("Créditos").fill("25");
  await project.getByRole("button", { name: "Enviar aporte" }).click();
  await expect(project.getByText("Aporte enviado.")).toBeVisible();
  await expect(project.getByText(/Tesorera Uno \(25\)/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/economia-1-humanidad.png` });

  await dialog.getByRole("tab", { name: "Mercado" }).click();
  await expect(dialog.getByText("Mejor compra")).toBeVisible();
  await expect(dialog.getByText(/Necesitas una colonia/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/economia-2-mercado.png` });

  // En el móvil, el panel cabe en la pantalla.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${SHOTS}/economia-3-mercado-movil.png` });
  await dialog.getByRole("tab", { name: "Humanidad" }).click();
  await page.screenshot({ path: `${SHOTS}/economia-4-humanidad-movil.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // En el móvil, el botón «Humanidad» se oculta: los créditos abren el panel, que tiene las dos pestañas.
  await page.screenshot({ path: `${SHOTS}/economia-5-barra-movil.png` });
  await credits.click();
  await expect(dialog.getByRole("tab", { name: "Humanidad" })).toBeVisible();
  expect(errors).toEqual([]);
});
