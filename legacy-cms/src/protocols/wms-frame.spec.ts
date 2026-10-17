import {
  FrameDecoder,
  WmsProtocolError,
  decodeBody,
  decodeItems,
  encodeItems,
  encodeMessage,
  escapeField,
  unescapeField,
} from './wms-frame';

describe('WMS frame codec', () => {
  it('encodes a CHK frame byte for byte (golden)', () => {
    const frame = encodeMessage('CHK', 7, [
      'ORD-1',
      encodeItems([
        { sku: 'PROD-001', qty: 2 },
        { sku: 'PROD-002', qty: 1 },
      ]),
    ]);
    const body = 'CHK|7|ORD-1|PROD-001:2,PROD-002:1';
    expect(frame.toString('hex')).toBe(
      '00000021' + Buffer.from(body, 'utf8').toString('hex'),
    );
    expect(body.length).toBe(0x21);
  });

  it('escapes and unescapes the reserved characters', () => {
    expect(escapeField('a|b,c:d%e')).toBe('a%7Cb%2Cc%3Ad%25e');
    expect(unescapeField('a%7Cb%2Cc%3Ad%25e')).toBe('a|b,c:d%e');
    // %25 must not be decoded twice
    expect(unescapeField(escapeField('%7C'))).toBe('%7C');
  });

  it('round-trips item lists with awkward SKUs', () => {
    const items = [
      { sku: 'SKU|1', qty: 3 },
      { sku: 'a,b:c', qty: 10 },
    ];
    expect(decodeItems(encodeItems(items))).toEqual(items);
  });

  it('rejects malformed item lists', () => {
    expect(() => decodeItems('PROD-1')).toThrow(WmsProtocolError);
    expect(() => decodeItems('PROD-1:x')).toThrow(WmsProtocolError);
    expect(() => decodeItems('PROD-1:-1')).toThrow(WmsProtocolError);
  });

  it('refuses unescaped pipes in fields', () => {
    expect(() => encodeMessage('CHK', 1, ['bad|field'])).toThrow(
      WmsProtocolError,
    );
  });

  it('decodes a frame body into type, seq and fields', () => {
    expect(decodeBody(Buffer.from('ACK|12|OK|WMS-PKG-1'))).toEqual({
      type: 'ACK',
      seq: 12,
      fields: ['OK', 'WMS-PKG-1'],
    });
    expect(() => decodeBody(Buffer.from('ACK|notanumber'))).toThrow(
      WmsProtocolError,
    );
  });

  describe('FrameDecoder', () => {
    const a = encodeMessage('ACK', 1, ['OK', 'PKG-1']);
    const b = encodeMessage('NAK', 2, ['OUT_OF_STOCK', 'PROD-9']);
    const text = (frames: Buffer[]) => frames.map((f) => f.toString('utf8'));

    it('reassembles a frame split across two chunks', () => {
      const decoder = new FrameDecoder();
      expect(decoder.push(a.subarray(0, 7))).toEqual([]);
      expect(text(decoder.push(a.subarray(7)))).toEqual(['ACK|1|OK|PKG-1']);
      expect(decoder.pendingBytes).toBe(0);
    });

    it('splits two frames that arrive in one chunk', () => {
      const decoder = new FrameDecoder();
      expect(text(decoder.push(Buffer.concat([a, b])))).toEqual([
        'ACK|1|OK|PKG-1',
        'NAK|2|OUT_OF_STOCK|PROD-9',
      ]);
    });

    it('handles a length header split 2 + 2 bytes', () => {
      const decoder = new FrameDecoder();
      expect(decoder.push(a.subarray(0, 2))).toEqual([]);
      expect(decoder.push(a.subarray(2, 4))).toEqual([]);
      expect(text(decoder.push(a.subarray(4)))).toEqual(['ACK|1|OK|PKG-1']);
    });

    it('handles one byte at a time', () => {
      const decoder = new FrameDecoder();
      const stream = Buffer.concat([a, b]);
      const out: Buffer[] = [];
      for (let i = 0; i < stream.length; i++) {
        out.push(...decoder.push(stream.subarray(i, i + 1)));
      }
      expect(text(out)).toEqual([
        'ACK|1|OK|PKG-1',
        'NAK|2|OUT_OF_STOCK|PROD-9',
      ]);
    });

    it('throws on an oversize length header', () => {
      const decoder = new FrameDecoder(16);
      const header = Buffer.alloc(4);
      header.writeUInt32BE(17, 0);
      expect(() => decoder.push(header)).toThrow(WmsProtocolError);
    });
  });
});
