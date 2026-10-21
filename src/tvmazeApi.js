// ---------------------------------------------------------------------------
// Keyless TV catalog fallback.
//
// The catalog mirrors attach no CORS header to requests from our own domain, so
// browsers refuse their responses before any of our code runs. Anime already
// survives this by reading AniList directly; TV needs a different open source.
//
// TVMaze is keyless, CORS-open, and carries shows, seasons, episodes, search
// hits and posters. Its one gap is that it has no TMDB id — and playback embeds
// are addressed by TMDB id. Its `externals` block does carry an IMDb id, and
// Wikidata (also keyless and CORS-open) maps IMDb -> TMDB series id in bulk.
//
// So the pipeline is: TVMaze (what to show) -> Wikidata (id for playback).
// Nothing here requires a key, an account, or a proxy.
// ---------------------------------------------------------------------------

const TVMAZE = 'https://api.tvmaze.com';
const WIKIDATA = 'https://query.wikidata.org/sparql';

// TVMaze pages are id-ordered, so "popular" is assembled from a handful of
// pages and ranked client-side. Weight is capped at 100 for many shows, so
// rating breaks ties.
const POPULAR_PAGES = [0, 1, 2, 3, 4, 5, 6, 7];

async function tvmazeGet(path) {
  const res = await fetch(`${TVMAZE}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TVMaze HTTP ${res.status}`);
  return res.json();
}

// IMDb id -> TMDB series id, resolved in as few Wikidata round-trips as
// possible (one query per ~150 ids). Unresolvable ids are simply absent from
// the map; callers fall back to the TVMaze id, which still renders and streams
// on providers that accept it.
const TMDB_ID_CACHE = new Map();

async function resolveTmdbIds(imdbIds, property = 'P4983') {
  const wanted = [...new Set(imdbIds.filter(Boolean))].filter((id) => !TMDB_ID_CACHE.has(id));
  if (wanted.length === 0) return TMDB_ID_CACHE;

  const chunks = [];
  for (let i = 0; i < wanted.length; i += 150) chunks.push(wanted.slice(i, i + 150));

  await Promise.all(
    chunks.map(async (chunk) => {
      const values = chunk.map((id) => `"${id}"`).join(' ');
      const query = `SELECT ?imdb ?tmdb WHERE {
        VALUES ?imdb { ${values} }
        ?item wdt:P345 ?imdb ; wdt:${property} ?tmdb .
      }`;
      try {
        const res = await fetch(`${WIKIDATA}?format=json&query=${encodeURIComponent(query)}`, {
          headers: { Accept: 'application/sparql-results+json' },
        });
        if (!res.ok) return;
        const json = await res.json();
        for (const row of json?.results?.bindings || []) {
          const imdb = row?.imdb?.value;
          const tmdb = row?.tmdb?.value;
          if (imdb && tmdb) TMDB_ID_CACHE.set(imdb, tmdb);
        }
      } catch {
        /* a failed id lookup must never break the catalog */
      }
      // Anything unresolved is remembered as a miss so we don't retry it.
      for (const id of chunk) if (!TMDB_ID_CACHE.has(id)) TMDB_ID_CACHE.set(id, null);
    })
  );
  return TMDB_ID_CACHE;
}

// TMDB genre names (as used by MOVIE_GENRES / TV_GENRES in the UI) mapped to
// TVMaze's smaller genre vocabulary, so genre filters behave the same way.
const GENRE_FROM_ID = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Children',
  9648: 'Mystery',
  10763: 'News',
  10764: 'Reality',
  10765: 'Science-Fiction',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War',
  37: 'Western',
};

// TVMaze genres are free-form; this maps them onto the TMDB ids the UI filters
// by, so a card's genres are consistent whichever source produced it.
const GENRE_TO_ID = {
  Action: 10759,
  Adventure: 10759,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Children: 10762,
  Mystery: 9648,
  News: 10763,
  Reality: 10764,
  'Science-Fiction': 10765,
  Fantasy: 10765,
  Soap: 10766,
  Talk: 10767,
  War: 10768,
  Western: 37,
};

function toCard(show, tmdbId) {
  const year = (show.premiered || '').slice(0, 4) || null;
  return {
    id: tmdbId || String(show.id),
    tvmazeId: String(show.id),
    tmdbId: tmdbId || null,
    title: show.name || 'Untitled',
    type: 'tv',
    rating: show.rating?.average ?? null,
    year,
    poster: show.image?.original || show.image?.medium || null,
    backdrop: show.image?.original || null,
    description: (show.summary || '').replace(/<[^>]*>/g, '').trim(),
    genres: Array.isArray(show.genres) ? show.genres : [],
    _weight: show.weight || 0,
    _premiered: show.premiered || '',
    _imdb: show.externals?.imdb || null,
  };
}

// Ranks a TVMaze page set: weight first (capped at 100, so it groups "major"
// shows together), then rating, then most recent.
function rankShows(shows, { category = 'popular' } = {}) {
  const usable = shows.filter((s) => s && s.name && s.image?.medium);
  const scored = usable.map((s) => ({
    s,
    score: (s.weight || 0) * 1000 + (s.rating?.average || 0) * 10 + (s.premiered ? 1 : 0),
  }));
  if (category === 'new_releases') {
    scored.sort((a, b) => (b.s._premiered || '').localeCompare(a.s._premiered || ''));
  } else if (category === 'trending') {
    scored.sort((a, b) => (b.s.weight || 0) - (a.s.weight || 0) || (b.s._premiered || '').localeCompare(a.s._premiered || ''));
  } else {
    scored.sort((a, b) => b.score - a.score);
  }
  return scored.map((x) => x.s);
}

let popularCache = null;

// Builds (and memoizes) the popular-TV pool once per session so the Home rails
// and the TV browse tab don't each re-fetch eight pages.
async function popularPool() {
  if (popularCache) return popularCache;
  const pages = await Promise.all(
    POPULAR_PAGES.map((p) => tvmazeGet(`/shows?page=${p}`).catch(() => []))
  );
  const shows = pages.flat().filter(Boolean);
  if (shows.length === 0) throw new Error('TVMaze returned no shows');
  popularCache = shows;
  return popularCache;
}

// Shared builder: takes TVMaze shows, resolves their TMDB ids, and returns the
// same page envelope every other catalog function returns.
async function cardsFor(shows, { genre = '', year = '', minRating = '', page = 1, perPage = 24 } = {}) {
  await resolveTmdbIds(shows.map((s) => s.externals?.imdb));
  let cards = shows.map((s) => toCard(s, TMDB_ID_CACHE.get(s.externals?.imdb) || null));

  if (genre) {
    const wanted = String(genre);
    cards = cards.filter((c) => c.genres.some((g) => String(g) === wanted || String(GENRE_TO_ID[g] || '') === wanted));
  }
  if (year) cards = cards.filter((c) => c.year === String(year));
  if (minRating) cards = cards.filter((c) => Number(c.rating || 0) >= Number(minRating));

  const start = (Math.max(1, Number(page)) - 1) * perPage;
  return {
    items: cards.slice(start, start + perPage),
    page: Number(page) || 1,
    totalPages: Math.max(1, Math.ceil(cards.length / perPage)),
    totalResults: cards.length,
  };
}

// Popular / trending / new-release TV, ranked client-side from the TVMaze pool.
export async function tvmazeLibrary({ category = 'popular', genre = '', year = '', minRating = '', page = 1 } = {}) {
  const pool = await popularPool();
  return cardsFor(rankShows(pool, { category }), { genre, year, minRating, page });
}

// TV search — TVMaze's own search endpoint.
export async function tvmazeSearch(query, page = 1) {
  const q = String(query || '').trim();
  if (q.length < 2) return { items: [], page: 1, totalPages: 0, totalResults: 0 };
  const hits = await tvmazeGet(`/search/shows?q=${encodeURIComponent(q)}`);
  const shows = (hits || []).map((h) => h?.show).filter(Boolean);
  return cardsFor(shows, { page, perPage: 20 });
}

// A single TVMaze show, hydrated with genres/seasons and its TMDB id.
export async function tvmazeDetails(tvmazeId) {
  const show = await tvmazeGet(`/shows/${encodeURIComponent(tvmazeId)}`);
  if (!show || !show.id) throw new Error('Show not found');
  await resolveTmdbIds([show.externals?.imdb]);
  const card = toCard(show, TMDB_ID_CACHE.get(show.externals?.imdb) || null);
  const episodes = await tvmazeGet(`/shows/${encodeURIComponent(tvmazeId)}/episodes`).catch(() => []);
  const seasons = [];
  for (const ep of episodes) {
    if (ep.season == null) continue;
    let entry = seasons.find((s) => s.season_number === ep.season);
    if (!entry) {
      entry = { season_number: ep.season, name: `Season ${ep.season}`, episode_count: 0 };
      seasons.push(entry);
    }
    entry.episode_count += 1;
  }
  seasons.sort((a, b) => a.season_number - b.season_number);
  return {
    id: card.id,
    tmdbId: card.tmdbId,
    tvmazeId: card.tvmazeId,
    title: card.title,
    type: 'tv',
    year: card.year,
    rating: card.rating,
    poster: card.poster,
    backdrop: card.backdrop,
    overview: card.description,
    description: card.description,
    genres: card.genres.map((g) => ({ name: g, id: GENRE_TO_ID[g] || null })),
    seasons,
  };
}

// Episode list for one season, straight from TVMaze.
export async function tvmazeSeason(tvmazeId, seasonNumber) {
  const episodes = await tvmazeGet(`/shows/${encodeURIComponent(tvmazeId)}/episodes`);
  const wanted = (episodes || []).filter((ep) => String(ep.season) === String(seasonNumber));
  return {
    name: `Season ${seasonNumber}`,
    episodeCount: wanted.length,
    episodes: wanted.map((ep) => ({
      number: ep.number,
      name: ep.name || '',
      overview: (ep.summary || '').replace(/<[^>]*>/g, '').trim(),
      still: ep.image?.original || ep.image?.medium || null,
      rating: ep.rating?.average ?? null,
      airDate: ep.airdate || null,
    })),
  };
}

// A ready-made TV rail for the Home page.
export async function tvmazeRail(category = 'popular', limit = 20) {
  const pool = await popularPool();
  const ranked = rankShows(pool, { category }).slice(0, limit);
  await resolveTmdbIds(ranked.map((s) => s.externals?.imdb));
  return ranked.map((s) => {
    const card = toCard(s, TMDB_ID_CACHE.get(s.externals?.imdb) || null);
    delete card._weight;
    delete card._premiered;
    delete card._imdb;
    return card;
  });
}

export { GENRE_FROM_ID, GENRE_TO_ID };
