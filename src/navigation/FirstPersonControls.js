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
			ROT_DOWN: [40]   // arrow down
		};

		this.fadeFactor = 50;
		this.yawDelta = 0;
		this.pitchDelta = 0;
		this.translationDelta = new THREE.Vector3(0, 0, 0);
		this.translationWorldDelta = new THREE.Vector3(0, 0, 0);

		this.tweens = [];

		this.routeFlyActive = false;
		this.routeFlyPositions = null;
		this.routeFlyDistances = null;
		this.routeFlyTotalLength = 0;
		this.routeFlyDistance = 0;

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
			let speed = this.viewer.getMoveSpeed();

			if (e.delta < 0) {
				speed = speed * 0.9;
			} else if (e.delta > 0) {
				speed = speed / 0.9;
			}

			speed = Math.max(speed, 0.1);

			this.viewer.setMoveSpeed(speed);
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

	startRouteFly (positions) {
		if (!positions || positions.length < 2) return;

		// recompute path data only if positions changed
		if (this.routeFlyPositions !== positions) {
			let distances = [0];
			for (let i = 1; i < positions.length; i++) {
				distances.push(distances[i - 1] + positions[i].distanceTo(positions[i - 1]));
			}
			this.routeFlyPositions = positions;
			this.routeFlyDistances = distances;
			this.routeFlyTotalLength = distances[distances.length - 1];
			this.routeFlyDistance = 0;
		}

		this.routeFlyActive = true;
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
				if (moveForward || moveBackward || moveLeft || moveRight || moveUp || moveDown) {
					this.stopRouteFly();
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
				// reached the end — reset so next start begins from 0
				let last = this.routeFlyPositions[this.routeFlyPositions.length - 1];
				this.scene.view.position.set(last.x, last.y, last.z);
				this.routeFlyDistance = 0;
				this.stopRouteFly();
			} else {
				// binary search for segment
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
					p0.z + (p1.z - p0.z) * frac
				);
			}
		}

		{ // arrow key rotation
			let ih = this.viewer.inputHandler;

			let rotLeft = this.keys.ROT_LEFT.some(e => ih.pressedKeys[e]);
			let rotRight = this.keys.ROT_RIGHT.some(e => ih.pressedKeys[e]);
			let rotUp = this.keys.ROT_UP.some(e => ih.pressedKeys[e]);
			let rotDown = this.keys.ROT_DOWN.some(e => ih.pressedKeys[e]);

			let arrowRotSpeed = 0.5;

			if (rotLeft) this.yawDelta -= arrowRotSpeed;
			if (rotRight) this.yawDelta += arrowRotSpeed;
			if (rotUp) this.pitchDelta -= arrowRotSpeed;
			if (rotDown) this.pitchDelta += arrowRotSpeed;
		}

		{ // apply rotation
			let yaw = view.yaw;
			let pitch = view.pitch;

			yaw -= this.yawDelta * delta;
			pitch -= this.pitchDelta * delta;

			view.yaw = yaw;
			view.pitch = pitch;
		}

		if (!this.routeFlyActive) { // apply translation
			view.translate(
				this.translationDelta.x * delta,
				this.translationDelta.y * delta,
				this.translationDelta.z * delta
			);

			view.translateWorld(
				this.translationWorldDelta.x * delta,
				this.translationWorldDelta.y * delta,
				this.translationWorldDelta.z * delta
			);
		}

		{ // set view target according to speed
			view.radius = 3 * this.viewer.getMoveSpeed();
		}

		{ // decelerate over time
			let attenuation = Math.max(0, 1 - this.fadeFactor * delta);
			this.yawDelta *= attenuation;
			this.pitchDelta *= attenuation;
			this.translationDelta.multiplyScalar(attenuation);
			this.translationWorldDelta.multiplyScalar(attenuation);
		}
	}
};
