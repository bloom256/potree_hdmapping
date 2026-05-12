/**
 * @author mschuetz / http://mschuetz.at
 *
 * adapted from THREE.OrbitControls by
 *
 * @author qiao / https://github.com/qiao
 * @author mrdoob / http://mrdoob.com
 * @author alteredq / http://alteredqualia.com/
 * @author WestLangley / http://github.com/WestLangley
 * @author erich666 / http://erichaines.com
 *
 *
 *
 */

import * as THREE from "../../libs/three.js/build/three.module.js";
import {MOUSE} from "../defines.js";
import {Utils} from "../utils.js";
import {EventDispatcher} from "../EventDispatcher.js";


export class FirstPersonControls extends EventDispatcher {
	constructor (viewer) {
		super();

		this.viewer = viewer;
		this.renderer = viewer.renderer;

		this.scene = null;
		this.sceneControls = new THREE.Scene();

		this.rotationSpeed = 200;
		this.moveSpeed = 10;
		this.lockElevation = false;

		this.keys = {
			FORWARD: ['W'.charCodeAt(0)],
			BACKWARD: ['S'.charCodeAt(0)],
			LEFT: ['A'.charCodeAt(0)],
			RIGHT: ['D'.charCodeAt(0)],
			UP: [32], // space
			DOWN: [16], // shift
			ROT_LEFT: [37],  // arrow left
			ROT_RIGHT: [39], // arrow right
			ROT_UP: [38],    // arrow up
			ROT_DOWN: [40],  // arrow down
			ROLL_LEFT: ['Q'.charCodeAt(0)],
			ROLL_RIGHT: ['E'.charCodeAt(0)],
			ROLL_RESET: ['R'.charCodeAt(0)]
		};

		this.fadeFactor = 50;
		this.yawDelta = 0;
		this.pitchDelta = 0;
		this.rollDelta = 0;
		this.translationDelta = new THREE.Vector3(0, 0, 0);
		this.translationWorldDelta = new THREE.Vector3(0, 0, 0);

		this.tweens = [];

		this.routeFlyActive = false;
		this.routeFlyPositions = null;
		this.routeFlyDistances = null;
		this.routeFlyTotalLength = 0;
		this.routeFlyDistance = 0;
		this.routeFlyHeightOffset = 0;
		// Optional pose-driven orientation: keyframes projected onto the route's arc-length.
		// Both arrays are the same length and sorted by ascending distance.
		this.routeFlyKeyframeDistances = null;
		this.routeFlyKeyframeQuaternions = null;
		// Body-frame look offsets applied on top of the pose-driven orientation so users can
		// tweak the camera direction with the mouse during a pose-driven Route Fly. Drag
		// accumulates into these the same way Space/Shift accumulates into routeFlyHeightOffset.
		this.routeFlyCamYawOffset = 0;
		this.routeFlyCamPitchOffset = 0;

		let drag = (e) => {
			if (e.drag.object !== null) {
				return;
			}

			if (e.drag.startHandled === undefined) {
				e.drag.startHandled = true;

				this.dispatchEvent({type: 'start'});
			}

			let moveSpeed = this.viewer.getMoveSpeed();

			let ndrag = {
				x: e.drag.lastDrag.x / this.renderer.domElement.clientWidth,
				y: e.drag.lastDrag.y / this.renderer.domElement.clientHeight
			};

			if (e.drag.mouse === MOUSE.LEFT) {
				this.yawDelta += ndrag.x * this.rotationSpeed;
				this.pitchDelta += ndrag.y * this.rotationSpeed;
			} else if (e.drag.mouse === MOUSE.RIGHT) {
				this.translationDelta.x -= ndrag.x * moveSpeed * 1500;
				// Forward/back: flatten view direction to ground plane
				let dir = this.scene.view.direction;
				let flat = new THREE.Vector3(dir.x, dir.y, 0).normalize();
				let panScale = ndrag.y * moveSpeed * 1500;
				this.translationWorldDelta.x += flat.x * panScale;
				this.translationWorldDelta.y += flat.y * panScale;
			}
		};

		let drop = e => {
			this.dispatchEvent({type: 'end'});
		};

		let scroll = (e) => {
			if (e.altKey) {
				// Alt+scroll: zoom forward/backward along view direction
				let dir = this.scene.view.direction;
				let step = this.viewer.getMoveSpeed() * e.delta * 0.5;
				this.scene.view.position.add(dir.clone().multiplyScalar(step));
			} else {
				let speed = this.viewer.getMoveSpeed();

				if (e.delta < 0) {
					speed = speed * 0.9;
				} else if (e.delta > 0) {
					speed = speed / 0.9;
				}

				speed = Math.max(speed, 0.1);

				this.viewer.setMoveSpeed(speed);
			}
		};

		let dblclick = (e) => {
			this.zoomToLocation(e.mouse);
		};

		this.addEventListener('drag', drag);
		this.addEventListener('drop', drop);
		this.addEventListener('mousewheel', scroll);
		this.addEventListener('dblclick', dblclick);
	}

	setScene (scene) {
		this.scene = scene;
	}

	stop(){
		this.yawDelta = 0;
		this.pitchDelta = 0;
		this.rollDelta = 0;
		this.translationDelta.set(0, 0, 0);
	}
	
	zoomToLocation(mouse){
		let camera = this.scene.getActiveCamera();
		
		let I = Utils.getMousePointCloudIntersection(
			mouse,
			camera,
			this.viewer,
			this.scene.pointclouds);

		if (I === null) {
			return;
		}

		let targetRadius = 0;
		{
			let minimumJumpDistance = 0.2;

			let domElement = this.renderer.domElement;
			let ray = Utils.mouseToRay(mouse, camera, domElement.clientWidth, domElement.clientHeight);

			let nodes = I.pointcloud.nodesOnRay(I.pointcloud.visibleNodes, ray);
			let lastNode = nodes[nodes.length - 1];
			let radius = lastNode.getBoundingSphere(new THREE.Sphere()).radius;
			targetRadius = Math.min(this.scene.view.radius, radius);
			targetRadius = Math.max(minimumJumpDistance, targetRadius);
		}

		let d = this.scene.view.direction.multiplyScalar(-1);
		let cameraTargetPosition = new THREE.Vector3().addVectors(I.location, d.multiplyScalar(targetRadius));
		// TODO Unused: let controlsTargetPosition = I.location;

		let animationDuration = 600;
		let easing = TWEEN.Easing.Quartic.Out;

		{ // animate
			let value = {x: 0};
			let tween = new TWEEN.Tween(value).to({x: 1}, animationDuration);
			tween.easing(easing);
			this.tweens.push(tween);

			let startPos = this.scene.view.position.clone();
			let targetPos = cameraTargetPosition.clone();
			let startRadius = this.scene.view.radius;
			let targetRadius = cameraTargetPosition.distanceTo(I.location);

			tween.onUpdate(() => {
				let t = value.x;
				this.scene.view.position.x = (1 - t) * startPos.x + t * targetPos.x;
				this.scene.view.position.y = (1 - t) * startPos.y + t * targetPos.y;
				this.scene.view.position.z = (1 - t) * startPos.z + t * targetPos.z;

				this.scene.view.radius = (1 - t) * startRadius + t * targetRadius;
				this.viewer.setMoveSpeed(this.scene.view.radius / 2.5);
			});

			tween.onComplete(() => {
				this.tweens = this.tweens.filter(e => e !== tween);
			});

			tween.start();
		}
	}

	initRouteFly (positions, options) {
		if (!positions || positions.length < 2) return false;

		let samePath = (this.routeFlyPositions === positions);
		if (!samePath) {
			let distances = [0];
			for (let i = 1; i < positions.length; i++) {
				distances.push(distances[i - 1] + positions[i].distanceTo(positions[i - 1]));
			}
			this.routeFlyPositions = positions;
			this.routeFlyDistances = distances;
			this.routeFlyTotalLength = distances[distances.length - 1];
			this.routeFlyDistance = 0;
		}

		let kf = options && options.orientationKeyframes;
		if (kf !== undefined) {
			this.setRouteFlyOrientationKeyframes(kf);
		} else if (!samePath) {
			// New path with no orientations supplied: drop any stale keyframes from the previous path.
			this.routeFlyKeyframeDistances = null;
			this.routeFlyKeyframeQuaternions = null;
		}
		return true;
	}

	// Build keyframe arrays sorted by arc-length on the active route. Pass null/undefined to clear.
	// keyframes: { positions: THREE.Vector3[], quaternions: THREE.Quaternion[] }
	setRouteFlyOrientationKeyframes (keyframes) {
		if (!keyframes || !this.routeFlyPositions
			|| !keyframes.positions || !keyframes.quaternions
			|| keyframes.positions.length !== keyframes.quaternions.length
			|| keyframes.positions.length < 2) {
			this.routeFlyKeyframeDistances = null;
			this.routeFlyKeyframeQuaternions = null;
			return;
		}

		let routePositions = this.routeFlyPositions;
		let routeDistances = this.routeFlyDistances;

		// Brute-force projection is O(N*M) and blocks the UI for several seconds on
		// real HD-mapping data (~10k poses x ~10k trajectory points). Drop the route
		// into a 2D grid and look up each pose in its local cell + 1-cell ring.
		// Poses sit on the trajectory so they always fall inside the search radius
		// when cellSize >= typical pose-to-route gap.
		let cellSize = 5;
		let grid = new Map();
		for (let j = 0; j < routePositions.length; j++) {
			let p = routePositions[j];
			let key = Math.floor(p.x / cellSize) + ',' + Math.floor(p.y / cellSize);
			let bucket = grid.get(key);
			if (bucket) bucket.push(j);
			else grid.set(key, [j]);
		}

		let pairs = [];
		for (let i = 0; i < keyframes.positions.length; i++) {
			let kp = keyframes.positions[i];
			let cx = Math.floor(kp.x / cellSize);
			let cy = Math.floor(kp.y / cellSize);
			let bestIdx = -1;
			let bestD = Infinity;
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					let bucket = grid.get((cx + dx) + ',' + (cy + dy));
					if (!bucket) continue;
					for (let k = 0; k < bucket.length; k++) {
						let j = bucket[k];
						let d = kp.distanceToSquared(routePositions[j]);
						if (d < bestD) { bestD = d; bestIdx = j; }
					}
				}
			}
			// Fallback for poses farther than cellSize from any route point.
			if (bestIdx < 0) {
				for (let j = 0; j < routePositions.length; j++) {
					let d = kp.distanceToSquared(routePositions[j]);
					if (d < bestD) { bestD = d; bestIdx = j; }
				}
			}
			pairs.push({ distance: routeDistances[bestIdx], quat: keyframes.quaternions[i].clone() });
		}
		pairs.sort((a, b) => a.distance - b.distance);
		this.routeFlyKeyframeDistances = pairs.map(p => p.distance);
		this.routeFlyKeyframeQuaternions = pairs.map(p => p.quat);
	}

	startRouteFly (positions, options) {
		if (!this.initRouteFly(positions, options)) return;
		this.routeFlyHeightOffset = 0;
		this.routeFlyActive = true;
	}

	getRouteFlyProgress () {
		if (!this.routeFlyPositions || this.routeFlyTotalLength <= 0) return 0;
		return this.routeFlyDistance / this.routeFlyTotalLength;
	}

	seekRouteFly (fraction) {
		if (!this.routeFlyPositions || this.routeFlyTotalLength <= 0) return;
		fraction = Math.max(0, Math.min(1, fraction));
		this.routeFlyDistance = fraction * this.routeFlyTotalLength;
		this.applyRouteFlyPosition();
	}

	applyRouteFlyPosition () {
		let d = this.routeFlyDistance;
		let dists = this.routeFlyDistances;
		let lo = 0, hi = dists.length - 2;
		while (lo < hi) {
			let mid = (lo + hi + 1) >> 1;
			if (dists[mid] <= d) lo = mid; else hi = mid - 1;
		}
		let segLen = dists[lo + 1] - dists[lo];
		let frac = segLen > 0 ? (d - dists[lo]) / segLen : 0;
		let p0 = this.routeFlyPositions[lo];
		let p1 = this.routeFlyPositions[lo + 1];
		this.scene.view.position.set(
			p0.x + (p1.x - p0.x) * frac,
			p0.y + (p1.y - p0.y) * frac,
			p0.z + (p1.z - p0.z) * frac + this.routeFlyHeightOffset
		);

		if (this.routeFlyKeyframeDistances) {
			this.applyRouteFlyOrientation(d);
		}
	}

	applyRouteFlyOrientation (d) {
		let kfd = this.routeFlyKeyframeDistances;
		let kfq = this.routeFlyKeyframeQuaternions;
		let q;

		if (d <= kfd[0]) {
			q = kfq[0];
		} else if (d >= kfd[kfd.length - 1]) {
			q = kfq[kfq.length - 1];
		} else {
			let lo = 0, hi = kfd.length - 2;
			while (lo < hi) {
				let mid = (lo + hi + 1) >> 1;
				if (kfd[mid] <= d) lo = mid; else hi = mid - 1;
			}
			let segLen = kfd[lo + 1] - kfd[lo];
			let frac = segLen > 0 ? (d - kfd[lo]) / segLen : 0;
			q = kfq[lo].clone().slerp(kfq[lo + 1], frac);
		}

		// Body-frame look direction: start at +X, pitch around body +Y (positive = look up),
		// yaw around body +Z (positive = rotate +X toward +Y), then transform to world by
		// the pose quaternion. Roll is reset so manual Q/E adjustments don't fight pose yaw/pitch.
		let forward = new THREE.Vector3(1, 0, 0);
		forward.applyAxisAngle(new THREE.Vector3(0, -1, 0), this.routeFlyCamPitchOffset);
		forward.applyAxisAngle(new THREE.Vector3(0, 0, 1), this.routeFlyCamYawOffset);
		forward.applyQuaternion(q);
		this.scene.view.direction = forward;
		this.scene.view.roll = 0;
	}

	stopRouteFly () {
		let wasActive = this.routeFlyActive;
		this.routeFlyActive = false;
		if (wasActive) {
			this.dispatchEvent({type: 'routefly_stopped'});
		}
	}

	update (delta) {
		let view = this.scene.view;
		// Flip yaw, pitch, and lateral movement when rolled past 90° (upside-down)
		let rollFlip = Math.cos(view.roll) >= 0 ? 1 : -1;

		{ // cancel move animations on user input
			let changes = [ this.yawDelta,
				this.pitchDelta,
				this.translationDelta.length(),
				this.translationWorldDelta.length() ];
			let changeHappens = changes.some(e => Math.abs(e) > 0.001);
			if (changeHappens && this.tweens.length > 0) {
				this.tweens.forEach(e => e.stop());
				this.tweens = [];
			}
		}

		{ // accelerate while input is given
			let ih = this.viewer.inputHandler;

			let moveForward = this.keys.FORWARD.some(e => ih.pressedKeys[e]);
			let moveBackward = this.keys.BACKWARD.some(e => ih.pressedKeys[e]);
			let moveLeft = this.keys.LEFT.some(e => ih.pressedKeys[e]);
			let moveRight = this.keys.RIGHT.some(e => ih.pressedKeys[e]);
			let moveUp = this.keys.UP.some(e => ih.pressedKeys[e]);
			let moveDown = this.keys.DOWN.some(e => ih.pressedKeys[e]);

			if (this.routeFlyActive) {
				if (moveForward || moveBackward || moveLeft || moveRight) {
					this.stopRouteFly();
				} else if (moveUp || moveDown) {
					let dz = this.viewer.getMoveSpeed() * delta;
					if (moveUp && !moveDown) this.routeFlyHeightOffset += dz;
					else if (moveDown && !moveUp) this.routeFlyHeightOffset -= dz;
				}
			}

			if (!this.routeFlyActive) {
			if(this.lockElevation){
				let dir = view.direction;
				dir.z = 0;
				dir.normalize();

				if (moveForward && moveBackward) {
					this.translationWorldDelta.set(0, 0, 0);
				} else if (moveForward) {
					this.translationWorldDelta.copy(dir.multiplyScalar(this.viewer.getMoveSpeed()));
				} else if (moveBackward) {
					this.translationWorldDelta.copy(dir.multiplyScalar(-this.viewer.getMoveSpeed()));
				}
			}else{
				if (moveForward && moveBackward) {
					this.translationDelta.y = 0;
				} else if (moveForward) {
					this.translationDelta.y = this.viewer.getMoveSpeed();
				} else if (moveBackward) {
					this.translationDelta.y = -this.viewer.getMoveSpeed();
				}
			}

			if (moveLeft && moveRight) {
				this.translationDelta.x = 0;
			} else if (moveLeft) {
				this.translationDelta.x = -this.viewer.getMoveSpeed();
			} else if (moveRight) {
				this.translationDelta.x = this.viewer.getMoveSpeed();
			}

			if (moveUp && moveDown) {
				this.translationWorldDelta.z = 0;
			} else if (moveUp) {
				this.translationWorldDelta.z = this.viewer.getMoveSpeed();
			} else if (moveDown) {
				this.translationWorldDelta.z = -this.viewer.getMoveSpeed();
			}
			}
		}

		if (this.routeFlyActive) { // advance route fly by moveSpeed
			this.routeFlyDistance += this.viewer.getMoveSpeed() * delta;

			if (this.routeFlyDistance >= this.routeFlyTotalLength) {
				// reached the end — snap to last point and stop
				let last = this.routeFlyPositions[this.routeFlyPositions.length - 1];
				this.scene.view.position.set(last.x, last.y, last.z + this.routeFlyHeightOffset);
				this.routeFlyDistance = 0;
				this.stopRouteFly();
			} else {
				this.applyRouteFlyPosition();
			}
		}

		{ // arrow key rotation + Q/E roll
			let ih = this.viewer.inputHandler;

			let rotLeft = this.keys.ROT_LEFT.some(e => ih.pressedKeys[e]);
			let rotRight = this.keys.ROT_RIGHT.some(e => ih.pressedKeys[e]);
			let rotUp = this.keys.ROT_UP.some(e => ih.pressedKeys[e]);
			let rotDown = this.keys.ROT_DOWN.some(e => ih.pressedKeys[e]);
			let rollLeft = this.keys.ROLL_LEFT.some(e => ih.pressedKeys[e]);
			let rollRight = this.keys.ROLL_RIGHT.some(e => ih.pressedKeys[e]);

			let arrowRotSpeed = 0.5;

			if (rotLeft) this.yawDelta -= arrowRotSpeed;
			if (rotRight) this.yawDelta += arrowRotSpeed;
			if (rotUp) this.pitchDelta -= arrowRotSpeed;
			if (rotDown) this.pitchDelta += arrowRotSpeed;
			if (rollLeft) this.rollDelta -= arrowRotSpeed;
			if (rollRight) this.rollDelta += arrowRotSpeed;

			let rollReset = this.keys.ROLL_RESET.some(e => ih.pressedKeys[e]);
			if (rollReset) {
				view.roll = 0;
				this.rollDelta = 0;
			}
		}

		{ // apply rotation
			let yawChange = this.yawDelta * delta * rollFlip;
			let pitchChange = this.pitchDelta * delta * rollFlip;

			if (this.routeFlyActive && this.routeFlyKeyframeDistances) {
				// Pose-driven: mouse drag accumulates as body-frame look offset, so the next
				// applyRouteFlyOrientation call composes pose * (yaw + pitch offsets) and the
				// adjustment sticks instead of fighting the pose reset every frame.
				this.routeFlyCamYawOffset -= yawChange;
				this.routeFlyCamPitchOffset -= pitchChange;
			} else {
				view.yaw -= yawChange;
				view.pitch -= pitchChange;
				view.roll -= this.rollDelta * delta;
			}
		}

		if (!this.routeFlyActive) { // apply translation
			view.translate(
				this.translationDelta.x * delta * rollFlip,
				this.translationDelta.y * delta,
				this.translationDelta.z * delta
			);

			view.translateWorld(
				this.translationWorldDelta.x * delta,
				this.translationWorldDelta.y * delta,
				this.translationWorldDelta.z * delta * rollFlip
			);
		}

		{ // set view target according to speed
			view.radius = 3 * this.viewer.getMoveSpeed();
		}

		{ // decelerate over time
			let attenuation = Math.max(0, 1 - this.fadeFactor * delta);
			this.yawDelta *= attenuation;
			this.pitchDelta *= attenuation;
			this.rollDelta *= attenuation;
			this.translationDelta.multiplyScalar(attenuation);
			this.translationWorldDelta.multiplyScalar(attenuation);
		}
	}
};
