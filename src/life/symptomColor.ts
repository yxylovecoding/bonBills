const SYMPTOM_HUES = [8, 28, 46, 78, 130, 164, 190, 212, 238, 266, 292, 326] as const;

// Use the canonical symptom key so dates, states and list order never change its color.
export function symptomColor(key: string) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0;
  const hue = SYMPTOM_HUES[hash % SYMPTOM_HUES.length];
  return {
    color: `hsl(${hue} 38% 30%)`,
    backgroundColor: `hsl(${hue} 45% 94%)`,
    borderColor: `hsl(${hue} 38% 60%)`,
  };
}
