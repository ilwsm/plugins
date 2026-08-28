(function () {
    'use strict';

    if (window.anistar_online_plugin) return;
    window.anistar_online_plugin = true;

    var BASE = 'https://v30.astar.bz';
    var SITE_PROXY = 'https://kp-relay.ua-andrey.workers.dev/';
    var DEBUG_KEY = 'anistar_debug_log';
    var DEBUG_ENABLED_KEY = 'anistar_logging';
    var DEBUG_LIMIT = 100;

    function debugEnabled() {
        var value = Lampa.Storage.get(DEBUG_ENABLED_KEY, true);
        return value !== false && value !== 'false';
    }

    function debugValue(value) {
        if (value == null) return String(value);
        if (typeof value === 'string') return value.replace(/\s+/g, ' ').slice(0, 500);
        try {
            return JSON.stringify(value).slice(0, 1000);
        } catch (e) {
            return String(value);
        }
    }

    function debugLog(event, data) {
        if (!debugEnabled()) return;
        var line = new Date().toISOString() + ' [' + event + ']' + (data == null ? '' : ' ' + debugValue(data));
        if (window.console && console.log) console.log('[AniStar] ' + line);
        try {
            var log = Lampa.Storage.get(DEBUG_KEY, []);
            if (!Array.isArray(log)) log = [];
            log.push(line);
            if (log.length > DEBUG_LIMIT) log = log.slice(-DEBUG_LIMIT);
            Lampa.Storage.set(DEBUG_KEY, log);
        } catch (e) {
        }
    }

    function showDebugLog() {
        var body = $('body');
        var settingsOpen = body.hasClass('settings--open');
        var log = [];
        try {
            log = Lampa.Storage.get(DEBUG_KEY, []);
        } catch (e) {
        }
        var value = Array.isArray(log) ? log.join('\n') : String(log || '');
        var html = $('<div style="padding:1em;"><textarea style="width:100%;height:24em;color:#fff;background:#222;border:1px solid #555;padding:.7em;font-size:.85em;"></textarea><div style="display:flex;margin-top:.7em;"><button class="selector anistar-log-copy" style="padding:.6em 1em;">Копировать лог</button><button class="selector anistar-log-clear" style="padding:.6em 1em;margin-left:.5em;">Очистить лог</button><button class="selector anistar-log-close" style="padding:.6em 1em;margin-left:auto;">Закрыть</button></div></div>');
        html.find('textarea').val(value);
        html.find('.anistar-log-copy').on('click', function () {
            if (Lampa.Utils && Lampa.Utils.copyTextToClipboard) Lampa.Utils.copyTextToClipboard(value, function () {
                Lampa.Noty.show('AniStar: лог скопирован');
            });
        });
        html.find('.anistar-log-clear').on('click', function () {
            Lampa.Storage.set(DEBUG_KEY, []);
            value = '';
            html.find('textarea').val('');
            Lampa.Noty.show('AniStar: лог очищен');
        });
        html.find('.anistar-log-close').on('click', function () {
            Lampa.Modal.close();
        });
        Lampa.Modal.open({
            title: 'AniStar log', html: html, size: 'large', onBack: function () {
                Lampa.Modal.close();
            }
        });
        if (settingsOpen) body.removeClass('settings--open');
    }

    debugLog('loaded', {base: BASE, href: window.location && window.location.href});

    function blocked(html) {
        return !html || /Just a moment|cf-chl-|cloudflare/i.test(html);
    }

    function transportUrl(url) {
        return SITE_PROXY + url;
    }

    function absolute(url, ref) {
        if (!url) return '';
        if (/^https?:\/\/(?:www\.)?anistar\.org(?=\/|$)/i.test(url)) {
            return url.replace(/^https?:\/\/(?:www\.)?anistar\.org/i, BASE);
        }
        if (/^https?:\/\//i.test(url)) return url;
        if (url.indexOf('//') === 0) return 'https:' + url;
        if (url.charAt(0) === '/') return BASE + url;
        return (ref || BASE + '/').replace(/\/[^/]*$/, '/') + url;
    }

    function decodeHtml(value) {
        var div = document.createElement('textarea');
        div.innerHTML = value || '';
        return div.value.replace(/<[^>]+>/g, '').trim();
    }

    function text(value) {
        return decodeHtml(value).replace(/\s+/g, ' ');
    }

    function responseText(data) {
        if (typeof data === 'string') return data;
        if (data && data instanceof ArrayBuffer) {
            try {
                return new TextDecoder('windows-1251').decode(data);
            } catch (e) {
                return '';
            }
        }
        return '';
    }

    function request(url, callback) {
        var req = new Lampa.Reguest();
        req.timeout(20000);
        debugLog('request:start', {method: 'GET', url: url, transport: transportUrl(url)});
        req.native(transportUrl(url), function (data) {
            var html = responseText(data);
            debugLog('request:success', {
                url: url,
                dataType: typeof data,
                bytes: html.length,
                start: html.slice(0, 160)
            });
            callback(blocked(html) ? '' : html);
        }, function (a, c) {
            debugLog('request:error', {url: url, error: a, extra: c});
            callback('');
        }, false, {dataType: 'text'});
        return req;
    }

    function encode1251(value) {
        var result = '';
        value = value || '';
        for (var i = 0; i < value.length; i++) {
            var code = value.charCodeAt(i);
            var byte = code;
            if (code >= 0x0410 && code <= 0x044f) byte = code - 0x350;
            else if (code === 0x0401) byte = 0xa8;
            else if (code === 0x0451) byte = 0xb8;
            else if (code > 0x7f) {
                result += encodeURIComponent(value.charAt(i));
                continue;
            }
            var char = String.fromCharCode(byte);
            result += /[A-Za-z0-9_.~-]/.test(char) ? char : '%' + ('0' + byte.toString(16)).slice(-2).toUpperCase();
        }
        return result;
    }

    function searchRequest(query, callback) {
        var body = 'do=search&subaction=search&search_start=1&full_search=1&result_from=1&titleonly=3&searchdate=0&beforeafter=after&sortby=date&resorder=asc&showposts=0&catlist%5B%5D=39&catlist%5B%5D=35&story=' + encode1251(query);
        var searchUrl = BASE + '/index.php?action_skin_change=1&skin_name=smartphone';
        var req = new Lampa.Reguest();
        req.timeout(20000);
        debugLog('search:start', {url: searchUrl, query: query, body: body});
        req.native(transportUrl(searchUrl), function (data) {
            var html = responseText(data);
            debugLog('search:success', {dataType: typeof data, bytes: html.length, start: html.slice(0, 160)});
            callback(blocked(html) ? '' : html);
        }, function (a, c) {
            debugLog('search:error', {error: a, extra: c});
            callback('');
        }, body, {
            dataType: 'text',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': BASE,
                'Referer': BASE + '/'
            }
        });

        return req;
    }

    function parseCards(html) {
        var cards = [];
        var blocks = html.split(/<div\s+class=["']plash["'][^>]*>/i).slice(1);

        blocks.forEach(function (block) {
            var title = block.match(/class=["']plash-title["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<span[^>]*class=["']title-top["'][^>]*>([\s\S]*?)<\/span>/i);
            var image = block.match(/class=["']poster["'][^>]*>[\s\S]*?<img[^>]*src=["']([^"']+)["']/i);
            if (!title) return;

            cards.push({
                title: text(title[2]),
                url: absolute(title[1]),
                poster: image ? absolute(image[1]) : '',
                year: '',
                rating: ''
            });
        });

        return cards;
    }

    function parseDetail(html, url) {
        var title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        var poster = html.match(/<img[^>]*itemprop=["']image["'][^>]*src=["']([^"']+)/i);
        var links = [];
        var seen = {};

        function addLink(link, label) {
            link = absolute(link, url);
            if (!link || seen[link] || /javascript:|\.jpg|\.png|\.gif|\.css|\.js/i.test(link)) return;
            if (!/\.m3u8(?:\?|$)|\.mp4(?:\?|$)|\/test\/player|player|video|watch|online|episode|serial/i.test(link)) return;
            seen[link] = true;
            links.push({url: link, title: text(label) || ('Эпизод ' + (links.length + 1))});
        }

        var iframe = html.match(/<iframe[^>]*src=["']([^"']+)["']/gi) || [];
        iframe.forEach(function (tag) {
            var src = tag.match(/src=["']([^"']+)["']/i);
            if (src) addLink(src[1], 'Смотреть онлайн');
        });

        var anchors = html.match(/<a[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) || [];
        anchors.forEach(function (tag) {
            var href = tag.match(/href=["']([^"']+)["']/i);
            var label = tag.match(/>([\s\S]*?)<\/a>/i);
            if (href) addLink(href[1], label && label[1]);
        });

        (html.match(/(?:https?:)?\/\/[^"'\s<>]+|\/test\/player2\/[^"'\s<>]+/gi) || []).forEach(function (link) {
            addLink(link, 'Смотреть онлайн');
        });

        var p2pLinks = links.filter(function (item) {
            return /\/test\/player2\/videoas_p2p_new\.php/i.test(item.url);
        });
        if (p2pLinks.length) links = p2pLinks;

        return {
            title: title ? text(title[1]) : '',
            poster: poster ? absolute(poster[1], url) : '',
            links: links
        };
    }

    function parsePlayer(html, ref) {
        var streams = [];
        var seen = {};

        function add(url, title, quality, useRelay) {
            url = absolute((url || '').replace(/\\\//g, '/'), ref);
            if (!url || seen[url] || !/\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(url)) return;
            if (/sfv\.an-media\.org/i.test(url) && !/\.m3u8(?:\?|$)/i.test(url)) url += (url.indexOf('?') === -1 ? '?' : '&') + 'anistar.m3u8';
            if (useRelay) url = transportUrl(url);
            seen[url] = true;
            streams.push({url: url, title: text(title) || ('Эпизод ' + (streams.length + 1)), quality: quality ? quality + 'p' : '720p'});
        }

        var playlist = extractArray(html, /(?:var\s+)?playlst\s*=\s*/i);
        if (playlist) {
            splitObjects(playlist).forEach(function (episode) {
                var title = valueOf(episode, 'title');
                var files = filesOf(episode, 'files');
                var mp4 = filesOf(episode, 'files_mp4');
                // sfv returns an HLS playlist from a URL ending in .mp4 and does not
                // require the Referer header in a browser, unlike sf2.
                var playable = files.filter(function (file) {
                    return /sfv\.an-media\.org/i.test(file.url);
                });
                playable.sort(function (a, b) {
                    return b.quality - a.quality;
                });
                if (playable[0]) {
                    add(playable[0].url, title || playable[0].title, playable[0].quality, false);
                    return;
                }

                // Older sf2/sfhd files require an AniStar Referer. Browser
                // playback cannot set it, so use the relay only for that MP4.
                mp4.sort(function (a, b) {
                    return b.quality - a.quality;
                });
                if (mp4[0]) {
                    add(mp4[0].url, title || mp4[0].title, mp4[0].quality, true);
                    return;
                }

                playable = files.filter(function (file) {
                    return /\.m3u8(?:\?|$)/i.test(file.url);
                });
                playable.sort(function (a, b) {
                    return b.quality - a.quality;
                });
                if (playable[0]) add(playable[0].url, title || playable[0].title, playable[0].quality, false);
            });
        }

        if (!streams.length) {
            (html.match(/(?:https?:)?\\?\/\\?\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/gi) || []).forEach(function (url) {
                add(url, 'Смотреть онлайн');
            });
        }
        return streams;
    }

    function splitObjects(array) {
        var result = [];
        var depth = 0;
        var start = -1;
        var quote = '';
        var escaped = false;

        for (var i = 1; i < array.length - 1; i++) {
            var char = array.charAt(i);
            if (quote) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === quote) quote = '';
            } else if (char === '"' || char === "'") quote = char;
            else if (char === '{') {
                if (depth === 0) start = i;
                depth++;
            } else if (char === '}' && --depth === 0 && start !== -1) {
                result.push(array.substring(start, i + 1));
                start = -1;
            }
        }

        return result;
    }

    function valueOf(object, key) {
        var found = object.match(new RegExp('(?:^|[{,\\s])' + key + '\\s*:\\s*(["\'])([\\s\\S]*?)\\1', 'i'));
        return found ? found[2] : '';
    }

    function filesOf(object, key) {
        var array = extractArray(object, new RegExp('(?:^|[{,\\s])' + key + '\\s*:\\s*', 'i'));
        if (!array) return [];
        return splitObjects(array).map(function (file) {
            var title = valueOf(file, 'title');
            var url = valueOf(file, 'file').replace(/\\\//g, '/');
            return {
                title: title,
                quality: parseInt(title, 10) || 0,
                url: url
            };
        }).filter(function (file) {
            return file.url;
        });
    }

    function extractArray(source, assignment) {
        var match = assignment.exec(source || '');
        if (!match) return '';

        var start = source.indexOf('[', match.index + match[0].length);
        if (start === -1) return '';

        var depth = 0;
        var quote = '';
        var escaped = false;
        for (var i = start; i < source.length; i++) {
            var char = source.charAt(i);
            if (quote) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === quote) quote = '';
            } else if (char === '"' || char === "'") quote = char;
            else if (char === '[') depth++;
            else if (char === ']' && --depth === 0) return source.substring(start, i + 1);
        }

        return '';
    }

    function resolveStreams(links, callback, index, load) {
        index = index || 0;
        load = load || request;
        if (index >= links.length) return callback([]);
        if (/\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(links[index].url)) return callback([links[index]]);

        load(links[index].url, function (html) {
            var streams = parsePlayer(html, links[index].url);
            if (streams.length) callback(streams);
            else resolveStreams(links, callback, index + 1, load);
        });
    }

    function source(component, object) {
        var selectTitle = object.search || object.movie && object.movie.title || '';
        var requests = [];
        var destroyed = false;

        function load(url, callback) {
            var req = request(url, function (html) {
                if (!destroyed) callback(html);
            });
            requests.push(req);
            return req;
        }

        this.search = function (activityObject) {
            object = activityObject || object;
            selectTitle = object.search || object.movie && object.movie.title || selectTitle;
            var movie = object.movie || {};
            var shikimori = movie.shikimori || {};
            var query = shikimori.russian || selectTitle || movie.title || movie.name || '';
            debugLog('search:query', query);
            component.loading(true);
            var req = searchRequest(query, function (html) {
                if (destroyed) return;
                var items = html ? parseCards(html) : [];
                debugLog('search:parsed', {query: query, htmlBytes: html.length, cards: items.length});
                if (!items.length) return component.emptyForQuery(query);
                showResults(items);
            });
            requests.push(req);

            function showResults(items) {
                component.loading(false);
                component.reset();
                items.forEach(appendItem);
                component.start(true);
            }
        };

        function appendItem(item) {
            var view = Lampa.Template.get('anistar_online', item);
            view.find('.online__title').text(item.title);
            view.find('.online__quality').text('AniStar' + (item.year ? ' / ' + item.year : ''));
            view.on('hover:enter', function () {
                loadCard(item);
            });
            component.append(view);
        }

        function loadCard(item) {
            component.loading(true);
            load(item.url, function (html) {
                var detail = parseDetail(html, item.url);
                debugLog('detail:parsed', {url: item.url, htmlBytes: html.length, links: detail.links.length});
                if (!detail.links.length) {
                    component.loading(false);
                    return Lampa.Noty.show('AniStar: видео не найдено');
                }
                resolveStreams(detail.links, function (streams) {
                    if (destroyed) return;
                    debugLog('player:resolved', {links: detail.links.length, streams: streams.length});
                    component.loading(false);
                    if (!streams.length) return Lampa.Noty.show('AniStar: поток видео не найден');
                    showEpisodes(streams, detail.title || item.title);
                }, 0, load);
            });
        }

        function showEpisodes(streams, title) {
            component.reset();
            var viewed = Lampa.Storage.cache('online_view', 5000, []);
            var playlist = streams.map(function (stream, index) {
                var hash = Lampa.Utils.hash([object.movie.original_title || object.movie.title, index + 1].join(''));
                stream.timeline = Lampa.Timeline.view(hash);
                return {title: stream.title, url: stream.url, subtitles: [], timeline: stream.timeline};
            });

            streams.forEach(function (stream, index) {
                var hashFile = Lampa.Utils.hash([object.movie.original_title || object.movie.title, stream.title].join(''));
                var item = Lampa.Template.get('anistar_online', {
                    title: stream.title,
                    quality: stream.quality || 'HLS',
                    info: ' / AniStar'
                });
                item.append(Lampa.Timeline.render(stream.timeline));
                if (viewed.indexOf(hashFile) !== -1) item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                item.on('hover:enter', function () {
                    if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
                    var first = playlist[index];
                    first.title = streams.length > 1 ? stream.title : title;
                    Lampa.Player.play(first);
                    Lampa.Player.playlist(playlist);
                    if (viewed.indexOf(hashFile) === -1) {
                        viewed.push(hashFile);
                        Lampa.Storage.set('online_view', viewed);
                        item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                    }
                });
                component.append(item);
            });
            component.start(true);
        }

        this.destroy = function () {
            destroyed = true;
            requests.forEach(function (req) {
                if (req && req.clear) req.clear();
            });
            requests = [];
        };
        this.reset = function () {
        };
        this.filter = function () {
        };
        this.extendChoice = function () {
        };
    }

    function onlineComponent(object) {
        var component = this;
        var scroll = new Lampa.Scroll({mask: true, over: true});
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var active = new source(component, object);
        var last;

        scroll.body().addClass('torrent-list');
        scroll.minus(files.render().find('.explorer__files-head'));

        this.create = function () {
            var self = this;
            component.activity.loader(true);
            filter.onSearch = function (value) {
                Lampa.Activity.replace({search: value, search_date: '', clarification: true});
            };
            filter.onBack = function () {
                self.start();
            };
            files.appendHead(filter.render());
            files.appendFiles(scroll.render());
            active.search(object);
            return this.render();
        };
        this.render = function () {
            return files.render();
        };
        this.start = function (firstSelect) {
            if (!Lampa.Activity.active() || Lampa.Activity.active().activity !== this.activity) return;
            if (firstSelect) {
                var lastViewed = scroll.render().find('.selector.online').find('.torrent-item__viewed').parent().last();
                if (object.movie.number_of_seasons && lastViewed.length) last = lastViewed.eq(0)[0];
                else last = scroll.render().find('.selector').eq(0)[0];
            }
            if (Lampa.Background && Lampa.Utils && Lampa.Utils.cardImgBackground && object.movie) Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie));
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head');
                },
                down: function () {
                    Navigator.move('down');
                },
                right: function () {
                    if (Navigator.canmove('right')) Navigator.move('right'); else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu');
                },
                back: this.back
            });
            if (this.inActivity()) Lampa.Controller.toggle('content');
        };
        this.loading = function (state) {
            if (state) component.activity.loader(true); else {
                component.activity.loader(false);
                if (Lampa.Activity.active().activity === this.activity && this.inActivity()) this.activity.toggle();
            }
        };
        this.append = function (item) {
            item.on('hover:focus nav_focus', function (event) {
                last = event.target;
                scroll.update($(event.target), true);
            });
            scroll.append(item);
        };
        this.reset = function () {
            last = filter.render().find('.selector').eq(0)[0];
            scroll.render().find('.empty').remove();
            scroll.clear();
            scroll.reset();
        };
        this.empty = function (message) {
            var empty = Lampa.Template.get('list_empty');
            if (message) empty.find('.empty__descr').text(message);
            scroll.append(empty);
            this.loading(false);
        };
        this.emptyForQuery = function (query) {
            this.empty('AniStar: ничего не найдено по запросу ' + query);
        };
        this.inActivity = function () {
            var body = $('body');
            return !(body.hasClass('settings--open') || body.hasClass('menu--open') || body.hasClass('keyboard-input--visible') || body.hasClass('selectbox--open') || body.hasClass('search--open') || body.hasClass('ambience--enable') || $('div.modal').length);
        };
        this.back = function () {
            Lampa.Activity.backward();
        };
        this.pause = function () {
        };
        this.stop = function () {
        };
        this.destroy = function () {
            active.destroy();
            filter.destroy();
            files.destroy();
            scroll.destroy();
        };
    }

    function openOnline(movie) {
        Lampa.Activity.push({
            url: '',
            title: 'AniStar Онлайн',
            component: 'anistar',
            search: movie.title,
            search_one: movie.title,
            search_two: movie.original_title || movie.title,
            movie: movie,
            page: 1
        });
    }

    Lampa.Component.add('anistar', onlineComponent);

    if (Lampa.Manifest) Lampa.Manifest.plugins = {
        type: 'video',
        version: '1.0.0',
        name: 'AniStar',
        description: 'AniStar online source',
        component: 'anistar',
        onContextMenu: function () {
            return {name: 'AniStar', description: 'Смотреть онлайн'};
        },
        onContextLauch: function (movie) {
            openOnline(movie);
        }
    };

  function addFullButton(event) {
        if (!event || event.type !== 'complite' || !event.data || !event.data.movie) return;
        var page = event.object && event.object.activity && event.object.activity.render();
        if (!page || page.find('.anistar-online-button').length) return;
    var button = $('<div class="full-start__button selector anistar-online-button" title="Смотреть на AniStar">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 244 260" aria-hidden="true"><path d="M242 88v170H10V88h41l-38 38h37.1l38-38h38.4l-38 38h38.4l38-38h38.3l-38 38H204l38-38ZM228.9 2l8 37.7L191.2 10l37.7-8ZM160.6 56l-45.8-29.7 38-8.1 45.8 29.7-38 8.1ZM84.5 72.1 38.8 42.4l38-8.1 45.8 29.7-38 8.1ZM10 88 2 50.2 47.8 80 10 88Z" fill="currentColor"/></svg>' +
      '<span>AniStar</span></div>');
        button.on('hover:enter', function () {
            openOnline(event.data.movie);
        });
        var watch = page.find('.view--torrent').first();
        if (watch.length) watch.after(button); else {
            var buttons = page.find('.full-start__buttons, .full-start-new__buttons, .full-start__buttons-line').first();
            if (buttons.length) buttons.append(button); else page.find('.full-start__body, .full-start-new__body').first().append(button);
        }
    }

  if (Lampa.Template && Lampa.Template.add) Lampa.Template.add('anistar_online', '<div class="online selector"><div class="online__body"><div style="position:absolute;left:0;top:-0.3em;width:2.4em;height:2.4em"><svg style="height:2.4em;width:2.4em" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="64" cy="64" r="56" stroke="white" stroke-width="16"/><path d="M90.5 64.3827 50 87.7654V41l40.5 23.3827Z" fill="white"/></svg></div><div class="online__title" style="padding-left:2.1em">{title}</div><div class="online__quality" style="padding-left:3.4em">{quality}{info}</div></div></div>');

  var styleTarget = $('body');
  if (!$('#anistar-online-style').length && styleTarget && styleTarget.append) styleTarget.append('<style id="anistar-online-style">.anistar-online-button{display:inline-flex!important;align-items:center!important}.anistar-online-button svg{display:block;flex:0 0 auto}</style>');

    function addSettings() {
        if (!Lampa.Settings.main || !Lampa.Settings.main() || Lampa.Settings.main().render().find('[data-component="anistar"]').length) return;
        var field = $('<div class="settings-folder selector" data-component="anistar"><div class="settings-folder__icon"><svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="27" stroke="white" stroke-width="5"/><path d="M27 20v24l20-12-20-12Z" fill="white"/></svg></div><div class="settings-folder__name">AniStar</div></div>');
        Lampa.Settings.main().render().find('[data-component="more"]').after(field);
        Lampa.Settings.main().update();
    }

    function initSettings() {
        Lampa.Params.trigger(DEBUG_ENABLED_KEY, true);
        Lampa.Template.add('settings_anistar', '<div><div class="settings-param selector" data-name="anistar_logging" data-type="toggle"><div class="settings-param__name">Вести лог</div><div class="settings-param__value"></div></div><div class="settings-param selector" data-name="anistar_log" data-static="true"><div class="settings-param__name">AniStar log</div><div class="settings-param__descr">Просмотреть, скопировать или очистить журнал</div></div></div>');

        Lampa.Settings.listener.follow('open', function (event) {
            if (event.name !== 'anistar') return;
            var logButton = event.body.find('[data-name="anistar_log"]');
            logButton.toggle(debugEnabled());
            logButton.unbind('hover:enter').on('hover:enter', showDebugLog);
        });

        Lampa.Storage.listener.follow('change', function (event) {
            if (event.name === DEBUG_ENABLED_KEY) {
                $('[data-name="anistar_log"]').toggle(debugEnabled());
            }
        });

        if (window.appready) addSettings(); else Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') addSettings();
        });
    }

  function init() {
    if (Lampa.Listener && Lampa.Listener.follow) Lampa.Listener.follow('full', addFullButton);
    initSettings();
  }

    init();

    function removeLegacyMenuButton() {
        $('.menu .menu__item').filter(function () {
            return $(this).find('.menu__text').text().trim() === 'AniStar';
        }).remove();
    }

    removeLegacyMenuButton();
    if (Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') removeLegacyMenuButton();
        });
    }

    console.log('AniStar online source loaded');
})();
