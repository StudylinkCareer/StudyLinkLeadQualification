import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import jsQR from 'jsqr';
import { generateQrImage } from '../../utils/qrCodeParser';
import { binarizeImageData } from '../../utils/binarize';
import './Camera.css';

const SCAN_COOLDOWN_MS = 3000;
const ENHANCED_SCAN_INTERVAL_MS = 300;

/**
 * Always-on embedded QR scanner (renders directly in the page, not a modal).
 * Runs two decoders in parallel:
 *   1. html5-qrcode — fast, handles standard black-on-white QR codes
 *   2. jsQR on binarized frames — handles colored QR codes (blue Messenger, etc.)
 *      by adaptive-thresholding each frame to pure black/white before decoding
 * Props:
 *   onScan(decodedText, frameImageDataUrl) — called when a QR is decoded
 *   active — set to false to pause the scanner (e.g. when another camera is open)
 */
export default function InlineQrScanner({ onScan, active = true }) {
  const html5QrRef = useRef(null);
  const cooldownRef = useRef(false);
  const startedRef = useRef(false);
  const enhancedTimerRef = useRef(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) {
      if (enhancedTimerRef.current) {
        clearInterval(enhancedTimerRef.current);
        enhancedTimerRef.current = null;
      }
      if (html5QrRef.current) {
        html5QrRef.current.stop().catch(() => {});
        html5QrRef.current = null;
        startedRef.current = false;
      }
      return;
    }

    if (startedRef.current) return;

    let stopped = false;

    const startScanner = async () => {
      try {
        // Wait for DOM element to be ready
        await new Promise((r) => setTimeout(r, 300));
        if (stopped) return;

        const el = document.getElementById('qr-reader-inline');
        if (!el) return;

        const html5Qr = new Html5Qrcode('qr-reader-inline');
        html5QrRef.current = html5Qr;
        startedRef.current = true;

        const handleDecode = async (decodedText) => {
          if (stopped || cooldownRef.current) return;
          cooldownRef.current = true;

          const qrImageDataUrl = await generateQrImage(decodedText, 300);
          onScanRef.current(decodedText, qrImageDataUrl);

          setTimeout(() => {
            cooldownRef.current = false;
          }, SCAN_COOLDOWN_MS);
        };

        await html5Qr.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            qrbox: { width: 300, height: 300 },
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          },
          handleDecode,
          () => {}
        );

        // Start the enhanced scanner for colored QR codes
        startEnhancedScanner(stopped, handleDecode);
      } catch (err) {
        if (!stopped) {
          startedRef.current = false;
          setError(err.message || 'Camera access denied');
        }
      }
    };

    const startEnhancedScanner = (stoppedFlag, handleDecode) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      enhancedTimerRef.current = setInterval(() => {
        if (stoppedFlag || cooldownRef.current) return;

        const video = document.querySelector('#qr-reader-inline video');
        if (!video || !video.videoWidth) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        // Adaptive binarization: converts colored modules to pure black/white
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        binarizeImageData(imageData);

        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code && code.data) {
          handleDecode(code.data);
        }
      }, ENHANCED_SCAN_INTERVAL_MS);
    };

    startScanner();

    return () => {
      stopped = true;
      if (enhancedTimerRef.current) {
        clearInterval(enhancedTimerRef.current);
        enhancedTimerRef.current = null;
      }
      if (html5QrRef.current) {
        html5QrRef.current.stop().catch(() => {});
        html5QrRef.current = null;
        startedRef.current = false;
      }
    };
  }, [active]);

  return (
    <div className="inline-qr-scanner">
      <div id="qr-reader-inline" />
      {error && <div className="camera-error">{error}</div>}
      {!error && <p className="camera-hint">Point the camera at a QR code</p>}
    </div>
  );
}
