export const readU16LE = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
export const readU32LE = (b: Uint8Array, o: number): number =>
  b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24);

export const writeU16LE = (b: Uint8Array, o: number, v: number): void => {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
};

export const writeU32LE = (b: Uint8Array, o: number, v: number): void => {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
  b[o + 2] = (v >> 16) & 0xff;
  b[o + 3] = (v >> 24) & 0xff;
};
