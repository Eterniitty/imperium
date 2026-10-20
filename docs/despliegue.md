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

1. [x] **Archivos estáticos desde la caché de Cloudflare** (20-10-2026). El juego está en `https://aeonarch.de` detrás del proxy de Cloudflare (plan Free, sin coste). Cloudflare guarda en caché los `.js`, `.css`, fuentes e imágenes; Caddy marca `/assets/*` (nombres con huella) como `public, max-age=31536000, immutable`. El HTML no se guarda en caché (es pequeño). Pendiente si un día pesa mucho (audio, texturas grandes): Cloudflare R2.
   - Nota mientras siga el `basicauth`: un recurso de `/assets/` ya guardado en la caché de Cloudflare se puede descargar sin contraseña conociendo su nombre con huella (que solo aparece en el `index.html`, protegido). Es el código del cliente, no datos.
2. [x] **Solo Cloudflare puede llegar al servidor** (20-10-2026). UFW acepta 80/443 únicamente desde los rangos de Cloudflare (22 reglas con el comentario `cloudflare`; https://www.cloudflare.com/ips/); SSH es la única excepción. Si Cloudflare publica rangos nuevos, añadirlos con `sudo ufw allow proto tcp from <rango> to any port 80,443 comment cloudflare`.
   - **Cifrado de extremo a extremo:** certificado de origen de Cloudflare en `/etc/caddy/certs/` (válido hasta 2041) y modo SSL **Full (strict)**. Copia del Caddyfile anterior: `/etc/caddy/Caddyfile.antes-cloudflare`. Referencia en `deploy/Caddyfile`.
   - **IP real del jugador:** Caddy pasa al juego `CF-Connecting-IP` como `X-Forwarded-For` (la Caddy 2.6 de Ubuntu no tiene `trusted_proxies`; es seguro porque solo entra tráfico de Cloudflare).
   - **Zona en Cloudflare** (configurada por API con el token de `CLOUDFLARE_API_TOKEN` en `~/imperium/.env`): HTTPS siempre, TLS ≥ 1.2, TLS 1.3, comprobación del navegador, y una regla de límite de peticiones para `/api/auth/request` (5 cada 10 s por IP y nodo). Pendiente (a mano, el token no tiene permiso): «Bot Fight Mode» en Seguridad → Bots.
3. [ ] **Límites por IP y por cuenta** en la API HTTP, en las conexiones/mensajes WebSocket y en cualquier descarga.
4. [x] **Vigilante de tráfico saliente.** Instalado (20-10-2026): `deploy/egress-watchdog.py`, servicio y temporizador `aeonarch-egress` (cada 5 min, como root). Acumula los bytes enviados por la interfaz pública en el mes natural (UTC; sobrevive a reinicios), **avisa** en el registro a 12 TB y a **15 TB detiene Caddy** (el juego deja de servirse; SSH sigue). No lo vuelve a arrancar solo.
   - Estado: `python3 -I /usr/local/sbin/aeonarch-egress-watchdog --status`. Avisos: `journalctl -t aeonarch-egress`.
   - Instalar o actualizar: `sudo ./deploy/install-egress-watchdog.sh`. Cambiar los umbrales: `EGRESS_LIMIT_TB` / `EGRESS_WARN_TB` en `deploy/aeonarch-egress.service`.
   - Tras un corte: revisar el tráfico, y si procede `sudo systemctl start caddy`.
   - Probado forzando el corte con un límite de 1 byte (detuvo Caddy) y restaurando.

## Después

- [ ] Docker y Docker Compose.
- [x] Caddy como proxy inverso con HTTPS (certificado de origen de Cloudflare).
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
