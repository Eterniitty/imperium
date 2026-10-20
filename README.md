# Aeonarch

MMO espacial 3D para navegador. Cada jugador es un Emperador humano inmortal en un universo tridimensional infinito y en guerra permanente.

> Nombre interno del proyecto en el código: `imperium` (paquetes `@imperium/*`). El nombre del juego es **Aeonarch**.

**Estado: Fase 4 terminada — servidor autoritativo y multijugador.** Hay servidor (`apps/server`) con cuentas, acceso por enlace de correo, Emperador persistente y un mundo compartido por WebSocket: los jugadores se ven y se ven viajar. Las estrellas aún se generan en cada navegador (con la misma semilla que el servidor).

## Qué funciona ahora

- Pantalla de inicio en español e inglés.
- Universo procedural determinista sin límites, dividido en sectores cúbicos de 100 años luz.
- Mapa estelar 3D que carga y descarga sectores alrededor de la cámara (unos 3.500 sistemas visibles).
- Navegación libre: girar, acercar, desplazar y volar con el teclado.
- Selección e inspección de sistemas: clase estelar, energía, planetas, cinturones, anomalías y recursos.
- Vista de sistema con planetas, lunas, anillos y cinturones en órbita.
- Viaje a cualquier sector por coordenadas.
- Cuentas sin contraseña (enlace de un solo uso por correo) y un Emperador por cuenta, con nombre único.
- Multijugador: todos los Emperadores en el mapa con su nombre, quién está conectado y quién hay en cada sistema.
- Viaje del Emperador entre sistemas, validado en el servidor y visible en directo para los demás.

## Requisitos

- [Node.js](https://nodejs.org/) 22 o superior.
- [pnpm](https://pnpm.io/) 10. Si no lo tienes: `npm install -g pnpm` (o `corepack enable`).
- [PostgreSQL](https://www.postgresql.org/) 16 o superior, solo para el servidor de juego.

## Puesta en marcha

```bash
git clone https://github.com/Eterniitty/imperium.git
cd imperium
pnpm install
pnpm dev
```

Abre <http://localhost:5173> en el navegador y pulsa **Despertar**.

Para levantar también el servidor de juego necesitas PostgreSQL y un `.env` (copia `.env.example` y ajusta `DATABASE_URL`). En otra terminal:

```bash
pnpm dev:server
```

El servidor aplica las migraciones de la base de datos al arrancar. Con `MAIL_TRANSPORT=console`, el enlace de acceso aparece en su registro en lugar de enviarse por correo.

Vite redirige `/api` y `/ws` al servidor local (`127.0.0.1:3000`). Sin servidor, el cliente funciona igual y la barra superior muestra «Servidor: sin conexión».

### Configuración opcional

Copia `.env.example` como `.env` para cambiar la semilla del universo:

```bash
cp .env.example .env        # en Windows (CMD): copy .env.example .env
```

`VITE_UNIVERSE_SEED` define qué universo se genera. La misma semilla produce siempre el mismo universo. El archivo `.env` nunca se sube a GitHub.

## Controles

Se empieza a los mandos de la nave del Emperador, dentro de su sistema. Todas las teclas se cambian en **Ajustes (⚙)**; estas son las de por defecto.

| Pilotar la nave | |
|---|---|
| Orientar | Arrastrar con el ratón |
| Avanzar / frenar · lateral | W / S · A / D |
| Subir / bajar · alabeo | Espacio / C · Q / E |
| Girar | Flechas |
| Impulso | Mayús |
| Cámara primera / tercera persona | T |
| Salir del sistema | Volar más allá del borde |

| Mapa galáctico | |
|---|---|
| Girar · desplazar · acercar | Arrastrar · botón central o Mayús + arrastrar · rueda |
| Mover la cámara | W A S D, E / Q subir y bajar |
| Seleccionar · entrar a mirar un sistema | Clic · doble clic o Intro |
| Saltar a la estrella seleccionada | J |
| Centrar · deseleccionar | F · Esc |

| General | |
|---|---|
| Mapa / pilotar | M |

## Comprobaciones

```bash
pnpm test        # tests (generación procedural, contenido y servidor; los de base de datos necesitan TEST_DATABASE_URL)
pnpm typecheck   # tipos de TypeScript en todos los paquetes
pnpm build       # compilación de producción (apps/client/dist y apps/server/dist)
pnpm e2e         # pruebas en navegador (Playwright + Chromium sin ventana)
```

`pnpm e2e` arranca su propio servidor (puerto 3100) y cliente (5174) contra `TEST_DATABASE_URL`, que se vacía, así que no toca el juego en marcha. No lo ejecutes a la vez que `pnpm test`. Las capturas quedan en `test-results/capturas/`. La primera vez en una máquina nueva: `pnpm exec playwright install chromium` y, con sudo, `playwright install-deps chromium`.

## Estructura

```
apps/client        Cliente: React (interfaz) + Three.js (motor 3D propio)
apps/server        Servidor de juego: Fastify + PostgreSQL (Drizzle); cuentas por enlace de correo
packages/shared    Tipos, coordenadas, constantes e idiomas base (es/en)
packages/procgen   Generación determinista del universo (compartida con el futuro servidor)
packages/content   Fichas de especies, facciones y naves como datos
deploy/            Servicio de systemd y Caddyfile de referencia
scripts/           Scripts de despliegue en el servidor
docs/              Diseño, arquitectura y lista de despliegue
```

## Documentación

- [Diseño del juego](docs/diseno.md)
- [Arquitectura técnica](docs/arquitectura.md)
- [Despliegue y seguridad del servidor](docs/despliegue.md)

## Próxima fase

Por decidir (ver `CLAUDE.md`). Antes de abrir el juego al público hay que cumplir la lista de seguridad de `docs/despliegue.md`.
