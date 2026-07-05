import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
  size?: 'default' | 'sm' | 'xs' | 'lg' | 'icon' | 'icon-sm' | 'icon-xs' | 'icon-lg';
  asChild?: boolean;
  children?: ReactNode;
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild,
  children,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:pointer-events-none disabled:opacity-50';

  const variants: Record<string, string> = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    outline: 'border border-border bg-card text-foreground hover:bg-secondary',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    ghost: 'text-foreground hover:bg-secondary',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    link: 'text-primary underline-offset-4 hover:underline',
  };

  const sizes: Record<string, string> = {
    default: 'h-9 px-4 py-2 text-sm gap-1.5',
    sm: 'h-8 px-3 text-xs gap-1',
    xs: 'h-6 px-2 text-xs gap-1',
    lg: 'h-10 px-5 text-sm gap-1.5',
    icon: 'h-9 w-9',
    'icon-sm': 'h-8 w-8',
    'icon-xs': 'h-6 w-6',
    'icon-lg': 'h-10 w-10',
  };

  if (asChild && typeof children === 'object' && children !== null) {
    const child = children as React.ReactElement<Record<string, unknown>>;
    return (
      <child.type
        {...child.props}
        className={cn(base, variants[variant], sizes[size], className)}
      />
    );
  }

  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}
