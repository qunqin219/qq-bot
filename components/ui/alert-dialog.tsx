import type { ReactNode, HTMLAttributes, ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}

export function AlertDialog({ open, onOpenChange, children }: AlertDialogProps) {
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

export interface AlertDialogTriggerProps {
  children?: ReactNode;
  asChild?: boolean;
}

export function AlertDialogTrigger({ children, asChild }: AlertDialogTriggerProps) {
  if (asChild && typeof children === 'object' && children !== null) {
    return children as React.ReactElement;
  }
  return <>{children}</>;
}

export type AlertDialogContentProps = HTMLAttributes<HTMLDivElement>;

export function AlertDialogContent({ className, children, ...props }: AlertDialogContentProps) {
  return (
    <div
      className={cn('w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function AlertDialogHeader({ className, ...props }: AlertDialogContentProps) {
  return <div className={cn('mb-4', className)} {...props} />;
}

export function AlertDialogTitle({ className, ...props }: AlertDialogContentProps) {
  return <h3 className={cn('text-lg font-semibold text-card-foreground', className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: AlertDialogContentProps) {
  return <p className={cn('mt-1 text-sm text-muted-foreground', className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: AlertDialogContentProps) {
  return <div className={cn('mt-6 flex justify-end gap-2', className)} {...props} />;
}

export interface AlertDialogActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive';
}

export function AlertDialogAction({ className, variant = 'default', ...props }: AlertDialogActionProps) {
  const variants: Record<string, string> = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  };

  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export type AlertDialogCancelProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function AlertDialogCancel({ className, ...props }: AlertDialogCancelProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}
