import { useEffect, useId, useRef, type ReactNode } from 'react';

export default function WishDialog({ title, onClose, children, footer }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const containers = [document.getElementById('root'), document.querySelector<HTMLElement>('.wish-list-scroll')]
      .filter((element): element is HTMLElement => element !== null);
    const previousOverflow = containers.map((element) => element.style.overflowY);
    containers.forEach((element) => { element.style.overflowY = 'hidden'; });
    return () => {
      dialog?.close();
      containers.forEach((element, index) => { element.style.overflowY = previousOverflow[index]; });
    };
  }, []);

  return (
    <dialog ref={dialogRef} className="wish-dialog" aria-labelledby={titleId} onCancel={onClose}>
      <header className="wish-dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="wish-icon-button" aria-label={`关闭${title}`} onClick={onClose}>×</button>
      </header>
      <div className="wish-dialog-body">{children}</div>
      <footer className="wish-dialog-actions">{footer}</footer>
    </dialog>
  );
}
