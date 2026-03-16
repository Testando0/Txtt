const axios    = require('axios');
const FormData = require('form-data');
const sharp    = require('sharp');
const Busboy   = require('busboy');

// ─────────────────────────────────────────────────────────────────────────────
// WHITE CANVAS — 1024×1024 puro branco (usado quando não há imagem de ref.)
// ─────────────────────────────────────────────────────────────────────────────
async function whiteCanvas() {
  return sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 255, g: 255, b: 255 } }
  }).jpeg({ quality: 100 }).toBuffer();
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZA IMAGEM DE REFERÊNCIA enviada pelo usuário
// ─────────────────────────────────────────────────────────────────────────────
async function normalizeRefImage(buffer) {
  return sharp(buffer)
    .resize(1024, 1024, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT ENGINEERING
// ─────────────────────────────────────────────────────────────────────────────
function buildPrompt(raw, style, hasRefImage) {
  const base = raw.trim();
  const editPrefix = hasRefImage ? 'Edit and transform the provided reference image: ' : '';

  const styles = {
    photo: `
      ${editPrefix}Hyperrealistic professional photograph of: ${base}.
      Shot on Hasselblad H6D-400c medium format camera, 85mm f/1.2 prime lens,
      ISO 100, perfect exposure, tack-sharp focus on subject, creamy bokeh background.
      Studio-grade three-point lighting. Skin tones accurate, textures microscopically sharp.
      Color graded with LUTs. Post-processed in Capture One Pro. Editorial photography quality.
      Published in Vogue, National Geographic, or Architectural Digest.
    `,
    cinematic: `
      ${editPrefix}Cinematic film still of: ${base}.
      Anamorphic 2.39:1 widescreen. Shot on ARRI Alexa 65 with Zeiss Master Prime lenses.
      Kodak Vision3 500T film emulation. Dramatic chiaroscuro lighting: deep inky blacks, lens flares.
      Color grade: teal-orange LUT, crushed blacks, lifted shadows.
      Extremely shallow focus, bokeh orbs, atmospheric haze. Golden ratio composition.
      Cinematography by Roger Deakins level. IMAX film print quality.
    `,
    art: `
      ${editPrefix}Breathtaking concept art and digital painting of: ${base}.
      Created in ZBrush + Photoshop + Octane Render. Painted by a senior artist at ILM or Pixar.
      Hyper-detailed: every surface textured, every light source physically accurate.
      Global illumination, subsurface scattering, PBR shading.
      Trending on ArtStation with 100k favorites. 8K resolution painting.
    `,
    oil: `
      ${editPrefix}Masterful oil painting of: ${base}.
      Brushwork quality of Sargent, Rembrandt or Sorolla. Oil on linen canvas, large format.
      Visible impasto texture, directional brushstrokes.
      Luminous glazing technique: translucent color layers building rich depth.
      Dramatic Rembrandt lighting. Museum-quality exhibition piece.
    `,
    anime: `
      ${editPrefix}Ultra high quality anime illustration of: ${base}.
      Production quality: Studio Ghibli, Makoto Shinkai, or ufotable level.
      Extremely clean sharp linework. Vibrant color palette, cel shading with painted background.
      Dynamic lighting: rim light, caustics, detailed reflections.
      Key visual quality — Blu-ray cover art. Pixiv 1 million views.
    `,
    fantasy: `
      ${editPrefix}Epic fantasy digital artwork of: ${base}.
      Style by Greg Rutkowski, Artgerm, or Alphonse Mucha.
      Cinematic fantasy lighting: magical glows, volumetric god rays, mystical atmosphere.
      Rich color palette: deep purples, golds, crimsons and ethereal blues.
      World-building level art. ArtStation Daily Deviation.
    `,
  };

  const qualitySuffix = `
    Technical quality requirements:
    - Resolution: equivalent to 8K downsampled to 4K for sharpness
    - Zero compression artifacts, zero noise unless intentional film grain
    - Perfect anatomical accuracy for any people or creatures
    - Physically correct lighting and shadows with no inconsistencies
    - Rich, deep color space: wide gamut, no color banding
    - Masterful composition: rule of thirds, leading lines, depth layers
    - NOT blurry, NOT pixelated, NOT low quality, NOT washed out, NOT flat lighting
    - NOT watermarked, NOT signed, NOT with borders or frames
    - NOT deformed anatomy, NOT extra limbs, NOT wrong proportions
    Render as if this will be sold as a premium print for $10,000.
  `;

  const chosen = styles[style] || styles.photo;
  return (chosen + qualitySuffix).replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPART PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 20 * 1024 * 1024 } });
    const fields = {}, files = {};
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

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fields, files } = await parseForm(req);
    const userPrompt = (fields.prompt || '').trim();
    const style      = (fields.style  || 'photo').trim();

    if (!userPrompt) return res.status(400).json({ error: 'Prompt is required' });

    // Usa imagem de referência do usuário ou canvas branco
    const hasRefImage = !!(files.refimage && files.refimage.buffer && files.refimage.buffer.length > 0);
    const baseImage = hasRefImage
      ? await normalizeRefImage(files.refimage.buffer)
      : await whiteCanvas();

    const finalPrompt = buildPrompt(userPrompt, style, hasRefImage);
    console.log('[GENERATE] style:', style, '| refImage:', hasRefImage, '| promptLen:', finalPrompt.length);

    const form = new FormData();
    form.append('image', baseImage, { filename: 'canvas.jpg', contentType: 'image/jpeg' });
    form.append('param', finalPrompt);

    const apiRes = await axios.post(
      'https://api.nexray.web.id/ai/gptimage',
      form,
      {
        headers: form.getHeaders(),
        responseType: 'arraybuffer',
        timeout: 200000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    if (!apiRes?.data) return res.status(500).json({ error: 'No data from API' });
    const raw = Buffer.from(apiRes.data);
    if (!raw.length) return res.status(500).json({ error: 'Empty result from API' });

    // Pós-processamento: upscale 2× + sharpen + vibrance
    let final = raw;
    try {
      const meta    = await sharp(raw).metadata();
      const w       = meta.width  || 1024;
      const h       = meta.height || 1024;
      const targetW = Math.min(w * 2, 2048);
      const targetH = Math.min(h * 2, 2048);

      final = await sharp(raw)
        .resize(targetW, targetH, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
        .sharpen({ sigma: 1.2, m1: 1.5, m2: 0.7, x1: 2, y2: 10, y3: 20 })
        .modulate({ brightness: 1.02, saturation: 1.12 })
        .jpeg({ quality: 98, chromaSubsampling: '4:4:4', mozjpeg: true })
        .toBuffer();
    } catch (e) {
      console.warn('[POST-PROCESS WARN]', e.message);
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', final.length);
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(final);

  } catch (err) {
    console.error('[GENERATE ERROR]', err.message);
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout'))
      return res.status(504).json({ error: 'Timeout — tente novamente' });
    if (err.response?.status)
      return res.status(err.response.status).json({ error: `API error ${err.response.status}` });
    return res.status(500).json({ error: 'Erro interno' });
  }
};

module.exports.config = {
  api: { bodyParser: false, responseLimit: '30mb' }
};
