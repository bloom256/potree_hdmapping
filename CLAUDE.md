# potree_hdmapping

Fork of Potree 1.8 (WebGL point cloud viewer) for inspecting HD mapping / LiDAR SLAM output: a LAZ point cloud plus trajectory, poses before/after loop closure, and loop-closure edges. All fork work lives on branch `hdmapping`; `develop` tracks upstream Potree.

## Commands

Everything runs through pixi (`pixi.toml`: Python + Node.js 20). Don't assume a global `node`, `npm` or `python`.

- `pixi install` — create the environment
- `pixi run build` — `npm install` + full Potree build into `build/potree/`
- `pixi run npm run build` — rebuild after editing `src/` (no reinstall)
- `pixi run npm start` — gulp watch: rebuild on `src/` changes (also starts a dev server on :1234)
- `pixi run visualize --laz scan.laz [--trajectory_csv t.csv] [--poses_after_lc p.txt] [--poses_before_lc p.txt] [--lc_edges_session s.mjs] [--dataset_name name]` — convert into `data/<name>/` and open the viewer
- `pixi run visualize --dataset <name>` — reopen an existing `data/<name>/`

`visualize.py` always runs the npm build, then serves the repo root with `hdmapping_helper_scripts/server.js` on the first free port from 8080 and opens `index.html?pc=…&trj=…&poses_after_lc=…&poses_before_lc=…&lc_edges=…`.

There are no automated tests or linters. Verify changes in the browser and check the devtools console.

## Layout

Fork-owned:
- `index.html` — the HD mapping viewer page: overlays (trajectory line, pose axes, scan labels, LC edges, before/after links), flags, MMB pick/measure, go-to box, keyboard shortcuts.
- `viewer_ext/` — ES modules served straight from source: `RouteFly.js` (Route Fly UI + per-frame tick), `RouteSlice.js` (live cross-section in a second WebGL context), `ForwardMarker.js`, `CrossSectionTool.js` (wraps Potree's Profile tool).
- `hdmapping_helper_scripts/` — `visualize.py` (entry point), converters (`convert_trajectory_csv.py`, `parse_poses.py`, `parse_session.py`), `server.js` (static server with Range support + `POST /save-file` used for `flags.json`), `VisualizeHDMappingData.md` (user guide). `convert_las_to_copc.py` is legacy and unused.
- `potree_converte_links.txt` — PotreeConverter 2.1.2 URLs + SHA256. The misspelled filename is read by `visualize.py`; rename both together.

Upstream Potree files patched by the fork (keep diffs small and commented — they conflict with upstream merges):
- `src/navigation/FirstPersonControls.js` — key bindings, roll, Route Fly state (`initRouteFly`, `startRouteFly`, `seekRouteFly`, pose keyframes)
- `src/viewer/viewer.js` (quaternion camera with roll, creates the minimap), `src/viewer/View.js` (`roll`), `src/viewer/Minimap.js` (new)
- `src/viewer/sidebar.html`, `src/viewer/sidebar.js` — attribute filter UI, FOV max 150
- `src/PotreeRenderer.js`, `src/materials/PointCloudMaterial.js`, `src/materials/shaders/pointcloud.{vs,fs}` — generic attribute range filter (`aFilter`, `setFilterAttribute`) and point size/splat tuning
- `src/viewer/HQSplatRenderer.js`, `src/Potree_update_visibility.js` (orthographic LOD)

Generated or ignored: `build/`, `node_modules/`, `.pixi/`, `data/`, `potree_converter/`, `*.laz`, `*.las`, `*.csv`.

## Gotchas

- Edits in `src/` have no effect until rebuilt. `index.html` and `viewer_ext/` are served as-is — just reload the page.
- `viewer_ext/` modules import three from `../libs/three.js/build/three.module.js` and use the global `Potree` from `build/potree/potree.js`. Keep that pattern.
- World frame is Z-up, in metres. Pose JSON matrices are row-major 4x4 (translation at indices 3, 7, 11). `trajectory.json` is `[[x, y, z], …]`.
- On the current dataset the lidar is mounted rotated 90°, so pose body +X is not the direction of travel. Use the trajectory tangent for "forward" (see `ForwardMarker.js`, `RouteSlice.js`).
- The viewer sets `useHQ = true` with EDL on, so `HQSplatRenderer` is the active renderer (it takes precedence over `EDLRenderer`). New material state must also be copied into its cloned depth/attribute materials.
- Controls are first-person (`fpControls`). When changing bindings, keep `#controls_hint` in `index.html` and the user guide in sync.
- Keyboard handlers in `index.html` skip events from inputs. After handling a button click, return focus to the render canvas (see `RouteFly.focusCanvas`) so WASD/Space keep working.
- On Windows the build can rewrite line endings in tracked files (e.g. `examples/github.html`). Don't commit EOL-only changes.
- Only win-64 and linux-64 are supported (PotreeConverter binaries).

## Conventions

- JS uses tabs; Python uses 4 spaces and the standard library only. Add tools to `pixi.toml`, not pip.
- Put new viewer features in `viewer_ext/` modules rather than growing `index.html` or patching `src/`, unless they need renderer or shader internals.
- Update `hdmapping_helper_scripts/VisualizeHDMappingData.md` when CLI arguments, controls or query parameters change.
