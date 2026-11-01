import { useRef } from 'react';
import { investMeta } from '../data/mockData';
import type { InvestKey, InvestPositionGroupKey, InvestPositionStatus } from '../models/types';
import { INVEST_POSITION_KEYS } from '../utils/investPositionItems';

type Props = {
  name: string;
  status: InvestPositionStatus;
  currentGroup: InvestPositionGroupKey;
  onToggleStatus: (status: 'active' | 'paused') => void;
  onMoveCategory: (groupKey: InvestKey) => void;
};

const menuStyle = {
  border: '1px solid #dadce0', borderRadius: 8, background: '#fff', boxShadow: '0 4px 14px rgba(60,64,67,.2)',
  minWidth: 150, padding: 4,
} as const;
const optionStyle = {
  display: 'block', width: '100%', border: 'none', borderRadius: 6, background: '#fff', color: '#3c4043',
  padding: '7px 9px', textAlign: 'left', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

export default function InvestPositionMoveMenu({ name, status, currentGroup, onToggleStatus, onMoveCategory }: Props) {
  const rootRef = useRef<HTMLDetailsElement>(null);
  const categoriesRef = useRef<HTMLDetailsElement>(null);
  const currentStatus = status === 'active' ? 'active' : 'paused';
  const targetStatus = currentStatus === 'active' ? 'paused' : 'active';
  const close = () => {
    if (categoriesRef.current) categoriesRef.current.open = false;
    if (rootRef.current) rootRef.current.open = false;
  };

  return <details ref={rootRef} style={{ position: 'relative' }}>
    <summary aria-label={`${name}移动`} title="移动" style={{ width: 34, height: 26, boxSizing: 'border-box', border: '1px solid #dadce0', borderRadius: 6, padding: '3px 2px', listStyle: 'none', textAlign: 'center', fontSize: 13, color: '#5f6368', backgroundColor: '#fff', cursor: 'pointer' }}>→</summary>
    <div role="menu" style={{ ...menuStyle, position: 'absolute', zIndex: 20, right: 0, top: 30 }}>
      <button type="button" role="menuitem" style={optionStyle} onClick={() => { onToggleStatus(targetStatus); close(); }}>
        移到 {targetStatus === 'active' ? 'now' : 'past'}
      </button>
      <details ref={categoriesRef}>
        <summary role="menuitem" style={{ ...optionStyle, boxSizing: 'border-box' }}>移动到其他分类</summary>
        <div style={{ borderTop: '1px solid #f1f3f4', marginTop: 3, paddingTop: 3 }}>
          {INVEST_POSITION_KEYS.filter((key) => key !== currentGroup).map((key) => (
            <button key={key} type="button" role="menuitem" style={optionStyle} onClick={() => { onMoveCategory(key); close(); }}>
              {investMeta[key].label}
            </button>
          ))}
        </div>
      </details>
    </div>
  </details>;
}
