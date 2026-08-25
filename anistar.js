(function () {
  'use strict';

  if (window.anistar_plugin) return;
  window.anistar_plugin = true;

  var BASE = 'https://anistar.org';
  var PROXY_ALL = 'https://api.allorigins.win/raw?url=';
  var PROXY_LIST = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest='
  ];

  // ─── Settings helpers ──────────────────────────────────────────────
  function getSetting(key, def) {
    try { return Lampa.Storage.get('anistar_' + key, def); }
    catch (e) { return def; }
  }
  function setSetting(key, val) {
    try { Lampa.Storage.set('anistar_' + key, val); } catch (e) {}
  }

  // ─── Utilities ─────────────────────────────────────────────────────
  function decode1251(buffer) {
    try {
      var decoder = new TextDecoder('windows-1251');
      return decoder.decode(buffer);
    } catch (e) {
      return '';
    }
  }

  function proxyUrl(url) {
    var idx = getSetting('proxy', 0);
    var base = PROXY_LIST[idx] || PROXY_LIST[0];
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

  // ─── Regex-based HTML helpers ──────────────────────────────────────
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

  // ─── HTTP fetch wrapper (uses Lampa.Reguest with proxy) ────────────
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
      // Try next proxy
      var idx = getSetting('proxy', 0);
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

  // ─── Parse catalog items from HTML ─────────────────────────────────
  function parseCatalogItems(html) {
    var items = [];
    var blocks = html.match(/<div[^>]*class="news"[^>]*itemscope[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/gi) || [];

    // Fallback: try simpler .news blocks
    if (blocks.length === 0) {
      blocks = html.match(/<div[^>]*class="news"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi) || [];
    }
    if (blocks.length === 0) {
      // Even broader: grab everything between successive news divs
      var parts = html.split(/<div[^>]*class="news"/i);
      for (var i = 1; i < parts.length; i++) {
        var chunk = '<div class="news"' + parts[i];
        var end = chunk.indexOf('</div>\n</div>\n</div>');
        if (end > 0) blocks.push(chunk.substring(0, end + '</div>\n</div>\n</div>'.length));
        else {
          end = chunk.indexOf('</div>');
          if (end > 0) blocks.push(chunk.substring(0, Math.min(end + 200, chunk.length)));
          else blocks.push(chunk);
        }
      }
    }

    blocks.forEach(function (block) {
      var item = {};

      // URL + title
      var titleLink = block.match(/<div class="title_left">\s*<a[^>]*href=["\']([^"\']+)["\'][^>]*>([^<]+)<\/a>/i);
      if (!titleLink) {
        titleLink = block.match(/<a[^>]*href=["\']([^"\']*\.html)["\'][^>]*>([^<]+)<\/a>/i);
      }
      if (titleLink) {
        item.url = titleLink[1];
        item.title = stripTags(titleLink[2]);
        item.id = extractIdFromUrl(item.url);
      }

      // Poster
      var img = block.match(/<img[^>]*itemprop=["\']image["\'][^>]*src=["\']([^"\']+)["\']/i);
      if (!img) img = block.match(/<img[^>]*class=["\']main-img["\'][^>]*src=["\']([^"\']+)["\']/i);
      if (!img) img = block.match(/<img[^>]*src=["\']([^"\']*uploads[^"\']*)["\']/i);
      if (img) {
        item.poster = img[1];
        if (item.poster.indexOf('http') !== 0) item.poster = BASE + item.poster;
      }

      // Rating
      var rating = block.match(/itemprop=["\']ratingValue["\'][^>]*>(\d+)/i);
      if (rating) item.rating = rating[1];

      // Year
      var year = block.match(/Год выхода[\s\S]*?<a[^>]*>(\d{4})<\/a>/i);
      if (!year) year = block.match(/year\/(\d{4})/i);
      if (year) item.year = year[1];

      // Type
      var type = block.match(/Тип[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
      if (type) item.type = stripTags(type[1]);

      // Genres
      var genres = block.match(/Жанр[\s\S]*?<\/b>\s*([\s\S]*?)<\/li>/i);
      if (genres) {
        var gLinks = genres[1].match(/<a[^>]*>([^<]+)<\/a>/gi) || [];
        item.genres = gLinks.map(function (g) { return stripTags(g); });
      }

      // Episodes
      var eps = block.match(/Серий[\s\S]*?<\/b>\s*([\s\S]*?)<\/li>/i);
      if (eps) item.episodes = stripTags(eps[1]);

      // Description
      var desc = block.match(/<div class="descripts">([\s\S]*?)(?:<p class="reason"|<\/div>)/i);
      if (desc) item.description = stripTags(desc[1]);

      if (item.id || item.title) items.push(item);
    });

    return items;
  }

  // ─── Parse pagination ──────────────────────────────────────────────
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

  // ─── Parse detail page ─────────────────────────────────────────────
  function parseDetail(html) {
    var detail = {};

    // Title
    var t = html.match(/<h1[^>]*itemprop=["\']name["\'][^>]*>([^<]+)<\/h1>/i);
    if (!t) t = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (t) detail.title = stripTags(t[1]);

    // Poster
    var img = html.match(/<img[^>]*itemprop=["\']image["\'][^>]*src=["\']([^"\']+)["\']/i);
    if (!img) img = html.match(/<div class="fimg"[^>]*>\s*<img[^>]*src=["\']([^"\']+)["\']/i);
    if (img) {
      detail.poster = img[1];
      if (detail.poster.indexOf('http') !== 0) detail.poster = BASE + detail.poster;
    }

    // Rating
    var rating = html.match(/itemprop=["\']ratingValue["\'][^>]*>(\d+)/i);
    if (rating) detail.rating = rating[1];

    // Description
    var desc = html.match(/<div class="ftext"[^>]*>([\s\S]*?)<\/div>/i);
    if (!desc) desc = html.match(/<div class="full-text"[^>]*>([\s\S]*?)<\/div>/i);
    if (desc) detail.description = stripTags(desc[1]);

    // Metadata from fmeta or similar
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

    // Player iframe
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

    // Alternative: extract player src from script
    if (!detail.playerUrl) {
      var scriptSrc = html.match(/(?:playerUrl|player_url|iframe_src)\s*=\s*["\']([^"\']+)["\']/i);
      if (scriptSrc) {
        var s = scriptSrc[1];
        if (s.indexOf('http') !== 0) s = BASE + s;
        detail.playerUrl = s;
      }
    }

    // Another pattern: /test/player2/...
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

    // Episodes list from the page itself (if no player iframe found, look for episode links)
    detail.episodesList = [];
    var epBlocks = html.match(/<div class="[^"]*episode[^"]*"[^>]*>([\s\S]*?)<\/div>/gi) || [];
    epBlocks.forEach(function (eb, idx) {
      var epTitle = stripTags(eb);
      detail.episodesList.push({ index: idx + 1, title: epTitle || ('Эпизод ' + (idx + 1)) });
    });

    return detail;
  }

  // ─── Parse player playlist ─────────────────────────────────────────
  function parsePlayerPlaylist(html) {
    // Look for var playlst = [...];
    var plMatch = html.match(/var\s+playlst\s*=\s*(\[[\s\S]*?\]);/i);
    if (!plMatch) plMatch = html.match(/playlst\s*=\s*(\[[\s\S]*?\]);/i);
    if (!plMatch) return [];

    try {
      var cleaned = plMatch[1]
        .replace(/,\s*\]/g, ']')
        .replace(/,\s*\}/g, '}');

      // Sanitize: remove potential trailing commas
      var playlist = JSON.parse(cleaned);
      return playlist;
    } catch (e) {
      // Try manual parsing as fallback
      return parsePlayerPlaylistManual(plMatch[1]);
    }
  }

  function parsePlayerPlaylistManual(raw) {
    var items = [];
    // Split by { ... }
    var blocks = raw.match(/\{[\s\S]*?\}/g) || [];
    blocks.forEach(function (block) {
      var item = {};
      var comment = block.match(/comment\s*:\s*["']([^"']*)["']/i);
      if (comment) item.comment = comment[1];

      var hls = block.match(/hls\s*:\s*["']([^"']*)["']/i);
      if (hls) item.hls = hls[1];

      // MP4 files
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

  // ─── API ───────────────────────────────────────────────────────────
  var Api = {
    catalog: function (page, callback) {
      var url = page > 1 ? BASE + '/page/' + page + '/' : BASE + '/';
      var cacheKey = 'catalog_' + page;
      var cached = cacheGet(cacheKey, 30 * 60 * 1000); // 30 min
      if (cached) return callback(cached);

      httpGet(url, function (html) {
        if (!html) {
          Lampa.Noty.show('AniStar: ошибка загрузки каталога');
          return callback({ items: [], pagination: { current: page, total: 1 } });
        }
        var items = parseCatalogItems(html);
        var pagination = parsePagination(html);
        var data = { items: items, pagination: pagination };
        cacheSet(cacheKey, data);
        callback(data);
      });
    },

    catalogCategory: function (category, page, callback) {
      var pageUrl = page > 1 ? BASE + '/' + category + '/page/' + page + '/' : BASE + '/' + category + '/';
      var cacheKey = 'cat_' + category + '_' + page;
      var cached = cacheGet(cacheKey, 30 * 60 * 1000);
      if (cached) return callback(cached);

      httpGet(pageUrl, function (html) {
        if (!html) {
          Lampa.Noty.show('AniStar: ошибка загрузки');
          return callback({ items: [], pagination: { current: page, total: 1 } });
        }
        var items = parseCatalogItems(html);
        var pagination = parsePagination(html);
        var data = { items: items, pagination: pagination };
        cacheSet(cacheKey, data);
        callback(data);
      });
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
      var cached = cacheGet(cacheKey, 60 * 60 * 1000); // 1 hour
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

      // Try fetching through proxy first
      httpGet(playerUrl, function (html) {
        if (html) {
          var playlist = parsePlayerPlaylist(html);
          if (playlist.length > 0) return callback(playlist);
        }

        // Try arraybuffer approach (windows-1251)
        httpGet(playerUrl, function (html2) {
          var playlist2 = parsePlayerPlaylist(html2);
          callback(playlist2);
        }, true);
      });
    }
  };

  // ─── Card template ─────────────────────────────────────────────────
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

  // ─── Catalog component ─────────────────────────────────────────────
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

        // Pagination
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

  // ─── Category-specific components ──────────────────────────────────
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

  // ─── Detail component ──────────────────────────────────────────────
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

        // Poster + info
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

        // Play button
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

        // Episode list (if we have episodes from playlist)
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

        // Back button
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
            // Prefer MP4 over HLS
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

          // Play first episode
          var first = episodes[0];
          Lampa.Player.play({
            title: first.title,
            url: first.url,
            subtitles: []
          });

          // Set playlist
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

  // ─── Search component ──────────────────────────────────────────────
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

  // ─── Settings ──────────────────────────────────────────────────────
  Lampa.Settings.add({
    component: 'anistar',
    name: 'AniStar',
    items: [
      {
        name: 'Качество по умолчанию',
        description: 'Какое качество MP4 использовать по умолчанию',
        type: 'select',
        values: {
          '720': '720p',
          '360': '360p'
        },
        default: '720',
        onChange: function (val) {
          setSetting('quality', val);
        }
      },
      {
        name: 'Прокси-сервер',
        description: 'Прокси для обхода CORS (если не работает, попробуйте другой)',
        type: 'select',
        values: {
          '0': 'allorigins.win',
          '1': 'corsproxy.io',
          '2': 'codetabs.com'
        },
        default: '0',
        onChange: function (val) {
          setSetting('proxy', parseInt(val));
        }
      },
      {
        name: 'Очистить кеш',
        description: 'Очистить кached данные AniStar',
        type: 'button',
        onChange: function () {
          clearCache();
          Lampa.Noty.show('Кеш AniStar очищен');
        }
      }
    ]
  });

  // ─── Plugin registration ───────────────────────────────────────────
  Lampa.Manifest.plugins = Lampa.Manifest.plugins || {};
  Lampa.Manifest.plugins.push({
    name: 'AniStar',
    version: '1.0.0',
    description: 'Плагин для просмотра аниме с anistar.org',
    component: 'anistar'
  });

  // ─── Menu integration ──────────────────────────────────────────────
  function addMenuItem(title, component) {
    Lampa.Manifest.plugins.push({
      name: title,
      component: component
    });
  }

  addMenuItem('AniStar - Каталог', 'anistar');
  addMenuItem('AniStar - Аниме', 'anistar_anime');
  addMenuItem('AniStar - Мультфильмы', 'anistar_cartoons');
  addMenuItem('AniStar - Манга', 'anistar_manga');
  addMenuItem('AniStar - Дорамы', 'anistar_dorams');

  // ─── Search integration ────────────────────────────────────────────
  if (Lampa.Search) {
    var origSearch = Lampa.Search;
    // Hook into search to include AniStar results
    Lampa.Search = origSearch;
  }

  console.log('AniStar plugin loaded');
})();
