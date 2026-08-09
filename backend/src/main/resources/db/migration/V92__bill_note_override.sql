-- V92__bill_note_override.sql — 催缴单备注人工覆盖(用户报障:引擎备注写死无法修改)。
-- 催缴单先删后插重生成,备注若落 bill_notice_line 每次重跑就没了 → 独立表挂业务键,重生成天然存活。
-- 键=(ym,tenant_id,fee_key,premise_key,meter_key,seg_key):普通行 meter_key=meter_id 字符串、
-- seg_key=尖峰平谷段;合并行(纸单口径多池/多表合一行)meter_key='merged'。
-- 键列用空串不用 NULL:MySQL unique 索引对 NULL 不去重,NULL 键会攒重复行。
-- 显示优先级=人工覆盖 > 引擎备注;DELETE 该键=恢复引擎默认。created/updated 由 DB 维护,实体不映射。
CREATE TABLE bill_note_override (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ym          CHAR(7)      NOT NULL,
  tenant_id   INT UNSIGNED NOT NULL,
  fee_key     VARCHAR(32)  NOT NULL,
  premise_key VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '行 premise 原文;无场地行空串',
  meter_key   VARCHAR(16)  NOT NULL DEFAULT '' COMMENT 'meter_id 字符串;合并行=merged;无表行空串',
  seg_key     VARCHAR(8)   NOT NULL DEFAULT '' COMMENT 'sharp/peak/flat/valley;非分时行空串',
  note        VARCHAR(255) NOT NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_note_override (ym, tenant_id, fee_key, premise_key, meter_key, seg_key),
  CONSTRAINT fk_note_override_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE
) COMMENT='催缴单备注人工覆盖;独立于 bill_notice_line,重生成(先删后插)不丢';
