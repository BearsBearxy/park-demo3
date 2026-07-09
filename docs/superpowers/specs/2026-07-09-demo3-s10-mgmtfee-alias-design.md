# 附表10 三期企业管理服务费丢列修复 规范(2026-07-09)

## 现象(用户报)

附表10 三期(phase 3)园区费用明细表里「厂房企业管理服务费」有数据(如中科华贸 2025-10 = 5,805.00),导入系统后该列全空 → 收入核对页台账 vs 附表10 不匹配。

## 根因(已定位,证据级)

- s10 导入按**表头名字匹配**(splitSections → matchByHeader,列映射 = layout.ts 的 phaseLayouts 叶子)。
- `layout.ts` 两版面对同一字段 `factoryMgmtFee` 用了**不同标签**:
  - OFFICE(phase 1/4,line 22):`厂房企业管理服务费` ✓
  - FACTORY(phase 2/3,line 65):`企业管理服务费`
- 真实源文件的**块表头措辞在期间之间不一致**(附表10测试.xlsx r520 三期块 = `厂房企业管理服务费`;二期块 = `企业管理服务费`):
  - 二期(factory 版面)源表头 `企业管理服务费` === 版面标签 → 匹配,有数据(2025-10 phase2 合计 453,200.67)。
  - 三期(factory 版面)源表头 `厂房企业管理服务费`,`matchByHeader` 判定 `nh===label || nh.startsWith(label)`:`厂房企业管理服务费`.startsWith(`企业管理服务费`)=false → **不匹配 → 整列丢弃**(2025-10 phase3 合计 0.00,38 户全空)。
- 逐列交叉核对三期完整表头(r520)vs FACTORY 版面:**唯一不匹配的就是 factoryMgmtFee**;其余(厂房租金/商铺企业管理服务费/厂房基础设施维护费/土地使用税、房产税/电水费…)标签一致,不受影响。

## 修复(最小外科手术)

matchByHeader 已支持 `aliases`(台账 v2 引入)。给 s10 版面的 factoryMgmtFee 加别名让两种措辞都命中:

1. `views/sales-income/layout.ts`:`Leaf` 接口加可选 `aliases?: string[]`;FACTORY 版面 factoryMgmtFee 叶子加 `aliases: ['厂房企业管理服务费']`(主标签仍 `企业管理服务费`,兼容二期)。
2. `utils/importRegistry.ts` `phaseLayoutsCol`:构造列映射时透传 `aliases: l.aliases`(现仅传 label/key)。
3. **前缀碰撞核查**:新别名 `厂房企业管理服务费` 对 FACTORY/OFFICE 全部标签做 normalize 后 === / startsWith 核验无误命中(与 `厂房租金`/`厂房基础设施维护费`/`商铺企业管理服务费` 均不冲突)。

## 数据修复

修 layout 后**重导 附表10测试.xlsx**(当前 s10 数据来源,5 个月)→ 三期 factoryMgmtFee 落库。注意:母册附表10 是报表透视格式(另一问题,本次不处理),故只能修 5 个月的三期管理费。

## 验收

- 单测:构造三期 factory 段(表头含 `厂房企业管理服务费` + 一行数值)→ 断言 factoryMgmtFee 取到值;二期段(`企业管理服务费`)仍匹配(回归)。
- SQL:重导后 phase=3 各月 SUM(factory_mgmt_fee) > 0;中科华贸三期某月 factory_mgmt_fee = 源文件对应值。
- 全量门禁 test+typecheck 绿。
