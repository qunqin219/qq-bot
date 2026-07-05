import type { ReactNode, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      {children}
    </div>
  );
}

export type DialogContentProps = HTMLAttributes<HTMLDivElement>;

export function DialogContent({ className, children, ...props }: DialogContentProps) {
  return (
    <div
      className={cn('w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function DialogHeader({ className, ...props }: DialogContentProps) {
  return <div className={cn('mb-4', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: DialogContentProps) {
  return <h3 className={cn('text-lg font-semibold text-card-foreground', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: DialogContentProps) {
  return <p className={cn('mt-1 text-sm text-muted-foreground', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: DialogContentProps) {
  return <div className={cn('mt-6 flex justify-end gap-2', className)} {...props} />;
}
