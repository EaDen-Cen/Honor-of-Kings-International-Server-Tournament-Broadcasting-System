import sharp from 'sharp';
import type { PlayerRecognitionProvider } from './playerRecognition.js';
import { parsePostGameNumber } from '../src/shared/postGame.js';
import type { GoldDifferencePoint } from '../src/shared/postGameTimeline.js';

export interface SettlementGoldCurve {
  points: GoldDifferencePoint[];
  maxDifference: number;
  confidence: number;
  durationSeconds?: number;
  error?: string;
  warning?: string;
}
/** The supplied 1080p recap plots a signed advantage, not two cumulative totals.
 * Read its ring markers and real axis labels; do not infer history from totals. */
export async function recognizeSettlementGoldCurve(
  frame: Buffer,
  provider: Pick<PlayerRecognitionProvider, 'recognizeNumbers'>,
): Promise<SettlementGoldCurve> {
  const unavailable = (error: string): SettlementGoldCurve => ({
    points: [],
    maxDifference: 0,
    confidence: 0,
    error,
  });
  const metadata = await sharp(frame, { limitInputPixels: 9000000 }).metadata();
  const cropped = !!(
    metadata.width &&
    metadata.height &&
    metadata.width / metadata.height > 2.5 &&
    metadata.width >= 600 &&
    metadata.height >= 150
  );
  if (cropped) {
    // shortcut: calibrated for the current ring-marker chart; add a layout when the game UI changes.
    const crop = await sharp(frame)
      .resize({ width: 1760, height: 440, fit: 'inside' })
      .png()
      .toBuffer();
    frame = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: '#122d59' },
    })
      .composite([{ input: crop, left: 80, top: 400 }])
      .png()
      .toBuffer();
  }
  const { data, info } = await sharp(frame)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width,
    h = info.height;
  if (w !== 1920 || h !== 1080)
    return unavailable('Curve requires normalized 1920×1080 game content');
  // Locate the chart's long top border before reading markers. A valid 16:9
  // user selection can still zoom/pan the chart within the normalized frame.
  const borders: Array<{ y: number; left: number; right: number; length: number }> = [];
  for (let y = 360; y < 760; y++) {
    let start = -1,
      best = { left: 0, right: 0, length: 0 };
    for (let x = 35; x < w - 15; x++) {
      const j = (y * w + x) * info.channels,
        r = data[j],
        g = data[j + 1],
        b = data[j + 2],
        match = (r > 40 && g > 100 && b > 130) || (r > 120 && g > 40 && b > 120);
      if (match && start < 0) start = x;
      if ((!match || x === w - 16) && start >= 0) {
        if (x - start > best.length) best = { left: start, right: x - 1, length: x - start };
        start = -1;
      }
    }
    if (best.length >= 900) borders.push({ y, ...best });
  }
  const strongest = borders.sort((a, b) => b.length - a.length)[0];
  if (!strongest) return unavailable('Curve border not found; capture the full chart');
  const band = borders
    .filter((row) => Math.abs(row.y - strongest.y) <= 4 && row.length > strongest.length * 0.95)
    .sort((a, b) => a.y - b.y);
  const border = band[Math.floor(band.length / 2)],
    scale = border.length / 1510;
  const left = border.left,
    right = border.right - 9 * scale,
    top = border.y;
  const scanLeft = Math.max(0, Math.floor(left - 12 * scale)),
    scanRight = Math.min(w - 1, Math.ceil(right + 30 * scale)),
    scanTop = Math.max(0, Math.floor(top - 10 * scale)),
    scanBottom = Math.min(h - 1, Math.ceil(top + 320 * scale));
  const white = (i: number) => {
    const j = i * info.channels,
      r = data[j],
      g = data[j + 1],
      b = data[j + 2];
    return Math.min(r, g, b) > 175 && Math.max(r, g, b) - Math.min(r, g, b) < 75;
  };
  const mask = new Uint8Array(w * h);
  for (let y = scanTop; y <= scanBottom; y++)
    for (let x = scanLeft; x <= scanRight; x++) if (white(y * w + x)) mask[y * w + x] = 1;
  const markers: Array<{ x: number; y: number }> = [];
  for (let y = scanTop; y <= scanBottom; y++)
    for (let x = scanLeft; x <= scanRight; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const queue = [i];
      mask[i] = 0;
      let x1 = x,
        x2 = x,
        y1 = y,
        y2 = y;
      for (let k = 0; k < queue.length; k++) {
        const q = queue[k],
          qx = q % w,
          qy = Math.floor(q / w);
        x1 = Math.min(x1, qx);
        x2 = Math.max(x2, qx);
        y1 = Math.min(y1, qy);
        y2 = Math.max(y2, qy);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const n = q + dy * w + dx;
            if (n >= 0 && n < mask.length && mask[n]) {
              mask[n] = 0;
              queue.push(n);
            }
          }
      }
      const width = x2 - x1 + 1,
        height = y2 - y1 + 1;
      if (
        width >= 11 * scale &&
        width <= 27 * scale &&
        height >= 11 * scale &&
        height <= 27 * scale &&
        Math.min(width, height) / Math.max(width, height) > 0.75 &&
        queue.length >= 30 * scale * scale &&
        queue.length / (width * height) < (cropped ? 0.5 : 0.38)
      )
        markers.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
    }
  markers.sort((a, b) => a.x - b.x);
  if (
    markers.length < 3 ||
    markers.length > 240 ||
    Math.abs(markers[0].x - left) > 18 * scale ||
    markers[0].y - top < 75 * scale ||
    markers[0].y - top > 200 * scale ||
    markers.at(-1)!.x - markers[0].x < (right - left) * 0.7 ||
    markers.some((p, i) => i > 0 && p.x - markers[i - 1].x < 10 * scale)
  )
    return unavailable('Curve markers incomplete; keep previous curve');
  const baseline = markers[0].y,
    halfHeight = baseline - (top + 2 * scale),
    bottom = baseline + halfHeight;
  const clockTop = Math.round(bottom + 16 * scale),
    clockHeight = Math.round(48 * scale);
  if (clockTop + clockHeight >= h || right + 70 * scale >= w)
    return unavailable('Curve axes clipped; include the full time and economy labels');
  // Group actual clock labels, including phase boundaries. Their spacing need
  // not be linear, so calibrate between successive observed anchors.
  const ink: number[] = [];
  for (
    let x = Math.max(0, Math.floor(left - 75 * scale));
    x < Math.min(w, Math.ceil(right + 75 * scale));
    x++
  ) {
    let count = 0;
    for (let y = clockTop; y < clockTop + clockHeight; y++) if (white(y * w + x)) count++;
    if (count >= 2) ink.push(x);
  }
  const groups: Array<{ left: number; right: number }> = [];
  for (const x of ink) {
    const last = groups.at(-1);
    if (!last || x - last.right > 16 * scale) groups.push({ left: x, right: x });
    else last.right = x;
  }
  const clocks = groups.filter(
    (g) => g.right - g.left >= 35 * scale && g.right - g.left <= 150 * scale,
  );
  if (clocks.length < 2 || clocks.length > 6)
    return unavailable('Time axis unreadable; keep previous curve');
  const clockRight = (clocks.at(-1)!.left + clocks.at(-1)!.right) / 2;
  const axisLeft = Math.round(cropped ? right + 4 * scale : clockRight + 8 * scale),
    axisWidth = Math.min(Math.round(150 * scale), w - axisLeft - 1),
    axisHeight = Math.round(42 * scale);
  const regions = [
    { left: axisLeft, top: Math.round(top - 18 * scale), width: axisWidth, height: axisHeight },
    { left: axisLeft, top: Math.round(bottom - 19 * scale), width: axisWidth, height: axisHeight },
    ...clocks.map((g) => ({
      left: g.left - 3,
      top: clockTop,
      width: g.right - g.left + 7,
      height: clockHeight,
    })),
  ];
  const images = await Promise.all(
    regions.map(async (region, index) => {
      let image = await sharp(frame).extract(region).png().toBuffer();
      if (index < 2) {
        const { data: rgb, info: meta } = await sharp(image)
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true }),
          axis = Buffer.alloc(meta.width * meta.height, 255);
        for (let i = 0; i < axis.length; i++) {
          const r = rgb[i * meta.channels],
            g = rgb[i * meta.channels + 1],
            b = rgb[i * meta.channels + 2];
          if ((b > 160 && g > 90 && r < g * 0.8) || (r > 160 && g > 40 && b > 50 && r > g * 1.35))
            axis[i] = 0;
        }
        const glyphs: Array<{ left: number; right: number; top: number; bottom: number }> = [];
        for (let x = 0; x < meta.width; x++) {
          let top = meta.height,
            bottom = -1;
          for (let y = 0; y < meta.height; y++)
            if (axis[y * meta.width + x] === 0) {
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
          if (bottom < 0) continue;
          const last = glyphs.at(-1);
          if (last && x - last.right <= 2) {
            last.right = x;
            last.top = Math.min(last.top, top);
            last.bottom = Math.max(last.bottom, bottom);
          } else glyphs.push({ left: x, right: x, top, bottom });
        }
        const tallest = Math.max(...glyphs.map((g) => g.bottom - g.top + 1));
        const firstDigit = glyphs.find((g) => g.bottom - g.top + 1 >= tallest * 0.85);
        if (cropped && firstDigit)
          for (let y = 0; y < meta.height; y++)
            axis.fill(255, y * meta.width, y * meta.width + firstDigit.left);
        image = await sharp(axis, { raw: { width: meta.width, height: meta.height, channels: 1 } })
          .png()
          .toBuffer();
      } else if (cropped) {
        const { data: rgb, info: meta } = await sharp(image)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const mask = Buffer.alloc(meta.width * meta.height, 255);
        for (let i = 0; i < mask.length; i++) {
          const channels = [
            rgb[i * meta.channels],
            rgb[i * meta.channels + 1],
            rgb[i * meta.channels + 2],
          ];
          if (Math.min(...channels) > 145 && Math.max(...channels) - Math.min(...channels) < 90)
            mask[i] = 0;
        }
        image = await sharp(mask, { raw: { width: meta.width, height: meta.height, channels: 1 } })
          .png()
          .toBuffer();
      }
      return 'data:image/png;base64,' + image.toString('base64');
    }),
  );
  // Keep colored scale labels and clocks in separate OCR batches: mixing
  // their glyph sizes can make a readable 13:17 disappear in segmentation.
  const axisRead = await provider.recognizeNumbers(images.slice(0, 2));
  const axisValue = (text: string) => parsePostGameNumber(text.replace(/^\s*\+/, ''), 'gold');
  if (
    axisRead.confidences.some(
      (confidence, i) => confidence < 0.85 || axisValue(axisRead.texts[i]) === null,
    )
  ) {
    const native = await provider.recognizeNumbers(
      await Promise.all(
        regions
          .slice(0, 2)
          .map(
            async (region) =>
              'data:image/png;base64,' +
              (await sharp(frame).extract(region).png().toBuffer()).toString('base64'),
          ),
      ),
    );
    // A confident but invalid string is not evidence of a scale. Let a valid
    // native read recover it even when its confidence is slightly lower.
    for (let i = 0; i < 2; i++)
      if (
        axisValue(native.texts[i]) !== null &&
        (axisValue(axisRead.texts[i]) === null || native.confidences[i] > axisRead.confidences[i])
      ) {
        axisRead.texts[i] = native.texts[i];
        axisRead.confidences[i] = native.confidences[i];
      }
  }
  for (let i = 0; i < 2; i++) {
    if (axisValue(axisRead.texts[i]) !== null && axisRead.confidences[i] >= 0.85) continue;
    // Resampled labels have jagged binary strokes. Retry bounded, antialiased
    // views of the same visible glyphs; require two reliable agreeing reads.
    const input = Buffer.from(images[i].split(',')[1], 'base64');
    const metadata = await sharp(input).metadata();
    const variants: Buffer[] = await Promise.all([
      sharp(input).blur(0.3).png().toBuffer(),
      sharp(input).blur(0.5).png().toBuffer(),
      sharp(input)
        .resize(metadata.width! * 2, metadata.height! * 2)
        .png()
        .toBuffer(),
    ]);
    const retry = await provider.recognizeNumbers(
      variants.map((buffer) => 'data:image/png;base64,' + buffer.toString('base64')),
    );
    const votes = retry.texts
      .map((text, index) => ({
        text,
        value: axisValue(text),
        confidence: retry.confidences[index],
      }))
      .filter(
        (candidate) =>
          candidate.value !== null && candidate.value > 0 && candidate.confidence >= 0.85,
      );
    const agreed = votes
      .filter((candidate) => votes.filter((other) => other.value === candidate.value).length >= 2)
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (agreed) {
      axisRead.texts[i] = agreed.text;
      axisRead.confidences[i] = agreed.confidence;
    }
  }
  const scales = axisRead.texts.map(axisValue);
  const axisConfidence = Math.min(...axisRead.confidences);
  // Both sides are independent scale evidence. One strong read cannot make a
  // weak matching string trustworthy, and there is no reason to OCR clocks yet.
  if (scales[0] === null || scales[0] === 0 || scales[0] !== scales[1] || axisConfidence < 0.85)
    return unavailable(
      'Positive and negative economy scales require matching, high-confidence reads',
    );
  const clockRead = await provider.recognizeNumbers(images.slice(2));
  for (let i = 0; i < clockRead.texts.length; i++) {
    if (/^\d{1,3}:[0-5]\d$/.test(clockRead.texts[i].trim()) && clockRead.confidences[i] >= 0.85)
      continue;
    const input = Buffer.from(images[i + 2].split(',')[1], 'base64');
    const variants = await Promise.all(
      [100, 160, 190].map(
        async (threshold) =>
          'data:image/png;base64,' +
          (await sharp(input).greyscale().threshold(threshold).negate().png().toBuffer()).toString(
            'base64',
          ),
      ),
    );
    const retry = await provider.recognizeNumbers(variants);
    const votes = retry.texts
      .map((text, index) => ({ text: text.trim(), confidence: retry.confidences[index] }))
      .filter((c) => /^\d{1,3}:[0-5]\d$/.test(c.text) && c.confidence >= 0.85);
    const agreed = votes
      .filter((c) => votes.filter((other) => other.text === c.text).length >= 2)
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (agreed) {
      clockRead.texts[i] = agreed.text;
      clockRead.confidences[i] = agreed.confidence;
    }
  }
  const anchors = clocks.map((g, i) => {
    const match = /^(\d{1,3}):([0-5]\d)$/.exec(clockRead.texts[i].trim());
    return {
      x: (g.left + g.right) / 2,
      time: match ? Number(match[1]) * 60 + Number(match[2]) : NaN,
      confidence: clockRead.confidences[i],
    };
  });
  if (
    anchors.some(
      (a, i) =>
        !Number.isInteger(a.time) ||
        a.confidence < 0.85 ||
        a.time > 7200 ||
        (i > 0 && a.time <= anchors[i - 1].time),
    ) ||
    anchors[0].time !== 0 ||
    Math.abs(anchors[0].x - markers[0].x) > 20 * scale ||
    Math.abs(anchors.at(-1)!.x - right) > (cropped ? 60 : 25) * scale
  )
    return unavailable('Time axis requires review');
  const fullEnd = Math.abs(markers.at(-1)!.x - right) <= 18 * scale;
  anchors[0].x = markers[0].x;
  if (fullEnd) anchors[anchors.length - 1].x = markers.at(-1)!.x;
  const maxDifference = scales[0];
  const points = markers.map((marker) => {
    let index = anchors.findIndex((a) => a.x >= marker.x);
    if (index < 0) index = anchors.length - 1;
    else if (index === 0) index = 1;
    const before = anchors[index - 1],
      after = anchors[index];
    return {
      timeSeconds: Math.round(
        before.time + ((after.time - before.time) * (marker.x - before.x)) / (after.x - before.x),
      ),
      difference:
        Math.round(
          (Math.max(-1, Math.min(1, (baseline - marker.y) / halfHeight)) * maxDifference) / 10,
        ) * 10,
    };
  });
  if (points.some((p, i) => i > 0 && p.timeSeconds <= points[i - 1].timeSeconds))
    return unavailable('Curve time samples overlap');
  return {
    points,
    maxDifference,
    durationSeconds: anchors.at(-1)!.time,
    confidence: Math.min(axisConfidence, ...anchors.map((a) => a.confidence)),
    ...(!fullEnd
      ? {
          warning:
            '末尾标记被遮挡；只保留可见的曲线点 / Final marker obscured; visible points retained',
        }
      : {}),
  };
}
