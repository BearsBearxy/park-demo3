# Plan:附表10 三期企业管理服务费丢列修复(2026-07-09)

依据 spec:[2026-07-09-demo3-s10-mgmtfee-alias-design.md](../specs/2026-07-09-demo3-s10-mgmtfee-alias-design.md)。纯前端 layout 别名修复 + 重导数据。

## 阶段1 · 实现(单 agent)
- W1 layout.ts:Leaf 加 aliases?;FACTORY factoryMgmtFee 加 aliases ['厂房企业管理服务费']。
- W2 importRegistry phaseLayoutsCol:透传 aliases。
- W3 前缀碰撞核查(代码内注释 + 单测):新别名不误命中其它 factory/office 标签。
- W4 单测:三期 factory 段(厂房企业管理服务费)→ factoryMgmtFee 命中;二期(企业管理服务费)回归;既有 importSections/importRegistry spec 不破。
- 门禁 npm run test + typecheck 全绿。

## 阶段2 · 复审(单 agent,对抗)
- 数值:layout 别名核查逐标签;matchByHeader aliases 路径确认;真实 附表10测试.xlsx 三期块解析 → factoryMgmtFee 有值(临时探针跑完删)。
- 回归:s10 其它期/列不受扰;全量门禁。

## 主会话收尾
- 复审确认后:重导 附表10测试.xlsx(vitest 管线,同上次批量导入机制,对 dev 后端)。
- SQL 验收 phase=3 factory_mgmt_fee > 0 + 中科华贸抽值核对。
- import_log 刷新。
