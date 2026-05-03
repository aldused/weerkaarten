#!/usr/bin/env python3
"""
Blitzortung bliksem-ingestion voor weerlab.nl

Verbindt met Blitzortung WebSocket-feed, filtert ontladingen binnen NL+omgeving,
en schrijft de laatste 2 uur naar bliksem_strikes.json (atomic write).

Long-running daemon met auto-reconnect. Draaien via launchd (KeepAlive).

Test handmatig:
    python3 bliksem_ingest.py [--out PATH] [--bbox 3.0,50.0,8.0,54.0]
"""
import argparse
import json
import logging
import os
import random
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path

import websocket  # pip install websocket-client

# ── Configuratie ─────────────────────────────────────────────────────────────
BLITZORTUNG_HOSTS = [
    "wss://ws1.blitzortung.org/",
    "wss://ws7.blitzortung.org/",
    "wss://ws8.blitzortung.org/",
]
SUBSCRIBE = json.dumps({"a": 111})  # 111 = Europa-regio

# NW-Europa: BeNeLux + N-Frankrijk + W-Duitsland + ZO-Engeland
DEFAULT_BBOX = (-1.5, 48.0, 8.5, 54.5)  # lon_min, lat_min, lon_max, lat_max
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "bliksem_strikes.json"

WINDOW_SECONDS = 86400  # 24 uur (master-buffer)
SHORT_WINDOW_SECONDS = 7200  # 2 uur (snel-update bestand voor live view)
WRITE_INTERVAL = 30      # snel-bestand: elke 30s
LONG_WRITE_INTERVAL = 300  # 24u-bestand: elke 5 min
RECONNECT_BACKOFF = [2, 5, 10, 30, 60, 120]  # exponentiaal terug naar 120s max

R2_PUBLISH_SCRIPT = Path(__file__).resolve().parent / "r2_publish.sh"
LONG_FILENAME = "bliksem_strikes_24h.json"


# ── Blitzortung LZW-decoder ──────────────────────────────────────────────────
def lzw_decode(data: str) -> str:
    """Decodeer Blitzortung's LZW-achtige obfuscation naar JSON-string."""
    if not data:
        return ""
    dictionary = {}
    chars = list(data)
    current = chars[0]
    out = [current]
    prev = current
    code = 256
    for i in range(1, len(chars)):
        c = ord(chars[i])
        if c < 256:
            entry = chars[i]
        else:
            entry = dictionary.get(c, prev + current)
        out.append(entry)
        current = entry[0]
        dictionary[code] = prev + current
        code += 1
        prev = entry
    return "".join(out)


# ── Strike-buffer ────────────────────────────────────────────────────────────
class StrikeBuffer:
    """Threadsafe rolling buffer voor strikes binnen tijdvenster."""

    def __init__(self, window_seconds: int):
        self.window = window_seconds
        self.lock = threading.Lock()
        self.strikes: deque = deque()

    def add(self, strike: dict):
        with self.lock:
            self.strikes.append(strike)
            self._prune_locked()

    def _prune_locked(self):
        cutoff = time.time() - self.window
        while self.strikes and self.strikes[0]["t"] < cutoff:
            self.strikes.popleft()

    def snapshot(self) -> list:
        with self.lock:
            self._prune_locked()
            return list(self.strikes)


# ── WebSocket client ─────────────────────────────────────────────────────────
class BlitzortungClient:
    def __init__(self, buffer: StrikeBuffer, bbox: tuple, log: logging.Logger):
        self.buffer = buffer
        self.lon_min, self.lat_min, self.lon_max, self.lat_max = bbox
        self.log = log
        self.stop_event = threading.Event()
        self.host_idx = 0
        self.attempt = 0
        self.message_count = 0
        self.kept_count = 0

    def stop(self):
        self.stop_event.set()

    def _on_message(self, ws, message):
        try:
            decoded = lzw_decode(message)
            data = json.loads(decoded)
        except Exception as e:
            self.log.debug("decode-fout: %s", e)
            return

        self.message_count += 1
        try:
            lat = float(data["lat"])
            lon = float(data["lon"])
        except (KeyError, ValueError, TypeError):
            return

        if not (self.lat_min <= lat <= self.lat_max
                and self.lon_min <= lon <= self.lon_max):
            return

        # 'time' is in nanoseconden sinds epoch
        t_ns = data.get("time", time.time_ns())
        try:
            t_sec = float(t_ns) / 1e9
        except (TypeError, ValueError):
            t_sec = time.time()

        # 'alt' > 0 → cloud-cloud (IC), anders cloud-ground (CG)
        alt = data.get("alt", 0) or 0
        s_type = "IC" if alt and alt > 0 else "CG"
        pol = data.get("pol", 0)  # polariteit -1/0/+1
        # Stations die de strike detecteerden (kwaliteitsindicatie)
        sig_count = len(data.get("sig", [])) if isinstance(data.get("sig"), list) else 0

        self.buffer.add({
            "t": round(t_sec, 3),
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "type": s_type,
            "pol": pol,
            "alt": alt,
            "sig": sig_count,
        })
        self.kept_count += 1

    def _on_open(self, ws):
        self.log.info("verbonden — subscribe")
        ws.send(SUBSCRIBE)
        self.attempt = 0  # reset backoff

    def _on_error(self, ws, err):
        self.log.warning("ws fout: %s", err)

    def _on_close(self, ws, code, reason):
        self.log.info("ws gesloten code=%s reason=%s", code, reason)

    def run_forever(self):
        while not self.stop_event.is_set():
            host = BLITZORTUNG_HOSTS[self.host_idx]
            self.host_idx = (self.host_idx + 1) % len(BLITZORTUNG_HOSTS)
            self.log.info("verbinden met %s", host)
            try:
                ws = websocket.WebSocketApp(
                    host,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                    on_open=self._on_open,
                )
                ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as e:
                self.log.warning("connect-fout: %s", e)

            if self.stop_event.is_set():
                break

            backoff = RECONNECT_BACKOFF[min(self.attempt, len(RECONNECT_BACKOFF) - 1)]
            backoff = backoff + random.uniform(0, backoff * 0.3)
            self.attempt += 1
            self.log.info("reconnect over %.1fs (poging %d)", backoff, self.attempt)
            self.stop_event.wait(backoff)


# ── Periodieke writer ────────────────────────────────────────────────────────
def publish_to_r2(out_path: Path, log: logging.Logger):
    if not R2_PUBLISH_SCRIPT.exists():
        log.warning("r2_publish.sh niet gevonden op %s", R2_PUBLISH_SCRIPT)
        return
    try:
        result = subprocess.run(
            [str(R2_PUBLISH_SCRIPT), str(out_path)],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            log.warning("R2 upload faalde rc=%d: %s", result.returncode,
                        (result.stderr or result.stdout).strip())
    except subprocess.TimeoutExpired:
        log.warning("R2 upload timeout")
    except Exception as e:
        log.warning("R2 upload fout: %s", e)


def write_snapshot(out_path: Path, buffer: StrikeBuffer, client: BlitzortungClient,
                   window_sec: int, log: logging.Logger, publish: bool):
    snap_full = buffer.snapshot()
    cutoff = time.time() - window_sec
    snap = [s for s in snap_full if s["t"] >= cutoff] if window_sec < buffer.window else snap_full
    payload = {
        "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "window_seconds": window_sec,
        "count": len(snap),
        "received_total": client.message_count,
        "kept_total": client.kept_count,
        "strikes": snap,
    }
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    os.replace(tmp, out_path)
    if publish:
        publish_to_r2(out_path, log)
    return len(snap)


def writer_loop(buffer: StrikeBuffer, out_path: Path, client: BlitzortungClient,
                stop_event: threading.Event, log: logging.Logger,
                publish: bool = True):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    long_path = out_path.parent / LONG_FILENAME
    last_long_write = 0.0
    while not stop_event.is_set():
        try:
            short_count = write_snapshot(out_path, buffer, client,
                                         SHORT_WINDOW_SECONDS, log, publish)
            log.info("kort venster geschreven: %d strikes (ontvangen %d)",
                     short_count, client.message_count)
            now = time.time()
            if now - last_long_write >= LONG_WRITE_INTERVAL:
                long_count = write_snapshot(long_path, buffer, client,
                                            buffer.window, log, publish)
                last_long_write = now
                log.info("24u venster geschreven: %d strikes", long_count)
        except Exception as e:
            log.warning("write-fout: %s", e)
        stop_event.wait(WRITE_INTERVAL)


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Blitzortung → JSON ingest voor weerlab")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT,
                        help=f"output JSON (default: {DEFAULT_OUT})")
    parser.add_argument("--bbox", type=str,
                        default=",".join(map(str, DEFAULT_BBOX)),
                        help="lon_min,lat_min,lon_max,lat_max")
    parser.add_argument("--window", type=int, default=WINDOW_SECONDS,
                        help=f"tijdvenster in seconden (default: {WINDOW_SECONDS})")
    parser.add_argument("--no-publish", action="store_true",
                        help="upload niet naar R2 (voor lokaal testen)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    bbox = tuple(float(x) for x in args.bbox.split(","))
    if len(bbox) != 4:
        sys.exit("bbox moet 4 floats zijn (lon_min,lat_min,lon_max,lat_max)")

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("bliksem")
    log.info("start — bbox=%s out=%s window=%ds", bbox, args.out, args.window)

    buffer = StrikeBuffer(args.window)
    client = BlitzortungClient(buffer, bbox, log)
    stop_event = threading.Event()

    def shutdown(*_):
        log.info("shutdown signaal")
        stop_event.set()
        client.stop()
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    writer = threading.Thread(
        target=writer_loop,
        args=(buffer, args.out, client, stop_event, log),
        kwargs={"publish": not args.no_publish},
        daemon=True,
    )
    writer.start()

    client.run_forever()
    log.info("gestopt")


if __name__ == "__main__":
    main()
