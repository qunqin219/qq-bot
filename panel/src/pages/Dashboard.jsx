// 仪表盘页 —— QQ Bot 状态概览
import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { Card, Loading, ErrorBox, PageHeader } from '../components/UI.jsx'

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [status, messages, chats] = await Promise.all([
        api.getStatus(),
        api.getMessages({ limit: 1 }),
        api.getChats(),
      ])
      setData({
        status,
        messageCount: messages.total ?? 0,
        chatCount: chats.total ?? 0,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  if (loading) return <Loading text="正在获取 Bot 状态..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  const { status, messageCount, chatCount } = data
  const connected = status.connected
  const login = status.login || {}
  const groups = status.groups || []
  const topGroups = groups.slice(0, 5)

  const infoCards = [
    { label: 'QQ 号', value: login.user_id ?? '—', icon: '🆔' },
    { label: '昵称', value: login.nickname ?? '—', icon: '📛' },
    { label: '加入群数', value: status.group_count ?? 0, icon: '👥' },
    { label: '缓存消息', value: messageCount, icon: '💬' },
  ]

  return (
    <div>
      <PageHeader
        title="仪表盘"
        subtitle="QQ Bot 运行状态概览"
        action={
          <button
            onClick={fetchData}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
          >
            🔄 刷新
          </button>
        }
      />

      {/* 在线状态横幅 */}
      <div
        className={`mb-6 flex items-center gap-4 rounded-xl border p-6 ${
          connected
            ? 'border-emerald-800 bg-gradient-to-r from-emerald-950 to-slate-900'
            : 'border-red-800 bg-gradient-to-r from-red-950 to-slate-900'
        }`}
      >
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
            connected ? 'bg-emerald-600' : 'bg-red-600'
          }`}
        >
          💬
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-semibold text-white">
              {login.nickname || 'QQ Bot'}
            </h3>
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                connected
                  ? 'bg-emerald-600/20 text-emerald-400'
                  : 'bg-red-600/20 text-red-400'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connected ? 'animate-pulse bg-emerald-500' : 'bg-red-500'
                }`}
              />
              {connected ? '在线' : '离线'}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            QQ: {login.user_id ?? '—'} · 群数: {status.group_count ?? 0}
          </p>
        </div>
      </div>

      {/* 信息卡片网格 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {infoCards.map((card) => (
          <Card key={card.label}>
            <div className="mb-2 text-2xl">{card.icon}</div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {card.label}
            </div>
            <div className="mt-1 truncate text-lg font-semibold text-white">
              {String(card.value)}
            </div>
          </Card>
        ))}
      </div>

      {/* 群列表预览 */}
      <div className="mt-6">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">群列表预览</h3>
            <span className="text-xs text-slate-500">
              显示前 5 个（共 {status.group_count ?? 0} 个）
            </span>
          </div>
          {topGroups.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              暂无群数据（Bot 未连接或未加入任何群）
            </p>
          ) : (
            <ul className="space-y-2">
              {topGroups.map((g, i) => (
                <li
                  key={g.group_id ?? i}
                  className="flex items-center justify-between rounded-lg bg-slate-900/50 px-4 py-2.5 text-sm"
                >
                  <span className="flex items-center gap-2 text-slate-200">
                    <span className="text-slate-500">👥</span>
                    {g.group_name || '未命名群'}
                  </span>
                  <span className="font-mono text-xs text-slate-500">
                    {g.group_id}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
