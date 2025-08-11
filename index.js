const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

// 🔍 Localiza o credentials.json em possíveis caminhos
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

// 🛠 Teste se credenciais foram encontradas
app.get('/debug/creds', (req, res) => {
  const found = resolveCredsPath();
  if (found) {
    res.json({ ok: true, message: `Arquivo encontrado: ${found}` });
  } else {
    res.status(404).json({ ok: false, message: 'credentials.json não encontrado' });
  }
});

let driveClient = null;

// 📂 Inicializa Google Drive
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

// 🏥 Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'render_1', time: new Date().toISOString() });
});

// 📤 Upload de comprovante no Google Drive
app.post('/upload-comprovante', async (req, res) => {
  try {
    const { userId, date, descricao, mimeType, fileBase64 } = req.body;

    if (!userId || !date || !descricao || !mimeType || !fileBase64) {
      return res.status(400).json({ ok: false, message: 'Campos obrigatórios: userId, date, descricao, mimeType, fileBase64' });
    }

    const drive = await getDrive();

    // 📂 Pasta raiz do usuário
    const folderName = `${userId}`;
    let folderId;
    const searchFolder = await drive.files.list({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)'
    });

    if (searchFolder.data.files.length) {
      folderId = searchFolder.data.files[0].id;
    } else {
      const folder = await drive.files.create({
        resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id'
      });
      folderId = folder.data.id;
    }

    // 📂 Subpasta do mês
    const monthFolderName = date.slice(0, 7);
    let monthFolderId;
    const searchMonthFolder = await drive.files.list({
      q: `'${folderId}' in parents and name='${monthFolderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)'
    });

    if (searchMonthFolder.data.files.length) {
      monthFolderId = searchMonthFolder.data.files[0].id;
    } else {
      const monthFolder = await drive.files.create({
        resource: { name: monthFolderName, mimeType: 'application/vnd.google-apps.folder', parents: [folderId] },
        fields: 'id'
      });
      monthFolderId = monthFolder.data.id;
    }

    // 📄 Upload do arquivo
    const fileName = `${date}_${descricao}.png`;
    const fileMetadata = { name: fileName, parents: [monthFolderId] };
    const media = { mimeType, body: Buffer.from(fileBase64, 'base64') };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink'
    });

    res.json({ ok: true, message: 'Arquivo enviado com sucesso', file: file.data });

  } catch (err) {
    console.error('Erro no upload:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 🚀 Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Miguel Render 1 rodando na porta ${PORT}`);
});

