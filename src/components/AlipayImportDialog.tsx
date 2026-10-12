import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function AlipayImportDialog({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: ReactNode; footer: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled), summary, a[href]') ?? [])
        .filter((control) => control.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div className="alipay-import-backdrop alipay-import-workflow" onClick={(event) => event.stopPropagation()}>
    <section ref={dialog} tabIndex={-1} className="alipay-import-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header className="alipay-detail-line"><b>{title}</b><button type="button" className="alipay-text-button" onClick={onClose}>关闭</button></header>
      <div className="alipay-import-body">{children}</div>
      <footer className="alipay-import-footer">{footer}</footer>
    </section>
  </div>, document.body);
}
