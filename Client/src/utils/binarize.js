/**
 * Binarize pixels for colored QR codes (e.g. Messenger blue-on-white,
 * blue-on-black). Works by converting each pixel to a luminance value
 * using an adaptive threshold, then forcing pure black or white.
 * Blue (#0099FF-ish) has low luminance (~100) vs white (~255), so the
 * threshold separates them cleanly even when the QR isn't black.
 */
export function binarizeImageData(imageData) {
  const data = imageData.data;
  const len = data.length;

  // First pass: compute mean luminance for adaptive threshold
  let sum = 0;
  const count = len / 4;
  for (let i = 0; i < len; i += 4) {
    // ITU-R BT.601 luminance
    sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  const mean = sum / count;
  // Threshold biased toward the darker side so colored modules read as black
  const threshold = mean * 0.6;

  // Second pass: binarize
  for (let i = 0; i < len; i += 4) {
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const val = lum > threshold ? 255 : 0;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
    // alpha unchanged
  }
  return imageData;
}
