import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { cn } from '@/lib/utils';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children?: ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn('inline-flex', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps {
  children?: ReactNode;
  className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  return (
    <div className={cn('inline-flex rounded-md border border-border bg-card p-1', className)}>
      {children}
    </div>
  );
}

export interface TabsTriggerProps {
  value: string;
  children?: ReactNode;
  className?: string;
}

export function TabsTrigger({ value, children, className }: TabsTriggerProps) {
  const ctx = useContext(TabsContext);
  const active = ctx?.value === value;

  return (
    <button
      type="button"
      onClick={() => ctx?.onValueChange(value)}
      className={cn(
        'rounded px-3 py-1.5 text-sm font-medium transition-colors hover:text-foreground',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
        className
      )}
    >
      {children}
    </button>
  );
}
