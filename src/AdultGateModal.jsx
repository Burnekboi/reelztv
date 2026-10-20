import { useEffect } from 'react';
import { X, ShieldAlert, Check } from 'lucide-react';

// Age gate for the Adult section. Nothing loads until the visitor confirms;
// Esc / backdrop / the X all count as "take me back" (no confirmation stored).
export default function AdultGateModal({ onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Age verification"
      onClick={onCancel}
      className="fixed inset-0 z-[80] bg-black/92 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm max-h-[92vh] overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6 shadow-2xl text-center"
      >
        <button
          onClick={onCancel}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700 flex items-center justify-center transition"
          title="Take me back"
          aria-label="Close age verification"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center mb-3">
            <ShieldAlert className="w-7 h-7 text-amber-400" />
          </div>

          <span className="text-[11px] font-black tracking-[0.2em] uppercase text-amber-400">
            Adult content
          </span>
          <h2 className="text-lg font-bold text-slate-100 mt-1">Are you 18 or older?</h2>

          <p className="text-[13px] text-slate-400 mt-2.5 leading-relaxed">
            The Adult section contains sexually explicit material intended only for adults.
            By continuing you confirm that you are at least <strong className="text-slate-200">18 years old</strong>
            {' '}(or the age of majority where you live) and that viewing such material is legal
            in your location.
          </p>
        </div>

        <div className="flex flex-col gap-2 mt-5">
          <button
            onClick={onConfirm}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold transition shadow-lg shadow-amber-500/20"
          >
            <Check className="w-4 h-4" />
            I am 18 or older — Enter
          </button>
          <button
            onClick={onCancel}
            className="w-full px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition"
          >
            Take me back
          </button>
        </div>

        <p className="text-[10px] text-slate-500 mt-3 leading-relaxed">
          Your confirmation is stored on this device only and expires after 7 days. You can leave
          the section at any time.
        </p>
      </div>
    </div>
  );
}
