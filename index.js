// index.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { Readable } = require('stream');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

const PORT = process.env.PORT || 3000;
const OAUTH_TOKEN_PATH = process.env.OAUTH_TOKEN_PATH || '/tmp/oauth_token.json';

// ---------- OAuth Helpers ----------
function loadOAuthWebCreds() {
  const p = process.env.OAUTH_CLIENT_JSON || '';
  if (p && fs.existsSync(p)) {
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return j.web;
  }
  const web = {
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uris: [process.env.GOOGLE_OAUTH_REDIRECT_URI],
  };
  if (web.client_id && web.client_secret && web.redirect_uris[0]) return web;
  throw new Error('Credenciais OAuth não configuradas.');
}

function makeOAuth2Client() {
  const web = loadOAuthWebCreds();
  const { client_id, client_secret, redirect_uris } = web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  if (fs.existsSync(OAUTH_TOKEN_PATH)) {
    oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(OAUTH_TOKEN_PATH, 'utf-8')));
  }
  return oAuth2Client;
}

// ---------- Auth Routes ----------
app.get('/auth/start', (req, res) => {
  try {
    const oAuth2Client = makeOAuth2Client();
    const scopes = ['https://www.googleapis.com/auth/drive.file'];
    const url = oAuth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes });
    res.redirect(url);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const oAuth2Client = makeOAuth2Client();
    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(tokens), 'utf-8');
    oAuth2Client.setCredentials(tokens);
    res.send(`<pre>✅ Autorizado! Token salvo.\nAgora pode testar o upload.\n${JSON.stringify(tokens, null, 2)}</pre>`);
  } catch (e) {
    res.status(500).send(`<pre>Erro no callback: ${String(e?.message || e)}</pre>`);
  }
});

app.get('/auth/status', (req, res) => {
  const ok = fs.existsSync(OAUTH_TOKEN_PATH);
  res.json({ ok, tokenPath: OAUTH_TOKEN_PATH });
});

// ---------- Drive Helpers ----------
async function getDrive() {
  if (fs.existsSync(OAUTH_TOKEN_PATH)) {
    const oAuth2Client = makeOAuth2Client();
    return google.drive({ version: 'v3', auth: oAuth2Client });
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: '/etc/secrets/credentials.json',
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

async function findOrCreateRootFolder(drive) {
  const envRoot = process.env.ROOT_FOLDER_ID;
  if (envRoot) {
    const r = await drive.files.get({
      fileId: envRoot,
      fields: 'id, name',
      supportsAllDrives: true,
    });
    return r.data.id;
  }
  const q = "name = 'Miguel_Comprovantes' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const r = await drive.files.list({
    q,
    fields: 'files(id,name)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  if (r.data.files?.length) return r.data.files[0].id;
  const folder = await drive.files.create({
    requestBody: { name: 'Miguel_Comprovantes', mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
    supportsAllDrives: true,
  });
  return folder.data.id;
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
  const folder = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  return folder.data.id;
}

// ---------- Upload Endpoint ----------
app.post('/upload-comprovante', async (req, res) => {
  try {
    const { userId, date, descricao, mimeType, fileBase64 } = req.body || {};
    if (!userId || !date || !fileBase64) {
      return res.status(400).json({ ok: false, error: 'Campos obrigatórios: userId, date, fileBase64' });
    }
    const ext = (mimeType && mimeType.split('/')[1]) || 'png';
    const safeDesc = (descricao || 'comprovante').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/g, '');
    const fileName = `${date}_${safeDesc}.${ext}`;

    const drive = await getDrive();
    const rootId = await findOrCreateRootFolder(drive);
    const userFolder = await getOrCreateFolder(drive, rootId, String(userId));
    const monthFolder = await getOrCreateFolder(drive, userFolder, date.slice(0, 7));

    const buf = Buffer.from(fileBase64, 'base64');
    const file = await drive.files.create({
      requestBody: { name: fileName, parents: [monthFolder] },
      media: { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buf) },
      fields: 'id,name,webViewLink,parents',
      supportsAllDrives: true
    });

    res.json({ ok: true, uploaded: file.data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------- Página de teste simples ----------
app.get('/test', (req, res) => {
  res.send(`
    <form method="POST" action="/upload-comprovante" enctype="application/json" onsubmit="sendFile(event)">
      <input type="text" id="userId" placeholder="User ID" required><br>
      <input type="date" id="date" required><br>
      <input type="text" id="descricao" placeholder="Descrição"><br>
      <input type="file" id="file" required><br>
      <button type="submit">Enviar</button>
    </form>
    <pre id="out"></pre>
    <script>
    async function sendFile(e){
      e.preventDefault();
      const file = document.getElementById('file').files[0];
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const body = {
          userId: document.getElementById('userId').value,
          date: document.getElementById('date').value,
          descricao: document.getElementById('descricao').value,
          mimeType: file.type,
          fileBase64: base64
        };
        const res = await fetch('/upload-comprovante', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        document.getElementById('out').textContent = JSON.stringify(await res.json(), null, 2);
      };
      reader.readAsDataURL(file);
    }
    </script>
  `);
});

// ---------- Ping ----------
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'render_1', port: PORT, time: new Date().toISOString() });
});

app.listen(PORT, () => console.log(`Miguel Render 1 rodando na porta ${PORT}`));
