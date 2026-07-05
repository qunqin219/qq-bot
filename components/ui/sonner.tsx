import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error';
}

let addToast: (toast: Toast) => void = () => {};

export const toast = {
  success: (message: string) => addToast({ id: Math.random().toString(36).slice(2), message, type: 'success' }),
  error: (message: string) => addToast({ id: Math.random().toString(36).slice(2), message, type: 'error' }),
};

export function Toaster({ position = 'bottom-right' }: { position?: 'bottom-right' | 'top-right' | 'bottom-left' | 'top-left' }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    addToast = (t) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 3000);
    };
  }, []);

  const positionClasses: Record<string, string> = {
    'bottom-right': 'bottom-4 right-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-left': 'top-4 left-4',
  };

  return (
    <div className={cn('fixed z-50 flex flex-col gap-2', positionClasses[position])}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'rounded-md px-4 py-2 text-sm font-medium shadow-lg',
            t.type === 'success' ? 'bg-foreground text-background' : 'bg-destructive text-destructive-foreground'
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

export type ToasterProps = { position?: 'bottom-right' | 'top-right' | 'bottom-left' | 'top-left' };

export function useToast() {
  return {
    success: toast.success,
    error: toast.error,
    ToastEl: null as ReactNode,
  };
}
