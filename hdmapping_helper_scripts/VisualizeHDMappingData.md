# Visualize HD Mapping Data

This guide covers the end-to-end workflow for visualizing LAS/LAZ point clouds with trajectory overlays using the Potree-based viewer.

## Prerequisites

- **Node.js** and **npm**
- **Python 3** (stdlib only, no pip packages)
- **Docker** (for COPC conversion)

## Quick Start

```bash
# 1. Build the viewer
npm install && npm run build

# 2. Convert your point cloud to COPC format
python hdmapping_helper_scripts/convert_las_to_copc.py scan.laz
# -> scan.copc.laz

# 3. Convert your trajectory CSV
python hdmapping_helper_scripts/convert_trajectory_csv.py trajectory.csv
# -> trajectory.json

# 4. Open in browser (using outputs from steps 2 and 3)
python hdmapping_helper_scripts/visualize.py scan.copc.laz trajectory.json
```

## Step-by-Step

### 1. Build Potree

```bash
npm install
npm run build
```

This generates the `build/` directory required by the viewer.

### 2. Convert Point Cloud to COPC

```
Usage: python hdmapping_helper_scripts/convert_las_to_copc.py <input.laz> [output.copc.laz]
```

Converts a LAS or LAZ file to COPC (Cloud Optimized Point Cloud) format using Docker PDAL.

- Output defaults to `<input>.copc.laz` (e.g. `scan.laz` becomes `scan.copc.laz`).
- Uses 1mm scale (0.001) for maximum precision.
- Skips conversion if the output file already exists. Delete the output file to force re-conversion.
- Requires Docker with the `pdal/pdal:2.9.0` image (pulled automatically on first run).

Example:

```bash
python hdmapping_helper_scripts/convert_las_to_copc.py data/scan.laz
# -> data/scan.copc.laz

python hdmapping_helper_scripts/convert_las_to_copc.py data/scan.laz output/my_cloud.copc.laz
# -> output/my_cloud.copc.laz
```

### 3. Convert Trajectory CSV

```
Usage: python hdmapping_helper_scripts/convert_trajectory_csv.py <trajectory.csv> [output.json]
```

Converts a trajectory CSV file to a JSON array of `[x, y, z]` positions.

- Input CSV must have **no header**. Expected columns: `timestamp,x,y,z,qx,qy,qz,qw`.
- Only the x, y, z columns (indices 1-3) are extracted.
- Output defaults to `<input>.json` (e.g. `trajectory.csv` becomes `trajectory.json`).
- Skips conversion if the output file already exists. Delete the output file to force re-conversion.
- Rows that fail to parse are skipped with a warning on stderr.

Example:

```bash
python hdmapping_helper_scripts/convert_trajectory_csv.py data/trajectory.csv
# -> data/trajectory.json

python hdmapping_helper_scripts/convert_trajectory_csv.py data/my_survey.csv
# -> data/my_survey.json

python hdmapping_helper_scripts/convert_trajectory_csv.py data/trajectory.csv output/trj.json
# -> output/trj.json
```

### 4. Launch the Viewer

```
Usage: python hdmapping_helper_scripts/visualize.py <pointcloud.copc.laz> [trajectory.json]
```

Starts a local HTTP server and opens the viewer in your default browser.

- The trajectory argument is optional. Without it, only the point cloud is shown.
- The server runs until you press Ctrl+C.
- Uses port 8080 by default (falls back to the next available port).

Example:

```bash
# Point cloud with trajectory
python hdmapping_helper_scripts/visualize.py scan.copc.laz trajectory.json

# Point cloud only
python hdmapping_helper_scripts/visualize.py scan.copc.laz
```

### Alternative: Manual Server

If you prefer to use the Potree dev server:

```bash
npm start
# Open: http://localhost:1234/index.html?copc=scan.copc.laz&trj=trajectory.json
```

## Viewer Controls

The viewer opens with these defaults:

| Setting | Default |
|---------|---------|
| Navigation | Helicopter mode (Earth controls) |
| Point coloring | Intensity |
| Eye-Dome Lighting | On |
| Point size | Adaptive |

The trajectory is rendered as a **red line** overlaid on the point cloud.

## Query Parameters

The viewer accepts URL query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `copc` | `pointcloud.copc.laz` | COPC file to load |
| `trj` | `trajectory.json` | Trajectory JSON file |

## Troubleshooting

**Docker not found** -- Ensure Docker is installed and running. The COPC conversion script requires it.

**Point cloud doesn't load** -- Verify the file is in COPC format (`.copc.laz`). Standard LAZ files must be converted first.

**Trajectory not visible** -- Check the browser console for warnings. The trajectory coordinates must be in the same coordinate system as the point cloud. If the trajectory file is missing, the viewer continues without it.

**Port already in use** -- `visualize.py` automatically tries the next available port. If using `npm start`, the default port 1234 must be free.
