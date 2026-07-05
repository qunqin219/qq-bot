// 发送消息页 —— 向群或私聊发送文本消息
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api/client'
import { Card, EmptyState, PageHeader, useToast } from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select } from '@/components/ui/select'
import { MessageCircleIcon, RefreshCwIcon, SendIcon, UserIcon, UsersIcon } from '../../components/Icons'
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
  const candidates = type === 'group' ? groups : privateChats

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
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="发送消息"
        subtitle="向群聊或私聊发送文本消息"
        action={
          <Button variant="outline" onClick={fetchData}>
            <RefreshCwIcon className="h-4 w-4" /> 刷新目标
          </Button>
        }
      />
      {ToastEl}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_260px]">
        <Card className="p-5">
          <form onSubmit={handleSend} className="space-y-5">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                发送类型
              </label>
              <Tabs
                value={type}
                onValueChange={(v) => { setType(v); setTargetId('') }}
                className="mt-2"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="group">群消息</TabsTrigger>
                  <TabsTrigger value="private">私聊消息</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {candidates.length > 0 && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  快速选择
                </label>
                <Select
                  value=""
                  onValueChange={(v) => v && setTargetId(v)}
                  placeholder={type === 'group' ? '— 选择群 —' : '— 选择用户 —'}
                  options={[
                    { value: '', label: type === 'group' ? '— 选择群 —' : '— 选择用户 —' },
                    ...candidates.map((c) => {
                      if (type === 'group') {
                        const g = c as GroupInfo
                        return { value: String(g.group_id), label: `${g.group_name} (${g.group_id})` }
                      }
                      const p = c as ChatSummary
                      return { value: String(p.id), label: `${p.name} (${p.id})` }
                    }),
                  ]}
                  className="mt-2 w-full"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {type === 'group' ? '群号 (group_id)' : '用户 QQ (user_id)'}
              </label>
              <Input
                type="number"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder={type === 'group' ? '例如：123456789' : '例如：1525899506'}
                className="mt-2 h-9 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                消息内容
              </label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                placeholder="输入要发送的消息..."
                className="mt-2"
              />
            </div>

            <Button type="submit" disabled={sending} className="w-full">
              {sending ? '发送中...' : <><SendIcon className="h-4 w-4" /> 发送消息</>}
            </Button>
          </form>
        </Card>

        <Card className="p-0">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-semibold text-foreground">可选目标</div>
            <div className="text-xs text-muted-foreground">
              {groups.length} 群 · {privateChats.length} 私聊
            </div>
          </div>

          {groups.length === 0 && privateChats.length === 0 ? (
            <EmptyState
              icon={MessageCircleIcon}
              title="暂无可选目标"
              description="可以先手动输入群号或用户 QQ。"
            />
          ) : (
            <div className="max-h-[600px] overflow-y-auto p-3">
              <div className="space-y-2">
                {groups.slice(0, 6).map((group, index) => (
                  <button
                    key={`group-${group.group_id ?? index}`}
                    type="button"
                    onClick={() => {
                      setType('group')
                      setTargetId(String(group.group_id))
                    }}
                    className="flex w-full items-center gap-2 rounded-md border border-border bg-card p-2 text-left transition hover:bg-secondary"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700">
                      <UsersIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-foreground">{group.group_name || '未命名群'}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">{group.group_id}</span>
                    </span>
                  </button>
                ))}
                {privateChats.slice(0, 6).map((chat, index) => (
                  <button
                    key={`private-${chat.id ?? index}`}
                    type="button"
                    onClick={() => {
                      setType('private')
                      setTargetId(String(chat.id))
                    }}
                    className="flex w-full items-center gap-2 rounded-md border border-border bg-card p-2 text-left transition hover:bg-secondary"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                      <UserIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-foreground">{chat.name || chat.id}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">{chat.id}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
