// 可复用的 UI 组件（shadcn/ui 薄包装层）
import type { ReactNode, ComponentType, SVGProps } from 'react'
import { toast } from 'sonner'
import { Alert, AlertAction } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card as ShadcnCard } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { AlertCircleIcon } from './Icons'

// ── 加载状态指示器 ─────────────────────────────
export function Loading({ text = '加载中...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-500">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
      <span>{text}</span>
    </div>
  )
}

// ── 错误提示 ───────────────────────────────────
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

// ── Toast 通知（委托给 Sonner）────────────────────
export function useToast(): {
  success: (msg: string) => void
  error: (msg: string) => void
  ToastEl: null
} {
  const success = (msg: string) => toast.success(msg)
  const error = (msg: string) => toast.error(msg)
  const ToastEl = null

  return { success, error, ToastEl }
}

// ── 卡片容器 ───────────────────────────────────
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <ShadcnCard className={cn('rounded-lg shadow-sm shadow-slate-950/5', className)}>
      {children}
    </ShadcnCard>
  )
}

// ── 页面标题 ───────────────────────────────────
export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="truncate text-2xl font-bold text-slate-950">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

export function PanelHeader({ title, description, meta, action, className = '' }: { title: ReactNode; description?: ReactNode; meta?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-semibold text-slate-950">{title}</h3>
          {meta && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
              {meta}
            </span>
          )}
        </div>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
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
    <div className={cn('flex min-h-[148px] flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {Icon && (
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className={cn('text-sm font-semibold text-slate-800', Icon && 'mt-3')}>
        {title}
      </div>
      {description && <p className="mt-1 max-w-md text-sm text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
