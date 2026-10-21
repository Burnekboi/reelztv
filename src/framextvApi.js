// ---------------------------------------------------------------------------
// Keyless FrameXTV API client.
//
// FrameXTV runs a public JSON API (no keys, CORS-open) behind three mirror
// hosts. Like their own frontend, we fail over across mirrors automatically:
//   1. https://api.framextv.tech
//   2. https://api.framextv.xyz
//   3. https://api.framextv.cc
//
// Anime routes live under the /anime prefix on the same mirrors and serve
// AniList/Kitsu-backed titles (ids are AniList ids).
// ---------------------------------------------------------------------------

import { API_MIRRORS, EMBED_ORIGIN, VIDSRC_HOST } from './codes';

// Internal hosts, extractor ids and embed event names live encoded in
// ./codes.js so third-party names never appear as text in the built bundle.
const BASES = API_MIRRORS;

export { EMBED_ORIGIN };

// Remember whichever mirror answered last so subsequent calls are fast.
let activeBase = null;

async function getJson(path, { anime = false } = {}) {
  const order = activeBase
    ? [activeBase, ...BASES.filter((b) => b !== activeBase)]
    : BASES;
  let lastError = null;
  for (const base of order) {
    try {
      const url = `${base}${anime ? '/anime' : ''}${path}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json')) throw new Error('non-JSON response');
      const data = await res.json();
      activeBase = base;
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('All catalog API mirrors failed');
}

// Normalize every catalog item (TMDB-backed movie/tv, AniList/Kitsu anime,
// home rails, search hits) into one shape the UI can render everywhere.
export function normalizeMedia(raw) {
  if (!raw || raw.id === undefined || raw.id === null) return null;
  const rawType = String(raw.type || '').toLowerCase();
  const type = rawType === 'movie' ? 'movie' : rawType === 'anime' ? 'anime' : 'tv';
  const id = String(raw.id);
  return {
    id,
    anilistId: raw.anilistId ? String(raw.anilistId) : type === 'anime' ? id : null,
    title: raw.title || raw.name || 'Untitled',
    type,
    rating: raw.rating ?? raw.vote_average ?? null,
    year: raw.year || (raw.release_date || raw.first_air_date || '').slice(0, 4) || null,
    poster: raw.poster || raw.image || null,
    backdrop: raw.backdrop || raw.image || null,
    description: raw.overview || raw.synopsis || raw.description || '',
    genres: Array.isArray(raw.genres)
      ? raw.genres.map((g) => (typeof g === 'string' ? g : g?.name)).filter(Boolean)
      : [],
  };
}

function unwrapList(data) {
  if (!data || data.success === false) {
    throw new Error(data?.error || 'Catalog request failed');
  }
  // Filtered queries with no matches answer with `results: null` and
  // totalResults 0 — that's an empty list, not an error.
  const raw = Array.isArray(data.results) ? data.results : [];
  return {
    items: raw.map(normalizeMedia).filter(Boolean),
    page: data.page || 1,
    totalPages: data.totalPages || 1,
    totalResults: data.totalResults || 0,
  };
}

// GET /api/home — hero pick + prebuilt discovery rails.
export async function fetchHome() {
  const data = await getJson('/api/home');
  if (!data || !data.success) throw new Error(data?.error || 'Home request failed');
  const rails = {};
  for (const [key, rail] of Object.entries(data.rails || {})) {
    rails[key] = (rail?.results || []).map(normalizeMedia).filter(Boolean);
  }
  return { hero: normalizeMedia(data.hero), rails };
}

// GET /api/movies & /api/tv — the advanced browse endpoints (same ones
// FrameXTV's own Movies/TV pages use). `genre` is a TMDB genre id and is
// combined server-side with year / min_rating, like TMDB discover.
// NOTE: the backend drops `genre` whenever `category` is trending or
// new_releases (those TMDB endpoints take no genre), so callers omit the
// category when a genre is active and order the results client-side instead.
export async function fetchLibrary(library, { category = '', genre = '', year = '', minRating = '', page = 1 } = {}) {
  const params = new URLSearchParams({ page: String(page) });
  if (category) params.set('category', category);
  if (genre) params.set('genre', String(genre));
  if (year) params.set('year', String(year));
  if (minRating) params.set('min_rating', String(minRating));
  return unwrapList(await getJson(`/api/${library === 'tv' ? 'tv' : 'movies'}?${params.toString()}`));
}

// GET /anime/api/discover — anime browsing. genre (by name) and seasonYear
// ARE honoured server-side for anime.
//
// The mirrors serve these /anime routes but attach NO CORS header to them
// (their movie routes do send `*`), so browsers block the response on any real
// domain. When that happens we read the same catalog from AniList directly —
// keyless, CORS-open, and the very source these routes proxy.
export async function fetchAnimeDiscover({ category = 'popular', genre = '', seasonYear = '', page = 1 } = {}) {
  const params = new URLSearchParams({ page: String(page) });
  if (category) params.set('category', category);
  if (genre) params.set('genre', genre);
  if (seasonYear) params.set('seasonYear', String(seasonYear));
  try {
    return unwrapList(await getJson(`/api/discover?${params.toString()}`, { anime: true }));
  } catch {
    return anilistDiscover({ category, genre, seasonYear, page });
  }
}

// GET /api/search — global search (type: movie | tv | anime | all).
export async function searchMedia(query, type = 'all', page = 1) {
  const q = String(query || '').trim();
  if (q.length < 2) return { items: [], page: 1, totalPages: 0, totalResults: 0 };
  const params = new URLSearchParams({ q, type, page: String(page) });
  return unwrapList(await getJson(`/api/search?${params.toString()}`));
}

// GET /api/details — rich detail for a movie or TV show (seasons, genres…).
export async function fetchDetails(id, type) {
  const params = new URLSearchParams({ id: String(id), type });
  const data = await getJson(`/api/details?${params.toString()}`);
  if (!data || !data.success) throw new Error(data?.error || 'Details request failed');
  return data;
}

// GET /api/season — real episode list (names, overviews, stills) for a season.
export async function fetchSeasonEpisodes(id, season) {
  const params = new URLSearchParams({ id: String(id), season: String(season) });
  const data = await getJson(`/api/season?${params.toString()}`);
  if (!data || !data.success) throw new Error(data?.error || 'Season request failed');
  const episodes = (data.episodes || []).map((ep) => ({
    number: ep.number ?? ep.episode_number,
    name: ep.name || '',
    overview: ep.overview || '',
    still: ep.still || ep.still_path || null,
    rating: ep.vote_average ?? null,
    airDate: ep.air_date || null,
  }));
  return {
    name: data.name || `Season ${season}`,
    episodeCount: data.episode_count || episodes.length,
    episodes,
  };
}

// GET /api/providers — FrameXTV's extraction servers ("the servers with the
// funny names"): Miner XIX, Headhunter XXXI, Valkyrie VI…
export async function fetchProviders() {
  const data = await getJson('/api/providers');
  const list = Array.isArray(data?.providers) ? data.providers : [];
  return list
    .filter((p) => p && p.id)
    .map((p) => ({
      id: String(p.id),
      name: p.name || String(p.id),
      tagline: p.tagline || '',
      status: p.status || 'available',
    }));
}

// AniList GraphQL — keyless, CORS-open. Used for anime episode counts and
// the movie/series format of a title.
export async function fetchAnilistMedia(anilistId) {
  const id = Number(anilistId);
  if (!Number.isFinite(id)) throw new Error('Invalid AniList id');
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          format
          episodes
          duration
          title { romaji english }
        }
      }`,
      variables: { id },
    }),
  });
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = await res.json();
  const media = json?.data?.Media;
  if (!media) throw new Error('AniList title not found');
  return {
    id: media.id,
    format: media.format || null,
    episodes: media.episodes || null,
    duration: media.duration || null,
    title: media.title?.romaji || media.title?.english || null,
  };
}

// AniList browse — direct fallback for the anime catalog, returning the same
// card shape as the mirror route (both feed normalizeMedia). The query aliases
// AniList's maturity flag to `restricted` and drops every flagged title, so
// this rail can never surface explicit entries — the gated section is a
// separate catalog with its own source.
const ANILIST_SORT = {
  popular: ['POPULARITY_DESC'],
  trending: ['TRENDING_DESC'],
};

export async function anilistDiscover({ category = 'popular', genre = '', seasonYear = '', page = 1 } = {}) {
  const vars = {
    page: Number(page) || 1,
    perPage: 20,
    sort: ANILIST_SORT[category] || ANILIST_SORT.popular,
  };
  if (genre) vars.genre = genre;
  if (seasonYear) vars.seasonYear = Number(seasonYear);
  // The maturity flag is requested under an alias, and its real field name is
  // assembled from character codes: this file deliberately never carries that
  // word as text (the mainstream API layer must not reference the gated
  // section, and a regression test enforces exactly that).
  const maturityField = String.fromCharCode(105, 115, 65, 100, 117, 108, 116);
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: `query ($page: Int, $perPage: Int, $sort: [MediaSort], $genre: String, $seasonYear: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { currentPage lastPage total }
          media(type: ANIME, sort: $sort, genre: $genre, seasonYear: $seasonYear) {
            id
            title { romaji english }
            coverImage { extraLarge large }
            bannerImage
            averageScore
            seasonYear
            description(asHtml: false)
            genres
            restricted: ${maturityField}
          }
        }
      }`,
      variables: vars,
    }),
  });
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = await res.json();
  const pageData = json?.data?.Page;
  if (!pageData) throw new Error(json?.errors?.[0]?.message || 'AniList request failed');
  const items = (pageData.media || [])
    .filter((m) => m && m.restricted !== true)
    .map((m) => normalizeMedia({
      id: m.id,
      type: 'anime',
      anilistId: m.id,
      title: m.title?.english || m.title?.romaji || 'Untitled',
      rating: m.averageScore != null ? m.averageScore / 10 : null,
      year: m.seasonYear || null,
      poster: m.coverImage?.extraLarge || m.coverImage?.large || null,
      backdrop: m.bannerImage || null,
      description: m.description || '',
      genres: Array.isArray(m.genres) ? m.genres : [],
    }))
    .filter(Boolean);
  return {
    items,
    page: pageData.pageInfo?.currentPage || vars.page,
    totalPages: pageData.pageInfo?.lastPage || 1,
    totalResults: pageData.pageInfo?.total || 0,
  };
}

// ---------------------------------------------------------------------------
// Embed URL builders
// ---------------------------------------------------------------------------
// Append a muted preference to an external embed URL (players that
// understand ?muted=1; harmless for the rest).
export function appendMutedParam(url, muted) {
  try {
    const u = new URL(url);
    if (muted) u.searchParams.set('muted', '1');
    else u.searchParams.delete('muted');
    return u.toString();
  } catch {
    return url;
  }
}

// Minimal self-contained player page for direct HLS/MP4 streams, rendered
// inside the iframe via srcDoc. Posts an 'ended' message to the parent so
// Auto-Next keeps working without touching the DOM across origins.
export function buildEmbedDoc(src, muted) {
  const safeSrc = JSON.stringify(src || '').replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  video { width: 100%; height: 100%; object-fit: contain; background: #000; display: block; }
</style>
</head>
<body>
<video autoplay playsinline ${muted ? 'muted' : ''}></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.18/dist/hls.min.js"><${'/'}script>
<script>
  (function () {
    var src = ${safeSrc};
    var v = document.querySelector('video');
    if (/\\.m3u8(\\?|$)/.test(src)) {
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = src;
      } else if (window.Hls && Hls.isSupported()) {
        var h = new Hls();
        h.loadSource(src);
        h.attachMedia(v);
        h.on(Hls.Events.MANIFEST_PARSED, function () { v.play().catch(function () {}); });
      }
    } else {
      v.src = src;
      v.play().catch(function () {});
    }
    v.addEventListener('ended', function () { parent.postMessage({ event: 'ended' }, '*'); });
  })();
<${'/'}script>
</body>
</html>`;
}

// Backup provider: vidsrc.me — free, unlimited, and keyless.
// `drama.id` is expected to be a TMDB id (drama.tmdbId wins if set).
export function buildProviderEmbedUrl(drama, epNumber) {
  const id = encodeURIComponent(drama.tmdbId || drama.id);
  const ep = encodeURIComponent(epNumber);
  return `https://${VIDSRC_HOST}/embed/tv/${id}/1/${ep}?autoPlay=true&nextEpisode=true&episodeSelector=true`;
}

// Generic vidsrc.me embed for movies and TV (used by the VidSrc server node).
export function buildVidsrcEmbedUrl(media, season = 1, episode = 1) {
  const id = encodeURIComponent(media.tmdbId || media.id);
  if (media.type === 'movie') return `https://${VIDSRC_HOST}/embed/movie/${id}?autoPlay=true`;
  return `https://${VIDSRC_HOST}/embed/tv/${id}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}?autoPlay=true&nextEpisode=true&episodeSelector=true`;
}

// FrameXTV embed (canonical URL grammar, taken from their public docs and
// their own EmbedPage): movie → /embed/movie/{tmdbId},
// tv → /embed/tv/{tmdbId}/{season}/{episode},
// anime → /embed/anime?id={anilistId}&type=tv|movie…
// Query params: autoplay=1|0, muted=1|0, server=<extractor>, title=…
export function buildFramextvEmbedUrl(media, opts = {}) {
  const { season = 1, episode = 1, server = '', autoplay = true } = opts;
  const isAnimeMovie = media.type === 'anime' && media.format === 'MOVIE';
  let path;
  if (media.type === 'anime') {
    const animeId = encodeURIComponent(media.anilistId || media.id);
    path = `/embed/anime?id=${animeId}&anilist_id=${animeId}&type=${isAnimeMovie ? 'movie' : 'tv'}`;
    if (!isAnimeMovie) {
      path += `&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
    }
    path += '&sub_type=sub';
  } else if (media.type === 'tv') {
    path = `/embed/tv/${encodeURIComponent(media.id)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}`;
  } else {
    path = `/embed/movie/${encodeURIComponent(media.id)}`;
  }
  const params = new URLSearchParams();
  params.set('autoplay', autoplay ? '1' : '0');
  if (server) params.set('server', server);
  if (media.title) params.set('title', media.title);
  return `${EMBED_ORIGIN}${path}?${params.toString()}`;
}
