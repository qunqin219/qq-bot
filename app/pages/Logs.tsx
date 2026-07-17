// 日志 —— 结构化可读视图（剥离 ANSI、分行级样式）
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api/client'
import {
  Loading,
  ErrorBox,
  PageHeader,
  DataPanel,
  Toolbar,
  EmptyState,
  useToast,
} from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { CopyIcon, RefreshCwIcon, ScrollTextIcon, SearchIcon } from '../../components/Icons'
import { cn } from '@/lib/utils'
import type { LogsResponse } from '../../lib/shared/types'

const quickFilters = [
  { label: '全部', value: '' },
  { label: '错误', value: '[ERROR]' },
  { label: 'AI', value: '[AI]' },
  { label: '工具', value: '[ToolAudit]' },
  { label: '消息', value: '收到消息' },
  { label: '连接', value: '[WS]' },
]

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'LOG' | 'DEBUG' | 'OTHER'

interface ParsedLog {
  raw: string
  clean: string
  time: string
  timeShort: string
  level: LogLevel
  source: string
  message: string
  noisy: boolean
}

/** 去掉 ANSI / 残留颜色码，避免 [36m [1m 这类垃圾字符 */
function stripAnsi(input: string): string {
  return input
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u009b[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\[(?:\d{1,3};)*\d{1,3}m/g, '')
    .replace(/\r/g, '')
    .trimEnd()
}

function shortTime(full: string): string {
  // 2026-07-17 15:58:33.758 CST → 15:58:33
  const m = full.match(/(\d{2}:\d{2}:\d{2})/)
  return m ? m[1] : full
}

function detectLevel(text: string): LogLevel {
  if (/\bERROR\b|失败|Traceback|ECONNREFUSED/i.test(text)) return 'ERROR'
  if (/\bWARN(?:ING)?\b|警告/i.test(text)) return 'WARN'
  if (/\bDEBUG\b/i.test(text)) return 'DEBUG'
  if (/\bINFO\b/i.test(text)) return 'INFO'
  if (/\bLOG\b/i.test(text)) return 'LOG'
  return 'OTHER'
}

function parseLogLine(raw: string): ParsedLog {
  const clean = stripAnsi(raw)
  const noisy = /\[vite\]|hmr update|vite:?\s/i.test(clean)

  // [ts] [LEVEL] rest
  const head = clean.match(
    /^\[([^\]]+)\]\s*\[(INFO|WARN(?:ING)?|ERROR|LOG|DEBUG)\]\s*(.*)$/i
  )

  let time = ''
  let level: LogLevel = 'OTHER'
  let rest = clean

  if (head) {
    time = head[1]
    level = detectLevel(head[2].toUpperCase().replace('WARNING', 'WARN'))
    rest = head[3] || ''
  } else {
    level = detectLevel(clean)
  }

  // leading [Source] tag
  let source = ''
  const src = rest.match(/^\[([^\]]+)\]\s*(.*)$/)
  if (src) {
    source = src[1]
    rest = src[2]
  } else if (noisy) {
    source = 'vite'
  } else if (/收到消息/.test(rest)) {
    source = 'Msg'
  }

  // normalize common sources
  if (/^toolaudit$/i.test(source)) source = 'Tool'
  if (/^botcore$/i.test(source)) source = 'Bot'
  if (/^imagecache$/i.test(source)) source = 'Img'

  return {
    raw,
    clean,
    time,
    timeShort: time ? shortTime(time) : '',
    level,
    source,
    message: rest || clean,
    noisy,
  }
}

const levelStyles: Record<LogLevel, { chip: string; row: string; label: string }> = {
  ERROR: {
    chip: 'bg-red-100 text-red-700 ring-1 ring-red-200',
    row: 'bg-red-50/80',
    label: '错误',
  },
  WARN: {
    chip: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
    row: 'bg-amber-50/70',
    label: '警告',
  },
  INFO: {
    chip: 'bg-sky-100 text-sky-800 ring-1 ring-sky-200',
    row: '',
    label: '信息',
  },
  LOG: {
    chip: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
    row: '',
    label: '日志',
  },
  DEBUG: {
    chip: 'bg-teal-50 text-teal-800 ring-1 ring-teal-200',
    row: '',
    label: '调试',
  },
  OTHER: {
    chip: 'bg-secondary text-muted-foreground ring-1 ring-border',
    row: '',
    label: '其他',
  },
}

function LogRow({ log, index }: { log: ParsedLog; index: number }) {
  const style = levelStyles[log.level]
  return (
    <div
      className={cn(
        'grid grid-cols-[52px_44px_minmax(0,1fr)] gap-x-2 border-b border-border/70 px-3 py-1.5 sm:grid-cols-[64px_48px_72px_minmax(0,1fr)]',
        style.row,
        log.noisy && 'opacity-60'
      )}
    >
      <span className="pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
        {log.timeShort || '—'}
      </span>
      <span className="pt-0.5">
        <span
          className={cn(
            'inline-flex rounded px-1 py-0.5 font-mono text-[10px] font-medium leading-none',
            style.chip
          )}
          title={log.level}
        >
          {style.label}
        </span>
      </span>
      <span className="hidden truncate pt-0.5 font-mono text-[11px] text-teal-700 sm:block">
        {log.source || '—'}
      </span>
      <div className="min-w-0">
        {log.source ? (
          <span className="mr-1.5 inline font-mono text-[11px] text-teal-700 sm:hidden">
            [{log.source}]
          </span>
        ) : null}
        <span className="whitespace-pre-wrap break-words text-[12.5px] leading-5 text-foreground">
          {log.message}
        </span>
        <span className="ml-2 hidden select-none font-mono text-[10px] text-muted-foreground/50 group-hover:inline">
          #{index + 1}
        </span>
      </div>
    </div>
  )
}

export default function Logs() {
  const [data, setData] = useState<LogsResponse>({ lines: [], total: 0 })
  const [limit, setLimit] = useState(300)
  const [query, setQuery] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [newestFirst, setNewestFirst] = useState(true)
  const [hideNoise, setHideNoise] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async (next: Record<string, unknown> = {}) => {
    const nextLimit = (next.limit ?? limit) as number
    const nextQuery = (next.query ?? query) as string
    setError(null)
    try {
      const resp = await api.getLogs({ limit: nextLimit, q: nextQuery })
      setData(resp)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!autoRefresh) return undefined
    const timer = setInterval(fetchData, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, limit, query])

  const parsed = useMemo(() => {
    const lines = data.lines || []
    const ordered = newestFirst ? [...lines].reverse() : lines
    return ordered.map(parseLogLine)
  }, [data.lines, newestFirst])

  const visible = useMemo(
    () => (hideNoise ? parsed.filter((l) => !l.noisy) : parsed),
    [parsed, hideNoise]
  )

  const stats = useMemo(() => {
    let errors = 0
    let warns = 0
    for (const l of visible) {
      if (l.level === 'ERROR') errors += 1
      if (l.level === 'WARN') warns += 1
    }
    return { errors, warns, noise: parsed.length - visible.length }
  }, [visible, parsed])

  const copyText = useMemo(
    () => visible.map((l) => l.clean).join('\n'),
    [visible]
  )

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      success('已复制清理后的日志')
    } catch (e) {
      toastError((e instanceof Error ? e.message : String(e)) || '复制失败')
    }
  }

  const submitSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    fetchData()
  }

  if (loading && !data.lines?.length) return <Loading text="加载日志..." />
  if (error && !data.lines?.length) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {ToastEl}
      <div className="shrink-0">
        <PageHeader
          title="运行日志"
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {visible.length} 条
                {stats.noise > 0 ? `（已隐藏 ${stats.noise} 条开发噪音）` : ''}
              </span>
              {stats.errors > 0 && (
                <span className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-[10px] text-red-700">
                  {stats.errors} 错误
                </span>
              )}
              {stats.warns > 0 && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700">
                  {stats.warns} 警告
                </span>
              )}
              {typeof data.modified_at === 'string' && data.modified_at && (
                <span className="text-muted-foreground">
                  更新于 {new Date(data.modified_at).toLocaleString('zh-CN')}
                </span>
              )}
            </span>
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setNewestFirst((v) => !v)}>
                {newestFirst ? '最新在上' : '最旧在上'}
              </Button>
              <Button
                variant={autoRefresh ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAutoRefresh((v) => !v)}
              >
                {autoRefresh ? '实时中' : '已暂停'}
              </Button>
              <Button size="sm" onClick={() => fetchData()}>
                <RefreshCwIcon className="h-4 w-4" /> 刷新
              </Button>
            </div>
          }
        />
      </div>

      <DataPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Toolbar className="shrink-0">
          <form onSubmit={submitSearch} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索关键词，例如 AI、连接失败、收到消息"
              className="h-8 min-w-[200px] flex-1 text-sm"
            />
            <Select
              value={String(limit)}
              onValueChange={(value) => {
                const nextLimit = Number(value)
                setLimit(nextLimit)
                fetchData({ limit: nextLimit })
              }}
              options={[100, 300, 500, 1000, 2000].map((n) => ({
                value: String(n),
                label: `最近 ${n} 行`,
              }))}
              className="h-8 w-[120px]"
            />
            <Button type="submit" size="sm">
              <SearchIcon className="h-3.5 w-3.5" /> 查询
            </Button>
            <Button variant="outline" size="sm" onClick={copyLogs} disabled={!copyText}>
              <CopyIcon className="h-3.5 w-3.5" /> 复制
            </Button>
          </form>
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={hideNoise} onCheckedChange={setHideNoise} />
            隐藏 Vite 噪音
          </label>
        </Toolbar>

        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border px-3 py-2">
          {quickFilters.map((item) => (
            <Button
              key={item.label}
              variant={query === item.value ? 'default' : 'outline'}
              size="xs"
              onClick={() => {
                setQuery(item.value)
                fetchData({ query: item.value })
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {error && (
          <div className="shrink-0 border-b border-border p-3">
            <ErrorBox message={error} onRetry={fetchData} />
          </div>
        )}

        {/* 列头 */}
        <div className="hidden shrink-0 grid-cols-[64px_48px_72px_minmax(0,1fr)] gap-x-2 border-b border-border bg-secondary/60 px-3 py-1.5 sm:grid">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">时间</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">级别</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">来源</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">内容</span>
        </div>

        {!visible.length ? (
          <EmptyState
            icon={ScrollTextIcon}
            title="没有可显示的日志"
            description={
              hideNoise && parsed.length > 0
                ? '当前都被「隐藏 Vite 噪音」过滤掉了，可以关掉开关查看。'
                : '换个关键词，或扩大最近行数后再查。'
            }
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f7f8fa]">
            {visible.map((log, idx) => (
              <LogRow key={`${idx}-${log.clean.slice(0, 48)}`} log={log} index={idx} />
            ))}
          </div>
        )}
      </DataPanel>
    </div>
  )
}
