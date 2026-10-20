#!/usr/bin/env python3
"""
Vigilante de tráfico saliente (defensa contra la denegación económica).

Hetzner incluye 20 TB de tráfico saliente al mes y cobra el exceso. Este
script, ejecutado cada pocos minutos por un temporizador de systemd, acumula
los bytes enviados por la interfaz pública en el mes natural (en UTC, como
factura Hetzner) y:
  - al pasar el umbral de aviso, lo deja escrito en el registro del sistema;
  - al pasar el límite, detiene el servidor web (Caddy): el juego deja de
    servirse, pero el servidor sigue accesible por SSH. No lo vuelve a
    arrancar solo: lo decide una persona.

El contador de la interfaz se reinicia al reiniciar la máquina; el script lo
detecta y sigue sumando. Su estado vive en un JSON legible por cualquiera
(solo cifras), para consultarlo sin privilegios.

Uso:
  egress-watchdog.py              una comprobación (lo que hace el temporizador)
  egress-watchdog.py --status     muestra el estado, sin cambiar nada
Opciones de prueba: --state RUTA, --tx-bytes N, --month AAAA-MM, --dry-run.
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

TB = 10**12
LIMIT_BYTES = int(float(os.environ.get("EGRESS_LIMIT_TB", "15")) * TB)
WARN_BYTES = int(float(os.environ.get("EGRESS_WARN_TB", "12")) * TB)
STATE_PATH = "/var/lib/aeonarch-egress/state.json"
STOP_COMMAND = ["systemctl", "stop", "caddy"]


def log(message: str, priority: str = "info") -> None:
    """Al registro del sistema (journalctl -t aeonarch-egress) y a la salida."""
    print(message)
    try:
        subprocess.run(["logger", "-t", "aeonarch-egress", "-p", f"user.{priority}", message], check=False)
    except FileNotFoundError:
        pass


def public_interface() -> str:
    """Interfaz de la ruta por defecto (la pública)."""
    out = subprocess.run(["ip", "route", "show", "default"], capture_output=True, text=True, check=True).stdout.split()
    return out[out.index("dev") + 1]


def read_tx_bytes(iface: str) -> int:
    with open(f"/sys/class/net/{iface}/statistics/tx_bytes") as f:
        return int(f.read().strip())


def load_state(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(path: str, state: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def fmt_tb(n: int) -> str:
    return f"{n / TB:.3f} TB"


def step(state: dict, tx: int, month: str) -> tuple[dict, list[str]]:
    """
    Avanza el estado con la lectura actual del contador. Devuelve el estado
    nuevo y las acciones a tomar ("warn", "stop"). Función pura (sin E/S).
    """
    actions: list[str] = []
    s = dict(state)
    if s.get("month") != month:
        # Mes nuevo: se empieza de cero (el corte del mes anterior no se deshace solo).
        s = {"month": month, "bytes": 0, "last_tx": tx, "warned": False, "stopped": False, "stopped_previously": s.get("stopped", False)}
        return s, actions
    last = s.get("last_tx", tx)
    # Si el contador ha bajado, la máquina se reinició: todo lo leído es tráfico nuevo.
    delta = tx - last if tx >= last else tx
    s["bytes"] = s.get("bytes", 0) + delta
    s["last_tx"] = tx
    if s["bytes"] >= WARN_BYTES and not s.get("warned"):
        s["warned"] = True
        actions.append("warn")
    if s["bytes"] >= LIMIT_BYTES and not s.get("stopped"):
        s["stopped"] = True
        actions.append("stop")
    return s, actions


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--state", default=STATE_PATH)
    ap.add_argument("--tx-bytes", type=int)
    ap.add_argument("--month")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    state = load_state(args.state)
    if args.status:
        if not state:
            print("Sin datos todavía.")
            return 0
        print(f"Mes {state['month']}: {fmt_tb(state['bytes'])} enviados de {fmt_tb(LIMIT_BYTES)} (aviso a {fmt_tb(WARN_BYTES)}).")
        print("Servidor web DETENIDO por el vigilante este mes." if state.get("stopped") else "Servidor web sin cortar.")
        return 0

    month = args.month or datetime.now(timezone.utc).strftime("%Y-%m")
    tx = args.tx_bytes if args.tx_bytes is not None else read_tx_bytes(public_interface())
    new_state, actions = step(state, tx, month)
    new_state["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save_state(args.state, new_state)

    if "warn" in actions:
        log(f"AVISO: el tráfico saliente del mes ya es {fmt_tb(new_state['bytes'])} (aviso a {fmt_tb(WARN_BYTES)}, corte a {fmt_tb(LIMIT_BYTES)}).", "warning")
    if "stop" in actions:
        log(f"CORTE: tráfico saliente del mes {fmt_tb(new_state['bytes'])} ≥ {fmt_tb(LIMIT_BYTES)}. Se detiene Caddy para no pagar exceso. Revisa el servidor y arráncalo a mano.", "crit")
        if not args.dry_run:
            subprocess.run(STOP_COMMAND, check=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
