import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants: Record<string, string> = {
    default: 'bg-primary/10 text-primary',
    secondary: 'bg-secondary text-secondary-foreground',
    destructive: 'bg-destructive/10 text-destructive',
    outline: 'border border-border text-foreground',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
