// index.js — Render 1 (Miguel: frases + upload R2 + lista)
// deps: express, body-parser, multer, aws-sdk, path

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');   
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');

const app = express();


// CORS liberado (todas as origens) — ajuste “origin” se quiser restringir
app.use(cors({ origin: true, credentials: false }));
app.options('*', cors());                    // <— responde preflight
app.use(bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '25mb' }));

// ---------- Cloudflare R2 (S3) ----------
const CF_R2_ACCOUNT_ID     = process.env.CF_R2_ACCOUNT_ID; // ex: d5a97a...
const CF_R2_ACCESS_KEY_ID  = process.env.CF_R2_ACCESS_KEY_ID;
const CF_R2_SECRET_ACCESS_KEY = process.env.CF_R2_SECRET_ACCESS_KEY;
const CF_R2_BUCKET         = process.env.CF_R2_BUCKET || 'miguelcomprovante';
const CF_R2_ENDPOINT       = process.env.CF_R2_ENDPOINT || `https://${CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

if (!CF_R2_ACCESS_KEY_ID || !CF_R2_SECRET_ACCESS_KEY || !CF_R2_BUCKET || !CF_R2_ENDPOINT) {
  console.error('❌ Faltam variáveis do Cloudflare R2 (CF_R2_*)');
}

const s3 = new AWS.S3({
  endpoint: CF_R2_ENDPOINT,
  accessKeyId: CF_R2_ACCESS_KEY_ID,
  secretAccessKey: CF_R2_SECRET_ACCESS_KEY,
  signatureVersion: 'v4',
  s3ForcePathStyle: true,
});

// ---------- Upload (memória) ----------
const upload = multer({ storage: multer.memoryStorage() });

// ---------- Frases do Miguel ----------
const frases = {
  oi: [
    'E aí! Sou o Miguel 😎 Como posso te ajudar hoje?',
    'Falaaa! Por aqui tá tudo sob controle. Bora organizar as finanças?'
  ],
  relatorio: [
    'Relatório rápido: manda teu mês que eu conto os comprovantes 📊',
    'Puxa um /lista AAAA-MM que eu te digo o que encontrei!'
  ],
  ping: [
    '🏓 Tô on, meu consagrado!',
    '⚡ Online e tomando café ☕',
    '👀 Sempre alerta por aqui!'
  ],
  okcomprovante: [
    '🧾 Tá salvo! Não some mais.',
    '✅ Subi lá no bunker, confia.',
    '📦 Guardado com sucesso!'
  ],
  ajuda: [
    'Me manda: `gastei 23,90 mercado` ou anexa o comprovante.',
    'Comandos: `/ping`, `/lista AAAA-MM`, `/ajuda`'
  ],
  erro: [
    'Eita, buguei aqui… tenta de novo rapidinho?',
    'Hum, algo deu ruim. Vou checar os cabos! 🧰'
  ],
  motivacionais: [
    'Grãozinho de arroz por grãozinho: economia cresce 💪',
    'Constância > intensidade. Um passo por dia ✅'
  ],
  zoeira: [
    'Se gastar muito hoje, amanhã eu te mando boleto motivacional 😂',
    'Cartão coçou? Eu vi, hein… 👀'
  ],
  elogio: [
    'Mandou bem! Registrar é metade do caminho 👏',
    'Orgulho de você, hein! 📈'
  ],
  dicaseconomia: [
    'Troca marca premium por marca própria em itens básicos 😉',
    'Define um teto por categoria e me chama se chegar perto!'
  ],
  desafio: [
    'Desafio da semana: 3 dias sem delivery. Topa? 🍳',
    'Missão relâmpago: achar 2 gastos “fantasma” e cortar 🔎✂️'
  ],
  lembrete: [
    'Bebe água e guarda o comprovante 💧🧾',
    'Check-in financeiro do dia feito?'
  ],
  comprovantepedido: [
    'Me manda o comprovante do dia anterior quando puder, por favor! 📎',
    'Assim que der, sobe o comprovante de ontem pra eu fechar o saldo 👌'
  ],
  queda: [
    '⚠️ Detectei instabilidade… segura que já tô monitorando!',
  ],
  recuperacao: [
    '✅ Voltamos ao normal. Pode seguir o baile!',
  ]
};
const comandosDisponiveis = Object.keys(frases);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ---------- Health ----------
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'render_1', time: new Date().toISOString() });
});
app.get('/', (_req, res) => res.redirect('/healthz'));

// ---------- Frases rápidas ----------
app.get('/fala', (_req, res) => {
  res.json({ ok: true, comandos: comandosDisponiveis });
});
app.get('/fala/:comando', (req, res) => {
  const comando = String(req.params.comando || '').toLowerCase();
  const bucket = frases[comando];
  if (!bucket) {
    return res.json({ ok: true, comando, resposta: 'Não saquei 🤔 mas se for comprovante, manda que eu guardo!' });
  }
  res.json({ ok: true, comando, resposta: pick(bucket) });
});

// ---------- Upload de comprovante ----------
// multipart/form-data: field "file"; body (opcional): userId, descricao, date(YYYY-MM-DD)
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado (campo file).' });

    const userId = String(req.body.userId || 'anon');
    const now = req.body.date ? new Date(req.body.date) : new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const baseName = path.basename(req.file.originalname || 'comprovante.bin').replace(/[^\w.\-]+/g, '_');
    const key = `${ym}/${userId}/${Date.now()}_${baseName}`;

    await s3.putObject({
      Bucket: CF_R2_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream'
    }).promise();

    const url = `${CF_R2_ENDPOINT}/${CF_R2_BUCKET}/${key}`;
    res.json({
      ok: true,
      message: pick(frases.okcomprovante),
      file: { key, url, size: req.file.size, mime: req.file.mimetype || null },
      meta: { userId, descricao: req.body.descricao || null, date: now.toISOString().slice(0,10) }
    });
  } catch (e) {
    console.error('upload error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Listagem por mês/usuário ----------
// GET /lista/:userId/:ym   (ym = AAAA-MM)
app.get('/lista/:userId/:ym', async (req, res) => {
  try {
    const { userId, ym } = req.params;
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      return res.status(400).json({ ok: false, error: 'Formato de mês inválido. Use AAAA-MM.' });
    }
    const prefix = `${ym}/${userId}/`;
    const out = await s3.listObjectsV2({ Bucket: CF_R2_BUCKET, Prefix: prefix }).promise();
    const items = (out.Contents || []).map(o => ({
      key: o.Key,
      url: `${CF_R2_ENDPOINT}/${CF_R2_BUCKET}/${o.Key}`,
      size: o.Size,
      lastModified: o.LastModified
    }));
    res.json({ ok: true, count: items.length, items });
  } catch (e) {
    console.error('lista error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Miguel Render 1 ON :${PORT}`);
});
