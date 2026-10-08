export interface Lang { name: string; code: string; voice: string; script: string }

export const LANGUAGES: Lang[] = [
  { name: "Hindi", code: "HI", voice: "Aarohi", script: "हिन्दी" },
  { name: "English", code: "EN", voice: "Ethan", script: "English" },
  { name: "Marathi", code: "MR", voice: "Manasi", script: "मराठी" },
  { name: "Gujarati", code: "GU", voice: "Gauri", script: "ગુજરાતી" },
  { name: "Tamil", code: "TA", voice: "Thamarai", script: "தமிழ்" },
  { name: "Telugu", code: "TE", voice: "Tejaswi", script: "తెలుగు" },
  { name: "Kannada", code: "KN", voice: "Kaveri", script: "ಕನ್ನಡ" },
  { name: "Bengali", code: "BN", voice: "Bani", script: "বাংলা" },
  { name: "Malayalam", code: "ML", voice: "Meera", script: "മലയാളം" },
  { name: "Punjabi", code: "PA", voice: "Pavneet", script: "ਪੰਜਾਬੀ" },
];

export const DEFAULT_LANGUAGES = ["Hindi", "English", "Marathi", "Tamil", "Telugu", "Bengali"];
export const FALLBACK_LANGUAGE = "English";

export const langOf = (name: string) => LANGUAGES.find((l) => l.name === name);
export const langCode = (name: string) => langOf(name)?.code ?? name.slice(0, 2).toUpperCase();
export const voiceOf = (name: string) => langOf(name)?.voice ?? "—";
export const isKnownLanguage = (name: string) => !!langOf(name);

/** Mother tongues by region, used when generating the demo book. */
export const REGION_LANGUAGES: Record<string, [string, number][]> = {
  North: [["Hindi", 58], ["Punjabi", 22], ["English", 20]],
  South: [["Tamil", 26], ["Telugu", 26], ["Kannada", 18], ["Malayalam", 14], ["English", 16]],
  East: [["Bengali", 56], ["Hindi", 24], ["English", 20]],
  West: [["Marathi", 36], ["Gujarati", 24], ["Hindi", 20], ["English", 20]],
};

/** Accepts "hindi", "HI", "Hindi " and returns the canonical name, or the trimmed input if unknown. */
export function normaliseLanguage(raw: string): string {
  const v = raw.trim();
  const hit = LANGUAGES.find((l) => l.name.toLowerCase() === v.toLowerCase() || l.code.toLowerCase() === v.toLowerCase());
  return hit ? hit.name : v;
}
