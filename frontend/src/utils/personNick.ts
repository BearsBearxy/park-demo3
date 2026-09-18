// 人名头像里写的字(TAB-BAR-SPEC §7):中文名两个字写全名,三个字以上写后两个字(欧阳明 → 阳明),
// 钉钉 / 飞书同款 —— 只写一个姓的话,同姓的人在头像组里分不清。
// 不是中文名(英文、空)时返回 undefined,交回 Avatar 自己按词取首字母。
export function personNick(name: string | null | undefined): string | undefined {
  const n = (name ?? '').trim()
  if (!/[一-鿿]/.test(n)) return undefined
  return n.length > 2 ? n.slice(-2) : n
}
