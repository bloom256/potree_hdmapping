import * as THREE from "../libs/three.js/build/three.module.js";

const WORLD_UP = new THREE.Vector3(0, 0, 1);

// Live cross-section of the cloud that tracks the camera during Route Fly.
//
// We render the same scene the main viewport already has loaded (visible octree
// nodes + their GPU buffers) into a secondary canvas, viewed through an
// orthographic camera aligned with the travel direction. A thin near/far frustum
// (sliceThickness, default 1 m) provides the slab cut; the camera's vertical axis
// is world Z so the image axes are intuitive: image x = across path, image y =
// elevation.
//
// This avoids Potree's Profile pipeline (which re-streams a corridor's points
// from the octree every time the polyline moves and can't keep up with continuous
// motion). The cost is duplicated GPU buffers per geometry: the side canvas has
// its own WebGL context, so the PotreeRenderer instance caches its own VBOs. For
// a single visible slice that's an acceptable trade.
export class RouteSlice {
	constructor (viewer, options = {}) {
		this.viewer = viewer;
		this.sliceHalfWidth = options.sliceHalfWidth ?? 2.5;  // 5 m across path
		this.sliceHalfHeight = options.sliceHalfHeight ?? 7.5; // 15 m vertical
		this.sliceThickness = options.sliceThickness ?? 1;    // along travel direction
		this.widthPx = options.widthPx ?? 910;                // centered horizontally
		this.heightPx = options.heightPx ?? 200;
		this.panStepM = options.panStepM ?? 2;                // meters per wheel notch
		this.forwardWindowM = options.forwardWindowM ?? 5;    // smoothing window for tangent

		// Snapshot constructor defaults so the Reset button can restore them.
		this.defaults = {
			sliceThickness: this.sliceThickness,
			zoom: options.zoom ?? 2.25,
		};

		this.canvas = null;
		this.threeRenderer = null;
		this.pRenderer = null;
		this.camera = null;
		this.installed = false;
		this.active = false;
		this.lastLayout = null;

		// Pan offsets in world meters, applied to the camera on top of the pose.
		// vOffset shifts the view along world Z; hOffset along the "right of path"
		// direction (perpendicular to forward, horizontal). Both persist across
		// frames so the user's chosen view sticks as they fly.
		this.vOffset = 0;
		this.hOffset = 0;
		// Multiplier on the frustum extents. >1 = zoomed in (smaller world area
		// visible, more pixel detail per meter). Wheel adjusts this.
		this.zoom = this.defaults.zoom;
	}

	install () {
		if (this.installed) return;
		this.installed = true;

		// Container holds toolbar + canvas so they move together when shown/hidden.
		let container = document.createElement('div');
		container.id = 'route_slice_container';
		container.style.cssText =
			'position: absolute;' +
			'display: none;' +
			'bottom: 10px;' +
			'z-index: 1000;' +
			'background: rgba(0,0,0,0.75);' +
			'border: 1px solid #668;' +
			'border-radius: 4px;' +
			'overflow: hidden;';
		this.container = container;

		let toolbar = document.createElement('div');
		toolbar.style.cssText =
			'display: flex; gap: 10px; align-items: center;' +
			'padding: 4px 8px; font: 12px monospace; color: #ccc;' +
			'border-bottom: 1px solid #334;';
		toolbar.innerHTML =
			'<label>Zoom: <input data-rs="zoom" type="number" step="0.1" min="0.1" max="20" ' +
			'  style="width: 50px; background: #223; color: #fff; border: 1px solid #668;"></label>' +
			'<label>Depth: <input data-rs="depth" type="number" step="0.1" min="0.1" max="50" ' +
			'  style="width: 50px; background: #223; color: #fff; border: 1px solid #668;"> m</label>' +
			'<button data-rs="reset" style="background: #446; color: #fff; border: 1px solid #668;' +
			'  border-radius: 3px; padding: 2px 8px; font: 12px monospace; cursor: pointer;">Reset</button>';

		let canvas = document.createElement('canvas');
		canvas.id = 'route_slice_canvas';
		canvas.style.cssText = 'display: block; background: #111;';
		this.canvas = canvas;

		container.appendChild(toolbar);
		container.appendChild(canvas);
		document.body.appendChild(container);

		this.threeRenderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: false, antialias: false });
		this.threeRenderer.autoClear = false;
		this.pRenderer = new Potree.Renderer(this.threeRenderer);

		this.camera = new THREE.OrthographicCamera(
			-this.sliceHalfWidth, this.sliceHalfWidth,
			this.sliceHalfHeight, -this.sliceHalfHeight,
			0, this.sliceThickness);

		this.zoomInput = toolbar.querySelector('[data-rs="zoom"]');
		this.depthInput = toolbar.querySelector('[data-rs="depth"]');
		this.syncInputs();

		this.zoomInput.addEventListener('input', () => {
			let v = parseFloat(this.zoomInput.value);
			if (v > 0) { this.zoom = v; this.lastLayout = null; }
		});
		this.depthInput.addEventListener('input', () => {
			let v = parseFloat(this.depthInput.value);
			if (v > 0) { this.sliceThickness = v; this.lastLayout = null; }
		});
		toolbar.querySelector('[data-rs="reset"]').addEventListener('click', () => {
			this.zoom = this.defaults.zoom;
			this.sliceThickness = this.defaults.sliceThickness;
			this.vOffset = 0;
			this.hOffset = 0;
			this.syncInputs();
			this.lastLayout = null;
		});

		// Scroll wheel over the canvas = zoom. LMB drag = pan in both axes (camera
		// translates along its local +X/+Y so the world appears to follow the
		// cursor: drag right pulls the world right, drag down pulls it down).
		canvas.addEventListener('wheel', (e) => {
			e.preventDefault();
			let factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
			this.zoom = Math.max(0.1, Math.min(20, this.zoom * factor));
			this.lastLayout = null;
			this.syncInputs();
		}, { passive: false });

		let dragging = false;
		let lastX = 0, lastY = 0;
		canvas.addEventListener('mousedown', (e) => {
			if (e.button !== 0) return;
			dragging = true;
			lastX = e.clientX;
			lastY = e.clientY;
			e.preventDefault();
		});
		window.addEventListener('mousemove', (e) => {
			if (!dragging) return;
			let dx = e.clientX - lastX;
			let dy = e.clientY - lastY;
			lastX = e.clientX;
			lastY = e.clientY;
			// Convert pixel deltas to world meters using the current frustum extent.
			let halfW = -this.camera.left;
			let halfH = this.camera.top;
			let w = (this.lastLayout && this.lastLayout.width) || this.widthPx;
			let h = (this.lastLayout && this.lastLayout.height) || this.heightPx;
			this.hOffset -= dx * (2 * halfW) / w;
			this.vOffset += dy * (2 * halfH) / h;
		});
		window.addEventListener('mouseup', () => { dragging = false; });

		// Re-layout on window resize. Sidebar toggle doesn't shift the canvas
		// since we center horizontally on the full viewport width.
		window.addEventListener('resize', () => this.layout());
	}

	syncInputs () {
		if (this.zoomInput) this.zoomInput.value = this.zoom.toFixed(2);
		if (this.depthInput) this.depthInput.value = this.sliceThickness.toFixed(1);
	}

	layout () {
		if (!this.canvas) return;
		// Centered horizontally so the canvas stays clear of the flags panel on the
		// left and the minimap on the right. If widthPx is wider than the window,
		// fall back to whatever fits.
		let widthPx = Math.min(this.widthPx, window.innerWidth - 20);
		let heightPx = this.heightPx;
		let leftPx = Math.round((window.innerWidth - widthPx) / 2);
		if (this.lastLayout
			&& this.lastLayout.left === leftPx
			&& this.lastLayout.width === widthPx
			&& this.lastLayout.height === heightPx
			&& this.lastLayout.zoom === this.zoom
			&& this.lastLayout.halfH === this.sliceHalfHeight
			&& this.lastLayout.depth === this.sliceThickness) return;
		this.lastLayout = {
			left: leftPx, width: widthPx, height: heightPx,
			zoom: this.zoom, halfH: this.sliceHalfHeight, depth: this.sliceThickness,
		};

		this.container.style.left = leftPx + 'px';
		this.container.style.width = widthPx + 'px';
		this.canvas.style.width = widthPx + 'px';
		this.canvas.style.height = heightPx + 'px';
		this.threeRenderer.setSize(widthPx, heightPx, false);

		// Max-fit: choose a frustum whose aspect matches the canvas's, but is large
		// enough to encompass BOTH the requested half-width and half-height of the
		// slice. Zoom scales both axes uniformly: zoom > 1 zooms in (smaller world
		// area visible, more pixel detail per meter).
		let aspect = widthPx / heightPx;
		let halfW = Math.max(this.sliceHalfWidth, this.sliceHalfHeight * aspect) / this.zoom;
		let halfH = halfW / aspect;
		this.camera.left = -halfW;
		this.camera.right = halfW;
		this.camera.top = halfH;
		this.camera.bottom = -halfH;
		this.camera.near = 0;
		this.camera.far = this.sliceThickness;
		this.camera.updateProjectionMatrix();
	}

	currentPosition () {
		return this.viewer.scene.view.position.clone();
	}

	// Forward = trajectory tangent at the current routeFlyDistance, averaged over
	// a window so local position jitter doesn't flip the direction segment-to-
	// segment. We use the route's piecewise-linear segments rather than pose
	// orientation so this works regardless of "Rotate camera" being toggled.
	currentForward () {
		let fp = this.viewer.fpControls;
		let positions = fp.routeFlyPositions;
		let dists = fp.routeFlyDistances;
		if (!positions || positions.length < 2 || !dists) return null;
		let d = fp.routeFlyDistance;
		let total = dists[dists.length - 1];
		let half = this.forwardWindowM / 2;
		let posBack = this.positionAtDistance(Math.max(0, d - half));
		let posFwd  = this.positionAtDistance(Math.min(total, d + half));
		let diff = posFwd.sub(posBack);
		if (diff.lengthSq() < 1e-6) return null;
		return diff.normalize();
	}

	positionAtDistance (d) {
		let fp = this.viewer.fpControls;
		let positions = fp.routeFlyPositions;
		let dists = fp.routeFlyDistances;
		let lo = 0, hi = dists.length - 2;
		while (lo < hi) {
			let mid = (lo + hi + 1) >> 1;
			if (dists[mid] <= d) lo = mid;
			else hi = mid - 1;
		}
		let segLen = dists[lo + 1] - dists[lo];
		let frac = segLen > 0 ? (d - dists[lo]) / segLen : 0;
		return positions[lo].clone().lerp(positions[lo + 1], frac);
	}

	start () {
		if (!this.installed) this.install();
		if (this.active) return;
		this.container.style.display = 'block';
		this.layout();
		this.active = true;
	}

	stop () {
		if (!this.active) return;
		this.container.style.display = 'none';
		this.active = false;
	}

	// Called from the host's RAF loop while Route Fly is flying. Each frame:
	// position the side camera ahead of the pose and look back along -forward, so
	// the image is unmirrored (left-of-path on the left, right-of-path on the
	// right). Then render the main viewer's scene through our PotreeRenderer.
	onTick () {
		if (!this.active) return;
		let pos = this.currentPosition();
		let fwd = this.currentForward();
		if (!fwd) return;

		// Use the horizontal projection of forward so the slice plane is always
		// vertical (image up stays exactly world Z). If we used the raw 3D forward,
		// a route that climbs would tilt the camera and visibly roll the image as
		// the pitch changed segment-to-segment. For surveys the horizontal projection
		// matches what users expect: a vertical cross-section across the path.
		let fwdH = new THREE.Vector3(fwd.x, fwd.y, 0);
		if (fwdH.lengthSq() < 1e-6) return; // forward is straight up/down
		fwdH.normalize();

		// Camera sits just behind the pose, looking forward along +fwdH. With THREE's
		// lookAt convention (camera +X = up x (eye - target).normalize()), this gives
		// image-right = right-of-path. (Looking backward flips it: left-of-path ends
		// up on the right of the image.) vOffset shifts the camera along world Z,
		// hOffset along the horizontal "right of path" direction (= fwdH x worldUp);
		// the lookAt target shifts identically so the view direction stays = +fwdH.
		let rightDir = new THREE.Vector3().crossVectors(fwdH, WORLD_UP);
		this.camera.position.copy(pos)
			.addScaledVector(fwdH, -this.sliceThickness / 2)
			.addScaledVector(WORLD_UP, this.vOffset)
			.addScaledVector(rightDir, this.hOffset);
		this.camera.up.copy(WORLD_UP);
		this.camera.lookAt(this.camera.position.clone().addScaledVector(fwdH, 10));
		this.camera.updateMatrixWorld();

		this.layout();

		let gl = this.threeRenderer.getContext();
		gl.clearColor(0.05, 0.05, 0.05, 1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		this.pRenderer.render(this.viewer.scene.scenePointCloud, this.camera);
	}
}
