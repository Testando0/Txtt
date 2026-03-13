const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');
const Busboy = require('busboy');

// Generate a white blank image at Gemini-compatible size (1024x1024)
async function createWhiteImage() {
  return await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

// Parse multipart form without multer (Vercel native)
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024 } });
    const fields = {};
    const files = {};

    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        files[name] = { buffer: Buffer.concat(chunks), ...info };
      });
    });

    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('close', () => resolve({ fields, files }));
    bb.on('error', reject);

    req.pipe(bb);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fields } = await parseMultipart(req);
    const prompt = fields.prompt || '';

    if (!prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Create a white 1024x1024 image (Gemini-compatible blank canvas)
    const whiteImage = await createWhiteImage();

    // Build FormData — white image + prompt as param
    const form = new FormData();
    form.append('image', whiteImage, {
      filename: 'image.jpg',
      contentType: 'image/jpeg'
    });
    // Send the user's prompt as the 'param' field
    form.append('param', prompt.trim());

    const response = await axios.post(
      'https://api.nexray.web.id/ai/gptimage',
      form,
      {
        headers: form.getHeaders(),
        responseType: 'arraybuffer',
        timeout: 180000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    if (!response?.data) {
      return res.status(500).json({ error: 'Generation failed — no data returned' });
    }

    const result = Buffer.from(response.data);
    if (!result.length) {
      return res.status(500).json({ error: 'Generation failed — empty result' });
    }

    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', result.length);
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(result);

  } catch (err) {
    console.error('[GENERATE ERROR]', err.message);

    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return res.status(504).json({ error: 'Generation timed out — try again' });
    }
    if (err.response?.status) {
      return res.status(err.response.status).json({ error: `API error: ${err.response.status}` });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
    responseLimit: '30mb'
  }
};
