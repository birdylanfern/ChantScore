/** Share a score as a URL fragment (`#gabc=...`). Pure functions; no DOM access. */

const PREFIX = '#gabc=';
/** Keep links comfortably below common URL length limits. */
export const MAX_SHARE_FRAGMENT_LENGTH = 60000;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeShareFragment(gabc: string): string | null {
  const fragment = PREFIX + toBase64Url(new TextEncoder().encode(gabc));
  return fragment.length <= MAX_SHARE_FRAGMENT_LENGTH ? fragment : null;
}

export function decodeShareFragment(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(hash.slice(PREFIX.length)));
    return text.includes('%%') || /\([a-mA-M,;:z]/.test(text) ? text : null;
  } catch {
    return null;
  }
}

let consumed: { gabc: string | null } | null = null;

/**
 * Read a shared score from the page URL exactly once (safe under repeated
 * calls), remove the fragment so a refresh does not re-import it, and return
 * the GABC text. `confirmReplace` is asked first when there is existing work.
 */
export function consumeSharedGabc(hasExistingWork: boolean, confirmReplace: () => boolean): string | null {
  if (consumed) return consumed.gabc;
  consumed = { gabc: null };
  if (typeof window === 'undefined') return null;
  const gabc = decodeShareFragment(window.location.hash);
  if (!gabc) return null;
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    /* ignore */
  }
  if (hasExistingWork && !confirmReplace()) return null;
  consumed.gabc = gabc;
  return gabc;
}

export function buildShareUrl(gabc: string, base: string): string | null {
  const fragment = encodeShareFragment(gabc);
  if (!fragment) return null;
  return base.split('#')[0] + fragment;
}
