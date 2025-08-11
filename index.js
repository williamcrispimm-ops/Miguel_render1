// Render 1 - Google Drive + keep-alive + debug/creds
const express = require('express');
const bodyParser = require('body-parser');
const { URL } = require('url');
const fs = require('fs');

let googleApi = null;
let driveClient = null;

async function getDrive() {
  if (driveClient) return driveClient;
  try {
    googleApi = googleApi || require('googleapis');
    const { google } = googleApi;
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/app/credentials.json';
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    driveClient = google.drive({ version: 'v3', auth });
    return driveClient;
  } catch (e) {
    console.warn('Google Drive não configurado:', e.message);
    return null;
  }
}

const ROOT_FOLDER_NAME = 'Miguel_Comprovantes';

async function getOrCreateFolder(drive, parentId, name) {
  const q = parentId
    ? `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await drive.files.list({ q, fields: 'files(id,name)' });
  if (res.data.files?.length) return res.data.files[0].id;
  const resource = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) resource.parents = [parentId];
  const folder = await drive.files.create({ resource, fields: 'id' });
  return folder.data.id;
}

function filename(date, desc, mime) {
  const ext = (mime?.split('/')?.[1] || 'dat').toLowerCase();
  const safe = (desc || 'comprovante').toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
  return `${date}_${safe}.${ext}`;
}

const app = express();
app.use(bodyParser.json({ limit: '20mb' }));

// HEALTH
app.get('/health', (req,res)=>{
  res.json({ ok: true, service: 'render_1', port: process.env.PORT || 3000, time: new Date().toISOString() });
});

// DEBUG CREDENTIALS
app.get('/debug/creds', (req, res) => {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/app/credentials.json';
  const exists = fs.existsSync(path);
  if (exists) {
    res.json({ ok: true, message: `Arquivo encontrado: ${path}` });
  } else {
    res.status(404).json({ ok: false, message: `Arquivo NÃO encontrado: ${path}` });
  }
});

// UPLOAD COMPROVANTE
app.post('/upload-comprovante', async (req,res)=>{
  try{
    const { userId, date, descricao, mimeType, fileBase64 } = req.body || {};
    if(!userId || !date || !mimeType || !fileBase64) {
      return res.status(400).json({error:'Missing params: userId, date, mimeType, fileBase64'});
    }

    const drive = await getDrive();
    if(!drive) return res.status(503).json({ error: 'Google Drive não configurado' });

    // raiz
    let root = await drive.files.list({
      q:`name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields:'files(id)'
    });
    let rootId = root.data.files?.[0]?.id;
    if(!rootId){
      const created = await drive.files.create({
        resource:{ name:ROOT_FOLDER_NAME, mimeType:'application/vnd.google-apps.folder' },
        fields:'id'
      });
      rootId = created.data.id;
    }

    // user -> mês
    const userFolder = await getOrCreateFolder(drive, rootId, String(userId));
    const monthFolder = await getOrCreateFolder(drive, userFolder, date.slice(0,7));

    const media = { mimeType, body: Buffer.from(fileBase64, 'base64') };
    const meta = { name: filename(date, descricao, mimeType), parents:[monthFolder] };
    const file = await drive.files.create({ resource: meta, media, fields: 'id, webViewLink, webContentLink' });

    res.json({ ok:true, id:file.data.id, view:file.data.webViewLink, download:file.data.webContentLink });
  }catch(e){
    console.error('upload error', e);
    res.status(500).json({ error: String(e?.message||e) });
  }
});

// KEEP-ALIVE
function startKeepAlive() {
  const raw = process.env.PING_URL || (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/health` : '');
  if (!raw) return;
  let urlObj;
  try { urlObj = new URL(raw); } catch { return; }
  const client = urlObj.protocol === 'https:' ? require('https') : require('http');
  const ping = () => {
    const req = client.get(raw, res => { res.resume(); });
    req.on('error', () => {});
  };
  setInterval(ping, 14 * 60 * 1000);
  setTimeout(ping, 20000);
}
startKeepAlive();

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Render_1 up on', PORT));

