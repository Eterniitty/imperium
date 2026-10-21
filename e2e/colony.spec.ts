import { expect, test } from "@playwright/test";
import { lastLoginLink } from "./mail";

const SHOTS = "test-results/capturas";

test("se reclama un planeta del sistema de inicio, se renombra y se construye una mina", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill("colona@aeonarch.test");
  await page.getByRole("button", { name: "Enviar enlace de acceso" }).click();
  const link = await lastLoginLink("colona@aeonarch.test");
  await page.goto("about:blank");
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Nombre del Emperador").fill("Colona Ilse");
  await page.getByRole("button", { name: "Coronar" }).click();
  await page.getByRole("button", { name: "Despertar" }).click();
  await expect(page.locator(".flight-hud")).toBeVisible();
  await page.keyboard.press("KeyM");

  // Los humanos de la nave del Emperador, en la barra superior.
  await expect(page.locator(".humans-stat")).toContainText("/ 500");

  // El sistema de inicio está seleccionado y explorado: se elige su primer planeta.
  const panel = page.locator("aside.side");
  const planets = panel.locator(".planet-list li");
  await expect(planets.first()).toBeVisible();
  await planets.first().click();
  const detail = panel.locator(".planet-detail");
  await expect(detail.getByText("Sin dueño")).toBeVisible();

  // Reclamar con los colonos mínimos (el valor por defecto).
  await detail.getByRole("button", { name: "Reclamar", exact: true }).click();
  await expect(detail.getByText("Tuyo")).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Existencias" })).toBeVisible();
  await expect(page.locator(".colonies")).toBeVisible();

  // Renombrar.
  await detail.getByRole("button", { name: "Renombrar" }).click();
  await detail.getByLabel("Nombre del planeta").fill("Nueva Esperanza");
  await detail.getByRole("button", { name: "Guardar" }).click();
  await expect(planets.first()).toContainText("Nueva Esperanza");
  await expect(page.locator(".colonies")).toContainText("Nueva Esperanza");

  // Encargar una mina: entra en la cola y, al terminar (evento del servidor), aparece construida.
  await detail.getByRole("button", { name: /^Mina/ }).click();
  await expect(detail.locator(".build-queue")).toContainText("Mina");
  await page.screenshot({ path: `${SHOTS}/10-colonia.png` });
  await expect(detail.locator(".build-queue")).toContainText("Nada en construcción", { timeout: 40_000 });
  await expect(detail.getByText("× 1")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/11-colonia-mina.png` });

  // Mantenimiento: la capital paga el de la flota inicial.
  await expect(detail.getByText("Capital", { exact: true })).toBeVisible();
  await expect(detail.getByText(/volátiles\/h/)).toBeVisible();

  // Encargar una central de energía y cancelarla: vuelve la cola vacía.
  await detail.getByRole("button", { name: /^Central de energía/ }).click();
  await expect(detail.locator(".build-queue")).toContainText("Central de energía");
  await detail.locator(".build-queue").getByRole("button", { name: "Cancelar" }).click();
  await expect(detail.locator(".build-queue")).toContainText("Nada en construcción");

  // Desembarcar humanos de la nave del Emperador (presente en el sistema).
  const population = async () => Number((await detail.innerText()).match(/Población\s+([\d.,]+)/)?.[1]?.replace(/[.,]/g, "") ?? 0);
  const before = await population();
  await detail.getByLabel(/Humanos a desembarcar/).fill("5");
  await detail.getByRole("button", { name: "Desembarcar" }).click();
  await expect.poll(population).toBeGreaterThanOrEqual(before + 5);

  // Logística: la Flota 1 (un explorador, bodega de 20) carga 10 de metal en la colonia y los descarga.
  const logistics = panel.locator(".logistics").first();
  await expect(logistics).toContainText("Bodega: 0 / 20");
  await logistics.getByLabel(/Metal/).fill("10");
  await logistics.getByRole("button", { name: "Cargar", exact: true }).click();
  await expect(logistics).toContainText("Bodega: 10 / 20");
  await expect(page.locator(".fleets:not(.colonies)")).toContainText("Lleva 10 recursos");
  await logistics.getByLabel(/Metal/).fill("10");
  await logistics.getByRole("button", { name: "Descargar", exact: true }).click();
  await expect(logistics).toContainText("Bodega: 0 / 20");
  expect(errors).toEqual([]);
});
