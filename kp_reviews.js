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

	var MAX_REVIEWS = 7;
	var MAX_LENGTH = 3000;
	var KP_PROX = 'https://kp-relay.ua-andrey.workers.dev/'; // Same relay used by the ratings plugin

	function salt(input) {
		var str = (input || '') + '';
		var hash = 0;

		for (var i = 0; i < str.length; i++) {
			var c = str.charCodeAt(i);

			hash = ((hash << 5) - hash) + c;
			hash = hash & hash;
		}

		var result = '';
		for (var _i = 0, j = 32 - 3; j >= 0; _i += 3, j -= 3) {
			var x = (((hash >>> _i) & 7) << 3) + ((hash >>> j) & 7);
			result += String.fromCharCode(x < 26 ? 97 + x : x < 52 ? 39 + x : x - 4);
		}
		return result;
	}

	function decodeSecret(input, password) {
		var result = '';
		password = (password || '') + '';
		if (input && password) {
			var hash = salt('123456789' + password);
			while (hash.length < input.length) {
				hash += hash;
			}
			var i = 0;
			while (i < input.length) {
				result += String.fromCharCode(input[i] ^ hash.charCodeAt(i));
				i++;
			}
		}
		return result;
	}

	// Same shared/free API key already used by the ratings plugin.
	var KP_API_KEY = decodeSecret([85, 4, 115, 118, 107, 125, 10, 70, 85, 67, 82, 14, 32, 110, 102, 43, 9, 19, 85, 73, 4, 83, 33, 110, 52, 44, 92, 21, 72, 22, 87, 1, 118, 32, 100, 127], atob('X0tQM3Bhc3N3b3Jk'));

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
		}, function () {
			onFail();
		}, false, { headers: headers });

		function handleResult(json, used_url) {
			var items = (json.items && json.items.length) ? json.items : ((json.films && json.films.length) ? json.films : null);

			if (items) return chooseFilm(items);

			if (used_url !== url_by_title) {
				network.timeout(15000);
				network.silent(url_by_title, function (json2) {
					var items2 = (json2.items && json2.items.length) ? json2.items : ((json2.films && json2.films.length) ? json2.films : []);
					chooseFilm(items2);
				}, function () {
					onFail();
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

		reviews.slice(0, MAX_REVIEWS).forEach(function (review, i) {
			if (i > 0) {
				wrap.append('<hr style="border:none; border-top:1px solid rgba(255,255,255,0.2); margin:1.3em 0;">');
			}

			var author = review.reviewAutor || 'Anonymous';
			var title = (review.reviewTitle || '').trim();
			var text = (review.reviewDescription || '').trim();
			var type = review.reviewType; // POSITIVE / NEGATIVE / NEUTRAL

			if (text.length > MAX_LENGTH) text = text.slice(0, MAX_LENGTH) + '…';

			var typeLabel = type === 'POSITIVE' ? ' — положительная' : type === 'NEGATIVE' ? ' — отрицательная' : type === 'NEUTRAL' ? ' — нейтральная' : '';

			var card = $('<div></div>');

			// Using .text() (not .html()) for untrusted external content to avoid injection.
			var head = $('<div style="font-weight:bold; font-size:1.25em; margin-bottom:0.2em;"></div>').text(title || author);
			var sub = $('<div style="opacity:0.6; font-size:1em; margin-bottom:0.5em;"></div>').text(author + typeLabel);
			var body = $('<div style="white-space:pre-line; opacity:0.85; font-size:1.15em; line-height:1.5;"></div>').text(text);

			card.append(head).append(sub).append(body);
			wrap.append(card);
		});

		return wrap;
	}

	function loading(text) {
		return $('<div style="padding:1em; text-align:center;"></div>').text(text);
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
				if (data && data.reviews && data.reviews.length) {
					// Prefer longer, more substantial reviews first.
					var sorted = data.reviews.slice().sort(function (a, b) {
						return (b.reviewDescription || '').length - (a.reviewDescription || '').length;
					});

					Lampa.Modal.update(buildReviewsHtml(sorted));
				} else {
					Lampa.Modal.update(loading('Рецензии не найдены. Фильм: "' + title + '", KP id: ' + kpId));
				}
			}, function () {
				Lampa.Modal.update(loading('Ошибка загрузки рецензий. Фильм: "' + title + '", KP id: ' + kpId));
			}, false, { headers: headers });
		}, function () {
			Lampa.Modal.update(loading('Не удалось найти фильм на Кинопоиске. Фильм: "' + title + '"'));
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
