import { useRef } from 'react';
import { ruleTitle, type SchedulingRuleConfig, type SchedulingRuleGroup, type SchedulingRuleId } from '../utils/schedulingRules';

export function RuleMoveMenu({ groups, currentGroup, name, disabled, onMove }: {
  groups: SchedulingRuleGroup[]; currentGroup: string; name: string;
  disabled: boolean; onMove: (groupId: string) => boolean;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const choices = groups.filter(group => group.id !== currentGroup);
  const unavailable = disabled || !choices.length;
  return <details ref={root} className="schedule-move" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
  }} onKeyDown={event => {
    if (event.key !== 'Escape' || !root.current?.open) return;
    event.preventDefault(); event.stopPropagation(); root.current.open = false;
    root.current.querySelector('summary')?.focus();
  }}>
    <summary aria-label={`移动规则${name}`} title="移到分组" aria-disabled={unavailable}
      onClick={event => { if (unavailable) event.preventDefault(); }}>→</summary>
    <div className="schedule-move-options" role="group" aria-label={`${name}移到分组`}>
      {choices.map(group => <button key={group.id} type="button" disabled={disabled} onClick={() => {
        if (onMove(group.id) && root.current) root.current.open = false;
      }}>移到 {group.name}</button>)}
    </div>
  </details>;
}

export function RuleTags({ tags, name, disabled = false, onRemove }: {
  tags?: string[]; name?: string; disabled?: boolean; onRemove?: (tag: string) => void;
}) {
  if (!tags?.length) return null;
  return <span className="schedule-tags" aria-label={name ? `${name}的标签` : '规则标签'}>{tags.map(tag => <span key={tag} className="schedule-tag">
    <span>{tag}</span>{onRemove && <button type="button" disabled={disabled} title={`移除标签${tag}`} aria-label={`移除${name}的标签${tag}`}
      onClick={() => onRemove(tag)}>×</button>}
  </span>)}</span>;
}

export function RulePredecessors({ id, draft, disabled, onToggle }: {
  id: SchedulingRuleId; draft: SchedulingRuleConfig; disabled: boolean; onToggle: (parent: SchedulingRuleId, checked: boolean) => void;
}) {
  return <fieldset className="schedule-predecessor-picker" disabled={disabled}><legend>必须先完成</legend>
    {draft.groups!.map(group => {
      const candidates = group.rules.filter(parent => parent !== id && !draft.removed?.includes(parent));
      if (!candidates.length) return null;
      return <fieldset key={group.id} className="schedule-predecessor-group"><legend>{group.name}</legend>
        {candidates.map(parent => <label key={parent}>
          <input type="checkbox" aria-label={ruleTitle(parent, draft)} checked={(draft.predecessors[id] ?? []).includes(parent)}
            onChange={event => onToggle(parent, event.target.checked)} />
          <span>{ruleTitle(parent, draft)}<RuleTags tags={draft.tags?.[parent]} /></span>
        </label>)}
      </fieldset>;
    })}
  </fieldset>;
}
