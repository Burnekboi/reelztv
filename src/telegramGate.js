// ---------------------------------------------------------------------------
// Telegram community gate — edit the invite link / wait time here.
//
// Videos only start once a visitor has been through the "join our Telegram"
// screen. A static site has no way to *verify* a Telegram membership (that
// needs a bot token living on a server), so this is an honour-system gate with
// a short enforced wait: it reliably sends real visitors to the channel without
// adding a backend. Passing it is remembered on the device for 24 hours.
// ---------------------------------------------------------------------------
export const TELEGRAM_INVITE = 'https://t.me/reelztvchannel';

// Remembered unlock (per device, 24h).
const UNLOCK_KEY = 'reelz_telegram_unlock_v1';
const UNLOCK_MS = 24 * 60 * 60 * 1000;

// Seconds to wait on the gate screen before "Continue" unlocks.
export const GATE_WAIT_SECONDS = 10;

export function isTelegramUnlocked() {
  try {
    const at = Number(localStorage.getItem(UNLOCK_KEY) || 0);
    return Date.now() - at < UNLOCK_MS;
  } catch {
    // Storage blocked (private mode): fail closed so the gate still works.
    return false;
  }
}

export function rememberTelegramUnlock() {
  try {
    localStorage.setItem(UNLOCK_KEY, String(Date.now()));
  } catch {
    /* storage blocked — the gate will simply show again on the next play */
  }
}
