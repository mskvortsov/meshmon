import { expect, test } from 'vitest';
import * as Crypto from 'src/crypto.js';
import * as Util from 'tests/util.js';

test('decrypt', () => {
  const packet = {
    from: 0xa1b6eabc,
    to: 0xffffffff,
    payloadVariant: {
        value: Util.bytes('a83085cc015a965dcafd482829eae6e90f407594d2e8e3a0c8'),
    },
  };
  expect(Crypto.decrypt(packet, Crypto.defaultKey))
    .toStrictEqual(Util.bytes('dcb14d4dddccee53e6d147bea54838b78b200791c2d69f54a6'));
});
