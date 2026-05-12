// Cross-section: reuse Potree's built-in Profile tool. The user clicks two points
// on the cloud to define a corridor; we auto-finish after the second click so they
// don't need to RMB to end insertion. The orthographic side view opens only once
// both endpoints are placed, and closing the window also clears the corridor from
// the 3D scene (profileWindow.hide() is patched).
export class CrossSectionTool {
	constructor (viewer, options = {}) {
		this.viewer = viewer;
		this.buttonId = options.buttonId || 'cross_section_btn';
		this.currentProfile = null;
	}

	install () {
		let btn = document.getElementById(this.buttonId);
		if (!btn) return;
		btn.style.display = 'inline-block';

		// The profile window's built-in close button only hide()s the window; it leaves
		// the corridor in the 3D scene. Wrap profileWindow.hide() so any close path
		// (X button, future programmatic close) also removes the profile. Wait for
		// loadGUI to finish - profileWindow is constructed asynchronously inside it.
		this.viewer.promiseGuiLoaded().then(() => {
			let originalHide = this.viewer.profileWindow.hide.bind(this.viewer.profileWindow);
			this.viewer.profileWindow.hide = () => {
				originalHide();
				this.clearCurrentProfile();
			};
		});

		btn.addEventListener('click', () => this.onClick(btn));
	}

	clearCurrentProfile () {
		if (this.currentProfile) {
			this.viewer.scene.removeProfile(this.currentProfile);
			this.currentProfile = null;
		}
	}

	onClick (btn) {
		this.clearCurrentProfile();
		let profile = this.viewer.profileTool.startInsertion();
		this.currentProfile = profile;

		// A cross-section is a single rectangle: exactly two endpoints. After two
		// LMB clicks, profile.points has 3 entries (initial + 2 placed + 1 in-flight
		// being dragged). Dispatch cancel_insertions to drop the in-flight marker,
		// leaving the two placed endpoints. Defer with setTimeout so the click
		// cycle's startDragging() finishes before we tear down - otherwise it would
		// re-grab the previous sphere we just kept.
		let stopAfterTwo = () => {
			if (profile.points.length >= 3) {
				profile.removeEventListener('marker_added', stopAfterTwo);
				setTimeout(() => {
					this.viewer.dispatchEvent({ type: 'cancel_insertions' });
				}, 0);
			}
		};
		profile.addEventListener('marker_added', stopAfterTwo);

		// Show the profile window only once insertion has finished, and only if
		// both endpoints were placed. RMB-abort before two clicks discards the
		// profile entirely. Deferred via setTimeout so ProfileTool's own cancel
		// handler (which removes the in-flight marker) has run first.
		let onCancel = () => {
			this.viewer.removeEventListener('cancel_insertions', onCancel);
			profile.removeEventListener('marker_added', stopAfterTwo);
			setTimeout(() => {
				if (profile.points.length === 2) {
					this.viewer.profileWindow.show();
					this.viewer.profileWindowController.setProfile(profile);
				} else {
					if (this.currentProfile === profile) this.currentProfile = null;
					this.viewer.scene.removeProfile(profile);
				}
			}, 0);
		};
		this.viewer.addEventListener('cancel_insertions', onCancel);

		let canvas = this.viewer.renderer && this.viewer.renderer.domElement;
		if (canvas) canvas.focus();
		else btn.blur();
	}
}
