export function createPrng(seed) {
    let state = seed >>> 0;
    return () => {
        state += 0x6D2B79F5;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}
export function createSeed() {
    return (Date.now() ^ Math.floor(Math.random() * 1_000_000_000)) >>> 0;
}
