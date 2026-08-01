(function () {
	'use strict';

	// Diagnostic plugin: adds a "Тест кодов пульта" item to the "..." menu.
	// Opens a modal that logs every raw keydown event (key/code/keyCode/which)
	// as it happens, so real remote button codes can be identified empirically
	// instead of guessed from documentation that may not match this exact
	// remote/firmware.
	//
	// Note: pressing "Назад" will close this modal as normal (Lampa's own
	// core key handler drives that independently of this plugin and can't
	// be intercepted here) - that's fine, since Back's own code is already
	// known/working. Use this tool to test the OTHER buttons.

	function showKeyTestModal() {
		var wrap = $('<div style="padding:1em;"></div>');
		var hint = $('<div style="opacity:0.6; margin-bottom:1em; font-size:1em;"></div>').text(
			'Жми кнопки на пульте по одной. Новые записи появляются сверху. "Назад" закроет это окно как обычно.'
		);
		var list = $('<div style="font-family:monospace; font-size:1.05em;"></div>');

		wrap.append(hint).append(list);

		function handler(e) {
			var line = $('<div style="padding:0.4em 0; border-bottom:1px solid rgba(255,255,255,0.15);"></div>').text(
				'key: "' + e.key + '"  code: "' + e.code + '"  keyCode: ' + e.keyCode + '  which: ' + e.which
			);

			list.prepend(line);

			// Keep the log from growing without bound during a long test session.
			list.children().slice(30).remove();
		}

		Lampa.Modal.open({
			title: 'Тест кодов пульта',
			html: wrap,
			size: 'large',
			onBack: function () {
				window.removeEventListener('keydown', handler);
				Lampa.Controller.toggle('content');
				Lampa.Modal.close();
			}
		});

		window.addEventListener('keydown', handler);
	}

	function startPlugin() {
		window.key_test_plugin = true;

		Lampa.Listener.follow('full', function (e) {
			if (e.type !== 'options') return;

			try {
				e.options.push({
					title: 'Тест кодов пульта',
					onSelect: function () {
						Lampa.Controller.toggle('content');
						showKeyTestModal();
					}
				});
			} catch (err) {
				// Fail silently, never break the "more" menu.
			}
		});
	}

	if (!window.key_test_plugin) startPlugin();
})();
