// Safe index.js for Render 1 - avoids crashing on missing credentials
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json({ limit: '20mb' }));

// Lazy load Google only when endpoint is hit, and handle missing creds gracefully
let googleApis = null;
let driveClient = null;

async function getDrive() {
  if (driveClient) return driveClient;
  try {
    googleApis = googleApis || require('googleapis');
    const { google } = googleApis;
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/app/credentials.json';
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });
    driveClient = drive;
    return drive;
  } catch (err) {
    console.error('Google Drive init error:', err.message);
    return null; // do not crash app
  }
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'render_1', port: process.env.PORT || 3000 });
});

// Minimal route that doesn't crash if Drive not configured
app.post('/upload-comprovante', async (req, res) => {
  const drive = await getDrive();
  if (!drive) {
    return res.status(503).json({ error: 'Google Drive não configurado. Suba o credentials.json ou defina GOOGLE_APPLICATION_CREDENTIALS.' });
  }
  // Only echo payload to prove server is alive; implement full upload later
  const { userId, date, descricao, mimeType } = req.body || {};
  return res.json({ ok: true, received: { userId, date, descricao, mimeType } });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Render_1 running on port', PORT);
});
