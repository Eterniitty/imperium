#!/usr/bin/env bash
# Instala o actualiza el vigilante de tráfico saliente. Necesita sudo.
#   ./deploy/install-egress-watchdog.sh
set -euo pipefail
cd "$(dirname "$0")"
sudo install -o root -g root -m 0755 egress-watchdog.py /usr/local/sbin/aeonarch-egress-watchdog
sudo install -o root -g root -m 0644 aeonarch-egress.service aeonarch-egress.timer /etc/systemd/system/
sudo install -d -o root -g root -m 0755 /var/lib/aeonarch-egress
sudo systemctl daemon-reload
sudo systemctl enable --now aeonarch-egress.timer
sudo systemctl start aeonarch-egress.service
echo "==> Vigilante activo. Estado:"
/usr/bin/python3 -I /usr/local/sbin/aeonarch-egress-watchdog --status
