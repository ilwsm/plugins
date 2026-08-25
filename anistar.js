(function () {
  'use strict';

  if (window.anistar_plugin) return;
  window.anistar_plugin = true;

  var BASE = 'https://anistar.org';
  var PROXY_ALL = 'https://api.allorigins.win/raw?url=';
  var PROXY_LIST = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest=',
    '' // no proxy - request the site directly
  ];

  function getSetting(key, def) {
    try { return Lampa.Storage.get('anistar_' + key, def); }
    catch (e) { return def; }
  }
  function setSetting(key, val) {
    try { Lampa.Storage.set('anistar_' + key, val); } catch (e) {}
  }

  function decode1251(buffer) {
    try {
      var decoder = new TextDecoder('windows-1251');
      return decoder.decode(buffer);
    } catch (e) {
      return '';
    }
  }

  function proxyUrl(url) {
    var idx = parseInt(getSetting('proxy', 0), 10);
    if (isNaN(idx)) idx = 0;
    var base = (idx >= 0 && idx < PROXY_LIST.length) ? PROXY_LIST[idx] : PROXY_LIST[0];
    if (!base) return url; // no proxy selected - direct request
    return base + encodeURIComponent(url);
  }

  function cacheGet(key, ttlMs) {
    try {
      var raw = localStorage.getItem('anistar_cache_' + key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (Date.now() - obj.ts > ttlMs) return null;
      return obj.data;
    } catch (e) { return null; }
  }

  function cacheSet(key, data) {
    try {
      localStorage.setItem('anistar_cache_' + key, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (e) {}
  }

  function clearCache() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('anistar_cache_') === 0) keys.push(k);
    }
    keys.forEach(function (k) { localStorage.removeItem(k); });
  }

  function regexAttr(html, tag, attr) {
    var re = new RegExp('<' + tag + '[^>]*\\s' + attr + '=["\\\']([^"\\\']*)["\\\']', 'i');
    var m = html.match(re);
    return m ? m[1] : '';
  }

  function regexContent(html, tag) {
    var re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
    var m = html.match(re);
    return m ? m[1] : '';
  }

  function regexAll(html, tag, attrs) {
    var re = new RegExp('<' + tag + '[^>]*?>[\\s\\S]*?<\\/' + tag + '>', 'gi');
    var blocks = html.match(re) || [];
    return blocks.map(function (block) {
      var obj = {};
      attrs.forEach(function (a) {
        obj[a] = regexAttr(block, tag, a);
      });
      obj._raw = block;
      return obj;
    });
  }

  function stripTags(s) {
    return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(n); }).trim();
  }

  function extractIdFromUrl(href) {
    if (!href) return '';
    var m = href.match(/\/(\d+)-/);
    return m ? m[1] : '';
  }

  function extractTextBetween(html, open, close) {
    var i = html.indexOf(open);
    if (i === -1) return '';
    i += open.length;
    var j = html.indexOf(close, i);
    if (j === -1) return html.substring(i);
    return html.substring(i, j);
  }

  function httpGet(url, callback, asArrayBuffer) {
    var req = new Lampa.Reguest();
    var opts = asArrayBuffer ? { type: 'arraybuffer' } : {};
    var px = proxyUrl(url);
    req.get(px, function (data) {
      if (asArrayBuffer && data && data instanceof ArrayBuffer) {
        callback(decode1251(data));
      } else {
        callback(typeof data === 'string' ? data : '');
      }
    }, function (err) {
      var idx = parseInt(getSetting('proxy', 0), 10);
      if (isNaN(idx)) idx = 0;
      var nextIdx = (idx + 1) % PROXY_LIST.length;
      setSetting('proxy', nextIdx);
      var px2 = proxyUrl(url);
      var req2 = new Lampa.Reguest();
      req2.get(px2, function (data2) {
        if (asArrayBuffer && data2 && data2 instanceof ArrayBuffer) {
          callback(decode1251(data2));
        } else {
          callback(typeof data2 === 'string' ? data2 : '');
        }
      }, function () {
        callback('');
      }, opts);
    }, opts);
  }

  function httpPost(url, body, callback) {
    var req = new Lampa.Reguest();
    var px = proxyUrl(url);
    req.post(px, body, function (data) {
      callback(typeof data === 'string' ? data : '');
    }, function (err) {
      callback('');
    });
  }

  function parseCatalogItems(html) {
    var items = [];
    var parts = html.split(/<div\s+class=["']news["'][^>]*>/i);
    var blocks = parts.slice(1).map(function (part) {
      return '<div class="news">' + part;
    });

    blocks.forEach(function (block) {
      var item = {};

      var titleLink = block.match(/<div\s+class=["']title_left["'][^>]*>\s*<a[^>]*href=["\']([^"\']+)["\'][^>]*>([\s\S]*?)<\/a>/i);
      if (!titleLink) {
        titleLink = block.match(/<a[^>]*href=["\']([^"\']*\.html)["\'][^>]*>([^<]+)<\/a>/i);
      }
      if (titleLink) {
        item.url = titleLink[1];
        item.title = stripTags(titleLink[2]);
        item.id = extractIdFromUrl(item.url);
      }

      var img = block.match(/<img[^>]*itemprop=["\']image["\'][^>]*src=["\']([^"\']+)["\']/i);
      if (!img) img = block.match(/<img[^>]*class=["\']main-img["\'][^>]*src=["\']([^"\']+)["\']/i);
      if (!img) img = block.match(/<img[^>]*src=["\']([^"\']*uploads[^"\']*)["\']/i);
      if (img) {
        item.poster = img[1];
        if (item.poster.indexOf('http') !== 0) item.poster = BASE + item.poster;
      }

      var rating = block.match(/itemprop=["\']ratingValue["\'][^>]*>(\d+)/i);
      if (rating) item.rating = rating[1];

      var year = block.match(/Год выхода[\s\S]*?<a[^>]*>(\d{4})<\/a>/i);
      if (!year) year = block.match(/year\/(\d{4})/i);
      if (year) item.year = year[1];

      var type = block.match(/Тип[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
      if (type) item.type = stripTags(type[1]);

      var genres = block.match(/Жанр[\s\S]*?<\/b>\s*([\s\S]*?)<\/li>/i);
      if (genres) {
        var gLinks = genres[1].match(/<a[^>]*>([^<]+)<\/a>/gi) || [];
        item.genres = gLinks.map(function (g) { return stripTags(g); });
      }

      var eps = block.match(/Серий[\s\S]*?<\/b>\s*([\s\S]*?)<\/li>/i);
      if (eps) item.episodes = stripTags(eps[1]);

      var desc = block.match(/<div class="descripts">([\s\S]*?)(?:<p class="reason"|<\/div>)/i);
      if (desc) item.description = stripTags(desc[1]);

      if (item.id || item.title) items.push(item);
    });

    return items;
  }

  function parsePagination(html) {
    var pages = html.match(/<div class="pages">([\s\S]*?)<\/div>/i);
    if (!pages) return { current: 1, total: 1 };

    var pageLinks = pages[1].match(/<a[^>]*href=["\'][^"']*\/page\/(\d+)\/["\'][^>]*>/gi) || [];
    var maxPage = 1;
    pageLinks.forEach(function (pl) {
      var m = pl.match(/\/page\/(\d+)\//);
      if (m) {
        var n = parseInt(m[1]);
        if (n > maxPage) maxPage = n;
      }
    });

    var currentPage = html.match(/<div class="pages">[\s\S]*?<span>(\d+)<\/span>/i);
    return {
      current: currentPage ? parseInt(currentPage[1]) : 1,
      total: maxPage
    };
  }

  function parseDetail(html) {
    var detail = {};

    var t = html.match(/<h1[^>]*itemprop=["\']name["\'][^>]*>([^<]+)<\/h1>/i);
    if (!t) t = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (t) detail.title = stripTags(t[1]);

    var img = html.match(/<img[^>]*itemprop=["\']image["\'][^>]*src=["\']([^"\']+)["\']/i);
    if (!img) img = html.match(/<div class="fimg"[^>]*>\s*<img[^>]*src=["\']([^"\']+)["\']/i);
    if (img) {
      detail.poster = img[1];
      if (detail.poster.indexOf('http') !== 0) detail.poster = BASE + detail.poster;
    }

    var rating = html.match(/itemprop=["\']ratingValue["\'][^>]*>(\d+)/i);
    if (rating) detail.rating = rating[1];

    var desc = html.match(/<div class="ftext"[^>]*>([\s\S]*?)<\/div>/i);
    if (!desc) desc = html.match(/<div class="full-text"[^>]*>([\s\S]*?)<\/div>/i);
    if (desc) detail.description = stripTags(desc[1]);

    var meta = html.match(/<ul class="fmeta"[^>]*>([\s\S]*?)<\/ul>/i);
    if (!meta) meta = html.match(/<div class="fmeta"[^>]*>([\s\S]*?)<\/div>/i);
    if (meta) {
      var metaHtml = meta[1];
      var year = metaHtml.match(/Год[\s\S]*?<a[^>]*>(\d{4})<\/a>/i);
      if (year) detail.year = year[1];

      var genres = metaHtml.match(/Жанр[\s\S]*?<\/b>\s*([\s\S]*?)(?:<\/li>|<\/div>)/i);
      if (genres) {
        var gLinks = genres[1].match(/<a[^>]*>([^<]+)<\/a>/gi) || [];
        detail.genres = gLinks.map(function (g) { return stripTags(g); });
      }

      var eps = metaHtml.match(/Серий[\s\S]*?<\/b>\s*([\s\S]*?)(?:<\/li>|<\/div>)/i);
      if (eps) detail.episodes = stripTags(eps[1]);

      var typ = metaHtml.match(/Тип[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
      if (typ) detail.type = stripTags(typ[1]);
    }

    var iframe = html.match(/<iframe[^>]*src=["\']([^"\']*)["\'][^>]*>/i);
    if (iframe) {
      var src = iframe[1];
      if (src.indexOf('http') !== 0) src = BASE + src;
      detail.playerUrl = src;

      var idMatch = src.match(/id=(\d+)/i);
      var hashMatch = src.match(/hash=([a-f0-9]+)/i);
      if (idMatch) detail.playerId = idMatch[1];
      if (hashMatch) detail.playerHash = hashMatch[1];
    }

    if (!detail.playerUrl) {
      var scriptSrc = html.match(/(?:playerUrl|player_url|iframe_src)\s*=\s*["\']([^"\']+)["\']/i);
      if (scriptSrc) {
        var s = scriptSrc[1];
        if (s.indexOf('http') !== 0) s = BASE + s;
        detail.playerUrl = s;
      }
    }

    if (!detail.playerUrl) {
      var p2 = html.match(/\/test\/player2\/[^\s"'\)]+/i);
      if (p2) {
        var p2url = p2[0];
        if (p2url.indexOf('http') !== 0) p2url = BASE + p2url;
        detail.playerUrl = p2url;
        var idM = p2url.match(/id=(\d+)/i);
        var hashM = p2url.match(/hash=([a-f0-9]+)/i);
        if (idM) detail.playerId = idM[1];
        if (hashM) detail.playerHash = hashM[1];
      }
    }

    detail.episodesList = [];
    var epBlocks = html.match(/<div class="[^"]*episode[^"]*"[^>]*>([\s\S]*?)<\/div>/gi) || [];
    epBlocks.forEach(function (eb, idx) {
      var epTitle = stripTags(eb);
      detail.episodesList.push({ index: idx + 1, title: epTitle || ('Эпизод ' + (idx + 1)) });
    });

    return detail;
  }

  function parsePlayerPlaylist(html) {
    var plMatch = html.match(/var\s+playlst\s*=\s*(\[[\s\S]*?\]);/i);
    if (!plMatch) plMatch = html.match(/playlst\s*=\s*(\[[\s\S]*?\]);/i);
    if (!plMatch) return [];

    try {
      var cleaned = plMatch[1]
        .replace(/,\s*\]/g, ']')
        .replace(/,\s*\}/g, '}');

      var playlist = JSON.parse(cleaned);
      return playlist;
    } catch (e) {
      return parsePlayerPlaylistManual(plMatch[1]);
    }
  }

  function parsePlayerPlaylistManual(raw) {
    var items = [];
    var blocks = raw.match(/\{[\s\S]*?\}/g) || [];
    blocks.forEach(function (block) {
      var item = {};
      var comment = block.match(/comment\s*:\s*["']([^"']*)["']/i);
      if (comment) item.comment = comment[1];

      var hls = block.match(/hls\s*:\s*["']([^"']*)["']/i);
      if (hls) item.hls = hls[1];

      item.files_mp4 = [];
      var fileMatches = block.match(/\{\s*file\s*:\s*["']([^"']*)["']\s*,\s*label\s*:\s*["']([^"']*)["']\s*\}/gi) || [];
      fileMatches.forEach(function (fm) {
        var f = fm.match(/file\s*:\s*["']([^"']*)["']/i);
        var l = fm.match(/label\s*:\s*["']([^"']*)["']/i);
        if (f) item.files_mp4.push({ file: f[1], label: l ? l[1] : '' });
      });

      if (item.comment || item.hls || item.files_mp4.length) items.push(item);
    });
    return items;
  }

  var Api = {
    catalog: function (page, callback) {
      var url = page > 1 ? BASE + '/page/' + page + '/' : BASE + '/';
      var cacheKey = 'catalog_v2_' + page;
      var cached = cacheGet(cacheKey, 30 * 60 * 1000);
      if (cached) return callback(cached);

      httpGet(url, function (html) {
        if (!html) {
          console.warn('[AniStar] catalog: empty response for', url, '(proxy or site unreachable)');
          Lampa.Noty.show('AniStar: пустой ответ от сервера (прокси или сайт недоступны)');
          return callback({ items: [], pagination: { current: page, total: 1 } });
        }
        var items = parseCatalogItems(html);
        console.log('[AniStar] catalog page', page, '- response length:', html.length, '- items parsed:', items.length);
        if (items.length === 0) {
          console.warn('[AniStar] 0 items parsed, first 500 chars of response:', html.slice(0, 500));
        }
        var pagination = parsePagination(html);
        var data = { items: items, pagination: pagination };
        cacheSet(cacheKey, data);
        callback(data);
      }, true);
    },

    catalogCategory: function (category, page, callback) {
      var pageUrl = page > 1 ? BASE + '/' + category + '/page/' + page + '/' : BASE + '/' + category + '/';
      var cacheKey = 'cat_v2_' + category + '_' + page;
      var cached = cacheGet(cacheKey, 30 * 60 * 1000);
      if (cached) return callback(cached);

      httpGet(pageUrl, function (html) {
        if (!html) {
          console.warn('[AniStar] catalogCategory: empty response for', pageUrl, '(proxy or site unreachable)');
          Lampa.Noty.show('AniStar: пустой ответ от сервера (прокси или сайт недоступны)');
          return callback({ items: [], pagination: { current: page, total: 1 } });
        }
        var items = parseCatalogItems(html);
        console.log('[AniStar] category', category, 'page', page, '- response length:', html.length, '- items parsed:', items.length);
        if (items.length === 0) {
          console.warn('[AniStar] 0 items parsed, first 500 chars of response:', html.slice(0, 500));
        }
        var pagination = parsePagination(html);
        var data = { items: items, pagination: pagination };
        cacheSet(cacheKey, data);
        callback(data);
      }, true);
    },

    search: function (query, callback) {
      var cacheKey = 'search_' + query;
      var cached = cacheGet(cacheKey, 10 * 60 * 1000);
      if (cached) return callback(cached);

      var formData = 'story=' + encodeURIComponent(query) + '&do=search&subaction=search';
      var url = BASE + '/index.php?do=search';

      var req = new Lampa.Reguest();
      var px = proxyUrl(url);
      req.post(px, formData, function (data) {
        var html = typeof data === 'string' ? data : '';
        var items = parseCatalogItems(html);
        cacheSet(cacheKey, items);
        callback(items);
      }, function () {
        Lampa.Noty.show('AniStar: ошибка поиска');
        callback([]);
      });
    },

    detail: function (url, callback) {
      var cacheKey = 'detail_' + url;
      var cached = cacheGet(cacheKey, 60 * 60 * 1000);
      if (cached) return callback(cached);

      httpGet(url, function (html) {
        if (!html) {
          Lampa.Noty.show('AniStar: ошибка загрузки страницы');
          return callback(null);
        }
        var detail = parseDetail(html);
        detail.url = url;
        cacheSet(cacheKey, detail);
        callback(detail);
      });
    },

    player: function (playerUrl, callback) {
      if (!playerUrl) return callback([]);

      httpGet(playerUrl, function (html) {
        if (html) {
          var playlist = parsePlayerPlaylist(html);
          if (playlist.length > 0) return callback(playlist);
        }

        httpGet(playerUrl, function (html2) {
          var playlist2 = parsePlayerPlaylist(html2);
          callback(playlist2);
        }, true);
      });
    }
  };

  Lampa.Template.add('anistar_card', '<div class="card card--wide card--tag">' +
    '<div class="card__img"><img /></div>' +
    '<div class="card__body">' +
    '<div class="card__title"></div>' +
    '<div class="card__subtitle"></div>' +
    '<div class="card__rating"></div>' +
    '</div>' +
    '</div>');

  function createCard(item) {
    var card = document.createElement('div');
    card.className = 'card card--wide card--tag';
    card.style.cursor = 'pointer';
    card.innerHTML =
      '<div class="card__img"><img src="' + (item.poster || '') + '" /></div>' +
      '<div class="card__body">' +
      '<div class="card__title">' + (item.title || 'Без названия') + '</div>' +
      '<div class="card__subtitle">' +
      (item.year ? item.year + ' ' : '') +
      (item.type ? item.type + ' ' : '') +
      (item.genres && item.genres.length ? item.genres.slice(0, 3).join(', ') : '') +
      '</div>' +
      '<div class="card__rating">' + (item.rating ? item.rating + '/10' : '') + '</div>' +
      '</div>';

    card.addEventListener('click', function () {
      if (item.url) {
        Lampa.Activity.push({
          url: item.url,
          title: item.title || 'AniStar',
          component: 'anistar_detail'
        });
      }
    });

    return card;
  }

  Lampa.Component.add('anistar', {
    type: 'list',

    list: function () {
      return {
        title: 'AniStar - Каталог',
        component: 'anistar',
        page: 1
      };
    },

    constructor: function (container) {
      var comp = this;
      var data = { items: [] };
      var page = 1;

      function loadPage(p) {
        page = p;
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#fff;">Загрузка...</div>';

        Api.catalog(p, function (result) {
          data = result;
          render();
        });
      }

      function render() {
        container.innerHTML = '';

        var list = document.createElement('div');
        list.className = 'anistar-catalog';
        list.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;padding:10px;';

        data.items.forEach(function (item) {
          list.appendChild(createCard(item));
        });

        container.appendChild(list);

        if (data.pagination && data.pagination.total > 1) {
          var pag = document.createElement('div');
          pag.className = 'anistar-pagination';
          pag.style.cssText = 'display:flex;justify-content:center;gap:10px;padding:20px;flex-wrap:wrap;';

          if (data.pagination.current > 1) {
            var prev = document.createElement('div');
            prev.className = 'simple-button';
            prev.textContent = '← Назад';
            prev.addEventListener('click', function () { loadPage(data.pagination.current - 1); });
            pag.appendChild(prev);
          }

          var info = document.createElement('div');
          info.className = 'simple-button';
          info.textContent = data.pagination.current + ' / ' + data.pagination.total;
          info.style.opacity = '0.7';
          info.style.cursor = 'default';
          pag.appendChild(info);

          if (data.pagination.current < data.pagination.total) {
            var next = document.createElement('div');
            next.className = 'simple-button';
            next.textContent = 'Вперёд →';
            next.addEventListener('click', function () { loadPage(data.pagination.current + 1); });
            pag.appendChild(next);
          }

          container.appendChild(pag);
        }

        if (data.items.length === 0) {
          container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Ничего не найдено</div>';
        }
      }

      comp.start = function () { loadPage(1); };
    }
  });

  ['anime', 'cartoons', 'manga', 'dorams'].forEach(function (cat) {
    var titles = {
      anime: 'AniStar - Аниме',
      cartoons: 'AniStar - Мультфильмы',
      manga: 'AniStar - Манга',
      dorams: 'AniStar - Дорамы'
    };

    Lampa.Component.add('anistar_' + cat, {
      type: 'list',

      list: function () {
        return { title: titles[cat] || 'AniStar', component: 'anistar_' + cat, page: 1 };
      },

      constructor: function (container) {
        var comp = this;
        var data = { items: [] };
        var page = 1;

        function loadPage(p) {
          page = p;
          container.innerHTML = '<div style="padding:20px;text-align:center;color:#fff;">Загрузка...</div>';
          Api.catalogCategory(cat, p, function (result) {
            data = result;
            render();
          });
        }

        function render() {
          container.innerHTML = '';
          var list = document.createElement('div');
          list.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;padding:10px;';
          data.items.forEach(function (item) {
            list.appendChild(createCard(item));
          });
          container.appendChild(list);

          if (data.pagination && data.pagination.total > 1) {
            var pag = document.createElement('div');
            pag.style.cssText = 'display:flex;justify-content:center;gap:10px;padding:20px;flex-wrap:wrap;';
            if (data.pagination.current > 1) {
              var prev = document.createElement('div');
              prev.className = 'simple-button';
              prev.textContent = '← Назад';
              prev.addEventListener('click', function () { loadPage(data.pagination.current - 1); });
              pag.appendChild(prev);
            }
            var info = document.createElement('div');
            info.className = 'simple-button';
            info.textContent = data.pagination.current + ' / ' + data.pagination.total;
            info.style.opacity = '0.7';
            pag.appendChild(info);
            if (data.pagination.current < data.pagination.total) {
              var next = document.createElement('div');
              next.className = 'simple-button';
              next.textContent = 'Вперёд →';
              next.addEventListener('click', function () { loadPage(data.pagination.current + 1); });
              pag.appendChild(next);
            }
            container.appendChild(pag);
          }

          if (data.items.length === 0) {
            container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Ничего не найдено</div>';
          }
        }

        comp.start = function () { loadPage(1); };
      }
    });
  });

  Lampa.Component.add('anistar_detail', {
    type: 'page',

    list: function () {
      return { title: 'AniStar', component: 'anistar_detail' };
    },

    constructor: function (container) {
      var comp = this;
      var detail = null;

      function render() {
        if (!detail) return;
        container.innerHTML = '';

        var hero = document.createElement('div');
        hero.style.cssText = 'display:flex;gap:20px;padding:20px;flex-wrap:wrap;';
        hero.innerHTML =
          '<div style="flex:0 0 200px;">' +
          '<img src="' + (detail.poster || '') + '" style="width:200px;border-radius:8px;" />' +
          '</div>' +
          '<div style="flex:1;min-width:250px;">' +
          '<h1 style="margin:0 0 10px 0;color:#fff;">' + (detail.title || 'Без названия') + '</h1>' +
          '<div style="color:#aaa;margin-bottom:10px;">' +
          (detail.year ? 'Год: ' + detail.year + ' ' : '') +
          (detail.type ? '| ' + detail.type + ' ' : '') +
          (detail.rating ? '| Рейтинг: ' + detail.rating + '/10' : '') +
          '</div>' +
          (detail.genres && detail.genres.length ? '<div style="color:#aaa;margin-bottom:10px;">Жанры: ' + detail.genres.join(', ') + '</div>' : '') +
          (detail.episodes ? '<div style="color:#aaa;margin-bottom:10px;">Серий: ' + detail.episodes + '</div>' : '') +
          '<div style="color:#ccc;line-height:1.5;">' + (detail.description || '') + '</div>' +
          '</div>';
        container.appendChild(hero);

        if (detail.playerUrl) {
          var playBtn = document.createElement('div');
          playBtn.className = 'simple-button';
          playBtn.textContent = '▶ Смотреть';
          playBtn.style.cssText = 'margin:20px auto;text-align:center;width:200px;';
          playBtn.addEventListener('click', function () {
            loadPlayer(detail.playerUrl);
          });
          container.appendChild(playBtn);
        }

        var epList = document.createElement('div');
        epList.className = 'anistar-episodes';
        epList.style.cssText = 'padding:10px 20px;';

        if (detail.episodesList && detail.episodesList.length > 0) {
          var epTitle = document.createElement('h3');
          epTitle.style.color = '#fff';
          epTitle.textContent = 'Эпизоды';
          epList.appendChild(epTitle);

          detail.episodesList.forEach(function (ep) {
            var epBtn = document.createElement('div');
            epBtn.className = 'simple-button';
            epBtn.style.cssText = 'margin:5px 0;';
            epBtn.textContent = ep.title;
            epBtn.addEventListener('click', function () {
              if (detail.playerUrl) loadPlayer(detail.playerUrl);
            });
            epList.appendChild(epBtn);
          });
        }

        container.appendChild(epList);

        var backBtn = document.createElement('div');
        backBtn.className = 'simple-button';
        backBtn.textContent = '← Назад';
        backBtn.style.cssText = 'margin:20px auto;text-align:center;width:200px;';
        backBtn.addEventListener('click', function () {
          Lampa.Activity.backward();
        });
        container.appendChild(backBtn);
      }

      function loadPlayer(playerUrl) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#fff;">Загрузка плеера...</div>';

        Api.player(playerUrl, function (playlist) {
          if (!playlist || playlist.length === 0) {
            Lampa.Noty.show('AniStar: не удалось загрузить видео');
            render();
            return;
          }

          var episodes = playlist.map(function (ep, idx) {
            var url = '';
            var quality = {};
            var defaultQuality = getSetting('quality', '720');

            if (ep.files_mp4 && ep.files_mp4.length > 0) {
              ep.files_mp4.forEach(function (f) {
                quality[f.label] = f.file;
                if (f.label === defaultQuality && !url) url = f.file;
              });
              if (!url) url = ep.files_mp4[0].file;
            } else if (ep.hls) {
              url = ep.hls;
            }

            return {
              title: ep.comment || ('Эпизод ' + (idx + 1)),
              url: url,
              quality: quality
            };
          }).filter(function (ep) { return ep.url; });

          if (episodes.length === 0) {
            Lampa.Noty.show('AniStar: нет доступных видео');
            render();
            return;
          }

          var first = episodes[0];
          Lampa.Player.play({
            title: first.title,
            url: first.url,
            subtitles: []
          });

          Lampa.Player.playlist(episodes.map(function (ep) {
            return {
              title: ep.title,
              url: ep.url,
              quality: ep.quality
            };
          }));
        });
      }

      comp.start = function () {
        var activity = Lampa.Activity.active();
        if (activity && activity.activity && activity.activity.url) {
          var url = activity.activity.url;
          if (url.indexOf('http') !== 0) url = BASE + url;

          Api.detail(url, function (d) {
            detail = d;
            render();
          });
        }
      };
    }
  });

  Lampa.Component.add('anistar_search', {
    type: 'list',

    list: function () {
      return { title: 'Поиск AniStar', component: 'anistar_search', search: true };
    },

    constructor: function (container) {
      var comp = this;
      var query = '';
      var results = [];

      function render() {
        container.innerHTML = '';

        if (results.length === 0) {
          container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">' +
            (query ? 'Ничего не найдено по запросу: ' + query : 'Введите запрос для поиска') +
            '</div>';
          return;
        }

        var list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;padding:10px;';
        results.forEach(function (item) {
          list.appendChild(createCard(item));
        });
        container.appendChild(list);
      }

      comp.search = function (q) {
        query = q;
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#fff;">Поиск: ' + q + '...</div>';

        Api.search(q, function (items) {
          results = items;
          render();
        });
      };

      comp.start = function () {
        render();
      };
    }
  });

  // Lampa.Settings has no .add() method (real API: listener/init/render/update/create/main).
  // Use SettingsApi, same pattern as the other working plugins.
  Lampa.SettingsApi.addComponent({
    component: 'anistar',
    name: 'AniStar',
    icon: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/></svg>'
  });

  Lampa.SettingsApi.addParam({
    component: 'anistar',
    param: {
      name: 'anistar_quality',
      type: 'select',
      values: { '720': '720p', '360': '360p' },
      default: '720'
    },
    field: {
      name: 'Качество по умолчанию',
      description: 'Какое качество MP4 использовать по умолчанию'
    },
    onChange: function (value) {
      setSetting('quality', value);
    }
  });

  Lampa.SettingsApi.addParam({
    component: 'anistar',
    param: {
      name: 'anistar_proxy',
      type: 'select',
      values: { '0': 'allorigins.win', '1': 'corsproxy.io', '2': 'codetabs.com', '3': 'Без прокси' },
      default: '0'
    },
    field: {
      name: 'Прокси-сервер',
      description: 'Прокси для обхода CORS (если не работает, попробуйте другой)'
    },
    onChange: function (value) {
      setSetting('proxy', parseInt(value));
    }
  });

  Lampa.SettingsApi.addParam({
    component: 'anistar',
    param: {
      name: 'anistar_clear_cache',
      type: 'trigger',
      default: ''
    },
    field: {
      name: 'Очистить кеш',
      description: 'Очистить кешированные данные AniStar'
    },
    onChange: function () {
      clearCache();
      Lampa.Noty.show('Кеш AniStar очищен');
    }
  });

  // Manifest.plugins is a getter/setter registry for the "installed plugins"
  // info screen only — it does NOT create a menu entry. Assigning a single
  // object with a `type` field is the correct usage (see IPTV/Collections
  // plugins bundled with Lampa itself).
  Lampa.Manifest.plugins = {
    type: 'video',
    version: '1.0.0',
    name: 'AniStar',
    description: 'Плагин для просмотра аниме с anistar.org',
    component: 'anistar'
  };

  // The actual menu entry: build the <li> and append it to the sidebar,
  // same approach as Lampa's own bundled plugins.
  function addMenuButton() {
    var button = $(
      '<li class="menu__item selector">' +
      '<div class="menu__ico"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/></svg></div>' +
      '<div class="menu__text">AniStar</div>' +
      '</li>'
    );

    button.on('hover:enter', function () {
      Lampa.Activity.push({
        url: '',
        title: 'AniStar',
        component: 'anistar',
        page: 1
      });
    });

    $('.menu .menu__list').eq(0).append(button);
  }

  if (window.appready) addMenuButton();
  else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type == 'ready') addMenuButton();
    });
  }

  console.log('AniStar plugin loaded');
})();
