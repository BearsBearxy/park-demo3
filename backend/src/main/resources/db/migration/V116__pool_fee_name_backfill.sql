-- V116__pool_fee_name_backfill.sql
-- F4 只回填了 side(V115),同一个失效模式在 fee_name 上原样重演
-- (docs/superpowers/specs/2026-08-29-pool-entry-coverage-audit.md:61,计划漏掉了这半边)。
-- 全表按 poolName() 同规则复算,现名与复算结果不同的池会在下次保存时被静默改名——
-- 92/96/97/98/99 的 fee_name 是 NULL,保存即把 name 里那截费项文字丢光;
-- 23 的 fee_name 填错了(填成了建筑名"招商中心",不是费项)。

-- (a) 五个干净情形:fee_name 是 NULL,name 最后一个中点分隔段就是费项文字,原样lift回去。
-- WHERE 不按 id 认池:只在"用 building 名 + floor_label(+side) + name 末段拼回去
-- 恰好等于现名"这个可证明安全的条件下才动,其它情形一概不碰。
UPDATE alloc_rule r
JOIN building b ON b.id = r.building_id
SET r.fee_name = SUBSTRING_INDEX(r.name, '·', -1)
WHERE r.fee_name IS NULL
  AND r.floor_label IS NOT NULL
  AND r.name LIKE '%·%·%'
  AND r.name = CONCAT(b.name, '·', r.floor_label, IFNULL(r.side, ''), '·', SUBSTRING_INDEX(r.name, '·', -1));

-- (b) 池 23 需要判断,不能套用上面的通用条件:它的 fee_name 不是空,是填错了。
-- 现状:building='一期 招商中心'(园区招商中心楼),floor_label='四楼',fee_name='招商中心'
-- (把建筑名抄进了费项名槽,不是真正的费项),name='一期 招商中心·净电'
-- (这一段"净电"其实是本该有的费项——池是招商中心的净电计量,method=direct+
-- fee_key=park_loss_pool,与 F3 那批 0 户例外池同类)。
--
-- 判断:fee_name 改成'净电'(与 name 里已经写着的费项文字一致,不是瞎猜);
-- 这会让复算结果从"一期 招商中心·净电"变成"一期 招商中心·四楼·净电"——
-- 确实改了名,但改的是把本来就存在、只是没显示出来的真实楼层位置"四楼"补回来,
-- 与同栋同层的兄弟池 30(一期 招商中心·四楼·公共用电)、31(一期 招商中心·四楼·空调外机)
-- 命名口径完全对齐——23 才是那个丢了"四楼"段的异类。
-- 另一个选项是把 floor_label 清空以保住旧名字一字不变,但那是删掉真实位置数据去保一个
-- 本来就不完整的显示串,取舍更差,不采用。
-- name 列一并改成复算后的正确值(不留给下次保存才改)——否则这一行会一直卡在
-- "现名与复算不符"的名单里,F4 的"存量池名字全部自洽"就没有真正达成。
UPDATE alloc_rule
SET fee_name = '净电', name = '一期 招商中心·四楼·净电'
WHERE id = 23 AND fee_name = '招商中心' AND name = '一期 招商中心·净电';

-- 池 25「一期园区·路灯」维持不动,原因同 V115:building_id 为 NULL 却填了 floor_label,
-- 定位数据本身填错了,应由用户在界面上清空楼层,不该由迁移猜——不属于本迁移范围。
