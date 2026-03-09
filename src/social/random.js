export function createRandomFn(seedRaw) {
  if (seedRaw === undefined || seedRaw === null || seedRaw === "") {
    return Math.random;
  }

  let seed = Number(seedRaw);
  if (!Number.isFinite(seed)) {
    seed = String(seedRaw)
      .split("")
      .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 2166136261);
  }
  let state = (Math.floor(seed) >>> 0) || 1;

  return function random() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
