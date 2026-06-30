// 日志页 —— 查看 server.log，便于排查 AI / OneBot / 工具调用问题
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api/client.js'
import { Card, EmptyState, Loading, ErrorBox, PageHeader, PanelHeader, useToast } from '../../components/UI.jsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CopyIcon, RefreshCwIcon, ScrollTextIcon, SearchIcon } from '../../components/Icons.jsx'
const quickFilters = [
  { label: '全部', value: '' },
  { label: 'AI 日志', value: '[AI]' },
  { label: '工具审计', value: '[ToolAudit]' },
  { label: '收到消息', value: '收到消息' },
  { label: '敏感词', value: 'sensitive_words' },
]

function levelClass(line) {
  if (/error|失败|返回错误|sensitive_words|Traceback/i.test(line)) {
    return 'border-red-200 bg-red-50 text-red-700'
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
    return 'border-slate-200 bg-slate-100 text-sky-700'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default function Logs() {
  const [data, setData] = useState({ lines: [], total: 0 })
  const [limit, setLimit] = useState(300)
  const [query, setQuery] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [newestFirst, setNewestFirst] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async (next = {}) => {
    const nextLimit = next.limit ?? limit
    const nextQuery = next.query ?? query
    setError(null)
    try {
      const resp = await api.getLogs({ limit: nextLimit, q: nextQuery })
      setData(resp)
    } catch (e) {
      setError(e.message)
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
      toastError(e.message || '复制失败')
    }
  }

  const submitSearch = (e) => {
    e.preventDefault()
    setLoading(true)
    fetchData()
  }

  if (loading && !data.lines?.length) return <Loading text="加载日志..." />
  if (error && !data.lines?.length) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      {ToastEl}
      <PageHeader
        title="运行日志"
        subtitle={`server.log · ${data.total || 0} 行${data.modified_at ? ` · 更新于 ${new Date(data.modified_at).toLocaleString('zh-CN')}` : ''}`}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setNewestFirst((v) => !v)}
            >
              {newestFirst ? '↓ 最新在上' : '↑ 最旧在上'}
            </Button>
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              onClick={() => setAutoRefresh((v) => !v)}
            >
              {autoRefresh ? '自动刷新中' : '自动刷新'}
            </Button>
            <Button onClick={fetchData}>
              <RefreshCwIcon className="h-4 w-4" /> 刷新
            </Button>
          </div>
        }
      />

      <Card className="mb-5 gap-0 p-0">
        <PanelHeader
          title="日志筛选"
          description="按关键词和尾部行数读取 server.log。"
          meta={`${visibleLines.length} 行`}
        />
        <form onSubmit={submitSearch} className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="min-w-[240px] flex-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">关键词筛选</Label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如 sensitive_words / ToolCall / 收到消息"
              className="mt-2 h-9"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">最近行数</Label>
            <Select
              value={String(limit)}
              onValueChange={(value) => {
                const nextLimit = Number(value)
                setLimit(nextLimit)
                fetchData({ limit: nextLimit })
              }}
            >
              <SelectTrigger className="mt-2 h-9 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[100, 300, 500, 1000, 2000].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} 行</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="submit">
            <SearchIcon className="h-4 w-4" /> 查询
          </Button>
          <Button
            variant="outline"
            onClick={copyLogs}
            disabled={!logText}
          >
            <CopyIcon className="h-4 w-4" /> 复制
          </Button>
        </form>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3">
          {quickFilters.map((item) => (
            <Button
              key={item.label}
              variant={query === item.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setQuery(item.value)
                fetchData({ query: item.value })
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </Card>

      {error && <div className="mb-4"><ErrorBox message={error} onRetry={fetchData} /></div>}

      <Card className="gap-0 p-0">
        <PanelHeader
          title="日志输出"
          description={newestFirst ? '最新日志显示在上方。' : '最旧日志显示在上方。'}
          meta={autoRefresh ? '自动刷新中' : '手动刷新'}
        />
        {!visibleLines.length ? (
          <EmptyState
            icon={ScrollTextIcon}
            title="没有匹配日志"
            description="换一个关键词或扩大最近行数后再查询。"
          />
        ) : (
          <ScrollArea className="max-h-[68vh]">
            <div className="p-3 font-mono text-xs leading-relaxed">
              {visibleLines.map((line, idx) => (
                <div
                  key={`${idx}-${line.slice(0, 30)}`}
                  className={`mb-1 whitespace-pre-wrap break-words rounded-md border px-3 py-2 ${levelClass(line)}`}
                >
                  <span className="mr-3 select-none text-slate-400">{idx + 1}</span>
                  {line}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </Card>
    </div>
  )
}
