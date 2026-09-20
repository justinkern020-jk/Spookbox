/** ITC lexicon — short spoken hits investigators listen for in sweep noise. */
export const LEXICON = [
  "yes","no","maybe","never","always","hello","goodbye","wait","stop","go",
  "stay","leave","come","back","here","there","near","far","behind","ahead",
  "under","over","inside","outside","left","right","down","up","now","later",
  "soon","tonight","help","look","listen","see","hear","feel","hide","run",
  "don't","can't","won't","mother","father","child","baby","son","daughter",
  "man","woman","friend","dead","alive","lost","found","alone","home","door",
  "window","stairs","attic","basement","room","mirror","photo","cold","dark",
  "light","quiet","pain","peace","love","hate","fear","shadow","voice","spirit",
  "portal","trap","free","watch","name","hurt","before","after","danger","hurry",
  "behind you","help me","find me","I'm here","I'm cold","I'm lost","get out",
  "go away","come here","don't look","look down","still here","too late","not yet",
  "the door","the stairs","the attic","the well","my name","right now","over there",
  "leave now","stay quiet","it's me","I died","can't leave","can't rest","forgive",
  "knock","three","thirteen","hello hello","is anyone there","speak now","prove it",
] as const;

export type Word = (typeof LEXICON)[number] | string;

export function pickWord(seed: number): string {
  const i = Math.abs(Math.floor(seed * 9973)) % LEXICON.length;
  return LEXICON[i]!;
}

export function hashBins(bins: Uint8Array, freq: number): number {
  let h = (freq * 1000) | 0;
  const step = Math.max(1, Math.floor(bins.length / 24));
  for (let i = 0; i < bins.length; i += step) {
    h = (h * 33 + bins[i]!) | 0;
  }
  return h >>> 0;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const YESNO = [
  "yes", "no", "maybe", "never", "not yet", "sometimes", "I cannot", "goodbye",
  "yes yes", "no no", "not that", "ask again", "not now", "soon", "always",
  "cannot say", "don't know", "prove it", "listen", "wait",
];
const WHO = [
  "mother", "father", "child", "me", "him", "her", "the woman", "the man",
  "a child", "a soldier", "the owner", "nobody", "someone", "it's me",
  "mary", "john", "elizabeth", "robert", "the priest", "the nurse",
];
const WHERE = [
  "here", "behind you", "attic", "basement", "the door", "the stairs",
  "outside", "under floor", "in the wall", "this house", "the well",
  "near you", "over there", "downstairs", "the woods", "my grave",
];
const WHEN = [
  "now", "tonight", "never", "soon", "that night", "midnight", "always",
  "nineteen forty", "last winter", "not yet", "three am", "too late",
];
const WHAT = [
  "help", "listen", "look", "the key", "the photo", "a secret", "the fire",
  "danger", "peace", "the baby", "the name", "wait", "the truth",
];
const WHY = [
  "pain", "unfinished", "sorry", "trapped", "love", "anger", "forgotten",
  "can't leave", "can't rest", "I died", "the fire", "they know",
];
const HOW = [
  "listen", "follow", "stay", "leave now", "light a candle", "say my name",
  "look down", "don't look", "ask again", "record", "pray",
];
const OPEN = [
  "help me", "I'm here", "behind you", "leave now", "listen", "it's me",
  "not yet", "goodbye", "stay", "look left", "I'm cold", "find me",
  "the door", "yes", "no", "wait", "still here", "don't go",
];

function bankFor(q: string): readonly string[] {
  const s = q.toLowerCase();
  if (/\bwho\b/.test(s)) return WHO;
  if (/\bwhere\b/.test(s)) return WHERE;
  if (/\bwhen\b/.test(s)) return WHEN;
  if (/\bwhy\b/.test(s)) return WHY;
  if (/\bhow\b/.test(s)) return HOW;
  if (/\bwhat\b/.test(s)) return WHAT;
  if (
    /^(are|is|am|was|were|do|does|did|can|will|would|should|have|has|could)\b/.test(s) ||
    /\b(anyone|there|alive|dead|with us|listening)\b/.test(s)
  ) {
    return YESNO;
  }
  return OPEN;
}

/** Spook Board short answer for a spoken/typed question. */
export function pickAnswer(question: string, salt: number): string {
  const bank = bankFor(question);
  const i = Math.abs((hashString(question.toLowerCase().trim()) ^ (salt | 0)) >>> 0) % bank.length;
  return bank[i] ?? "yes";
}
