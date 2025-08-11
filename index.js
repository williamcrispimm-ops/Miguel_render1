// index.js — Service Account + pasta compartilhada (ROOT_FOLDER_ID)
const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const { Readable } = require('stream');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));
const PORT = process.env.PORT || 3000;

// 🔐 Google Drive via Service Account (Secret File do Render)
async function getDrive() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || '/etc/secrets/credentials.json',
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

// ✅ usa ROOT_FOLDER_ID (obrigatório) — a pasta já deve estar compartilhada com a SA
async function getRootFolderId(drive) {
  const rootId = process.env.ROOT_FOLDER_ID;
  if (!rootId) throw new Error('Defina ROOT_FOLDER_ID (ID da pasta raiz compartilhada no Drive).');
  // valida existência/permissão
  await drive.files.get({ fileId: rootId, fields: 'id,name', supportsAllDrives: true });
  return rootId;
}

// 🔧 cria/obtém subpasta por nome dentro de parentId
async function getOrCreateFolder(drive, parentId, name) {
  const r = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  if (r.data.files?.length) return r.data.files[0].id;

  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id;
}

// 🧪 saúde
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'render_sa', time: new Date().toISOString() });
});

// 🧪 lista arquivos do mês
app.get('/debug/drive/list', async (req, res) => {
  try {
    const { userId, month } = req.query;
    if (!userId || !month) return res.status(400).json({ ok: false, error: 'Informe userId e month=YYYY-MM' });

    const drive = await getDrive();
    const rootId = await getRootFolderId(drive);
    const userFolder = await getOrCreateFolder(drive, rootId, String(userId));
    const monthFolder = await getOrCreateFolder(drive, userFolder, month);

    const r = await drive.files.list({
      q: `'${monthFolder}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,webViewLink,createdTime)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 100,
    });
    res.json({ ok: true, folderId: monthFolder, files: r.data.files || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 📤 upload de comprovante (cria <userId>/<AAAA-MM>/ e envia o arquivo)
app.post('/upload-comprovante', async (req, res) => {
  try {
    const { userId, date, descricao, mimeType, fileBase64 } = req.body || {};
    if (!userId || !date || !fileBase64) {
      return res.status(400).json({ ok: false, error: 'Campos obrigatórios: userId, date, fileBase64' });
    }

    const ext = (mimeType && mimeType.split('/')[1]) || 'png';
    const safeDesc = (descricao || 'comprovante')
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_.-]/g, '');
    const fileName = `${date}_${safeDesc}.${ext}`;

    const drive = await getDrive();
    const rootId = await getRootFolderId(drive);

    // pastas: user -> mês
    const userFolder = await getOrCreateFolder(drive, rootId, String(userId));
    const monthFolder = await getOrCreateFolder(drive, userFolder, date.slice(0, 7));

    // base64 -> stream
    const buf = Buffer.from(fileBase64, 'base64');
    if (!buf?.length) return res.status(400).json({ ok: false, error: 'fileBase64 inválido ou vazio' });

    const file = await drive.files.create({
      requestBody: { name: fileName, parents: [monthFolder] },
      media: { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buf) },
      fields: 'id,name,mimeType,webViewLink,parents',
      supportsAllDrives: true,
    });

    res.json({ ok: true, uploaded: file.data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 🧪 página de teste (mesma origem, sem CORS)
app.get('/test', (_req, res) => {
  res.type('html').send(`<!doctype html>
<meta charset="utf-8">
<title>Teste Upload (SA)</title>
<body style="font-family:system-ui;padding:20px;max-width:800px;margin:auto">
<h2>Teste Upload — Service Account + Pasta compartilhada</h2>
<form id="f">
  <label>User ID</label><br><input id="userId" value="123456789"><br><br>
  <label>Data (AAAA-MM-DD)</label><br><input id="date" value="2025-08-11"><br><br>
  <label>Descrição</label><br><input id="descricao" value="compra_teste"><br><br>
  <label>Arquivo</label><br><input type="file" id="file" accept="image/*,application/pdf"><br><br>
  <button>Enviar</button>
</form>
<h3>Resposta</h3>
<pre id="out"></pre>
<script>
const out = document.getElementById('out');
document.getElementById('f').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const file = document.getElementById('file').files[0];
  if(!file){ out.textContent='Selecione um arquivo.'; return; }
  const r = new FileReader();
  r.onload = async () => {
    const base64 = r.result.split(',')[1];
    const payload = {
      userId: document.getElementById('userId').value.trim(),
      date: document.getElementById('date').value.trim(),
      descricao: document.getElementById('descricao').value.trim(),
      mimeType: file.type || 'application/octet-stream',
      fileBase64: base64
    };
    out.textContent = 'Enviando...';
    const resp = await fetch('/upload-comprovante', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const text = await resp.text();
    try{ out.textContent = JSON.stringify(JSON.parse(text), null, 2); }
    catch{ out.textContent = text; }
  };
  r.readAsDataURL(file);
});
</script>
</body>`);
});

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'render_sa', time: new Date().toISOString() });
});

app.listen(PORT, () => console.log(`🚀 Render SA rodando na porta ${PORT}`));
