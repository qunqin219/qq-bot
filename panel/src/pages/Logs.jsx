// 日志页 —— 查看 server.log，便于排查 AI / OneBot / 工具调用问题
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client.js'
import { Card, Loading, ErrorBox, PageHeader, useToast } from '../components/UI.jsx'

const quickFilters = [
  { label: '全部', value: '' },
  { label: 'AI 错误', value: '[AI]' },
  { label: '工具调用', value: 'Tool' },
  { label: '收到消息', value: '收到消息' },
  { label: '敏感词', value: 'sensitive_words' },
]

function levelClass(line) {
  if (/error|失败|返回错误|sensitive_words|Traceback/i.test(line)) {
    return 'border-red-500/30 bg-red-950/20 text-red-200'
  }
  if (/warn|警告|用户要求引用/i.test(line)) {
    return 'border-amber-500/30 bg-amber-950/20 text-amber-100'
  }
  if (/ToolCall|ToolResult|模型选择引用|群聊回复引用/i.test(line)) {
    return 'border-violet-500/30 bg-violet-950/20 text-violet-100'
  }
  if (/收到消息/i.test(line)) {
    return 'border-sky-500/20 bg-sky-950/10 text-sky-100'
  }
  return 'border-slate-800 bg-slate-950/50 text-slate-300'
}

export default function Logs() {
  const [data, setData] = useState({ lines: [], total: 0 })
  const [limit, setLimit] = useState(300)
  const [query, setQuery] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
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

  const logText = useMemo(() => (data.lines || []).join('\n'), [data.lines])

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
            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                autoRefresh
                  ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                  : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
              }`}
            >
              {autoRefresh ? '⏱ 自动刷新中' : '⏱ 自动刷新'}
            </button>
            <button
              type="button"
              onClick={fetchData}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
            >
              🔄 刷新
            </button>
          </div>
        }
      />

      <Card className="mb-4">
        <form onSubmit={submitSearch} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-2 block text-sm font-medium text-slate-300">
              关键词筛选
            </label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如 sensitive_words / ToolCall / 收到消息"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              最近行数
            </label>
            <select
              value={limit}
              onChange={(e) => {
                const nextLimit = Number(e.target.value)
                setLimit(nextLimit)
                fetchData({ limit: nextLimit })
              }}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              {[100, 300, 500, 1000, 2000].map((n) => (
                <option key={n} value={n}>{n} 行</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500"
          >
            🔍 查询
          </button>
          <button
            type="button"
            onClick={copyLogs}
            disabled={!logText}
            className="rounded-lg bg-slate-700 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            📋 复制
          </button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {quickFilters.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setQuery(item.value)
                fetchData({ query: item.value })
              }}
              className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-sky-500 hover:text-sky-300"
            >
              {item.label}
            </button>
          ))}
        </div>
      </Card>

      {error && <div className="mb-4"><ErrorBox message={error} onRetry={fetchData} /></div>}

      <Card className="p-0">
        {!data.lines?.length ? (
          <p className="py-12 text-center text-sm text-slate-500">
            没有匹配日志
          </p>
        ) : (
          <div className="max-h-[68vh] overflow-auto p-3 font-mono text-xs leading-relaxed">
            {data.lines.map((line, idx) => (
              <div
                key={`${idx}-${line.slice(0, 30)}`}
                className={`mb-1 whitespace-pre-wrap break-words rounded border px-3 py-2 ${levelClass(line)}`}
              >
                <span className="mr-3 select-none text-slate-600">{idx + 1}</span>
                {line}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
