/** The reference film's WHOOOOOA!! letters at rest, read from its frames, one per letter in turn. */
export const RAINBOW_FROM = [
  "#e8dd31", "#29d9df", "#eb1b32", "#e1862c", "#27d829",
  "#e11fef", "#4bbcf2", "#c8c295", "#91a3a0", "#ee6f7d",
] as const;

/** The colors each letter crossfades to and back from, read from the same frames. */
export const RAINBOW_TO = [
  "#ee6f7d", "#d659c7", "#9265df", "#64bcd5", "#d52fd6",
  "#7492f0", "#dcdd3a", "#59b7ea", "#deca7e", "#9da9a4",
] as const;

export function rainbowPair(index: number): {from: string; to: string} {
  const at = ((index % RAINBOW_FROM.length) + RAINBOW_FROM.length) % RAINBOW_FROM.length;
  return {from: RAINBOW_FROM[at], to: RAINBOW_TO[at]};
}
