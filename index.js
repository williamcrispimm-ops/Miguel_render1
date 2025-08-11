// index.js - Render 1: Armazenamento + Frases básicas do Miguel
// Node.js 18+
// Dependências: express, body-parser, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

const express = require('express');
const bodyParser = require('body-parser');
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

// Variáveis de ambiente (configure no Render)
const PORT = process.env.PORT || 3000;
const BUCKET = process.env.S3_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION || 'auto';
const ACCESS_KEY = process.env.S3_ACCESS_KEY_ID;
const SECRET_KEY = process.env.S3_SECRET_ACCESS_KEY;

// Configuração do cliente S3 (Cloudflare R2)
const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY }
});

// Função helper para gerar chave do arquivo no S3
const safe = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.-]/g, '');

// -------------------- ROTAS --------------------

// Teste de status
app.get('/ping', (req, res) => {
  res.json({ ok: true, service: 'render_1', time: new Date().toISOString() });
});

// Frases rápidas do Miguel
app.get('/fala/:comando', (req, res) => {
  const comando = req.params.comando.toLowerCase();
  let resposta;

  switch (comando) {
    case 'oi':
      resposta = 'E aí! Sou o Miguel 😎 Como posso te ajudar hoje?';
      break;
    case 'relatorio':
      resposta = 'Relatório rápido: ainda estou conectando ao painel, mas já posso contar seus comprovantes 📊';
      break;
    default:
      resposta = 'Não saquei 🤔 mas se for sobre comprovante, pode mandar!';
  }

  res.json({ ok: true, comando, resposta });
});

// Upload de comprovante
app.post('/comprovante', async (req, res) => {
  try {
    const { userId, filename, fileData } = req.body;
    if (!userId || !filename || !fileData) {
      return res.status(400).json({ ok: false, error: 'userId, filename e fileData são obrigatórios' });
    }

    const now = new Date();
    const folder = `${userId}/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const key = `${folder}/${safe(filename)}`;

    const buffer = Buffer.from(fileData, 'base64');

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer
      })
    );

    res.json({ ok: true, message: `Comprovante salvo em ${key}`, folder });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Lista comprovantes de um usuário/mês
app.get('/lista/:userId/:mes', async (req, res) => {
  try {
    const { userId, mes } = req.params;
    const prefix = `${userId}/${mes}`;

    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix
      })
    );

    const files = await Promise.all(
      (result.Contents || []).map(async (item) => {
        const url = await getSignedUrl(
          s3,
          new PutObjectCommand({ Bucket: BUCKET, Key: item.Key }),
          { expiresIn: 3600 }
        );
        return { name: item.Key, url };
      })
    );

    res.json({ ok: true, files });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Inicia servidor
app.listen(PORT, () => {
  console.log(`Miguel Render 1 rodando na porta ${PORT}`);
});
