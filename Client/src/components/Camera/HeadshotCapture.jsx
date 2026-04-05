import { useEffect, useRef, useState, useCallback } from 'react';
import './Camera.css';

const CAPTURE_SIZE = 480;
const JPEG_QUALITY = 0.85;

export default function HeadshotCapture({ isOpen, onCapture, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [videoDims, setVideoDims] = useState({ w: 1, h: 1 });

  // Draw video to canvas — shows full frame with circle guide
  const drawFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) {
      animFrameRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    const cw = canvas.width;
    const ch = canvas.height;
    const ctx = canvas.getContext('2d');

    // Draw full video frame, mirrored for selfie
    ctx.save();
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, vw, vh, 0, 0, cw, ch);
    ctx.restore();

    // Draw circular guide in center — circle fits the shorter dimension
    const guideRadius = Math.min(cw, ch) * 0.4;
    const cx = cw / 2;
    const cy = ch / 2;

    // Darken everything outside the circle
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.arc(cx, cy, guideRadius, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.restore();

    // Thin circle outline
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, guideRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    animFrameRef.current = requestAnimationFrame(drawFrame);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setCameraReady(false);
      setError('');
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch { /* autoplay handles it */ }
      }
    } catch (err) {
      setError(err.message || 'Failed to access camera');
    }
  }, []);

  const stopStream = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    startCamera();
    return () => stopStream();
  }, [isOpen, startCamera, stopStream]);

  // Start drawing loop when camera is ready
  useEffect(() => {
    if (cameraReady && !preview) {
      animFrameRef.current = requestAnimationFrame(drawFrame);
    }
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [cameraReady, preview, drawFrame]);

  const handleVideoReady = () => {
    const video = videoRef.current;
    if (video && video.videoWidth && video.videoHeight) {
      setVideoDims({ w: video.videoWidth, h: video.videoHeight });
    }
    setCameraReady(true);
  };

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // Center-crop a square from the raw video frame (no mirror — mirror on Accept)
    const cropSize = Math.min(vw, vh);
    const cropX = Math.round((vw - cropSize) / 2);
    const cropY = Math.round((vh - cropSize) / 2);

    const offscreen = document.createElement('canvas');
    offscreen.width = CAPTURE_SIZE;
    offscreen.height = CAPTURE_SIZE;
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
    setPreview(offscreen.toDataURL('image/jpeg', JPEG_QUALITY));
  };

  const handleRetake = async () => {
    setPreview(null);
    await startCamera();
  };

  const handleAccept = () => {
    stopStream();
    const img = new Image();
    img.onload = () => {
      const offscreen = document.createElement('canvas');
      offscreen.width = CAPTURE_SIZE;
      offscreen.height = CAPTURE_SIZE;
      const ctx = offscreen.getContext('2d');
      ctx.translate(CAPTURE_SIZE, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
      onCapture(offscreen.toDataURL('image/jpeg', JPEG_QUALITY));
      setPreview(null);
    };
    img.src = preview;
  };

  const handleClose = () => {
    stopStream();
    setPreview(null);
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  // Canvas resolution matches video aspect ratio, max 400px wide
  const maxW = 400;
  const aspect = videoDims.h / videoDims.w;
  const canvasW = maxW;
  const canvasH = Math.round(maxW * aspect);

  return (
    <div className="camera-modal-overlay" onClick={handleClose}>
      <div className="camera-modal" onClick={(e) => e.stopPropagation()}>
        <div className="camera-header">
          <h3>Take Headshot</h3>
          <button className="camera-close-btn" onClick={handleClose}>&times;</button>
        </div>

        <div className="headshot-canvas-wrap">
          {/* Hidden video — only used as source for canvas drawing */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={handleVideoReady}
            style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
          />

          {!preview ? (
            <canvas
              ref={canvasRef}
              width={canvasW}
              height={canvasH}
              className="headshot-canvas"
            />
          ) : (
            <div className="headshot-preview-wrap">
              <img src={preview} alt="Headshot preview" className="headshot-preview-img" />
              <div className="circular-crop-guide" />
            </div>
          )}
        </div>

        {error && <div className="camera-error">{error}</div>}

        <div className="camera-actions">
          {!preview ? (
            <button
              className="btn btn--primary camera-capture-btn"
              onClick={handleCapture}
              disabled={!cameraReady}
            >
              Capture
            </button>
          ) : (
            <>
              <button className="btn btn--secondary" onClick={handleRetake}>Retake</button>
              <button className="btn btn--primary" onClick={handleAccept}>Accept</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
