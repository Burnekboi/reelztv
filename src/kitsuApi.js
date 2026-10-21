// ---------------------------------------------------------------------------
// Anime catalog fallback, backed by Kitsu.
//
// The anime routes on the catalog mirrors attach no CORS header to requests from
// our own domain, so browsers refuse their responses before any of our code
// runs. AniList normally covers that gap, but AniList periodically disables its
// API outright ("temporarily disabled due to severe stability issues", HTTP
// 403), which takes the Anime tab down with it. Kitsu is a second, independent
// anime catalog that stays up — so anime reads from it when both the mirror and
// AniList are unavailable.
//
// Playback embeds are addressed by AniList id, and Kitsu knows each title's
// AniList id, so ids are carried through rather than substituted. Requesting
// `include=mappings` returns those ids inline with the list itself, so a page of
// anime costs one request instead of one per card.
//
// Kitsu speaks JSON:API and requires the matching Accept header; with a plain
// `application/json` Accept it answers 406, which is why the header is set
// explicitly on every call below.
// ---------------------------------------------------------------------------

const API = 'https://kitsu.io/api/edge';
const ACCEPT = 'application/vnd.api+json';

async function kitsuGet(pathname) {
  const res = await fetch(`${API}/${pathname}`, { headers: { Accept: ACCEPT } });
  if (!res.ok) throw new Error(`Kitsu HTTP ${res.status}`);
  return res.json();
}

// Kitsu's browse sorts, mapped from the categories the Anime tab offers.
const SORTS = {
  popular: '-userCount',
  trending: '-userCount',
  rating: '-averageRating',
  new_releases: '-startDate',
};

// A cross-reference service (keyless, CORS-open) resolves an AniList id to the
// Kitsu id for the same title. Requests are memoised because a detail modal
// resolves the same title repeatedly as it re-renders.
const CROSSREF = 'https://arm.haglund.dev/api/v2/ids';
const KITSU_ID_CACHE = new Map();

async function kitsuIdForAnilist(anilistId) {
  const key = String(anilistId);
  if (KITSU_ID_CACHE.has(key)) return KITSU_ID_CACHE.get(key);
  const res = await fetch(`${CROSSREF}?source=anilist&id=${encodeURIComponent(key)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CrossRef HTTP ${res.status}`);
  const data = await res.json();
  const id = data?.kitsu ? String(data.kitsu) : null;
  if (id) KITSU_ID_CACHE.set(key, id);
  return id;
}

// Episode count, runtime and format for one title, in the shape the AniList
// lookup returns so callers can stay unaware of which source answered.
export async function kitsuMedia(anilistId) {
  const kitsuId = await kitsuIdForAnilist(anilistId);
  if (!kitsuId) throw new Error('No matching title');
  const data = await kitsuGet(`anime/${kitsuId}`);
  const a = data?.data?.attributes;
  if (!a) throw new Error('Title not found');
  return {
    id: Number(anilistId),
    format: a.subtype === 'movie' ? 'MOVIE' : 'TV',
    episodes: a.episodeCount || null,
    duration: a.episodeLength || null,
    title: a.canonicalTitle || a.titles?.en || a.titles?.en_jp || null,
  };
}

// The UI filters anime by genre NAME (Action, Romance, …), which is also how the
// mirror receives them, so the name is passed through as Kitsu's category filter.
async function browseParams({ category, genre, seasonYear, page }) {
  const params = new URLSearchParams({
    'page[limit]': '20',
    'page[offset]': String(((Number(page) || 1) - 1) * 20),
    sort: SORTS[category] || SORTS.popular,
    include: 'mappings',
  });
  if (genre) params.set('filter[categories]', genre);
  if (seasonYear) {
    // Kitsu has no season concept; a year window is the closest equivalent.
    params.set('filter[seasonYear]', String(seasonYear));
  }
  return params;
}

// Pull the AniList id out of the `mappings` that arrived alongside the list.
function anilistIdFor(anime, included) {
  const rel = anime.relationships?.mappings?.data || [];
  for (const ref of rel) {
    const found = (included || []).find((i) => i.type === ref.type && i.id === ref.id);
    if (found?.attributes?.externalSite === 'anilist/anime') return found.attributes.externalId;
  }
  return null;
}

function toCard(anime, included) {
  const a = anime?.attributes;
  if (!a) return null;
  const anilistId = anilistIdFor(anime, included);
  const poster = a.posterImage?.large || a.posterImage?.medium || a.posterImage?.original || null;
  const backdrop = a.coverImage?.large || a.coverImage?.original || null;
  const rating = a.averageRating != null ? Number(a.averageRating) / 10 : null;
  return {
    // AniList id when we have it, so the embed and the id the rest of the UI
    // stores stay in the same space as the other anime sources.
    id: anilistId ? String(anilistId) : String(anime.id),
    anilistId: anilistId ? String(anilistId) : null,
    kitsuId: String(anime.id),
    type: 'anime',
    title: a.canonicalTitle || a.titles?.en || a.titles?.en_jp || 'Untitled',
    rating,
    year: (a.startDate || '').slice(0, 4) || null,
    poster,
    backdrop: backdrop || poster,
    description: a.synopsis || a.description || '',
    genres: [],
    format: a.subtype === 'movie' ? 'MOVIE' : 'TV',
  };
}

// Anime browser: category + genre + year, returning the same envelope the mirror
// route and the AniList path already produce.
export async function kitsuDiscover({ category = 'popular', genre = '', seasonYear = '', page = 1 } = {}) {
  const params = await browseParams({ category, genre, seasonYear, page });
  let data;
  try {
    data = await kitsuGet(`anime?${params.toString()}`);
  } catch (err) {
    // A year filter Kitsu cannot satisfy yields no rows; retry without it rather
    // than showing an empty Anime tab.
    if (seasonYear) {
      const retry = await browseParams({ category, genre, seasonYear: '', page });
      data = await kitsuGet(`anime?${retry.toString()}`);
    } else {
      throw err;
    }
  }
  const items = (data.data || []).map((a) => toCard(a, data.included)).filter(Boolean);
  const total = data.meta?.count ?? items.length;
  return {
    items,
    page: Number(page) || 1,
    totalPages: Math.max(1, Math.ceil(total / 20)),
    totalResults: total,
  };
}

// Anime search.
export async function kitsuSearch(query, page = 1) {
  const q = String(query || '').trim();
  if (q.length < 2) return { items: [], page: 1, totalPages: 0, totalResults: 0 };
  const params = new URLSearchParams({
    'filter[text]': q,
    'page[limit]': '20',
    'page[offset]': String(((Number(page) || 1) - 1) * 20),
    include: 'mappings',
  });
  const data = await kitsuGet(`anime?${params.toString()}`);
  const items = (data.data || []).map((a) => toCard(a, data.included)).filter(Boolean);
  const total = data.meta?.count ?? items.length;
  return {
    items,
    page: Number(page) || 1,
    totalPages: Math.max(1, Math.ceil(total / 20)),
    totalResults: total,
  };
}
