// 上下文管理页 —— 查看和清理按会话隔离的 AI 历史
import { useEffect, useState } from 'react'
import { api } from '../../lib/api/client'
import { Card, EmptyState, Loading, ErrorBox, PageHeader, PanelHeader, useToast } from '../../components/UI'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BrainIcon, RefreshCwIcon, Trash2Icon } from '../../components/Icons'
import type { ConversationSummary } from '../../lib/shared/types'

function formatTime(value: string | undefined) {
  if (!value) return '-'
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
  const [clearingKey, setClearingKey] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmAllOpen, setConfirmAllOpen] = useState(false)
  const [confirmAllStep2, setConfirmAllStep2] = useState(false)
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

  const handleClearOne = async (key: string) => {
    setClearingKey(key)
    try {
      await api.clearConversation(key)
      success('会话上下文已清空')
      await fetchData()
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setClearingKey(null)
      setConfirmOpen(false)
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

  const [pendingClearKey, setPendingClearKey] = useState<string | null>(null)

  if (loading) return <Loading text="加载上下文..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      <PageHeader
        title="上下文"
        subtitle="管理按私聊和群聊隔离保存的 AI 对话历史"
        action={
          <>
            <Button variant="outline" onClick={fetchData}>
              <RefreshCwIcon className="h-4 w-4" /> 刷新
            </Button>
            <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={clearingAll || items.length === 0}
                >
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
                  <AlertDialogCancel onClick={() => setConfirmAllOpen(false)}>
                    取消
                  </AlertDialogCancel>
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

      {/* 二次确认对话框 */}
      <AlertDialog open={confirmAllStep2} onOpenChange={setConfirmAllStep2}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>最终确认</AlertDialogTitle>
            <AlertDialogDescription>
              请再次确认：真的要清空全部会话上下文？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmAllStep2(false)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleClearAll}
              disabled={clearingAll}
            >
              {clearingAll ? '清空中...' : '确认清空'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="gap-0 p-0">
        <PanelHeader
          title="会话列表"
          description="私聊和每个群聊的上下文独立保存，互不串线。"
          meta={`${items.length} 个`}
        />
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
                <TableRow>
                  <TableHead>会话</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>消息数量 / 轮数</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.key} className="hover:bg-slate-50">
                    <TableCell className="whitespace-nowrap text-sm font-semibold text-slate-950">
                      {getKeyLabel(item.key)}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate font-mono text-xs text-slate-500">
                      {item.key}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-slate-700">
                      {(item.turns || 0) * 2} 条 / {item.turns || 0} 轮
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-slate-500">
                      {formatTime(item.updated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog
                        open={pendingClearKey === item.key && confirmOpen}
                        onOpenChange={(open) => {
                          if (!open) {
                            setConfirmOpen(false)
                            setPendingClearKey(null)
                          }
                        }}
                      >
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              setPendingClearKey(item.key)
                              setConfirmOpen(true)
                            }}
                            disabled={clearingKey === item.key}
                          >
                            <Trash2Icon className="h-3.5 w-3.5" />
                            {clearingKey === item.key ? '清空中...' : '清空'}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认清空</AlertDialogTitle>
                            <AlertDialogDescription>
                              确定清空「{getKeyLabel(item.key)}」的上下文吗？
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel
                              onClick={() => {
                                setConfirmOpen(false)
                                setPendingClearKey(null)
                              }}
                            >
                              取消
                            </AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => handleClearOne(item.key)}
                              disabled={clearingKey === item.key}
                            >
                              {clearingKey === item.key ? '清空中...' : '确认清空'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  )
}
