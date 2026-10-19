import { statfs } from 'node:fs/promises';
import type { ObsRecordHealth } from '../../src/shared/obsProtocol.js';
import { localRecordDirectory } from './ObsConfig.js';
export type ObsDiskProbe = (directory: string) => Promise<number>;
export const probeDiskFree: ObsDiskProbe = async directory => {
  if (!localRecordDirectory(directory) || !directory) throw new Error('Invalid recording directory');
  const disk = await statfs(directory, { bigint: true });
  return Number(disk.bavail * disk.bsize);
};
export async function recordHealth(options: {
  directory: string | null; source: ObsRecordHealth['directorySource']; lowDiskGb: number;
  remainingMinutesWarning: number; rate: number | null; probe: ObsDiskProbe;
}): Promise<ObsRecordHealth> {
  const result: ObsRecordHealth = { directory: options.directory, directorySource: options.source,
    freeBytes: null, estimatedMinutes: null, rateBytesPerSecond: options.rate, level: 'unknown', warnings: [] };
  if (!options.directory) { result.warnings.push('Recording directory is unknown; select a local recording directory'); return result; }
  try {
    if (!localRecordDirectory(options.directory)) throw new Error('Non-local directory');
    const free = await options.probe(options.directory);
    if (!Number.isFinite(free) || free < 0) throw new Error('Invalid free space');
    result.freeBytes = free;
    result.estimatedMinutes = options.rate && options.rate > 0 ? free / options.rate / 60 : null;
    result.level = free < 1024 ** 3 ? 'critical' : free < options.lowDiskGb * 1024 ** 3 ? 'warning' : 'ok';
    if (result.level !== 'ok') result.warnings.push('Recording disk space is low; check a backup recording destination');
    if (result.estimatedMinutes !== null && result.estimatedMinutes < options.remainingMinutesWarning) {
      if (result.level === 'ok') result.level = 'warning';
      result.warnings.push('Estimated recording time is below the warning threshold (variable bitrate estimate)');
    }
    if (options.source === 'manual') result.warnings.push('Recording directory is manually specified; verify it matches OBS output');
  } catch { result.level = 'warning'; result.warnings.push('Cannot inspect recording directory or disk space'); }
  return result;
}
