import { useState } from 'react';
import { FiUser, FiImage } from 'react-icons/fi';

// Google Drive thumbnail URLs can fail due to CORS/referrer restrictions.
// Try multiple URL formats as fallbacks.
function driveImageUrl(url) {
  if (!url) return null;

  // If the URL is wrapped in a Google redirect (e.g. from Sheets version history
  // or copy-paste), unwrap and decode it first.
  let cleanUrl = url;
  const redirectMatch = url.match(/google\.com\/url\?q=(https?[^&]+)/);
  if (redirectMatch) {
    cleanUrl = decodeURIComponent(redirectMatch[1]);
  }

  // Extract file ID from various Drive URL formats
  let fileId = null;
  const thumbMatch = cleanUrl.match(/thumbnail\?id=([^&]+)/);
  const fileMatch = cleanUrl.match(/\/file\/d\/([^/]+)/);
  const ucMatch = cleanUrl.match(/uc\?.*id=([^&]+)/);
  if (thumbMatch) fileId = thumbMatch[1];
  else if (fileMatch) fileId = fileMatch[1];
  else if (ucMatch) fileId = ucMatch[1];

  if (fileId) {
    return `https://lh3.googleusercontent.com/d/${fileId}=s400`;
  }
  return url;
}

function DriveImage({ src, alt, className }) {
  const [error, setError] = useState(false);
  const primarySrc = driveImageUrl(src);

  // If the googleusercontent URL fails, try the direct export URL
  const cleanSrc = src && src.includes('google.com/url')
    ? decodeURIComponent((src.match(/q=(https?[^&]+)/) || [])[1] || src)
    : src;
  const fallbackSrc = cleanSrc && cleanSrc.includes('drive.google.com')
    ? cleanSrc.replace(/thumbnail\?id=([^&]+).*/, 'uc?export=view&id=$1')
    : null;

  if (error && fallbackSrc) {
    return <img src={fallbackSrc} alt={alt} className={className} />;
  }

  return (
    <img
      src={primarySrc || src}
      alt={alt}
      className={className}
      onError={() => setError(true)}
      referrerPolicy="no-referrer"
    />
  );
}

export default function PhotoDisplay({ formData, pendingHeadshot, pendingQrImage, onHeadshotClick, onQrClick, compact }) {
  const headshotSrc = pendingHeadshot || formData.headshotUrl;
  const qrImageSrc = pendingQrImage || formData.qrCodeImageUrl;
  const headshotUnsaved = !!pendingHeadshot;
  const qrUnsaved = !!pendingQrImage;

  // pending images are base64 data URLs, not Drive URLs
  const headshotIsDrive = !pendingHeadshot && !!formData.headshotUrl;
  const qrIsDrive = !pendingQrImage && !!formData.qrCodeImageUrl;

  return (
    <div className={`photo-display-row${compact ? ' photo-display-compact' : ''}`}>
      {/* Headshot — left */}
      <div
        className="photo-display-item"
        onClick={!headshotSrc && onHeadshotClick ? onHeadshotClick : undefined}
        style={!headshotSrc && onHeadshotClick ? { cursor: 'pointer' } : undefined}
        role={!headshotSrc && onHeadshotClick ? 'button' : undefined}
        title={!headshotSrc && onHeadshotClick ? 'Click to capture' : undefined}
      >
        <div className="photo-circle">
          {headshotSrc ? (
            headshotIsDrive
              ? <DriveImage key={headshotSrc} src={headshotSrc} alt="Headshot" />
              : <img src={headshotSrc} alt="Headshot" />
          ) : (
            <FiUser className="photo-placeholder-icon" />
          )}
        </div>
        {headshotUnsaved && <span className="photo-unsaved-badge">Unsaved</span>}
        <span className="photo-label">Headshot</span>
      </div>

      {/* QR Code — right */}
      <div
        className="photo-display-item"
        onClick={!qrImageSrc && onQrClick ? onQrClick : undefined}
        style={!qrImageSrc && onQrClick ? { cursor: 'pointer' } : undefined}
        role={!qrImageSrc && onQrClick ? 'button' : undefined}
        title={!qrImageSrc && onQrClick ? 'Click to capture' : undefined}
      >
        <div className="photo-rect">
          {qrImageSrc ? (
            qrIsDrive
              ? <DriveImage key={qrImageSrc} src={qrImageSrc} alt="QR Code" />
              : <img src={qrImageSrc} alt="QR Code" />
          ) : (
            <FiImage className="photo-placeholder-icon" />
          )}
        </div>
        {qrUnsaved && <span className="photo-unsaved-badge">Unsaved</span>}
        <span className="photo-label">QR Code</span>
      </div>
    </div>
  );
}
