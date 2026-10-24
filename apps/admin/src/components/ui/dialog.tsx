import { zodResolver } from '@hookform/resolvers/zod';
import { type ReactNode, useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { Form, FormTextareaField, FormTextField } from '@/components/form/form';

import { Button, type ButtonVariant } from './button';

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
          <h2 id={titleId} className="text-lg font-black text-text">
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
  cancelLabel?: string;
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
  const schema = useMemo(() => confirmSchema(options), [options]);
  const form = useForm<ConfirmValues>({ resolver: zodResolver(schema), mode: 'onChange', defaultValues: { reason: '', typed: '' } });
  // Validity from the live values: formState.isValid isn't recomputed after reset(), which left confirm disabled.
  const values = useWatch({ control: form.control });
  const { reset } = form;
  useEffect(() => {
    if (open) reset({ reason: '', typed: '' });
  }, [open, reset]);

  if (!options) return null;
  const disabled = !schema.safeParse(values).success || !!options.loadingBody;
  const submit = form.handleSubmit(({ reason }) => {
    if (!pending) onConfirm(reason.trim() || undefined);
  });

  return (
    <Dialog
      open={open}
      onClose={pending ? () => undefined : onCancel}
      title={options.title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            {options.cancelLabel ?? 'Cancel'}
          </Button>
          <Button variant={options.variant ?? 'primary'} disabled={disabled} loading={pending} onClick={() => void submit()}>
            {options.confirmLabel}
          </Button>
        </>
      }
    >
      <Form form={form} onSubmit={() => void submit()} className="space-y-4">
        <div className="space-y-2 leading-relaxed">{options.body}</div>
        {options.reason && (
          <FormTextareaField
            name="reason"
            label={options.reason.label + (options.reason.required ? '' : ' (optional)')}
            hint={options.reason.hint}
            rows={3}
            maxLength={500}
            placeholder={options.reason.placeholder}
          />
        )}
        {options.typeToConfirm != null && (
          <FormTextField
            name="typed"
            label={
              <>
                Type <strong className="font-semibold text-text">{options.typeToConfirm}</strong> to confirm
              </>
            }
            autoComplete="off"
            spellCheck={false}
          />
        )}
        <button type="submit" hidden />
      </Form>
    </Dialog>
  );
}

interface ConfirmValues {
  reason: string;
  typed: string;
}

/** Reason required → non-blank; typeToConfirm → must match. Messages stay quiet: the button is just disabled. */
function confirmSchema(options: ConfirmOptions | null) {
  return z.object({
    reason: options?.reason?.required ? z.string().refine((v) => v.trim() !== '') : z.string(),
    typed:
      options?.typeToConfirm != null
        ? z.string().refine((v) => v.trim() === options.typeToConfirm!.trim())
        : z.string(),
  });
}
