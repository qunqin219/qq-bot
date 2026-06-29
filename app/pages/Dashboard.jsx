// 仪表盘页 —— QQ Bot 状态概览
import { useEffect, useState } from 'react'
import { api } from '../../lib/api/client.js'
import { Card, Loading, ErrorBox, PageHeader } from '../../components/UI.jsx'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import {
  MessageCircleIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  ShieldIcon,
  UsersIcon,
} from '../../components/Icons.jsx'
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
    {
      label: 'QQ 号',
      value: login.user_id ?? '—',
      hint: connected ? '当前登录账号' : '等待连接后同步',
      icon: ShieldIcon,
    },
    {
      label: '昵称',
      value: login.nickname ?? '—',
      hint: connected ? '机器人在线身份' : '尚未获取昵称',
      icon: MessageCircleIcon,
    },
    {
      label: '加入群数',
      value: status.group_count ?? 0,
      hint: connected ? 'NapCat 返回群列表' : '离线时不可用',
      icon: UsersIcon,
    },
    {
      label: '缓存消息',
      value: messageCount,
      hint: `${chatCount} 个会话索引`,
      icon: MessagesSquareIcon,
    },
  ]

  return (
    <div>
      <PageHeader
        title="仪表盘"
        subtitle="QQ Bot 运行状态概览"
        action={
          <Button onClick={fetchData}>
            <RefreshCwIcon className="h-4 w-4" /> 刷新
          </Button>
        }
      />

      <div className="space-y-5">
        {/* 在线状态横幅 */}
        <Alert
          className={cn(
            'overflow-hidden rounded-xl border bg-white p-0 shadow-sm',
            connected
              ? 'border-emerald-200'
              : 'border-red-200'
          )}
        >
          <div className={cn('h-1 w-full', connected ? 'bg-emerald-500' : 'bg-red-500')} />
          <div className="flex flex-col gap-5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white',
                connected ? 'bg-emerald-600' : 'bg-red-600'
              )}
            >
              <MessageCircleIcon className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-lg font-semibold text-slate-950">
                  {login.nickname || 'QQ Bot'}
                </h3>
                <Badge
                  variant={connected ? 'default' : 'destructive'}
                  className={cn(
                    'h-6 gap-1 rounded-full px-2.5 text-xs font-medium',
                    connected
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-red-100 text-red-700 hover:bg-red-100'
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      connected ? 'animate-pulse bg-emerald-500' : 'bg-red-500'
                    )}
                  />
                  {connected ? '在线' : '离线'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {connected
                  ? `QQ: ${login.user_id ?? '—'} · 已同步 ${status.group_count ?? 0} 个群`
                  : '未连接 NapCat，状态数据将在连接后自动显示'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:min-w-[220px]">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                群数
              </div>
              <div className="mt-1 text-lg font-semibold leading-none text-slate-950">
                {status.group_count ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                会话
              </div>
              <div className="mt-1 text-lg font-semibold leading-none text-slate-950">
                {chatCount}
              </div>
            </div>
          </div>
          </div>
        </Alert>

        {/* 信息卡片网格 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {infoCards.map((card) => {
            const Icon = card.icon
            return (
              <Card key={card.label} className="min-h-[116px] gap-0 p-0">
                <div className="flex h-full flex-col justify-between px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {card.label}
                      </div>
                      <div className="mt-3 truncate text-2xl font-semibold leading-none text-slate-950">
                        {String(card.value)}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        connected ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-500'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  <div
                    className={cn(
                      'mt-4 truncate text-xs',
                      connected ? 'text-slate-400' : 'text-red-400'
                    )}
                  >
                    {card.hint}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>

        {/* 群列表预览 */}
        <Card className="gap-0 p-0">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">群列表预览</h3>
              <p className="mt-1 text-sm text-slate-500">
                {connected ? '来自 NapCat 的实时群列表' : '连接后展示最近同步的群信息'}
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
              显示前 5 个 / 共 {status.group_count ?? 0} 个
            </span>
          </div>

          {topGroups.length === 0 ? (
            <div className="flex min-h-[148px] flex-col items-center justify-center px-6 py-10 text-center">
              <div
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-lg',
                  connected ? 'bg-slate-100 text-slate-500' : 'bg-red-50 text-red-500'
                )}
              >
                <UsersIcon className="h-5 w-5" />
              </div>
              <div className="mt-3 text-sm font-semibold text-slate-800">
                暂无群数据
              </div>
              <p className="mt-1 max-w-md text-sm text-slate-400">
                Bot 未连接或当前账号未加入任何群，刷新后会自动同步最新状态
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {topGroups.map((g, i) => (
                <li
                  key={g.group_id ?? i}
                  className="flex items-center justify-between gap-4 px-5 py-3 text-sm transition hover:bg-slate-50"
                >
                  <span className="flex min-w-0 items-center gap-3 text-slate-950">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <UsersIcon className="h-4 w-4" />
                    </span>
                    <span className="truncate">{g.group_name || '未命名群'}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-slate-400">
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
