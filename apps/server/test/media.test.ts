import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clipNameFor } from '@runflow/core';
import {
  createTestContext,
  resetDb,
  setupFirstOrg,
  type Client,
  type TestContext,
} from './helpers';

/* F2.1 Media: subida con duración (ffprobe), proxy (ffmpeg), Range y copia a CasparCG. */

let ctx: TestContext;
let admin: Client;
let dir: string;
let video: Buffer;
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'runflow-media-'));
  const file = path.join(dir, 'prueba.mp4');
  if (hasFfmpeg) {
    execFileSync('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=320x240:rate=25',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
    video = await readFile(file);
  } else {
    video = Buffer.from('falso vídeo');
  }
  ctx = await createTestContext({ DATA_DIR: path.join(dir, 'data') });
});
afterAll(async () => {
  await ctx.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb();
  ({ admin } = await setupFirstOrg(ctx.app));
});

function upload(name: string, mime: string, content: Buffer, folder = '') {
  const boundary = '----runflow';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\n${folder}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return ctx.app.inject({
    method: 'POST',
    url: '/api/media',
    headers: {
      cookie: admin.cookie!,
      'x-runflow-request': '1',
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
}

describe('media', () => {
  it('nombres de clip para CasparCG', () => {
    expect(clipNameFor('Noticias/2026-11-20', 'Pieza Gobierno (final).mov')).toBe(
      'NOTICIAS/2026-11-20/PIEZA_GOBIERNO_FINAL',
    );
    expect(clipNameFor('', 'Árbol ñandú')).toBe('ARBOL_NANDU');
  });

  it('sube, previsualiza con Range, organiza, copia a CasparCG y borra', async () => {
    const res = await upload('Pieza Gobierno.mp4', 'video/mp4', video, 'Noticias');
    expect(res.statusCode).toBe(201);
    const m = res.json().media;
    expect(m).toMatchObject({ name: 'Pieza Gobierno', folder: 'Noticias', mime: 'video/mp4' });
    expect(m.clipName).toBe('NOTICIAS/PIEZA_GOBIERNO');
    if (hasFfmpeg) {
      expect(m.durationS).toBeCloseTo(2, 0);
      expect(m).toMatchObject({ width: 320, height: 240, proxyStatus: 'pending' });
      await expect
        .poll(async () => (await admin.get('/api/media')).body.media[0].proxyStatus, {
          timeout: 20_000,
        })
        .toBe('ready');
    }

    const range = await ctx.app.inject({
      method: 'GET',
      url: `/api/media/${m.id}/file`,
      headers: { cookie: admin.cookie!, range: 'bytes=0-99' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.headers['content-range']).toBe(`bytes 0-99/${video.length}`);
    expect(range.rawPayload.length).toBe(100);
    if (hasFfmpeg) {
      const proxy = await ctx.app.inject({
        method: 'GET',
        url: `/api/media/${m.id}/file?proxy=1`,
        headers: { cookie: admin.cookie! },
      });
      expect(proxy.statusCode).toBe(200);
      expect(proxy.headers['content-type']).toBe('video/mp4');
    }

    const moved = await admin.patch(`/api/media/${m.id}`, {
      folder: ' Deportes / Fútbol ',
      name: 'Gol',
    });
    expect(moved.body.media).toMatchObject({
      folder: 'Deportes/Fútbol',
      clipName: 'DEPORTES/FUTBOL/GOL',
    });
    const list = (await admin.get('/api/media')).body;
    expect(list.folders).toEqual(['Deportes/Fútbol']);

    // Copia a la carpeta de medios de CasparCG
    const casparMedia = path.join(dir, 'caspar-media');
    const device = await admin.post('/api/devices', {
      name: 'CasparCG',
      kind: 'casparcg',
      config: { host: '127.0.0.1', mediaPath: casparMedia, oscPort: 0 },
    });
    const copy = await admin.post(`/api/media/${m.id}/casparcg`, {
      deviceId: device.body.device.id,
    });
    expect(copy.body).toEqual({ clipName: 'DEPORTES/FUTBOL/GOL' });
    expect(existsSync(path.join(casparMedia, 'DEPORTES', 'FUTBOL', 'GOL.mp4'))).toBe(true);

    expect((await admin.delete(`/api/media/${m.id}`)).status).toBe(200);
    expect((await admin.get('/api/media')).body.media).toHaveLength(0);
  });

  it('solo vídeo, imagen o audio', async () => {
    const res = await upload('virus.exe', 'application/octet-stream', Buffer.from('MZ'));
    expect(res.statusCode).toBe(415);
  });
});
