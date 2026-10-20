import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Copy, Check, Heart, ShieldCheck } from 'lucide-react';
import { DONATION_WALLETS } from './donation';

export default function DonationModal({ open, onClose }) {
  const [tab, setTab] = useState(DONATION_WALLETS[0].id);
  const [copied, setCopied] = useState(null);

  // Esc enters the site too.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const wallet = DONATION_WALLETS.find((w) => w.id === tab) || DONATION_WALLETS[0];

  const copyAddress = async () => {
    if (!wallet.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
    } catch {
      // Clipboard API needs a secure context; fall back to the old trick.
      try {
        const el = document.createElement('textarea');
        el.value = wallet.address;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      } catch {
        return; // nothing else we can do — the address is still on screen
      }
    }
    setCopied(wallet.id);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Support ReelzTV"
      className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md max-h-[92vh] overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6 shadow-2xl shadow-rose-500/10"
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700 flex items-center justify-center transition"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mb-3">
            <Heart className="w-6 h-6 text-rose-500 fill-rose-500/70" />
          </div>
          <h2 className="text-lg font-bold text-slate-100">Support ReelzTV</h2>
          <p className="text-[13px] text-slate-400 mt-1.5 leading-relaxed">
            ReelzTV is free, with no sign-up and no subscription. If you'd like to help cover
            server and API costs, you can send crypto to either address below. Thank you.
          </p>
        </div>

        {/* Coin tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950/70 border border-slate-800 mb-4">
          {DONATION_WALLETS.map((w) => (
            <button
              key={w.id}
              onClick={() => setTab(w.id)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition ${
                tab === w.id
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>

        {/* QR */}
        <div className="flex flex-col items-center">
          {wallet.address ? (
            <>
              <div className="p-3 bg-white rounded-2xl shadow-md">
                <QRCodeSVG
                  value={wallet.address}
                  size={160}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#09090b"
                  className="w-36 h-36 sm:w-40 sm:h-40"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-3 text-center">
                Scan with your {wallet.label} wallet app — {wallet.hint}
              </p>
            </>
          ) : (
            <div className="w-36 h-36 sm:w-40 sm:h-40 rounded-2xl border-2 border-dashed border-slate-700 flex flex-col items-center justify-center text-center p-3">
              <span className="text-[11px] text-slate-500 leading-relaxed">
                Add your {wallet.label} address in
                <br />
                <code className="text-rose-400">src/donation.js</code>
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 p-3 bg-slate-950/80 border border-slate-800 rounded-2xl">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[10px] font-bold tracking-wide uppercase text-slate-500">
              {wallet.network}
            </span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80" />
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] text-slate-300 font-mono break-all leading-snug">
              {wallet.address || '— no address set —'}
            </code>
            <button
              onClick={copyAddress}
              disabled={!wallet.address}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 text-[11px] font-semibold transition"
              title="Copy address"
            >
              {copied === wallet.id ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <button
            onClick={copyAddress}
            disabled={!wallet.address}
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 text-sm font-semibold transition"
          >
            Copy {wallet.label} address
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-sm font-bold shadow-lg shadow-rose-500/25 transition"
          >
            Enter site →
          </button>
        </div>

        <p className="text-[10px] text-slate-500 text-center mt-3">
          Crypto only — please double-check the network before sending.
        </p>
      </div>
    </div>
  );
}
