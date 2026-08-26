(function () {
  'use strict';

  if (window.anistar_online_plugin) return;
  window.anistar_online_plugin = true;

  var BASE = 'https://anistar.org';
  function absolute(url, ref) {
    if (!url) return '';
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
      try { return new TextDecoder('windows-1251').decode(data); } catch (e) { return ''; }
    }
    return '';
  }

  function request(url, callback) {
    var req = new Lampa.Reguest();
    req.timeout(20000);
    req.get(url, function (data) {
      var html = responseText(data);
      callback(html && !/Just a moment|cf-chl-|cloudflare/i.test(html) ? html : '');
    }, function () {
      callback('');
    }, { type: 'arraybuffer' });
  }

  function parseCards(html) {
    var cards = [];
    var blocks = html.split(/<div\s+class=["']news["'][^>]*>/i).slice(1);

    blocks.forEach(function (block) {
      var title = block.match(/class=["']title_left["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      var image = block.match(/<img[^>]*src=["']([^"']+)["'][^>]*class=["']main-img["']/i);
      if (!image) image = block.match(/<img[^>]*itemprop=["']image["'][^>]*src=["']([^"']+)["']/i);
      if (!title) return;

      var year = block.match(/(?:Год выхода|Год)[\s\S]*?<a[^>]*>(\d{4})<\/a>/i);
      var rating = block.match(/itemprop=["']ratingValue["'][^>]*>([\d.]+)/i);
      cards.push({
        title: text(title[2]),
        url: absolute(title[1]),
        poster: image ? absolute(image[1]) : '',
        year: year ? year[1] : '',
        rating: rating ? rating[1] : ''
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
      links.push({ url: link, title: text(label) || ('Эпизод ' + (links.length + 1)) });
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

    return {
      title: title ? text(title[1]) : '',
      poster: poster ? absolute(poster[1], url) : '',
      links: links
    };
  }

  function parsePlayer(html, ref) {
    var streams = [];
    var seen = {};

    function add(url, title) {
      url = absolute((url || '').replace(/\\\//g, '/'), ref);
      if (!url || seen[url] || !/\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(url)) return;
      seen[url] = true;
      streams.push({ url: url, title: text(title) || ('Эпизод ' + (streams.length + 1)) });
    }

    var playlist = html.match(/(?:var\s+)?playlst\s*=\s*(\[[\s\S]*?\]);/i);
    if (playlist) {
      try {
        JSON.parse(playlist[1].replace(/,\s*([}\]])/g, '$1')).forEach(function (episode, index) {
          if (episode.hls) add(episode.hls, episode.comment);
          (episode.files_mp4 || []).forEach(function (file) {
            if (!streams[index]) add(file.file, episode.comment || file.label);
          });
        });
      } catch (e) {}
    }

    (html.match(/(?:https?:)?\\?\/\\?\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/gi) || []).forEach(function (url) {
      add(url, 'Смотреть онлайн');
    });
    return streams;
  }

  function resolveStreams(links, callback, index) {
    index = index || 0;
    if (index >= links.length) return callback([]);
    if (/\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(links[index].url)) return callback([links[index]]);

    request(links[index].url, function (html) {
      var streams = parsePlayer(html, links[index].url);
      if (streams.length) callback(streams);
      else resolveStreams(links, callback, index + 1);
    });
  }

  function source(component, object) {
    var selectTitle = object.search || object.movie && object.movie.title || '';

    this.search = function (activityObject) {
      object = activityObject || object;
      selectTitle = object.search || object.movie && object.movie.title || selectTitle;
      component.loading(true);
      request(BASE + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(selectTitle), function (html) {
        showResults(html);
      });

      function showResults(html) {
        if (!html) return component.emptyForQuery(selectTitle);
        var items = parseCards(html);
        if (!items.length) return component.emptyForQuery(selectTitle);
        component.loading(false);
        component.reset();
        items.forEach(appendItem);
        component.start(true);
      }
    };

    function appendItem(item) {
      var view = $('<div class="selector online torrent-item anistar-online-item">' +
        '<div class="torrent-item__title"></div><div class="torrent-item__quality"></div></div>');
      view.find('.torrent-item__title').text(item.title);
      view.find('.torrent-item__quality').text('AniStar' + (item.year ? ' / ' + item.year : ''));
      view.on('hover:enter', function () {
        component.loading(true);
        request(item.url, function (html) {
          var detail = parseDetail(html, item.url);
          if (!detail.links.length) {
            component.loading(false);
            return Lampa.Noty.show('AniStar: видео не найдено');
          }
          resolveStreams(detail.links, function (streams) {
            component.loading(false);
            if (!streams.length) return Lampa.Noty.show('AniStar: поток видео не найден');
            var first = streams[0];
            Lampa.Player.play({ title: detail.title || item.title, url: first.url, subtitles: [] });
            Lampa.Player.playlist(streams.map(function (stream) {
              return { title: stream.title, url: stream.url, subtitles: [] };
            }));
          });
        });
      });
      component.append(view);
    }

    this.destroy = function () {};
    this.reset = function () {};
    this.filter = function () {};
    this.extendChoice = function () {};
  }

  function onlineComponent(object) {
    var component = this;
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Explorer(object);
    var active = new source(component, object);

    this.create = function () {
      files.appendFiles(scroll.render());
      active.search(object);
      return this.render();
    };
    this.render = function () { return files.render(); };
    this.start = function (firstSelect) {
      if (!Lampa.Activity.active() || Lampa.Activity.active().activity !== this.activity) return;
      var first = scroll.render().find('.selector').eq(0)[0];
      Lampa.Controller.add('content', {
        toggle: function () { Lampa.Controller.collectionSet(scroll.render(), files.render()); Lampa.Controller.collectionFocus(first, scroll.render()); },
        up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
        down: function () { Navigator.move('down'); },
        right: function () { Navigator.move('right'); },
        left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
        back: function () { Lampa.Activity.backward(); }
      });
      if (firstSelect || component.inActivity && component.inActivity()) Lampa.Controller.toggle('content');
    };
    this.loading = function (state) {
      if (state) component.activity.loader(true); else component.activity.loader(false);
    };
    this.append = function (item) { scroll.append(item); };
    this.reset = function () { scroll.clear(); scroll.reset(); };
    this.empty = function (message) {
      var empty = Lampa.Template.get('list_empty');
      if (message) empty.find('.empty__descr').text(message);
      scroll.append(empty);
      this.loading(false);
    };
    this.emptyForQuery = function (query) { this.empty('AniStar: ничего не найдено по запросу ' + query); };
    this.inActivity = function () { return true; };
    this.destroy = function () { active.destroy(); files.destroy(); scroll.destroy(); };
  }

  function openOnline(movie) {
    Lampa.Activity.push({
      url: '',
      title: 'AniStar Онлайн',
      component: 'anistar_online',
      search: movie.title,
      search_one: movie.title,
      search_two: movie.original_title || movie.title,
      movie: movie,
      page: 1
    });
  }

  Lampa.Component.add('anistar_online', onlineComponent);

  function addFullButton(event) {
    if (!event || event.type !== 'complite' || !event.data || !event.data.movie) return;
    var page = event.object && event.object.activity && event.object.activity.render();
    if (!page || page.find('.anistar-online-button').length) return;
    var button = $('<div class="full-start__button selector anistar-online-button" title="Смотреть на AniStar">' +
      '<span> AniStar</span></div>');
    button.on('hover:enter', function () { openOnline(event.data.movie); });
    var watch = page.find('.view--torrent').first();
    if (watch.length) watch.after(button); else {
      var buttons = page.find('.full-start__buttons, .full-start-new__buttons, .full-start__buttons-line').first();
      if (buttons.length) buttons.append(button); else page.find('.full-start__body, .full-start-new__body').first().append(button);
    }
  }

  if (Lampa.Listener && Lampa.Listener.follow) Lampa.Listener.follow('full', addFullButton);

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
