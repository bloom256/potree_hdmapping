
import * as THREE from "../../libs/three.js/build/three.module.js";
import {PointSizeType} from "../defines.js";
import {Utils} from "../utils.js";
import {updateVisibility} from "../Potree_update_visibility.js";
import {EyeDomeLightingMaterial} from "../materials/EyeDomeLightingMaterial.js";

export class Minimap {

	constructor(viewer) {
		this.viewer = viewer;

		this.enabled = true;
		this.zoom = 30;
		this.size = 200;
		this.margin = 10;
		this.panOffset = new THREE.Vector2(0, 0);
		this._lastCamPos = new THREE.Vector3();
		this._panReturning = false;

		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50000);
		this.camera.up.set(0, 1, 0);

		// EDL render target
		let mmSize = this.size * (window.devicePixelRatio || 1);
		this.rtEDL = new THREE.WebGLRenderTarget(mmSize, mmSize, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			type: THREE.FloatType,
			depthTexture: new THREE.DepthTexture(undefined, undefined, THREE.UnsignedIntType),
		});
		this.edlMaterial = null; // lazy-init

		// Semi-transparent background quad
		this.bgScene = new THREE.Scene();
		this.bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
		let bgQuad = new THREE.Mesh(
			new THREE.PlaneGeometry(2, 2),
			new THREE.MeshBasicMaterial({
				color: 0x111111, transparent: true, opacity: 0.7,
				depthTest: false, depthWrite: false,
			})
		);
		this.bgScene.add(bgQuad);

		this.overlay = new THREE.Scene();

		// Camera marker: filled FOV triangle
		this.marker = this._buildMarker();
		this.overlay.add(this.marker);

		this._bindEvents();
	}

	_buildMarker() {
		let markerGroup = new THREE.Group();

		let halfFov = Math.PI / 8; // 22.5° half-angle → 45° total spread
		let wedgeLen = 3.0;
		let lx = Math.sin(halfFov) * wedgeLen;
		let ly = Math.cos(halfFov) * wedgeLen;

		let shape = new THREE.Shape();
		shape.moveTo(0, 0);
		shape.lineTo(-lx, ly);
		shape.lineTo(lx, ly);
		shape.closePath();

		let triGeo = new THREE.ShapeGeometry(shape);
		let triMat = new THREE.MeshBasicMaterial({
			color: 0xffff00,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.5,
			depthTest: false,
		});
		markerGroup.add(new THREE.Mesh(triGeo, triMat));

		// Bright outline edges
		let edgeVerts = new Float32Array([
			0, 0, 0, -lx, ly, 0,
			-lx, ly, 0, lx, ly, 0,
			lx, ly, 0, 0, 0, 0,
		]);
		let edgeGeo = new THREE.BufferGeometry();
		edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeVerts, 3));
		let edgeMat = new THREE.LineBasicMaterial({
			color: 0xffff00,
			depthTest: false,
		});
		markerGroup.add(new THREE.LineSegments(edgeGeo, edgeMat));

		return markerGroup;
	}

	_bindEvents() {
		let viewer = this.viewer;
		let renderArea = viewer.renderArea;

		// Scroll-to-zoom on minimap (capture phase to block speed change)
		renderArea.addEventListener('wheel', (e) => {
			if (!this.enabled) return;
			if (!this.isMouseOver(e)) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			let factor = e.deltaY > 0 ? 0.85 : 1.18;
			this.zoom = Math.max(0.2, Math.min(50, this.zoom * factor));
		}, {capture: true});

		// Double-click on minimap to teleport (animated, 3D with terrain height)
		renderArea.addEventListener('dblclick', (e) => {
			if (!this.enabled) return;
			if (!this.isMouseOver(e)) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			let worldPos = this.screenToWorld(e);
			if (worldPos) {
				let targetZ = viewer.scene.view.position.z;
				let height = this.estimateTerrainHeight(worldPos.x, worldPos.y);
				if (height !== null) {
					targetZ = height + viewer.scene.view.radius;
				}
				let targetPos = new THREE.Vector3(worldPos.x, worldPos.y, targetZ);
				let dir = viewer.scene.view.direction;
				let targetTarget = targetPos.clone().add(dir.multiplyScalar(viewer.scene.view.radius));
				viewer.scene.view.setView(targetPos, targetTarget, 600);
			}
		}, true);

		// Drag to pan minimap (left) or move camera (right)
		let mmDragMode = null;
		let mmDragLastX = 0;
		let mmDragLastY = 0;
		renderArea.addEventListener('mousedown', (e) => {
			if (!this.enabled) return;
			if (!this.isMouseOver(e)) return;
			if (e.button !== 0 && e.button !== 2) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			mmDragMode = e.button === 0 ? 'pan' : 'move';
			mmDragLastX = e.clientX;
			mmDragLastY = e.clientY;
		}, true);
		renderArea.addEventListener('contextmenu', (e) => {
			if (!this.enabled) return;
			if (!this.isMouseOver(e)) return;
			e.preventDefault();
			e.stopImmediatePropagation();
		}, true);
		window.addEventListener('mousemove', (e) => {
			if (!mmDragMode) return;
			let dx = e.clientX - mmDragLastX;
			let dy = e.clientY - mmDragLastY;
			mmDragLastX = e.clientX;
			mmDragLastY = e.clientY;
			let cam = this.camera;
			let worldPerPixel = (cam.right - cam.left) / this.size;
			if (mmDragMode === 'pan') {
				this.panOffset.x -= dx * worldPerPixel;
				this.panOffset.y += dy * worldPerPixel;
			} else {
				viewer.scene.view.position.x -= dx * worldPerPixel;
				viewer.scene.view.position.y += dy * worldPerPixel;
			}
		});
		window.addEventListener('mouseup', (e) => {
			mmDragMode = null;
		});
	}

	screenToWorld(event) {
		let rect = this.viewer.renderArea.getBoundingClientRect();
		let mx = event.clientX - rect.left;
		let my = event.clientY - rect.top;
		let s = this.size;
		let m = this.margin;
		let left = rect.width - s - m;
		let top = rect.height - s - m;
		let nx = (mx - left) / s;
		let ny = (my - top) / s;
		let cam = this.camera;
		let worldX = cam.position.x + cam.left + nx * (cam.right - cam.left);
		let worldY = cam.position.y + cam.top - ny * (cam.top - cam.bottom);
		return {x: worldX, y: worldY};
	}

	isMouseOver(event) {
		let rect = this.viewer.renderArea.getBoundingClientRect();
		let mx = event.clientX - rect.left;
		let my = event.clientY - rect.top;
		let s = this.size;
		let m = this.margin;
		let left = rect.width - s - m;
		let top = rect.height - s - m;
		return mx >= left && mx <= left + s && my >= top && my <= top + s;
	}

	estimateTerrainHeight(worldX, worldY) {
		let bestHeight = null;
		let bestSpacing = Infinity;

		for (let pointcloud of this.viewer.scene.pointclouds) {
			if (!pointcloud.root) continue;

			let worldToObj = pointcloud.matrixWorld.clone().invert();
			let objPos = new THREE.Vector3(worldX, worldY, 0).applyMatrix4(worldToObj);

			let ray = new THREE.Ray(
				new THREE.Vector3(objPos.x, objPos.y, -100000),
				new THREE.Vector3(0, 0, 1)
			);

			let stack = [pointcloud.root];
			while (stack.length > 0) {
				let node = stack.pop();
				let box = node.getBoundingBox();
				if (!box || !ray.intersectsBox(box)) continue;

				let geoNode = node.geometryNode || node;
				let spacing = geoNode.spacing || Infinity;
				let nodeBox = geoNode.boundingBox || box;

				if (spacing <= bestSpacing) {
					let centerZ = (nodeBox.min.z + nodeBox.max.z) / 2;
					let worldPt = new THREE.Vector3(objPos.x, objPos.y, centerZ)
						.applyMatrix4(pointcloud.matrixWorld);
					bestHeight = worldPt.z;
					bestSpacing = spacing;
				}

				let children = node.getChildren ? node.getChildren() : [];
				for (let child of children) {
					stack.push(child);
				}
			}
		}

		return bestHeight;
	}

	render() {
		if (!this.enabled) return;

		let viewer = this.viewer;
		if (viewer.scene.pointclouds.length === 0) return;

		const renderer = viewer.renderer;
		const gl = renderer.getContext();
		const box = viewer.scene.getBoundingBox(viewer.scene.pointclouds);
		if (box.isEmpty()) return;

		const boxSize = box.getSize(new THREE.Vector3());
		const boxCenter = box.getCenter(new THREE.Vector3());

		// Update minimap ortho camera: top-down view (looking down -Z)
		const baseExtent = Math.max(boxSize.x, boxSize.y) * 0.55;
		const extent = baseExtent / this.zoom;
		const cam = this.camera;
		cam.left = -extent;
		cam.right = extent;
		cam.top = extent;
		cam.bottom = -extent;
		cam.near = 0.1;
		cam.far = boxSize.z + 1000;

		// Smoothly return pan offset to zero when main camera moves
		const mainPos = viewer.scene.view.position;
		const cameraMoved = !this._lastCamPos.equals(mainPos);
		if (cameraMoved) {
			this._panReturning = true;
			this._lastCamPos.copy(mainPos);
		}
		if (this._panReturning) {
			if (this.panOffset.lengthSq() > 0.0001) {
				this.panOffset.multiplyScalar(0.85);
			} else {
				this.panOffset.set(0, 0);
				this._panReturning = false;
			}
		}

		// Center on camera position when zoomed in, on bbox center when zoomed out
		const t = Math.min(1, Math.max(0, (this.zoom - 1) / 2));
		const cx = boxCenter.x + (mainPos.x - boxCenter.x) * t + this.panOffset.x;
		const cy = boxCenter.y + (mainPos.y - boxCenter.y) * t + this.panOffset.y;
		cam.position.set(cx, cy, box.max.z + 500);
		cam.lookAt(cx, cy, boxCenter.z);
		cam.updateProjectionMatrix();
		cam.updateMatrixWorld(true);

		// Update camera marker position & rotation
		const yaw = viewer.scene.view.yaw;
		const markerScale = extent * 0.06;
		this.marker.position.set(mainPos.x, mainPos.y, box.max.z + 499);
		this.marker.rotation.set(0, 0, yaw);
		this.marker.scale.set(markerScale, markerScale, markerScale);

		// Viewport in bottom-right corner
		const minimapSize = this.size;
		const margin = this.margin;
		const canvas = renderer.domElement;
		const pixelRatio = renderer.getPixelRatio();
		const canvasW = canvas.width;
		const canvasH = canvas.height;
		const vpX = canvasW - (minimapSize + margin) * pixelRatio;
		const vpY = margin * pixelRatio;
		const vpSize = minimapSize * pixelRatio;

		// Save current state
		const oldScissorTest = gl.isEnabled(gl.SCISSOR_TEST);

		// Draw 1px border
		renderer.setScissorTest(true);
		renderer.setScissor(vpX - 1, vpY - 1, vpSize + 2, vpSize + 2);
		renderer.setClearColor(0x666666, 1);
		renderer.clear(true, true, true);

		// Clear depth only (keep main scene visible behind)
		renderer.setScissor(vpX, vpY, vpSize, vpSize);
		renderer.clear(false, true, true);

		// Set viewport for minimap rendering
		renderer.setViewport(vpX, vpY, vpSize, vpSize);

		// Semi-transparent background overlay
		renderer.render(this.bgScene, this.bgCamera);
		renderer.clear(false, true, false);

		// Run separate visibility pass for minimap camera with limited budget
		const pointclouds = viewer.scene.pointclouds;
		const savedVisibleNodes = pointclouds.map(pc => pc.visibleNodes);
		const savedBudgets = pointclouds.map(pc => pc.pointBudget);
		const savedGlobalBudget = Potree.pointBudget;
		Potree.pointBudget = 600000;
		for (let pc of pointclouds) {
			pc.pointBudget = 600000;
		}
		updateVisibility(pointclouds, cam, renderer);
		Potree.pointBudget = savedGlobalBudget;

		// Save and set material for minimap: fixed small points, EDL enabled
		const savedMat = pointclouds.map(pc => ({
			size: pc.material.size,
			minSize: pc.material.minSize,
			sizeType: pc.material.pointSizeType,
			useEDL: pc.material.useEDL,
			weighted: pc.material.weighted,
			useLog: pc.material.useLogarithmicDepthBuffer,
			screenW: pc.material.screenWidth,
			screenH: pc.material.screenHeight,
			spacing: pc.material.spacing,
		}));
		for (let i = 0; i < pointclouds.length; i++) {
			let pc = pointclouds[i];
			pc.pointBudget = savedBudgets[i];
			pc.material.size = 1;
			pc.material.minSize = 1;
			pc.material.pointSizeType = PointSizeType.FIXED;
			pc.material.weighted = false;
			pc.material.useLogarithmicDepthBuffer = false;
			pc.material.useEDL = true;
			pc.material.screenWidth = vpSize;
			pc.material.screenHeight = vpSize;
			pc.material.uniforms.octreeSize.value = pc.pcoGeometry.boundingBox.getSize(new THREE.Vector3()).x;
			pc.material.spacing = pc.pcoGeometry.spacing;
		}

		// Render point cloud to offscreen RT for EDL
		this.rtEDL.setSize(vpSize, vpSize);
		renderer.setScissorTest(false);
		renderer.setRenderTarget(this.rtEDL);
		renderer.setViewport(0, 0, vpSize, vpSize);
		renderer.setClearColor(0x000000, 0);
		renderer.clear(true, true, true);
		viewer.pRenderer.render(viewer.scene.scenePointCloud, cam, this.rtEDL, {
			transparent: false,
		});

		// Restore material
		for (let i = 0; i < pointclouds.length; i++) {
			let s = savedMat[i];
			let m = pointclouds[i].material;
			pointclouds[i].visibleNodes = savedVisibleNodes[i];
			m.size = s.size;
			m.minSize = s.minSize;
			m.pointSizeType = s.sizeType;
			m.useEDL = s.useEDL;
			m.weighted = s.weighted;
			m.useLogarithmicDepthBuffer = s.useLog;
			m.screenWidth = s.screenW;
			m.screenHeight = s.screenH;
			m.spacing = s.spacing;
		}

		// Apply EDL post-processing to minimap viewport
		if (!this.edlMaterial) {
			this.edlMaterial = new EyeDomeLightingMaterial();
			this.edlMaterial.depthTest = true;
			this.edlMaterial.depthWrite = true;
			this.edlMaterial.transparent = true;
		}
		let eu = this.edlMaterial.uniforms;
		eu.screenWidth.value = vpSize;
		eu.screenHeight.value = vpSize;
		eu.uNear.value = cam.near;
		eu.uFar.value = cam.far;
		eu.uEDLColor.value = this.rtEDL.texture;
		eu.uEDLDepth.value = this.rtEDL.depthTexture;
		eu.uProj.value = new Float32Array(cam.projectionMatrix.elements);
		eu.edlStrength.value = viewer.edlStrength * 2.0;
		eu.radius.value = viewer.edlRadius * 2.0;
		eu.opacity.value = 1.0;

		// Blit EDL result to minimap viewport on screen
		renderer.setRenderTarget(null);
		renderer.resetState();
		renderer.setScissorTest(true);
		renderer.setScissor(vpX, vpY, vpSize, vpSize);
		renderer.setViewport(vpX, vpY, vpSize, vpSize);
		Utils.screenPass.render(renderer, this.edlMaterial);

		// Render scene overlays (trajectory, poses, etc)
		renderer.render(viewer.scene.scene, cam);

		// Render camera marker
		renderer.render(this.overlay, cam);

		// Restore full viewport and scissor state
		renderer.setViewport(0, 0, canvasW, canvasH);
		renderer.setScissorTest(oldScissorTest);
		if (!oldScissorTest) {
			renderer.setScissor(0, 0, canvasW, canvasH);
		}
		renderer.setClearColor(0x000000, 0);
	}
}
