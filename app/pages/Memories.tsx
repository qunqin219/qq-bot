// 记忆 —— 左会话导航 + 右列表/编辑器
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api/client'
import {
  Loading,
  ErrorBox,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { PinIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from '../../components/Icons'
import { cn } from '@/lib/utils'

interface MemoryItem {
  id: number
  conversationKey: string
  content: string
  updated_at?: string
  created_at?: string
  [key: string]: unknown
}

const ALL_MEMORY_KEYS = '__all_memory_keys__'

function formatTime(value: string | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function getKeyLabel(key: string | undefined) {
  if (key?.startsWith('private:')) return `私聊 ${key.replace('private:', '')}`
  if (key?.startsWith('group:')) return `群聊 ${key.replace('group:', '')}`
  return key || '—'
}

export default function Memories() {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterKey, setFilterKey] = useState(ALL_MEMORY_KEYS)
  const [newKey, setNewKey] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editing, setEditing] = useState<MemoryItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<MemoryItem | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getMemories()
      setItems((data.memories || []) as unknown as MemoryItem[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const keys = useMemo(
    () => [...new Set(items.map((m) => m.conversationKey).filter(Boolean))],
    [items]
  )

  const activeFilterKey = filterKey === ALL_MEMORY_KEYS ? '' : filterKey
  const shown = activeFilterKey ? items.filter((m) => m.conversationKey === activeFilterKey) : items

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const key = newKey.trim()
    const content = newContent.trim()
    if (!key || !content) {
      toastError('会话 key 和记忆内容不能为空')
      return
    }
    setSaving(true)
    try {
      await api.createMemory(key, content)
      setNewContent('')
      success('记忆已添加')
      await fetchData()
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async () => {
    if (!editing) return
    const content = editing.content.trim()
    if (!content) {
      toastError('记忆内容不能为空')
      return
    }
    setSaving(true)
    try {
      await api.updateMemory(editing.id, editing.conversationKey, content)
      setEditing(null)
      success('记忆已更新')
      await fetchData()
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (memory: MemoryItem) => {
    setDeleteTarget(memory)
    setDeleteOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteMemory(deleteTarget.id, deleteTarget.conversationKey)
      success('记忆已删除')
      await fetchData()
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleteOpen(false)
      setDeleteTarget(null)
    }
  }

  const confirmClear = async () => {
    if (!activeFilterKey) return
    try {
      await api.clearMemories(activeFilterKey)
      success('该会话记忆已清空')
      await fetchData()
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setClearOpen(false)
    }
  }

  if (loading) return <Loading text="加载记忆..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      <PageHeader
        title="个性化记忆"
        subtitle="按会话 key 隔离；模型可通过 memory 工具维护"
        action={
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCwIcon className="h-4 w-4" /> 刷新
          </Button>
        }
      />
      {ToastEl}

      <DataPanel>
        <Toolbar>
          <MonoLabel>Composer</MonoLabel>
          <span className="font-mono text-[11px] text-muted-foreground">{shown.length} memories</span>
        </Toolbar>

        <form onSubmit={handleCreate} className="grid gap-3 border-b border-border p-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
          <div>
            <MonoLabel>Session Key</MonoLabel>
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="group:… / private:…"
              className="mt-1.5 h-9 font-mono text-sm"
            />
            {keys.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {keys.slice(0, 4).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setNewKey(key)}
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-secondary"
                  >
                    {getKeyLabel(key)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <MonoLabel>Content</MonoLabel>
            <Textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={2}
              placeholder="例如：用户喜欢简短直接的回答"
              className="mt-1.5 min-h-[60px]"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={saving} className="w-full lg:w-auto">
              {saving ? '保存中...' : <><PlusIcon className="h-4 w-4" /> 添加</>}
            </Button>
          </div>
        </form>

        <div className="grid min-h-[360px] lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-b border-border lg:border-b-0 lg:border-r">
            <PanelHeader
              title="Keys"
              action={
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-destructive"
                  disabled={!activeFilterKey}
                  onClick={() => setClearOpen(true)}
                >
                  清空
                </Button>
              }
            />
            <div className="max-h-[280px] overflow-y-auto lg:max-h-[440px]">
              <button
                type="button"
                onClick={() => setFilterKey(ALL_MEMORY_KEYS)}
                className={cn(
                  'flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left text-sm hover:bg-muted/40',
                  filterKey === ALL_MEMORY_KEYS && 'bg-teal-50 text-teal-900'
                )}
              >
                <span>全部会话</span>
                <span className="font-mono text-[10px] text-muted-foreground">{items.length}</span>
              </button>
              {keys.map((key) => {
                const count = items.filter((m) => m.conversationKey === key).length
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilterKey(key)}
                    className={cn(
                      'flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left hover:bg-muted/40',
                      filterKey === key && 'bg-teal-50'
                    )}
                  >
                    <span className="min-w-0 truncate text-sm font-medium">{getKeyLabel(key)}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <PanelHeader
              title="Entries"
              meta={activeFilterKey ? getKeyLabel(activeFilterKey) : 'all'}
            />
            {shown.length === 0 ? (
              <EmptyState
                icon={PinIcon}
                title="暂无记忆"
                description={activeFilterKey ? '这个会话暂时没有记忆。' : '添加或由模型写入后显示于此。'}
              />
            ) : (
              <div className="max-h-[440px] divide-y divide-border overflow-y-auto">
                {shown.map((memory) => (
                  <div key={memory.id} className="px-3 py-3 hover:bg-muted/20">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 font-mono text-[10px] text-muted-foreground">
                        #{memory.id} · {getKeyLabel(memory.conversationKey)} ·{' '}
                        {formatTime(memory.updated_at || memory.created_at)}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="outline" size="xs" onClick={() => setEditing(memory)}>
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(memory)}
                        >
                          <Trash2Icon className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {memory.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DataPanel>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑记忆 #{editing?.id}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{editing?.conversationKey}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={editing?.content || ''}
            onChange={(e) => setEditing({ ...editing!, content: e.target.value })}
            rows={8}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除这条记忆吗？
              <span className="mt-2 block text-xs text-muted-foreground">{deleteTarget?.content}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteOpen(false); setDeleteTarget(null) }}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空</AlertDialogTitle>
            <AlertDialogDescription>
              确定清空「{activeFilterKey}」下的全部记忆吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setClearOpen(false)}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmClear}>清空</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
