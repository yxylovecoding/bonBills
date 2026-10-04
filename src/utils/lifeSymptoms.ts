export const EYE_FIELDS = { leftEye: '左眼', rightEye: '右眼' } as const;
export const DISCOMFORT_FIELDS = { leftSacroiliac: '左骶髂', rightSacroiliac: '右骶髂', lowerBack: '腰' } as const;
export const SYMPTOM_TEXT_LIMIT = 500;
export type EyeRecord = Partial<Record<keyof typeof EYE_FIELDS, string>>;
export type DiscomfortRecord = Partial<Record<keyof typeof DISCOMFORT_FIELDS, string>>;

export function parseSymptomRecord<T extends string>(value: unknown, fields: Record<T, string>): Partial<Record<T, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('身体状态无效');
  const result: Partial<Record<T, string>> = {};
  for (const [key, text] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key) || typeof text !== 'string' || text.length > SYMPTOM_TEXT_LIMIT) {
      throw new Error('身体状态内容过长或无效');
    }
    result[key as T] = text;
  }
  return result;
}
