import { useSyncExternalStore } from 'react';

/** A tiny global toast store, usable from mutation callbacks without prop drilling. */
export type ToastTone = 'success' | 'error' | 'warning' | 'info';
export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  /** An in-app link shown in the toast, e.g. the audit entry of what was just saved. */
  link?: ToastLink;
}

export interface ToastLink {
  label: string;
  /** In-app path with query, e.g. "/audit-log?targetType=user&targetId=…". */
  href: string;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(tone: ToastTone, title: string, body?: string, link?: ToastLink) {
  const id = nextId++;
  items = [...items.slice(-3), { id, tone, title, body, link }];
  emit();
  const ttl = tone === 'error' || tone === 'warning' || link ? 8000 : 4000;
  setTimeout(() => dismissToast(id), ttl);
}

export const toast = {
  success: (title: string, body?: string, link?: ToastLink) => push('success', title, body, link),
  error: (title: string, body?: string) => push('error', title, body),
  warning: (title: string, body?: string) => push('warning', title, body),
  info: (title: string, body?: string) => push('info', title, body),
};

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
    () => items,
  );
}
