import { useLayoutEffect, useRef } from 'react';

export function usePageScrollRestoration(pageKey: string) {
  const positions = useRef(new Map<string, { top: number; left: number }>());

  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useLayoutEffect(() => {
    const container = document.getElementById('root');
    if (!container) return;

    const position = positions.current.get(pageKey) ?? { top: 0, left: 0 };
    container.scrollTo({ ...position, behavior: 'instant' });

    // 在滚动时记录，避免切换到较短页面后原位置被容器高度截断。
    const savePosition = () => {
      positions.current.set(pageKey, { top: container.scrollTop, left: container.scrollLeft });
    };
    container.addEventListener('scroll', savePosition, { passive: true });
    return () => { container.removeEventListener('scroll', savePosition); };
  }, [pageKey]);
}
