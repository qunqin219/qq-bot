// 发送消息 —— 左目标选择 + 右撰写面板
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api/client'
import {
  PageHeader,
  DataPanel,
  Toolbar,
  PanelHeader,
  EmptyState,
  MonoLabel,
  useToast,
} from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MessageCircleIcon, RefreshCwIcon, SendIcon, UserIcon, UsersIcon } from '../../components/Icons'
import { cn } from '@/lib/utils'
import type { GroupInfo, ChatSummary } from '../../lib/shared/types'

export default function SendMsg() {
  const [type, setType] = useState('group')
  const [targetId, setTargetId] = useState('')
  const [message, setMessage] = useState('')
  const [groups, setGroups] = useState<GroupInfo[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [sending, setSending] = useState(false)
  const { success, error, ToastEl } = useToast()

  const fetchData = async () => {
    try {
      const [g, c] = await Promise.all([api.getGroups(), api.getChats()])
      setGroups(g.groups || [])
      setChats(c.chats || [])
    } catch {
      // 忽略，用户可手动输入
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const privateChats = chats.filter((c) => c.type === 'private')
  const targets = type === 'group' ? groups : privateChats

  const pick = (t: string, id: number | string) => {
    setType(t)
    setTargetId(String(id))
  }

  const handleSend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const id = Number(targetId.trim())
    if (!id || isNaN(id)) {
      error('请输入有效的 ID（数字）')
      return
    }
    if (!message.trim()) {
      error('消息内容不能为空')
      return
    }
    setSending(true)
    try {
      if (type === 'group') {
        await api.sendGroup(id, message)
      } else {
        await api.sendPrivate(id, message)
      }
      success('发送成功！')
      setMessage('')
    } catch (e) {
      error(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="发送消息"
        subtitle="运维推送通道 · 群 / 私聊"
        action={
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCwIcon className="h-4 w-4" /> 刷新目标
          </Button>
        }
      />
      {ToastEl}

      <DataPanel>
        <Toolbar>
          <Tabs
            value={type}
            onValueChange={(v) => {
              setType(v)
              setTargetId('')
            }}
          >
            <TabsList>
              <TabsTrigger value="group">
                <UsersIcon className="mr-1.5 h-3.5 w-3.5" /> 群
              </TabsTrigger>
              <TabsTrigger value="private">
                <UserIcon className="mr-1.5 h-3.5 w-3.5" /> 私聊
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="font-mono text-[11px] text-muted-foreground">
            {targets.length} targets
          </span>
        </Toolbar>

        <form onSubmit={handleSend} className="grid min-h-[420px] lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="border-b border-border lg:border-b-0 lg:border-r">
            <PanelHeader title="Targets" />
            <div className="border-b border-border p-3">
              <MonoLabel>Manual ID</MonoLabel>
              <Input
                type="number"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder={type === 'group' ? 'group_id' : 'user_id'}
                className="mt-1.5 h-9 font-mono"
              />
            </div>
            <div className="max-h-[320px] overflow-y-auto lg:max-h-[400px]">
              {targets.length === 0 ? (
                <EmptyState
                  icon={MessageCircleIcon}
                  title="暂无目标"
                  description="可手动输入 ID；连接后会同步列表。"
                  className="min-h-[120px] py-8"
                />
              ) : (
                targets.map((c, i) => {
                  if (type === 'group') {
                    const g = c as GroupInfo
                    const active = String(g.group_id) === targetId
                    return (
                      <button
                        key={`g-${g.group_id ?? i}`}
                        type="button"
                        onClick={() => pick('group', g.group_id)}
                        className={cn(
                          'flex w-full flex-col border-b border-border px-3 py-2.5 text-left hover:bg-muted/40',
                          active && 'bg-teal-50'
                        )}
                      >
                        <span className="truncate text-sm font-medium">{g.group_name || '未命名'}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{g.group_id}</span>
                      </button>
                    )
                  }
                  const p = c as ChatSummary
                  const active = String(p.id) === targetId
                  return (
                    <button
                      key={`p-${p.id ?? i}`}
                      type="button"
                      onClick={() => pick('private', p.id)}
                      className={cn(
                        'flex w-full flex-col border-b border-border px-3 py-2.5 text-left hover:bg-muted/40',
                        active && 'bg-teal-50'
                      )}
                    >
                      <span className="truncate text-sm font-medium">{p.name || p.id}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{p.id}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col">
            <PanelHeader
              title="Compose"
              meta={targetId ? `${type} → ${targetId}` : 'no target'}
            />
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="输入要发送的消息…"
              className="min-h-[280px] flex-1 resize-y rounded-none border-0 focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5">
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {message.length} chars
              </span>
              <Button type="submit" disabled={sending || !message.trim() || !targetId.trim()}>
                {sending ? '发送中…' : <><SendIcon className="h-4 w-4" /> 发送</>}
              </Button>
            </div>
          </div>
        </form>
      </DataPanel>
    </div>
  )
}
