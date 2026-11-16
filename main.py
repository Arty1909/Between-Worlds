"""Запуск: python main.py. Нужен только Python 3.10+ и современный браузер."""
import argparse
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import secrets
import socket
import ipaddress
import threading
from urllib.parse import unquote, urlsplit
import webbrowser

from engine import Game, GameError

ROOT = Path(__file__).resolve().parent


class GameServer(ThreadingHTTPServer):
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        if args and str(args[1]) not in ("200", "206", "304"):
            super().log_message(format, *args)

    def _headers(self, code, content_type, length, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def _json(self, data, code=200):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._headers(code, "application/json; charset=utf-8", len(raw), {"Cache-Control": "no-store"})
        self.wfile.write(raw)

    def _valid_host(self):
        return self.headers.get("Host") in self.server.allowed_hosts

    def do_GET(self):
        self._get(False)

    def do_HEAD(self):
        self._get(True)

    def _get(self, head):
        if not self._valid_host():
            self.send_error(403)
            return
        route = unquote(urlsplit(self.path).path)
        if route == "/api/state" and not head:
            self._json({"state": self.server.game.view(), "token": self.server.token})
            return
        if route == "/":
            file = ROOT / "web" / "index.html"
        else:
            allowed = ("/web/", "/assets/", "/materials/", "/New folder (2)/")
            if not route.startswith(allowed):
                self.send_error(404)
                return
            file = (ROOT / route.lstrip("/")).resolve()
            roots = [(ROOT / x).resolve() for x in ("web", "assets", "materials", "New folder (2)")]
            if not any(file.is_relative_to(root) for root in roots):
                self.send_error(403)
                return
        if not file.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
        if file.suffix == ".js":
            content_type = "text/javascript; charset=utf-8"
        elif file.suffix in (".html", ".css"):
            content_type += "; charset=utf-8"
        total = file.stat().st_size
        start, end, code = 0, total - 1, 200
        headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-cache" if file.suffix in (".html", ".js", ".css") else "public, max-age=86400"}
        requested = self.headers.get("Range")
        if requested:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested.strip())
            if not match or not any(match.groups()):
                self._headers(416, content_type, 0, {"Content-Range": f"bytes */{total}"})
                return
            left, right = match.groups()
            if left:
                start = int(left)
                end = min(int(right), total - 1) if right else total - 1
            else:
                start = max(0, total - int(right))
            if start > end or start >= total:
                self._headers(416, content_type, 0, {"Content-Range": f"bytes */{total}"})
                return
            code = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{total}"
        length = end - start + 1
        self._headers(code, content_type, length, headers)
        if head:
            return
        try:
            with file.open("rb") as stream:
                stream.seek(start)
                while length > 0:
                    chunk = stream.read(min(256 * 1024, length))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    length -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_POST(self):
        expected_origin = f"http://{self.headers.get('Host')}"
        if (not self._valid_host() or self.headers.get("X-Game-Token") != self.server.token or
                self.headers.get("Origin", expected_origin) != expected_origin):
            self._json({"error": "Запрос отклонён. Открой игру по адресу из окна запуска."}, 403)
            return
        if self.path != "/api/action":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192:
                raise GameError("Некорректный размер запроса.")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise GameError("Некорректный запрос.")
            self._json({"state": self.server.game.act(payload)})
        except (ValueError, UnicodeError) as exc:
            self._json({"error": str(exc)}, 400)
        except OSError:
            self._json({"error": "Не удалось записать сохранение. Проверь свободное место и доступ к папке saves."}, 500)


def local_addresses():
    addresses = {"127.0.0.1", "localhost"}
    try:
        for result in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = result[4][0]
            if ipaddress.ip_address(address).is_private:
                addresses.add(address)
    except OSError:
        pass
    return addresses


def make_server(port=0, save_dir=None, lan=False):
    server = GameServer(("0.0.0.0" if lan else "127.0.0.1", port), Handler)
    server.allowed_hosts = {f"{host}:{server.server_port}" for host in (local_addresses() if lan else {"127.0.0.1", "localhost"})}
    server.game = Game(save_dir or ROOT / "saves")
    server.token = secrets.token_urlsafe(32)
    return server


def main():
    parser = argparse.ArgumentParser(description="Между мирами — интерактивная новелла")
    parser.add_argument("--port", type=int, default=0, help="Порт; по умолчанию выбирается свободный")
    parser.add_argument("--no-browser", action="store_true", help="Не открывать браузер автоматически")
    parser.add_argument("--save-dir", type=Path, default=ROOT / "saves")
    parser.add_argument("--lan", action="store_true", help="Разрешить игру с телефона в той же Wi-Fi сети")
    args = parser.parse_args()
    try:
        server = make_server(args.port, args.save_dir, args.lan)
    except OSError as exc:
        print(f"Не удалось запустить игру: {exc}")
        raise SystemExit(1)
    address = f"http://127.0.0.1:{server.server_port}"
    if args.lan:
        for host in sorted(server.allowed_hosts):
            if not host.startswith(("127.", "localhost")):
                print(f"  Телефон в той же Wi-Fi сети: http://{host}", flush=True)
    print(f"\n  МЕЖДУ МИРАМИ · Осколки ключа\n\n  Игра: {address}\n  Не закрывай это окно, пока играешь.\n  Для выхода нажми Ctrl+C.\n", flush=True)
    if not args.no_browser:
        threading.Timer(0.6, partial(webbrowser.open, address)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nПрогресс сохранён. До встречи между мирами!")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
