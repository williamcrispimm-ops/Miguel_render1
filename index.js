const express = require('express');
const bodyParser = require('body-parser');
const { S3Client, PutObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const upload = multer();

const app = express();
app.use(bodyParser.json());

const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true
});

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'render_1', port: process.env.PORT || 3000, time: new Date().toISOString() });
});

// Debug config
app.get('/debug/config', (_req,res) => {
  res.json({
    ok: true,
    bucket: process.env.S3_BUCKET || null,
    endpoint: process.env.S3_ENDPOINT || null,
    region: process.env.S3_REGION || null,
    hasAccessKey: !!process.env.S3_ACCESS_KEY_ID,
    hasSecret: !!process.env.S3_SECRET_ACCESS_KEY
  });
});

// Verify bucket access
app.get('/debug/verify-bucket', async (_req, res) => {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
    res.json({ ok: true, msg: 'Bucket acessível' });
  } catch (e) {
    res.status(500).json({ ok: false, name: e.name, message: e.message, code: e.Code, status: e.$metadata?.httpStatusCode });
  }
});

// Upload comprovante
app.post('/upload-comprovante', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado.' });
    const key = `${Date.now()}-${req.file.originalname}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: req.file.buffer
    }));
    res.json({ ok: true, key });
  } catch (e) {
    console.error('UPLOAD ERROR:', e);
    res.status(500).json({ ok: false, name: e.name, message: e.message, code: e.Code, status: e.$metadata?.httpStatusCode });
  }
});

// Test upload form
app.get('/test', (_req, res) => {
  res.send(`
    <html>
      <body>
        <form action="/upload-comprovante" method="post" enctype="multipart/form-data">
          <input type="file" name="file" />
          <button type="submit">Enviar</button>
        </form>
      </body>
    </html>
  `);
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running...');
});
