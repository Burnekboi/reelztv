import { useEffect, useRef, useState } from 'react';
import { X, Maximize2, Minimize2, ShieldAlert } from 'lucide-react';
import { resolveAdultEmbed } from './adult';

// Standalone player for the Adult section. It deliberately does not share
// PlayerModal with the Coco servers: adult items are a single external embed,
// with no episodes, providers or extractor messaging.
//
// Chrome matches the main player: close (Esc too), an overlay title bar and a
// fullscreen toggle — all overlays sit above the iframe, never over its seek bar.
export default function AdultPlayerModal({ item, onClose }) {
  const shellRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Items that only carry a provider id need one resolving round-trip; items
  // with an explicit embed_url are ready immediately. App mounts this with a
  // `key`, so a different video starts from fresh state.
  const [src, setSrc] = useState(item?.embedUrl || '');
  const [status, setStatus] = useState(item?.embedUrl ? 'ready' : 'resolving');

  useEffect(() => {
    if (!item || item.embedUrl) return undefined;

    let alive = true;
    resolveAdultEmbed(item)
      .then((url) => {
        if (!alive) return;
        setSrc(url || '');
        setStatus(url ? 'ready' : 'error');
      })
      .catch(() => {
        if (alive) setStatus('error');
      });

    return () => {
      alive = false;
    };
  }, [item]);

  // Esc closes the player (unless the browser is in fullscreen, where Esc exits
  // fullscreen first — the fullscreenchange listener keeps the icon in sync).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen();
    } catch {
      /* Fullscreen can be blocked by the browser; the embed has its own too. */
    }
  };

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black flex items-center justify-center select-none animate-in fade-in duration-200">
      <div
        ref={shellRef}
        className="relative w-full max-w-[1400px] aspect-video bg-black shadow-2xl overflow-hidden sm:rounded-2xl"
      >
        {status === 'ready' && src && (
          <iframe
            key={item.id}
            src={src}
            title={item.title}
            onLoad={() => setLoaded(true)}
            className="absolute inset-0 w-full h-full border-0 rounded-2xl bg-black"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}

        {/* Brief cover until the embed paints (removed on iframe load). */}
        {status === 'resolving' || (status === 'ready' && !loaded) ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black pointer-events-none">
            <div className="w-10 h-10 rounded-full border-2 border-rose-500/30 border-t-rose-500 animate-spin" />
            <p className="text-[11px] text-slate-400">
              {status === 'resolving' ? 'Preparing video…' : 'Loading…'}
            </p>
          </div>
        ) : null}

        {/* The provider refused / returned no playable embed. */}
        {status === 'error' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black px-6 text-center">
            <span className="bg-rose-600 text-white text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-md">
              Not Available
            </span>
            <p className="text-sm font-semibold text-slate-100">This video could not be loaded</p>
            <p className="text-[11px] text-slate-400">
              The provider did not return a playable embed for this title.
            </p>
          </div>
        )}

        {/* Overlay title bar — top only, so the embed's seek bar stays clear. */}
        <div className="absolute inset-x-0 top-0 z-20 p-3 bg-gradient-to-b from-black/90 via-black/45 to-transparent flex items-center gap-2 pointer-events-none">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center backdrop-blur-md hover:bg-black/80 transition pointer-events-auto shrink-0"
            title="Close"
            aria-label="Close player"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex-1 min-w-0 mx-1">
            <h2 className="text-sm font-bold text-white truncate">{item.title}</h2>
            <p className="text-[11px] text-slate-300 truncate flex items-center gap-1.5">
              <ShieldAlert className="w-3 h-3 text-amber-400 shrink-0" />
              <span>Adult · 18+</span>
              {item.duration ? <span className="text-slate-400">· {item.duration}</span> : null}
            </p>
          </div>

          <button
            onClick={toggleFullscreen}
            className="w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center backdrop-blur-md hover:bg-black/80 transition pointer-events-auto shrink-0"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4.5 h-4.5" /> : <Maximize2 className="w-4.5 h-4.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
