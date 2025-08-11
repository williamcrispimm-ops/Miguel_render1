// index.js — Render 1 (Miguel básico + Cloudflare R2 S3)
// Node 18+

const express = require('express');
const bodyParser = require('body-parser');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

// ====== ENVs (configure no Render) ======
const PORT = process.env.PORT || 3000;
const S3_ENDPOINT = process.env.S3_ENDPOINT; // ex.: https://<ACCOUNT>.r2.cloudflarestorage.com (sem nome do bucket)
const S3_REGION = process.env.S3_REGION || 'auto';
const S3_BUCKET = process.env.S3_BUCKET;     // ex.: miguelcomprovante
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;

// Validação básica de envs
function assertEnvs() {
  const missing = [];
  if (!S3_ENDPOINT) missing.push('S3_ENDPOINT');
  if (!S3_BUCKET) missing.push('S3_BUCKET');
  if (!S3_ACCESS_KEY_ID) missing.push('S3_ACCESS_KEY_ID');
  if (!S3_SECRET_ACCESS_KEY) missing.push('S3_SECRET_ACCESS_KEY');
  if (missing.length) {
    throw new Error(`Faltando env(s): ${missing.join(', ')}`);
  }
}
try { assertEnvs(); } catch (e) { console.warn('ENV WARNING:', e.message); }

// ====== S3 Client (Cloudflare R2) ======
const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: true, // importante para R2/B2
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY }
});

// ====== Helpers ======
const safe = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.-]/g, '');

const today = () => new Date().toISOString().slice(0, 10);

// ====== Health & Debug ======
app.get('/ping', (_req, res) => {
  res.json({ ok: true, service: 'render_1', time: new Date().toISOString() });
});

app.get('/debug/config', (_req, res) => {
  res.json({
    ok: true,
    endpoint: S3_ENDPOINT || null,
    region: S3_REGION || null,
    bucket: S3_BUCKET || null,
    hasAccessKey: !!S3_ACCESS_KEY_ID,
    hasSecret: !!S3_SECRET_ACCESS_KEY
  });
});

app.get('/debug/verify-bucket', async (_req, res) => {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    res.json({ ok: true, msg: 'Bucket acessível' });
  } catch (e) {
    res.status(500).json({
      ok: false,
      name: e.name,
      message: e.message,
      status: e.$metadata?.httpStatusCode
    });
  }
});

// ====== Frases básicas do Miguel ======
app.get('/fala/:comando', (req, res) => {
  const comando = String(req.params.comando || '').toLowerCase();
  let resposta;
  switch (comando) {
    case 'oi':
      resposta = 'E aí! Sou o Miguel 😎 Como posso te ajudar hoje?';
      break;
    case 'relatorio':
      resposta = 'Relatório rápido: manda teu mês que eu conto os comprovantes 📊';
      break;
    default:
      resposta = 'Não saquei 🤔 mas se for comprovante, manda que eu guardo!';
  }
  res.json({ ok: true, comando, resposta });
});

// ====== Página de teste (navegador) ======
app.get('/test', (_req, res) => {
  res.type('html').send(`<!doctype html>
<meta charset="utf-8"><title>Teste Upload (R2)</title>
<body style="font-family:system-ui;padding:20px;max-width:900px;margin:auto">
<h2>Upload — Cloudflare R2 (userId/AAAA-MM/AAAA-MM-DD_desc.ext)</h2>
<form id="f">
  <label>User ID</label><br><input id="userId" value="123456789"><br><br>
  <label>Data (AAAA-MM-DD)</label><br><input id="date" value="${today()}"><br><br>
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
    try{
      const resp = await fetch('/upload-comprovante', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const text = await resp.text();
      try{ out.textContent = JSON.stringify(JSON.parse(text), null, 2); } catch{ out.textContent = text; }
    }catch(err){ out.textContent = 'Erro: ' + err.message; }
  };
  r.readAsDataURL(file);
});
</script>
</body>`);
});

// ====== Upload de comprovante ======
app.post('/upload-comprovante', async (req, res) => {
  try {
    const { userId, date, descricao, mimeType, fileBase64, fileData } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, error: 'userId é obrigatório' });

    const dia = date || today();
    const anoMes = dia.slice(0, 7);
    const desc = safe(descricao || 'comprovante');
    const base64 = fileBase64 || fileData;
    if (!base64) return res.status(400).json({ ok: false, error: 'fileBase64 (ou fileData) é obrigatório' });

    const ext = (mimeType && mimeType.includes('/')) ? mimeType.split('/')[1] : 'bin';
    const key = `${String(userId)}/${anoMes}/${dia}_${desc}.${ext}`;

    const buf = Buffer.from(base64, 'base64');
    if (!buf.length) return res.status(400).json({ ok: false, error: 'Base64 inválido' });

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buf,
      ContentType: mimeType || 'application/octet-stream'
    }));

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
      { expiresIn: 86400 } // 24h
    );

    res.json({ ok: true, key, url });
  } catch (e) {
    res.status(500).json({
      ok: false,
      name: e.name,
      message: e.message,
      status: e.$metadata?.httpStatusCode
    });
  }
});

// ====== Listar comprovantes por usuário/mês ======
app.get('/lista/:userId/:anoMes', async (req, res) => {
  try {
    const { userId, anoMes } = req.params;
    const prefix = `${String(userId)}/${anoMes}/`;

    const r = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix }));
    const contents = r.Contents || [];

    // gerar URLs de leitura (GetObject) por 24h
    const items = await Promise.all(contents.map(async (o) => {
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: S3_BUCKET, Key: o.Key }),
        { expiresIn: 86400 }
      );
      return { key: o.Key, size: o.Size, lastModified: o.LastModified, url };
    }));

    res.json({ ok: true, count: items.length, items });
  } catch (e) {
    res.status(500).json({
      ok: false,
      name: e.name,
      message: e.message,
      status: e.$metadata?.httpStatusCode
    });
  }
});

// ====== Root ======
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'render_1', tip: 'use /test, POST /upload-comprovante, GET /lista/:userId/:anoMes' });
});

app.listen(PORT, () => console.log(`🚀 Render 1 pronto na porta ${PORT}`));
