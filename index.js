// Render - Bloco 1 (upload / resgate comprovantes + endpoint básico)
const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
app.use(bodyParser.json({ limit: '20mb' }));

// Google Drive auth via service account JSON path from env var
const KEYFILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/path/to/credentials.json';
const auth = new google.auth.GoogleAuth({ keyFile: KEYFILE, scopes: ['https://www.googleapis.com/auth/drive'] });
const drive = google.drive({ version: 'v3', auth });

const ROOT_FOLDER_NAME = 'Miguel_Comprovantes';

// util: get or create folder by name under parent (parentId can be null)
async function getOrCreateFolder(parentId, folderName) {
  const q = parentId
    ? '${parentId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false
    : name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false;
  const res = await drive.files.list({ q, fields: 'files(id, name)' });
  if (res.data.files && res.data.files.length) return res.data.files[0].id;
  const metadata = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) metadata.parents = [parentId];
  const folder = await drive.files.create({ resource: metadata, fields: 'id' });
  return folder.data.id;
}

// mount filename safe
function montarNomeArquivo(date, descricao, extensao) {
  const descricaoClean = (descricao || 'comprovante').toString().toLowerCase().replace(/\s+/g,'').replace(/[^a-z0-9]/g,'');
  return ${date}_${descricaoClean}.${extensao};
}

// endpoint: upload comprovante (expects JSON: { userId, date: "YYYY-MM-DD", descricao, mimeType, fileBase64 })
app.post('/upload-comprovante', async (req, res) => {
  try {
    const { userId, date, descricao, mimeType, fileBase64 } = req.body;
    if (!userId || !date || !fileBase64 || !mimeType) return res.status(400).json({ error: 'Missing params' });

    // ensure root folder
    let rootSearch = await drive.files.list({
      q: name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false,
      fields: 'files(id)'
    });
    let rootId;
    if (rootSearch.data.files.length) rootId = rootSearch.data.files[0].id;
    else {
      const root = await drive.files.create({ resource: { name: ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }, fields: 'id' });
      rootId = root.data.id;
    }

    // user folder
    const userFolderId = await getOrCreateFolder(rootId, String(userId));
    // month folder YYYY-MM
    const month = date.slice(0,7);
    const monthFolderId = await getOrCreateFolder(userFolderId, month);

    const ext = (mimeType.split('/')[1] || 'dat');
    const filename = montarNomeArquivo(date, descricao, ext);
    const buffer = Buffer.from(fileBase64, 'base64');

    const fileMetadata = { name: filename, parents: [monthFolderId] };
    const media = { mimeType, body: buffer };

    const file = await drive.files.create({ resource: fileMetadata, media, fields: 'id, webViewLink' });

    // return link (webViewLink)
    return res.json({ ok: true, fileId: file.data.id, webViewLink: file.data.webViewLink || null });
  } catch (err) {
    console.error('upload error', err);
    return res.status(500).json({ error: err.message || err.toString() });
  }
});

// endpoint simples de health
app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(Render Bloco1 rodando na porta ${PORT}));
