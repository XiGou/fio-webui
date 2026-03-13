import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const VERSION_ITEMS = ['草稿工作流', '模板库', '已发布工作流']

export function WorkflowStudioPage() {
  const [activeVersion, setActiveVersion] = useState(VERSION_ITEMS[0])

  return (
    <div className="space-y-4">
      <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-foreground">
        <strong>Studio 新体验：</strong>此页面为后续无限画布主入口。若遇到迁移风险，可回退至「传统配置（Legacy）」。
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-medium">工作流工作台</CardTitle>
            <p className="text-xs text-muted-foreground">三栏布局：节点库 / 画布 / 属性面板</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">版本菜单</span>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              <span>{activeVersion}</span>
              <div className="flex gap-1">
                {VERSION_ITEMS.map((item) => (
                  <Button
                    key={item}
                    size="sm"
                    variant={item === activeVersion ? 'default' : 'ghost'}
                    className="h-7 px-2 text-xs"
                    onClick={() => setActiveVersion(item)}
                  >
                    {item}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid min-h-[620px] grid-cols-12 gap-4">
        <Card className="col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">节点库</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div className="rounded-md border border-dashed border-border p-3">I/O 节点</div>
            <div className="rounded-md border border-dashed border-border p-3">控制流节点</div>
            <div className="rounded-md border border-dashed border-border p-3">系统动作节点</div>
          </CardContent>
        </Card>

        <Card className="col-span-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">画布</CardTitle>
          </CardHeader>
          <CardContent className="flex h-[520px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
            Infinite Canvas Placeholder
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">属性面板</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-md border border-dashed border-border p-3">节点基础信息</div>
            <div className="rounded-md border border-dashed border-border p-3">执行参数</div>
            <div className="rounded-md border border-dashed border-border p-3">版本元数据</div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
