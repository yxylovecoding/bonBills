const SYMPTOM_HUES = [8, 28, 46, 78, 130, 164, 190, 212, 238, 266, 292, 326] as const;
const SKIN_HUES: Record<string, number> = { 'skin:acne': 8, 'skin:damaged': 28, 'skin:healthy': 130, 'skin:allergic': 266, 'skin:acneMarks': 212 };

// Use the canonical symptom key so dates, states and list order never change its color.
export function symptomColor(key: string) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0;
  const hue = SKIN_HUES[key] ?? SYMPTOM_HUES[hash % SYMPTOM_HUES.length];
  return {
    color: `hsl(${hue} 38% 30%)`,
    backgroundColor: `hsl(${hue} 45% 94%)`,
    borderColor: `hsl(${hue} 38% 60%)`,
  };
}
