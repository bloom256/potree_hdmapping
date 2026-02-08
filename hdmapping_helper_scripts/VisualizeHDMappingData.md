# Visualize HD Mapping Data

This guide covers the end-to-end workflow for visualizing LAS/LAZ point clouds with trajectory overlays and loop closure poses using the Potree-based viewer.

## Prerequisites

- **Node.js** and **npm**
- **Python 3** (stdlib only, no pip packages)

## Quick Start

```bash
# Full pipeline: point cloud + trajectory + poses + LC edges
python hdmapping_helper_scripts/visualize.py --laz scan.laz --trajectory_csv trajectory.csv --poses_after_lc poses.txt --lc_edges_session session-alc.mjs

# Point cloud + trajectory + poses (no edges)
python hdmapping_helper_scripts/visualize.py --laz scan.laz --trajectory_csv trajectory.csv --poses_after_lc poses.txt

# Point cloud + trajectory only
python hdmapping_helper_scripts/visualize.py --laz scan.laz --trajectory_csv trajectory.csv

# Point cloud only
python hdmapping_helper_scripts/visualize.py --laz scan.laz
```

On first run, PotreeConverter is auto-downloaded and the viewer is built automatically (`npm install && npm run build`).

## What `visualize.py` Does

```
Usage: python hdmapping_helper_scripts/visualize.py --laz <input.laz> [--trajectory_csv <trajectory.csv>] [--poses_after_lc <poses.txt>] [--lc_edges_session <session.mjs>]
```

1. Builds Potree viewer if needed (`npm install` + `npm run build`)
2. Derives dataset name from LAZ filename (e.g. `scan_001.laz` → `scan_001`)
3. Downloads PotreeConverter (if not already present) and converts LAZ to Potree format in `data/<dataset>/`
4. Converts trajectory CSV to `data/<dataset>/trajectory.json` (if provided)
5. Converts poses text file to `data/<dataset>/poses_after_lc.json` (if provided)
6. Extracts LC edges from session `.mjs` to `data/<dataset>/lc_edges.json` (if provided)
7. Starts a local HTTP server and opens the viewer in the default browser

Arguments:

| Argument | Required | Description |
|----------|----------|-------------|
| `--laz` | Yes | Input LAS/LAZ point cloud file |
| `--trajectory_csv` | No | Trajectory CSV file (no header; columns: `timestamp,x,y,z,qx,qy,qz,qw`) |
| `--poses_after_lc` | No | Poses after loop closure text file (see format below) |
| `--lc_edges_session` | No | Session `.mjs` file to extract loop closure edges from |

If `data/<dataset>/` already exists, the script prompts to reuse or overwrite.

## Input File Formats

### Trajectory CSV

No header. Columns: `timestamp,x,y,z,qx,qy,qz,qw`. Only x, y, z (columns 1-3) are used.

```
1609459200.0,100.5,200.3,50.1,0,0,0,1
1609459200.1,100.6,200.4,50.1,0,0,0,1
```

### Poses Text File

4x4 transformation matrices indexed by point cloud filename:

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

First line is the number of poses. Each pose has a filename line followed by 4 rows of the 4x4 matrix.

## Standalone Helper Scripts

### convert_trajectory_csv.py

```bash
python hdmapping_helper_scripts/convert_trajectory_csv.py trajectory.csv [output.json]
# -> trajectory.json
```

### parse_poses.py

```bash
python hdmapping_helper_scripts/parse_poses.py poses.txt [output.json]
# -> poses.json
```

### parse_session.py

```bash
python hdmapping_helper_scripts/parse_session.py session-alc.mjs [output.json]
# -> session-alc_edges.json
```

Extracts `loop_closure_edges` from a session `.mjs` file, mapping `index_from`/`index_to` to laz filenames.

## Viewer Controls

| Setting | Default |
|---------|---------|
| Navigation | First-person (helicopter mode) |
| Point coloring | Intensity |
| Eye-Dome Lighting | On |
| Point size | Adaptive |

| Control | Action |
|---------|--------|
| WASD | Move |
| Arrows | Look |
| Space/Shift | Up/Down |
| LMB drag | Rotate |
| RMB drag | Pan |
| Scroll | Speed |
| DblClick | Measure |
| Esc | Clear measurement |
| Route Fly button | Fly along trajectory (scroll = speed, WASD = cancel) |

## Viewer Query Parameters

| Parameter | Description |
|-----------|-------------|
| `pc` | Path to Potree `metadata.json` |
| `trj` | Path to `trajectory.json` |
| `poses_after_lc` | Path to `poses_after_lc.json` |
| `lc_edges` | Path to `lc_edges.json` |

## Visualization

- **Trajectory**: red line along all positions
- **Poses after LC**: RGB coordinate axes at each pose (Red=X, Green=Y, Blue=Z, 0.3m length)
- **LC edges**: dashed yellow lines connecting pose pairs, with numbered labels at midpoints

## Troubleshooting

**Point cloud doesn't load** -- Check the browser console. Verify `metadata.json`, `octree.bin`, and `hierarchy.bin` exist in the dataset directory.

**Trajectory not visible** -- The trajectory coordinates must be in the same coordinate system as the point cloud. Check the browser console for warnings.

**Port already in use** -- `visualize.py` automatically tries the next available port starting from 8080.

**PotreeConverter download fails** -- Check your internet connection. The download URLs and SHA256 hashes are in `potree_converte_links.txt`.
