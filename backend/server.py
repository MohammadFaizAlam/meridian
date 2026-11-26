"""Pure-Python HTTP + SSE API server for the Meridian RL backend."""

from __future__ import annotations

import json
import os
import queue
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from forecaster import build_market_forecast
from market_data import CURATED_INSTRUMENTS, MarketDataError, fetch_market_data
from trainer import TrainingManager

PORT = int(os.environ.get("PY_BACKEND_PORT") or os.environ.get("PORT") or "8001")
HOST = os.environ.get("HOST", "0.0.0.0")
ALLOWED_ORIGINS = [
    o.strip().rstrip("/")
    for o in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]

manager = TrainingManager()


def _normalize_api_path(raw_path: str) -> str:
    """Accept both /api/* (direct Vercel calls) and /api/py/* (local Express proxy)."""
    path = raw_path.rstrip("/")
    if path.startswith("/api/py/"):
        return "/api/" + path[len("/api/py/"):]
    if path == "/api/py":
        return "/api"
    return path


class MeridianHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        client_ip = self.client_address[0] if self.client_address else "-"
        sys.stderr.write(f"[py-rl] {client_ip} - {format % args}\n")
        sys.stderr.flush()

    def _send_cors_headers(self) -> None:
        origin = (self.headers.get("Origin") or "").strip().rstrip("/")
        if not ALLOWED_ORIGINS or "*" in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", "*")
        elif origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        if length > 2 * 1024 * 1024:
            raise ValueError("Request body too large.")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = _normalize_api_path(parsed.path)
        qs = urllib.parse.parse_qs(parsed.query)

        try:
            if path in ("", "/api/health"):
                self._send_json(200, {"status": "ok", "engine": "python-3.11-rl-v2"})
                return

            if path == "/api/instruments":
                self._send_json(200, {"instruments": CURATED_INSTRUMENTS})
                return

            if path == "/api/market-data":
                symbol = (qs.get("symbol") or ["AAPL"])[0]
                interval = (qs.get("interval") or ["1d"])[0]
                range_str = (qs.get("range") or ["2y"])[0]
                split = float((qs.get("split") or ["0.75"])[0])
                refresh = (qs.get("refresh") or ["0"])[0] == "1"
                data = fetch_market_data(
                    symbol=symbol,
                    interval=interval,
                    range_str=range_str,
                    split_ratio=split,
                    force_refresh=refresh,
                )
                self._send_json(200, data)
                return

            if path == "/api/forecast":
                symbol = (qs.get("symbol") or ["AAPL"])[0]
                interval = (qs.get("interval") or ["1d"])[0]
                range_str = (qs.get("range") or ["2y"])[0]
                split = float((qs.get("split") or ["0.75"])[0])
                run_id = (qs.get("runId") or [""])[0].strip() or None

                market = fetch_market_data(
                    symbol=symbol,
                    interval=interval,
                    range_str=range_str,
                    split_ratio=split,
                    force_refresh=False,
                )
                weights, scaler, run_meta = manager.get_agent_context(run_id, market["meta"]["symbol"])
                forecast = build_market_forecast(
                    market=market,
                    agent_weights=weights,
                    agent_scaler=scaler,
                    run_meta=run_meta,
                )
                self._send_json(200, forecast)
                return

            if path == "/api/runs":
                self._send_json(200, {"runs": manager.list_runs()})
                return

            if path.startswith("/api/runs/"):
                parts = path.split("/")
                if len(parts) == 4:
                    self._send_json(200, manager.get_run(parts[3]))
                    return
                if len(parts) == 5 and parts[4] == "stream":
                    self._handle_sse_stream(parts[3])
                    return

            self._send_json(404, {"error": "Endpoint not found."})
        except MarketDataError as e:
            self._send_json(e.status_code, {"error": str(e)})
        except KeyError as e:
            self._send_json(404, {"error": str(e).strip("'")})
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:
            self._send_json(500, {"error": f"Internal engine error: {e}"})

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = _normalize_api_path(parsed.path)

        try:
            body = self._read_json_body()

            if path == "/api/runs/start":
                summary = manager.start_run(body)
                self._send_json(201, summary)
                return

            if path.startswith("/api/runs/"):
                parts = path.split("/")
                if len(parts) == 5:
                    run_id, action = parts[3], parts[4]
                    if action == "pause":
                        self._send_json(200, manager.pause_run(run_id))
                        return
                    if action == "resume":
                        self._send_json(200, manager.resume_run(run_id))
                        return
                    if action == "stop":
                        self._send_json(200, manager.stop_run(run_id))
                        return
                    if action == "backtest":
                        override_sym = body.get("symbol") if isinstance(body, dict) else None
                        result = manager.run_backtest(run_id, override_symbol=override_sym)
                        self._send_json(200, result)
                        return

            self._send_json(404, {"error": "Endpoint not found."})
        except MarketDataError as e:
            self._send_json(e.status_code, {"error": str(e)})
        except KeyError as e:
            self._send_json(404, {"error": str(e).strip("'")})
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:
            self._send_json(500, {"error": f"Internal engine error: {e}"})

    def do_DELETE(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = _normalize_api_path(parsed.path)
        try:
            if path.startswith("/api/runs/"):
                parts = path.split("/")
                if len(parts) == 4:
                    run_id = parts[3]
                    deleted = manager.delete_run(run_id)
                    if not deleted:
                        self._send_json(404, {"error": f"Run '{run_id}' not found."})
                        return
                    self._send_json(200, {"deleted": True, "id": run_id})
                    return
            self._send_json(404, {"error": "Endpoint not found."})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_sse_stream(self, run_id: str) -> None:
        snapshot = manager.get_run(run_id)
        q = manager.subscribe(run_id)

        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        try:
            self._write_sse("snapshot", snapshot)
            if snapshot["status"] in ("completed", "stopped", "error"):
                return

            while True:
                try:
                    msg = q.get(timeout=12.0)
                    self._write_sse(msg["event"], msg["data"])
                    if msg["event"] in ("done", "error"):
                        break
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    current = manager.get_run(run_id)
                    if current["status"] in ("completed", "stopped", "error"):
                        self._write_sse("done", {"runId": run_id, "status": current["status"], "run": current})
                        break
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            manager.unsubscribe(run_id, q)

    def _write_sse(self, event: str, data: Dict[str, Any]) -> None:
        payload = f"event: {event}\ndata: {json.dumps(data)}\n\n".encode("utf-8")
        self.wfile.write(payload)
        self.wfile.flush()


class MeridianHTTPServer(ThreadingHTTPServer):
    # On Windows, SO_REUSEADDR allows two processes to silently bind the same port.
    allow_reuse_address = os.name != "nt"


def main() -> None:
    server = MeridianHTTPServer((HOST, PORT), MeridianHandler)
    server.daemon_threads = True
    sys.stderr.write(f"[py-rl] Listening on http://{HOST}:{PORT}\n")
    sys.stderr.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
