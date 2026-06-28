/**
 * HK Tag purchase-price calculation.
 *
 * Rule (example tag: HK3929892):
 *   1. Take the first three digits after "HK"  -> 392
 *   2. Reverse those digits                     -> 293
 *   3. Subtract 200                             -> 93
 *   Purchase Price = ₹93
 *
 * Returns a number when the tag is a valid HK tag, otherwise null
 * (caller should then require a manual purchase price).
 */
export function calcHkPurchasePrice(tag) {
  if (!tag || typeof tag !== 'string') return null;

  const trimmed = tag.trim();
  if (trimmed.slice(0, 2).toUpperCase() !== 'HK') return null;

  const digits = trimmed.slice(2).replace(/[^0-9]/g, '');
  if (digits.length < 3) return null;

  const firstThree = digits.slice(0, 3);
  const reversed = firstThree.split('').reverse().join('');
  const price = parseInt(reversed, 10) - 200;

  return Number.isFinite(price) ? price : null;
}

/** True when a code looks like an HK tag we can auto-price. */
export function isHkTag(code) {
  return calcHkPurchasePrice(code) !== null;
}
