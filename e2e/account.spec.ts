import { expect, test } from "@playwright/test";
import { lastLoginLink } from "./mail";

const SHOTS = "test-results/capturas";

test("aceptar los términos, descargar los datos y borrar la cuenta", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const email = "borrable@aeonarch.test";

  // Sin aceptar los términos no se puede pedir el enlace.
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(email);
  const send = page.getByRole("button", { name: "Enviar enlace de acceso" });
  await expect(send).toBeDisabled();
  await expect(page.getByRole("link", { name: "Aviso legal" })).toHaveAttribute("href", "/legal/aviso-legal.html");
  await page.getByRole("checkbox", { name: /acepto los términos/ }).check();
  await page.screenshot({ path: `${SHOTS}/cuenta-1-acceso.png` });
  await send.click();
  const link = await lastLoginLink(email);
  await page.goto("about:blank");
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Nombre del Emperador").fill("Efimera Tal");
  await page.getByRole("button", { name: "Coronar" }).click();
  await page.getByRole("button", { name: "Despertar" }).click();

  await page.getByRole("button", { name: "Abrir los ajustes" }).click();
  await page.getByRole("tab", { name: "Cuenta" }).click();
  await expect(page.getByText(email)).toBeVisible();

  // Descargar mis datos: un JSON con la cuenta y el Emperador.
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Descargar mis datos" }).click();
  const download = await downloading;
  const path = await download.path();
  const data = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
  expect(data.account.email).toBe(email);
  expect(data.game.emperor.name).toBe("Efimera Tal");

  // Borrar: hace falta escribir la palabra de confirmación.
  await page.getByRole("button", { name: "Eliminar mi cuenta" }).click();
  const confirm = page.getByRole("button", { name: "Borrar para siempre" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Escribe BORRAR/).fill("borrar");
  await page.screenshot({ path: `${SHOTS}/cuenta-2-borrar.png` });
  await confirm.click();

  // Vuelve a la portada, sin sesión, con el aviso.
  await expect(page.getByText("Tu cuenta y todos tus datos se han borrado.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  expect(errors).toEqual([]);
});
