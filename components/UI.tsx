import type { ReactNode, ComponentType, SVGProps } from 'react'
import { Alert, AlertAction } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card as BaseCard } from '@/components/ui/card'
import { useToast } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import { AlertCircleIcon } from './Icons'

export { useToast }

export function Loading({ text = '加载中...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-muted-foreground">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
      <span className="font-mono text-xs tracking-wide">{text}</span>
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <Alert variant="destructive" className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <AlertCircleIcon className="h-4 w-4 shrink-0" />
        <span>{message || '发生错误'}</span>
      </div>
      {onRetry && (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        </AlertAction>
      )}
    </Alert>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <BaseCard className={cn('rounded-md border border-border bg-card shadow-none', className)}>
      {children}
    </BaseCard>
  )
}

export function PageHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <div className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
          运维
        </div>
        <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

export function PanelHeader({ title, description, meta, action, className = '' }: { title: ReactNode; description?: ReactNode; meta?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
          {meta && (
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-medium text-secondary-foreground">
              {meta}
            </span>
          )}
        </div>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action, className = '' }: {
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-[140px] flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {Icon && (
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-border bg-secondary text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className={cn('text-sm font-medium text-foreground', Icon && 'mt-3')}>
        {title}
      </div>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('space-y-4', className)}>{children}</section>
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{children}</h3>
}

export function StatusDot({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('relative flex h-2 w-2', ok ? 'text-status-ok' : 'text-status-err')}>
        <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-40', ok ? 'animate-ping bg-status-ok' : 'bg-status-err')} />
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', ok ? 'bg-status-ok' : 'bg-status-err')} />
      </span>
      {label && <span className="font-mono text-[11px] font-medium uppercase tracking-wide">{label}</span>}
    </span>
  )
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2 border-b border-border bg-card/80 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between', className)}>
      {children}
    </div>
  )
}

export function DataPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-md border border-border bg-card', className)}>
      {children}
    </div>
  )
}

export function MetricCell({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0 px-4 py-3', className)}>
      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-base font-semibold tabular-nums text-foreground sm:text-lg">
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function FieldRow({
  label,
  description,
  children,
  className,
}: {
  label: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid gap-3 border-b border-border px-4 py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(180px,280px)] sm:items-center', className)}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function MonoLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </span>
  )
}
