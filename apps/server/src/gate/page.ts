/**
 * Página de la puerta de entrada (`/puerta/`): HTML propio, sin depender del
 * cliente del juego (que está detrás de la puerta). Fondo de estrellas
 * dibujado en un canvas, en español e inglés según el navegador.
 */
export const GATE_PAGE = /* html */ `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Aeonarch · Entrada</title>
<style>
  :root { color-scheme: dark; --gold: #e8b64c; --text: #e6ecf5; --muted: #8d9ab0; --panel: rgba(10, 16, 28, 0.78); --line: rgba(232, 182, 76, 0.35); --error: #ff8a6a; }
  * { box-sizing: border-box; }
  /* Lo oculto se oculta del todo (los títulos de las casillas tienen display propio). */
  [hidden] { display: none !important; }
  html, body { margin: 0; height: 100%; background: #04060c; color: var(--text); font-family: "Segoe UI", system-ui, -apple-system, sans-serif; }
  canvas { position: fixed; inset: 0; width: 100%; height: 100%; }
  main { position: relative; min-height: 100%; display: grid; place-items: center; padding: 24px 16px; }
  .card { width: min(380px, 100%); padding: 32px 28px 26px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 0 60px rgba(232, 182, 76, 0.08); backdrop-filter: blur(6px); }
  h1 { margin: 0; font-size: 34px; letter-spacing: 0.32em; text-transform: uppercase; color: var(--gold); text-align: center; font-weight: 600; padding-left: 0.32em; }
  .sub { margin: 6px 0 26px; text-align: center; color: var(--muted); font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; }
  label { display: block; font-size: 12px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; margin: 14px 0 6px; }
  input { width: 100%; padding: 11px 12px; font: inherit; font-size: 16px; color: var(--text); background: rgba(4, 8, 16, 0.85); border: 1px solid rgba(143, 220, 255, 0.25); border-radius: 6px; outline: none; }
  input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(232, 182, 76, 0.15); }
  button { margin-top: 22px; width: 100%; padding: 12px; font: inherit; font-size: 15px; letter-spacing: 0.18em; text-transform: uppercase; color: #120c02; background: var(--gold); border: 0; border-radius: 6px; cursor: pointer; font-weight: 600; }
  button:disabled { opacity: 0.6; cursor: default; }
  .error { min-height: 20px; margin: 14px 0 0; color: var(--error); font-size: 14px; text-align: center; }
  .device { margin: 18px 0 0; padding: 12px; border: 1px solid var(--line); border-radius: 6px; text-align: center; font-size: 15px; line-height: 1.4; }
  .foot { margin-top: 18px; text-align: center; font-size: 12px; color: var(--muted); }
  .foot a { color: var(--muted); }
  @media (prefers-reduced-motion: reduce) { canvas { display: none; } }
</style>
</head>
<body>
<canvas id="sky" aria-hidden="true"></canvas>
<main>
  <form class="card" id="gate" autocomplete="on">
    <h1>Aeonarch</h1>
    <p class="sub" data-t="sub">Alfa · acceso privado</p>
    <label for="user" data-t="user">Usuario</label>
    <input id="user" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required />
    <label for="password" data-t="password">Contraseña</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button type="submit" data-t="enter">Entrar</button>
    <p class="error" id="error" role="alert"></p>
    <p class="device" id="device" hidden><span data-t="device">El juego solo se puede jugar desde el navegador de un ordenador. Desde aquí puedes leer la Wiki.</span><br /><a href="/wiki/" data-t="wiki">Abrir la Wiki</a></p>
    <p class="foot"><a id="imprint" href="/legal/aviso-legal.html" data-t="imprint">Aviso legal (Impressum)</a> · <a id="privacy" href="/legal/privacidad.html" data-t="privacy">Privacidad (Datenschutz)</a></p>
  </form>
</main>
<script>
(() => {
  const en = !/^es\\b/i.test(navigator.language || "es");
  const T = en
    ? { sub: "Alpha · private access", user: "User", password: "Password", enter: "Enter", imprint: "Legal notice (Impressum)", privacy: "Privacy (Datenschutz)", wrong: "Wrong user or password.", limited: "Too many attempts. Wait a few minutes.", fail: "Could not connect. Try again.", device: "The game can only be played from a computer's web browser. From here you can read the Wiki.", wiki: "Open the Wiki" }
    : { sub: "Alfa · acceso privado", user: "Usuario", password: "Contraseña", enter: "Entrar", imprint: "Aviso legal (Impressum)", privacy: "Privacidad (Datenschutz)", wrong: "Usuario o contraseña incorrectos.", limited: "Demasiados intentos. Espera unos minutos.", fail: "No se pudo conectar. Inténtalo de nuevo.", device: "El juego solo se puede jugar desde el navegador de un ordenador. Desde aquí puedes leer la Wiki.", wiki: "Abrir la Wiki" };
  document.documentElement.lang = en ? "en" : "es";
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = T[el.dataset.t];
  if (en) {
    document.getElementById("imprint").href = "/legal/imprint.html";
    document.getElementById("privacy").href = "/legal/privacy.html";
  }

  const form = document.getElementById("gate");
  // Solo ordenadores: también las tabletas que se presentan como un Mac (pantalla táctil).
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const mobile = (navigator.userAgentData && navigator.userAgentData.mobile) || /Mobi|Android|iPhone|iPad|iPod|PlayStation|Xbox|Nintendo|SmartTV|SMART-TV|Tizen|webOS|Web0S|CrKey/i.test(ua);
  // Móviles y tabletas: se entra igual (con la credencial), pero solo a la Wiki.
  const handheld = touchMac || mobile || new URLSearchParams(location.search).has("dispositivo");
  if (handheld) document.getElementById("device").hidden = false;
  const error = document.getElementById("error");
  const button = form.querySelector("button");
  const asked = new URLSearchParams(location.search).get("next") || "/";
  const toWiki = asked === "/wiki" || asked.startsWith("/wiki/");
  const next = handheld && !toWiki ? "/wiki/" : asked;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    button.disabled = true;
    try {
      const res = await fetch("/puerta/entrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: form.user.value, password: form.password.value, next }),
      });
      if (res.ok) {
        const data = await res.json();
        location.replace(data.next || "/");
        return;
      }
      error.textContent = res.status === 429 ? T.limited : res.status === 401 ? T.wrong : res.status === 403 ? T.device : T.fail;
    } catch {
      error.textContent = T.fail;
    }
    button.disabled = false;
    form.password.select();
  });

  // Cielo de estrellas que titilan despacio (sin destellos).
  const c = document.getElementById("sky");
  const g = c.getContext("2d");
  let stars = [];
  const resize = () => {
    c.width = innerWidth * devicePixelRatio;
    c.height = innerHeight * devicePixelRatio;
    stars = Array.from({ length: Math.round((innerWidth * innerHeight) / 2600) }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, r: Math.random() * 1.3 + 0.2, p: Math.random() * 6.28, s: Math.random() * 0.6 + 0.2 }));
  };
  resize();
  addEventListener("resize", resize);
  const draw = (t) => {
    g.fillStyle = "#04060c";
    g.fillRect(0, 0, c.width, c.height);
    const glow = g.createRadialGradient(c.width * 0.5, c.height * 0.55, 0, c.width * 0.5, c.height * 0.55, Math.max(c.width, c.height) * 0.6);
    glow.addColorStop(0, "rgba(60, 46, 110, 0.35)");
    glow.addColorStop(1, "rgba(4, 6, 12, 0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, c.width, c.height);
    for (const s of stars) {
      g.globalAlpha = 0.55 + 0.45 * Math.sin(t / 1000 * s.s + s.p);
      g.fillStyle = "#dfe8ff";
      g.beginPath();
      g.arc(s.x, s.y, s.r * devicePixelRatio, 0, 6.283);
      g.fill();
    }
    g.globalAlpha = 1;
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
})();
</script>
</body>
</html>
`;
