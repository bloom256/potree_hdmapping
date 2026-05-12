import * as THREE from "../libs/three.js/build/three.module.js";

// A small dot placed `distance` meters ahead of the camera along the trajectory's
// direction of travel. Useful in the "Rotate camera" mode: mouse-drag accumulates
// a body-frame yaw/pitch offset on top of the pose, and dragging the dot back
// to the center of the viewport brings the camera back to looking forward along
// the path.
//
// We use the trajectory tangent rather than the pose body +X axis because the
// lidar mount on this dataset is rotated 90 deg, so body +X points to the right
// of travel, not forward. Trajectory tangent matches the user's intuitive
// "forward" regardless of mount orientation.
//
// Visibility is controlled by the host via update(visible).
export class ForwardMarker {
	constructor (viewer, options = {}) {
		this.viewer = viewer;
		this.distance = options.distance ?? 10;
		// Window for smoothing the trajectory tangent. Wider = steadier marker
		// (no jitter from per-segment direction flips on noisy trajectories) but
		// slower to react when the path actually turns. ~10 m is about 3 seconds
		// at the default fly speed (3 m/s).
		this.windowM = options.windowM ?? 10;

		this.mesh = new THREE.Mesh(
			new THREE.SphereGeometry(options.size ?? 0.3, 16, 16),
			new THREE.MeshBasicMaterial({
				color: options.color ?? 0xff3030,
				depthTest: false,
				transparent: true,
				opacity: 0.9,
			})
		);
		this.mesh.renderOrder = 999;
		this.mesh.visible = false;
		viewer.scene.scene.add(this.mesh);
	}

	update (visible) {
		let fp = this.viewer.fpControls;
		let positions = fp.routeFlyPositions;
		let dists = fp.routeFlyDistances;
		let ready = visible && positions && positions.length >= 2 && dists;
		this.mesh.visible = !!ready;
		if (!ready) return;

		// Average the trajectory tangent over a +/- windowM/2 m window so local
		// position jitter doesn't make the marker dance segment-to-segment.
		let d = fp.routeFlyDistance;
		let total = dists[dists.length - 1];
		let half = this.windowM / 2;
		let posBack = this.positionAtDistance(positions, dists, Math.max(0, d - half));
		let posFwd  = this.positionAtDistance(positions, dists, Math.min(total, d + half));
		let forward = posFwd.sub(posBack);
		if (forward.lengthSq() < 1e-6) return;
		forward.normalize();
		this.mesh.position
			.copy(this.viewer.scene.view.position)
			.addScaledVector(forward, this.distance);
	}

	positionAtDistance (positions, dists, d) {
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
}
