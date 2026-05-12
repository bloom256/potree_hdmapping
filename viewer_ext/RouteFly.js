import * as THREE from "../libs/three.js/build/three.module.js";
import { RouteSlice } from "./RouteSlice.js";
import { ForwardMarker } from "./ForwardMarker.js";

// All the Route Fly UI and per-frame work, factored out of index.html. Wires the
// existing DOM (#route_fly_btn, #route_fly_bar, #route_fly_slider,
// #route_fly_progress, #route_pause_btn, #rotate_camera_chk/label,
// #controls_hint, #potree_render_area) to viewer.fpControls' Route Fly state and
// to the side-view slice + forward-direction marker.
//
// The host calls setTrajectory(positions) once the route geometry is parsed and
// setPoses(poses) once pose_after_lc data is parsed. Either may arrive first;
// the Rotate-camera toggle becomes visible only when both are present.
export class RouteFly {
	constructor (viewer) {
		this.viewer = viewer;

		this.positions = null;
		this.poseKeyframes = null;
		this.flying = false;
		this.scrubbing = false;
		// True while the user is holding LMB on the render canvas to rotate the
		// camera; used to gate the forward marker so it only appears during the
		// rotation itself.
		this.mouseRotating = false;

		this.btn = document.getElementById('route_fly_btn');
		this.bar = document.getElementById('route_fly_bar');
		this.slider = document.getElementById('route_fly_slider');
		this.progressLabel = document.getElementById('route_fly_progress');
		this.pauseBtn = document.getElementById('route_pause_btn');
		this.rotateChk = document.getElementById('rotate_camera_chk');
		this.rotateLabel = document.getElementById('rotate_camera_label');
		this.controlsHint = document.getElementById('controls_hint');
		this.renderAreaEl = document.getElementById('potree_render_area');
		this.sliderMax = parseInt(this.slider.max, 10);

		this.routeSlice = new RouteSlice(viewer);
		this.forwardMarker = new ForwardMarker(viewer);

		this.wireUI();
		this.wireSidebarSync();
		this.wireMouseRotate();
		requestAnimationFrame(this.tick.bind(this));
	}

	// Track LMB-down/up on the render canvas so the forward marker only shows
	// while the user is actively dragging the camera around. Listen to mouseup
	// on the window too because the cursor often leaves the canvas mid-drag.
	wireMouseRotate () {
		let canvas = this.viewer.renderer && this.viewer.renderer.domElement;
		if (!canvas) return;
		canvas.addEventListener('mousedown', (e) => {
			if (e.button === 0) this.mouseRotating = true;
		});
		window.addEventListener('mouseup', (e) => {
			if (e.button === 0) this.mouseRotating = false;
		});
	}

	setTrajectory (positions) {
		this.positions = positions;
		this.viewer.fpControls.initRouteFly(positions);
		this.btn.style.display = 'inline-block';
		this.updateRotateToggleVisibility();
	}

	setPoses (poses) {
		this.poseKeyframes = this.buildPoseKeyframes(poses);
		this.updateRotateToggleVisibility();
	}

	// Pose convention: row-major 4x4, +X is body forward.
	buildPoseKeyframes (poses) {
		let positions = [];
		let quaternions = [];
		let m4 = new THREE.Matrix4();
		for (let i = 0; i < poses.length; i++) {
			let m = poses[i].matrix;
			positions.push(new THREE.Vector3(m[3], m[7], m[11]));
			m4.set(
				m[0], m[1], m[2],  m[3],
				m[4], m[5], m[6],  m[7],
				m[8], m[9], m[10], m[11],
				0,    0,    0,     1
			);
			quaternions.push(new THREE.Quaternion().setFromRotationMatrix(m4));
		}
		return { positions: positions, quaternions: quaternions };
	}

	updateRotateToggleVisibility () {
		if (!this.rotateLabel) return;
		let routeReady = this.btn.style.display !== 'none';
		let posesReady = !!this.poseKeyframes;
		this.rotateLabel.style.display = (routeReady && posesReady) ? 'inline-block' : 'none';
	}

	wireUI () {
		// Main Route Fly / Stop Fly button.
		this.btn.addEventListener('click', () => {
			if (!this.flying) {
				// Parked near the end (usually after scrubbing to 100%): restart from
				// the beginning. Otherwise resume where we stopped.
				if (parseInt(this.slider.value, 10) >= this.sliderMax * 0.99) {
					this.viewer.fpControls.seekRouteFly(0);
				}
				this.viewer.fpControls.startRouteFly(this.positions);
				this.updateSliderFromProgress();
				this.setFlying(true);
			} else {
				this.viewer.fpControls.stopRouteFly();
				this.setFlying(false);
			}
			this.focusCanvas();
		});

		this.viewer.fpControls.addEventListener('routefly_stopped', () => {
			this.setFlying(false);
			this.updateSliderFromProgress();
		});

		// Pause/Resume: toggle routeFlyActive without tearing down the bar/slice
		// so the user can freeze the fly to inspect a spot and resume.
		this.pauseBtn.addEventListener('click', () => {
			if (!this.flying) return;
			let fp = this.viewer.fpControls;
			fp.routeFlyActive = !fp.routeFlyActive;
			this.pauseBtn.textContent = fp.routeFlyActive ? 'Pause' : 'Resume';
			this.focusCanvas();
		});

		// Slider scrubbing.
		this.slider.addEventListener('mousedown', () => { this.scrubbing = true; });
		this.slider.addEventListener('touchstart', () => { this.scrubbing = true; });
		this.slider.addEventListener('mouseup', () => { this.scrubbing = false; });
		this.slider.addEventListener('touchend', () => { this.scrubbing = false; });
		this.slider.addEventListener('input', () => {
			let fraction = parseInt(this.slider.value, 10) / this.sliderMax;
			this.viewer.fpControls.seekRouteFly(fraction);
			this.progressLabel.textContent = Math.round(fraction * 100) + '%';
		});

		// Rotate-camera checkbox feeds pose keyframes to FP controls so the camera
		// orientation gets driven by interpolated pose quaternions during fly.
		if (this.rotateChk) {
			this.rotateChk.addEventListener('change', () => {
				let kf = this.rotateChk.checked ? this.poseKeyframes : null;
				this.viewer.fpControls.setRouteFlyOrientationKeyframes(kf);
			});
		}
	}

	// Potree sidebar open/close sets #potree_render_area's `left` to 300px when
	// open, 0 when closed. Keep the slider bar aligned to that shift.
	wireSidebarSync () {
		if (!this.renderAreaEl) return;
		let syncBarLeft = () => {
			let shift = parseInt(this.renderAreaEl.style.left || '0', 10);
			this.bar.style.left = (shift + 60) + 'px';
		};
		new MutationObserver(syncBarLeft).observe(this.renderAreaEl, {
			attributes: true, attributeFilter: ['style'],
		});
		syncBarLeft();
	}

	setFlying (on) {
		this.flying = on;
		this.btn.textContent = on ? 'Stop Fly' : 'Route Fly';
		this.bar.style.display = on ? 'flex' : 'none';
		this.controlsHint.style.top = on ? '50px' : '10px';
		this.pauseBtn.textContent = 'Pause';
		if (on) this.routeSlice.start();
		else this.routeSlice.stop();
	}

	updateSliderFromProgress () {
		let fraction = this.viewer.fpControls.getRouteFlyProgress();
		this.slider.value = Math.round(fraction * this.sliderMax);
		this.progressLabel.textContent = Math.round(fraction * 100) + '%';
	}

	// Return keyboard focus to the render canvas (tabIndex = 2222) so Space/WASD
	// keep reaching the camera instead of re-triggering whichever button we just
	// clicked.
	focusCanvas () {
		let canvas = this.viewer.renderer && this.viewer.renderer.domElement;
		if (canvas) canvas.focus();
	}

	tick () {
		if (this.flying && !this.scrubbing) {
			this.updateSliderFromProgress();
		}
		if (this.flying) this.routeSlice.onTick();
		this.forwardMarker.update(this.flying && this.mouseRotating);
		requestAnimationFrame(this.tick.bind(this));
	}
}
