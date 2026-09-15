# Visualize HD Mapping Data

This guide covers the end-to-end workflow for visualizing LAS/LAZ point clouds with trajectory overlays and loop closure poses using the Potree-based viewer.

## Prerequisites

- **[pixi](https://pixi.sh)** — provides Python and Node.js/npm from `pixi.toml` (Windows and Linux x64)

The scripts use only the Python standard library, so there are no pip packages. Without pixi, install **Node.js** (20 LTS) with **npm** and **Python 3.10+** yourself and call `python` directly instead of `pixi run visualize`.

```bash
pixi install      # create the environment (.pixi/)
pixi run build    # optional: npm install + build Potree (visualize also does this)
```

## Quick Start

```bash
# Full pipeline: point cloud + trajectory + poses + LC edges
pixi run visualize --laz scan.laz --trajectory_csv trajectory.csv --poses_after_lc poses.txt --lc_edges_session session-alc.mjs

# Also show poses before loop closure, linked to the poses after it
pixi run visualize --laz scan.laz --trajectory_csv trajectory.csv --poses_after_lc poses.txt --poses_before_lc poses_before.txt

# Point cloud + trajectory only
pixi run visualize --laz scan.laz --trajectory_csv trajectory.csv

# Point cloud only, stored under a custom dataset name
pixi run visualize --laz scan.laz --dataset_name site_a

# Reopen an already converted dataset from data/<name>/
pixi run visualize --dataset site_a
```

## What `visualize.py` Does

```
pixi run visualize --laz <input.laz> [--dataset_name <name>] [--trajectory_csv <trajectory.csv>]
                   [--poses_after_lc <poses.txt>] [--poses_before_lc <poses.txt>] [--lc_edges_session <session.mjs>]
pixi run visualize --dataset <name>
```

Import mode (`--laz`):

1. Builds the Potree viewer: `npm install` if `node_modules/` is missing, then `npm run build` on every run
2. Names the dataset from `--dataset_name`, or from the LAZ filename (`scan_001.laz` → `scan_001`)
3. If `data/<dataset>/` already exists, asks whether to reuse it (`u`) or overwrite it (`o`)
4. Downloads PotreeConverter 2.1.2 into `potree_converter/` on first use (SHA256-checked) and converts the LAZ into `data/<dataset>/` with Brotli encoding
5. Writes `trajectory.json`, `poses_after_lc.json`, `poses_before_lc.json` and `lc_edges.json` for the inputs that were given
6. Starts the HTTP server on the first free port from 8080, prints the viewer URLs and opens the browser

Open mode (`--dataset`) skips steps 2–5 and loads whichever JSON files exist in `data/<name>/`.

Arguments:

| Argument | Required | Description |
|----------|----------|-------------|
| `--laz` | One of `--laz` / `--dataset` | Input LAS/LAZ point cloud file (import mode) |
| `--dataset` | One of `--laz` / `--dataset` | Open an existing dataset from `data/<name>/`; can't be combined with the other options |
| `--dataset_name` | No | Dataset name to use instead of the LAZ filename |
| `--trajectory_csv` | No | Trajectory CSV file (no header; columns: `timestamp,x,y,z,qx,qy,qz,qw`) |
| `--poses_after_lc` | No | Poses after loop closure (see format below) |
| `--poses_before_lc` | No | Poses before loop closure, drawn smaller and linked to the after-LC poses |
| `--lc_edges_session` | No | Session `.mjs` file to extract loop closure edges from |

The script prints three URLs:

```
[visualize] Viewer URL:    http://localhost:8080/index.html?pc=...
[visualize] LAN URL:       http://192.168.1.130:8080/index.html?pc=...
[visualize] Tailscale URL: http://100.82.251.50:8080/index.html?pc=...
```

The Tailscale URL is shown only when Tailscale is running on this machine. Stop the server with Ctrl+C.

## Input File Formats

### Trajectory CSV

No header. Columns: `timestamp,x,y,z,qx,qy,qz,qw`. Only x, y, z (columns 1-3) are used; unparseable rows are skipped.

```
1609459200.0,100.5,200.3,50.1,0,0,0,1
1609459200.1,100.6,200.4,50.1,0,0,0,1
```

### Poses Text File

Used for both `--poses_after_lc` and `--poses_before_lc` (any file extension, e.g. `.txt` or `.mrp`). 4x4 transformation matrices indexed by point cloud filename:

```
2
scan_001.laz
1 0 0 100.5
0 1 0 200.3
0 0 1 50.1
0 0 0 1
scan_002.laz
0.999 0.01 0 101.2
-0.01 0.999 0 200.8
0 0 1 50.2
0 0 0 1
```

First line is the number of poses. Each pose has a filename line followed by 4 rows of the 4x4 matrix. Before- and after-LC poses are matched by filename.

### Session File

JSON (`.mjs`) with `laz_file_names[].file_name` and `loop_closure_edges[]` entries holding `index_from` / `index_to`. Edges are matched to poses by the LAZ file basename.

## Dataset Folder

`data/<dataset>/` contains:

| File | Source |
|------|--------|
| `metadata.json`, `octree.bin`, `hierarchy.bin` | PotreeConverter |
| `trajectory.json` | `--trajectory_csv` |
| `poses_after_lc.json`, `poses_before_lc.json` | `--poses_after_lc`, `--poses_before_lc` |
| `lc_edges.json` | `--lc_edges_session` |
| `flags.json` | Created by the viewer when you place flags |

## Standalone Helper Scripts

### convert_trajectory_csv.py

```bash
pixi run python hdmapping_helper_scripts/convert_trajectory_csv.py trajectory.csv [output.json]
# -> trajectory.json
```

### parse_poses.py

```bash
pixi run python hdmapping_helper_scripts/parse_poses.py poses.txt [output.json]
# -> poses.json
```

### parse_session.py

```bash
pixi run python hdmapping_helper_scripts/parse_session.py session-alc.mjs [output.json]
# -> session-alc_edges.json
```

Extracts `loop_closure_edges` from a session `.mjs` file, mapping `index_from`/`index_to` to laz filenames.

## Viewer

### Defaults

| Setting | Default |
|---------|---------|
| Navigation | First-person; W/S move horizontally |
| Point coloring | Intensity gradient (Viridis) |
| Rendering | Eye-Dome Lighting + high-quality splats |
| Point size | Adaptive |
| Field of view | 95° |
| Point budget | 10 million |
| Move speed | 3 m/s |

### Controls

| Control | Action |
|---------|--------|
| WASD | Move |
| Arrows | Look |
| Q / E | Roll |
| R | Level (reset roll) |
| Space / Shift | Up / Down |
| LMB drag | Rotate |
| RMB drag | Pan parallel to the ground |
| Scroll | Movement speed |
| Alt+Scroll | Move along the view direction |
| DblClick | Fly to the clicked point |
| MMB click | Pick a point: coordinates and point attributes appear bottom-left |
| MMB drag | Measure the distance between two points |
| Alt+MMB click | Place a flag |
| Esc | Clear measurement |
| M | Toggle minimap |
| P | Toggle point cloud visibility |
| Go box (`x, y, z`) | Jump the camera to a coordinate |

Keyboard shortcuts are ignored while typing in an input field.

### Minimap

Shown bottom-right. Scroll zooms, LMB drag pans the map (it recenters when the camera moves), RMB drag moves the camera, and DblClick teleports there.

### Flags

Alt+MMB on the cloud places a numbered flag. The flags panel (bottom-left) lists them: click a row or **Go** to fly to it, **X** removes it, **Copy** copies all coordinates, **_** collapses the panel. Flags are saved to `data/<dataset>/flags.json` and reloaded next time.

### Route Fly

Available when a trajectory is loaded.

- **Route Fly** starts flying along the trajectory at the current move speed; **Stop Fly** ends it. Scroll changes speed, Space/Shift raise or lower the camera, WASD ends the fly.
- The top bar has **Pause/Resume**, a slider to scrub along the route, and the progress percentage. While paused, Space/Shift and mouse look still work and WASD still ends the fly.
- Stopping mid-route and pressing **Route Fly** again resumes from there. After reaching the end (100%), it restarts from the beginning.
- **Rotate camera** (shown when `poses_after_lc` is loaded) makes the camera orientation follow the interpolated poses. LMB drag adds a look offset that stays for the rest of the flight; while dragging, a red dot marks the direction of travel.
- A live cross-section panel (bottom center) shows a vertical slice across the path at the trajectory position, with a yellow ring marking the trajectory. Scroll zooms, LMB drag pans, **Zoom** and **Depth** (slice thickness in metres) can be typed in, and **Reset** restores the defaults.

### Cross-section

**Cross-section** lets you LMB-click two points on the cloud; an orthographic side view of that corridor opens after the second click. RMB before the second click aborts. Closing the side view removes the corridor.

### Attribute Filter

In the sidebar's filter section, **Attribute** lists the numeric point attributes. Pick one and drag the range slider to hide points outside the range; **Clear** removes the filter.

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `pc` | Path to Potree `metadata.json` |
| `trj` | Path to `trajectory.json` |
| `poses_after_lc` | Path to `poses_after_lc.json` |
| `poses_before_lc` | Path to `poses_before_lc.json` |
| `lc_edges` | Path to `lc_edges.json` |

### Overlays

- **Trajectory**: red line along all positions
- **Poses after LC**: RGB coordinate axes at each pose (Red=X, Green=Y, Blue=Z, 0.3 m long), labelled with the scan index from the filename
- **Poses before LC**: smaller axes (0.15 m); with after-LC poses loaded, dashed blue lines link matching poses, labelled with the before→after distance
- **LC edges**: dashed yellow lines between after-LC poses, labelled `from-to` with the scan indices

## Opening the Viewer from Another Machine

The server listens on all network interfaces, so other machines can use the **LAN URL** or **Tailscale URL**. Copy the whole URL including `http://`: the server speaks plain HTTP, and a browser that tries `https://` shows `ERR_SSL_PROTOCOL_ERROR`. On Windows, allow `node.exe` through the firewall when prompted.

The server only serves files inside the repository, and the only file clients can write is `data/<dataset>/flags.json`.

## Troubleshooting

**Point cloud doesn't load** -- Check the browser console. Verify `metadata.json`, `octree.bin`, and `hierarchy.bin` exist in the dataset directory.

**Trajectory not visible** -- The trajectory coordinates must be in the same coordinate system as the point cloud. Check the browser console for warnings.

**Port already in use** -- `visualize.py` automatically uses the next free port after 8080. A viewer still running in another terminal keeps its port until you press Ctrl+C there.

**`ERR_SSL_PROTOCOL_ERROR` on another machine** -- The browser is using `https://`. Type the URL with `http://`, remove the `https://` entry from the address bar suggestions, or turn off the browser's HTTPS-only mode for that address.

**PotreeConverter download fails** -- Check your internet connection. The download URLs and SHA256 hashes are in `potree_converte_links.txt`.
