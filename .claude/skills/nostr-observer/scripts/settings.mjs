// Reading settings: text size, contrast and motion. living.js carries this
// constant and function byte for byte (test/settings.test.mjs holds it to that).

export const READING_SIZES = [100, 112, 125, 150]

// What was saved is untrusted: only our own keys, own properties and known
// values count. What the reader has not chosen follows the device.
export function readingSettings (saved, device) {
  const ok = saved && typeof saved === 'object' && !Array.isArray(saved)
  const own = (key) => (ok && Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : undefined)
  const size = READING_SIZES.includes(own('size')) ? own('size') : 100
  const contrast = own('contrast') === 'high' || own('contrast') === 'standard' ? own('contrast') : device && device.moreContrast ? 'high' : 'standard'
  const motion = own('motion') === 'reduced' || own('motion') === 'full' ? own('motion') : device && device.reducedMotion ? 'reduced' : 'full'
  return { size, contrast, motion }
}
