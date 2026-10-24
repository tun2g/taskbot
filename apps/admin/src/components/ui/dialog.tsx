import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button, type ButtonVariant } from './button';
import { Field, Textarea, TextInput } from './input';

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Focus the first field (or the panel) so keyboard users land inside the dialog.
    requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>('input, textarea, select');
      (first ?? panel.current)?.focus();
    });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full ${width} max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-surface shadow-[var(--shadow-lg)] outline-none sm:rounded-2xl`}
      >
        <div className="px-5 pt-5 pb-2">
          <h2 id={titleId} className="text-lg font-semibold text-text">
            {title}
          </h2>
        </div>
        <div className="px-5 pb-4 text-sm text-text-2">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmOptions {
  title: string;
  /** What will happen, concretely. */
  body: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  /** Ask for a reason (posted in the group). */
  reason?: { required: boolean; label: string; hint: string; placeholder?: string };
  /** Require typing this exact text (e.g. the group name) to enable the button. */
  typeToConfirm?: string;
  /** Still loading the facts the body needs (e.g. the delete preview). */
  loadingBody?: boolean;
}

/** A confirmation dialog that states the consequences and can ask for a reason or a typed name. */
export function ConfirmDialog({
  open,
  options,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  options: ConfirmOptions | null;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | undefined) => void;
}) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) {
      setReason('');
      setTyped('');
    }
  }, [open]);

  if (!options) return null;
  const reasonMissing = !!options.reason?.required && !reason.trim();
  const typedWrong = options.typeToConfirm != null && typed.trim() !== options.typeToConfirm.trim();
  const disabled = reasonMissing || typedWrong || !!options.loadingBody;

  return (
    <Dialog
      open={open}
      onClose={pending ? () => undefined : onCancel}
      title={options.title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={options.variant ?? 'primary'}
            disabled={disabled}
            loading={pending}
            onClick={() => onConfirm(reason.trim() || undefined)}
          >
            {options.confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled && !pending) onConfirm(reason.trim() || undefined);
        }}
      >
        <div className="space-y-2 leading-relaxed">{options.body}</div>
        {options.reason && (
          <Field label={options.reason.label + (options.reason.required ? '' : ' (optional)')} hint={options.reason.hint}>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={options.reason.placeholder}
            />
          </Field>
        )}
        {options.typeToConfirm != null && (
          <Field label={<>Type <strong className="font-semibold text-text">{options.typeToConfirm}</strong> to confirm</>}>
            <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
