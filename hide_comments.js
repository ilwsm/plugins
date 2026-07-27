(function () {
	'use strict';

	// Removes the "comments/discuss" row from the movie/show card.
	// Hooks into Lampa's internal 'full' component build event and, the
	// moment the discuss row is created, hides it before it becomes
	// visible. We deliberately hide rather than destroy/splice it out
	// of the parent's internal items list: that list doubles as a
	// counter for how many rows have already been rendered, and removing
	// an entry from it desyncs the offset used when loading further rows,
	// causing the next row to be rendered twice.
	function startPlugin() {
		window.hide_comments_plugin = true;

		Lampa.Listener.follow('full', function (e) {
			if (e.type !== 'build' || e.name !== 'discuss') return;

			try {
				var item = e.item; // the discuss row instance

				if (item && item.html) {
					item.html.addClass('hide');
				}
			} catch (e) {
				// Fail silently, never break the movie card if Lampa's
				// internal structure differs on some version.
			}
		});
	}

	if (!window.hide_comments_plugin) startPlugin();
})();
