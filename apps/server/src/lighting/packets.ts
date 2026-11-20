/*
 * F4.3 Paquetes de iluminación, sin dependencias: OSC 1.0, MIDI Show Control
 * (por ipMIDI: MIDI en UDP), Art-Net (ArtDmx) y sACN (E1.31).
 */

/** Cadena OSC: ASCII terminada en 0 y rellena a múltiplo de 4. */
function oscString(s: string): Buffer {
  const raw = Buffer.from(s, 'utf8');
  const len = Math.ceil((raw.length + 1) / 4) * 4;
  const out = Buffer.alloc(len);
  raw.copy(out);
  return out;
}

/** Mensaje OSC con argumentos de texto, enteros (i) o reales (f). */
export function oscMessage(address: string, args: (string | number)[] = []): Buffer {
  const tags =
    ',' + args.map((a) => (typeof a === 'string' ? 's' : Number.isInteger(a) ? 'i' : 'f')).join('');
  const parts = [oscString(address), oscString(tags)];
  for (const a of args) {
    if (typeof a === 'string') parts.push(oscString(a));
    else {
      const b = Buffer.alloc(4);
      if (Number.isInteger(a)) b.writeInt32BE(a);
      else b.writeFloatBE(a);
      parts.push(b);
    }
  }
  return Buffer.concat(parts);
}

/** Lee un mensaje OSC (pruebas y simuladores). */
export function parseOsc(buf: Buffer): { address: string; args: (string | number)[] } {
  let off = 0;
  const str = () => {
    const end = buf.indexOf(0, off);
    const s = buf.toString('utf8', off, end);
    off = Math.ceil((end + 1) / 4) * 4;
    return s;
  };
  const address = str();
  const tags = off < buf.length ? str() : ',';
  const args: (string | number)[] = [];
  for (const t of tags.slice(1)) {
    if (t === 's') args.push(str());
    else if (t === 'i') {
      args.push(buf.readInt32BE(off));
      off += 4;
    } else if (t === 'f') {
      args.push(buf.readFloatBE(off));
      off += 4;
    }
  }
  return { address, args };
}

/** MIDI Show Control: GO de un cue (formato de iluminación general). */
export function mscGo(deviceId: number, cue: string, list = ''): Buffer {
  const ascii = (s: string) => [...Buffer.from(s.replace(/[^0-9.]/g, ''), 'ascii')];
  const body = [...ascii(cue)];
  if (list) body.push(0x00, ...ascii(list));
  return Buffer.from([0xf0, 0x7f, deviceId & 0x7f, 0x02, 0x01, 0x01, ...body, 0xf7]);
}

/** Art-Net ArtDmx (OpCode 0x5000, protocolo 14). */
export function artDmx(universe: number, sequence: number, data: Uint8Array): Buffer {
  const length = 512;
  const buf = Buffer.alloc(18 + length);
  buf.write('Art-Net\0', 0, 'ascii');
  buf.writeUInt16LE(0x5000, 8);
  buf.writeUInt16BE(14, 10);
  buf[12] = sequence & 0xff;
  buf[13] = 0;
  buf[14] = universe & 0xff; // SubUni
  buf[15] = (universe >> 8) & 0x7f; // Net
  buf.writeUInt16BE(length, 16);
  Buffer.from(data.subarray(0, length)).copy(buf, 18);
  return buf;
}

/** sACN / E1.31: paquete de datos de 512 canales (638 bytes). */
export function sacnPacket(
  universe: number,
  sequence: number,
  data: Uint8Array,
  opts: { cid: Buffer; sourceName: string; priority?: number },
): Buffer {
  const buf = Buffer.alloc(638);
  // Capa raíz
  buf.writeUInt16BE(0x0010, 0);
  buf.writeUInt16BE(0x0000, 2);
  buf.write('ASC-E1.17\0\0\0', 4, 'ascii');
  buf.writeUInt16BE(0x7000 | (638 - 16), 16);
  buf.writeUInt32BE(0x00000004, 18);
  opts.cid.copy(buf, 22, 0, 16);
  // Capa de trama
  buf.writeUInt16BE(0x7000 | (638 - 38), 38);
  buf.writeUInt32BE(0x00000002, 40);
  buf.write(opts.sourceName.slice(0, 63), 44, 'utf8');
  buf[108] = opts.priority ?? 100;
  buf.writeUInt16BE(0, 109); // dirección de sincronía
  buf[111] = sequence & 0xff;
  buf[112] = 0; // opciones
  buf.writeUInt16BE(universe, 113);
  // Capa DMP
  buf.writeUInt16BE(0x7000 | (638 - 115), 115);
  buf[117] = 0x02;
  buf[118] = 0xa1;
  buf.writeUInt16BE(0x0000, 119);
  buf.writeUInt16BE(0x0001, 121);
  buf.writeUInt16BE(513, 123);
  buf[125] = 0x00; // código de inicio
  Buffer.from(data.subarray(0, 512)).copy(buf, 126);
  return buf;
}

/** Multidifusión de un universo sACN: 239.255.alto.bajo */
export const sacnMulticast = (universe: number) =>
  `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
