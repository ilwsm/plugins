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

	// Escapes all HTML, then re-enables a small whitelist of safe formatting
	// tags only (no attributes allowed), so things like <i>...</i> render
	// properly without allowing arbitrary/unsafe HTML through.
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

			var author = review.author || 'Anonymous';
			var title = (review.title || '').trim();
			var text = (review.description || '').trim();
			var type = review.type; // POSITIVE / NEGATIVE / NEUTRAL

			//if (text.length > MAX_LENGTH) text = text.slice(0, MAX_LENGTH) + '…';

			var typeText = type === 'POSITIVE' ? 'положительная' : type === 'NEGATIVE' ? 'отрицательная' : type === 'NEUTRAL' ? 'нейтральная' : '';
			var typeColor = type === 'POSITIVE' ? '#4CAF50' : type === 'NEGATIVE' ? '#F44336' : type === 'NEUTRAL' ? '#FFC107' : '';
			// Note: the thumb emoji itself is rendered by the system's
			// color emoji font in most browsers/webviews and will likely
			// keep its own default color regardless of the CSS below.
			var typeEmoji = type === 'POSITIVE' ? ' \uD83D\uDC4D' : type === 'NEGATIVE' ? ' \uD83D\uDC4E' : '';

			var card = $('<div></div>');

			// Using .text() (not .html()) for untrusted external content to avoid injection.
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
		var title = movie ? (movie.title || movie.name || '?') : '?';
		var currentPage = 1;
		var totalPages = 1;
		var kpId = null;
		var kpHeaders = null;

		function fetchPage(page) {
			var network = new Lampa.Reguest();
			network.timeout(15000);
			network.silent(KP_PROX + 'https://kinopoiskapiunofficial.tech/api/v2.2/films/' + kpId + '/reviews?page=' + page, function (data) {
				currentPage = page;
				totalPages = (data && data.totalPages) || 1;

				Lampa.Modal.title('Рецензии (Кинопоиск) — стр. ' + currentPage + ' из ' + totalPages);

				if (data && data.items && data.items.length) {
					Lampa.Modal.update(buildReviewsHtml(data.items));
				} else {
					Lampa.Modal.update(loading('Рецензии не найдены. Фильм: "' + title + '", KP id: ' + kpId));
				}
			}, function (jqXHR) {
				Lampa.Modal.update(loading(describeApiError(network, jqXHR) + '. Фильм: "' + title + '", KP id: ' + kpId));
			}, false, { headers: kpHeaders });
		}

		Lampa.Modal.open({
			title: 'Рецензии (Кинопоиск)',
			html: loading('Загрузка...'),
			size: 'large',
			buttons: [
				{
					name: '\u25C0 Пред. страница',
					onSelect: function () {
						if (kpId && currentPage > 1) fetchPage(currentPage - 1);
					}
				},
				{
					name: 'След. страница \u25B6',
					onSelect: function () {
						if (kpId && currentPage < totalPages) fetchPage(currentPage + 1);
					}
				}
			],
			buttons_position: 'outside',
			onBack: function () {
				Lampa.Controller.toggle('content');
				Lampa.Modal.close();
			}
		});

		if (!movie) {
			Lampa.Modal.update(loading('Нет данных о фильме'));
			return;
		}

											   

		findKpId(movie, function (foundId, headers) {
			kpId = foundId;
			kpHeaders = headers;
			fetchPage(1);
												  
													  
			
																													  
	 
						
																													
								   
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
