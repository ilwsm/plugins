(function () {
    'use strict';

    var MAX_LENGTH = 3000;
    var KP_PROX = 'https://kp-relay-ext.ua-andrey.workers.dev/'; // Воркер для обхода блокировок (если нужен)
    var KP_API_KEY = '4dc5011a-c3d5-4345-9861-d1c38222f747'; // Используется только для поиска ID фильма

    function cleanTitle(str) {
        return str.replace(/[\s.,:;''`!?]+/g, ' ').trim();
    }

    function kpCleanTitle(str) {
        return cleanTitle(str).replace(/^[ \/\\]+/, '').replace(/[ \/\\]+$/, '').replace(/\+( *[+\/\\])+/g, '+').replace(/([+\/\\] *)+\+/g, '+').replace(/( *[\/\\]+ *)+/g, '+');
    }

    function normalizeTitle(str) {
        return cleanTitle(str.toLowerCase().replace(/[\-\u2010-\u2015\u2E3A\u2E3B\uFE58\uFE63\uFF0D]+/g, '-').replace(/ё/g, 'е'));
    }

    function containsTitle(str, title) {
        return typeof str === 'string' && typeof title === 'string' && normalizeTitle(str).indexOf(normalizeTitle(title)) !== -1;
    }

    // Resolves a Kinopoisk film id
    function findKpId(movie, onFound, onFail) {
        var network = new Lampa.Reguest();
        var title = movie.title || movie.name || '';
        var clean_title = kpCleanTitle(title);
        var search_date = movie.release_date || movie.first_air_date || movie.last_air_date || '0000';
        var search_year = parseInt((search_date + '').slice(0, 4));
        var orig = movie.original_title || movie.original_name;
        var headers = {
            'X-API-KEY': KP_API_KEY
        };

        var url_by_title = Lampa.Utils.addUrlComponent(KP_PROX + 'https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword', 'keyword=' + encodeURIComponent(clean_title));
        var url = movie.imdb_id ? Lampa.Utils.addUrlComponent(KP_PROX + 'https://kinopoiskapiunofficial.tech/api/v2.2/films', 'imdbId=' + encodeURIComponent(movie.imdb_id)) : url_by_title;

        network.timeout(15000);
        network.silent(url, function (json) {
            handleResult(json, url);
        }, function (jqXHR) {
            onFail(describeApiError(network, jqXHR));
        }, false, {
            headers: headers
        });

        function handleResult(json, used_url) {
            var items = (json.items && json.items.length) ? json.items : ((json.films && json.films.length) ? json.films : null);

            if (items)
                return chooseFilm(items);

            if (used_url !== url_by_title) {
                network.timeout(15000);
                network.silent(url_by_title, function (json2) {
                    var items2 = (json2.items && json2.items.length) ? json2.items : ((json2.films && json2.films.length) ? json2.films : []);
                    chooseFilm(items2);
                }, function (jqXHR) {
                    onFail(describeApiError(network, jqXHR));
                }, false, {
                    headers: headers
                });
            } else {
                chooseFilm([]);
            }
        }

        function chooseFilm(items) {
            if (!items.length) return onFail();

            items.forEach(function (c) {
                var year = c.start_date || c.year || '0000';
                c.tmp_year = parseInt((year + '').slice(0, 4));
            });

            var is_sure = false;
            var cards = items;

            if (movie.imdb_id) {
                var tmp = items.filter(function (elem) { return (elem.imdb_id || elem.imdbId) == movie.imdb_id; });
                if (tmp.length) { cards = tmp; is_sure = true; }
            }

            if (orig && !is_sure) {
                var t1 = cards.filter(function (elem) {
                    return containsTitle(elem.orig_title || elem.nameOriginal, orig) || containsTitle(elem.en_title || elem.nameEn, orig) || containsTitle(elem.title || elem.ru_title || elem.nameRu, orig);
                });
                if (t1.length) { cards = t1; is_sure = true; }
            }

            if (title && !is_sure) {
                var t2 = cards.filter(function (elem) {
                    return containsTitle(elem.title || elem.ru_title || elem.nameRu, title) || containsTitle(elem.en_title || elem.nameEn, title) || containsTitle(elem.orig_title || elem.nameOriginal, title);
                });
                if (t2.length) { cards = t2; is_sure = true; }
            }

            if (cards.length > 1 && search_year) {
                var t3 = cards.filter(function (c) { return c.tmp_year == search_year; });
                if (!t3.length) {
                    t3 = cards.filter(function (c) { return c.tmp_year && c.tmp_year > search_year - 2 && c.tmp_year < search_year + 2; });
                }
                if (t3.length) cards = t3;
            }

            if (!(cards.length === 1 && is_sure)) return onFail();

            var id = cards[0].kp_id || cards[0].kinopoisk_id || cards[0].kinopoiskId || cards[0].filmId;
            if (!id) return onFail();

            onFound(id);
        }
    }

    function safeFormat(text) {
        var escaped = $('<div>').text(text).html();
        return escaped.replace(/&lt;(\/?)(b|i|em|strong|br)&gt;/gi, '<$1$2>');
    }

    function buildReviewsHtml(reviews) {
        var wrap = $('<div style="padding: 1em;"></div>');

        reviews.forEach(function (review, i) {
            if (i > 0) {
                wrap.append('<hr style="border:none; border-top:1px solid rgba(255,255,255,0.2); margin:1.3em 0;">');
            }

            var author = review.author || 'Аноним';
            var title = (review.title || '').trim();
            var text = (review.description || '').trim();
            var type = review.type;

            var typeText = type === 'POSITIVE' ? 'положительная' : type === 'NEGATIVE' ? 'отрицательная' : type === 'NEUTRAL' ? 'нейтральная' : '';
            var typeColor = type === 'POSITIVE' ? '#4CAF50' : type === 'NEGATIVE' ? '#F44336' : type === 'NEUTRAL' ? '#FFC107' : '';
            var typeEmoji = type === 'POSITIVE' ? ' \uD83D\uDC4D' : type === 'NEGATIVE' ? ' \uD83D\uDC4E' : '';

            var card = $('<div></div>');
            var head = $('<div style="font-weight:bold; font-size:1.25em; margin-bottom:0.2em;"></div>').text(title || author);
            var sub = $('<div style="font-size:1.1em; margin-bottom:0.5em;' + (typeColor ? ' color:' + typeColor + ';' : '') + '"></div>').text(author + (typeText ? ' - ' + typeText : '') + typeEmoji);
            var body = $('<div style="white-space:pre-line; opacity:0.85; font-size:1.15em; line-height:1.5;"></div>').html(safeFormat(text));

            card.append(head).append(sub).append(body);
            wrap.append(card);
        });

        return wrap;
    }

    function loading(text) {
        return $('<div style="padding:1em; text-align:center;"></div>').text(text);
    }

    function describeApiError(network, jqXHR) {
        var status = network.errorCode(jqXHR);
        var known = { 401: 'пустой или неправильный токен', 402: 'превышен лимит запросов', 429: 'слишком много запросов' };
        return 'Ошибка поиска фильма (' + status + '): ' + (known[status] || 'неизвестная ошибка');
    }

    // Вспомогательная функция с нормализацией пустых строк (убираем лишние дыры)
    function extractTextWithNewlines(node, doc) {
        if (!node) return '';
        var clone = node.cloneNode(true);
        var brs = clone.querySelectorAll('br');
        for (var i = 0; i < brs.length; i++) {
            brs[i].parentNode.replaceChild(doc.createTextNode('\n'), brs[i]);
        }
        var text = clone.textContent.trim();
        // Схлопываем 3 и более переноса строк подряд до максимум двух
        return text.replace(/\n\s*\n\s*\n+/g, '\n\n');
    }

    function showReviewsModal(movie) {
        var title = movie ? (movie.title || movie.name || '?') : '?';
        var currentPage = 1;
        var totalPages = 1;
        var kpId = null;

        function keyHandler(e) {
            if (!e) return;
            var k = e.key || e.keyIdentifier || e.keyCode;
            var keyName = typeof k === 'string' ? k : (k === 36 ? 'Home' : k === 35 ? 'End' : k === 33 ? 'PageUp' : k === 34 ? 'PageDown' : '');

            if (keyName === 'Home' || keyName === '0') {
                e.preventDefault && e.preventDefault();
                try {
                    if (Lampa.Modal.scroll && typeof Lampa.Modal.scroll().reset === 'function') {
                        Lampa.Modal.scroll().reset();
                    } else {
                        var $r = Lampa.Modal.render && Lampa.Modal.render();
                        $r && $r.find && $r.find('.modal__body, .modal__content').scrollTop(0);
                    }
                } catch (err) {}
                return;
            }

            if (keyName === 'End' || keyName === 'BrowserFavorites' || keyName === 'Info') {
                e.preventDefault(); e.stopPropagation();
                var scroll = Lampa.Modal.scroll();
                scroll.shift(scroll.vieport().body);
                return;
            }

            if (keyName === 'PageUp' || keyName === 'ChannelUp') {
                e.preventDefault && e.preventDefault();
                if (kpId && currentPage > 1) fetchPage(currentPage - 1);
                return;
            }

            if (keyName === 'PageDown' || keyName === 'ChannelDown') {
                e.preventDefault && e.preventDefault();
                if (kpId && currentPage < totalPages) fetchPage(currentPage + 1);
                return;
            }
        }

        function updateFooterButtonsVisibility() {
            var $render = Lampa.Modal.render && Lampa.Modal.render();
            if (!$render || !$render.length) return;
            var $footer = $render.find('.modal__footer');
            var $footerBtns = $footer.find('.modal__button');
            if (!$footer.length || !$footerBtns.length) return;

            $footerBtns.css({ padding: '0.4em 0.7em', 'font-size': '1em' });

            if (totalPages <= 1) {
                $footerBtns.toggleClass('hide', true);
                $footer.toggleClass('hide', true);
                return;
            }

            $footer.toggleClass('hide', false);
            var $prev = $footerBtns.first();
            var $next = $footerBtns.last();

            $prev.toggleClass('hide', currentPage <= 1);
            $next.toggleClass('hide', currentPage >= totalPages);

            if ($prev.hasClass('hide') && $next.hasClass('hide')) $footer.toggleClass('hide', true);
        }

        function fetchPage(page) {
            var network = new Lampa.Reguest();
            network.timeout(15000);

            var url = 'https://kinocat.org/kp_reviews?kp_id=' + kpId + '&page=' + page;

            Lampa.Modal.title('Рецензии (Кинопоиск) — стр. ' + page + ' (загрузка...)');

            network.silent(url, function (html) {
                currentPage = page;

                var doc = new DOMParser().parseFromString(html, "text/html");
                var reviewsList = [];

                var reviewElements = doc.querySelectorAll('div[itemtype="http://schema.org/Review"]');

                reviewElements.forEach(function(el) {
                    var authorEl = el.querySelector('div[itemprop="author"] a[itemprop="name"]') || el.querySelector('div[itemprop="author"] a');
                    var author = authorEl ? authorEl.textContent.trim() : 'Аноним';

                    var titleEl = el.querySelector('meta[itemprop="headline"]');
                    var revTitle = titleEl ? titleEl.getAttribute('content') : '';
                    if (!revTitle) {
                        var altTitleEl = el.querySelector('p[id^="ext_title_"]');
                        revTitle = altTitleEl ? altTitleEl.textContent.trim() : '';
                    }

                    var bodyEl = el.querySelector('span[itemprop="reviewBody"]');
                    var body = extractTextWithNewlines(bodyEl, doc);
                    if (!body) {
                        var altBodyEl = el.querySelector('p[id^="ext_text_"]');
                        body = extractTextWithNewlines(altBodyEl, doc);
                    }

                    var dateEl = el.querySelector('span.date');
                    var date = dateEl ? dateEl.textContent.trim() : '';

                    var type = 'NEUTRAL';
                    var wrapper = el.closest('.response') || el.parentElement;
                    if (wrapper) {
                        if (wrapper.classList.contains('good')) type = 'POSITIVE';
                        else if (wrapper.classList.contains('bad')) type = 'NEGATIVE';
                    }

                    reviewsList.push({
                        author: author + (date ? ' • ' + date : ''),
                        title: revTitle,
                        description: body,
                        type: type
                    });
                });

                // Расширенный поиск пагинации для современных страниц Кинопоиска
                var maxPage = currentPage;
                var pageLinks = doc.querySelectorAll('ul.list a[href*="/page/"]');

                for (var i = 0; i < pageLinks.length; i++) {
                    var href = pageLinks[i].getAttribute('href');
                    // Достаем число из паттерна вида /page/24/
                    var match = href.match(/\/page\/(\d+)\//);
                    if (match) {
                        var pNum = parseInt(match[1], 10);
                        if (!isNaN(pNum) && pNum > maxPage) {
                            maxPage = pNum;
                        }
                    }
                }

                totalPages = maxPage;

                Lampa.Modal.title('Рецензии (Кинопоиск) — стр. ' + currentPage + ' из ' + totalPages);

                if (reviewsList.length) {
                    Lampa.Modal.update(buildReviewsHtml(reviewsList));
                } else {
                    Lampa.Modal.update(loading('Рецензии на странице не найдены. Фильм: "' + title + '", KP id: ' + kpId));
                }

                try {
                    if (Lampa.Modal.scroll && typeof Lampa.Modal.scroll().reset === 'function') Lampa.Modal.scroll().reset();
                    else {
                        var $render = Lampa.Modal.render && Lampa.Modal.render();
                        $render && $render.find && $render.find('.modal__body, .modal__content').scrollTop(0);
                    }
                } catch (e) {}

                try { updateFooterButtonsVisibility(); } catch (e) {}

            }, function (jqXHR) {
                var status = network.errorCode(jqXHR);
                Lampa.Modal.update(loading('Ошибка загрузки страницы HTML (' + status + '). Проверьте прокси или доступность KP. Фильм id: ' + kpId));
            }, false, {
                dataType: 'text'
            });
        }

        Lampa.Modal.open({
            title: 'Рецензии (Кинопоиск)',
            html: loading('Загрузка...'),
            size: 'large',
            buttons: [{
                name: '\u25C0 Пред. страница',
                onSelect: function () { if (kpId && currentPage > 1) fetchPage(currentPage - 1); }
            }, {
                name: 'След. страница \u25B6',
                onSelect: function () { if (kpId && currentPage < totalPages) fetchPage(currentPage + 1); }
            }],
            buttons_position: 'outside',
            onBack: function () {
                try { window.removeEventListener && window.removeEventListener('keydown', keyHandler); } catch (e) {}
                Lampa.Controller.toggle('content');
                Lampa.Modal.close();
            }
        });

        try {
            var $renderOnce = Lampa.Modal.render && Lampa.Modal.render();
            if ($renderOnce && $renderOnce.length) {
                var $footerOnce = $renderOnce.find('.modal__footer');
                var $footerBtnsOnce = $footerOnce.find('.modal__button');
                if ($footerBtnsOnce && $footerBtnsOnce.length) {
                    $footerBtnsOnce.css({ padding: '0.4em 0.7em', 'font-size': '1em' });
                    $footerBtnsOnce.toggleClass('hide', true);
                    $footerOnce.toggleClass('hide', true);
                }
            }
        } catch (e) {}

        try { window.addEventListener && window.addEventListener('keydown', keyHandler); } catch (e) {}

        if (!movie) {
            Lampa.Modal.update(loading('Нет данных о фильме'));
            try { window.removeEventListener && window.removeEventListener('keydown', keyHandler); } catch (e) {}
            return;
        }

        findKpId(movie, function (foundId) {
            kpId = foundId;
            fetchPage(1);
        }, function (apiError) {
            Lampa.Modal.update(loading((apiError || 'Не удалось найти фильм на Кинопоиске') + '. Фильм: "' + title + '"'));
            try { window.removeEventListener && window.removeEventListener('keydown', keyHandler); } catch (e) {}
        });
    }

    function startPlugin() {
        window.kp_reviews_plugin = true;

        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'options') return;

            try {
                var movie = e.link && e.link.card ? e.link.card : null;

                e.options.push({
                    title: 'Рецензии 2 (КП)',
                    onSelect: function () {
                        Lampa.Controller.toggle('content');
                        showReviewsModal(movie);
                    }
                });
            } catch (err) {}
        });
    }

    if (!window.kp_reviews_plugin) startPlugin();
})();