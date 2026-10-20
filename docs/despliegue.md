# Aeonarch — Despliegue

Lista de comprobación del despliegue en **Hetzner CPX22** (Ubuntu 26.04, Núremberg).

> Este documento no contiene direcciones IP, contraseñas ni claves. No las añadas.

## Ya hecho

- [x] Usuario `imperium` con `sudo`.
- [x] Acceso **solo por clave SSH ed25519**.
- [x] Acceso de `root` bloqueado y autenticación por contraseña desactivada mediante `/etc/ssh/sshd_config.d/00-imperium.conf`.
- [x] **UFW** activo, solo con `OpenSSH` permitido.
- [x] `unattended-upgrades` activo (parches de seguridad automáticos).

## Despliegue del juego (sin sudo)

- **Cliente:** `./scripts/deploy-client.sh` compila y copia el cliente a `/var/www/aeonarch`. La carpeta pertenece al usuario `imperium`, así que no necesita sudo.
- **Servidor:** `./scripts/deploy-server.sh` compila el servidor y reinicia el servicio de usuario de systemd `aeonarch-server` (`deploy/aeonarch-server.service`). Escucha solo en `127.0.0.1:3000`; Caddy le pasa `/api/*` y `/ws`, detrás del mismo `basicauth`.
- Registro del servidor: `journalctl --user -u aeonarch-server -f`.
- Preparación única (con sudo): `sudo loginctl enable-linger imperium`, para que el servicio arranque con el sistema y no dependa de una sesión abierta.
- Caddy: la configuración de referencia está en `deploy/Caddyfile` (sin el hash de la contraseña).

## PRIORIDAD MÁXIMA antes de abrir al público

Hetzner **solo factura el tráfico saliente** (20 TB incluidos, ~1 €/TB adicional). Un ataque que descargue un archivo en bucle puede generar una factura. Estos puntos van **en este orden** y son obligatorios antes de publicar la dirección del juego:

1. [ ] **Archivos estáticos fuera del servidor.** Audio, texturas y código del cliente se sirven desde **Cloudflare R2 / caché de Cloudflare**, **nunca** desde el servidor. El servidor solo atiende API y WebSocket.
2. [ ] **Solo Cloudflare puede llegar al servidor.** El cortafuegos de Hetzner y UFW aceptan los puertos **80/443 únicamente desde los rangos IP de Cloudflare**. SSH es la única excepción. Mantener actualizada la lista de rangos.
3. [ ] **Límites por IP y por cuenta** en la API HTTP, en las conexiones/mensajes WebSocket y en cualquier descarga.
4. [ ] **Vigilante de tráfico saliente.** Mide el tráfico del mes, **avisa** al acercarse a un umbral y **corta automáticamente el acceso público** (cierra 80/443) al superar un umbral configurable (p. ej. **15 TB**). SSH sigue accesible para intervenir.

## Después

- [ ] Docker y Docker Compose.
- [ ] Caddy como proxy inverso con HTTPS (certificado de origen de Cloudflare o ACME).
- [ ] PostgreSQL (contenedor, volumen local, sin exponer puertos al exterior).
- [ ] Redis (contenedor, sin exponer puertos al exterior).
- [ ] **Copias de seguridad fuera del servidor** (p. ej. `pg_dump` cifrado a almacenamiento externo), con restauración probada.
- [ ] Correo: dominio propio con **SPF** y **DKIM** (y DMARC) para los enlaces mágicos. Verificar que `MAIL_TRANSPORT` no es `console` en producción.

## Costes

| Concepto | Importe |
|---|---|
| CPX22 | **19,49 € + IVA = 23,19 €/mes** (con tope mensual) |
| IPv4 primaria | **0,50 €/mes + IVA**, aparte |
| Tráfico saliente | 20 TB incluidos; ~1 €/TB adicional |

- **No activar** backups de Hetzner, volúmenes, balanceadores de carga ni otros servicios de pago **sin decidirlo antes**.
- **Apagar el servidor no detiene el cobro**: para dejar de pagar hay que **borrarlo**.
