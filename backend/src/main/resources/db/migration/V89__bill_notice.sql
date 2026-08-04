-- V89__bill_notice.sql — 催缴单落表(S4-BILL-NOTICE-SPEC §3):BILL-DERIVE-SPEC §4 草案 + 审计修订。
-- 修订两处:line 增 contract_id(绑定是表级属性,不快照则回溯漂移)与 share_src(份额解析路径快照);
-- base_snap 在公摊行语义 = 该户份额基数(层数/㎡/weight),不是池级基数。
-- 另:宿舍房间表标记(判定树②唯一判据,BILL-DERIVE-SPEC §6.1 定案加列)与账外户标(§6.8 定案)。

CREATE TABLE bill_notice (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ym             CHAR(7)     NOT NULL,
  tenant_id      INT UNSIGNED NOT NULL,
  pay_company_id INT UNSIGNED NULL COMMENT '收款主体;拆单键',
  notice_kind    VARCHAR(12) NOT NULL DEFAULT 'combined' COMMENT 'combined合一单/fee水电费单/maint维护费单/dorm宿舍单/offbook账外单(不入应收)',
  premise_text   VARCHAR(255) NULL COMMENT '位置原文,多场地逗号连接',
  total_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
  prev_due       DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '上期欠费;催缴闭环接口点,S4 先留 0',
  status         VARCHAR(12) NOT NULL DEFAULT 'draft' COMMENT 'draft/issued/void;issued 不可被重跑覆盖',
  warn           VARCHAR(255) NULL COMMENT '门禁警告:例外未录/表未归属降级/本期为负',
  gen_batch      VARCHAR(32)  NULL COMMENT '派生批次;重跑幂等键(先删 draft 后插)',
  generated_at   DATETIME    NOT NULL,
  UNIQUE KEY uk_notice (ym, tenant_id, pay_company_id, notice_kind),
  KEY idx_notice_ym (ym),
  CONSTRAINT fk_notice_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
) COMMENT='催缴单单头,一户一单(拆票则一户多单)';

CREATE TABLE bill_notice_line (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  notice_id    INT UNSIGNED NOT NULL,
  line_no      SMALLINT UNSIGNED NOT NULL,
  fee_key      VARCHAR(32) NOT NULL COMMENT 'elec/mgmt_fee/capacity/water/water_pipe/share_elec_*/share_green_water(沿用 alloc_result 词汇,BillFeeMap 映射收款主体)',
  premise      VARCHAR(64)  NULL COMMENT '场地段(A座602室);多场地租户分段小计用',
  meter_id     INT UNSIGNED NULL COMMENT '来源表;公摊/容量费行为 NULL',
  meter_label  VARCHAR(16)  NULL COMMENT '展示用「电表①」= meter.sub_name 或顺位补号(不回写档案)',
  contract_id  INT UNSIGNED NULL COMMENT '出账时表→合同归属快照(resolveBinding 命中);无FK,纯审计快照',
  seg          VARCHAR(8)   NULL COMMENT 'sharp/peak/flat/valley;单一价表 NULL',
  prev_read    DECIMAL(14,2) NULL,
  curr_read    DECIMAL(14,2) NULL,
  factor_snap  DECIMAL(10,2) NULL,
  qty          DECIMAL(14,2) NULL COMMENT '实际用量/吨/㎡',
  price_snap   DECIMAL(14,8) NULL COMMENT '实收单价快照(尖段按峰价时存峰价)',
  price_key    VARCHAR(32)   NULL COMMENT '取价用的 cfg_key',
  price_scope  VARCHAR(32)   NULL COMMENT '命中的 scope: tenant:{id}/p1/p2/dorm/'''' ← 事后审计「为什么按商业价」',
  price_month  CHAR(7)       NULL COMMENT '命中的价目版本生效月(常数键可能早于本月)',
  rule_branch  VARCHAR(16)   NULL COMMENT '判定分支: tou/resident/commercial/tenant_override/pool/fixed',
  pool_rule_id INT UNSIGNED  NULL COMMENT '公摊行来源池(alloc_rule.id)',
  share_src    VARCHAR(16)  NULL COMMENT '公摊份额来源: member/area/floor/auto;快照当时的解析路径',
  base_snap    DECIMAL(14,2) NULL COMMENT '该户份额基数快照(层数/面积/weight)',
  amount       DECIMAL(14,2) NOT NULL COMMENT '允许负值(读数回退/跨户转供冲减,历史册直接开负数单)',
  note         VARCHAR(255)  NULL,
  UNIQUE KEY uk_line (notice_id, line_no),
  CONSTRAINT fk_line_notice FOREIGN KEY (notice_id) REFERENCES bill_notice(id) ON DELETE CASCADE,
  CONSTRAINT fk_line_meter  FOREIGN KEY (meter_id)  REFERENCES meter(id)
) COMMENT='催缴单明细行;price_scope+price_month+rule_branch 构成取价审计链';

ALTER TABLE meter
  ADD COLUMN is_dorm_room TINYINT NOT NULL DEFAULT 0 COMMENT '宿舍房间表(房号计费分间);判定树②居民价/水3.85 的唯一判据,建档时定死不在派生时猜';

ALTER TABLE tenant
  ADD COLUMN offbook TINYINT NOT NULL DEFAULT 0 COMMENT '账外户:出单但不入应收(notice_kind=offbook);翔海/工程队宿舍等 10 个账外 sheet';
