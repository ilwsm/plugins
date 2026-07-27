(function () {
	'use strict';

	// Removes the "comments/discuss" row from the movie/show card.
	// Hooks into Lampa's internal 'full' component build event and, the
	// moment the discuss row is created, removes it from both the DOM
	// and the parent's navigation items list (so keyboard/remote
	// up/down navigation doesn't land on an invisible row).
	function startPlugin() {
		window.hide_comments_plugin = true;

		Lampa.Listener.follow('full', function (e) {
			if (e.type !== 'build' || e.name !== 'discuss') return;

			try {
				var parent = e.link; // the movie card component instance
				var item = e.item;   // the discuss row instance

				// Remove from the parent's internal items array so
				// remote-control navigation skips it cleanly.
				if (parent && Array.isArray(parent.items)) {
					var idx = parent.items.indexOf(item);
					if (idx !== -1) parent.items.splice(idx, 1);
				}

				// Detach the row's DOM node and clean up its internal scroll.
				if (item && typeof item.destroy === 'function') {
					item.destroy();
				}
			} catch (e) {
				// Fail silently, never break the movie card if Lampa's
				// internal structure differs on some version.
			}
		});
	}

	if (!window.hide_comments_plugin) startPlugin();
})();
