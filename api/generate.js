const axios   = require('axios');
const FormData = require('form-data');
const sharp    = require('sharp');
const Busboy   = require('busboy');

// ─────────────────────────────────────────────────────────────────────────────
// WHITE CANVAS — 1024×1024, pure white, high quality JPEG
// ─────────────────────────────────────────────────────────────────────────────
async function whiteCanvas() {
  return sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 255, g: 255, b: 255 } }
  }).jpeg({ quality: 100 }).toBuffer();
}

// ─────────────────────────────────────────────────────────────────────────────
// MAXIMUM PROMPT ENGINEERING
// Goal: extract the absolute best output from the model — rewrite the user's
// simple idea into a dense, hyper-detailed, technically precise prompt that
// forces the model into professional-grade rendering mode.
// ─────────────────────────────────────────────────────────────────────────────
function buildPrompt(raw, style) {

  const base = raw.trim();

  // ── Per-style technical injection ────────────────────────────────────────
  const styles = {

    photo: `
      Hyperrealistic professional photograph of: ${base}.
      Shot on Hasselblad H6D-400c medium format camera, 85mm f/1.2 prime lens,
      ISO 100, perfect exposure, tack-sharp focus on subject, creamy bokeh background.
      Studio-grade three-point lighting with soft key light, fill light and rim light.
      Skin tones accurate, textures microscopically sharp — every pore, fiber and surface detail visible.
      Color graded with LUTs: deep rich shadows, luminous highlights, perfectly balanced midtones.
      Post-processed in Capture One Pro. Editorial photography quality.
      RAW sensor capture aesthetic. Published in Vogue, National Geographic, or Architectural Digest.
    `,

    cinematic: `
      Cinematic film still of: ${base}.
      Anamorphic 2.39:1 widescreen. Shot on ARRI Alexa 65 with Zeiss Master Prime lenses.
      Kodak Vision3 500T film emulation — subtle grain, natural highlight rolloff.
      Dramatic chiaroscuro lighting: deep inky blacks, glowing practical lights, lens flares.
      Color grade: teal-orange LUT, crushed blacks, lifted shadows.
      Depth: extremely shallow focus, bokeh orbs, atmospheric haze.
      Composition: golden ratio, deliberate negative space, leading lines.
      Cinematography by Roger Deakins, Emmanuel Lubezki or Hoyte van Hoytema level.
      IMAX film print quality. Featured in an Oscar-winning feature film.
    `,

    art: `
      Breathtaking concept art and digital painting of: ${base}.
      Created in ZBrush + Photoshop + Octane Render.
      Painted by a senior artist at ILM, Weta Digital or Pixar.
      Hyper-detailed: every surface textured, every light source physically accurate.
      Global illumination, subsurface scattering on organic materials, PBR shading.
      Cinematic lighting composition. Trending on ArtStation with 100k favorites.
      Featured in The Art of film, ImagineFX magazine cover.
      8K resolution painting with museum-level detail.
    `,

    oil: `
      Masterful oil painting of: ${base}.
      Painted in the style of the great masters — brushwork quality of Sargent, Rembrandt or Sorolla.
      Oil on linen canvas, large format. Visible impasto texture, directional brushstrokes.
      Luminous glazing technique: translucent color layers building rich depth.
      Dramatic Rembrandt lighting — single warm key light, deep velvety shadows.
      Museum-quality exhibition piece. Sold at Christie's auction for millions.
      Fine art photography of the painting with canvas texture perfectly visible.
    `,

    anime: `
      Ultra high quality anime illustration of: ${base}.
      Production quality: Studio Ghibli, Makoto Shinkai, or ufotable level.
      Extremely clean sharp linework, professional ink inking.
      Vibrant color palette, cel shading with painted background.
      Dynamic lighting: rim light, caustics, detailed reflections.
      Key visual quality — could be the cover of a Blu-ray release.
      Detailed background environment, complex layered composition.
      Character design by top-tier Japanese studio. Pixiv 1 million views.
    `,

    fantasy: `
      Epic fantasy digital artwork of: ${base}.
      Style blending classical oil painting with modern digital techniques.
      By artists like Greg Rutkowski, Artgerm, or Alphonse Mucha.
      Cinematic fantasy lighting: magical glows, volumetric god rays, mystical atmosphere.
      Incredibly detailed environment: every stone, leaf, fabric, and armor piece crafted.
      Rich color palette: deep purples, golds, crimsons and ethereal blues.
      World-building level art. Published in a fantasy novel or RPG sourcebook.
      ArtStation Daily Deviation. Printed as a massive canvas print.
    `,
  };

  // ── Universal quality suffix — appended to EVERY style ───────────────────
  const qualitySuffix = `
    Technical quality requirements:
    - Resolution: equivalent to 8K (7680×4320) downsampled to 4K for sharpness
    - Zero compression artifacts, zero noise unless intentional film grain
    - Perfect anatomical accuracy for any people or creatures
    - Physically correct lighting and shadows with no inconsistencies
    - Rich, deep color space: wide gamut, no color banding
    - Masterful composition: rule of thirds, leading lines, depth layers (foreground, mid, background)
    - Professional retouching: flawless but not plastic
    - NOT blurry, NOT pixelated, NOT low quality, NOT washed out, NOT flat lighting
    - NOT watermarked, NOT signed, NOT with borders or frames
    - NOT deformed anatomy, NOT extra limbs, NOT wrong proportions
    Render as if this will be sold as a premium print for $10,000.
  `;

  const chosen = styles[style] || styles.photo;

  // Collapse extra whitespace and build final prompt
  return (chosen + qualitySuffix)
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPART PARSER (Vercel-native, no multer)
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
    const { fields } = await parseForm(req);
    const userPrompt = (fields.prompt || '').trim();
    const style      = (fields.style  || 'photo').trim();

    if (!userPrompt) return res.status(400).json({ error: 'Prompt is required' });

    // Build maximum-quality prompt
    const finalPrompt = buildPrompt(userPrompt, style);
    console.log('[BUNIX PROMPT LEN]', finalPrompt.length);

    // White canvas
    const canvas = await whiteCanvas();

    // Call API
    const form = new FormData();
    form.append('image', canvas, { filename: 'canvas.jpg', contentType: 'image/jpeg' });
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

    // ── Post-process: maximize output quality ─────────────────────────────
    let final = raw;
    try {
      // Get image metadata to preserve aspect ratio
      const meta = await sharp(raw).metadata();
      const w = meta.width  || 1024;
      const h = meta.height || 1024;

      // Scale up 2× with Lanczos3 (best quality resampling)
      const targetW = Math.min(w * 2, 2048);
      const targetH = Math.min(h * 2, 2048);

      final = await sharp(raw)
        .resize(targetW, targetH, {
          kernel: sharp.kernel.lanczos3,
          fit: 'fill',
        })
        // Unsharp mask — recovers fine detail lost in generation
        .sharpen({ sigma: 1.2, m1: 1.5, m2: 0.7, x1: 2, y2: 10, y3: 20 })
        // Slight contrast/vibrance boost to pop
        .modulate({ brightness: 1.02, saturation: 1.12 })
        // Output as maximum quality JPEG (no chroma subsampling = sharper color edges)
        .jpeg({ quality: 98, chromaSubsampling: '4:4:4', mozjpeg: true })
        .toBuffer();
    } catch (e) {
      console.warn('[POST-PROCESS WARN]', e.message);
      // fallback — send raw
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', final.length);
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(final);

  } catch (err) {
    console.error('[BUNIX ERROR]', err.message);
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout'))
      return res.status(504).json({ error: 'Timeout — try again' });
    if (err.response?.status)
      return res.status(err.response.status).json({ error: `API error ${err.response.status}` });
    return res.status(500).json({ error: 'Internal error' });
  }
};

module.exports.config = {
  api: { bodyParser: false, responseLimit: '30mb' }
};
