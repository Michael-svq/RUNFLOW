import dgram from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { amcp, AmcpClient, AmcpError, parseCls } from '../src/cg/amcp';
import { decodeOsc, encodeOsc, OscListener, type ClipTime } from '../src/cg/osc';
import { CasparSimulator, tokenize } from '../src/cg/simulator';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function sim(options: ConstructorParameters<typeof CasparSimulator>[0] = {}) {
  const s = new CasparSimulator({ clips: [{ name: 'PIEZA_GOBIERNO', duration: 70 }], ...options });
  const port = await s.start();
  const client = new AmcpClient('127.0.0.1', port, { reconnectMs: 50 });
  cleanup.push(
    () => s.stop(),
    () => client.close(),
  );
  await client.ready();
  return { s, client };
}

describe('AMCP', () => {
  it('envía órdenes y entiende las respuestas de una, varias o ninguna línea', async () => {
    const { s, client } = await sim();
    expect((await client.send(amcp.version())).data[0]).toMatch(/2\.3/);
    const cls = await client.send(amcp.cls());
    expect(parseCls(cls.data)).toEqual([{ name: 'PIEZA_GOBIERNO', type: 'MOVIE', duration: 70 }]);
    await client.send(amcp.loadbg(1, 10, 'pieza_gobierno'));
    await client.send(amcp.play(1, 10));
    expect(s.layer(1, 10).clip).toBe('pieza_gobierno');
    await expect(client.send(amcp.play(1, 10, 'NO_EXISTE'))).rejects.toBeInstanceOf(AmcpError);
  });

  it('pasa textos con comillas y saltos de línea a las plantillas', async () => {
    const { s, client } = await sim();
    const data = { fields: { f0: 'ANA "LA JEFA"', f1: 'línea 1\nlínea 2 \\ fin' } };
    await client.send(amcp.cgAdd(1, 20, 'http://x/cg/TOT.html', data));
    expect(JSON.parse(s.layer(1, 20).templateData!)).toEqual(data);
    expect(tokenize('CG 1-20 ADD 1 "a b" 1 "x\\"y"')).toEqual([
      'CG',
      '1-20',
      'ADD',
      '1',
      'a b',
      '1',
      'x"y',
    ]);
  });

  it('se reconecta cuando CasparCG vuelve', async () => {
    const { s, client } = await sim();
    s.dropConnections();
    await expect.poll(() => client.connected).toBe(false);
    await expect.poll(() => client.connected, { timeout: 2000 }).toBe(true);
    expect((await client.send(amcp.version())).code).toBe(201);
  });
});

describe('OSC', () => {
  it('codifica y decodifica mensajes y paquetes', () => {
    const msg = encodeOsc('/channel/1/stage/layer/10/foreground/file/time', [12.5, 70]);
    expect(decodeOsc(msg)).toEqual([
      { address: '/channel/1/stage/layer/10/foreground/file/time', args: [12.5, 70] },
    ]);
    const head = Buffer.alloc(16);
    head.write('#bundle\0');
    const size = Buffer.alloc(4);
    size.writeInt32BE(msg.length);
    expect(decodeOsc(Buffer.concat([head, size, msg]))).toHaveLength(1);
  });

  it('recibe la posición real del clip del simulador', async () => {
    const probe = dgram.createSocket('udp4');
    await new Promise<void>((r) => probe.bind(0, r));
    const port = (probe.address() as { port: number }).port;
    probe.close();
    const listener = new OscListener(port);
    listener.start();
    cleanup.push(() => listener.close());
    const { client } = await sim({ oscPort: port });
    const times: ClipTime[] = [];
    listener.on('time', (t: ClipTime) => times.push(t));
    await client.send(amcp.play(1, 10, 'PIEZA_GOBIERNO'));
    await expect.poll(() => times.length, { timeout: 2000 }).toBeGreaterThan(1);
    expect(times.at(-1)).toMatchObject({ channel: 1, layer: 10, total: 70 });
    expect(times.at(-1)!.elapsed).toBeLessThan(2);
  });
});
