-- 导入记录记下「导到哪」和被拒原因(导入中心改稿 2026-10-10 T1):记录表要逐行出「导到哪」和「去看」深链,
-- 整单被拒(4xx)也要留一条 rejected 写明原因。旧行这几列全空(前端见空就不出「去看」)。
-- 两条链都跑:只加列,不写数据。
ALTER TABLE import_log
  ADD COLUMN period_from VARCHAR(10) DEFAULT NULL COMMENT '导到的起始期:月 2026-09,日 2026-10-01,年 2026' AFTER target,
  ADD COLUMN period_to   VARCHAR(10) DEFAULT NULL COMMENT '导到的截止期,同上;单月时与 period_from 相同' AFTER period_from,
  ADD COLUMN company_id  INT UNSIGNED DEFAULT NULL COMMENT '导到哪家公司(management_company.id)' AFTER period_to,
  ADD COLUMN zone        VARCHAR(16) DEFAULT NULL COMMENT '导到哪个期区(抄表 p1/p2/p3/dorm;附表10 1..4)' AFTER company_id,
  ADD COLUMN note        VARCHAR(200) DEFAULT NULL COMMENT '被拒原因(后端信封 message)' AFTER status;
