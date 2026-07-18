// 上下文 —— 密集会话表
import { useEffect, useState } from 'react'
import { api } from '../../lib/api/client'
import {
  Loading,
  ErrorBox,
  PageHeader,
  DataPanel,
  Toolbar,
  EmptyState,
  useToast,
} from '../../components/UI'
import { Button } from '@/components/ui/button'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BrainIcon, RefreshCwIcon, Trash2Icon } from '../../components/Icons'
import type { ConversationSummary } from '../../lib/shared/types'

function formatTime(value: string | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function getKeyLabel(key: string) {
  if (key.startsWith('private:')) return `私聊 ${key.replace('private:', '')}`
  if (key.startsWith('group:')) return `群聊 ${key.replace('group:', '')}`
  return key
}

export default function Conversations() {
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmAllOpen, setConfirmAllOpen] = useState(false)
  const [confirmAllStep2, setConfirmAllStep2] = useState(false)
  const [deleteTargetKey, setDeleteTargetKey] = useState<string | null>(null)
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getConversations()
      setItems(data.conversations || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleDeleteOne = async (key: string) => {
    setDeletingKey(key)
    try {
      await api.deleteConversation(key)
      success('会话已删除')
      await fetchData()
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingKey(null)
      setDeleteOpen(false)
      setDeleteTargetKey(null)
    }
  }

  const handleClearAll = async () => {
    if (!items.length) return
    setClearingAll(true)
    try {
      await api.clearAllConversations()
      success('全部上下文已清空')
      await fetchData()
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setClearingAll(false)
      setConfirmAllOpen(false)
      setConfirmAllStep2(false)
    }
  }

  if (loading) return <Loading text="加载上下文..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      <PageHeader
        title="上下文"
        subtitle="按会话隔离的 AI 对话历史"
        action={
          <>
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCwIcon className="h-4 w-4" /> 刷新
            </Button>
            <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={clearingAll || items.length === 0}>
                  <Trash2Icon className="h-4 w-4" />
                  {clearingAll ? '清空中...' : '清空全部'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认清空全部上下文</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定清空全部 AI 上下文历史吗？此操作不可恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setConfirmAllOpen(false)}>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      setConfirmAllOpen(false)
                      setConfirmAllStep2(true)
                    }}
                  >
                    继续
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />
      {ToastEl}

      <AlertDialog open={confirmAllStep2} onOpenChange={setConfirmAllStep2}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>最终确认</AlertDialogTitle>
            <AlertDialogDescription>请再次确认：真的要清空全部会话上下文？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmAllStep2(false)}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleClearAll} disabled={clearingAll}>
              {clearingAll ? '清空中...' : '确认清空'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DataPanel>
        <Toolbar>
          <span className="font-mono text-[11px] text-muted-foreground">
            {items.length} conversations
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            key = group:id / private:id
          </span>
        </Toolbar>

        {items.length === 0 ? (
          <EmptyState
            icon={BrainIcon}
            title="暂无上下文历史"
            description="AI 回复产生对话历史后，这里会按会话 key 展示。"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono">会话</TableHead>
                  <TableHead className="font-mono">Key</TableHead>
                  <TableHead className="font-mono text-right">轮数</TableHead>
                  <TableHead className="font-mono">更新时间</TableHead>
                  <TableHead className="w-24 font-mono text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const isGroup = item.key.startsWith('group:')
                  return (
                    <TableRow key={item.key}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              isGroup
                                ? 'rounded bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] text-teal-800'
                                : 'rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'
                            }
                          >
                            {isGroup ? 'GROUP' : 'DM'}
                          </span>
                          <span className="text-sm font-medium">{getKeyLabel(item.key)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate font-mono text-xs text-muted-foreground">
                        {item.key}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {item.turns || 0}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatTime(item.updated_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog
                          open={deleteTargetKey === item.key && deleteOpen}
                          onOpenChange={(open) => {
                            if (!open) {
                              setDeleteOpen(false)
                              setDeleteTargetKey(null)
                            }
                          }}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="xs"
                              className="text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                setDeleteTargetKey(item.key)
                                setDeleteOpen(true)
                              }}
                              disabled={deletingKey === item.key}
                            >
                              <Trash2Icon className="h-3.5 w-3.5" />
                              {deletingKey === item.key ? '删除中...' : '删除'}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认删除会话</AlertDialogTitle>
                              <AlertDialogDescription>
                                确定删除「{getKeyLabel(item.key)}」及其全部上下文历史吗？此操作不可恢复。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel
                                onClick={() => {
                                  setDeleteOpen(false)
                                  setDeleteTargetKey(null)
                                }}
                              >
                                取消
                              </AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() => handleDeleteOne(item.key)}
                                disabled={deletingKey === item.key}
                              >
                                {deletingKey === item.key ? '删除中...' : '确认删除'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DataPanel>
    </div>
  )
}
