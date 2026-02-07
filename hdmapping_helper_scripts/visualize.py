#!/usr/bin/env python3
"""Convert LAZ + trajectory CSV and open in the Potree viewer.

Usage: python visualize.py <input.laz> [trajectory.csv]

Steps:
1. Converts LAZ to classic Potree DB via PotreeConverter (auto-downloaded)
2. Converts trajectory CSV to JSON (if provided)
3. Starts a local HTTP server and opens the viewer in a browser
"""

import csv
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
import zipfile


def log(msg):
    print(f"[visualize] {msg}")


def find_available_port(start=8080):
    """Find an available port starting from *start*."""
    for port in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("", port))
                log(f"Found available port: {port}")
                return port
            except OSError:
                continue
    raise RuntimeError("No available port found")


def convert_trajectory_csv(csv_path, output_path):
    """Convert trajectory CSV to JSON array of [x, y, z] positions."""
    log(f"Reading trajectory CSV: {csv_path}")
    positions = []
    skipped = 0
    with open(csv_path, "r", newline="") as f:
        reader = csv.reader(f)
        for row_num, row in enumerate(reader, start=1):
            if len(row) < 4:
                skipped += 1
                continue
            try:
                x = float(row[1])
                y = float(row[2])
                z = float(row[3])
            except (ValueError, IndexError):
                skipped += 1
                continue
            positions.append([x, y, z])

    if skipped:
        log(f"Skipped {skipped} unparseable rows")

    log(f"Writing {len(positions)} trajectory positions to {output_path}")
    with open(output_path, "w") as f:
        json.dump(positions, f, separators=(",", ":"))
    log(f"Trajectory JSON written ({os.path.getsize(output_path)} bytes)")


def parse_converter_links(links_path):
    """Parse potree_converte_links.txt → {platform: {url, sha256}}."""
    log(f"Reading converter links from {links_path}")
    with open(links_path, "r") as f:
        lines = [l.strip() for l in f if l.strip()]

    if len(lines) < 4:
        raise RuntimeError(f"Expected 4 lines in {links_path}, got {len(lines)}")

    result = {
        "linux": {
            "url": lines[0],
            "sha256": lines[1].replace("sha256:", ""),
        },
        "windows": {
            "url": lines[2],
            "sha256": lines[3].replace("sha256:", ""),
        },
    }
    log(f"  Linux URL:   {result['linux']['url']}")
    log(f"  Linux SHA:   {result['linux']['sha256']}")
    log(f"  Windows URL: {result['windows']['url']}")
    log(f"  Windows SHA: {result['windows']['sha256']}")
    return result


def verify_sha256(filepath, expected):
    """Verify SHA256 hash of a file."""
    log(f"Computing SHA256 of {filepath} ...")
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    actual = h.hexdigest()
    log(f"  SHA256: {actual}")
    if actual != expected:
        raise RuntimeError(
            f"SHA256 mismatch for {filepath}:\n  expected: {expected}\n  actual:   {actual}"
        )
    log("  SHA256 OK")


def find_or_download_converter(project_root):
    """Find PotreeConverter or download it.

    Returns the path to the PotreeConverter executable.
    """
    converter_dir = os.path.join(project_root, "potree_converter")
    log(f"Looking for PotreeConverter in {converter_dir}")

    if sys.platform == "win32":
        exe_name = "PotreeConverter.exe"
    else:
        exe_name = "PotreeConverter"

    exe_path = os.path.join(converter_dir, exe_name)
    if os.path.isfile(exe_path):
        log(f"Found PotreeConverter at {exe_path}")
        return exe_path

    # Also check for nested directory (zip might extract into a subdirectory)
    log(f"Not at {exe_path}, scanning subdirectories ...")
    for root, dirs, files in os.walk(converter_dir):
        if exe_name in files:
            found = os.path.join(root, exe_name)
            log(f"Found PotreeConverter at {found}")
            return found

    # Need to download
    log("PotreeConverter not found locally, need to download")
    links_path = os.path.join(project_root, "potree_converte_links.txt")
    if not os.path.isfile(links_path):
        raise RuntimeError(
            f"PotreeConverter not found and {links_path} is missing.\n"
            "Please place PotreeConverter in potree_converter/ or provide the links file."
        )

    links = parse_converter_links(links_path)
    platform_key = "windows" if sys.platform == "win32" else "linux"
    info = links[platform_key]
    log(f"Platform: {platform_key}")

    os.makedirs(converter_dir, exist_ok=True)
    log(f"Created directory: {converter_dir}")

    zip_path = os.path.join(converter_dir, "PotreeConverter.zip")
    log(f"Downloading {info['url']}")
    log(f"  Saving to: {zip_path}")

    def _progress(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            pct = min(100, downloaded * 100 // total_size)
            mb_down = downloaded / (1024 * 1024)
            mb_total = total_size / (1024 * 1024)
            print(f"\r[visualize]   {mb_down:.1f} / {mb_total:.1f} MB ({pct}%)", end="", flush=True)
        else:
            mb_down = downloaded / (1024 * 1024)
            print(f"\r[visualize]   {mb_down:.1f} MB downloaded", end="", flush=True)

    urllib.request.urlretrieve(info["url"], zip_path, reporthook=_progress)
    print()  # newline after progress
    log(f"  Download complete ({os.path.getsize(zip_path)} bytes)")

    verify_sha256(zip_path, info["sha256"])

    log(f"Extracting {zip_path} to {converter_dir} ...")
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        log(f"  Archive contains {len(names)} entries")
        for name in names:
            log(f"    extracting: {name}")
        zf.extractall(converter_dir)
    log(f"Extraction complete")

    log(f"Deleting zip: {zip_path}")
    os.remove(zip_path)
    log(f"Deleted {zip_path}")

    # Find the executable after extraction
    log(f"Searching for {exe_name} after extraction ...")
    for root, dirs, files in os.walk(converter_dir):
        if exe_name in files:
            found = os.path.join(root, exe_name)
            if sys.platform != "win32":
                log(f"Setting executable permission on {found}")
                os.chmod(found, 0o755)
            log(f"PotreeConverter ready: {found}")
            return found

    raise RuntimeError(f"Could not find {exe_name} after extracting to {converter_dir}")


def run_potree_converter(converter_exe, input_laz, output_dir):
    """Run PotreeConverter on a LAZ file."""
    cmd = [converter_exe, input_laz, "-o", output_dir]
    log(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"PotreeConverter failed with exit code {result.returncode}")
    log("PotreeConverter finished successfully")
    # List output files
    for f in sorted(os.listdir(output_dir)):
        fpath = os.path.join(output_dir, f)
        size = os.path.getsize(fpath) if os.path.isfile(fpath) else 0
        log(f"  output: {f} ({size} bytes)")


def ensure_potree_built(project_root):
    """Run npm install (if needed) and npm run build."""
    node_modules = os.path.join(project_root, "node_modules")
    if not os.path.isdir(node_modules):
        log(f"node_modules not found at {node_modules}")
        log("Running npm install ...")
        result = subprocess.run(
            ["npm", "install"],
            cwd=project_root,
            shell=(sys.platform == "win32"),
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError("npm install failed. Is Node.js installed?")
        log("npm install complete")
    else:
        log(f"node_modules exists at {node_modules}, skipping npm install")

    log("Running npm run build ...")
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=project_root,
        shell=(sys.platform == "win32"),
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("npm run build failed.")
    log("Potree build complete")


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <input.laz> [trajectory.csv]", file=sys.stderr)
        sys.exit(1)

    input_laz = os.path.abspath(sys.argv[1])
    csv_path = os.path.abspath(sys.argv[2]) if len(sys.argv) >= 3 else None

    log(f"Input LAZ: {input_laz}")
    if csv_path:
        log(f"Input CSV: {csv_path}")
    else:
        log("No trajectory CSV provided")

    if not os.path.isfile(input_laz):
        print(f"Error: LAZ file not found: {input_laz}", file=sys.stderr)
        sys.exit(1)

    if csv_path and not os.path.isfile(csv_path):
        print(f"Error: trajectory CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    # Project root is one level up from this script
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    log(f"Project root: {project_root}")

    # Build Potree viewer if needed
    ensure_potree_built(project_root)

    # Derive dataset name from LAZ filename
    dataset_name = os.path.splitext(os.path.basename(input_laz))[0]
    # Strip extra extensions like .copc
    if dataset_name.endswith(".copc"):
        dataset_name = dataset_name[:-5]
    log(f"Dataset name: {dataset_name}")

    dataset_dir = os.path.join(project_root, "data", dataset_name)
    log(f"Dataset directory: {dataset_dir}")

    skip_conversion = False
    if os.path.isdir(dataset_dir):
        log(f"Dataset folder already exists: {dataset_dir}")
        existing = os.listdir(dataset_dir)
        log(f"  Contents: {existing}")
        answer = input(f"Use existing or overwrite? [u/o]: ").strip().lower()
        if answer == "u":
            log("User chose: use existing")
            skip_conversion = True
        elif answer == "o":
            log(f"User chose: overwrite — deleting {dataset_dir}")
            shutil.rmtree(dataset_dir)
            log(f"Deleted {dataset_dir}")
            os.makedirs(dataset_dir, exist_ok=True)
            log(f"Created {dataset_dir}")
        else:
            print("Invalid choice. Aborting.", file=sys.stderr)
            sys.exit(1)
    else:
        log(f"Creating dataset directory: {dataset_dir}")
        os.makedirs(dataset_dir, exist_ok=True)

    if not skip_conversion:
        # Convert trajectory CSV if provided
        if csv_path:
            trj_output = os.path.join(dataset_dir, "trajectory.json")
            convert_trajectory_csv(csv_path, trj_output)

        # Find or download PotreeConverter
        converter_exe = find_or_download_converter(project_root)

        # Run PotreeConverter
        run_potree_converter(converter_exe, input_laz, dataset_dir)
    else:
        log("Skipping conversion (reusing existing data)")

    # Build URL params
    metadata_rel = f"data/{dataset_name}/metadata.json"
    metadata_abs = os.path.join(dataset_dir, "metadata.json")
    log(f"Point cloud metadata: {metadata_abs}")
    if not os.path.isfile(metadata_abs):
        log(f"WARNING: metadata.json not found at {metadata_abs}")
    params = {"pc": metadata_rel}

    trj_rel = f"data/{dataset_name}/trajectory.json"
    trj_abs = os.path.join(dataset_dir, "trajectory.json")
    if os.path.isfile(trj_abs):
        log(f"Trajectory JSON found: {trj_abs}")
        params["trj"] = trj_rel
    else:
        log("No trajectory JSON found, opening without trajectory overlay")

    # Start Node.js HTTP server with Range support
    port = find_available_port()

    query = urllib.parse.urlencode(params)
    url = f"http://localhost:{port}/index.html?{query}"

    script_dir = os.path.dirname(os.path.abspath(__file__))
    server_script = os.path.join(script_dir, "server.js")

    log(f"Starting Node.js HTTP server on port {port}")
    log(f"Serving from: {project_root}")
    log(f"Viewer URL: {url}")
    log("Opening browser ...")

    threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    try:
        subprocess.run(
            ["node", server_script, str(port), project_root, url],
            check=False,
        )
    except KeyboardInterrupt:
        log("Shutting down server.")


if __name__ == "__main__":
    main()
