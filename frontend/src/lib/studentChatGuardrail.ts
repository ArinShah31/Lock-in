export const STUDENT_AI_REFUSAL =
  "ASTRA AI is only for schoolwork. I can’t help with that. Please ask a question about your classroom documents or syllabus.";

const BANNED_WORDS = [
  "fuck",
  "fck",
  "fuk",
  "fvck",
  "fucking",
  "shit",
  "asshole",
  "bitch",
  "bastard",
  "dick",
  "cock",
  "pussy",
  "cunt",
  "slut",
  "whore",
  "porn",
  "nudes",
  "jailbreak",
];

const BANNED_PHRASES = [
  "ignore previous instructions",
  "do anything now",
  "kill myself",
  "how to make a bomb",
  "get high",
];

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[01345@$]/g, (ch) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "@": "a", $: "s" }[ch] ?? ch))
    .replace(/(?<=[a-z])[*\-_.]+(?=[a-z])/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isBlockedStudentQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (!normalized) return false;
  const tokens = new Set(normalized.match(/[a-z0-9]+/g) ?? []);
  if (BANNED_WORDS.some((word) => tokens.has(word))) return true;
  return BANNED_PHRASES.some((phrase) => new RegExp(`\\b${phrase}\\b`).test(normalized));
}
