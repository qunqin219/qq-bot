import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'destructive';
}

export function Alert({ className, variant = 'default', ...props }: AlertProps) {
  const variants: Record<string, string> = {
    default: 'border-border bg-muted text-foreground',
    destructive: 'border-destructive/20 bg-destructive/10 text-destructive',
  };

  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border p-3 text-sm',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export type AlertDescriptionProps = HTMLAttributes<HTMLDivElement>;

export function AlertDescription({ className, ...props }: AlertDescriptionProps) {
  return <div className={cn('text-sm', className)} {...props} />;
}

export function AlertAction({ children }: { children?: ReactNode }) {
  return <div className="shrink-0">{children}</div>;
}
