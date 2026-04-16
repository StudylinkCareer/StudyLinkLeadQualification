// server/src/routes/qr.js
// Proxy route for QR Code Monkey API — avoids browser CORS restrictions
// Uses native fetch (Node 18+) — no node-fetch dependency needed

const express = require('express');
const router  = express.Router();

router.post('/upload-logo', async (req, res, next) => {
  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer     = Buffer.from(base64Data, 'base64');
    const ext        = (mimeType || 'image/jpeg').split('/')[1] || 'jpg';
    const boundary   = '----FormBoundary' + Math.random().toString(36).slice(2);
    const CRLF       = '\r\n';
    const header     = `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="logo.${ext}"${CRLF}Content-Type: ${mimeType || 'image/jpeg'}${CRLF}${CRLF}`;
    const footer     = `${CRLF}--${boundary}--${CRLF}`;
    const body       = Buffer.concat([Buffer.from(header), buffer, Buffer.from(footer)]);

    const upRes = await fetch('https://api.qrcode-monkey.com/qr/uploadImage', {
      method:  'POST',
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    });

    if (!upRes.ok) {
      const txt = await upRes.text();
      return res.status(502).json({ error: `Logo upload failed: ${txt}` });
    }

    const json = await upRes.json();
    res.json(json);
  } catch (err) {
    next(err);
  }
});

router.post('/generate', async (req, res, next) => {
  try {
    const qrRes = await fetch('https://api.qrcode-monkey.com/qr/custom', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body),
    });

    if (!qrRes.ok) {
      const txt = await qrRes.text();
      return res.status(502).json({ error: `QR generation failed: ${txt}` });
    }

    const imgBuffer = Buffer.from(await qrRes.arrayBuffer());
    res.set('Content-Type', 'image/png');
    res.send(imgBuffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
