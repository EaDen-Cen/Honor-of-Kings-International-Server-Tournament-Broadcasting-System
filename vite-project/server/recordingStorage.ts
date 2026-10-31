import { statfs } from 'node:fs/promises';

/** Use the free blocks available to this process, not total unallocated blocks. */
export async function recordingDiskSpace(directory: string, read: (path: string) => Promise<{bavail:bigint;bsize:bigint;blocks:bigint}> = path => statfs(path, {bigint:true})) {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Recording directory not set');
  const volume = await read(directory);
  const freeBytes = Number(volume.bavail * volume.bsize);
  const totalBytes = Number(volume.blocks * volume.bsize);
  if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) throw new Error('Disk capacity unavailable');
  return {
    freeBytes,
    totalBytes,
    freePercent: Math.round(freeBytes / totalBytes * 1000) / 10,
    low: freeBytes < 20 * 1024 ** 3 || freeBytes / totalBytes < 0.1,
  };
}
