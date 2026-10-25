import { useEffect, useRef } from 'react';

/** A simple dialog: closes on Escape or a click outside, and returns focus to where it came from. */
export function Modal({ title, onClose, children }) {
  const panel = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    panel.current?.querySelector('input, select, textarea, button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
    // run once when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="relative max-h-full w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}
