// 管理员 —— 工具条 + 密集表格
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
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
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PlusIcon, ShieldIcon, Trash2Icon } from '../../components/Icons'

export default function Admins() {
  const [admins, setAdmins] = useState<Array<number | string>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newAdmin, setNewAdmin] = useState('')
  const [saving, setSaving] = useState(false)
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const cfg = await api.getConfig()
      setAdmins(cfg.admins || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const persist = async (next: Array<number | string>) => {
    setSaving(true)
    try {
      await api.updateConfig({ admins: next })
      setAdmins(next)
      success('管理员列表已更新')
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const id = Number(newAdmin.trim())
    if (!id || isNaN(id)) {
      toastError('请输入有效的 QQ 号（数字）')
      return
    }
    if (admins.includes(id)) {
      toastError('该 QQ 已在管理员列表中')
      return
    }
    persist([...admins, id])
    setNewAdmin('')
  }

  const handleRemove = (id: number | string) => {
    persist(admins.filter((a) => a !== id))
  }

  if (loading) return <Loading text="加载管理员列表..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      <PageHeader
        title="管理员"
        subtitle="可触发 Bot 命令与 AI 的 QQ 白名单"
      />
      {ToastEl}

      <DataPanel>
        <Toolbar>
          <form onSubmit={handleAdd} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Add QQ
            </span>
            <Input
              type="number"
              value={newAdmin}
              onChange={(e) => setNewAdmin(e.target.value)}
              placeholder="1525899506"
              className="h-8 max-w-xs font-mono text-sm"
            />
            <Button type="submit" size="sm" disabled={saving || !newAdmin.trim()}>
              {saving ? '保存中...' : <><PlusIcon className="h-3.5 w-3.5" /> 添加</>}
            </Button>
          </form>
          <span className="font-mono text-[11px] text-muted-foreground">
            {admins.length} accounts
          </span>
        </Toolbar>

        {admins.length === 0 ? (
          <EmptyState
            icon={ShieldIcon}
            title="暂无管理员"
            description="添加至少一个 QQ 后，Bot 才能安全处理管理命令。"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12 font-mono">#</TableHead>
                  <TableHead className="font-mono">QQ</TableHead>
                  <TableHead className="font-mono">Role</TableHead>
                  <TableHead className="w-20 font-mono text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map((id, idx) => (
                  <TableRow key={id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="font-mono text-sm font-medium">{id}</TableCell>
                    <TableCell>
                      <span className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-teal-800">
                        Admin
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleRemove(id)}
                        disabled={saving}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DataPanel>
    </div>
  )
}
