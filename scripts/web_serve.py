"""Serves the repository for the web version (make web-serve), and the phone
apps the page builds (its Phone tab).

    python3 scripts/web_serve.py [PORT]

The page: like `python3 -m http.server`, bound to 127.0.0.1 (Web MIDI and
AudioWorklet need a secure context, which localhost is), with
`Cache-Control: no-store` so that a page reloaded after `make web` never mixes
old and new modules. It also answers the page's requests about phone apps:

    POST /pwa/apps      {"id": ID, "files": {PATH: BASE64}}: stores an app the
                        page built, in build/pwa/ID/
    GET  /pwa/info      the addresses a phone can install the apps from
    POST /pwa/tunnel    {"stop": false}: starts (or stops) an ngrok tunnel

The apps, read only, never the rest of the repository:

    https://LAN-IP:8443/ID/   on the local network, with the certificate of
                              make pwa-cert (build/pwa-cert), signed by a local
                              authority the phone trusts once
    http://LAN-IP:8080/       that authority's certificate, ca.crt, to install
    http://127.0.0.1:8001/    what the ngrok tunnel forwards: the same apps on
                              a public HTTPS address
"""

import base64
import functools
import http.server
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPS = os.path.join(ROOT, "build", "pwa")
CERT = os.path.join(ROOT, "build", "pwa-cert")
HTTPS_PORT = int(os.environ.get("PWA_HTTPS_PORT", "8443"))
CA_PORT = int(os.environ.get("PWA_CA_PORT", "8080"))
TUNNEL_PORT = int(os.environ.get("PWA_TUNNEL_PORT", "8001"))
# An app's id, as the page makes it, and the paths of its files.
APP_ID = re.compile(r"^[0-9]{8}-[0-9]{6}-[0-9a-z]{6}$")
APP_PATH = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$")
MAX_UPLOAD = 32 * 1024 * 1024

TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".crt": "application/x-x509-ca-cert",
}


def lan_ip():
    """The address of this machine on its local network (no packet is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Tunnel:
    """The ngrok process forwarding a public HTTPS address to TUNNEL_PORT."""

    def __init__(self):
        self.process = None
        self.url = None
        self.error = None
        self.lock = threading.Lock()

    def start(self):
        """Starts ngrok if it is not running with an address yet, and waits up
        to 10 s for its public HTTPS address (its local API, port 4040). Sets
        url, or error with the reason."""
        with self.lock:
            if self.process and self.process.poll() is None and self.url:
                return
            self._stop()
            self.error = None
            try:
                self.process = subprocess.Popen(
                    ["ngrok", "http", f"127.0.0.1:{TUNNEL_PORT}", "--log", "stdout"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except FileNotFoundError:
                self.error = "ngrok is not installed"
                return
            # Its public address, from its local API.
            for _ in range(50):
                time.sleep(0.2)
                if self.process.poll() is not None:
                    self.error = "ngrok stopped (is its authtoken configured? ngrok config check)"
                    return
                try:
                    with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=1) as r:
                        tunnels = json.load(r).get("tunnels", [])
                    urls = [t["public_url"] for t in tunnels if t.get("public_url", "").startswith("https://")]
                    if urls:
                        self.url = urls[0].rstrip("/") + "/"
                        return
                except (OSError, ValueError):
                    pass
            self.error = "ngrok gave no public address"

    def stop(self):
        """Stops ngrok, if running."""
        with self.lock:
            self._stop()

    def _stop(self):
        """Stops ngrok (terminated, killed after 3 s), the lock held."""
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None
        self.url = None


TUNNEL = Tunnel()


class PageHandler(http.server.SimpleHTTPRequestHandler):
    """The repository, for the page, and the page's /pwa/ requests."""

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def end_headers(self):
        """Every reply uncached: a reloaded page gets the files of the last build."""
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def reply(self, status, body):
        """Sends a JSON reply with its status."""
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        """The repository's files, and /pwa/info."""
        if self.path == "/pwa/info":
            return self.reply(200, info())
        return super().do_GET()

    def do_POST(self):
        """/pwa/apps and /pwa/tunnel, from the page only (this server listens on
        127.0.0.1; a request a site makes from another origin is refused), with
        a bounded JSON body."""
        # The page's own requests only: from this machine, same origin.
        origin = self.headers.get("Origin")
        if origin and not re.match(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$", origin):
            return self.reply(403, {"error": "the page's requests only"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_UPLOAD:
            return self.reply(413, {"error": f"more than {MAX_UPLOAD} bytes"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.reply(400, {"error": "not JSON"})
        if self.path == "/pwa/apps":
            return self.store(body)
        if self.path == "/pwa/tunnel":
            if body.get("stop"):
                TUNNEL.stop()
            else:
                TUNNEL.start()
            return self.reply(502 if TUNNEL.error else 200, info())
        return self.reply(404, {"error": "unknown request"})

    def store(self, body):
        """Stores an app the page built: its id of the page's form, its files'
        paths without '..' nor leading dot, their contents base64, and a
        directory that does not exist yet (an app is never overwritten). Replies
        201 with the addresses."""
        app_id = str(body.get("id", ""))
        files = body.get("files")
        if not APP_ID.match(app_id) or not isinstance(files, dict) or not files:
            return self.reply(400, {"error": "an id and files are required"})
        if any(not isinstance(p, str) or not APP_PATH.match(p) or ".." in p for p in files):
            return self.reply(400, {"error": "a file path is not allowed"})
        target = os.path.join(APPS, app_id)
        if os.path.exists(target):
            return self.reply(409, {"error": "this app exists already"})
        try:
            decoded = {p: base64.b64decode(d, validate=True) for p, d in files.items()}
        except (ValueError, TypeError):
            return self.reply(400, {"error": "a file is not base64"})
        for path, data in decoded.items():
            dest = os.path.join(target, path)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(data)
        return self.reply(201, {"id": app_id, **info()})


class AppsHandler(http.server.SimpleHTTPRequestHandler):
    """The stored apps, read only, without directory listings."""

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def end_headers(self):
        """Every reply revalidated."""
        # Revalidated: an installed app updates through its service worker.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def list_directory(self, path):
        """No listing: the apps' ids are not to be discovered."""
        self.send_error(404)
        return None

    def log_message(self, format, *args):
        """Silent: the page's server already prints its own log."""


class CaHandler(http.server.BaseHTTPRequestHandler):
    """The local authority's certificate, and how to trust it."""

    def do_GET(self):
        """/ca.crt (the certificate, to download) and / (how to trust it, in
        French and English); anything else is 404."""
        path = os.path.join(CERT, "ca.crt")
        if self.path == "/ca.crt" and os.path.exists(path):
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/x-x509-ca-cert")
            self.send_header("Content-Disposition", 'attachment; filename="faust-elements-ca.crt"')
        elif self.path == "/":
            data = (
                "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
                "<title>faust-elements</title><body style='font:17px/1.45 system-ui;padding:16px;max-width:40em'>"
                "<h1>Faire confiance à l'autorité locale</h1>"
                "<p><a href='/ca.crt' style='font-size:1.2em'>Télécharger faust-elements-ca.crt</a></p>"
                "<h2>Android</h2>"
                "<p>Toucher le fichier téléchargé est refusé (« Impossible d'installer les certificats CA ») : "
                "depuis Android 11, un certificat CA s'installe dans les Paramètres.</p>"
                "<ol><li>Paramètres, puis cherchez « certificat CA » (ou : Sécurité et confidentialité, "
                "Plus de paramètres de sécurité, Chiffrement et identifiants, Installer un certificat, Certificat CA ; "
                "Samsung : Sécurité et confidentialité, Autres paramètres de sécurité, Installer depuis le stockage, Certificat CA).</li>"
                "<li>Installer quand même.</li><li>Choisissez faust-elements-ca.crt dans Téléchargements.</li></ol>"
                "<p>Android demande un verrouillage de l'écran (code, schéma) pour installer un certificat.</p>"
                "<h2>iPhone</h2>"
                "<ol><li>Réglages, Profil téléchargé, Installer.</li>"
                "<li>Général, Informations, Réglages des certificats : activez la confiance totale pour lui.</li></ol>"
                "<p>Cette autorité ne peut certifier que des adresses locales (192.168.x.x, 10.x.x.x, 172.16-31.x.x, noms .local) : "
                "elle ne peut rien certifier sur Internet. Pour s'en passer : fabriquez l'application avec Internet (ngrok).</p>"
                "<hr><p lang=en><b>English.</b> Android 11 and later refuse a CA certificate opened from a download: "
                "Settings, search \"CA certificate\", Install anyway, pick the file in Downloads (a screen lock is required). "
                "iPhone: Settings, Profile Downloaded, Install; General, About, Certificate Trust Settings, full trust.</p>"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
        else:
            self.send_error(404)
            return
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        """Silent."""


def cert_ip():
    """The address the current certificate was made for (make pwa-cert), or None."""
    try:
        with open(os.path.join(CERT, "ip.txt")) as f:
            return f.read().strip()
    except OSError:
        return None


# Whether the local network's HTTPS server runs (it needs make pwa-cert).
SERVING = {"lan": False}


def info():
    """The addresses a phone can install the apps from: on the local network
    (this machine's address now, whether its server runs and its certificate is
    for that address), and the tunnel's public address or its error."""
    ip = lan_ip()
    certified = cert_ip()
    return {
        "lan": {
            "ip": ip,
            "serving": SERVING["lan"],
            "certified": certified == ip,
            "cert_ip": certified,
            "apps": f"https://{ip}:{HTTPS_PORT}/",
            "ca": f"http://{ip}:{CA_PORT}/",
        },
        "tunnel": {"url": TUNNEL.url, "error": TUNNEL.error},
    }


def serve(server, name):
    """Runs a server in a daemon thread (stopped with the page's server)."""
    threading.Thread(target=server.serve_forever, name=name, daemon=True).start()


def main():
    """Starts the apps' servers (the tunnel's always; the local network's HTTPS
    and the authority's when make pwa-cert has run), then the page's server,
    until Ctrl-C, which also stops the tunnel."""
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.makedirs(APPS, exist_ok=True)
    apps = functools.partial(AppsHandler, directory=APPS)
    serve(http.server.ThreadingHTTPServer(("127.0.0.1", TUNNEL_PORT), apps), "tunnel")
    crt = os.path.join(CERT, "server.crt")
    if os.path.exists(crt):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(crt, os.path.join(CERT, "server.key"))
        secure = http.server.ThreadingHTTPServer(("0.0.0.0", HTTPS_PORT), apps)
        secure.socket = context.wrap_socket(secure.socket, server_side=True)
        serve(secure, "https")
        serve(http.server.ThreadingHTTPServer(("0.0.0.0", CA_PORT), CaHandler), "ca")
        SERVING["lan"] = True
        ip = lan_ip()
        print(f"phone apps: https://{ip}:{HTTPS_PORT}/ID/, authority: http://{ip}:{CA_PORT}/", flush=True)
        if cert_ip() != ip:
            print(f"  the certificate is for {cert_ip()}, this machine is now {ip}: make pwa-cert", flush=True)
    else:
        print("phone apps on the local network: none until make pwa-cert", flush=True)
    page = functools.partial(PageHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), page) as server:
        print(f"faust-elements web: http://localhost:{port}/web/ (Ctrl-C to stop)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            TUNNEL.stop()


if __name__ == "__main__":
    main()
