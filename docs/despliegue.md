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
- Registro del servidor: `journalctl --user -u aeonarch-server -f`. Con `MAIL_TRANSPORT=console` (o `smtp` con `MAIL_LOG_LINKS=true`), los enlaces de acceso aparecen ahí: `journalctl --user -u aeonarch-server | grep 'Enlace de acceso'`.
- Base de datos: PostgreSQL del paquete de Ubuntu, solo escucha en local; el servidor entra por socket sin contraseña y aplica las migraciones al arrancar.
- Preparación única (con sudo): `sudo loginctl enable-linger imperium`, para que el servicio arranque con el sistema y no dependa de una sesión abierta.
- Caddy: la configuración de referencia está en `deploy/Caddyfile` (sin el hash de la contraseña).

## Correo real

Con `MAIL_TRANSPORT=smtp` el servidor envía el enlace de acceso por correo (texto + HTML, en el idioma del jugador, sin imágenes ni seguimiento) a través del SMTP de un **proveedor de correo transaccional**. No se envía desde el propio servidor: Hetzner bloquea la salida por los puertos 25 y 465 en los servidores nuevos y una IP de Hetzner sin reputación acabaría en spam. Se usa el puerto **587** (STARTTLS, obligatorio: la contraseña nunca viaja en claro).

### Opción A (la buena): proveedor + dominio propio

1. Compra un dominio (si aún no lo hay) y crea una cuenta en un proveedor transaccional: p. ej. Brevo, Mailjet, Resend, Amazon SES o Postmark. Muchos tienen un plan gratuito de unos cientos de correos al día, de sobra para enlaces de acceso.
2. En el panel del proveedor, **añade y verifica tu dominio**. El proveedor te dará unos registros DNS que se crean **en el panel DNS de tu dominio** (Cloudflare si el dominio está allí, o tu registrador). Copia los valores exactos que te dé; no los inventes:
   - **SPF** (registro `TXT` en el dominio): lista qué servidores pueden enviar correo en su nombre. Si ya tienes uno, se **amplía** con el `include:` del proveedor; nunca dos registros SPF.
   - **DKIM** (uno o varios registros `TXT` o `CNAME` en un subdominio que indica el proveedor, del tipo `algo._domainkey`): firma cada correo para demostrar que no se ha alterado y que lo envió quien dice.
   - **DMARC** (registro `TXT` en `_dmarc.tu-dominio`): le dice al receptor qué hacer si SPF/DKIM fallan. Empieza con una política suave (`p=none`) y, cuando todo funcione, endurécela (`quarantine` o `reject`).
3. Espera a que el proveedor marque el dominio como verificado y crea una **clave SMTP** (credencial solo para enviar, no la contraseña de tu cuenta).
4. Remitente: una dirección de ese dominio, p. ej. `no-reply@tu-dominio`.

### Opción B (provisional, mientras no haya dominio)

Algunos proveedores (p. ej. Brevo o Mailjet) permiten **verificar una sola dirección de remitente** (te mandan un correo de confirmación) sin dominio propio. Sirve para probar, pero **la entrega es peor**: sin SPF/DKIM de tu dominio, y si la dirección es de un servicio gratuito (Gmail, Proton…), el DMARC de ese servicio no autoriza al proveedor, así que muchos enlaces irán a **spam** o serán rechazados, y algunos proveedores ya no lo admiten. Comprueba también que el plan deja enviar a cualquier destinatario (en modo de pruebas, algunos solo envían a tu propia dirección).

**Proton Mail** solo permite SMTP en **planes de pago**, con un **token SMTP** generado en su configuración (no la contraseña de la cuenta), y según su documentación solo para direcciones de un dominio propio; no está pensado para correo automático. Para el juego es mejor un proveedor transaccional.

### Configurarlo en el servidor

Añade a `~/imperium/.env` (nunca en el repositorio; los valores salen del panel del proveedor):

```sh
MAIL_TRANSPORT=smtp
SMTP_HOST=servidor-smtp-del-proveedor
SMTP_PORT=587
SMTP_USER=usuario-smtp-del-proveedor
SMTP_PASS=clave-smtp-del-proveedor
MAIL_FROM="Aeonarch <no-reply@tu-dominio>"
# Opcional, solo en staging mientras pruebas: el enlace también sale en el registro.
MAIL_LOG_LINKS=true
```

- Si falta alguna de esas variables, el servidor **no arranca** y el registro dice cuál.
- `SMTP_SECURE=true` solo si el proveedor exige TLS directo (puerto 465, que Hetzner bloquea por defecto).
- `MAIL_LOG_LINKS` está **prohibida en production**; quítala cuando el correo funcione.

Comprobarlo:

1. `systemctl --user restart aeonarch-server`
2. `journalctl --user -u aeonarch-server -n 50`: al arrancar debe aparecer «Conexión SMTP comprobada». Si sale «No se pudo comprobar la conexión SMTP», revisa servidor, puerto, usuario y clave (la clave nunca se escribe en el registro).
3. Pide un enlace desde el juego con tu correo. Si no llega, mira la carpeta de spam y busca «No se pudo enviar el enlace de acceso» en el registro (el correo aparece enmascarado). El jugador recibe siempre la misma respuesta, falle o no el envío.
4. Para saber si acabará en spam, envíate un enlace a una cuenta de Gmail y mira «Mostrar original»: SPF, DKIM y DMARC deben decir `PASS`.

## PRIORIDAD MÁXIMA antes de abrir al público

Hetzner **solo factura el tráfico saliente** (20 TB incluidos, ~1 €/TB adicional). Un ataque que descargue un archivo en bucle puede generar una factura. Estos puntos van **en este orden** y son obligatorios antes de publicar la dirección del juego:

1. [ ] **Archivos estáticos fuera del servidor.** Audio, texturas y código del cliente se sirven desde **Cloudflare R2 / caché de Cloudflare**, **nunca** desde el servidor. El servidor solo atiende API y WebSocket.
2. [ ] **Solo Cloudflare puede llegar al servidor.** El cortafuegos de Hetzner y UFW aceptan los puertos **80/443 únicamente desde los rangos IP de Cloudflare**. SSH es la única excepción. Mantener actualizada la lista de rangos.
   - **IP real del jugador:** detrás de Cloudflare, la IP que ve Caddy es la del nodo de Cloudflare. Sin ajustar esto, los límites por IP se convierten en un bloqueo global del acceso. En Caddy: `trusted_proxies` con los rangos de Cloudflare y `client_ip_headers CF-Connecting-IP`.
3. [ ] **Límites por IP y por cuenta** en la API HTTP, en las conexiones/mensajes WebSocket y en cualquier descarga.
4. [ ] **Vigilante de tráfico saliente.** Mide el tráfico del mes, **avisa** al acercarse a un umbral y **corta automáticamente el acceso público** (cierra 80/443) al superar un umbral configurable (p. ej. **15 TB**). SSH sigue accesible para intervenir.

## Después

- [ ] Docker y Docker Compose.
- [ ] Caddy como proxy inverso con HTTPS (certificado de origen de Cloudflare o ACME).
- [x] PostgreSQL (paquete de Ubuntu, solo local, sin exponer puertos al exterior).
- [ ] Redis (contenedor, sin exponer puertos al exterior).
- [ ] **Copias de seguridad fuera del servidor** (p. ej. `pg_dump` cifrado a almacenamiento externo), con restauración probada.
- [x] Correo real por SMTP (`MAIL_TRANSPORT=smtp`, ver «Correo real»): STARTTLS obligatorio, configuración incompleta = el servidor no arranca, un fallo de envío no revela nada al jugador.
- [ ] Correo: dominio propio con **SPF**, **DKIM** y **DMARC** verificados en el proveedor. En producción, `MAIL_TRANSPORT=smtp` (el servidor ya rechaza `console`) y sin `MAIL_LOG_LINKS` (también la rechaza).
- [ ] `SMTP_PASS` es una clave SMTP del proveedor, solo en `~/imperium/.env` (nunca en el repositorio); si se filtra, revócala en el panel del proveedor y crea otra.

## Costes

| Concepto | Importe |
|---|---|
| CPX22 | **19,49 € + IVA = 23,19 €/mes** (con tope mensual) |
| IPv4 primaria | **0,50 €/mes + IVA**, aparte |
| Tráfico saliente | 20 TB incluidos; ~1 €/TB adicional |

- **No activar** backups de Hetzner, volúmenes, balanceadores de carga ni otros servicios de pago **sin decidirlo antes**.
- **Apagar el servidor no detiene el cobro**: para dejar de pagar hay que **borrarlo**.
