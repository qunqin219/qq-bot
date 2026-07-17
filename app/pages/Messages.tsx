// 最近消息 —— 左会话列表 + 右消息流
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api/client'
import {
  Loading,
  ErrorBox,
  PageHeader,
  DataPanel,
  Toolbar,
  EmptyState,
  PanelHeader,
} from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RefreshCwIcon, UserIcon, UsersIcon, MessagesSquareIcon } from '../../components/Icons'
import { cn } from '@/lib/utils'
import type { ChatSummary } from '../../lib/shared/types'

interface MessageItem {
  message_id: number | string
  user_id: number | string
  group_id?: number | string | null
  nickname?: string
  time?: string | number
  raw_message?: string
  [key: string]: unknown
}

export default function Messages() {
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState('all')
  const [filterChat, setFilterChat] = useState('all')

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [msgs, chatList] = await Promise.all([
        api.getMessages({ limit: 100 }),
        api.getChats(),
      ])
      setChats(chatList.chats || [])
      const all = msgs.messages || []
      if (filterType === 'group') {
        setMessages(all.filter((m) => m.group_id))
      } else if (filterType === 'private') {
        setMessages(all.filter((m) => !m.group_id))
      } else {
        setMessages(all)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [filterType])

  const filteredChats = useMemo(() => {
    if (filterType === 'group') return chats.filter((c) => c.type === 'group')
    if (filterType === 'private') return chats.filter((c) => c.type === 'private')
    return chats
  }, [chats, filterType])

  const visible =
    filterChat === 'all'
      ? messages
      : messages.filter((m) => {
          const id = m.group_id ? m.group_id : m.user_id
          return String(id) === String(filterChat)
        })

  if (loading) return <Loading text="加载消息..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      <PageHeader
        title="最近消息"
        subtitle="OneBot 消息缓存监视器"
        action={
          <Button size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCwIcon className="h-4 w-4" /> 刷新
          </Button>
        }
      />

      <DataPanel>
        <Toolbar>
          <Tabs
            value={filterType}
            onValueChange={(value) => {
              setFilterType(value)
              setFilterChat('all')
            }}
          >
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="group">群</TabsTrigger>
              <TabsTrigger value="private">私聊</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="font-mono text-[11px] text-muted-foreground">
            {visible.length} / {messages.length} msgs · {filteredChats.length} chats
          </span>
        </Toolbar>

        <div className="grid min-h-[420px] lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* 左：会话列表 */}
          <div className="border-b border-border lg:border-b-0 lg:border-r">
            <PanelHeader title="Chats" meta={String(filteredChats.length)} />
            <div className="max-h-[280px] overflow-y-auto lg:max-h-[520px]">
              <button
                type="button"
                onClick={() => setFilterChat('all')}
                className={cn(
                  'flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left text-sm transition hover:bg-muted/40',
                  filterChat === 'all' && 'bg-teal-50 text-teal-900'
                )}
              >
                <span className="font-medium">全部会话</span>
                <span className="font-mono text-[10px] text-muted-foreground">{messages.length}</span>
              </button>
              {filteredChats.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无会话</div>
              ) : (
                filteredChats.map((c) => (
                  <button
                    key={`${c.type}-${c.id}`}
                    type="button"
                    onClick={() => setFilterChat(String(c.id))}
                    className={cn(
                      'flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left transition hover:bg-muted/40',
                      String(filterChat) === String(c.id) && 'bg-teal-50'
                    )}
                  >
                    <div
                      className={cn(
                        'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded',
                        c.type === 'group' ? 'bg-teal-600 text-teal-50' : 'bg-sidebar text-sidebar-foreground'
                      )}
                    >
                      {c.type === 'group' ? (
                        <UsersIcon className="h-3.5 w-3.5" />
                      ) : (
                        <UserIcon className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.name || c.id}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {c.type} · {c.id}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 右：消息流 */}
          <div className="flex min-w-0 flex-col">
            <PanelHeader title="Stream" meta={`${visible.length} lines`} />
            {visible.length === 0 ? (
              <EmptyState
                icon={MessagesSquareIcon}
                title="暂无消息记录"
                description="收到群聊或私聊后，这里会显示缓存内容。"
              />
            ) : (
              <div className="max-h-[520px] divide-y divide-border overflow-y-auto">
                {visible.map((m, i) => {
                  const isGroup = !!m.group_id
                  return (
                    <div key={`${m.message_id ?? i}-${i}`} className="px-3 py-3 hover:bg-muted/30">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {m.nickname || m.user_id}
                        </span>
                        <Badge variant={isGroup ? 'default' : 'secondary'}>
                          {isGroup ? '群' : '私聊'}
                        </Badge>
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                          {m.time ? new Date(m.time).toLocaleString('zh-CN') : ''}
                        </span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                        {m.raw_message || '(空消息)'}
                      </p>
                      <div className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                        id {m.message_id} · user {m.user_id}
                        {isGroup && ` · group ${m.group_id}`}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DataPanel>
    </div>
  )
}
