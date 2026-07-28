(function () {
	'use strict';

	// Adds a "Рецензии" (Reviews) item to the movie/show card's "..." menu,
	// next to Lampa's own "Рекомендации" and "Интересные факты". Reviews
	// are fetched from TMDB only when the user actually opens this menu
	// item, not on every card view - keeps things lazy and avoids
	// unnecessary network requests.

	var MAX_REVIEWS = 5;
	var MAX_LENGTH = 3000;

	function buildReviewsHtml(reviews) {
		var wrap = $('<div style="padding: 1em;"></div>');

		reviews.slice(0, MAX_REVIEWS).forEach(function (review) {
			var author = review.author || 'Anonymous';
			var text = (review.content || '').trim();
			var rating = review.author_details && review.author_details.rating;

			if (text.length > MAX_LENGTH) text = text.slice(0, MAX_LENGTH) + '…';

			var card = $('<div style="margin-bottom:1.5em;"></div>');

			// Using .text() (not .html()) for untrusted external content to avoid injection.
			var head = $('<div style="font-weight:bold; margin-bottom:0.4em;"></div>').text(
				author + (rating ? ' — ' + rating + '/10' : '')
			);
			var body = $('<div style="white-space:pre-line; opacity:0.85;"></div>').text(text);

			card.append(head).append(body);
			wrap.append(card);
		});

		return wrap;
	}

	function loading(text) {
		return $('<div style="padding:1em; text-align:center;"></div>').text(text);
	}

	function showReviewsModal(movie) {
		Lampa.Modal.open({
			title: 'Рецензии (TMDB)',
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

		var isTV = !!movie.name; // Lampa convention: series have `name`, movies have `title`
		var id = movie.tmdb_id || ((movie.source === 'tmdb' || !movie.source) ? movie.id : false);

		if (!id) {
			Lampa.Modal.update(loading('Не удалось определить фильм'));
			return;
		}

		var path = (isTV ? 'tv/' : 'movie/') + id + '/reviews';

		// Force English: Lampa.Api.sources.tmdb.get() otherwise attaches the
		// app's UI language (e.g. `ru`), and TMDB filters reviews by that
		// language - since almost all TMDB reviews are in English, that
		// silently returns an empty result set even for popular movies.
		Lampa.Api.sources.tmdb.get(path, { langs: 'en-US' }, function (data) {
			if (data && data.results && data.results.length) {
				// Prefer longer, more substantial reviews first.
				var sorted = data.results.slice().sort(function (a, b) {
					return (b.content || '').length - (a.content || '').length;
				});

				Lampa.Modal.update(buildReviewsHtml(sorted));
			} else {
				Lampa.Modal.update(loading('Рецензии не найдены'));
			}
		}, function () {
			Lampa.Modal.update(loading('Ошибка загрузки рецензий'));
		});
	}

	function startPlugin() {
		window.tmdb_reviews_plugin = true;

		Lampa.Listener.follow('full', function (e) {
			if (e.type !== 'options') return;

			try {
				// Note: despite the event passing `props: this.props`, the
				// component that fires this event (Start) does not actually
				// have a `.props` field - it stores the movie card as
				// `.card`. Use `e.link.card` instead.
				var movie = e.link && e.link.card ? e.link.card : null;

				e.options.push({
					title: 'Рецензии',
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

	if (!window.tmdb_reviews_plugin) startPlugin();
})();
