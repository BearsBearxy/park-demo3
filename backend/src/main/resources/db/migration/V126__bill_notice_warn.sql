-- V126 催缴单告警条目化(BILL-NOTICE-WARN-SPEC §2)。
--
-- 为什么改:bill_notice.warn VARCHAR(255) 是个分号口袋,九类语义不同的告警拼在一起。
-- 字段窄逼着每条写到最短、不带实例数据,屏上于是没法分类、没法列条目、没法给「去哪改」的落点。
-- 五类甚至是固定字面量进 Set 去重,每户每类最多留一条 —— 三条缺参数计费行只报一条。
--
-- 为什么不回填:库里 463 条 warn 是 2026-08-30 的快照,其中 401 条的判据(有费项未设置收款公司)
-- 已于 2026-09-23 从代码摘掉,86 条还是旧文案(新文案「房号对不上合同」库里 0 条)。
-- 解析回填 = 把两个刚修好的 bug 原样搬进新表。要新告警就点一次「重新生成」。
--
-- warn 列留一版:代码停止读写它,核对无误后下一个迁移再 DROP。
-- ⚠ 它不是 undo。463 条旧 warn 全部落在 draft 单上(实测 0 条在 confirmed/exported),
--   而重新生成会把这些 draft 单连行带串一起删掉。留这一列只是迁移期间万一要回读老文本,
--   不构成「改坏了能退回来」的保证。真要回退靠 git + 再生成一次。

CREATE TABLE IF NOT EXISTS bill_notice_warn (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  notice_id INT UNSIGNED NOT NULL,
  code      VARCHAR(24) NOT NULL COMMENT '告警类别=WarnCode 枚举常量名;库里不存文案',
  payload   VARCHAR(64) NOT NULL DEFAULT '' COMMENT '实例数据业务键(房号/价目键/计费行id/表id/费项键);无实例数据的类固定空串',
  hint      VARCHAR(64) NOT NULL DEFAULT '' COMMENT '第二段实例数据(表名/合同号·费项名);无则空串',
  -- ⚠ 这把唯一键在多值 INSERT 下不是去重器,是断路器:撞一行,整条 SQL 失败,整个 generate() 事务回滚。
  --   所以 payload 取的必须是「同一张单内一行一个」的键(计费行 id、房号 token、价目键),
  --   不能取「一对多」的键(合同号、租户 id)。实测:合同 145 有 5 条缺参数计费行、其中两条同名,
  --   payload 取合同号会当场撞键、整月出不了单。
  UNIQUE KEY uk_warn (notice_id, code, payload),
  -- payload/hint 写 NOT NULL DEFAULT '' 而不是 NULL:MySQL unique 索引对 NULL 不去重,
  -- NULL 键会攒重复行(V92__bill_note_override.sql:5 已为这件事栽过一次)。
  CONSTRAINT fk_warn_notice FOREIGN KEY (notice_id) REFERENCES bill_notice(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='催缴单告警条目;随单生随单死(CASCADE)';

-- CASCADE 是唯一的清理路径:全仓没有任何显式删明细行的代码 —— generate() 开头一句
-- notices.delete(del)(BillNoticeService 注释原话「行由 FK CASCADE 连删」),
-- confirm / markExported / void 都只 updateById。新子表跟着同一套。

ALTER TABLE bill_notice MODIFY warn VARCHAR(255) NULL
  COMMENT 'V126 之前的告警快照,只读;新告警在 bill_notice_warn';
