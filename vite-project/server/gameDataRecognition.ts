import { recognizeHudNumbers } from './hudOcrCache.js';
import { fusePostGame, fusePlayers, fuseHud } from './aiFusion.js';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import {
  fullGameRect,
  liveCaptureKeys,
  liveCaptureRects,
  parseLiveNumber,
  pixelRect,
  recapRegions,
  settlementColumns,
  settlementNameRect,
  settlementTabPages,
  settlementGradeRect,
  settlementTabRects,
  validCaptureRect,
  type LiveCaptureKey,
  type CaptureRect,
} from '../src/shared/gameCapture.js';
import {
  parsePostGameNumber,
  postGameNumberResolution,
  postGameGrades,
  type PostGameGradeField,
  type PostGamePage,
  type PostGameReport,
  type PostGameTeamMetric,
} from '../src/shared/postGame.js';
import { solvePlayerSlotCandidates } from '../src/shared/playerSlots.js';
import type { Side } from '../src/shared/types.js';
import type { PlayerRecognitionProvider } from './playerRecognition.js';
import { recognizeSettlementGoldCurve } from './settlementGoldCurve.js';
const settlementIds = new WeakMap<
  object,
  Map<
    string,
    {
      until: number;
      result: Promise<Awaited<ReturnType<PlayerRecognitionProvider['recognizePlayerIds']>>>;
    }
  >
>();

/** Stop nearly blank frames before producing false OCR evidence. */
export async function frameHasVisualContent(frame: Buffer): Promise<boolean> {
  const result = await sharp(frame).resize(96, 54, { fit: 'fill' }).greyscale().stats();
  return (result.channels[0]?.stdev ?? 0) >= 5;
}
export async function decodeGameFrame(image: unknown, region: unknown = fullGameRect) {
  if (
    typeof image !== 'string' ||
    image.length > 4 * 1024 * 1024 ||
    !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image) ||
    !validCaptureRect(region)
  )
    throw new Error('Invalid game frame or content region');
  const source = Buffer.from(image.split(',')[1], 'base64'),
    meta = await sharp(source, { limitInputPixels: 9000000 }).metadata();
  if (!meta.width || !meta.height || meta.width > 4096 || meta.height > 2160)
    throw new Error('Game frame too large');
  const bounds = pixelRect(region, meta.width, meta.height);
  if (
    bounds.width < 640 ||
    bounds.height < 360 ||
    Math.abs(bounds.width / bounds.height - 16 / 9) > 0.08
  )
    throw new Error('Select the 16:9 game content, excluding window borders');
  return sharp(source).extract(bounds).resize(1920, 1080).png().toBuffer();
}
async function crop(frame: Buffer, region: CaptureRect) {
  return (
    'data:image/png;base64,' +
    (
      await sharp(frame)
        .extract(pixelRect(region, 1920, 1080))
        .png()
        .toBuffer()
    ).toString('base64')
  );
}

export async function classifySettlementPage(frame: Buffer) {
  // The landing page has a blue Data button and a gold Return-to-room button,
  // rather than the seven-tab navigation used by detailed statistics.
  const { data: buttons, info: buttonInfo } = await sharp(frame)
    .extract({ left: 10, top: 945, width: 1190, height: 65 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let blue = 0,
    gold = 0;
  for (let y = 0; y < buttonInfo.height; y++)
    for (let x = 0; x < buttonInfo.width; x++) {
      const i = (y * buttonInfo.width + x) * buttonInfo.channels,
        r = buttons[i],
        g = buttons[i + 1],
        b = buttons[i + 2];
      if (x < 210 && b > 140 && g > 100 && b > r * 1.3) blue++;
      if (x > 930 && r > 135 && g > 110 && b < g * 0.85 && r > b * 1.3) gold++;
    }
  if (blue / (210 * 65) > 0.3 && gold / (259 * 65) > 0.3)
    return { page: 'summary' as PostGamePage, scores: [], margin: 1 };
  const scores = await Promise.all(
    settlementTabRects.map(async (region) => {
      const { data, info } = await sharp(frame)
        .extract(pixelRect(region, 1920, 1080))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let count = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        if (r > 170 && g > 170 && b > 170 && Math.max(r, g, b) - Math.min(r, g, b) < 55) count++;
      }
      return count / (info.width * info.height);
    }),
  );
  const ranked = scores
    .map((score, index) => ({ score, page: settlementTabPages[index] }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0],
    margin = best.score - ranked[1].score;
  return { page: best.score > 0.025 && margin > 0.012 ? best.page : null, scores, margin };
}

export async function recognizeSettlement(
  frame: Buffer,
  page: PostGamePage | 'auto',
  report: PostGameReport,
  provider: Pick<PlayerRecognitionProvider, 'recognizePlayerIds' | 'recognizeNumbers'> &
    Partial<Pick<PlayerRecognitionProvider, 'recognizeGrades'>>,
  leftSide: Side = 'blue',
  aiContext?: string,
) {
  const detection = await classifySettlementPage(frame),
    selected = page === 'auto' ? detection.page : page;
  if (!selected)
    throw new Error(
      '未识别结算页面，请选择页面类型后重试 / Page not recognized; choose its page type and retry',
    );
  const start = performance.now();
  if (selected === 'recap') {
    const jobs = (['left', 'right'] as const).flatMap((side) => {
      const regions = recapRegions(side);
      return [
        { side, key: 'kda', region: regions.kda },
        { side, key: 'gold', region: regions.gold },
        ...regions.resources.map((region, index) => ({
          side,
          key: index === 0 ? 'towers' : `resource${index}`,
          region,
        })),
      ];
    });
    const result = await provider.recognizeNumbers(
      await Promise.all(jobs.map((job) => crop(frame, job.region))),
      true,
    );
    const teamCandidates = jobs.flatMap((job, index) => {
      const text = result.texts[index],
        confidence = result.confidences[index];
      if (job.key === 'kda') {
        const match = /^(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})$/.exec(text.trim());
        return (['kills', 'deaths', 'assists'] as const).map((metric, i) => ({
          side: job.side,
          metric,
          value: match ? Number(match[i + 1]) : null,
          confidence: match ? confidence : 0,
          text,
        }));
      }
      const value =
        job.key === 'gold'
          ? parsePostGameNumber(text.replace(/^\+/, ''), 'gold')
          : /^\d{1,2}$/.test(text.trim())
            ? Number(text)
            : null;
      return [
        {
          side: job.side,
          metric: job.key as PostGameTeamMetric,
          value,
          confidence: value === null ? 0 : confidence,
          text,
        },
      ];
    });
    const goldCurve = await recognizeSettlementGoldCurve(frame, provider).catch(() => ({
      points: [],
      maxDifference: 0,
      confidence: 0,
      error: 'Curve OCR unavailable; keep previous curve and retry',
    }));
    return {
      page: selected,
      leftSide,
      detection,
      rows: [],
      candidates: [],
      teamCandidates,
      goldCurve,
      elapsedMs: performance.now() - start,
    };
  }
  // Friendly players are displayed on the left even when their actual match
  // side is red. Keep crops in screen order and only change identity rosters.
  const roster = ([leftSide, leftSide === 'blue' ? 'red' : 'blue'] as const).map((side) =>
    report.players.filter((p) => p.side === side),
  );
  if (roster.some((players) => players.length !== 5))
    throw new Error('Ten-player identity snapshot required');
  const jobs = Array.from({ length: 10 }, (_, screenRow) =>
    settlementColumns(selected, screenRow).map((column) => ({ ...column, screenRow })),
  ).flat();
  const [idImages, numberImages] = await Promise.all([
    Promise.all(
      Array.from({ length: 10 }, (_, row) => crop(frame, settlementNameRect(row, selected))),
    ),
    Promise.all(jobs.map((job) => crop(frame, job.region))),
  ]);
  let cache = settlementIds.get(provider);
  if (!cache) {
    cache = new Map();
    settlementIds.set(provider, cache);
  }
  const idKey = createHash('sha256')
    .update(
      JSON.stringify([
        report.id,
        leftSide,
        roster.map((players) => players.map((p) => [p.rowId, p.playerId])),
        idImages,
      ]),
    )
    .digest('hex');
  const previous = cache.get(idKey);
  const canCache = typeof report.id === 'string' && report.id.length > 0;
  const identityCacheHit = canCache && !!previous && previous.until > Date.now();
  const idJob = identityCacheHit
    ? previous!.result
    : provider.recognizePlayerIds(
        idImages,
        roster.map((players) => players.map((p) => p.playerId)) as [string[], string[]],
      );
  if (canCache && !identityCacheHit) {
    cache.set(idKey, { until: Date.now() + 60000, result: idJob });
    if (cache.size > 24) cache.delete(cache.keys().next().value!);
    void idJob.catch(() => {
      if (cache.get(idKey)?.result === idJob) cache.delete(idKey);
    });
  }
  // Only settlement ID crops are cached; live player-order stability stays independent.
  // These use separate resident workers; wait for both even when one fails.
  const [idRead, numericRead] = await Promise.allSettled([
    idJob,
    provider.recognizeNumbers(numberImages, true),
  ]);
  if (idRead.status === 'rejected') throw idRead.reason;
  if (numericRead.status === 'rejected') throw numericRead.reason;
  const ids = idRead.value,
    numeric = numericRead.value;
  const idCandidates = aiContext
    ? fusePlayers(
        idImages,
        ids.candidates,
        roster.map((players) => players.map((p) => p.playerId)) as [string[], string[]],
        aiContext + ':settlement:' + selected,
      )
    : ids.candidates;
  const identity = roster.map((players, index) =>
    solvePlayerSlotCandidates(
      idCandidates.slice(index * 5, index * 5 + 5),
      players.map((p) => p.playerId),
    ),
  );
  if (aiContext)
    jobs.forEach((job, index) => {
      const fused = fusePostGame(
        numberImages[index],
        job.metric,
        `${aiContext}:${selected}:${job.screenRow}:${job.metric}`,
        { text: numeric.texts[index], confidence: numeric.confidences[index] },
      );
      numeric.texts[index] = fused.text;
      numeric.confidences[index] = fused.confidence;
    });
  let gradeWarning: string | undefined;
  // The optional letter-grade worker shares the numeric worker with HUD OCR.
  // If it becomes busy between batches, preserve the completed page fields.
  const gradeRead =
    selected === 'summary' && provider.recognizeGrades
      ? await provider
          .recognizeGrades(
            await Promise.all(
              Array.from({ length: 10 }, (_, row) => crop(frame, settlementGradeRect(row))),
            ),
          )
          .catch(() => {
            gradeWarning =
              '字母评级识别暂不可用；KDA 和经济已保留，可重试本页或人工核对评级。 / Grade OCR unavailable; KDA and gold retained. Retry this page or review grades manually.';
            return null;
          })
      : null;
  const grades = gradeRead?.texts.map((text, screenRow) => {
    const value = text.normalize('NFKC').replace(/\s/g, '');
    return {
      screenRow,
      text,
      value: postGameGrades.includes(value as PostGameGradeField['value']) ? value : null,
      confidence: gradeRead.confidences[screenRow],
    };
  });
  return {
    page: selected,
    leftSide,
    detection,
    identity,
    rows: Array.from({ length: 10 }, (_, screenRow) => {
      const side = screenRow < 5 ? 0 : 1,
        solution = identity[side];
      return {
        screenRow,
        text: ids.texts[screenRow],
        rowId: solution?.automatic ? roster[side][solution.order[screenRow % 5]].rowId : null,
        suggestedRowId: solution ? roster[side][solution.order[screenRow % 5]].rowId : null,
      };
    }),
    grades,
    gradeWarning,
    timings: {
      identityCacheHit,
      identityMs: identityCacheHit ? 0 : ids.elapsedMs,
      numericMs: numeric.elapsedMs,
      elapsedMs: performance.now() - start,
    },
    candidates: jobs.map((job, index) => ({
      screenRow: job.screenRow,
      metric: job.metric,
      value: parsePostGameNumber(numeric.texts[index], job.metric),
      resolution: postGameNumberResolution(numeric.texts[index], job.metric),
      confidence: numeric.confidences[index],
      text: numeric.texts[index],
    })),
    elapsedMs: performance.now() - start,
  };
}

/** Keep the proven bright-cyan suppression only when the crop actually
 * contains blue native HUD accent pixels. For color-neutral themes use
 * unchanged images; a forced cyan mask caused different UI layouts to fail.
 * Snapshot OCR remains experimental and must be operator-calibrated. */
async function prepareLiveHudCrop(input: Buffer, key: LiveCaptureKey) {
  const plain = () => 'data:image/png;base64,' + input.toString('base64');
  if (!key.startsWith('blue')) return plain();
  const { data, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = Buffer.alloc(info.width * info.height, 255);
  let cyanPixels = 0;
  for (let i = 0; i < mask.length; i++) {
    const r = data[i * info.channels],
      g = data[i * info.channels + 1],
      b = data[i * info.channels + 2];
    if (g > 85 && b > 130 && g > r * 1.3 && b > r * 1.3) {
      cyanPixels++;
      mask[i] = 255 - Math.min(255, (g - 85) * 4);
    }
  }
  if (cyanPixels < Math.max(8, mask.length * 0.012)) return plain();
  return (
    'data:image/png;base64,' +
    (
      await sharp(mask, { raw: { width: info.width, height: info.height, channels: 1 } })
        .png()
        .toBuffer()
    ).toString('base64')
  );
}
export async function recognizeLiveHud(
  frame: Buffer,
  provider: PlayerRecognitionProvider,
  regions: Record<LiveCaptureKey, CaptureRect> = liveCaptureRects,
  aiContext?: string,
) {
  const images = await Promise.all(
    liveCaptureKeys.map(async (key) => {
      const input = await sharp(frame)
        .extract(pixelRect(regions[key], 1920, 1080))
        .png()
        .toBuffer();
      return prepareLiveHudCrop(input, key);
    }),
  );
  const result = await provider.recognizeNumbers(images);
  const candidates = liveCaptureKeys.map((key, index) => ({
    key,
    value: parseLiveNumber(result.texts[index], key),
    confidence: result.confidences[index],
    text: result.texts[index],
  }));
  return {
    candidates: aiContext ? fuseHud(images, candidates, aiContext) : candidates,
    elapsedMs: result.elapsedMs,
  };
}

/** Transport only calibrated HUD crops instead of repeatedly encoding/uploading
 * the entire animated 1080p game. Keep the same mask, parser and two-read rules. */
export async function recognizeLiveHudCrops(
  images: unknown,
  provider: Pick<PlayerRecognitionProvider, 'recognizeNumbers'>,
  regions: Record<LiveCaptureKey, CaptureRect>,
  cacheContext?: string,
) {
  const start = performance.now();
  if (!Array.isArray(images) || images.length !== liveCaptureKeys.length)
    throw new Error('Seven HUD crops required');
  const inputs = await Promise.all(
    images.map(async (image, index) => {
      if (
        typeof image !== 'string' ||
        image.length > 180000 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)
      )
        throw new Error('Invalid HUD crop');
      const input = Buffer.from(image.split(',')[1], 'base64');
      const { data, info } = await sharp(input, { limitInputPixels: 100000 })
        .removeAlpha()
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const expected = pixelRect(regions[liveCaptureKeys[index]], 1920, 1080);
      if (info.width !== expected.width || info.height !== expected.height)
        throw new Error('HUD crop dimensions do not match calibration');
      // The same tiny decode validates dimensions and rejects blank crops.
      // Avoid seven resize/statistics pipelines before every numeric batch.
      let sum = 0,
        squares = 0;
      for (const value of data) {
        sum += value;
        squares += value * value;
      }
      const variance = squares / data.length - (sum / data.length) ** 2;
      return { input, hasContent: variance >= 25 };
    }),
  );
  if (!inputs.some((crop) => crop.hasContent))
    throw new Error('HUD capture is blank; check the game source and calibration');
  const prepared = await Promise.all(
    inputs.map((crop, index) => prepareLiveHudCrop(crop.input, liveCaptureKeys[index])),
  );
  const result = await recognizeHudNumbers(prepared, provider, cacheContext);
  return {
    candidates: liveCaptureKeys.map((key, index) => ({
      key,
      value: parseLiveNumber(result.texts[index], key),
      confidence: result.confidences[index],
      text: result.texts[index],
    })),
    elapsedMs: performance.now() - start,
  };
}
