// 个性化记忆页 —— 查看和管理按会话隔离的 AI 记忆
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api/client'
import { Card, EmptyState, Loading, ErrorBox, PageHeader, useToast } from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
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
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function getKeyLabel(key: string | undefined) {
  if (key?.startsWith('private:')) return `私聊 ${key.replace('private:', '')}`
  if (key?.startsWith('group:')) return `群聊 ${key.replace('group:', '')}`
  return key || '-'
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

  const handleClearKey = async () => {
    if (!activeFilterKey) return
    setClearOpen(true)
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
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="个性化记忆"
        subtitle="按私聊和群聊会话 key 隔离保存，模型可通过 create/edit/delete memory 工具主动维护"
        action={
          <Button variant="outline" onClick={fetchData}>
            <RefreshCwIcon className="h-4 w-4" /> 刷新
          </Button>
        }
      />
      {ToastEl}

      <Card className="mb-5 p-4">
        <form onSubmit={handleCreate}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                会话 key
              </label>
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="group:963688355 或 private:3605900361"
                className="mt-1.5 h-9 font-mono text-sm"
              />
            </div>
            <div className="min-w-0 flex-[2]">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                记忆内容
              </label>
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={2}
                placeholder="例如：用户喜欢直接简短的回答，不喜欢客服腔"
                className="mt-1.5 min-h-[60px]"
              />
            </div>
            <Button type="submit" disabled={saving} className="w-full shrink-0 lg:w-auto">
              {saving ? '保存中...' : <><PlusIcon className="h-4 w-4" /> 添加</>}
            </Button>
          </div>

          {keys.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {keys.slice(0, 6).map((key) => (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setNewKey(key)}
                >
                  {getKeyLabel(key)}
                </Button>
              ))}
            </div>
          )}
        </form>
      </Card>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          共 {shown.length} 条记忆
          {activeFilterKey && ` · ${getKeyLabel(activeFilterKey)}`}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filterKey}
            onValueChange={setFilterKey}
            placeholder="全部会话"
            options={[
              { value: ALL_MEMORY_KEYS, label: '全部会话' },
              ...keys.map((key) => ({ value: key, label: getKeyLabel(key) })),
            ]}
            className="w-full sm:w-[220px]"
          />
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClearKey}
            disabled={!activeFilterKey}
          >
            <Trash2Icon className="h-3.5 w-3.5" /> 清空此会话
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={PinIcon}
          title="暂无记忆"
          description={activeFilterKey ? '这个会话暂时没有记忆记录。' : '模型创建记忆或手动添加后会展示在这里。'}
        />
      ) : (
        <div className="space-y-3">
          {shown.map((memory) => (
            <Card key={memory.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-medium text-muted-foreground">
                    #{memory.id} · {getKeyLabel(memory.conversationKey)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatTime(memory.updated_at || memory.created_at)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(memory)}>
                    编辑
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => handleDelete(memory)}>
                    <Trash2Icon className="h-3.5 w-3.5" /> 删除
                  </Button>
                </div>
              </div>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {memory.content}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑记忆 #{editing?.id}</DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">
              {editing?.conversationKey}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editing?.content || ''}
            onChange={(e) => setEditing({ ...editing!, content: e.target.value })}
            rows={8}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
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
              确定删除这条记忆吗？<br />
              <span className="mt-2 block text-xs text-muted-foreground">{deleteTarget?.content}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteOpen(false); setDeleteTarget(null) }}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              删除
            </AlertDialogAction>
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
            <AlertDialogAction variant="destructive" onClick={confirmClear}>
              清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
