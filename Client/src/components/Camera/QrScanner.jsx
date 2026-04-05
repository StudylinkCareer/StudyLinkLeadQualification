import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import jsQR from 'jsqr';
import { generateQrImage } from '../../utils/qrCodeParser';
import { binarizeImageData } from '../../utils/binarize';
import './Camera.css';

const ENHANCED_SCAN_INTERVAL_MS = 300;

export default function QrScanner({ isOpen, onScan, onClose }) {
  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);
  const enhancedTimerRef = useRef(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    let html5Qr = null;
    let stopped = false;

    const startScanner = async () => {
      try {
        html5Qr = new Html5Qrcode('qr-reader');
        html5QrRef.current = html5Qr;

        const handleDecode = async (decodedText) => {
          if (stopped) return;
          stopped = true;

          if (enhancedTimerRef.current) {
            clearInterval(enhancedTimerRef.current);
            enhancedTimerRef.current = null;
          }

          const qrImageDataUrl = await generateQrImage(decodedText, 300);

          html5Qr.stop().catch(() => {}).finally(() => {
            html5QrRef.current = null;
            onScanRef.current(decodedText, qrImageDataUrl);
          });
        };

        await html5Qr.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          },
          handleDecode,
          () => {}
        );

        // Enhanced scanner for colored QR codes (blue Messenger, etc.)
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        enhancedTimerRef.current = setInterval(() => {
          if (stopped) return;

          const video = document.querySelector('#qr-reader video');
          if (!video || !video.videoWidth) return;

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          binarizeImageData(imageData);

          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            handleDecode(code.data);
          }
        }, ENHANCED_SCAN_INTERVAL_MS);
      } catch (err) {
        setError(err.message || 'Failed to start camera');
      }
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
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (enhancedTimerRef.current) {
      clearInterval(enhancedTimerRef.current);
      enhancedTimerRef.current = null;
    }
    if (html5QrRef.current) {
      html5QrRef.current.stop().catch(() => {});
      html5QrRef.current = null;
    }
    setError('');
    onClose();
  };

  return (
    <div className="camera-modal-overlay" onClick={handleClose}>
      <div className="camera-modal" onClick={(e) => e.stopPropagation()}>
        <div className="camera-header">
          <h3>Scan QR Code</h3>
          <button className="camera-close-btn" onClick={handleClose}>&times;</button>
        </div>
        <div className="camera-viewfinder">
          <div id="qr-reader" ref={scannerRef} />
        </div>
        {error && <div className="camera-error">{error}</div>}
        <p className="camera-hint">Point the camera at a QR code</p>
      </div>
    </div>
  );
}
