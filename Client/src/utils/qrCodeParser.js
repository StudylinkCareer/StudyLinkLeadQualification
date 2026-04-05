import QRCode from 'qrcode';

// QR content parser — detects social media platform from URL patterns

const PLATFORM_PATTERNS = [
  { medium: 'Messenger', patterns: [/m\.me\//i, /messenger\.com/i, /facebook\.com\/messages/i] },
  { medium: 'Facebook', patterns: [/facebook\.com/i, /fb\.com/i] },
  { medium: 'Zalo', patterns: [/zalo\.me/i, /zaloapp\.com/i, /chat\.zalo\.me/i] },
  { medium: 'WhatsApp', patterns: [/wa\.me/i, /whatsapp\.com/i] },
  { medium: 'Threads', patterns: [/threads\.net/i] },
  { medium: 'Instagram', patterns: [/instagram\.com/i, /instagr\.am/i] },
  { medium: 'Line', patterns: [/line\.me/i] },
  { medium: 'Telegram', patterns: [/t\.me\//i, /telegram\.me/i] },
  { medium: 'Viber', patterns: [/viber\.com/i] },
];

const PHONE_PATTERN = /^(?:tel:|(?:\+?\d[\d\s\-()]{6,}))$/;

/**
 * Parse QR code content and detect the social media platform.
 * m.me URLs → Messenger; facebook.com/fb.com → Facebook (also auto-fills facebookProfile).
 * @param {string} text — decoded QR string
 * @returns {{ medium: string|null, detail: string }}
 */
export function parseQrContent(text) {
  if (!text || typeof text !== 'string') {
    return { medium: null, detail: text || '' };
  }

  const trimmed = text.trim();

  // Check phone number pattern
  if (PHONE_PATTERN.test(trimmed)) {
    const digits = trimmed.replace(/^tel:/, '').trim();
    return { medium: 'Phone', detail: digits };
  }

  // Check social platform patterns
  for (const { medium, patterns } of PLATFORM_PATTERNS) {
    for (const re of patterns) {
      if (re.test(trimmed)) {
        return { medium, detail: trimmed };
      }
    }
  }

  // No match — user picks medium manually
  return { medium: null, detail: trimmed };
}

/**
 * Check if a URL is a Facebook profile URL (not Messenger).
 * @param {string} text
 * @returns {boolean}
 */
export function isFacebookUrl(text) {
  if (!text || typeof text !== 'string') return false;
  // Exclude Messenger conversation URLs (facebook.com/messages/*)
  if (/facebook\.com\/messages/i.test(text)) return false;
  return /facebook\.com/i.test(text) || /fb\.com/i.test(text);
}

/**
 * Generate a crisp QR code image from decoded text.
 * Returns a data URL (image/png) at the given size.
 * @param {string} text — the decoded QR content to re-encode
 * @param {number} [width=300] — output image width in pixels
 * @returns {Promise<string|null>} — data URL or null on failure
 */
export async function generateQrImage(text, width = 300) {
  if (!text || typeof text !== 'string') return null;
  try {
    return await QRCode.toDataURL(text, {
      width,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    return null;
  }
}

/**
 * Extract a display name from a social media URL path.
 * e.g. "https://facebook.com/john.smith" → "John Smith"
 * @param {string} url
 * @returns {string|null}
 */
export function extractNameFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    // Normalise to a URL object
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    // Take the last non-empty path segment
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    const slug = segments[segments.length - 1];
    // Ignore numeric-only slugs (e.g. profile IDs)
    if (/^\d+$/.test(slug)) return null;
    // Convert slug separators to spaces and title-case
    const name = slug
      .replace(/[._-]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return name || null;
  } catch {
    return null;
  }
}
