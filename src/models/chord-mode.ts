export type ChordModeQuality = 'major' | 'minor' | 'diminished' | 'augmented' | 'sus2' | 'sus4' | 'power';
export type ChordModeExtension = 'none' | '6' | '7' | 'maj7' | '9' | 'maj9' | 'add9';

export interface ChordModeEntry {
  degree: number;
  alteration: number;
  quality: ChordModeQuality;
  extension: ChordModeExtension;
  display?: string;
  spelling?: 'auto' | 'flat' | 'sharp';
}

export type ChordModeMap = Record<string, ChordModeEntry[]>;

export interface ResolvedChordModeEntry extends ChordModeEntry {
  display: string;
  chordSuffix: string;
}

const MAJOR_SCALE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const EXTENSION_SUFFIX: Record<ChordModeExtension, string> = {
  none: '', '6': '6', '7': '7', maj7: 'maj7', '9': '9', maj9: 'maj9', add9: 'add9',
};

export function resolveChordModeEntry(value: unknown): ResolvedChordModeEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  let degree: number;
  let alteration: number;
  let quality: ChordModeQuality;
  let extension: ChordModeExtension;
  let display: string | undefined;
  let spelling: ChordModeEntry['spelling'] = 'auto';

  if (typeof entry.degree === 'number') {
    if (!Number.isInteger(entry.degree) || entry.degree < 1 || entry.degree > 7) return null;
    degree = entry.degree;
    alteration = typeof entry.alteration === 'number' ? entry.alteration : 0;
    if (!Number.isInteger(alteration) || alteration < -2 || alteration > 2) return null;
    if (!['major', 'minor', 'diminished', 'augmented', 'sus2', 'sus4', 'power'].includes(String(entry.quality))) return null;
    quality = entry.quality as ChordModeQuality;
    if (!['none', '6', '7', 'maj7', '9', 'maj9', 'add9'].includes(String(entry.extension ?? 'none'))) return null;
    extension = (entry.extension ?? 'none') as ChordModeExtension;
    display = typeof entry.display === 'string' ? entry.display : undefined;
    if (entry.spelling !== undefined && !['auto', 'flat', 'sharp'].includes(String(entry.spelling))) return null;
    spelling = entry.spelling as ChordModeEntry['spelling'] ?? 'auto';
  } else {
    return null;
  }

  const chordSuffix = getChordSuffix(quality, extension);
  if (chordSuffix === null) return null;
  const accidental = alteration < 0 ? 'b'.repeat(-alteration) : '#'.repeat(alteration);
  return {
    degree,
    alteration,
    quality,
    extension,
    display: display ?? `${accidental}${degree}`,
    spelling,
    chordSuffix,
  };
}

export function chordModeSemitones(entry: ResolvedChordModeEntry): number {
  const semitones = MAJOR_SCALE_SEMITONES[entry.degree - 1] + entry.alteration;
  return ((semitones % 12) + 12) % 12;
}

export function chordModePrefersFlat(entry: ResolvedChordModeEntry, root: string): boolean {
  return entry.spelling === 'flat'
    || (entry.spelling === 'auto' && (entry.alteration < 0 || (entry.alteration === 0 && root.includes('b'))));
}

function getChordSuffix(quality: ChordModeQuality, extension: ChordModeExtension): string | null {
  if (quality === 'major') return EXTENSION_SUFFIX[extension];
  if (quality === 'minor') {
    if (extension === 'maj7' || extension === 'maj9' || extension === 'add9') return null;
    return `m${EXTENSION_SUFFIX[extension]}`;
  }
  if (quality === 'diminished') return extension === 'none' ? 'dim' : extension === '7' ? 'dim7' : null;
  if (quality === 'augmented') return extension === 'none' ? 'aug' : extension === '7' ? 'aug7' : null;
  if (extension !== 'none') return null;
  return quality === 'power' ? '5' : quality;
}
