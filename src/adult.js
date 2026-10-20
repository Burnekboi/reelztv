// ---------------------------------------------------------------------------
// Adult section — configuration + data loading.
//
// This catalog is deliberately isolated from the main one:
//   • it only ever renders on the Adult tab (never in Home rails),
//   • it is never passed to the search API,
//   • it is age-gated before the tab can open,
//   • adult titles are never written to My List / Watch History.
//
// Nothing is bundled as a catalog: the section reads live from EPORNER's public
// webmaster API, and only falls back to local data when that fails. Three
// sources, first non-empty wins:
//
//   1) ADULT_LIVE — the live EPORNER catalog (see fetchAdultVideos).
//
//   2) ADULT_FEEDS — public JSON feed URLs. Each feed may be a bare array, or
//      an object with { items | videos | data | results | rows }.
//
//   3) ADULT_VIDEOS — the bundled fallback list. Used whenever every source
//      above fails or comes back empty, so the section is never a blank screen.
//      Each entry:
//
//        {
//          id: 'abc123',
//          title: 'Video title',
//          thumbnail: 'https://…/thumb.jpg',
//          duration: '12:34',
//          // Optional. When present it is used as the iframe src directly.
//          embed_url: 'https://provider.example/embed/abc123',
//        }
//
//      Without embed_url, the player asks ADULT_EMBED_TEMPLATE for the real
//      embed URL (that endpoint is JSON, not a page, so it can't be framed
//      directly) and caches the answer.
//
//      ⚠ The entries below are PLACEHOLDERS: short, openly licensed demo clips
//      (Blender Foundation / MDN, CC-BY / CC0) carrying `demo: true`, which the
//      card grid marks with a DEMO badge. They prove the pipeline works and stop
//      the section rendering empty — they are not adult content and are not a
//      catalog. Replace or delete them once your own feed / titles are in place
//      (a working feed always wins; these only show when a feed yields nothing).
//
// The easiest place to edit is public/adult.json — it is served as-is, so it
// can be updated on the host without rebuilding the site.
// ---------------------------------------------------------------------------

export const ADULT_EMBED_TEMPLATE = 'https://adultembed.com/api/videos/{id}/get-embed/';

// Vite replaces import.meta.env at build time; the optional chain keeps this
// module importable from plain Node (unit tests) where it is undefined.
const IS_DEV = Boolean(import.meta.env?.DEV);

// The bundled feed. It ships empty and is editable on the host **without a
// rebuild** — just replace public/adult.json with your items. Add more URLs
// here if you want to pull from several feeds.
export const ADULT_FEEDS = ['/adult.json'];

// Bundled fallback list — shown when no feed is configured, or when every feed
// fails or comes back empty. The three entries below are openly licensed demo
// clips (CC-BY / CC0) standing in for real titles so the section is never a
// blank screen; each is flagged `demo`, and the card grid marks them DEMO.
// Replace them with your own titles, or delete them once a feed is live.
export const ADULT_VIDEOS = [
  {
    id: 'demo-1',
    title: 'Placeholder clip (demo)',
    // Same-origin so it can never 404 or taint the page with mixed content.
    thumbnail: '/RZicon.png',
    duration: '9:56',
    // Big Buck Bunny — Blender Foundation, CC-BY 3.0.
    embed_url: 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
    demo: true,
  },
  {
    id: 'demo-2',
    title: 'Placeholder clip (demo)',
    thumbnail: '/RZicon.png',
    duration: '0:05',
    // MDN shared CC0 sample asset.
    embed_url: 'https://mdn.github.io/shared-assets/videos/flower.mp4',
    demo: true,
  },
  {
    id: 'demo-3',
    title: 'Placeholder clip (demo)',
    thumbnail: '/RZicon.png',
    duration: '0:10',
    embed_url: 'https://www.w3schools.com/html/mov_bbb.mp4',
    demo: true,
  },
];

// --- Age gate ---------------------------------------------------------------
// The confirmation is stored on the device so adults aren't re-asked on every
// click. Change this to shorten/lengthen the window.
const AGE_KEY = 'reelz_adult_verified_v1';
const AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isAgeVerified() {
  try {
    const at = Number(localStorage.getItem(AGE_KEY) || 0);
    return at > 0 && Date.now() - at < AGE_MS;
  } catch {
    return false;
  }
}

export function rememberAgeVerified() {
  try {
    localStorage.setItem(AGE_KEY, String(Date.now()));
  } catch {
    /* storage blocked — the gate simply asks again next time */
  }
}

export function forgetAgeVerified() {
  try {
    localStorage.removeItem(AGE_KEY);
  } catch {
    /* ignore */
  }
}

// --- EPORNER live catalog ----------------------------------------------------
// The section's primary source: EPORNER's public webmaster REST API. It answers
// with `Access-Control-Allow-Origin: *`, so a pure static site can call it
// directly — no proxy, no key. Its embed pages send neither X-Frame-Options nor
// a frame-ancestors CSP, so they are genuinely frameable.
export const ADULT_LIVE = {
  enabled: true,
  // Default feed keyword. The API's `query` is a real search term: 'trending'
  // returns its curated, newest-first set (~8.5k), while '' opens the entire
  // catalog (4.5M). Either way, paging through it is stable and duplicate-free.
  query: 'trending',
  // Results per request. The API accepts at least 500; 50 keeps the first
  // paint fast while the "Load more" button pages further on demand.
  perPage: 50,
};

const EPORNER_BASE = 'https://www.eporner.com/api/v2/video/search/';

// `query` is omitted when blank (an empty `query=` param means "0 results"),
// and `page` is omitted on page 1 to keep the canonical URL.
export function buildEpornerUrl({ query = 'trending', perPage = 50, page = 1 } = ADULT_LIVE) {
  const params = new URLSearchParams({
    per_page: String(Number(perPage) > 0 ? Number(perPage) : 50),
    format: 'json',
  });
  const term = String(query ?? '').trim();
  if (term) params.set('query', term);
  const p = Number(page);
  if (Number.isFinite(p) && p > 1) params.set('page', String(p));
  return `${EPORNER_BASE}?${params}`;
}

// Duration, defensively. The API's `length_min` is actually an mm:ss string
// ("38:17"), so appending "m" would render "38:17m". Use it verbatim when it is
// already a clock value, format it when it is a plain minute count, otherwise
// derive it from `length_sec`, otherwise fall back to "HD".
export function formatEpornerDuration(item) {
  const raw = item?.length_min;
  if (typeof raw === 'string' && /^\d+:\d{1,2}$/.test(raw.trim())) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return `${raw}m`;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return `${raw.trim()}m`;

  const secs = Number(item?.length_sec);
  if (Number.isFinite(secs) && secs > 0) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const mmss = `${m}:${String(s).padStart(2, '0')}`;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : mmss;
  }
  return 'HD';
}

// Map one EPORNER record onto the card/player model used everywhere else.
// The raw id stays in `sourceId`; `id` keeps the adult- prefix so an EPORNER id
// can never collide with a TMDB / AniList id in My List or Watch History.
export function normaliseEpornerItem(item) {
  if (!item || typeof item !== 'object') return null;
  const rawId = item.id ?? item.video_id ?? '';
  const usableId =
    (typeof rawId === 'string' && rawId.trim() !== '') || (typeof rawId === 'number' && Number.isFinite(rawId));
  if (!usableId) return null;
  const sourceId = String(rawId).trim();

  const thumbnail = secureUrl(item.default_thumb?.src || item.thumbs?.[0]?.src || '');
  const embedUrl = secureUrl(item.embed) || secureUrl(`https://www.eporner.com/embed/${sourceId}/`);

  return {
    id: `adult-${sourceId}`,
    sourceId,
    type: 'adult',
    category: 'Adult',
    title: String(item.title || 'Untitled'),
    poster: thumbnail,
    backdrop: thumbnail,
    duration: formatEpornerDuration(item),
    embedUrl,
    needsResolve: !embedUrl,
    demo: false,
  };
}

// Fetch + normalise one page of the live catalog.
//
// Accepts { query, page, perPage } overrides so the same function backs the
// default feed, the "Load more" button and the section's own search bar.
// Returns { items, error, page, perPage, totalCount, totalPages, hasMore } so
// callers can tell "the source is broken" apart from "the source is empty",
// and can page while `hasMore` holds.
export async function fetchAdultVideos(options = {}) {
  const cfg = { ...ADULT_LIVE, ...options };
  const page = Number.isFinite(Number(cfg.page)) && Number(cfg.page) > 1 ? Math.floor(Number(cfg.page)) : 1;
  const perPage = Number(cfg.perPage) > 0 ? Math.floor(Number(cfg.perPage)) : 50;
  const url = buildEpornerUrl({ ...cfg, page, perPage });
  const base = { page, perPage, totalCount: 0, totalPages: 1, hasMore: false, reached: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      // Public API — never send credentials.
      credentials: 'omit',
      cache: 'no-store',
    });

    if (!res.ok) {
      if (IS_DEV) console.warn(`[adult] eporner → HTTP ${res.status}`);
      return { items: [], error: `The catalog responded with HTTP ${res.status}`, ...base };
    }

    const data = await res.json();
    // Requested diagnostic: inspect the raw payload before mapping.
    if (IS_DEV) console.log('Fetched data:', data);

    // Only an EPORNER-shaped payload counts. Anything else (a proxy page, a
    // challenge, an error object) is reported rather than silently treated as
    // "no results", so the caller can keep falling through to the next source.
    if (!Array.isArray(data?.videos)) {
      if (IS_DEV) console.warn('[adult] eporner → payload had no videos array');
      return { items: [], error: 'The catalog response was malformed', ...base };
    }

    const seen = new Set();
    const items = [];
    for (const row of data.videos) {
      const item = normaliseEpornerItem(row);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }

    const totalPages = Math.max(1, Number(data.total_pages) || 1);
    const totalCount = Number(data.total_count) || items.length;
    // `reached` separates "the endpoint answered" from "the endpoint is
    // unreachable" — an empty answer is a genuine no-matches state, while an
    // unreachable one must fall back to something local.
    const meta = { page, perPage, totalCount, totalPages, hasMore: page < totalPages, reached: true };

    if (IS_DEV) {
      console.log(`[adult] eporner → ${items.length} item(s), page ${page}/${totalPages} (${totalCount} total)`);
    }
    // An empty page past the first one is simply the end of the list, not a
    // failure — only page 1 returning nothing can break the fallback chain.
    if (items.length === 0) {
      return { items: [], error: page > 1 ? '' : 'The catalog returned no videos', ...meta };
    }
    return { items, error: '', ...meta };
  } catch (err) {
    const error = describeFetchError(err);
    if (IS_DEV) console.warn(`[adult] eporner failed: ${error}`, err);
    return { items: [], error, ...base };
  } finally {
    clearTimeout(timer);
  }
}

// --- URLs -------------------------------------------------------------------
// Everything the section renders must be https:// (or a same-origin relative
// path). http:// assets would be blocked as mixed content on the live https
// site, and javascript:/data: URLs are never legitimate here.
export function secureUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  if (!url) return '';

  if (url.startsWith('//')) return `https:${url}`;
  if (/^(\/|\.\/|\.\.\/)/.test(url)) return url;
  if (/^https:\/\//i.test(url)) return url;
  if (/^http:\/\//i.test(url)) return `https://${url.slice('http://'.length)}`;
  return '';
}

// --- Embed URL --------------------------------------------------------------
export function buildAdultEmbedUrl(raw) {
  const direct = secureUrl(raw?.embed_url || raw?.embedUrl || raw?.embed || '');
  if (direct) return direct;

  const sourceId = raw?.sourceId || raw?.id || raw?.videoId || raw?.slug || '';
  if (!sourceId) return '';
  return ADULT_EMBED_TEMPLATE.replace('{id}', encodeURIComponent(String(sourceId)));
}

// Pull a playable URL out of whatever shape a provider answers with: a plain
// URL, an <iframe src="…"> snippet, or JSON with the URL under a few likely
// keys (including one level of nesting).
export function pickUrlFromPayload(payload) {
  if (!payload) return '';

  if (typeof payload === 'string') {
    const text = payload.trim();
    if (/^https?:\/\//i.test(text)) return text;
    const m = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (m) return /^https?:\/\//i.test(m[1]) ? m[1] : '';
    return '';
  }

  if (Array.isArray(payload)) {
    for (const row of payload) {
      const url = pickUrlFromPayload(row);
      if (url) return url;
    }
    return '';
  }

  if (typeof payload === 'object') {
    for (const key of ['embed_url', 'embedUrl', 'embed', 'url', 'iframe', 'src', 'player_url', 'html']) {
      const url = pickUrlFromPayload(payload[key]);
      if (url) return url;
    }
    for (const key of ['data', 'result', 'video', 'player', 'sources']) {
      const url = pickUrlFromPayload(payload[key]);
      if (url) return url;
    }
  }

  return '';
}

const RESOLVE_CACHE = new Map();

// The provider endpoint in ADULT_EMBED_TEMPLATE is a JSON API, so its URL can't
// be dropped into an iframe directly. Ask it for the real embed URL once per
// video. If it happens to serve an HTML page already, that URL is used as-is.
export async function resolveAdultEmbed(raw) {
  const sourceId = raw?.sourceId || raw?.id || '';
  if (!sourceId) return '';
  const key = String(sourceId);
  if (RESOLVE_CACHE.has(key)) return RESOLVE_CACHE.get(key);

  const apiUrl = ADULT_EMBED_TEMPLATE.replace('{id}', encodeURIComponent(key));
  try {
    const res = await fetch(apiUrl, {
      headers: { Accept: 'application/json, text/html;q=0.8' },
      credentials: 'omit',
    });
    if (!res.ok) return '';

    const type = res.headers.get('content-type') || '';
    const text = await res.text();
    let found = '';

    if (type.includes('json') || /^\s*[{[]/.test(text)) {
      try {
        found = pickUrlFromPayload(JSON.parse(text));
      } catch {
        found = '';
      }
    } else if (type.includes('html') || /^\s*</.test(text)) {
      // Already an embeddable page.
      found = apiUrl;
    }

    // Never hand an http:// (mixed content) or non-http URL to the iframe.
    found = secureUrl(found);
    if (found) RESOLVE_CACHE.set(key, found);
    return found;
  } catch {
    return '';
  }
}

// Normalise any feed/array item into the shape the card grid + player expect.
function normaliseAdultItem(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // Accept string/number ids only — an object/array here would stringify to
  // "[object Object]" and produce a dead card.
  const rawId = raw.id ?? raw.videoId ?? raw.video_id ?? raw.slug ?? raw.key ?? '';
  const usableId =
    (typeof rawId === 'string' && rawId.trim() !== '') || (typeof rawId === 'number' && Number.isFinite(rawId));
  if (!usableId) return null;
  const sourceId = String(rawId).trim();

  // Only an explicit URL is used directly; id-only items are resolved through
  // the provider API by the player (see resolveAdultEmbed).
  const explicitEmbed = [raw.embed_url, raw.embedUrl, raw.embed].map(secureUrl).find(Boolean) || '';
  const thumbnail = secureUrl(raw.thumbnail || raw.thumb || raw.poster || raw.image || raw.cover || '');
  const duration = raw.duration || raw.length || raw.time || '';

  return {
    // Prefixed so it can never collide with a TMDB/AniList id.
    id: `adult-${sourceId}`,
    sourceId,
    type: 'adult',
    title: String(raw.title || raw.name || raw.caption || 'Untitled'),
    poster: thumbnail,
    backdrop: thumbnail,
    duration: String(duration || ''),
    embedUrl: explicitEmbed,
    needsResolve: !explicitEmbed,
    demo: raw.demo === true,
  };
}

export function itemsFromPayload(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload?.items || payload?.videos || payload?.data || payload?.results || payload?.rows || [];
  // Some feeds wrap once more: { data: { items: [...] } }.
  if (!Array.isArray(list) && list && typeof list === 'object') {
    for (const key of ['items', 'videos', 'data', 'results', 'rows']) {
      if (Array.isArray(list[key])) return list[key];
    }
  }
  return Array.isArray(list) ? list : [];
}

function describeFetchError(err) {
  if (err?.name === 'AbortError') return 'The request timed out';
  if (err instanceof SyntaxError) return 'The feed returned invalid JSON';
  // fetch() cannot distinguish a CORS rejection from an adblocker or an offline
  // network, so name all three.
  return 'The request was blocked or unreachable (CORS, adblocker, or offline)';
}

// Fetch one feed and report *why* it failed instead of silently returning [].
async function fetchFeed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      // Public feeds only — never send credentials.
      credentials: 'omit',
      // A cached empty /adult.json would hide edits made on the host.
      cache: 'no-store',
    });

    if (!res.ok) {
      if (IS_DEV) console.warn(`[adult] feed ${url} → HTTP ${res.status}`);
      return { rows: [], error: `The feed responded with HTTP ${res.status}` };
    }

    const data = await res.json();

    // Requested diagnostic: inspect the raw payload before mapping.
    if (IS_DEV) console.log('Fetched data:', data);
    if (IS_DEV) {
      console.log(`[adult] feed ${url} → ${itemsFromPayload(data).length} item(s)`);
    }

    return { rows: itemsFromPayload(data), error: '' };
  } catch (err) {
    const error = describeFetchError(err);
    if (IS_DEV) console.warn(`[adult] feed ${url} failed: ${error}`, err);
    return { rows: [], error };
  } finally {
    clearTimeout(timer);
  }
}

// Normalise + de-duplicate a raw list into card-ready items. Shared by the
// loader and by App.jsx's final fallback.
export function normaliseAdultList(rawList) {
  const items = [];
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const item = normaliseAdultItem(raw);
    if (item) items.push(item);
  }
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

// Load the adult catalog. Source order, first non-empty wins:
//   1) the EPORNER live catalog,
//   2) any configured JSON feeds (public/adult.json),
//   3) the bundled placeholder list.
// Anything that fails is recorded so the UI can explain the cause instead of
// silently showing nothing. Client-side only, no backend.
export async function loadAdultVideos() {
  let collected = [];
  const failures = [];
  let sourcesTried = 0;
  let liveMeta = null;

  // 1) Live catalog.
  if (ADULT_LIVE.enabled) {
    sourcesTried += 1;
    const live = await fetchAdultVideos();
    if (live.error) failures.push({ url: buildEpornerUrl(), error: live.error });
    collected = live.items;
    liveMeta = live;
  }

  // 2) Configured JSON feeds.
  const feeds = ADULT_FEEDS.filter(Boolean);
  for (const url of feeds) {
    if (collected.length > 0) break;
    sourcesTried += 1;
    const { rows, error } = await fetchFeed(url);
    if (error) failures.push({ url, error });
    collected = normaliseAdultList(rows);
  }

  // 3) Bundled fallback — the section must never be a blank screen.
  let usedStaticFallback = false;
  if (collected.length === 0) {
    const bundled = normaliseAdultList(ADULT_VIDEOS);
    usedStaticFallback = bundled.length > 0;
    collected = bundled;
  }

  // De-duplicate across sources, keeping the first occurrence.
  const seen = new Set();
  const items = collected.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  // Paging only applies when the grid is actually backed by the live catalog —
  // a JSON feed or the bundled list is a fixed set with nothing to append.
  const usedLive = Boolean(liveMeta && liveMeta.items.length > 0);
  const paging = usedLive
    ? {
        page: liveMeta.page,
        perPage: liveMeta.perPage,
        totalCount: liveMeta.totalCount,
        totalPages: liveMeta.totalPages,
        hasMore: liveMeta.hasMore,
      }
    : { page: 1, perPage: liveMeta?.perPage || ADULT_LIVE.perPage, totalCount: items.length, totalPages: 1, hasMore: false };

  // Only a total outage with no fallback at all is an error. A reachable but
  // empty source is a configuration state, not a failure.
  const allSourcesFailed = sourcesTried > 0 && failures.length === sourcesTried;
  const error = items.length === 0 && allSourcesFailed ? `${failures[0].error}.` : '';

  if (IS_DEV) {
    console.log(
      `[adult] catalog: ${items.length} item(s)` +
        (usedLive ? `, page ${paging.page}/${paging.totalPages}` : '') +
        (paging.hasMore ? ' (more available)' : '') +
        (usedStaticFallback ? ' (bundled fallback)' : '') +
        (failures.length ? ` — ${failures.length} source(s) failed` : '') +
        (error ? ` — ${error}` : '')
    );
  }

  return { items, error, failures, usedStaticFallback, ...paging };
}
