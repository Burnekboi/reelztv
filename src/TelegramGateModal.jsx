import { useEffect, useState } from 'react';
import { X, Send, ExternalLink, Check } from 'lucide-react';
import { TELEGRAM_INVITE, GATE_WAIT_SECONDS } from './telegramGate';

// Soft "join our Telegram" gate shown before playback starts. There is no
// backend, so we can't confirm membership — instead the visitor is sent to the
// channel and has to sit out a short countdown before "Continue" unlocks.
// Closing the gate cancels the play (no unlock). The parent mounts this only
// while it's open, so state starts fresh every time.
export default function TelegramGate({ onPassed, onClose }) {
  const [tapped, setTapped] = useState(false);
  const [left, setLeft] = useState(GATE_WAIT_SECONDS);

  // Esc cancels, same as clicking the backdrop.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Countdown only runs once the visitor has tapped through to Telegram.
  useEffect(() => {
    if (!tapped || left <= 0) return undefined;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [tapped, left]);

  const ready = tapped && left <= 0;
  const continueLabel = ready
    ? 'Continue to video →'
    : tapped
      ? `Continue in ${left}s…`
      : 'Join Telegram to continue';

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Join our Telegram community"
      className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md max-h-[92vh] overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6 shadow-2xl shadow-sky-500/10 text-center"
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700 flex items-center justify-center transition"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center mb-5">
          <div className="w-12 h-12 rounded-2xl bg-[#229ED9]/15 border border-[#229ED9]/40 flex items-center justify-center mb-3">
            <Send className="w-6 h-6 text-[#3BB0E5]" />
          </div>
          <h2 className="text-lg font-bold text-slate-100">Join our Telegram community</h2>
          <p className="text-[13px] text-slate-400 mt-1.5 leading-relaxed">
            ReelzTV is free, with no sign-up and no subscription. Our Telegram channel is where
            new releases and working servers land first — join it to start watching.
          </p>
        </div>

        <a
          href={TELEGRAM_INVITE}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setTapped(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#229ED9] hover:bg-[#1e8ec4] text-white text-sm font-bold transition shadow-lg shadow-sky-500/20"
        >
          {tapped ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          {tapped ? 'Telegram opened' : 'Join Telegram Channel'}
          <ExternalLink className="w-3.5 h-3.5 opacity-70" />
        </a>

        <button
          onClick={onPassed}
          disabled={!ready}
          className="mt-2.5 w-full px-4 py-3 rounded-xl bg-rose-500 hover:bg-rose-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:hover:bg-slate-800 text-white text-sm font-bold shadow-lg shadow-rose-500/25 transition"
        >
          {continueLabel}
        </button>

        <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
          Tap <span className="font-semibold text-slate-400">Join Telegram Channel</span> first —
          the button above unlocks a few seconds later. You won&apos;t be asked again for 24 hours.
        </p>
      </div>
    </div>
  );
}
