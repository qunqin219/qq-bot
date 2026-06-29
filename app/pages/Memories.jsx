// 个性化记忆页 —— 查看和管理按会话隔离的 AI 记忆
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api/client.js'
import { Card, EmptyState, Loading, ErrorBox, PageHeader, PanelHeader, useToast } from '../../components/UI.jsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { PinIcon, RefreshCwIcon, Trash2Icon } from '../../components/Icons.jsx'

const ALL_MEMORY_KEYS = '__all_memory_keys__'

function formatTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function getKeyLabel(key) {
  if (key?.startsWith('private:')) return `私聊 ${key.replace('private:', '')}`
  if (key?.startsWith('group:')) return `群聊 ${key.replace('group:', '')}`
  return key || '-'
}

export default function Memories() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterKey, setFilterKey] = useState(ALL_MEMORY_KEYS)
  const [newKey, setNewKey] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getMemories()
      setItems(data.memories || [])
    } catch (e) {
      setError(e.message)
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

  const handleCreate = async (e) => {
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
      toastError(e.message)
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
      toastError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (memory) => {
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
      toastError(e.message)
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
      toastError(e.message)
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
        subtitle="按私聊和群聊会话 key 隔离保存，模型可通过 create/edit/delete memory 工具主动维护"
        action={
          <Button variant="outline" onClick={fetchData}>
            <RefreshCwIcon className="h-4 w-4" /> 刷新
          </Button>
        }
      />
      {ToastEl}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="gap-0 p-0">
          <PanelHeader
            title="记忆列表"
            description="私聊使用 private:QQ，群聊使用 group:群号。"
            meta={`${shown.length} / ${items.length} 条`}
            action={
              <>
              <Select value={filterKey} onValueChange={setFilterKey}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="全部会话" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_MEMORY_KEYS}>全部会话</SelectItem>
                  {keys.map((key) => (
                    <SelectItem key={key} value={key}>{getKeyLabel(key)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClearKey}
                disabled={!activeFilterKey}
              >
                <Trash2Icon className="h-3.5 w-3.5" />
                清空此会话
              </Button>
              </>
            }
          />

          {shown.length === 0 ? (
            <EmptyState
              icon={PinIcon}
              title="暂无记忆"
              description={activeFilterKey ? '这个会话暂时没有记忆记录。' : '模型创建记忆或手动添加后会展示在这里。'}
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {shown.map((memory) => (
                <div key={memory.id} className="px-5 py-4 transition hover:bg-slate-50">
                  <div className="mb-2 flex flex-col gap-1 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 truncate font-mono">#{memory.id} · {memory.conversationKey}</div>
                    <div className="shrink-0">{formatTime(memory.updated_at || memory.created_at)}</div>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-6 text-slate-900">
                    {memory.content}
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(memory)}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(memory)}
                    >
                      <Trash2Icon className="h-3.5 w-3.5" /> 删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="gap-0 p-0">
          <PanelHeader
            title="手动添加"
            description="为指定会话 key 补充一条可被模型读取的记忆。"
          />
          <form onSubmit={handleCreate} className="space-y-4 px-5 py-4">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">会话 key</Label>
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="group:963688355 或 private:3605900361"
                className="mt-2 h-9 font-mono text-sm"
              />
              <div className="mt-2 flex flex-wrap gap-2">
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
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">记忆内容</Label>
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={6}
                placeholder="例如：用户喜欢直接简短的回答，不喜欢客服腔"
                className="mt-2"
              />
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? '保存中...' : '添加记忆'}
            </Button>
          </form>
        </Card>
      </div>

      {/* 编辑 Dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑记忆 #{editing?.id}</DialogTitle>
            <DialogDescription className="font-mono text-xs text-slate-400">
              {editing?.conversationKey}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editing?.content || ''}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
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

      {/* 删除确认 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除这条记忆吗？<br />
              <span className="mt-2 block text-xs text-slate-500">{deleteTarget?.content}</span>
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

      {/* 清空会话确认 */}
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
