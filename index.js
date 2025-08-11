const express = require('express');
const bodyParser = require('body-parser');
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Readable } = require('stream');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,                   // R2 endpoint SEM nome do bucket
  forcePathStyle: true,                                // importante para R2
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
});
const BUCKET = process.env.S3_BUCKET;

const safe = s => String(s||'').toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_.-]/g,'');

app.get('/health', (req,res)=>res.json({ok:true,storage:'cloudflare-r2',bucket:BUCKET,time:new Date().toISOString()}));

// Página de teste (mesma origem)
app.get('/test', (_req, res) => {
  res.type('html').send(`<!doctype html>
<meta charset="utf-8"><title>Teste Upload (R2)</title>
<body style="font-family:system-ui;padding:20px;max-width:800px;margin:auto">
<h2>Upload — Cloudflare R2</h2>
<form id="f">
  <label>User ID</label><br><input id="userId" value="123456789"><br><br>
  <label>Data (AAAA-MM-DD)</label><br><input id="date" value="2025-08-11"><br><br>
  <label>Descrição</label><br><input id="descricao" value="compra_teste"><br><br>
  <label>Arquivo</label><br><input type="file" id="file" accept="image/*,application/pdf"><br><br>
  <button>Enviar</button>
</form>
<h3>Resposta</h3><pre id="out"></pre>
<script>
const out = document.getElementById('out');
document.getElementById('f').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const file = document.getElementById('file').files[0];
  if(!file){ out.textContent='Selecione um arquivo.'; return; }
  const r = new FileReader();
  r.onload = async () => {
    const base64 = r.result.split(',')[1];
    const body = {
      userId: document.getElementById('userId').value.trim(),
      date: document.getElementById('date').value.trim(),
      descricao: document.getElementById('descricao').value.trim(),
      mimeType: file.type || 'application/octet-stream',
      fileBase64: base64
    };
    out.textContent = 'Enviando...';
    const resp = await fetch('/upload-comprovante', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body)
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

// Upload — grava em: <userId>/<AAAA-MM>/<date>_<descricao>.<ext>
app.post('/upload-comprovante', async (req, res) => {
  try {
    const { userId, date, descricao, mimeType, fileBase64 } = req.body || {};
    if (!userId || !date || !fileBase64) {
      return res.status(400).json({ ok: false, error: 'Campos obrigatórios: userId, date, fileBase64' });
    }
    const ext = (mimeType && mimeType.includes('/') ? mimeType.split('/')[1] : 'bin');
    const key = `${String(userId)}/${date.slice(0,7)}/${date}_${safe(descricao||'comprovante')}.${ext}`;

    const buf = Buffer.from(fileBase64, 'base64');
    if (!buf?.length) return res.status(400).json({ ok: false, error: 'fileBase64 inválido' });

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: Readable.from(buf),
      ContentType: mimeType || 'application/octet-stream'
    }));

    // URL de leitura (assinada por 24h)
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 86400 });
    res.json({ ok: true, bucket: BUCKET, key, url });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Listagem de um mês do usuário
app.get('/list', async (req, res) => {
  try {
    const { userId, month } = req.query;
    if(!userId || !month) return res.status(400).json({ok:false,error:'Informe userId e month=YYYY-MM'});
    const prefix = `${String(userId)}/${month}/`;
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
    res.json({ ok:true, items:(r.Contents||[]).map(o=>({ key:o.Key, size:o.Size, lastModified:o.LastModified })) });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 R2 S3 API rodando na porta ${PORT}`));

