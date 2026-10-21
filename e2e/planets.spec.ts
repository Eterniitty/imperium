import { awaken } from "./ui";
import { expect, test, type Page } from "@playwright/test";
import { lastLoginLink } from "./mail";

const SHOTS = "test-results/capturas";

type Mode = "orbit" | "low" | "star" | "starClose";

/**
 * Coloca la nave junto a un cuerpo (sin moverse) y la orienta hacia él:
 * - orbit: a unos 3 radios del planeta, por el lado iluminado, viendo el terminador;
 * - low: a 250 m de la superficie, mirando al horizonte;
 * - star / starClose: a 3 y 1,4 radios de la estrella.
 * Usa el acceso de depuración `window.__imperium` (los tipos de Three.js no hacen falta aquí).
 */
async function place(page: Page, index: number, mode: Mode) {
  await page.evaluate(
    ({ index, mode }) => {
      const sys = (window as any).__imperium.engine.system;
      const ship = sys.ship;
      const V = ship.position.constructor;
      const up = new V(0, 1, 0);
      let pos;
      let target;
      let shipUp = up;
      if (mode === "star" || mode === "starClose") {
        const R = sys.layout.starRadius;
        const dir = new V(0.3, 0.25, 1).normalize();
        pos = dir.multiplyScalar(R * (mode === "star" ? 3 : 1.4));
        target = new V(0, 0, 0);
        if (mode === "starClose") target = new V(0, R * 0.9, 0);
      } else {
        const p = sys.planets[index];
        const c = p.mesh.getWorldPosition(new V());
        const R = p.layout.size;
        const toSun = c.clone().negate().normalize();
        const side = new V().crossVectors(toSun, up).normalize();
        if (mode === "orbit") {
          // De lado respecto a la estrella: se ve el terminador y el lado nocturno.
          pos = c.clone().addScaledVector(toSun, 1.6 * R).addScaledVector(side, 3.2 * R).addScaledVector(up, 0.6 * R);
          target = c;
        } else {
          const n = toSun.clone().multiplyScalar(0.75).addScaledVector(side, 0.66).normalize();
          pos = c.clone().addScaledVector(n, R + 250);
          const tangent = new V().crossVectors(up, n).normalize();
          target = pos.clone().addScaledVector(tangent, R * 0.4).addScaledVector(n, -R * 0.03);
          // Con la superficie debajo: la vertical de la nave es la del suelo.
          shipUp = n;
        }
      }
      sys.flight.stop();
      ship.position.copy(pos);
      ship.up.copy(shipUp);
      ship.lookAt(target);
      ship.up.set(0, 1, 0);
      // La cámara de persecución salta a su sitio (si no, tardaría muchos fotogramas en llegar).
      sys.placeChaseCamera(1);
      // lookAt orienta +Z hacia el objetivo; la nave mira hacia -Z.
      ship.rotateY(Math.PI);
    },
    { index, mode },
  );
  // Unos fotogramas para que todo se asiente; con WebGL por software cada uno puede
  // tardar más de un segundo, así que se cuentan fotogramas, no tiempo.
  const start = await frames(page);
  await page.waitForFunction((n) => (window as any).__imperium.engine.renderer.info.render.frame >= n, start + 4, { timeout: 90_000 });
}

async function frames(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__imperium.engine.renderer.info.render.frame as number);
}

test("planetas y estrella de cerca, sin errores de shader", { tag: "@lento" }, async ({ page }) => {
  // Con WebGL por software, un planeta que llena la pantalla tarda en dibujarse.
  test.setTimeout(600_000);
  const shaderErrors: string[] = [];
  page.on("console", (msg) => {
    if (/Shader|WebGLProgram/.test(msg.text())) shaderErrors.push(msg.text());
  });
  page.on("pageerror", (err) => shaderErrors.push(`pageerror: ${err.message}`));
  await page.setViewportSize({ width: 960, height: 600 });

  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill("planetas@aeonarch.test");
  await page.getByRole("checkbox", { name: /acepto los términos/ }).check();
  await page.getByRole("button", { name: "Enviar enlace de acceso" }).click();
  const link = await lastLoginLink("planetas@aeonarch.test");
  await page.goto("about:blank");
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Nombre del Emperador").fill("Mirada Lejana");
  await page.getByRole("button", { name: "Coronar" }).click();
  await awaken(page);
  await expect(page.locator(".flight-hud")).toBeVisible();

  // El detalle del sistema llega del servidor.
  await page.waitForFunction(() => {
    const sys = (window as any).__imperium?.engine?.system;
    return sys && sys.planets.length > 0 && sys.ship;
  });
  // Pilota un poco (como un jugador) antes de colocar la nave a mano.
  await page.locator(".viewport canvas").click();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(800);
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: `${SHOTS}/planetas-inicio.png` });

  // Sin enviar posiciones: si no, el servidor devolvería la nave a su sitio. Se
  // redibuja el sistema con un planeta de cada tipo (solo en este navegador) y
  // los planetas se quedan quietos en su órbita para que la cámara no se quede atrás.
  const types = ["ocean", "gas_giant", "rocky", "lava", "toxic", "desert", "ice_giant", "ice", "barren"];
  await page.evaluate((types) => {
    const imp = (window as any).__imperium;
    imp.connection.send = () => {};
    const sys = imp.engine.system;
    const detail = imp.store.getState().detail;
    const base = detail.planets[0];
    const planets = types.map((type, i) => ({
      ...base,
      index: i,
      name: `Prueba ${i + 1}`,
      type,
      orbitAu: 0.4 + i * 0.6,
      radius: type.endsWith("giant") ? 9 : 1.2,
      moons: i === 0 ? [{ type: "barren", deposits: base.deposits }] : [],
    }));
    // Los anillos salen al azar (según el id del sistema): se prueba con ids
    // distintos hasta que algún gigante los tenga, para comprobar también su shader.
    for (let k = 0; k < 40; k++) {
      sys.build({ ...detail, summary: { ...detail.summary, id: `${detail.summary.id}-prueba-${k}` }, planets, belts: [] });
      if (sys.planets.some((p: any) => p.mesh.children.some((c: any) => c.material?.uniforms?.uInner))) break;
    }
    for (const p of sys.planets) p.layout = { ...p.layout, angularSpeed: 1e-12 };
    sys.pilot(null);
  }, types);
  // Un fotograma para que los planetas ocupen su sitio fijo antes de colocar la nave.
  const f0 = await frames(page);
  await page.waitForFunction((n) => (window as any).__imperium.engine.renderer.info.render.frame >= n, f0 + 2);

  // Todos de cerca; a ras de suelo, solo algunos (cada fotograma así tarda segundos sin GPU).
  for (let i = 0; i < types.length; i++) {
    await place(page, i, "orbit");
    await page.screenshot({ path: `${SHOTS}/planeta-${types[i]}-orbita.png` });
    if (!["ocean", "gas_giant", "lava"].includes(types[i]!)) continue;
    await place(page, i, "low");
    await page.screenshot({ path: `${SHOTS}/planeta-${types[i]}-superficie.png` });
  }
  await place(page, 0, "star");
  await page.screenshot({ path: `${SHOTS}/estrella.png` });
  await place(page, 0, "starClose");
  await page.screenshot({ path: `${SHOTS}/estrella-cerca.png` });

  expect(shaderErrors).toEqual([]);
});
