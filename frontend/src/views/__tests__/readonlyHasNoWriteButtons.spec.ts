import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 「无权账号看到了保存/取消」的回归门禁。
//
// 2026-08-22 用户截图抓到：月度台账对只读账号显示了「保存」「取消」。根因是
//
//     <Button v-if="!edit && auth.can('entry:edit')">编辑模式</Button>
//     <template v-else>  <Button>取消</Button><Button>保存</Button>  </template>
//
// P0 给 v-if 加权限判断之前，条件只是 `!edit`，v-else 正好等于「在编辑态」。加上
// `&& can(...)` 之后，v-else 变成「在编辑态 **或** 没权限」—— 无权账号落进了写入口分支。
// 同一个形状在台账 + 三大报表共 4 个屏上一模一样。
//
// 这类错误 typecheck 和 build 都抓不到（模板合法、类型正确），单测也只有在恰好挂载
// 那个屏并断言按钮时才抓得到。所以在源码层把这个**形状**掐死。
const VIEWS = join(__dirname, '..')

function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...vueFiles(p))
    else if (name.endsWith('.vue')) out.push(p)
  }
  return out
}

/** 一行里既有取反的编辑态、又有权限判断 —— 就是出事的那个形状 */
const RISKY_VIF = /v-if="[^"]*![a-zA-Z]*[Ee]dit[^"]*(?:auth\.can\(|\bcan[A-Z]\w*|\bcanEdit\b)[^"]*"/
/** 裸 v-else。v-else-if 不算：它自带条件，不会把「无权」吞进去 */
const BARE_VELSE = /<[a-zA-Z][^>]*\sv-else[\s>]/

describe('无权账号不得出现写入口', () => {
  it('「!edit && 有权限」的 v-if 后面不许跟裸 v-else', () => {
    const bad: string[] = []
    for (const file of vueFiles(VIEWS)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (!RISKY_VIF.test(lines[i])) continue

        // 往后 12 行内找同块的裸 v-else。
        //
        // ⚠ 停止条件必须**缩进感知**。v-if 那行与 v-else 之间通常隔着
        //   `<template #leading>…</template>`（按钮图标插槽）——见到任何 </template>
        //   就停的话永远走不到 v-else。本文件第一版正是那么写的，
        //   变异验证（把修好的地方改回 v-else）当场发现它抓不到，才补上这条。
        const indent = lines[i].length - lines[i].trimStart().length
        for (let j = i + 1; j < Math.min(i + 13, lines.length); j++) {
          const line = lines[j]
          const t = line.trim()
          if (!t || t.startsWith('<!--') || t.startsWith('//')) continue
          if (BARE_VELSE.test(line)) {
            const rel = file.replace(/\\/g, '/').split('/src/')[1]
            bad.push(`${rel}  v-if@${i + 1} → v-else@${j + 1}：${lines[i].trim().slice(0, 88)}`)
            break
          }
          // 只有**外层**块闭合才算出了这个分支组（缩进浅于 v-if 那一层）
          if (t.startsWith('</') && line.length - line.trimStart().length < indent) break
        }
      }
    }
    expect(
      bad,
      '这些地方的 v-else 会把「没有权限」也算成「在编辑态」，无权账号会看到写入口。'
        + '改成显式的 v-if="edit"：\n    ' + bad.join('\n    '),
    ).toEqual([])
  })
})
