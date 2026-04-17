import { useRef, useState } from 'react';

function reorder<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Pointer-based drag-to-reorder hook (works on mouse + touch).
 *
 * Usage:
 *   const { draggingIdx, itemRef, handleProps } = useDragSort(items, setItems, 'vertical');
 *
 *   items.map((item, i) => (
 *     <div ref={el => itemRef(el, i)} key={...}>
 *       <span {...handleProps(i)}>≡</span>   ← drag handle
 *       {content}
 *     </div>
 *   ))
 */
export function useDragSort<T>(
  items: T[],
  onReorder: (next: T[]) => void,
  direction: 'vertical' | 'horizontal' = 'vertical',
) {
  const fromRef = useRef<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const elsRef = useRef<(HTMLElement | null)[]>([]);

  const itemRef = (el: HTMLElement | null, idx: number) => {
    elsRef.current[idx] = el;
  };

  const findTarget = (clientX: number, clientY: number): number | null => {
    for (let i = 0; i < elsRef.current.length; i++) {
      const el = elsRef.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const hit = direction === 'vertical'
        ? clientY >= r.top && clientY <= r.bottom
        : clientX >= r.left && clientX <= r.right;
      if (hit) return i;
    }
    return null;
  };

  const handleProps = (idx: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      fromRef.current = idx;
      setDraggingIdx(idx);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (fromRef.current === null) return;
      const to = findTarget(e.clientX, e.clientY);
      if (to !== null && to !== fromRef.current) {
        onReorder(reorder(items, fromRef.current, to));
        fromRef.current = to;
        setDraggingIdx(to);
      }
    },
    onPointerUp: () => {
      fromRef.current = null;
      setDraggingIdx(null);
    },
    style: { cursor: 'grab', touchAction: 'none' } as React.CSSProperties,
  });

  return { draggingIdx, itemRef, handleProps };
}
