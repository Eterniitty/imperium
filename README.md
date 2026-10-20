# IMPERIUM

MMO espacial 3D para navegador. Cada jugador es un Emperador humano inmortal en un universo tridimensional infinito y en guerra permanente.

> Nombre provisional: el nombre comercial del juego está pendiente.

**Estado: Fase 3 — Prototipo local.** El universo se genera en el navegador; todavía no hay servidor, cuentas ni multijugador.

## Qué funciona ahora

- Pantalla de inicio en español e inglés.
- Universo procedural determinista sin límites, dividido en sectores cúbicos de 100 años luz.
- Mapa estelar 3D que carga y descarga sectores alrededor de la cámara (unos 3.500 sistemas visibles).
- Navegación libre: girar, acercar, desplazar y volar con el teclado.
- Selección e inspección de sistemas: clase estelar, energía, planetas, cinturones, anomalías y recursos.
- Vista de sistema con planetas, lunas, anillos y cinturones en órbita.
- Viaje a cualquier sector por coordenadas.

## Requisitos

- [Node.js](https://nodejs.org/) 22 o superior.
- [pnpm](https://pnpm.io/) 10. Si no lo tienes: `npm install -g pnpm` (o `corepack enable`).

## Puesta en marcha

```bash
git clone https://github.com/Eterniitty/imperium.git
cd imperium
pnpm install
pnpm dev
```

Abre <http://localhost:5173> en el navegador y pulsa **Despertar**.

### Configuración opcional

Copia `.env.example` como `.env` para cambiar la semilla del universo:

```bash
cp .env.example .env        # en Windows (CMD): copy .env.example .env
```

`VITE_UNIVERSE_SEED` define qué universo se genera. La misma semilla produce siempre el mismo universo. El archivo `.env` nunca se sube a GitHub.

## Controles

| Acción | Control |
|---|---|
| Girar la cámara | Arrastrar con botón izquierdo o derecho |
| Desplazar | Arrastrar con botón central, o Mayús + arrastrar |
| Acercar / alejar | Rueda del ratón |
| Volar | W A S D (o flechas), Q / E para bajar / subir |
| Viaje rápido | Mantener Mayús |
| Seleccionar sistema | Clic |
| Entrar en el sistema | Doble clic o Intro |
| Centrar la selección | F |
| Volver / deseleccionar | Esc |

## Comprobaciones

```bash
pnpm test        # tests (generación procedural y contenido)
pnpm typecheck   # tipos de TypeScript en todos los paquetes
pnpm build       # compilación de producción del cliente (apps/client/dist)
```

## Estructura

```
apps/client        Cliente: React (interfaz) + Three.js (motor 3D propio)
packages/shared    Tipos, coordenadas, constantes e idiomas base (es/en)
packages/procgen   Generación determinista del universo (compartida con el futuro servidor)
packages/content   Fichas de especies, facciones y naves como datos
docs/              Diseño, arquitectura y lista de despliegue
```

## Documentación

- [Diseño del juego](docs/diseno.md)
- [Arquitectura técnica](docs/arquitectura.md)
- [Despliegue y seguridad del servidor](docs/despliegue.md)

## Próxima fase

Fase 4: servidor autoritativo, acceso por correo electrónico con enlace de un solo uso, Emperador persistente por cuenta y dos jugadores compartiendo el mismo universo.
