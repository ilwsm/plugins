(function () {
    'use strict';

    // Do not load the plugin twice
    if (window.plugin_no_panel_on_pause) return;
    window.plugin_no_panel_on_pause = true;

    // How long after a pause/play command the resulting 'play'/'pause' event
    // is still treated as caused by that command (ms)
    var WINDOW_MS = 1500;

    var suppress_until = 0;

    function init() {
        var Video = Lampa.PlayerVideo;
        var Panel = Lampa.PlayerPanel;

        // Remember a user pause/play command, but only when the panel is hidden.
        // If the panel is already open (user pressed its play button), leave it alone.
        function mark() {
            if (!Panel.visibleStatus()) suppress_until = Date.now() + WINDOW_MS;
        }

        // Toggle (OK / play-pause key): always a user command
        var original_playpause = Video.playpause;

        Video.playpause = function () {
            mark();
            return original_playpause.apply(this, arguments);
        };

        // Dedicated play / pause keys: only when the player controller is active,
        // so internal calls (e.g. end of buffering) are not affected
        ['play', 'pause'].forEach(function (name) {
            var original = Video[name];

            Video[name] = function () {
                var active = Lampa.Controller.enabled();

                if (active && active.name === 'player') mark();

                return original.apply(this, arguments);
            };
        });

        // Lampa's own handler shows the panel first (it is registered earlier),
        // then this one hides it again in the same tick, so nothing is painted
        Video.listener.follow('play,pause', function () {
            if (Date.now() < suppress_until) {
                suppress_until = 0;

                Panel.hide();
            }
        });
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') init();
        });
    }
})();
