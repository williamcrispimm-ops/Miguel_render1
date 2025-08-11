const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json({ limit: '20mb' }));

// --- Função para localizar o credentials.json ---
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

// --- Rotas de diagnóstico ---
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'render_1', time: new Date().toISOString() });
});

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

// --- Funções para encontrar/criar pastas ---
async function findOrCreateRootFolder(drive) {
  const q = "name = 'Miguel_Comprovantes' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const r = await drive.files.list({
    q,
    fields: 'files(id,name)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  if (r.data.files?.length) return r.data.files[0].id;

  const created = await drive.files.create({
    resource: { name: 'Miguel_Comprovantes', mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id;
}

async function getOrCreateFolder(drive, parentId, name) {
  const q = `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const r = await drive.files.list({
    q,
    fields: 'files(id,name)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  if (r.data.files?.length) return r.data.files[0].id;

  const created = await drive.files.create({
    resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id;
}

// --- Ping do Drive ---
app.get('/debug/drive/ping', async (req, res) => {
  try {
    const drive = await getDrive();
    const r = await drive.files.list({
      pageSize: 5,
      fields: 'files(id,name)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    res.json({ ok: true, files: r.data.files || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --- Upload de comprovante ---
app.post('/upload-comprovante', async (req, res) => {
  try {
    const { userId, date, descricao, mimeType, fileBase64 } = req.body;
    if (!userId || !date || !fileBase64) {
      return res.status(400).json({ ok: false, message: 'Parâmetros inválidos' });
    }

    const drive = await getDrive();
    const rootId = await findOrCreateRootFolder(drive);
    const userFolder = await getOrCreateFolder(drive, rootId, String(userId));
    const monthFolder = await getOrCreateFolder(drive, userFolder, date.slice(0, 7));

    const fileName = `${date}_${descricao || 'comprovante'}.${mimeType.split('/')[1] || 'png'}`;
    const file = await drive.files.create({
      resource: { name: fileName, parents: [monthFolder] },
      media: { mimeType, body: Buffer.from(fileBase64, 'base64') },
      fields: 'id, name, webViewLink',
      supportsAllDrives: true,
    });

    res.json({ ok: true, file: file.data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --- Inicialização ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Miguel Render 1 rodando na porta ${PORT}`);
});
