// ---------------------------------------------------------------------------
// Movies catalog fallback, backed by TMDB.
//
// The catalog mirrors attach no CORS header to requests from our own domain, so
// browsers refuse their responses before any of our code runs. TV already has a
// keyless path (TVMaze + Wikidata) and anime has AniList, but movies are a
// harder case: playback embeds are addressed by TMDB id, posters live on TMDB's
// image CDN behind a hash only TMDB's API returns, and no keyless source carries
// either. So movies use TMDB directly with a free API key.
//
// The key is read from VITE_TMDB_KEY at build time. It therefore ships inside
// the built JavaScript, exactly as it does on any TMDB-backed front end
// (framextv.xyz included) — TMDB's own design cannot hide a browser key.
// Without a key every function below simply throws, and the caller falls back
// to reporting the outage as before.
// ---------------------------------------------------------------------------

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const KEY = (import.meta.env?.VITE_TMDB_KEY || '').trim();

export function hasTmdbKey() {
  return KEY.length > 0;
}

async function tmdbGet(path, params = {}) {
  if (!KEY) throw new Error('Movies need a TMDB key');
  const url = new URL(`${API}${path}`);
  url.searchParams.set('api_key', KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== null && v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return res.json();
}

const poster = (p) => (p ? `${IMG}/w500${p}` : null);
const backdrop = (p) => (p ? `${IMG}/w1280${p}` : null);

// TMDB genre ids are the same ids the UI's MOVIE_GENRES list already uses, so
// cards carry their genre ids through for client-side filtering.
function toCard(movie) {
  if (!movie || movie.id === undefined) return null;
  return {
    id: String(movie.id),
    tmdbId: String(movie.id),
    title: movie.title || movie.name || 'Untitled',
    type: 'movie',
    rating: movie.vote_average ?? null,
    year: (movie.release_date || '').slice(0, 4) || null,
    poster: poster(movie.poster_path),
    backdrop: backdrop(movie.backdrop_path),
    description: movie.overview || '',
    genres: [],
    _genreIds: Array.isArray(movie.genre_ids) ? movie.genre_ids.map(String) : [],
    _popularity: movie.popularity || 0,
  };
}

function envelope(movies, { page = 1, perPage = 24, category = 'popular' } = {}) {
  let cards = movies.map(toCard).filter(Boolean);
  if (category === 'popular' || category === 'trending') {
    cards = cards.slice().sort((a, b) => b._popularity - a._popularity);
  } else if (category === 'new_releases') {
    cards = cards.slice().sort((a, b) => String(b.year || '').localeCompare(String(a.year || '')));
  }
  return {
    items: cards.slice(0, perPage),
    page: Number(page) || 1,
    totalPages: 1,
    totalResults: cards.length,
  };
}

// Category -> TMDB endpoint (mirrors what the mirror's own routes use).
const CATEGORY_PATH = {
  trending: '/trending/movie/week',
  popular: '/movie/popular',
  new_releases: '/movie/now_playing',
};

// Movies browser: category + genre + year + rating, mirroring the mirror's
// /api/movies grammar (genre ids, min_rating) so the UI filters behave alike.
export async function tmdbLibrary({ category = 'popular', genre = '', year = '', minRating = '', page = 1 } = {}) {
  const params = { page: String(page) };
  if (year) params.primary_release_year = String(year);
  if (minRating) params['vote_average.gte'] = String(minRating);

  let data;
  if (genre) {
    // discover honours genre filters; trending/popular endpoints do not.
    params.with_genres = String(genre);
    params.sort_by = 'popularity.desc';
    data = await tmdbGet('/discover/movie', params);
  } else {
    data = await tmdbGet(CATEGORY_PATH[category] || CATEGORY_PATH.popular, params);
  }
  const movies = data.results || [];
  const result = envelope(movies, { page, category: genre ? 'popular' : category });
  result.totalPages = Math.max(1, Math.min(data.total_pages || 1, 500));
  result.totalResults = data.total_results ?? result.items.length;
  return result;
}

// Movie search.
export async function tmdbSearch(query, page = 1) {
  const q = String(query || '').trim();
  if (q.length < 2) return { items: [], page: 1, totalPages: 0, totalResults: 0 };
  const data = await tmdbGet('/search/movie', { query: q, page: String(page) });
  const result = envelope(data.results || [], { page, category: 'popular' });
  result.totalPages = Math.max(1, Math.min(data.total_pages || 1, 500));
  result.totalResults = data.total_results ?? result.items.length;
  return result;
}

// Full movie detail — runtime, genres, tagline and the rest.
export async function tmdbDetails(id) {
  const movie = await tmdbGet(`/movie/${encodeURIComponent(id)}`);
  if (!movie || !movie.id) throw new Error('Movie not found');
  return {
    id: String(movie.id),
    tmdbId: String(movie.id),
    title: movie.title || movie.name || 'Untitled',
    type: 'movie',
    year: (movie.release_date || '').slice(0, 4) || null,
    rating: movie.vote_average ?? null,
    runtime: movie.runtime || null,
    poster: poster(movie.poster_path),
    backdrop: backdrop(movie.backdrop_path),
    overview: movie.overview || '',
    description: movie.overview || '',
    genres: (movie.genres || []).map((g) => ({ name: g.name, id: String(g.id) })),
  };
}

// A ready-made movie rail for the Home page. `kind` matches the rail names the
// UI renders: trending / popular / new_releases.
export async function tmdbRail(kind = 'popular', limit = 20) {
  const path = CATEGORY_PATH[kind] || CATEGORY_PATH.popular;
  const data = await tmdbGet(path);
  const cards = (data.results || []).map(toCard).filter(Boolean);
  return cards.slice(0, limit).map((c) => {
    const { _genreIds, _popularity, ...card } = c;
    return { ...card, genres: _genreIds };
  });
}
