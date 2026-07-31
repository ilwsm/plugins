(function () {
	'use strict';

	// Adds a "Рецензии (КП)" item to the movie/show card's "..." menu.
	// Reviews are fetched from Kinopoisk (via the same Cloudflare Worker
	// relay and API key already used by the ratings plugin) only when
	// the user opens this menu item, not on every card view.
	//
	// Lampa cards are normally sourced from TMDB, not Kinopoisk directly,
	// so this reuses the same movie-matching logic as the ratings plugin
	// (search by IMDb id, fall back to title+year matching) to resolve a
	// Kinopoisk film id before requesting its reviews.

	var MAX_LENGTH = 3000;
	var KP_PROX = 'https://kp-relay.ua-andrey.workers.dev/'; // Same relay used by the ratings plugin
	var KP_API_KEY = '4dc5011a-c3d5-4345-9861-d1c38222f747'; // Your own kinopoiskapiunofficial.tech key

	function cleanTitle(str) {
		return str.replace(/[\s.,:;’'`!?]+/g, ' ').trim();
	}

	function kpCleanTitle(str) {
		return cleanTitle(str).replace(/^[ \/\\]+/, '').replace(/[ \/\\]+$/, '').replace(/\+( *[+\/\\])+/g, '+').replace(/([+\/\\] *)+\+/g, '+').replace(/( *[\/\\]+ *)+/g, '+');
	}

	function normalizeTitle(str) {
		return cleanTitle(str.toLowerCase().replace(/[\-\u2010-\u2015\u2E3A\u2E3B\uFE58\uFE63\uFF0D]+/g, '-').replace(/ё/g, 'е'));
	}

	function equalTitle(t1, t2) {
		return typeof t1 === 'string' && typeof t2 === 'string' && normalizeTitle(t1) === normalizeTitle(t2);
	}

	function containsTitle(str, title) {
		return typeof str === 'string' && typeof title === 'string' && normalizeTitle(str).indexOf(normalizeTitle(title)) !== -1;
	}

	// Resolves a Kinopoisk film id from a (usually TMDB-sourced) Lampa
	// movie object, reusing the matching heuristics from the ratings plugin.
	function findKpId(movie, onFound, onFail) {
		var network = new Lampa.Reguest();
		var title = movie.title || movie.name || '';
		var clean_title = kpCleanTitle(title);
		var search_date = movie.release_date || movie.first_air_date || movie.last_air_date || '0000';
		var search_year = parseInt((search_date + '').slice(0, 4));
		var orig = movie.original_title || movie.original_name;
		var headers = { 'X-API-KEY': KP_API_KEY };

		var url_by_title = Lampa.Utils.addUrlComponent(KP_PROX + 'https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword', 'keyword=' + encodeURIComponent(clean_title));
		var url = movie.imdb_id ? Lampa.Utils.addUrlComponent(KP_PROX + 'https://kinopoiskapiunofficial.tech/api/v2.2/films', 'imdbId=' + encodeURIComponent(movie.imdb_id)) : url_by_title;

		network.timeout(15000);
		network.silent(url, function (json) {
			handleResult(json, url);
		}, function (jqXHR) {
			onFail(describeApiError(network, jqXHR));
		}, false, { headers: headers });

		function handleResult(json, used_url) {
			var items = (json.items && json.items.length) ? json.items : ((json.films && json.films.length) ? json.films : null);

			if (items) return chooseFilm(items);

			if (used_url !== url_by_title) {
				network.timeout(15000);
				network.silent(url_by_title, function (json2) {
					var items2 = (json2.items && json2.items.length) ? json2.items : ((json2.films && json2.films.length) ? json2.films : []);
					chooseFilm(items2);
				}, function (jqXHR) {
					onFail(describeApiError(network, jqXHR));
				}, false, { headers: headers });
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
				var tmp = items.filter(function (elem) {
					return (elem.imdb_id || elem.imdbId) == movie.imdb_id;
				});
				if (tmp.length) {
					cards = tmp;
					is_sure = true;
				}
			}

			if (orig) {
				var t1 = cards.filter(function (elem) {
					return containsTitle(elem.orig_title || elem.nameOriginal, orig) || containsTitle(elem.en_title || elem.nameEn, orig) || containsTitle(elem.title || elem.ru_title || elem.nameRu, orig);
				});
				if (t1.length) {
					cards = t1;
					is_sure = true;
				}
			}

			if (title) {
				var t2 = cards.filter(function (elem) {
					return containsTitle(elem.title || elem.ru_title || elem.nameRu, title) || containsTitle(elem.en_title || elem.nameEn, title) || containsTitle(elem.orig_title || elem.nameOriginal, title);
				});
				if (t2.length) {
					cards = t2;
					is_sure = true;
				}
			}

			if (cards.length > 1 && search_year) {
				var t3 = cards.filter(function (c) {
					return c.tmp_year == search_year;
				});
				if (!t3.length) {
					t3 = cards.filter(function (c) {
						return c.tmp_year && c.tmp_year > search_year - 2 && c.tmp_year < search_year + 2;
					});
				}
				if (t3.length) cards = t3;
			}

			if (!(cards.length === 1 && is_sure)) return onFail();

			var id = cards[0].kp_id || cards[0].kinopoisk_id || cards[0].kinopoiskId || cards[0].filmId;

			if (!id) return onFail();

			onFound(id, headers);
		}
	}

	function buildReviewsHtml(reviews) {
		var wrap = $('<div style="padding: 1em;"></div>');

		reviews.forEach(function (review, i) {
			if (i > 0) {
				wrap.append('<hr style="border:none; border-top:1px solid rgba(255,255,255,0.2); margin:1.3em 0;">');
			}

			var author = review.author || 'Anonymous';
			var title = (review.title || '').trim();
			var text = (review.description || '').trim();
			var type = review.type; // POSITIVE / NEGATIVE / NEUTRAL

			//if (text.length > MAX_LENGTH) text = text.slice(0, MAX_LENGTH) + '…';

			var typeLabel = type === 'POSITIVE' ? ' — положительная' : type === 'NEGATIVE' ? ' — отрицательная' : type === 'NEUTRAL' ? ' — нейтральная' : '';

			var card = $('<div></div>');

			// Using .text() (not .html()) for untrusted external content to avoid injection.
			var head = $('<div style="font-weight:bold; font-size:1.25em; margin-bottom:0.2em;"></div>').text(title || author);
			var sub = $('<div style="opacity:0.6; font-size:1em; margin-bottom:0.5em;"></div>').text(author + typeLabel);			
			var body = $('<div style="white-space:pre-line; opacity:0.85; font-size:1.15em; line-height:1.5;"></div>').html(safeFormat(text));

			card.append(head).append(sub).append(body);
			wrap.append(card);
		});

		return wrap;
	}

	// Escapes all HTML, then re-enables a small whitelist of safe formatting
	// tags only (no attributes allowed), so things like <i>...</i> render
	// properly without allowing arbitrary/unsafe HTML through.
	function safeFormat(text) {
		var escaped = $('<div>').text(text).html();
		return escaped.replace(/&lt;(\/?)(b|i|em|strong|br)&gt;/gi, '<$1$2>');
	}

	function loading(text) {
		return $('<div style="padding:1em; text-align:center;"></div>').text(text);
	}

	// Decodes kinopoiskapiunofficial.tech error responses using the
	// codes documented at kinopoiskapiunofficial.tech/documentation/api
	function describeApiError(network, jqXHR) {
		var status = network.errorCode(jqXHR);
		var json = network.errorJSON(jqXHR);
		var apiMessage = (json && (json.message || json.text)) || '';

		var known = {
			401: 'пустой или неправильный токен',
			402: 'превышен лимит запросов (дневной или общий)',
			429: 'слишком много запросов, общий лимит 20 запросов в секунду'
		};

		var explanation = known[status] || 'неизвестная ошибка';

		return 'Ошибка API Кинопоиска (' + status + '): ' + explanation + (apiMessage ? '. Ответ сервера: "' + apiMessage + '"' : '');
	}

	function showReviewsModal(movie) {
		Lampa.Modal.open({
			title: 'Рецензии (Кинопоиск)',
			html: loading('Загрузка...'),
			size: 'large',
			onBack: function () {
				Lampa.Controller.toggle('content');
				Lampa.Modal.close();
			}
		});

		if (!movie) {
			Lampa.Modal.update(loading('Нет данных о фильме'));
			return;
		}

		var title = movie.title || movie.name || '?';

		findKpId(movie, function (kpId, headers) {
			var network = new Lampa.Reguest();
			network.timeout(15000);
			network.silent(KP_PROX + 'https://kinopoiskapiunofficial.tech/api/v2.2/films/' + kpId + '/reviews', function (data) {
				if (data && data.items && data.items.length) {
					// Prefer longer, more substantial reviews first.
					var sorted = data.items.slice().sort(function (a, b) {
						return (b.description || '').length - (a.description || '').length;
					});

					Lampa.Modal.update(buildReviewsHtml(sorted));
				} else {
					Lampa.Modal.update(loading('Рецензии не найдены. Фильм: "' + title + '", KP id: ' + kpId));
				}
			}, function (jqXHR) {
				Lampa.Modal.update(loading(describeApiError(network, jqXHR) + '. Фильм: "' + title + '", KP id: ' + kpId));
			}, false, { headers: headers });
		}, function (apiError) {
			Lampa.Modal.update(loading((apiError || 'Не удалось найти фильм на Кинопоиске') + '. Фильм: "' + title + '"'));
		});
	}

	function startPlugin() {
		window.kp_reviews_plugin = true;

		Lampa.Listener.follow('full', function (e) {
			if (e.type !== 'options') return;

			try {
				// Note: the event passes `props: this.props`, but the
				// component that fires it (Start) actually stores the
				// movie card as `.card`, not `.props`.
				var movie = e.link && e.link.card ? e.link.card : null;

				e.options.push({
					title: 'Рецензии (КП)',
					onSelect: function () {
						Lampa.Controller.toggle('content');
						showReviewsModal(movie);
					}
				});
			} catch (err) {
				// Fail silently, never break the "more" menu.
			}
		});
	}

	if (!window.kp_reviews_plugin) startPlugin();
})();
