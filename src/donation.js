// ---------------------------------------------------------------------------
// Donation settings — edit this file to change your wallet addresses.
//
// Leave an address empty and that tab shows a reminder instead of a QR code,
// so a half-configured modal never reaches your visitors.
// ---------------------------------------------------------------------------
export const DONATION_WALLETS = [
  {
    id: 'bnb',
    label: 'BNB',
    network: 'BNB Smart Chain · BEP-20',
    hint: 'Binance, Trust Wallet, MetaMask…',
    address: '0x84f6e26c6eDAD398fAC97E84C7be14Bfc3bA1A23', // ← paste your BNB (BEP-20) address here
  },
  {
    id: 'sol',
    label: 'Solana',
    network: 'Solana · SOL',
    hint: 'Phantom, Solflare…',
    address: '7nNzTqAk3qUGeXtfr7zcYpi9CFPWoKY1g83N7pRNmkKh', // ← paste your Solana address here
  },
];

// The modal opens on a first visit, then at most once a week.
const SEEN_KEY = 'reelz_donation_seen_v1';
const SHOW_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldShowDonation() {
  try {
    const seenAt = Number(localStorage.getItem(SEEN_KEY) || 0);
    return Date.now() - seenAt > SHOW_AGAIN_MS;
  } catch {
    return true;
  }
}

export function rememberDonationSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    /* storage blocked — the modal will simply show again next visit */
  }
}
