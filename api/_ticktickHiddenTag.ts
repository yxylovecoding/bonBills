export const TICKTICK_HIDDEN_TAG = 'hidden';
const legacyHiddenTag = 'bon-hidden';

/** The old label remains readable while matched visibility rules migrate it. */
export const isHiddenTag = (tag: string) => [TICKTICK_HIDDEN_TAG, legacyHiddenTag]
  .includes(tag.normalize('NFKC').trim().toLowerCase());
export const hasHiddenTag = (task: { tags?: string[] }) => (task.tags ?? []).some(isHiddenTag);

export function withHiddenTag(tags: string[] | undefined, hidden: boolean): string[] {
  const current = tags ?? [];
  if (hidden && current.includes(TICKTICK_HIDDEN_TAG) && current.filter(isHiddenTag).length === 1) return [...current];
  return [...current.filter(tag => !isHiddenTag(tag)), ...(hidden ? [TICKTICK_HIDDEN_TAG] : [])];
}
