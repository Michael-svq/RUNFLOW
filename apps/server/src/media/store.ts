import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

/*
 * Almacén de media en disco (DATA_DIR/media/<empresa>/…) con ffprobe para la
 * duración y ffmpeg para los proxies de previsualización, si están instalados.
 */

export interface Probe {
  durationS: number | null;
  width: number | null;
  height: number | null;
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return resolve({ code: -1, out: '' });
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, out: '' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out });
    });
  });
}

export class MediaStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  dir(orgId: string): string {
    return path.join(this.dataDir, 'media', orgId);
  }

  file(orgId: string, fileName: string): string {
    return path.join(this.dir(orgId), fileName);
  }

  proxy(orgId: string, id: string): string {
    return path.join(this.dir(orgId), 'proxies', `${id}.mp4`);
  }

  async ensureDir(orgId: string): Promise<void> {
    await mkdir(path.join(this.dir(orgId), 'proxies'), { recursive: true });
  }

  async remove(orgId: string, id: string, fileName: string): Promise<void> {
    await rm(this.file(orgId, fileName), { force: true });
    await rm(this.proxy(orgId, id), { force: true });
  }

  /** Duración y tamaño de imagen con ffprobe (null si no está instalado). */
  async probe(file: string): Promise<Probe> {
    const { code, out } = await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', file],
      30_000,
    );
    if (code !== 0) return { durationS: null, width: null, height: null };
    try {
      const json = JSON.parse(out) as {
        format?: { duration?: string };
        streams?: { width?: number; height?: number }[];
      };
      const video = json.streams?.find((s) => s.width && s.height);
      const d = Number(json.format?.duration);
      return {
        durationS: Number.isFinite(d) && d > 0 ? Math.round(d * 100) / 100 : null,
        width: video?.width ?? null,
        height: video?.height ?? null,
      };
    } catch {
      return { durationS: null, width: null, height: null };
    }
  }

  /** Proxy H.264 ligero para previsualizar en el navegador (uno cada vez). */
  makeProxy(input: string, output: string): Promise<boolean> {
    const job = this.queue.then(async () => {
      const { code } = await run(
        'ffmpeg',
        [
          '-y',
          '-v',
          'error',
          '-i',
          input,
          '-vf',
          'scale=-2:480',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '28',
          '-c:a',
          'aac',
          '-b:a',
          '96k',
          '-movflags',
          '+faststart',
          output,
        ],
        30 * 60_000,
      );
      return code === 0 && existsSync(output);
    });
    this.queue = job.catch(() => false);
    return job;
  }
}
