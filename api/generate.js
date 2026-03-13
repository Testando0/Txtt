const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');
const Busboy = require('busboy');

// ─── White canvas (Gemini-compatible 1024×1024) ───────────────────────────────
async function createWhiteImage() {
  return await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 255, g: 255, b: 255 } }
  }).jpeg({ quality: 100 }).toBuffer();
}

// ─── Prompt Engineering ───────────────────────────────────────────────────────
// Transforms a simple user prompt into a rich, professional-grade prompt
// mimicking how DALL-E 3 internally rewrites prompts for quality.
function enhancePrompt(userPrompt, style, ratio) {

  const stylePresets = {
    photorealistic: [
      'ultra-photorealistic',
      'shot on Sony A7R V',
      'cinematic 35mm lens',
      'perfect exposure',
      'shallow depth of field',
      'volumetric lighting',
      'physically based rendering',
      '8K resolution',
      'RAW photo quality',
    ],
    cinematic: [
      'cinematic film still',
      'anamorphic lens flare',
      'Kodak Vision3 500T film grain',
      'dramatic chiaroscuro lighting',
      'widescreen aspect',
      'directorial composition',
      'color graded',
      'IMAX quality',
    ],
    digital_art: [
      'professional digital illustration',
      'concept art',
      'ArtStation trending',
      'rendered in Unreal Engine 5',
      'global illumination',
      'subsurface scattering',
      'ultra-detailed',
      '4K digital painting',
    ],
    oil_painting: [
      'masterful oil painting',
      'museum quality',
      'visible brushstrokes',
      'oil on linen canvas',
      'reminiscent of John Singer Sargent',
      'rich impasto texture',
      'gallery exhibition piece',
    ],
    anime: [
      'high-quality anime illustration',
      'studio Ghibli aesthetic',
      'sharp clean linework',
      'vibrant cel shading',
      'detailed anime background',
      'professional anime key visual',
    ],
    watercolor: [
      'professional watercolor painting',
      'soft wet-on-wet technique',
      'luminous washes of color',
      'fine art paper texture',
      'delicate ink linework',
      'award-winning illustration',
    ],
  };

  const qualityCore = [
    'masterpiece',
    'best quality',
    'highly detailed',
    'professional',
    'award-winning composition',
    'perfect focus',
    'intricate details',
  ];

  const lightingEnhancers = [
    'dramatic lighting',
    'rich color palette',
    'perfect color grading',
    'high contrast',
    'vivid colors',
  ];

  const avoidClause =
    'avoid: blurry, low quality, pixelated, watermark, signature, ugly, deformed, ' +
    'oversaturated, bad anatomy, duplicate, extra limbs, out of frame, cropped, worst quality, ' +
    'low resolution, amateur, flat lighting, washed out colors';

  const ratioHint = {
    '1:1':  'square composition, centered subject',
    '16:9': 'wide cinematic composition, rule of thirds',
    '9:16': 'vertical portrait composition, centered subject',
    '4:3':  'classic photographic composition',
  }[ratio] || 'well-balanced composition';

  const selectedStyle = stylePresets[style] || stylePresets.photorealistic;

  return [
    userPrompt.trim(),
    ...qualityCore,
    ...selectedStyle,
    ...lightingEnhancers,
    ratioHint,
    avoidClause,
  ].join(', ');
}

// ─── Multipart parser ─────────────────────────────────────────────────────────
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024 } });
    const fields = {};
    const files = {};
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => { files[name] = { buffer: Buffer.concat(chunks), ...info }; });
    });
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('close', () => resolve({ fields, files }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fields } = await parseMultipart(req);
    const userPrompt = (fields.prompt || '').trim();
    const style      = fields.style  || 'photorealistic';
    const ratio      = fields.ratio  || '1:1';

    if (!userPrompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const finalPrompt = enhancePrompt(userPrompt, style, ratio);
    console.log('[PROMPT]', finalPrompt);

    // White 1024×1024 canvas (Gemini-compatible blank)
    const whiteImage = await createWhiteImage();

    const form = new FormData();
    form.append('image', whiteImage, { filename: 'canvas.jpg', contentType: 'image/jpeg' });
    form.append('param', finalPrompt);

    const response = await axios.post(
      'https://api.nexray.web.id/ai/gptimage',
      form,
      {
        headers: form.getHeaders(),
        responseType: 'arraybuffer',
        timeout: 180000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    if (!response?.data) return res.status(500).json({ error: 'Generation failed — no data' });

    const result = Buffer.from(response.data);
    if (!result.length) return res.status(500).json({ error: 'Generation failed — empty result' });

    // Post-process: upscale + sharpen for DALL-E 3 level crispness
    let finalImage = result;
    try {
      finalImage = await sharp(result)
        .resize(1792, 1792, {
          fit: 'inside',
          withoutEnlargement: false,
          kernel: sharp.kernel.lanczos3
        })
        .sharpen({ sigma: 0.8, m1: 0.5, m2: 0.5 })
        .jpeg({ quality: 97, chromaSubsampling: '4:4:4' })
        .toBuffer();
    } catch (e) {
      console.warn('[POST-PROCESS WARN]', e.message);
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', finalImage.length);
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(finalImage);

  } catch (err) {
    console.error('[GENERATE ERROR]', err.message);
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout'))
      return res.status(504).json({ error: 'Generation timed out — try again' });
    if (err.response?.status)
      return res.status(err.response.status).json({ error: `API error: ${err.response.status}` });
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports.config = {
  api: { bodyParser: false, responseLimit: '30mb' }
};
