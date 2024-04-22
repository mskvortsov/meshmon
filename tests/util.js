export function bytes(s) {
    if (s === '') {
        return new Uint8Array([]);
    }
    return new Uint8Array(s.match(/(.{2})/g).map((h) => parseInt(h, 16)));
}
