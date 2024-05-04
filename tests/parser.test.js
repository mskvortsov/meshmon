import { expect, test } from 'vitest';
import * as Parser from 'src/parser.js';
import * as Util from 'tests/util.js';

test('parse-succ', () => {
  const message = {
    payloadBytes: Util.bytes(
      '0a410d08595bf615ffffffff18082a15506d8c0b8eebce2af433a9be7e' +
      '7054d94d0b29113035eb61e4733ddf462666450000803e480660a4ffff' +
      'ffffffffffff01780712084c6f6e67466173741a09216131623665616263'
    ),
  };
  const res = Parser.parse(message);

  expect(res.se.status).toBe(Parser.Result.Ok);
  expect(res.header.status).toBe(Parser.Result.Ok);
  expect(res.header.value).toStrictEqual({
    'ch':   'LongFast',
    'from': '!f65b5908',
    'gw':   '!a1b6eabc',
    'hl':   6,
    'hs':   7,
    'id':   '73e461eb',
    'port': 67,
    'pri':  0,
    'rssi': -92,
    'snr':  0.25,
    'time': '2024-04-22T11:15:43.000Z',
    'to':   '!ffffffff',
    'vm':   '0',
    'wa':   '0',
  });
  expect(res.parsed.status).toBe(Parser.Result.Ok);
  expect(res.parsed.value.text).toBe(`meshtastic.Data:
  portnum: TELEMETRY_APP

meshtastic.Telemetry:
  time: 2024-04-22T11:15:57.000Z
  deviceMetrics:
    channelUtilization: \"0.92\"
    airUtilTx: \"1.03\"`);
  expect(res.isUser).toBe(false);
});

test('parse-succ-text', () => {
  const message = {
    payloadBytes: Util.bytes(
      '0a260dbceab6a115e8f1470418082a086193ba83c83538e635dfd51cf1' +
      '3d3bdd356648045001780412084c6f6e67466173741a09216131623665' +
      '616263'
    ),
  };
  const res = Parser.parse(message);

  expect(res.se.status).toBe(Parser.Result.Ok);
  expect(res.header.status).toBe(Parser.Result.Ok);
  expect(res.parsed.status).toBe(Parser.Result.Ok);
  expect(res.parsed.value.text).toBe(`meshtastic.Data:
  portnum: TEXT_MESSAGE_APP

Text:
  message: Test`);
  expect(res.isUser).toBe(false);
});

test('parse-fail-se-empty', () => {
  const message = {
    payloadBytes: new Uint8Array(),
  };
  const res = Parser.parse(message);
  expect(res.se.status).toBe(Parser.Result.Err);
  expect(res.header).toBeUndefined();
  expect(res.parsed).toBeUndefined();
  expect(res.isUser).toBeUndefined();
});

test('parse-fail-se', () => {
  const message = {
    payloadBytes: Util.bytes('00'),
  };
  const res = Parser.parse(message);
  expect(res.se.status).toBe(Parser.Result.Err);
  expect(res.header).toBeUndefined();
  expect(res.parsed).toBeUndefined();
  expect(res.isUser).toBeUndefined();
});

test('parse-encrypted', () => {
  const message = {
    payloadBytes: Util.bytes(
      '0a220de8f1470415ffffffff188e012a0599413ccda935750768a33dae' +
      '772666480478041208596173656e65766f1a09213034343766316538'
    ),
  };
  const res = Parser.parse(message);

  expect(res.se.status).toBe(Parser.Result.Ok);
  expect(res.header.status).toBe(Parser.Result.Ok);
  expect(res.header.value).toStrictEqual({
    "ch": "Yasenevo",
    "from": "!0447f1e8",
    "gw": "!0447f1e8",
    "hl": 4,
    "hs": 4,
    "id": "a3680775",
    "port": "?",
    'pri':  0,
    "rssi": 0,
    "snr": 0,
    "time": "2024-04-22T14:43:58.000Z",
    'to':   '!ffffffff',
    'vm':   '0',
    'wa':   '0',
  });
  expect(res.parsed.status).toBe(Parser.Result.Err);
  expect(res.isUser).toBeUndefined();
});
