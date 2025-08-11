const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

// 🔹 Autenticação Google Drive
async function getDrive() {
  const auth = new google.auth.GoogleAuth({
    keyFile: '/etc/secrets/credentials.json',
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

// 🔹 Garantir que a pasta raiz existe
async function findOrCreateRootFolder(drive) {
  const rootName = 'Miguel_Comprovantes';
  const r = await drive.files.list({
    q: name='${rootName}' and mimeType='application/vnd.google-apps.folder' and trashed=false,
    fields: 'files(id,name)',
  });
  if (r.data.files.length > 0) return r.data.files[0].id;

  const folder = await drive.files.create({
    resource: { name: rootName, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  return folder.data.id;
}

// 🔹 Criar pasta (ou obter ID) dentro de outra pasta
async function getOrCreateFolder(drive, parentId, folderName) {
  const r = await drive.files.list({
    q: '${parentId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false,
    fields: 'files(id,name)',
  });
  if (r.data.files.length > 0) return r.data.files[0].id;

  const folder = await drive.files.create({
    resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return folder.data.id;
}

// 🔹 Upload de comprovante
app.post('/upload-comprovante', async (req, res) => {
  try {
    const { userId, date, descricao, mimeType, fileBase64 } = req.body || {};
    console.log("📩 BODY RECEBIDO:", req.body);
    console.log("📏 Tamanho Base64:", fileBase64?.length || 0);

    if (!userId || !date || !fileBase64) {
      return res.status(400).json({ ok: false, error: 'Campos obrigatórios: userId, date, fileBase64' });
    }

    const ext = (mimeType && mimeType.split('/')[1]) || 'png';
    const safeDesc = (descricao || 'comprovante').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9.-]/g, '');
    const fileName = ${date}_${safeDesc}.${ext};

    const drive = await getDrive();
    const rootId = await findOrCreateRootFolder(drive);
    const userFolder = await getOrCreateFolder(drive, rootId, String(userId));
    const monthFolder = await getOrCreateFolder(drive, userFolder, date.slice(0, 7));

    let buf;
    try {
      buf = Buffer.from(fileBase64, 'base64');
      if (!buf || !buf.length) throw new Error('Base64 vazio');
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'fileBase64 inválido' });
    }

    const file = await drive.files.create({
      resource: { name: fileName, parents: [monthFolder] },
      media: { mimeType: mimeType || 'application/octet-stream', body: buf },
      fields: 'id,name,mimeType,webViewLink,parents',
      supportsAllDrives: true,
    });

    res.json({ ok: true, uploaded: file.data });
  } catch (e) {
    console.error("❌ ERRO UPLOAD:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 🔹 Listar arquivos de um mês
app.get('/debug/drive/list', async (req, res) => {
  try {
    const { userId, month } = req.query;
    if (!userId || !month) {
      return res.status(400).json({ ok: false, error: 'Informe userId e month=YYYY-MM' });
    }

    const drive = await getDrive();
    const rootId = await findOrCreateRootFolder(drive);
    const userFolder = await getOrCreateFolder(drive, rootId, String(userId));
    const monthFolder = await getOrCreateFolder(drive, userFolder, month);

    const r = await drive.files.list({
      q: '${monthFolder}' in parents and trashed = false,
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

// 🔹 Página de teste (mesma origem, sem CORS)
app.get('/test', (_req, res) => {
  res.type('html').send(`
<!doctype html>
<meta charset="utf-8">
<title>Teste Upload</title>
<body style="font-family:system-ui;padding:20px;max-width:800px;margin:auto">
<h2>Teste Upload de Comprovante (mesma origem)</h2>
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

// 🔹 Teste de vida
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'render_1', time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(🚀 Miguel Render 1 rodando na porta ${PORT}));
