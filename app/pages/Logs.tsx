// 日志页 —— 查看 server.log，便于排查 AI / OneBot / 工具调用问题
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api/client'
import { Card, EmptyState, Loading, ErrorBox, PageHeader, useToast } from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { CopyIcon, RefreshCwIcon, ScrollTextIcon, SearchIcon } from '../../components/Icons'
import type { LogsResponse } from '../../lib/shared/types'

const quickFilters = [
  { label: '全部', value: '' },
  { label: 'AI 日志', value: '[AI]' },
  { label: '工具审计', value: '[ToolAudit]' },
  { label: '收到消息', value: '收到消息' },
  { label: '敏感词', value: 'sensitive_words' },
]

function levelClass(line: string) {
  if (/error|失败|返回错误|sensitive_words|Traceback/i.test(line)) {
    return 'border-destructive/20 bg-destructive/10 text-destructive'
  }
  if (/warn|警告|用户要求引用/i.test(line)) {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }
  if (/ToolAudit|ToolCall|ToolResult|模型选择引用|群聊回复引用/i.test(line)) {
    return 'border-violet-200 bg-violet-50 text-violet-800'
  }
  if (/\[AI\]|Gemini|回复开始|回复生成完成|发送.*回复/i.test(line)) {
    return 'border-blue-200 bg-blue-50 text-blue-800'
  }
  if (/收到消息/i.test(line)) {
    return 'border-border bg-secondary text-primary'
  }
  return 'border-border bg-secondary text-foreground'
}

export default function Logs() {
  const [data, setData] = useState<LogsResponse>({ lines: [], total: 0 })
  const [limit, setLimit] = useState(300)
  const [query, setQuery] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [newestFirst, setNewestFirst] = useState(true)
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

  const visibleLines = useMemo(() => {
    const lines = data.lines || []
    return newestFirst ? [...lines].reverse() : lines
  }, [data.lines, newestFirst])

  const logText = useMemo(() => visibleLines.join('\n'), [visibleLines])

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logText)
      success('日志已复制')
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
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col">
      {ToastEl}
      <PageHeader
        title="运行日志"
        subtitle={`server.log · ${data.total || 0} 行${data.modified_at ? ` · 更新于 ${new Date(data.modified_at as string).toLocaleString('zh-CN')}` : ''}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setNewestFirst((v) => !v)}>
              {newestFirst ? '↓ 最新在上' : '↑ 最旧在上'}
            </Button>
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
            >
              {autoRefresh ? '自动刷新中' : '自动刷新'}
            </Button>
            <Button size="sm" onClick={() => fetchData()}>
              <RefreshCwIcon className="h-4 w-4" /> 刷新
            </Button>
          </div>
        }
      />

      <Card className="mb-4 shrink-0 p-3">
        <form onSubmit={submitSearch} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="关键词筛选，例如 sensitive_words / ToolCall / 收到消息"
              className="h-9 min-w-[200px] flex-1"
            />
            <Select
              value={String(limit)}
              onValueChange={(value) => {
                const nextLimit = Number(value)
                setLimit(nextLimit)
                fetchData({ limit: nextLimit })
              }}
              options={[100, 300, 500, 1000, 2000].map((n) => ({ value: String(n), label: `${n} 行` }))}
              className="h-9 w-[120px]"
            />
            <Button type="submit" size="sm">
              <SearchIcon className="h-4 w-4" /> 查询
            </Button>
            <Button variant="outline" size="sm" onClick={copyLogs} disabled={!logText}>
              <CopyIcon className="h-4 w-4" /> 复制
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
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
        </form>
      </Card>

      {error && (
        <div className="mb-4 shrink-0">
          <ErrorBox message={error} onRetry={fetchData} />
        </div>
      )}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            日志输出
          </span>
          <span className="text-xs text-muted-foreground">
            {visibleLines.length} 行 · {newestFirst ? '最新在上' : '最旧在上'}
            {autoRefresh && ' · 自动刷新'}
          </span>
        </div>

        {!visibleLines.length ? (
          <EmptyState
            icon={ScrollTextIcon}
            title="没有匹配日志"
            description="换一个关键词或扩大最近行数后再查询。"
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted p-4">
            <div className="space-y-1 font-mono text-xs leading-relaxed">
              {visibleLines.map((line, idx) => (
                <div
                  key={`${idx}-${line.slice(0, 30)}`}
                  className={`flex gap-3 rounded-md border px-3 py-2 ${levelClass(line)}`}
                >
                  <span className="w-8 shrink-0 select-none text-right text-muted-foreground">
                    {idx + 1}
                  </span>
                  <span className="whitespace-pre-wrap break-words">{line}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
