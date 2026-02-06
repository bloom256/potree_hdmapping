#!/usr/bin/env python3
"""Open a COPC point cloud (and optional trajectory) in the Potree viewer.

Usage: python visualize.py <pointcloud.copc.laz> [trajectory.json]

Starts a local HTTP server serving the project root and opens the viewer
in the default browser.
"""

import http.server
import os
import shutil
import socket
import sys
import threading
import urllib.parse
import webbrowser


def find_available_port(start=8080):
    """Find an available port starting from *start*."""
    for port in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("", port))
                return port
            except OSError:
                continue
    raise RuntimeError("No available port found")


def _place_in_project(filepath, project_root):
    """Ensure *filepath* is accessible under *project_root*.

    If already under project_root, return the relative path.
    Otherwise copy the file into a ``data/`` subdirectory and return
    that relative path.  This handles cross-drive paths on Windows.
    """
    abs_path = os.path.abspath(filepath)
    try:
        rel = os.path.relpath(abs_path, project_root)
        # relpath can succeed but produce a path that escapes the root
        if rel.startswith(".."):
            raise ValueError("outside project root")
    except ValueError:
        data_dir = os.path.join(project_root, "data")
        os.makedirs(data_dir, exist_ok=True)
        dest = os.path.join(data_dir, os.path.basename(abs_path))
        if os.path.abspath(dest) != abs_path:
            shutil.copy2(abs_path, dest)
            print(f"Copied {abs_path} -> {dest}")
        rel = os.path.relpath(dest, project_root)
    return rel.replace("\\", "/")


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <pointcloud.copc.laz> [trajectory.json]", file=sys.stderr)
        sys.exit(1)

    copc_path = sys.argv[1]
    trj_path = sys.argv[2] if len(sys.argv) >= 3 else None

    if not os.path.isfile(copc_path):
        print(f"Error: COPC file not found: {copc_path}", file=sys.stderr)
        sys.exit(1)

    # Resolve paths relative to project root (one level up from this script)
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    copc_rel = _place_in_project(copc_path, project_root)
    params = {"copc": copc_rel}

    if trj_path:
        if not os.path.isfile(trj_path):
            print(f"Warning: trajectory file not found: {trj_path}", file=sys.stderr)
        else:
            trj_rel = _place_in_project(trj_path, project_root)
            params["trj"] = trj_rel

    port = find_available_port()

    class RangeHandler(http.server.SimpleHTTPRequestHandler):
        """SimpleHTTPRequestHandler with HTTP Range support for COPC."""

        def log_request(self, code="-", size="-"):
            if self.path == "/favicon.ico":
                return
            super().log_request(code, size)

        def do_GET(self):
            range_header = self.headers.get("Range")
            if not range_header:
                return super().do_GET()

            path = self.translate_path(self.path)
            if not os.path.isfile(path):
                self.send_error(404)
                return

            file_size = os.path.getsize(path)
            # Parse "bytes=START-END"
            try:
                byte_range = range_header.replace("bytes=", "")
                parts = byte_range.split("-")
                start = int(parts[0]) if parts[0] else 0
                end = int(parts[1]) if parts[1] else file_size - 1
            except (ValueError, IndexError):
                self.send_error(416, "Invalid range")
                return

            if start >= file_size or end >= file_size or start > end:
                self.send_error(416, "Range not satisfiable")
                return

            length = end - start + 1
            ctype = self.guess_type(path)

            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()

            with open(path, "rb") as f:
                f.seek(start)
                self.wfile.write(f.read(length))

        def end_headers(self):
            self.send_header("Accept-Ranges", "bytes")
            super().end_headers()

    handler = RangeHandler
    server = http.server.ThreadingHTTPServer(("", port), handler)

    # Serve from project root
    os.chdir(project_root)

    query = urllib.parse.urlencode(params)
    url = f"http://localhost:{port}/index.html?{query}"

    print(f"Serving at http://localhost:{port}/")
    print(f"Opening {url}")

    threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server.shutdown()


if __name__ == "__main__":
    main()
