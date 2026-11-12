import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';
import { setImmediate as yieldToEvents } from 'node:timers/promises';
import heroes from '../src/components/HeroList.js';
import sharp from 'sharp';
import { detectDraftLockCue } from './draftCueDetection.js';

type MatchShape = 'square' | 'circle';

// Both sides use the same mask, so excluded channels need no storage or dot products.
const portraitSize = 32;
const circleOffsets: number[] = [];
for (let y = 0; y < portraitSize; y++) {
  for (let x = 0; x < portraitSize; x++) {
    const dx = (x + 0.5 - portraitSize / 2) / (portraitSize / 2);
    const dy = (y + 0.5 - portraitSize / 2) / (portraitSize / 2);
    // The lower-right Ban padlock covers the portrait.
    if (dx * dx + dy * dy <= 1 && !(x >= portraitSize * 0.58 && y >= portraitSize * 0.58)) {
      const offset = (y * portraitSize + x) * 3;
      circleOffsets.push(offset, offset + 1, offset + 2);
    }
  }
}

// Group nearby pixels of the same channel. Each block's normalized sum is an
// orthogonal projection; Cauchy–Schwarz bounds the part left out of its dot product.
function projectionFor(shape: MatchShape) {
  const blockSize = 4;
  const blocksPerRow = portraitSize / blockSize;
  const counts = new Uint8Array(blocksPerRow ** 2 * 3);
  const indices = Uint8Array.from(
    shape === 'circle' ? circleOffsets : Array.from({ length: portraitSize ** 2 * 3 }, (_, i) => i),
    (offset) => {
      const pixel = Math.floor(offset / 3);
      const blockX = Math.floor((pixel % portraitSize) / blockSize);
      const blockY = Math.floor(pixel / (portraitSize * blockSize));
      const block = (blockY * blocksPerRow + blockX) * 3 + (offset % 3);
      counts[block]++;
      return block;
    },
  );
  return { indices, weights: Float64Array.from(counts, (n) => (n ? 1 / Math.sqrt(n) : 0)) };
}
const projections = { square: projectionFor('square'), circle: projectionFor('circle') };

async function portraitPixels(
  source: ReturnType<typeof sharp>,
  region?: { left: number; top: number; width: number; height: number },
) {
  let image = source.clone();
  if (region) image = image.extract(region);
  return image
    .resize(portraitSize, portraitSize, { fit: 'fill' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer();
}

function features(pixels: Buffer, shape: MatchShape) {
  const values =
    shape === 'circle'
      ? Float64Array.from(circleOffsets, (offset) => pixels[offset])
      : Float64Array.from(pixels);
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  const mean = sum / values.length;
  let squares = 0;
  for (let i = 0; i < values.length; i++) {
    values[i] -= mean;
    squares += values[i] * values[i];
  }
  const norm = Math.max(Math.sqrt(squares), 1);
  for (let i = 0; i < values.length; i++) values[i] /= norm;
  const { indices, weights } = projections[shape];
  const blocks = new Float64Array(weights.length);
  for (let i = 0; i < values.length; i++) blocks[indices[i]] += values[i];
  let projectedEnergy = 0;
  for (let i = 0; i < blocks.length; i++) {
    blocks[i] *= weights[i];
    projectedEnergy += blocks[i] * blocks[i];
  }
  return {
    values,
    blocks,
    residual: Math.sqrt(Math.max(0, squares / (norm * norm) - projectedEnergy)),
  };
}

type PortraitFeatures = ReturnType<typeof features>;
type PortraitView = { features: PortraitFeatures; penalty: number };
async function perceptualFingerprint(
  source: Buffer,
  region?: { left: number; top: number; width: number; height: number },
) {
  let image = sharp(source);
  if (region) image = image.extract(region);
  const pixels: Buffer = await image.resize(8, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  const mean = pixels.reduce((sum, n) => sum + n, 0) / pixels.length;
  let bits = '';
  for (const pixel of pixels) bits += pixel >= mean ? '1' : '0';
  return Array.from({ length: 16 }, (_, index) =>
    parseInt(bits.slice(index * 4, index * 4 + 4), 2).toString(16),
  ).join('');
}

export async function frameFingerprint(source: Buffer) {
  return perceptualFingerprint(source);
}

export async function frameMeanLuma(source: Buffer) {
  const stats = await sharp(source).greyscale().stats();
  return stats.channels[0]?.mean ?? 0;
}

export async function lockCueFingerprint(source: Buffer) {
  const meta = await sharp(source).metadata();
  const width = meta.width || 0,
    height = meta.height || 0;
  if (width < 8 || height < 8) return '';
  // Legacy API diagnostic only. A hash change is never proof of a lock or an
  // empty Ban; active recognition uses positive lockCue shape evidence.
  const cueWidth = Math.max(8, Math.floor(width * 0.42));
  const cueHeight = Math.max(8, Math.floor(height * 0.42));
  return perceptualFingerprint(source, {
    left: Math.max(0, width - cueWidth),
    top: Math.max(0, height - cueHeight),
    width: cueWidth,
    height: cueHeight,
  });
}

async function portraitViews(
  source: string | Buffer,
  shape: MatchShape = 'square',
  template = false,
) {
  let image = sharp(source);
  const meta = await image.metadata();
  const width = meta.width || 0,
    height = meta.height || 0;
  if (!template && (!width || !height || width * height > 4_000_000))
    throw new Error('Frame dimensions too large');
  if (width < 8 || height < 8) return [{ pixels: await portraitPixels(image), penalty: 0 }];

  // Browser PNG crops share the same pixels across all zooms. Leave profiled,
  // HDR and JPEG sources on their original colour and shrink-on-load path.
  if (
    meta.format === 'png' &&
    meta.space === 'srgb' &&
    meta.depth === 'uchar' &&
    !meta.hasProfile &&
    width * height <= 262144
  ) {
    const raw = await image.raw().toBuffer({ resolveWithObject: true });
    image = sharp(raw.data, { raw: raw.info });
  }

  const minSide = Math.min(width, height);
  const specs: { scale: number; dx: number; dy: number }[] = [
    { scale: 1, dx: 0, dy: 0 },
    { scale: 0.9, dx: 0, dy: 0 },
    { scale: 0.82, dx: 0, dy: 0 },
    { scale: 0.74, dx: 0, dy: 0 },
    { scale: 0.82, dx: -0.12, dy: 0 },
    { scale: 0.82, dx: 0.12, dy: 0 },
    { scale: 0.82, dx: 0, dy: -0.12 },
    { scale: 0.82, dx: 0, dy: 0.12 },
    { scale: 0.74, dx: -0.14, dy: -0.08 },
    { scale: 0.74, dx: 0.14, dy: -0.08 },
    { scale: 0.74, dx: -0.14, dy: 0.08 },
    { scale: 0.74, dx: 0.14, dy: 0.08 },
  ];
  // Game portraits zoom the artwork before placing it inside a square/circle.
  // Cropping only the captured image cannot undo that zoom. Match corresponding
  // views of the template too, without changing the broadcast artwork.
  if (template) {
    specs.splice(4);
    for (const scale of [0.6, 0.5]) {
      for (const dx of [-0.35, 0, 0.35]) {
        for (const dy of [0, 0.35]) specs.push({ scale, dx, dy });
      }
    }
  }
  const variants: { pixels: Buffer; penalty: number }[] = [];
  // A rectangular Ban calibration describes an ellipse in source pixels.
  // Keep a full-frame view before square zoom views; otherwise minSide crops
  // discard the sides of a horizontally stretched portrait (or its top/bottom).
  if (shape === 'circle' && !template && width !== height) {
    variants.push({ pixels: await portraitPixels(image), penalty: 0 });
  }
  const seen = new Set<string>();
  for (const spec of specs) {
    const side = Math.max(8, Math.min(minSide, Math.floor(minSide * spec.scale)));
    const centerX = width / 2 + spec.dx * Math.max(0, width - side);
    const centerY = height / 2 + spec.dy * Math.max(0, height - side);
    const left = Math.max(0, Math.min(width - side, Math.round(centerX - side / 2)));
    const top = Math.max(0, Math.min(height - side, Math.round(centerY - side / 2)));
    const key = `${left}:${top}:${side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push({
      pixels: await portraitPixels(image, { left, top, width: side, height: side }),
      // A small facial fragment contains less identity evidence than a full
      // portrait. Penalize aggressive zoom so it cannot win by color alone.
      penalty: template && spec.scale < 0.7 ? 0.08 + (0.6 - spec.scale) * 0.5 : 0,
    });
  }
  return variants;
}

function featureViews(
  views: { pixels: Buffer; penalty: number }[],
  shape: MatchShape,
): PortraitView[] {
  return views.map(({ pixels, penalty }) => ({ features: features(pixels, shape), penalty }));
}

const TRUSTED_REMOTE_HERO_IMAGE_HOSTS = new Set([
  'world.honorofkings.com',
  'camp.honorofkings.com',
]);

export function trustedRemoteHeroImage(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && TRUSTED_REMOTE_HERO_IMAGE_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

async function heroTemplateSource(imageLink: string) {
  if (imageLink.startsWith('/')) return readFile(new URL(`../public${imageLink}`, import.meta.url));
  if (!trustedRemoteHeroImage(imageLink))
    throw new Error(`Untrusted remote hero portrait: ${imageLink}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(imageLink, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'HOK-Broadcast/1.0' },
    });
    if (!response.ok) throw new Error(`Remote hero portrait HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 8 * 1024 * 1024)
      throw new Error('Invalid remote hero portrait size');
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

let templates:
  | Promise<
      {
        heroId: number;
        square: PortraitView[];
        circle: PortraitView[];
      }[]
    >
  | undefined;
/** Build both shape catalogs once, before a live capture needs its first result. */
export function prepareHeroTemplates() {
  templates ??= Promise.all(
    heroes.map(async (h) => {
      try {
        const templateLink = h.recognitionImageLink || h.imageLink;
        const source = await heroTemplateSource(templateLink);
        const views = await portraitViews(source, 'square', true);
        return {
          heroId: h.id,
          square: featureViews(views, 'square'),
          circle: featureViews(views, 'circle'),
        };
      } catch (error) {
        // Existing local portraits are a release invariant and must still fail
        // loudly. A newly released hero may temporarily use an official remote
        // image until the scheduled sync can commit a local /heroesImg asset.
        // If that remote source is unavailable, skip only that template so the
        // rest of Auto BP remains usable and the hero can still be entered
        // manually.
        if (trustedRemoteHeroImage(h.recognitionImageLink || h.imageLink)) return undefined;
        throw error;
      }
    }),
  )
    .then((rows) => rows.filter((row): row is NonNullable<typeof row> => Boolean(row)))
    .catch((error) => {
      templates = undefined;
      throw error;
    });
  return templates;
}

function cached<T>(
  entries: Map<string, Promise<T>>,
  key: string,
  capacity: number,
  compute: () => Promise<T>,
) {
  let result = entries.get(key);
  if (result) entries.delete(key);
  else {
    result = compute();
    result.catch(() => {
      if (entries.get(key) === result) entries.delete(key);
    });
  }
  entries.set(key, result);
  if (entries.size > capacity) entries.delete(entries.keys().next().value!);
  return result;
}

async function analysePortrait(buffer: Buffer, shape: MatchShape) {
  return {
    views: featureViews(await portraitViews(buffer, shape), shape),
    exact: new Map<number, number>(),
  };
}
const analysedFrames = new Map<string, ReturnType<typeof analysePortrait>>();

function dot(a: Float64Array, b: Float64Array) {
  let score = 0;
  for (let i = 0; i < a.length; i++) score += a[i] * b[i];
  return score;
}

async function matchPortrait(
  buffer: Buffer,
  imageKey: string,
  allowedHeroIds?: number[],
  shape: MatchShape = 'square',
) {
  const [catalog, { views: variants, exact }] = await Promise.all([
    prepareHeroTemplates(),
    cached(analysedFrames, imageKey, 24, () => analysePortrait(buffer, shape)),
  ]);
  const allowed = allowedHeroIds === undefined ? undefined : new Set(allowedHeroIds);
  const eligible = catalog.filter((hero) => !allowed || allowed.has(hero.heroId));
  // Full-view scores are lower bounds. Five known examples immediately set a safe cutoff.
  const seeds = eligible.map(
    (hero) =>
      exact.get(hero.heroId) ??
      Math.max(0, dot(hero[shape][0].features.values, variants[0].features.values)),
  );
  const minimum = eligible.length > 5 ? seeds.toSorted((a, b) => b - a)[4] : -1;
  const best: { heroId: number; confidence: number }[] = [];
  let nextYield = performance.now() + 4;
  for (const [index, hero] of eligible.entries()) {
    if (performance.now() >= nextYield) {
      await yieldToEvents();
      nextYield = performance.now() + 4;
    }
    const fifth = best[4]?.confidence ?? -1;
    const cutoff = Math.max(minimum, fifth);
    let confidence = seeds[index];
    if (!exact.has(hero.heroId))
      for (const { features: template, penalty } of hero[shape]) {
        for (const { features: frame } of variants) {
          let bound = template.residual * frame.residual;
          for (let i = 0; i < template.blocks.length; i++)
            bound += template.blocks[i] * frame.blocks[i];
          // Roundoff tolerance keeps tied candidates and threshold comparisons exact.
          if (bound + 1e-7 < Math.max(confidence, cutoff) + penalty) continue;
          const score = dot(template.values, frame.values);
          confidence = Math.max(confidence, score - penalty);
        }
      }
    confidence = Math.min(1, confidence);
    // Only retain an individual hero score once every unscored pair is bounded below it.
    if (confidence >= cutoff) exact.set(hero.heroId, confidence);
    if (confidence > fifth) {
      best.push({ heroId: hero.heroId, confidence });
      best.sort((a, b) => b.confidence - a.confidence);
      if (best.length > 5) best.pop();
    }
  }
  return best;
}

type Candidates = Awaited<ReturnType<typeof matchPortrait>>;
const portraits = new Map<string, Promise<Candidates>>();
let activeMatches = 0;
export async function recognizeImage(
  buffer: Buffer,
  allowedHeroIds?: number[],
  shape: MatchShape = 'square',
  limitConcurrent = false,
) {
  const imageKey = shape + ':' + createHash('sha256').update(buffer).digest('hex');
  const key = imageKey + ':' + JSON.stringify(allowedHeroIds?.slice().sort((a, b) => a - b));
  const result = cached(portraits, key, 64, () => {
    if (limitConcurrent && activeMatches >= 4) throw new Error('Recognition busy');
    activeMatches++;
    return matchPortrait(buffer, imageKey, allowedHeroIds, shape).finally(() => {
      activeMatches--;
    });
  });
  return structuredClone(await result);
}

export function localCaptureRequest(
  req: Pick<IncomingMessage, 'headers' | 'socket'>,
  allowViteDevOrigin = false,
) {
  const address = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '')) return false;
  if (Object.keys(req.headers).some((key) => /^(forwarded|x-forwarded-|cf-)/.test(key)))
    return false;
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return false;
    if (!req.headers.origin) return true;
    const origin = new URL(req.headers.origin);
    if (origin.host === req.headers.host) return true;
    // Vite forwards browser POST Origin (5173) to the loopback API (3001).
    // Allow only this exact local development pair; never for production,
    // remote sockets, forwarded/tunnel requests, or arbitrary cross-origins.
    return (
      allowViteDevOrigin &&
      origin.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(origin.hostname) &&
      origin.port === '5173' &&
      new URL(`http://${req.headers.host}`).port === '3001'
    );
  } catch {
    return false;
  }
}
export function captureRegion(value: unknown): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const r = value as Record<string, number> | null;
  if (
    !r ||
    !['x', 'y', 'width', 'height'].every((k) => Number.isInteger(r[k])) ||
    Math.abs(r.x) > 32768 ||
    Math.abs(r.y) > 32768 ||
    r.width < 32 ||
    r.height < 32 ||
    r.width > 1200 ||
    r.height > 1200
  )
    throw new Error('Invalid capture region');
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
export function captureRegions(value: unknown) {
  if (!Array.isArray(value) || value.length !== 10) throw new Error('Invalid lineup regions');
  return value.map(captureRegion);
}
let busy = false;
async function captureWindows(input: object) {
  return await new Promise<{ preview?: string; previews?: string[] }>((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fileURLToPath(new URL('../scripts/capture/recognize.ps1', import.meta.url)),
      ],
      { timeout: 20000, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(new Error('Screen capture failed. Check the visible Windows desktop and region.'));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('Invalid capture result'));
        }
      },
    );
    child.stdin?.end(JSON.stringify(input));
  });
}
export async function recognizeScreen(region: ReturnType<typeof captureRegion>) {
  if (busy) throw new Error('Capture busy');
  busy = true;
  try {
    const frame = await captureWindows({ region });
    if (!frame.preview) throw new Error('Invalid capture result');
    const buffer = Buffer.from(frame.preview.split(',')[1], 'base64');
    return {
      preview: frame.preview,
      fingerprint: await frameFingerprint(buffer),
      lockFingerprint: await lockCueFingerprint(buffer),
      meanLuma: await frameMeanLuma(buffer),
      candidates: await recognizeImage(buffer),
    };
  } finally {
    busy = false;
  }
}

export async function recognizeLineup(
  regions: ReturnType<typeof captureRegions>,
  allowedHeroIdsBySlot: number[][],
) {
  if (busy) throw new Error('Capture busy');
  if (allowedHeroIdsBySlot.length !== regions.length) throw new Error('Invalid lineup candidates');
  busy = true;
  try {
    const frame = await captureWindows({ regions });
    if (!frame.previews || frame.previews.length !== regions.length)
      throw new Error('Invalid capture result');
    return await Promise.all(
      frame.previews.map(async (preview, index) => ({
        preview,
        candidates: await recognizeImage(
          Buffer.from(preview.split(',')[1], 'base64'),
          allowedHeroIdsBySlot[index],
        ),
      })),
    );
  } finally {
    busy = false;
  }
}

export function decodeClientCapture(value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid client capture');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Invalid client capture');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 3 * 1024 * 1024) throw new Error('Invalid client capture');
  return buffer;
}

const heroIDs = new Set(heroes.map((hero) => hero.id));
function allowedCandidates(input: unknown) {
  return Array.isArray(input)
    ? input
        .filter((id): id is number => Number.isInteger(id) && heroIDs.has(id))
        .slice(0, heroes.length)
    : undefined;
}

/** Final lineup slots only need the portrait, while a BP lock must inspect its own cue. */
export async function recognizePortraitCandidates(
  value: unknown,
  allowedHeroIds?: unknown,
  shape: unknown = 'square',
) {
  const candidates = await recognizeImage(
    decodeClientCapture(value),
    allowedCandidates(allowedHeroIds),
    shape === 'circle' ? 'circle' : 'square',
    true,
  );
  return { candidates };
}
type Evidence = {
  fingerprint: string;
  lockFingerprint: string;
  meanLuma: number;
  lockCue: 'checkmark' | 'padlock' | 'none';
  candidates: { heroId: number; confidence: number }[];
};
const evidenceCache = new Map<string, Promise<Evidence>>();
let activeRecognitions = 0;
export async function recognizeClientFrame(
  value: unknown,
  allowedHeroIds?: unknown,
  shape: unknown = 'square',
  lockImage?: unknown,
) {
  const buffer = decodeClientCapture(value);
  const cueBuffer = lockImage === undefined ? buffer : decodeClientCapture(lockImage);
  const allowed = allowedCandidates(allowedHeroIds);
  const matchShape: MatchShape = shape === 'circle' ? 'circle' : 'square';
  const key = createHash('sha256')
    .update(buffer)
    .update(cueBuffer)
    .update(JSON.stringify([matchShape, allowed?.slice().sort((a, b) => a - b)]))
    .digest('hex');
  const evidence = cached(evidenceCache, key, 64, async () => {
    if (activeRecognitions >= 4) throw new Error('Recognition busy');
    activeRecognitions++;
    try {
      const meta = await sharp(buffer).metadata();
      if (!meta.width || !meta.height || meta.width * meta.height > 4_000_000)
        throw new Error('Frame dimensions too large');
      const cueMeta = cueBuffer === buffer ? meta : await sharp(cueBuffer).metadata();
      if (!cueMeta.width || !cueMeta.height || cueMeta.width * cueMeta.height > 4_000_000)
        throw new Error('Lock frame dimensions too large');
      const cueEvidence = async () => {
        const extended = await detectDraftLockCue(cueBuffer, matchShape === 'circle');
        // Existing calibrations may already include the projecting checkmark.
        // Check the original too rather than forcing users to recrop them.
        return extended !== 'none' || cueBuffer === buffer
          ? extended
          : detectDraftLockCue(buffer, matchShape === 'circle');
      };
      const [fingerprint, lockFingerprint, meanLuma, lockCue, candidates] = await Promise.all([
        frameFingerprint(buffer),
        lockCueFingerprint(buffer),
        frameMeanLuma(buffer),
        cueEvidence(),
        recognizeImage(buffer, allowed, matchShape, true),
      ]);
      return { fingerprint, lockFingerprint, meanLuma, lockCue, candidates };
    } finally {
      activeRecognitions--;
    }
  });
  return { preview: value as string, ...structuredClone(await evidence) };
}
