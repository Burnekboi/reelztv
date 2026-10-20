import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play, Search, Film, Clock, Bookmark,
  X, Zap, ChevronRight, ChevronLeft,
  ChevronUp, ChevronDown, ListVideo,
  Volume2, VolumeX, Server, Heart, ShieldAlert
} from 'lucide-react';
import {
  fetchHome, fetchAnimeDiscover, fetchLibrary, searchMedia,
  fetchDetails, fetchSeasonEpisodes, fetchAnilistMedia,
  appendMutedParam, buildVidsrcEmbedUrl, buildFramextvEmbedUrl
} from './framextvApi';
import { markUnavailable, markAvailable, useIsUnavailable } from './availability';
import { PROVIDER_SECOND, PROVIDER_THIRD, EVENTS } from './codes';
import DonationModal from './DonationModal';
import { shouldShowDonation, rememberDonationSeen } from './donation';
import TelegramGate from './TelegramGateModal';
import { TELEGRAM_INVITE, isTelegramUnlocked, rememberTelegramUnlock } from './telegramGate';
import AdultGateModal from './AdultGateModal';
import AdultPlayerModal from './AdultPlayerModal';
import {
  isAgeVerified,
  rememberAgeVerified,
  forgetAgeVerified,
  loadAdultVideos,
  fetchAdultVideos,
  ADULT_VIDEOS,
  normaliseAdultList,
} from './adult';

// Cross-origin embed players (vidsrc / FrameXTV) run ad code we can't see or
// delete — their DOM is off-limits. What we *can* control is the capabilities
// of the iframe itself, so the sandbox below deliberately leaves out:
//   allow-popups        → window.open(), target=_blank tab ads
//   allow-top-navigation → hijacking the whole ReelzTV tab to an ad site
// Everything a real player needs is present: its own scripts, its own cookies
// / localStorage (DRM, resume position), forms, and casting.
//
// Coco I (vidsrc) is the exception: it actively refuses to play inside a
// sandboxed frame ("This content can't be embedded in a sandboxed frame"), so
// it renders without the attribute — which also means its popup ads can't be
// blocked from here. Don't "fix" that by sandboxing it again.
const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-presentation';

// Site logo — the ReelzTV "RZ" icon (public/RZicon.png).
const ReelzLogo = ({ className = 'w-11 h-11' }) => (
  <img
    src="/RZicon.png"
    alt="ReelzTV"
    className={`${className} object-contain select-none`}
    draggable="false"
  />
);

// Branded loader used by every loading state — the RZ icon with a pulsing
// glow and a spinning ring around it.
function LogoLoader({ label = 'Loading…', className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full bg-rose-500/30 blur-lg rz-glow" />
        <div className="absolute inset-0 rounded-full border-2 border-rose-500/25 border-t-rose-500 animate-spin" />
        <img
          src="/RZicon.png"
          alt=""
          aria-hidden="true"
          draggable="false"
          className="absolute inset-[5px] w-[calc(100%-10px)] h-[calc(100%-10px)] object-contain rounded-xl rz-pulse"
        />
      </div>
      {label ? <p className="text-xs font-semibold text-slate-400">{label}</p> : null}
    </div>
  );
}

// Poster/backdrop with a branded fallback: when a title has no artwork at all,
// or the image URL 404s, the site icon is shown instead of an empty grey box.
function MediaImage({ src, alt = '', className = '', fallbackIconClass = 'w-12 h-12' }) {
  // Remember *which* src failed rather than a boolean, so a new media item
  // (new src) automatically clears the fallback without an effect.
  const [failedSrc, setFailedSrc] = useState(null);
  const broken = !src || failedSrc === src;

  if (broken) {
    return (
      <div className={`${className} flex items-center justify-center bg-slate-950`}>
        <img
          src="/RZicon.png"
          alt=""
          aria-hidden="true"
          draggable="false"
          className={`${fallbackIconClass} object-contain opacity-90 select-none`}
        />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      draggable="false"
      onError={() => setFailedSrc(src)}
      className={className}
    />
  );
}

// --------------------------------------------------------------------
// Catalog config — movies, TV series & anime (16:9 everywhere).
// Playback runs through the site's own Coco servers:
//   Coco I  — default, vidsrc backend
//   Coco II — FrameXTV extractor (valkyrie)
//   Coco III— FrameXTV extractor (super_barbarian)
// --------------------------------------------------------------------
const MAIN_TABS = [
  { id: 'home', label: 'Home' },
  { id: 'movies', label: 'Movies' },
  { id: 'tv', label: 'TV' },
  { id: 'anime', label: 'Anime' },
  // Age-gated, isolated from search and from every mainstream rail.
  { id: 'adult', label: 'Adult' }
];

const BROWSE_CATEGORIES = {
  movies: [
    { id: 'trending', label: 'Trending' },
    { id: 'popular', label: 'Popular' },
    { id: 'new_releases', label: 'New Releases' }
  ],
  tv: [
    { id: 'trending', label: 'Trending' },
    { id: 'popular', label: 'Popular' },
    { id: 'new_releases', label: 'New Releases' }
  ],
  anime: [
    { id: 'popular', label: 'Popular' },
    { id: 'trending', label: 'Trending' }
  ]
};

// Movie/TV genre values are TMDB genre ids — /api/movies & /api/tv filter
// server-side with them. Anime values are AniList genre names.
const MOVIE_GENRES = [
  { value: '28', label: 'Action' }, { value: '12', label: 'Adventure' },
  { value: '16', label: 'Animation' }, { value: '35', label: 'Comedy' },
  { value: '80', label: 'Crime' }, { value: '99', label: 'Documentary' },
  { value: '18', label: 'Drama' }, { value: '10751', label: 'Family' },
  { value: '14', label: 'Fantasy' }, { value: '27', label: 'Horror' },
  { value: '9648', label: 'Mystery' }, { value: '10749', label: 'Romance' },
  { value: '878', label: 'Sci-Fi' }, { value: '53', label: 'Thriller' },
  { value: '10752', label: 'War' }, { value: '37', label: 'Western' }
];

const TV_GENRES = [
  { value: '10759', label: 'Action & Adventure' }, { value: '16', label: 'Animation' },
  { value: '35', label: 'Comedy' }, { value: '80', label: 'Crime' },
  { value: '99', label: 'Documentary' }, { value: '18', label: 'Drama' },
  { value: '10751', label: 'Family' }, { value: '10762', label: 'Kids' },
  { value: '9648', label: 'Mystery' }, { value: '10764', label: 'Reality' },
  { value: '10765', label: 'Sci-Fi & Fantasy' }, { value: '10768', label: 'War & Politics' }
];

// Anime genres are filtered server-side by exact AniList genre name.
const ANIME_GENRES = [
  { value: 'Action', label: 'Action' }, { value: 'Adventure', label: 'Adventure' },
  { value: 'Comedy', label: 'Comedy' }, { value: 'Drama', label: 'Drama' },
  { value: 'Fantasy', label: 'Fantasy' }, { value: 'Horror', label: 'Horror' },
  { value: 'Mystery', label: 'Mystery' }, { value: 'Psychological', label: 'Psychological' },
  { value: 'Romance', label: 'Romance' }, { value: 'Sci-Fi', label: 'Sci-Fi' },
  { value: 'Slice of Life', label: 'Slice of Life' }, { value: 'Sports', label: 'Sports' },
  { value: 'Supernatural', label: 'Supernatural' }, { value: 'Thriller', label: 'Thriller' }
];

const GENRES_BY_TAB = { movies: MOVIE_GENRES, tv: TV_GENRES, anime: ANIME_GENRES };

// The three Coco servers. `id` is what the player keeps in its session;
// `provider` is the real extractor id sent to the FrameXTV embed (?server=).
// Coco I (default for movies) is the plain vidsrc embed — no extractor id
// needed; Coco II is the default for series and anime.
const SERVERS = [
  { id: 'coco1', name: 'Coco I', tagline: 'HD Server' },
  // adFree: the sandbox on these embeds removes window.open / target=_blank, so
  // they can't throw popup ads. Coco I keeps popups because vidsrc refuses to
  // play inside a sandboxed frame at all.
  { id: 'coco2', name: 'Coco II', tagline: '4K Ultra Server', provider: PROVIDER_SECOND, adFree: true },
  { id: 'coco3', name: 'Coco III', tagline: 'Fast HLS Server', provider: PROVIDER_THIRD, adFree: true }
];
const DEFAULT_SERVER_ID = 'coco1';
// Movies open on Coco I (vidsrc). Series and anime open on Coco II (FrameXTV
// extractor) because vidsrc's TV/anime episode coverage is far less reliable.
const SERIES_DEFAULT_SERVER_ID = 'coco2';
const defaultServerFor = (media) =>
  media?.type === 'movie' ? DEFAULT_SERVER_ID : SERIES_DEFAULT_SERVER_ID;

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 15 }, (_, i) => String(CURRENT_YEAR - i));
const RATING_OPTIONS = [
  { value: '', label: 'Any Rating' },
  { value: '6', label: '6+ Rating' },
  { value: '7', label: '7+ Rating' },
  { value: '8', label: '8+ Rating' },
  { value: '9', label: '9+ Rating' }
];

const FILTER_SELECT_CLS =
  'bg-slate-900 border border-slate-800 rounded-lg text-xs px-3 py-1.5 text-slate-300 cursor-pointer hover:bg-slate-800 focus:outline-none focus:border-rose-500 transition';

const typeLabel = (type) =>
  type === 'movie' ? 'Movie'
    : type === 'anime' ? 'Anime'
      : type === 'adult' ? 'Adult'
        : 'TV Series';

const makeEpisodes = (count) =>
  Array.from(
    { length: Math.max(0, Math.min(Number(count) || 0, 500)) },
    (_, i) => ({ number: i + 1, name: `Episode ${i + 1}`, overview: '', still: null })
  );

const resumeLabel = (h) => (h.season ? `S${h.season} E${h.lastEpisode}` : `Ep ${h.lastEpisode}`);

// Category = ordering: Trending shows top-rated first, New Releases shows the
// newest first, Popular keeps the API's popularity order. Used on every tab
// (when a genre is active the API can't also sort, so we do it here).
const orderByCategory = (items, category) => {
  if (category === 'popular') return items;
  const byRating = category === 'trending';
  return [...items].sort((a, b) =>
    byRating
      ? (Number(b.rating) || 0) - (Number(a.rating) || 0)
      : (Number(b.year) || 0) - (Number(a.year) || 0)
  );
};

// --------------------------------------------------------------------
// Small shared UI pieces
// --------------------------------------------------------------------
function MediaCard({ media, onOpen, saved, onToggleSave }) {
  const image = media.backdrop || media.poster;
  const unavailable = useIsUnavailable(media);
  return (
    <div
      onClick={() => onOpen(media)}
      className="group relative bg-slate-900/60 rounded-xl overflow-hidden border border-slate-800/80 hover:border-rose-500/50 transition-all cursor-pointer hover:-translate-y-0.5 hover:shadow-xl hover:shadow-rose-500/10"
    >
      <div className="relative aspect-video bg-slate-800 overflow-hidden">
        <MediaImage
          src={image}
          alt={media.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          fallbackIconClass="w-12 h-12"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent" />

        {onToggleSave && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave(media);
            }}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-slate-200 flex items-center justify-center backdrop-blur-md hover:text-rose-400 transition"
            title="Save to My List"
          >
            <Bookmark className={`w-3.5 h-3.5 ${saved ? 'fill-rose-500 text-rose-500' : ''}`} />
          </button>
        )}

        <span className="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-slate-200 text-[10px] font-semibold px-2 py-0.5 rounded-md border border-slate-700/70">
          {media.year ? `${media.year} · ` : ''}{typeLabel(media.type)}
        </span>

        {/* Bundled placeholders in the Adult section are labelled so they are
            never mistaken for real titles. */}
        {media.demo && (
          <span className="absolute bottom-2 right-2 bg-slate-950/85 backdrop-blur-md text-amber-300 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-md border border-amber-400/40">
            DEMO
          </span>
        )}

        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
          <div className="w-12 h-12 rounded-full bg-rose-500 flex items-center justify-center shadow-lg text-white">
            <Play className="w-6 h-6 fill-current ml-0.5" />
          </div>
        </div>

        {unavailable && (
          <span className="absolute bottom-2 left-2 z-10 bg-rose-600/95 text-white text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-md border border-rose-300/30 shadow-lg">
            Not Available
          </span>
        )}
      </div>

      <div className="p-2.5">
        <h3 className="font-semibold text-sm text-slate-100 line-clamp-1 group-hover:text-rose-400 transition-colors">
          {media.title}
        </h3>
      </div>
    </div>
  );
}

function MediaGrid({ items, onOpen, bookmarks, savedMedia, onToggleSave, emptyMessage }) {
  if (items.length === 0) {
    return (
      <div className="py-16 text-center text-slate-500">
        <p className="text-base">{emptyMessage || 'Nothing here yet.'}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map((m) => (
        <MediaCard
          key={`${m.type}-${m.id}`}
          media={savedMedia?.[m.id] || m}
          onOpen={onOpen}
          saved={bookmarks.includes(m.id)}
          onToggleSave={onToggleSave}
        />
      ))}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl overflow-hidden border border-slate-800/80 bg-slate-900/40 animate-pulse">
      <div className="aspect-video bg-slate-800/80" />
      <div className="p-2.5 space-y-2">
        <div className="h-3.5 bg-slate-800 rounded w-3/4" />
        <div className="h-3 bg-slate-800/70 rounded w-1/3" />
      </div>
    </div>
  );
}

function GridSkeleton({ count = 8 }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

function RailSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden pb-2">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="w-60 sm:w-64 shrink-0">
          <CardSkeleton />
        </div>
      ))}
    </div>
  );
}

function Rail({ title, items, onOpen, bookmarks, savedMedia, onToggleSave }) {
  const scrollerRef = useRef(null);
  if (!items || items.length === 0) return null;
  const scrollBy = (dir) => scrollerRef.current?.scrollBy({ left: dir * 520, behavior: 'smooth' });
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
          <Film className="w-4 h-4 text-rose-500 shrink-0" />
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => scrollBy(-1)}
            className="w-7 h-7 rounded-full bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition"
            aria-label={`Scroll ${title} left`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scrollBy(1)}
            className="w-7 h-7 rounded-full bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition"
            aria-label={`Scroll ${title} right`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div ref={scrollerRef} className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
        {items.map((m) => (
          <div key={`${m.type}-${m.id}`} className="w-60 sm:w-64 shrink-0">
            <MediaCard
              media={savedMedia?.[m.id] || m}
              onOpen={onOpen}
              saved={bookmarks.includes(m.id)}
              onToggleSave={onToggleSave}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function ErrorPanel({ message, onRetry }) {
  return (
    <div className="py-14 text-center">
      <p className="text-slate-400 text-sm mb-4">{message || 'Could not reach the catalog.'}</p>
      <button
        onClick={onRetry}
        className="px-5 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold shadow-lg shadow-rose-500/20 transition"
      >
        Try Again
      </button>
    </div>
  );
}

// --------------------------------------------------------------------
// App — Home / Movies / TV / Anime dashboard (16:9, keyless embeds)
// --------------------------------------------------------------------
export default function App() {
  const [tab, setTab] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Home catalog
  const [homeData, setHomeData] = useState(null);
  const [homeStatus, setHomeStatus] = useState('loading'); // loading | ready | error

  // Browse tabs (movies / tv / anime)
  const [category, setCategory] = useState('trending');
  // Filter bar: genre, year, minimum rating. Movie/TV genres are TMDB ids
  // filtered server-side by /api/movies & /api/tv; anime passes a genre name
  // and seasonYear to the AniList route.
  const [filters, setFilters] = useState({ genre: '', year: '', minRating: '' });
  const [browsePage, setBrowsePage] = useState(1);
  const [browse, setBrowse] = useState({ items: [], totalPages: 1 });
  const [browseStatus, setBrowseStatus] = useState('idle'); // idle | loading | ready | error

  // Global search
  const [search, setSearch] = useState({ items: [], status: 'idle', totalResults: 0 });

  // Detail modal
  const [detailState, setDetailState] = useState(null);
  // Donation modal — opens on the first visit, then weekly; reopenable from the footer.
  const [donationOpen, setDonationOpen] = useState(() => shouldShowDonation());
  const closeDonation = () => {
    setDonationOpen(false);
    rememberDonationSeen();
  };

  // Telegram soft gate — playback only starts once the visitor has been through
  // the "join our Telegram" screen (remembered per device for 24h). `pendingPlay`
  // holds the action we were about to run so we can resume it after unlocking.
  const [gateOpen, setGateOpen] = useState(false);
  const pendingPlay = useRef(null);  const closeGate = () => {
    pendingPlay.current = null;
    setGateOpen(false);
  };
  const passGate = () => {
    rememberTelegramUnlock();
    setGateOpen(false);
    const next = pendingPlay.current;
    pendingPlay.current = null;
    if (next) next();
  };
  // Run a playback action, or park it behind the gate first.
  const withTelegramGate = (action) => {
    if (isTelegramUnlocked()) {
      action();
      return;
    }
    pendingPlay.current = action;
    setGateOpen(true);
  };
  // Adult section — fully isolated: age-gated before the tab opens, never sent
  // to the search API, never in Home rails, never in My List / Watch History.
  const [adultVerified, setAdultVerified] = useState(() => isAgeVerified());
  const [adultGateOpen, setAdultGateOpen] = useState(false);
  const [adultCatalog, setAdultCatalog] = useState({
    status: 'idle',
    items: [],
    message: '',
    page: 1,
    totalCount: 0,
    totalPages: 1,
    hasMore: false,
  });
  const [adultPlaying, setAdultPlaying] = useState(null);
  // The Adult section's own search box. Deliberately separate from the header
  // search: adult titles must never appear in global search results.
  const [adultQuery, setAdultQuery] = useState('');
  const [adultSearch, setAdultSearch] = useState({
    status: 'idle',
    query: '',
    items: [],
    message: '',
    local: false,
    page: 1,
    totalCount: 0,
    totalPages: 1,
    hasMore: false,
  });
  const [adultLoadingMore, setAdultLoadingMore] = useState(false);
  const [adultMoreError, setAdultMoreError] = useState('');
  // Keeps the latest loaded titles readable from the search effect without
  // re-running it (and re-fetching) on every catalog update.
  const adultItemsRef = useRef([]);

  const loadAdult = () => {
    setAdultCatalog({
      status: 'loading',
      items: [],
      message: '',
      page: 1,
      totalCount: 0,
      totalPages: 1,
      hasMore: false,
    });
    loadAdultVideos()
      .then((result) => {
        // Belt and braces: adult.js already prefers the feed and falls back to
        // ADULT_VIDEOS, but if the catalog still comes back empty (a feed path
        // that resolves to nothing, or a future change upstream) render the
        // bundled list here rather than an empty section.
        const items = result.items.length ? result.items : normaliseAdultList(ADULT_VIDEOS);
        const paging = {
          page: result.page || 1,
          totalCount: result.totalCount || items.length,
          totalPages: result.totalPages || 1,
          // Only the live catalog has anything left to append.
          hasMore: Boolean(result.hasMore) && items.length > 0,
        };

        if (result.error && items.length === 0) {
          setAdultCatalog({ status: 'error', items: [], message: result.error, ...paging, hasMore: false });
        } else {
          setAdultCatalog({ status: 'ready', items, message: '', ...paging });
        }
      })
      .catch(() =>
        setAdultCatalog({
          status: 'ready',
          items: normaliseAdultList(ADULT_VIDEOS),
          message: '',
          page: 1,
          totalCount: 0,
          totalPages: 1,
          hasMore: false,
        })
      );
  };

  // The section's own search: queries the live catalog directly, never the
  // site's search API (adult titles stay out of global search entirely), and
  // debounced so typing doesn't fire a request per keystroke. If the live
  // source is unreachable — adblocker, offline — it falls back to filtering the
  // titles already on screen instead of dead-ending.
  useEffect(() => {
    const term = adultQuery.trim();
    if (!term) {
      setAdultSearch({ status: 'idle', query: '', items: [], message: '', local: false, page: 1, totalCount: 0, totalPages: 1, hasMore: false });
      return undefined;
    }

    let alive = true;
    const timer = setTimeout(async () => {
      setAdultSearch({ status: 'loading', query: term, items: [], message: '', local: false, page: 1, totalCount: 0, totalPages: 1, hasMore: false });

      const res = await fetchAdultVideos({ query: term, page: 1 });
      if (!alive) return;

      // The endpoint answered but has nothing for this term — a real
      // "no matches", not an outage.
      if (res.reached && !res.error) {
        setAdultSearch({
          status: 'ready',
          query: term,
          items: res.items,
          message: '',
          local: false,
          page: res.page || 1,
          totalCount: res.totalCount || res.items.length,
          totalPages: res.totalPages || 1,
          hasMore: Boolean(res.hasMore),
        });
        return;
      }

      if (res.reached) {
        setAdultSearch({
          status: 'ready',
          query: term,
          items: [],
          message: '',
          local: false,
          page: 1,
          totalCount: 0,
          totalPages: 1,
          hasMore: false,
        });
        return;
      }

      const matches = (adultItemsRef.current || []).filter((i) =>
        String(i.title || '').toLowerCase().includes(term.toLowerCase())
      );
      setAdultSearch({
        status: 'ready',
        query: term,
        items: matches,
        message: 'The live search is unavailable right now, so these are matches from the list already loaded.',
        local: true,
        page: 1,
        totalCount: matches.length,
        totalPages: 1,
        hasMore: false,
      });
    }, 350);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [adultQuery, tab]);

  // "Load more" — appends the next page to whichever list is on screen, with a
  // de-dupe so a shifting feed can never show the same title twice.
  const loadMoreAdult = () => {
    if (adultLoadingMore) return;
    const searching = adultQuery.trim().length > 0;
    const term = adultQuery.trim();
    const base = searching ? adultSearch : adultCatalog;
    const nextPage = (base.page || 1) + 1;

    setAdultLoadingMore(true);
    setAdultMoreError('');

    fetchAdultVideos(searching ? { page: nextPage, query: term } : { page: nextPage })
      .then((res) => {
        if (res.error || res.items.length === 0) {
          if (res.error) setAdultMoreError(res.error);
          // Nothing left (or unreachable) — stop offering the button.
          if (searching) setAdultSearch((s) => ({ ...s, hasMore: false }));
          else setAdultCatalog((c) => ({ ...c, hasMore: false }));
          return;
        }

        const seen = new Set(base.items.map((i) => i.id));
        const merged = [...base.items, ...res.items.filter((i) => !seen.has(i.id))];
        if (searching) {
          setAdultSearch((s) => ({
            ...s,
            items: merged,
            page: res.page,
            totalCount: res.totalCount || merged.length,
            totalPages: res.totalPages,
            hasMore: res.hasMore,
          }));
        } else {
          setAdultCatalog((c) => ({ ...c, items: merged, page: res.page, totalPages: res.totalPages, hasMore: res.hasMore }));
        }
      })
      .catch(() => setAdultMoreError('Could not load more videos.'))
      .finally(() => setAdultLoadingMore(false));
  };

  // Lazily fetch the adult catalog the first time the tab opens (and re-fetch
  // after an error / manual retry). Never runs for any other tab.
  useEffect(() => {
    if (tab !== 'adult' || !adultVerified) return;
    if (adultCatalog.status === 'idle') loadAdult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, adultVerified, adultCatalog.status]);

  const openAdult = (item) => setAdultPlaying(item);

  // Defensive: the render must never choke on a malformed catalog, and the
  // grid is only drawn when there is actually something to show.
  const adultItems = Array.isArray(adultCatalog.items) ? adultCatalog.items : [];
  adultItemsRef.current = adultItems;

  // What the grid shows: search results while a term is typed, otherwise the
  // loaded catalog. Paging state follows whichever of the two is on screen.
  const adultTerm = adultQuery.trim();
  const adultSearching = adultTerm.length > 0;
  const adultShown = adultSearching ? adultSearch.items : adultItems;
  const adultPageState = adultSearching ? adultSearch : adultCatalog;

  const detailToken = useRef(0);
  const detailUnavailable = useIsUnavailable(detailState?.media);

  // Player
  const [session, setSession] = useState(null); // { media, season, epIndex, episodes, server }

  // Local watch history & bookmarks (no login)
  const [watchHistory, setWatchHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('reelztv_watch_history');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      const saved = localStorage.getItem('reelztv_bookmarks');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [savedMedia, setSavedMedia] = useState(() => {
    try {
      const saved = localStorage.getItem('reelztv_saved_media');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  const loadHome = () => {
    setHomeStatus('loading');
    fetchHome()
      .then((data) => {
        setHomeData(data);
        setHomeStatus('ready');
      })
      .catch(() => setHomeStatus('error'));
  };

  useEffect(() => {
    loadHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const activeSearch = debouncedQuery.length >= 2;
  const searchSeq = useRef(0);
  const loadSearch = (query) => {
    const seq = ++searchSeq.current;
    setSearch((s) => ({ ...s, status: 'loading' }));
    searchMedia(query, 'all', 1)
      .then((res) => {
        if (seq !== searchSeq.current) return;
        setSearch({ items: res.items, status: 'ready', totalResults: res.totalResults });
      })
      .catch(() => {
        if (seq !== searchSeq.current) return;
        setSearch({ items: [], status: 'error', totalResults: 0 });
      });
  };
  useEffect(() => {
    searchSeq.current += 1;
    if (!activeSearch) {
      setSearch({ items: [], status: 'idle', totalResults: 0 });
      return;
    }
    loadSearch(debouncedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, activeSearch]);

  // Returning from a search refetches the browse tab from page 1 (avoids
  // duplicate rows from an appended page > 1).
  useEffect(() => {
    if (activeSearch) setBrowsePage(1);
  }, [activeSearch]);

  // Browse (movies / tv / anime tabs)
  const browseSeq = useRef(0);
  const loadBrowse = (page) => {
    const seq = ++browseSeq.current;
    setBrowseStatus('loading');
    const isAnime = tab === 'anime';
    const { genre, year, minRating } = filters;
    // movies/tv: /api/movies & /api/tv filter by genre (TMDB id) + year +
    // min_rating server-side. The backend drops `genre` whenever the category
    // is trending/new_releases, so a genre search omits the category and the
    // category becomes the ordering applied below. anime: the AniList discover
    // route honours genre name + seasonYear; its rating is filtered here.
    const request = isAnime
      ? fetchAnimeDiscover({ category, genre, seasonYear: year, page })
      : fetchLibrary(tab, { category: genre ? '' : category, genre, year, minRating, page });
    request
      .then((res) => {
        if (seq !== browseSeq.current) return;
        let items = res.items;
        if (isAnime && minRating) {
          items = items.filter((m) => Number(m.rating || 0) >= Number(minRating));
        }
        setBrowse((prev) => {
          let merged = items;
          if (page !== 1) {
            const existing = new Set(prev.items.map((m) => `${m.type}:${m.id}`));
            merged = [...prev.items, ...items.filter((m) => !existing.has(`${m.type}:${m.id}`))];
          }
          return { items: orderByCategory(merged, category), totalPages: res.totalPages || 1 };
        });
        setBrowseStatus('ready');
      })
      .catch(() => {
        if (seq === browseSeq.current) setBrowseStatus('error');
      });
  };

  useEffect(() => {
    if (!['movies', 'tv', 'anime'].includes(tab) || activeSearch) return;
    loadBrowse(browsePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, category, filters, browsePage, activeSearch]);

  const loadMore = () => setBrowsePage((p) => p + 1);

  // Empty the grid the instant tab/category/filters change, so the skeleton
  // and then the fresh results are unmistakable.
  const resetBrowse = () => {
    setBrowse({ items: [], totalPages: 1 });
    setBrowsePage(1);
    setBrowseStatus('loading');
  };

  // Pure tab switch (no gating) — also used once the age gate is confirmed.
  const goToTab = (nextTab) => {
    setTab(nextTab);
    setFilters({ genre: '', year: '', minRating: '' });
    setCategory(nextTab === 'anime' ? 'popular' : 'trending');
    resetBrowse();
  };

  const changeTab = (nextTab) => {
    // Adult is behind an age gate: don't switch until it's confirmed.
    if (nextTab === 'adult' && !adultVerified) {
      setAdultGateOpen(true);
      return;
    }
    goToTab(nextTab);
  };

  // Entering the section: remember the confirmation for this device.
  const confirmAdult = () => {
    rememberAgeVerified();
    setAdultVerified(true);
    setAdultGateOpen(false);
    goToTab('adult');
  };

  const leaveAdult = () => {
    forgetAgeVerified();
    setAdultVerified(false);
    setAdultPlaying(null);
    goToTab('home');
  };

  const changeFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    resetBrowse();
  };

  // ------------------------------------------------------------------
  // Local progress & bookmarks
  // ------------------------------------------------------------------
  const updateProgress = (media, season, episodeNumber) => {
    setWatchHistory((prev) => {
      const updated = {
        ...prev,
        [media.id]: {
          lastEpisode: episodeNumber,
          season,
          timestamp: Date.now(),
          media
        }
      };
      try {
        localStorage.setItem('reelztv_watch_history', JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  const toggleBookmark = (media) => {
    const isSaved = bookmarks.includes(media.id);
    const nextIds = isSaved ? bookmarks.filter((id) => id !== media.id) : [...bookmarks, media.id];
    const nextMedia = { ...savedMedia };
    if (isSaved) delete nextMedia[media.id];
    else nextMedia[media.id] = media;
    setBookmarks(nextIds);
    setSavedMedia(nextMedia);
    try {
      localStorage.setItem('reelztv_bookmarks', JSON.stringify(nextIds));
      localStorage.setItem('reelztv_saved_media', JSON.stringify(nextMedia));
    } catch (e) {
      console.error(e);
    }
  };

  // ------------------------------------------------------------------
  // Detail modal (real seasons & episodes via FrameXTV / AniList)
  // ------------------------------------------------------------------
  const loadSeason = (mediaId, seasonNumber, seasons, token) => {
    fetchSeasonEpisodes(mediaId, seasonNumber)
      .then((res) => {
        if (token !== detailToken.current) return;
        setDetailState((prev) =>
          prev
            ? {
                ...prev,
                epLoading: false,
                episodes: res.episodes.length > 0 ? res.episodes : makeEpisodes(res.episodeCount || 16)
              }
            : prev
        );
      })
      .catch(() => {
        if (token !== detailToken.current) return;
        const fallbackCount = seasons?.find((s) => s.number === seasonNumber)?.episodeCount || 16;
        setDetailState((prev) =>
          prev ? { ...prev, epLoading: false, episodes: makeEpisodes(fallbackCount) } : prev
        );
      });
  };

  const openDetail = (media) => {
    const token = ++detailToken.current;
    const resume = watchHistory[media.id];
    const activeSeason = resume?.season || 1;
    setDetailState({
      media,
      loading: true,
      epLoading: false,
      seasons: [],
      activeSeason,
      episodes: [],
      isMovie: media.type === 'movie',
      format: media.format || null,
      genres: media.genres || [],
      description: media.description || '',
      rating: media.rating,
      year: media.year,
      runtime: null
    });

    if (media.type === 'tv') {
      fetchDetails(media.id, 'tv')
        .then((d) => {
          if (token !== detailToken.current) return;
          const seasons = (d.seasons || [])
            .map((s) => ({
              number: s.season_number,
              name: s.name || `Season ${s.season_number}`,
              episodeCount: s.episode_count
            }))
            .filter((s) => s.number >= 1);
          const chosen = seasons.some((s) => s.number === activeSeason) ? activeSeason : (seasons[0]?.number || 1);
          setDetailState((prev) =>
            prev
              ? {
                  ...prev,
                  loading: false,
                  epLoading: true,
                  seasons,
                  activeSeason: chosen,
                  genres: (d.genres || []).map((g) => g.name || g).filter(Boolean),
                  description: d.overview || prev.description,
                  rating: d.rating ?? prev.rating,
                  year: d.year || prev.year,
                  media: { ...prev.media, poster: d.poster || prev.media.poster, backdrop: d.backdrop || prev.media.backdrop }
                }
              : prev
          );
          loadSeason(media.id, chosen, seasons, token);
        })
        .catch(() => {
          if (token !== detailToken.current) return;
          setDetailState((prev) =>
            prev ? { ...prev, loading: false, epLoading: true, episodes: makeEpisodes(16) } : prev
          );
        });
    } else if (media.type === 'anime') {
      fetchAnilistMedia(media.anilistId || media.id)
        .then((info) => {
          if (token !== detailToken.current) return;
          const isMovie = info.format === 'MOVIE';
          setDetailState((prev) =>
            prev
              ? {
                  ...prev,
                  loading: false,
                  isMovie,
                  format: info.format,
                  duration: info.duration,
                  episodes: isMovie ? [] : makeEpisodes(info.episodes || 12),
                  media: { ...prev.media, format: info.format }
                }
              : prev
          );
        })
        .catch(() => {
          if (token !== detailToken.current) return;
          setDetailState((prev) =>
            prev ? { ...prev, loading: false, episodes: makeEpisodes(12) } : prev
          );
        });
    } else {
      fetchDetails(media.id, 'movie')
        .then((d) => {
          if (token !== detailToken.current) return;
          setDetailState((prev) =>
            prev
              ? {
                  ...prev,
                  loading: false,
                  genres: (d.genres || []).map((g) => g.name || g).filter(Boolean),
                  description: d.overview || prev.description,
                  rating: d.rating ?? prev.rating,
                  year: d.year || prev.year,
                  runtime: d.runtime || null,
                  media: { ...prev.media, poster: d.poster || prev.media.poster, backdrop: d.backdrop || prev.media.backdrop }
                }
              : prev
          );
        })
        .catch(() => {
          if (token !== detailToken.current) return;
          setDetailState((prev) => (prev ? { ...prev, loading: false } : prev));
        });
    }
  };

  const changeSeason = (seasonNumber) => {
    if (!detailState) return;
    const token = ++detailToken.current;
    setDetailState((prev) => ({ ...prev, activeSeason: seasonNumber, epLoading: true, episodes: [] }));
    loadSeason(detailState.media.id, seasonNumber, detailState.seasons, token);
  };

  const closeDetail = () => {
    detailToken.current += 1;
    setDetailState(null);
  };

  const startEpisode = (idx) => {
    const st = detailState;
    if (!st) return;
    const epNumber = st.episodes[idx]?.number || idx + 1;
    withTelegramGate(() => {
      setSession({
        media: st.media,
        season: st.activeSeason,
        epIndex: idx,
        episodes: st.episodes,
        server: defaultServerFor(st.media)
      });
      if (!st.isMovie) updateProgress(st.media, st.activeSeason, epNumber);
      else updateProgress(st.media, 1, 1);
      closeDetail();
    });
  };

  const playFromDetail = () => {
    const st = detailState;
    if (!st) return;
    if (st.isMovie) {
      startEpisode(0);
      return;
    }
    const resume = watchHistory[st.media.id];
    let idx = 0;
    if (resume && resume.season === st.activeSeason && st.episodes.length > 0) {
      const found = st.episodes.findIndex((e) => e.number === resume.lastEpisode);
      if (found >= 0) idx = found;
    }
    startEpisode(idx);
  };

  // Card / hero open: movies play instantly, series open the episode picker
  const openMedia = (media) => {
    // Adult titles use their own isolated player (no Coco servers / episodes).
    if (media.type === 'adult') {
      openAdult(media);
      return;
    }
    if (media.type === 'movie') {
      withTelegramGate(() => {
        setSession({ media, season: 1, epIndex: 0, episodes: [], server: defaultServerFor(media) });
        updateProgress(media, 1, 1);
      });
    } else {
      openDetail(media);
    }
  };

  // ------------------------------------------------------------------
  // Home hero
  // ------------------------------------------------------------------
  const heroCandidates = useMemo(() => {
    if (!homeData) return [];
    const list = [];
    if (homeData.hero) list.push(homeData.hero);
    for (const m of homeData.rails.trending_movies || []) {
      if (list.length >= 5) break;
      if (!list.some((h) => h.id === m.id)) list.push(m);
    }
    return list;
  }, [homeData]);

  const [heroIndex, setHeroIndex] = useState(0);
  useEffect(() => {
    if (tab !== 'home' || activeSearch || heroCandidates.length <= 1) return;
    const interval = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % heroCandidates.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [tab, activeSearch, heroCandidates.length]);

  const currentHero = heroCandidates[heroIndex % Math.max(1, heroCandidates.length)] || null;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const historyItems = Object.values(watchHistory)
    .filter((h) => h && h.media)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .map((h) => h.media);
  const bookmarkItems = bookmarks.map((id) => savedMedia[id]).filter(Boolean);

  const headerBtn = (active, onClick, icon, label, activeColor) => (
    <button
      onClick={onClick}
      className={`p-2.5 sm:px-3 sm:py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 border transition ${
        active
          ? `${activeColor} text-white shadow-md`
          : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:bg-slate-800'
      }`}
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-rose-500 selection:text-white">

      {/* HEADER */}
      {/* On phones the three header buttons squeeze the search field, so the
          search drops to its own full-width row below them (sm+ keeps one row). */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">

        {/* Logo & Tagline */}
        <div
          className="flex items-center gap-2 sm:gap-3 cursor-pointer group shrink-0"
          onClick={() => {
            setDetailState(null);
            setSession(null);
            changeTab('home');
            setSearchQuery('');
          }}
        >
          <div className="relative rounded-2xl overflow-hidden shadow-[0_0_15px_rgba(244,63,94,0.3)] group-hover:shadow-[0_0_22px_rgba(244,63,94,0.6)] group-hover:scale-105 transition-all duration-300">
            <ReelzLogo className="w-9 h-9 sm:w-11 sm:h-11" />
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-lg sm:text-xl font-black tracking-wider bg-gradient-to-r from-white via-slate-100 to-rose-400 bg-clip-text text-transparent">
                ReelzTV
              </span>
            </div>
            <p className="hidden sm:block text-[9px] text-slate-400 font-bold tracking-widest uppercase -mt-0.5">
              Movies • Series • Anime
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1 max-w-md mx-0 sm:mx-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="global-search"
            type="text"
            placeholder="Search movies, TV, anime…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950/80 border border-slate-800 rounded-full pl-9 pr-4 py-1.5 text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Saved & History */}
        <div className="flex items-center gap-2 shrink-0">
          {headerBtn(
            tab === 'saved',
            () => changeTab(tab === 'saved' ? 'home' : 'saved'),
            <Bookmark className={`w-3.5 h-3.5 ${bookmarks.length > 0 ? 'fill-rose-400 text-rose-400' : ''}`} />,
            'My List',
            'bg-rose-500 border-rose-400 shadow-rose-500/25'
          )}
          {headerBtn(
            tab === 'history',
            () => changeTab(tab === 'history' ? 'home' : 'history'),
            <Clock className="w-3.5 h-3.5 text-purple-400" />,
            'History',
            'bg-purple-600 border-purple-500 shadow-purple-600/25'
          )}
          <button
            onClick={() => setDonationOpen(true)}
            className="p-2.5 sm:px-3 sm:py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 border transition bg-rose-500/15 border-rose-500/40 text-rose-300 hover:bg-rose-500/25 hover:text-rose-200"
            title="Donate"
          >
            <Heart className="w-3.5 h-3.5 fill-rose-400 text-rose-400" />
            <span className="hidden sm:inline">Donate</span>
          </button>
        </div>
      </header>

      {/* MAIN TABS */}
      <nav className="bg-slate-950/90 border-b border-slate-800/80 px-4 py-2 flex items-center gap-2 z-20 overflow-x-auto no-scrollbar">
        {MAIN_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => changeTab(t.id)}
            className={`shrink-0 px-3.5 py-2 sm:px-4 sm:py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              tab === t.id
                ? 'bg-gradient-to-r from-rose-500 via-purple-600 to-indigo-600 text-white shadow-md shadow-rose-500/25 font-bold'
                : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
        {['saved', 'history'].includes(tab) && (
          <span className="shrink-0 text-xs text-slate-500 font-semibold px-2">
            · {tab === 'saved' ? 'My List' : 'Watch History'}
          </span>
        )}
        <a
          href={TELEGRAM_INVITE}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 hover:text-blue-200 text-xs font-bold transition"
        >
          Join Telegram
        </a>
      </nav>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">

        {/* SEARCH RESULTS (replaces every tab) */}
        {activeSearch ? (
          <>
            <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2 mb-4">
              <Search className="w-5 h-5 text-rose-500" />
              <span>Results for “{debouncedQuery}”</span>
              {search.status === 'ready' && (
                <span className="text-xs bg-slate-800 text-slate-400 font-mono px-2 py-0.5 rounded-full">
                  {search.totalResults || search.items.length} titles
                </span>
              )}
            </h2>
            {search.status === 'loading' && (
              <>
                <LogoLoader label="Searching the catalog…" className="py-8" />
                <GridSkeleton />
              </>
            )}
            {search.status === 'error' && (
              <ErrorPanel message="Search failed — the catalog API may be busy." onRetry={() => loadSearch(debouncedQuery)} />
            )}
            {search.status === 'ready' && (
              <MediaGrid
                items={search.items}
                onOpen={openMedia}
                bookmarks={bookmarks}
                savedMedia={savedMedia}
                
                onToggleSave={toggleBookmark}
                emptyMessage="No titles matched your search."
              />
            )}
          </>
        ) : tab === 'home' ? (
          /* ---------------- HOME ---------------- */
          homeStatus === 'loading' ? (
            <>
              <LogoLoader label="Loading the catalog…" className="py-10" />
              <div className="rounded-2xl overflow-hidden border border-slate-800/80 bg-slate-900/40 animate-pulse mb-8">
                <div className="aspect-[21/9] bg-slate-800/60" />
              </div>
              <RailSkeleton />
              <RailSkeleton />
            </>
          ) : homeStatus === 'error' ? (
            <ErrorPanel message="Could not load the catalog. Please try again." onRetry={loadHome} />
          ) : (
            <>
              {/* HERO */}
              {currentHero && (
                <section className="relative w-full overflow-hidden bg-slate-950 border border-slate-800/80 rounded-2xl mb-8">
                  <div className="relative min-h-[340px] sm:min-h-[420px] flex items-center p-5 sm:p-8">
                    <div className="absolute inset-0 z-0">
                      <MediaImage
                        key={currentHero.id}
                        src={currentHero.backdrop || currentHero.poster}
                        alt={currentHero.title}
                        className="w-full h-full object-cover object-center opacity-35 transition-all duration-700"
                        fallbackIconClass="w-16 h-16"
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/90 to-transparent" />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950/60" />
                    </div>

                    <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start gap-6 w-full">
                      {/* 16:9 hero thumbnail */}
                      <div
                        onClick={() => openMedia(currentHero)}
                        className="hidden md:block relative w-72 aspect-video rounded-2xl overflow-hidden border-2 border-rose-500/40 shadow-2xl shadow-rose-500/20 shrink-0 cursor-pointer group"
                      >
                        <MediaImage
                          src={currentHero.backdrop || currentHero.poster}
                          alt={currentHero.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          fallbackIconClass="w-14 h-14"
                        />
                        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-12 h-12 rounded-full bg-rose-500/90 flex items-center justify-center shadow-lg text-white">
                            <Play className="w-6 h-6 fill-current ml-0.5" />
                          </div>
                        </div>
                        <div className="absolute top-2 left-2 bg-rose-600 text-white text-[10px] font-black px-2 py-0.5 rounded-md shadow">
                          #{heroIndex + 1} TRENDING
                        </div>
                      </div>

                      {/* Hero info */}
                      <div className="flex-1 flex flex-col justify-center text-center md:text-left">
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-2">
                          <span className="bg-gradient-to-r from-rose-500 to-purple-600 text-white text-xs font-black px-3 py-1 rounded-full shadow-lg shadow-rose-500/30">
                            🔥 #{heroIndex + 1} TRENDING
                          </span>
                          <span className="bg-slate-900/90 border border-slate-700 text-rose-400 text-xs font-bold px-2.5 py-1 rounded-full backdrop-blur-md">
                            {typeLabel(currentHero.type)}
                          </span>
                          <span className="text-xs text-slate-300 font-medium">
                            ⭐ {currentHero.rating ?? '—'}{currentHero.year ? ` • ${currentHero.year}` : ''}
                          </span>
                        </div>

                        <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight leading-tight">
                          {currentHero.title}
                        </h2>

                        <p className="text-xs sm:text-sm text-slate-300 mt-2 max-w-2xl line-clamp-3 leading-relaxed">
                          {currentHero.description}
                        </p>

                        {currentHero.genres?.length > 0 && (
                          <div className="flex flex-wrap items-center justify-center md:justify-start gap-1.5 mt-3">
                            {currentHero.genres.slice(0, 6).map((g) => (
                              <span key={g} className="bg-slate-900/90 border border-slate-800 text-slate-300 text-[11px] px-2.5 py-0.5 rounded-md">
                                #{g}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mt-6">
                          <button
                            onClick={() => openMedia(currentHero)}
                            className="px-6 py-3 rounded-2xl bg-gradient-to-r from-rose-500 via-purple-600 to-indigo-600 text-white font-bold text-sm shadow-xl shadow-rose-500/25 hover:shadow-rose-500/40 hover:scale-105 transition-all flex items-center gap-2"
                          >
                            <Play className="w-5 h-5 fill-current" />
                            <span>{currentHero.type === 'movie' ? 'Play Movie' : 'Watch Now'}</span>
                          </button>
                          <button
                            onClick={() => openDetail(currentHero)}
                            className="px-5 py-3 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-sm backdrop-blur-md transition-all flex items-center gap-2"
                          >
                            <ListVideo className="w-4 h-4 text-rose-400" />
                            <span>{currentHero.type === 'movie' ? 'More Info' : 'Browse Episodes'}</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Carousel controls */}
                    {heroCandidates.length > 1 && (
                      <div className="absolute bottom-3 right-4 z-20 flex items-center gap-3 bg-slate-900/80 border border-slate-800/80 px-3 py-1.5 rounded-full backdrop-blur-md">
                        <button
                          onClick={() => setHeroIndex((prev) => (prev - 1 + heroCandidates.length) % heroCandidates.length)}
                          className="text-slate-400 hover:text-white transition"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="flex items-center gap-1.5">
                          {heroCandidates.map((h, idx) => (
                            <button
                              key={h.id}
                              onClick={() => setHeroIndex(idx)}
                              className={`h-2 rounded-full transition-all ${
                                heroIndex === idx ? 'w-6 bg-rose-500' : 'w-2 bg-slate-700 hover:bg-slate-500'
                              }`}
                            />
                          ))}
                        </div>
                        <button
                          onClick={() => setHeroIndex((prev) => (prev + 1) % heroCandidates.length)}
                          className="text-slate-400 hover:text-white transition"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* RAILS */}
              {historyItems.length > 0 && (
                <Rail
                  title="Continue Watching"
                  items={historyItems}
                  onOpen={openMedia}
                  bookmarks={bookmarks}
                  savedMedia={savedMedia}
                  onToggleSave={toggleBookmark}
                />
              )}
              {bookmarkItems.length > 0 && (
                <Rail
                  title="My List"
                  items={bookmarkItems}
                  onOpen={openMedia}
                  bookmarks={bookmarks}
                  savedMedia={savedMedia}
                  onToggleSave={toggleBookmark}
                />
              )}
              <Rail title="Trending Movies" items={homeData?.rails?.trending_movies} onOpen={openMedia} bookmarks={bookmarks}  savedMedia={savedMedia} onToggleSave={toggleBookmark} />
              <Rail title="Popular Movies" items={homeData?.rails?.popular_movies} onOpen={openMedia} bookmarks={bookmarks}  savedMedia={savedMedia} onToggleSave={toggleBookmark} />
              <Rail title="Popular TV Series" items={homeData?.rails?.popular_tv} onOpen={openMedia} bookmarks={bookmarks}  savedMedia={savedMedia} onToggleSave={toggleBookmark} />
              <Rail title="Popular Anime" items={homeData?.rails?.popular_anime} onOpen={openMedia} bookmarks={bookmarks}  savedMedia={savedMedia} onToggleSave={toggleBookmark} />
              <Rail title="New Releases" items={homeData?.rails?.new_releases} onOpen={openMedia} bookmarks={bookmarks}  savedMedia={savedMedia} onToggleSave={toggleBookmark} />
              <Rail title="Airing Anime" items={homeData?.rails?.airing_anime} onOpen={openMedia} bookmarks={bookmarks}  savedMedia={savedMedia} onToggleSave={toggleBookmark} />
            </>
          )
        ) : tab === 'adult' ? (
          /* ---------------- ADULT (age-gated, isolated) ---------------- */
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-400" />
                  <span>Adult</span>
                  <span className="text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    18+
                  </span>
                  {adultShown.length > 0 && (
                    <span className="text-xs bg-slate-800 text-slate-400 font-mono px-2 py-0.5 rounded-full">
                      {adultShown.length}
                    </span>
                  )}
                </h2>
                <p className="text-[11px] text-slate-500 mt-1">
                  Kept separate from Movies, TV and Anime — and never included in search.
                </p>
              </div>
              <button
                onClick={leaveAdult}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 transition"
              >
                Leave this section
              </button>
            </div>

            {/* Adult-only search — queries the live catalog directly and never
                touches the site-wide search, so adult titles stay out of global
                results entirely. */}
            <div className="relative mb-5 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="adult-search"
                type="text"
                placeholder="Search adult videos…"
                value={adultQuery}
                onChange={(e) => setAdultQuery(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-800 rounded-full pl-9 pr-9 py-1.5 text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all"
              />
              {adultQuery && (
                <button
                  onClick={() => setAdultQuery('')}
                  aria-label="Clear adult search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {adultSearching && adultSearch.status === 'loading' && (
              <>
                <LogoLoader label={`Searching for “${adultSearch.query}”…`} className="py-8" />
                <GridSkeleton count={12} />
              </>
            )}

            {adultSearching && adultSearch.status === 'ready' && (
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>
                  {adultSearch.items.length > 0 && adultPageState.totalCount > adultSearch.items.length
                    ? `Showing ${adultSearch.items.length} of ${adultPageState.totalCount.toLocaleString()}`
                    : `${adultSearch.items.length} result${adultSearch.items.length === 1 ? '' : 's'}`}{' '}
                  for “{adultSearch.query}”
                </span>
                <button
                  onClick={() => setAdultQuery('')}
                  className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 transition"
                >
                  Clear
                </button>
              </div>
            )}

            {adultSearching &&
              adultSearch.status === 'ready' &&
              adultSearch.local &&
              adultSearch.message && (
                <p className="mb-4 text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                  {adultSearch.message}
                </p>
              )}

            {!adultSearching && adultCatalog.status === 'loading' && (
              <>
                <LogoLoader label="Loading adult catalog…" className="py-8" />
                <GridSkeleton count={12} />
              </>
            )}

            {!adultSearching && adultCatalog.status === 'error' && (
              <ErrorPanel
                message={adultCatalog.message || 'Could not load the adult catalog.'}
                onRetry={loadAdult}
              />
            )}

            {!adultSearching && adultCatalog.status === 'ready' && adultItems.length === 0 && (
              <div className="py-16 text-center text-slate-500">
                <p className="text-base">No adult titles are available yet.</p>
                <p className="text-xs mt-2 max-w-md mx-auto leading-relaxed">
                  The live catalog returned nothing. Add titles to{' '}
                  <code className="text-slate-400">public/adult.json</code> — it is served as-is, so
                  no rebuild is needed — or set{' '}
                  <code className="text-slate-400">ADULT_LIVE</code> /{' '}
                  <code className="text-slate-400">ADULT_VIDEOS</code> in{' '}
                  <code className="text-slate-400">src/adult.js</code>.
                </p>
                <button
                  onClick={loadAdult}
                  className="mt-4 px-4 py-2 rounded-full text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 transition"
                >
                  Reload catalog
                </button>
              </div>
            )}

            {adultShown.length > 0 && adultShown.every((i) => i.demo) && (
              <p className="mb-4 text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                The live catalog is unavailable, so these placeholder clips are showing instead. Add
                real entries to <code className="text-amber-200">public/adult.json</code> (or{' '}
                <code className="text-amber-200">ADULT_VIDEOS</code> in{' '}
                <code className="text-amber-200">src/adult.js</code>) to publish real content.
              </p>
            )}

            {adultShown.length > 0 ? (
              <MediaGrid
                items={adultShown}
                onOpen={openAdult}
                bookmarks={[]}
                savedMedia={{}}
                onToggleSave={null}
                emptyMessage="No adult titles are available yet."
              />
            ) : (
              adultSearching &&
              adultSearch.status === 'ready' && (
                <p className="py-12 text-center text-sm text-slate-500">
                  No videos match “{adultSearch.query}”.
                </p>
              )
            )}

            {adultShown.length > 0 && adultPageState.hasMore && (
              <div className="mt-6 flex flex-col items-center gap-2">
                <button
                  onClick={loadMoreAdult}
                  disabled={adultLoadingMore}
                  className="px-5 py-2 rounded-full text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {adultLoadingMore ? 'Loading…' : 'Load more'}
                </button>
                {adultMoreError && (
                  <p className="text-[11px] text-amber-300/90">{adultMoreError}</p>
                )}
              </div>
            )}
          </>
        ) : tab === 'movies' || tab === 'tv' || tab === 'anime' ? (
          /* ---------------- BROWSE TABS ---------------- */
          <>
            {/* Filter bar — category pills + genre / year / rating selects */}
            <div className="flex flex-col gap-2 mb-5">
              <div className="flex flex-wrap items-center gap-2">
                {BROWSE_CATEGORIES[tab].map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setCategory(c.id);
                      resetBrowse();
                    }}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      category === c.id
                        ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25'
                        : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Genre"
                  value={filters.genre}
                  onChange={(e) => changeFilter('genre', e.target.value)}
                  className={FILTER_SELECT_CLS}
                >
                  <option value="">All Genres</option>
                  {GENRES_BY_TAB[tab].map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Year"
                  value={filters.year}
                  onChange={(e) => changeFilter('year', e.target.value)}
                  className={FILTER_SELECT_CLS}
                >
                  <option value="">Any Year</option>
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Minimum rating"
                  value={filters.minRating}
                  onChange={(e) => changeFilter('minRating', e.target.value)}
                  className={FILTER_SELECT_CLS}
                >
                  {RATING_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {(filters.genre || filters.year || filters.minRating) && (
                  <button
                    onClick={() => {
                      setFilters({ genre: '', year: '', minRating: '' });
                      resetBrowse();
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" /> Clear Filters
                  </button>
                )}
              </div>
            </div>

            {browseStatus === 'loading' && browse.items.length === 0 && (
              <>
                <LogoLoader
                  label={`Loading ${tab === 'anime' ? 'anime' : tab === 'tv' ? 'TV series' : 'movies'}…`}
                  className="py-8"
                />
                <GridSkeleton count={12} />
              </>
            )}
            {browseStatus === 'error' && (
              <ErrorPanel
                message={`Could not load ${tab === 'anime' ? 'anime' : tab === 'tv' ? 'TV shows' : 'movies'} from the catalog.`}
                onRetry={() => loadBrowse(browsePage)}
              />
            )}
            {browse.items.length > 0 && (
              <>
                <MediaGrid
                  items={browse.items}
                  onOpen={openMedia}
                  bookmarks={bookmarks}
                  savedMedia={savedMedia}
                  
                  onToggleSave={toggleBookmark}
                  emptyMessage="No titles in this selection."
                />
                {browsePage < browse.totalPages && (
                  <div className="flex justify-center mt-6">
                    <button
                      onClick={loadMore}
                      disabled={browseStatus === 'loading'}
                      className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-sm font-semibold transition flex items-center gap-2 disabled:opacity-50"
                    >
                      {browseStatus === 'loading' ? 'Loading…' : 'Load More'}
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </>
            )}
            {browseStatus === 'ready' && browse.items.length === 0 && (
              <div className="py-16 text-center text-slate-500">
                <p className="text-base">
                  {filters.genre || filters.year || filters.minRating
                    ? 'No titles match these filters — try a different genre, year or rating.'
                    : 'No titles found for this selection.'}
                </p>
              </div>
            )}
          </>
        ) : tab === 'saved' ? (
          /* ---------------- MY LIST ---------------- */
          <>
            <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2 mb-4">
              <Bookmark className="w-5 h-5 text-rose-500" />
              <span>My List</span>
              <span className="text-xs bg-slate-800 text-slate-400 font-mono px-2 py-0.5 rounded-full">{bookmarkItems.length}</span>
            </h2>
            <MediaGrid
              items={bookmarkItems}
              onOpen={openMedia}
              bookmarks={bookmarks}
              savedMedia={savedMedia}
              
              onToggleSave={toggleBookmark}
              emptyMessage="Nothing saved yet — tap the bookmark icon on any title."
            />
          </>
        ) : (
          /* ---------------- HISTORY ---------------- */
          <>
            <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-purple-400" />
              <span>Watch History</span>
              <span className="text-xs bg-slate-800 text-slate-400 font-mono px-2 py-0.5 rounded-full">{historyItems.length}</span>
            </h2>
            <MediaGrid
              items={historyItems}
              onOpen={openMedia}
              bookmarks={bookmarks}
              savedMedia={savedMedia}
              
              onToggleSave={toggleBookmark}
              emptyMessage="No watch history yet — start playing something!"
            />
          </>
        )}
      </main>

      {/* FOOTER */}
      <footer className="bg-slate-900/90 border-t border-slate-800/80 px-4 py-6 mt-10 text-slate-400 text-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ReelzLogo className="w-8 h-8 shrink-0" />
            <div>
              <p className="font-bold text-slate-200">ReelzTV</p>
              <p className="text-[11px] text-slate-500">Free Movies, TV Series & Anime Streaming Platform</p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="text-[11px] text-slate-500">
              © {new Date().getFullYear()} ReelzTV. All rights reserved.
            </span>
          </div>
        </div>
      </footer>

      <DonationModal open={donationOpen} onClose={closeDonation} />

      {gateOpen && <TelegramGate onPassed={passGate} onClose={closeGate} />}

      {/* AGE GATE — blocks the Adult tab until confirmed */}
      {adultGateOpen && (
        <AdultGateModal onConfirm={confirmAdult} onCancel={() => setAdultGateOpen(false)} />
      )}

      {/* ADULT PLAYER — single external embed, isolated from the Coco player */}
      {adultPlaying && (
        <AdultPlayerModal
          key={adultPlaying.id}
          item={adultPlaying}
          onClose={() => setAdultPlaying(null)}
        />
      )}

      {/* DETAIL MODAL — seasons & real episodes */}
      {detailState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-0 sm:p-6 animate-in fade-in duration-200" onClick={closeDetail}>
          <div
            className="relative w-full sm:max-w-3xl bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeDetail}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/60 text-slate-200 hover:text-white flex items-center justify-center hover:bg-black/90 transition backdrop-blur-md"
            >
              <X className="w-5 h-5" />
            </button>

            {/* 16:9 backdrop header */}
            <div className="relative w-full aspect-video max-h-[40vh] bg-slate-950 shrink-0 overflow-hidden">
              <MediaImage
                src={detailState.media.backdrop || detailState.media.poster}
                alt={detailState.media.title}
                className="w-full h-full object-cover opacity-60"
                fallbackIconClass="w-16 h-16"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold px-2.5 py-0.5 rounded-full">
                    {typeLabel(detailState.media.type)}
                  </span>
                  {detailUnavailable && (
                    <span className="bg-rose-600/90 text-white border border-rose-400/40 text-xs font-bold px-2.5 py-0.5 rounded-full">
                      Not Available
                    </span>
                  )}
                  <span className="text-xs text-slate-300 font-medium">
                    ⭐ {detailState.rating ?? '—'}{detailState.year ? ` • ${detailState.year}` : ''}
                    {detailState.runtime ? ` • ${detailState.runtime} min` : ''}
                    {!detailState.isMovie && detailState.seasons.length > 0 ? ` • ${detailState.seasons.length} Seasons` : ''}
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-white leading-snug">
                  {detailState.media.title}
                </h2>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {detailState.genres?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {detailState.genres.slice(0, 8).map((g) => (
                    <span key={g} className="bg-slate-800 text-slate-300 text-[10px] px-2 py-0.5 rounded-md border border-slate-700">
                      #{g}
                    </span>
                  ))}
                </div>
              )}

              {detailState.description && (
                <p className="text-xs sm:text-[13px] text-slate-400 leading-relaxed">
                  {detailState.description}
                </p>
              )}

              {detailState.loading && (
                <div className="space-y-2 animate-pulse py-2">
                  <div className="h-3 bg-slate-800 rounded w-full" />
                  <div className="h-3 bg-slate-800 rounded w-5/6" />
                  <div className="h-3 bg-slate-800 rounded w-2/3" />
                </div>
              )}

              {!detailState.loading && !detailState.isMovie && (
                <>
                  {/* Season selector */}
                  {detailState.seasons.length > 1 && (
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                      {detailState.seasons.map((s) => (
                        <button
                          key={s.number}
                          onClick={() => changeSeason(s.number)}
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                            detailState.activeSeason === s.number
                              ? 'bg-white text-black font-bold'
                              : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                          }`}
                        >
                          {s.name || `Season ${s.number}`}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Episodes */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <ListVideo className="w-4 h-4 text-rose-500" />
                      Season {detailState.activeSeason} · {detailState.episodes.length || '…'} Episodes
                    </span>
                    <span className="text-xs text-slate-500">Tap to play</span>
                  </div>

                  {detailState.epLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="h-16 rounded-xl bg-slate-800/60 border border-slate-800 animate-pulse" />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {detailState.episodes.map((ep, idx) => {
                        const resume = watchHistory[detailState.media.id];
                        const isResume = resume?.season === detailState.activeSeason && resume?.lastEpisode === ep.number;
                        return (
                          <button
                            key={ep.number}
                            onClick={() => startEpisode(idx)}
                            className={`group text-left p-2.5 rounded-xl border flex items-center gap-3 transition-all ${
                              isResume
                                ? 'bg-rose-950/30 border-rose-500 text-rose-200'
                                : 'bg-slate-800/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/80 text-slate-200'
                            }`}
                          >
                            <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center shrink-0 group-hover:bg-rose-500 group-hover:text-white transition">
                              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-xs flex items-center justify-between gap-2">
                                <span className="truncate">Ep. {ep.number}{ep.name ? ` — ${ep.name}` : ''}</span>
                                {isResume && <span className="text-[10px] text-rose-400 shrink-0">Resume</span>}
                              </div>
                              {ep.overview && (
                                <span className="text-[10px] text-slate-500 block truncate">{ep.overview}</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Sticky play bar */}
            <div className="border-t border-slate-800 p-3 bg-slate-950/90 flex items-center gap-2 shrink-0">
              <button
                onClick={playFromDetail}
                disabled={detailState.loading || (!detailState.isMovie && detailState.epLoading)}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 via-purple-600 to-indigo-600 text-white font-bold text-sm shadow-lg shadow-rose-500/25 hover:shadow-rose-500/40 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Play className="w-4.5 h-4.5 fill-current" />
                <span>
                  {detailState.isMovie
                    ? 'Play Movie'
                    : (() => {
                        const resume = watchHistory[detailState.media.id];
                        return resume && resume.season === detailState.activeSeason
                          ? `Resume ${resumeLabel(resume)}`
                          : `Play S${detailState.activeSeason} E${detailState.episodes[0]?.number || 1}`;
                      })()}
                </span>
              </button>
              <button
                onClick={() => toggleBookmark(detailState.media)}
                className={`px-4 py-2.5 rounded-xl border font-semibold text-sm transition flex items-center gap-2 ${
                  bookmarks.includes(detailState.media.id)
                    ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
                title="Save to My List"
              >
                <Bookmark className={`w-4 h-4 ${bookmarks.includes(detailState.media.id) ? 'fill-rose-400 text-rose-400' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 16:9 LANDSCAPE PLAYER — Coco servers (Coco I for movies, Coco II for series/anime) */}
      {session && (
        <PlayerModal
          session={session}
          onClose={() => setSession(null)}
          onNavigate={(nextSession) => {
            setSession(nextSession);
            const epNumber = nextSession.episodes[nextSession.epIndex]?.number || nextSession.epIndex + 1;
            updateProgress(nextSession.media, nextSession.season, epNumber);
          }}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------
// Landscape 16:9 player — the site's Coco servers:
//   Coco I            — vidsrc embed (movies default)
//   Coco II / III     — extractor embeds (series/anime default Coco II),
//                       live setProvider switching,
//                       auto-next via frameXTV:timeupdate/ended
// --------------------------------------------------------------------
function PlayerModal({ session, onClose, onNavigate }) {
  const { media, season, epIndex, episodes, server } = session;
  const currentEp = episodes[epIndex] || null;
  const isMovie = episodes.length === 0;
  // Coco I is the plain vidsrc embed; Coco II & III run the extractor embeds
  // (real provider ids valkyrie / super_barbarian, shown to users only as
  // "Coco II" / "Coco III").
  const isVidsrc = server === DEFAULT_SERVER_ID;
  const activeServer = SERVERS.find((s) => s.id === server) || SERVERS[0];
  const hasNext = epIndex < episodes.length - 1;
  const hasPrev = epIndex > 0;

  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
  const [autoNext, setAutoNext] = useState(true);
  const [nextCountdown, setNextCountdown] = useState(null);
  const [showServers, setShowServers] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  // True once the embed has reported real progress (never true for vidsrc).
  const playbackStarted = useRef(false);

  const iframeRef = useRef(null);
  const endedHandled = useRef(false);

  const goToNextEpisode = () => {
    setNextCountdown(null);
    if (hasNext) onNavigate({ ...session, epIndex: epIndex + 1 });
  };
  const goToPrevEpisode = () => {
    setNextCountdown(null);
    if (hasPrev) onNavigate({ ...session, epIndex: epIndex - 1 });
  };

  const handleVideoEnded = () => {
    if (endedHandled.current) return;
    endedHandled.current = true;
    if (autoNext && hasNext) setNextCountdown(2);
  };

  // Reset the end-of-episode guard whenever the playback target changes.
  // remountKey (not server) so switching Coco II ↔ Coco III stays a live
  // postMessage setProvider (no iframe reload).
  const remountKey = isVidsrc ? 'coco1-src' : 'coco-live';
  useEffect(() => {
    endedHandled.current = false;
    playbackStarted.current = false;
    setPlaybackFailed(false);
    setPlayerReady(false);
  }, [media.id, season, epIndex, remountKey]);

  // Countdown to auto-next
  useEffect(() => {
    if (nextCountdown === null) return;
    if (nextCountdown === 0) {
      goToNextEpisode();
      return;
    }
    const timer = setTimeout(() => {
      setNextCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCountdown]);

  // Embed URL — only rebuilds when the playback target changes. Switching
  // between Coco II and Coco III is a LIVE postMessage setProvider (no reload).
  const iframeSrc = useMemo(() => {
    const epNumber = currentEp?.number || 1;
    const raw = isVidsrc
      ? buildVidsrcEmbedUrl(media, season, epNumber)
      : buildFramextvEmbedUrl(media, {
          season,
          episode: epNumber,
          server: SERVERS.find((s) => s.id === server)?.provider || '',
          autoplay: true
        });
    return appendMutedParam(raw, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id, media.type, media.anilistId, media.format, season, epIndex, remountKey]);

  const postToPlayer = (msg) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(msg, '*');
    } catch {
      /* cross-origin postMessage is fire-and-forget */
    }
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    postToPlayer({ action: next ? 'mute' : 'unmute' });
    postToPlayer({ action: 'setVolume', volume: next ? 0 : 1 });
  };

  const pickServer = (id) => {
    setShowServers(false);
    if (id === server) return;
    setPlaybackFailed(false);
    // Coco II ↔ Coco III: live extractor switch inside the embed — no reload,
    // no iframe remount (remountKey stays 'framex-live'). Anything involving
    // Coco I changes the embed origin, so the iframe remounts.
    if (!isVidsrc && id !== DEFAULT_SERVER_ID) {
      const provider = SERVERS.find((s) => s.id === id)?.provider;
      if (provider) {
        // Cover the embed's own "Connecting to <provider>" screen while the
        // new extractor spins up; the next timeupdate hides it again.
        setPlayerReady(false);
        postToPlayer({ action: 'setProvider', provider });
      }
    }
    onNavigate({ ...session, server: id });
  };

  // Embed players signal progress/completion via postMessage → drive Auto-Next.
  useEffect(() => {
    const handleMessage = (e) => {
      const data = e.data;
      if (data === 'ended' || data === 'complete') {
        handleVideoEnded();
        return;
      }
      if (!data || typeof data !== 'object') return;
      if (data.event === EVENTS.ready) {
        // The embed fires this as soon as its shell mounts, seconds before it
        // actually has a stream — don't drop the loading cover yet, or the
        // extractor's "Connecting to Valkyrie" screen shows through.
        // New iframes start unmuted even if the user had muted — re-apply.
        if (isMutedRef.current) {
          postToPlayer({ action: 'mute' });
          postToPlayer({ action: 'setVolume', volume: 0 });
        }
        return;
      }
      if (data.event === EVENTS.ended) {
        handleVideoEnded();
        return;
      }
      if (data.event === EVENTS.timeupdate) {
        // Real playback has started — safe to reveal the player, and proof the
        // title is playable (clears any stale "Not Available" flag).
        playbackStarted.current = true;
        markAvailable(media);
        setPlayerReady(true);
        const { currentTime, duration } = data;
        if (
          Number.isFinite(duration) && duration > 0 &&
          Number.isFinite(currentTime) && currentTime >= duration - 0.6
        ) {
          handleVideoEnded();
        }
        return;
      }
      if (data.type === 'ended' || data.action === 'ended' || data.event === 'ended') handleVideoEnded();
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNext, epIndex, episodes.length, season]);

  // Never show the loader forever: vidsrc posts no messages at all, and a
  // broken FrameXTV extractor must not leave the player covered indefinitely.
  useEffect(() => {
    if (playerReady) return;
    const timer = setTimeout(() => setPlayerReady(true), isVidsrc ? 7000 : 15000);
    return () => clearTimeout(timer);
  }, [playerReady, iframeSrc, isVidsrc]);

  // Learn from the real play attempt: extractors can take ~15s to grind
  // through their providers, so if Coco II / Coco III still haven't reported
  // any progress after 25s, remember this title as unavailable (so its
  // thumbnail gets the label) and tell the user. vidsrc (Coco I) sends no
  // messages at all, so it can't be judged this way.
  useEffect(() => {
    if (isVidsrc) return undefined;
    const timer = setTimeout(() => {
      if (playbackStarted.current) return;
      markUnavailable(media, server);
      setPlaybackFailed(true);
    }, 25000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id, media.type, season, epIndex, server, isVidsrc]);

  // Keyboard: Esc closes, arrows change episode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') goToNextEpisode();
      else if (e.key === 'ArrowUp') goToPrevEpisode();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epIndex, episodes.length]);

  const activeServerName = activeServer?.name || 'Coco I';

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center animate-in fade-in duration-200 select-none">
      {/* 16:9 player box — full-width, vertically centered, so the embed's
          own controls (seek bar, volume, fullscreen) sit at the video's
          bottom edge with nothing overlapping them */}
      <div className="relative w-full max-w-[1400px] aspect-video bg-black shadow-2xl overflow-hidden">

        <iframe
          key={`${remountKey}|${media.id}|${media.type}|${season}|${currentEp?.number || 1}`}
          ref={iframeRef}
          src={iframeSrc}
          title={`${media.title}${currentEp ? ` — S${season} E${currentEp.number}` : ''}`}
          className="absolute inset-0 w-full h-full border-0 bg-black"
          sandbox={isVidsrc ? undefined : EMBED_SANDBOX}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />

        {/* Opaque loading cover — also hides the FrameXTV embed's own
            "Connecting to Valkyrie / super_barbarian" branding, so all the
            user ever sees is our Coco server name. */}
        {!playerReady && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black pointer-events-none">
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <LogoLoader label={`Connecting to ${activeServerName}…`} />
              <p className="text-[11px] text-slate-500 -mt-1">
                {media.title}{currentEp ? ` · S${season} E${currentEp.number}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Nothing ever started on this extractor — say so plainly instead of
            leaving a dead player, and offer the other source. */}
        {playbackFailed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
            <div className="flex flex-col items-center gap-3 px-6 text-center pointer-events-auto">
              <span className="bg-rose-600 text-white text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-md">
                Not Available
              </span>
              <p className="text-sm font-semibold text-slate-100">No video on {activeServerName}</p>
              <p className="text-[11px] text-slate-400 -mt-1">
                {media.title}{currentEp ? ` · S${season} E${currentEp.number}` : ''}
              </p>
              <button
                onClick={() => pickServer(DEFAULT_SERVER_ID)}
                className="mt-1 px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold transition"
              >
                Try Coco I instead
              </button>
            </div>
          </div>
        )}

        {/* SHIELD — while a video plays the embed paints its own top banner
            along the very top of the frame: a "You're Watching" label on the
            left and, on the right, a pill carrying the real extractor name
            (plus a menu that lists every extractor it knows). That banner is
            inside a cross-origin frame, so it can't be edited — but it can be
            covered. Our bar sits over it: the opaque strip hides the banner
            text/name outright, and by swallowing pointer events in that strip
            it also stops a stray click from popping the embed's own server
            menu. The fade below it blends the cover into the video. */}
        <div className="absolute inset-x-0 top-0 h-[56px] sm:h-[66px] z-[15] bg-black pointer-events-auto" aria-hidden="true" />
        <div className="absolute inset-x-0 top-[56px] sm:top-[66px] h-6 z-[15] bg-gradient-to-b from-black to-transparent pointer-events-none" aria-hidden="true" />

        {/* TOP BAR — title, Auto-Next, servers (never touches the seek bar) */}
        <div className="absolute inset-x-0 top-0 z-20 p-3 bg-gradient-to-b from-black/90 via-black/45 to-transparent flex items-center gap-2 pointer-events-none">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center backdrop-blur-md hover:bg-black/80 transition pointer-events-auto shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
          <ReelzLogo className="w-7 h-7 hidden sm:block shrink-0" />

          <div className="flex-1 min-w-0 mx-1">
            <h2 className="text-sm font-bold text-white truncate">{media.title}</h2>
            <p className="text-[11px] text-slate-300 truncate">
              {isMovie
                ? `${typeLabel(media.type)}${media.year ? ` · ${media.year}` : ''}`
                : `${typeLabel(media.type)} · S${season} · E${currentEp?.number || epIndex + 1}${currentEp?.name ? ` — ${currentEp.name}` : ''}`}
            </p>
          </div>

          {/* Auto-Next toggle */}
          <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 pointer-events-auto shrink-0">
            <span className="text-xs font-semibold text-slate-200 hidden sm:inline">Auto-Next</span>
            <button
              onClick={() => setAutoNext(!autoNext)}
              className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 ${autoNext ? 'bg-rose-500' : 'bg-slate-700'}`}
              aria-label="Toggle auto-next"
            >
              <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ${autoNext ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Server switcher */}
          <div className="relative pointer-events-auto shrink-0">
            <button
              onClick={() => setShowServers((v) => !v)}
              className="flex items-center gap-1.5 bg-black/50 backdrop-blur-md px-3 py-2 rounded-full border border-white/10 text-slate-200 hover:bg-black/80 transition"
              title="Stream servers"
            >
              <Server className="w-4 h-4 text-rose-400" />
              <span className="text-xs font-semibold hidden md:inline">{activeServerName}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showServers ? 'rotate-180' : ''}`} />
            </button>

            {showServers && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowServers(false)} />
                <div className="absolute right-0 top-full mt-2 z-30 w-72 max-h-[70vh] overflow-y-auto rounded-xl bg-slate-900/97 border border-slate-700 shadow-2xl backdrop-blur-md p-2">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold px-2 py-1">
                    Stream Servers
                  </p>
                  {SERVERS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => pickServer(s.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between gap-2 transition ${
                        server === s.id
                          ? 'bg-rose-500/15 text-rose-300'
                          : 'text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="block text-xs font-bold truncate">{s.name}</span>
                          {s.adFree && (
                            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              Ad-free
                            </span>
                          )}
                        </span>
                        <span className="block text-[10px] text-slate-500 truncate">{s.tagline}</span>
                      </span>
                      {server === s.id && <span className="text-rose-400 text-sm shrink-0">●</span>}
                    </button>
                  ))}
                  <p className="text-[10px] text-slate-500 px-2 pt-1.5 pb-1 leading-relaxed">
                    Coco II &amp; Coco III are ad-free and switch instantly. Coco I reloads the player.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* RIGHT FLOATING CONTROLS — parked mid-height, far from the seek bar */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-3 pointer-events-none">
          <button
            onClick={toggleMute}
            className="w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center backdrop-blur-md hover:bg-black/80 pointer-events-auto"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5 text-white" />}
          </button>

          {!isMovie && (
            <>
              <button
                onClick={goToPrevEpisode}
                disabled={!hasPrev}
                className="w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center backdrop-blur-md disabled:opacity-40 hover:bg-black/80 pointer-events-auto"
                title="Previous episode"
              >
                <ChevronUp className="w-6 h-6" />
              </button>
              <button
                onClick={goToNextEpisode}
                disabled={!hasNext}
                className="w-10 h-10 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-500/30 disabled:opacity-40 hover:bg-rose-600 pointer-events-auto"
                title="Next episode"
              >
                <ChevronDown className="w-6 h-6" />
              </button>
            </>
          )}
        </div>

        {/* AUTO-NEXT COUNTDOWN */}
        {nextCountdown !== null && (
          <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in zoom-in-95 duration-150">
            <div className="bg-slate-900 border border-rose-500/50 p-5 rounded-2xl text-center shadow-2xl max-w-xs w-full">
              <Zap className="w-8 h-8 text-rose-400 mx-auto mb-2 animate-bounce" />
              <h3 className="text-base font-bold text-white">Next Episode Up Soon</h3>
              <p className="text-xs text-slate-400 mt-1">
                Episode {epIndex + 2} starts in <span className="text-rose-400 font-bold text-sm">{nextCountdown}s</span>
              </p>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setNextCountdown(null)}
                  className="flex-1 py-1.5 rounded-xl border border-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={goToNextEpisode}
                  className="flex-1 py-1.5 rounded-xl bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-500/20"
                >
                  Play Now
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
