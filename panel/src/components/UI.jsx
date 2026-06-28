// 可复用的 UI 组件
import { useEffect, useState } from 'react'

// ── 加载状态指示器 ─────────────────────────────
export function Loading({ text = '加载中...' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-400">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-sky-500" />
      <span>{text}</span>
    </div>
  )
}

// ── 错误提示 ───────────────────────────────────
export function ErrorBox({ message, onRetry }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
      <div className="flex items-center gap-2">
        <span>⚠️</span>
        <span>{message || '发生错误'}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded bg-red-800 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
        >
          重试
        </button>
      )}
    </div>
  )
}

// ── Toast 通知（成功/失败）────────────────────
export function useToast() {
  const [toast, setToast] = useState(null)

  const show = (type, message) => {
    setToast({ type, message })
  }
  const success = (msg) => show('success', msg)
  const error = (msg) => show('error', msg)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const ToastEl = toast ? (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-medium text-white shadow-xl ${
        toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
      }`}
    >
      <span>{toast.type === 'success' ? '✅' : '❌'}</span>
      <span>{toast.message}</span>
    </div>
  ) : null

  return { toast, success, error, ToastEl }
}

// ── 卡片容器 ───────────────────────────────────
export function Card({ children, className = '' }) {
  return (
    <div
      className={`rounded-xl border border-slate-800 bg-slate-800/50 p-6 shadow-lg ${className}`}
    >
      {children}
    </div>
  )
}

// ── 页面标题 ───────────────────────────────────
export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
