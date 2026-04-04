/**
 * Test data and helpers for unit tests
 */

/**
 * Chord progression presets for testing
 * These are sample progressions used in tests to validate chord progression functionality
 */
export const TEST_CHORD_PROGRESSIONS: Record<string, string[]> = {
  // Major key progressions
  'c-major-basic': ['C', 'F', 'G', 'Am'],
  'c-major-pop': ['C', 'G', 'Am', 'F'], // I-V-vi-IV
  'c-major-jazz': ['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7'],
  'c-major-50s': ['C', 'Am', 'F', 'G'], // I-vi-IV-V
  'g-major-basic': ['G', 'C', 'D', 'Em'],
  'g-major-pop': ['G', 'D', 'Em', 'C'], // I-V-vi-IV in G
  'g-major-jazz': ['Gmaj7', 'Am7', 'Bm7', 'Cmaj7', 'D7', 'Em7', 'F#m7'],
  'd-major-basic': ['D', 'G', 'A', 'Bm'],
  'd-major-pop': ['D', 'A', 'Bm', 'G'], // I-V-vi-IV in D
  'd-major-jazz': ['Dmaj7', 'Em7', 'F#m7', 'Gmaj7', 'A7', 'Bm7', 'C#m7'],
  'a-major-basic': ['A', 'D', 'E', 'F#m'],
  'a-major-pop': ['A', 'E', 'F#m', 'D'], // I-V-vi-IV in A
  'e-major-basic': ['E', 'A', 'B', 'C#m'],
  'e-major-pop': ['E', 'B', 'C#m', 'A'], // I-V-vi-IV in E
  'f-major-basic': ['F', 'Bb', 'C', 'Dm'],
  'f-major-pop': ['F', 'C', 'Dm', 'Bb'], // I-V-vi-IV in F

  // Minor key progressions
  'a-minor-basic': ['Am', 'Dm', 'E', 'Am'],
  'a-minor-pop': ['Am', 'F', 'C', 'G'], // i-VI-III-VII
  'a-minor-jazz': ['Am7', 'Dm7', 'E7', 'Am7'],
  'e-minor-basic': ['Em', 'Am', 'B', 'Em'],
  'e-minor-pop': ['Em', 'C', 'G', 'D'], // i-VI-III-VII in Em
  'd-minor-basic': ['Dm', 'Gm', 'A', 'Dm'],
  'd-minor-pop': ['Dm', 'Bb', 'F', 'C'], // i-VI-III-VII in Dm

  // Blues progressions
  'blues-e': ['E7', 'A7', 'B7'],
  'blues-a': ['A7', 'D7', 'E7'],
  'blues-g': ['G7', 'C7', 'D7'],

  // Rock progressions
  'rock-classic': ['E', 'A', 'D', 'B'],
  'rock-power': ['E5', 'G5', 'A5', 'C5', 'D5'],

  // Jazz progressions
  'jazz-251-c': ['Dm7', 'G7', 'Cmaj7', 'Em7', 'A7'],
  'jazz-251-f': ['Gm7', 'C7', 'Fmaj7', 'Am7', 'D7'],

  // Gospel progressions
  'gospel-c': ['C', 'Am7', 'Dm7', 'G7', 'F'],
  'gospel-g': ['G', 'Em7', 'Am7', 'D7', 'C'],
};
