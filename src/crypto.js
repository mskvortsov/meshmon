import CryptoJS from 'crypto-js/core';
import Base64 from 'crypto-js/enc-base64';
import AES from 'crypto-js/aes';
import 'crypto-js/mode-ctr';
import 'crypto-js/pad-nopadding';
import 'crypto-js/lib-typedarrays';

export const defaultKey = Base64.parse('1PG7OiApB1nwvP+rz05pAQ==');

export function wordsToBytes(words) {
    var bytes = new Uint8Array(words.sigBytes);
    for (var i = 0; i < words.sigBytes; ++i) {
        bytes[i] = (words.words[i >>> 2] >>> (24 - ((i & 3) << 3))) & 0xff;
    }
    return bytes;
}

function swap32(val) {
    return ((val & 0xff000000) >>> 24)
         | ((val & 0x00ff0000) >>>  8)
         | ((val & 0x0000ff00) <<   8)
         | ((val & 0x000000ff) <<  24);
}

export function decrypt(packet, key) {
    const iv = CryptoJS.lib.WordArray.create([
        swap32(packet.id), 0,
        swap32(packet.from), 0,
    ]);

    const encrypted = CryptoJS.lib.WordArray.create(packet.payloadVariant.value);
    const decrypted = AES.decrypt(
        CryptoJS.lib.CipherParams.create({
            ciphertext: encrypted,
        }),
        key,
        {
            mode: CryptoJS.mode.CTR,
            iv: iv,
            padding: CryptoJS.pad.NoPadding,
        }
    );

    return wordsToBytes(decrypted);
}
