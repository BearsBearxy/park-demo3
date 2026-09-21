// 取一个 @media 块的**块内**文本。
//
// 出处(2026-09-20 对抗复查实测):两处断言写成了 `css.slice(css.indexOf('@media (max-width: 600px)'))`
// ——「切到文件尾」只有在那个块恰好是文件最后一段时才等价于「块内」。
// 实跑验证:把 S 档规则整条挪到块外(正是要防的那种桌面回归),三条断言照样全绿;
// 任何人往文件尾部追加一条规则也会打开同一个洞。所以按**大括号配对**切,不按行号/下标切。
export function mediaBlock(css: string, query: string): string {
  const at = css.indexOf(query)
  if (at < 0) return ''
  const open = css.indexOf('{', at)
  if (open < 0) return ''
  let depth = 0
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++
    else if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j)
  }
  return ''
}
