const fs = require('fs');
const { google } = require('googleapis');

function resolveCredsPath() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    '/app/credentials.json',
    '/etc/secrets/credentials.json',
    '/opt/render/project/src/credentials.json'
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

app.get('/debug/creds', (req, res) => {
  const found = resolveCredsPath();
  if (found) {
    res.json({ ok: true, message: `Arquivo encontrado: ${found}` });
  } else {
    res.status(404).json({ ok: false, message: 'credentials.json não encontrado' });
  }
});

let driveClient = null;

async function getDrive() {
  if (driveClient) return driveClient;
  const keyFile = resolveCredsPath();
  if (!keyFile) throw new Error('credentials.json não encontrado');

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

