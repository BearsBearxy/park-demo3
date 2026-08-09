-- V91: 计费行↔单元多对多绑定(跨楼层公摊修缮的前置数据工程,2026-08-09)。
--      背景:area 池取面积只按楼栋分桶(AllocService.areaByBuildingTenant),同栋跨层租户被多收
--      (2024-02 实测:陈相钊+27.49/宏玥+21.11/优唯特+11.09/双成+1.28);楼层级面积只存在于
--      计费行 location 自由文本。contract_unit(V58)是合同级绑定,粒度不够——一份合同的两行
--      计费行可以在不同楼层(陈相钊:二楼462.87㎡+三楼2000㎡),必须绑到行。
--      数据回填不在本迁移(dev 库存量数据,走 backend/scripts/fixes/bt-unit-bind-20260809.sql,
--      推导器 scripts/derive_bt_unit_bind.py);本迁移只建表,幂等(dev 已手工预建同结构)。
CREATE TABLE IF NOT EXISTS billing_term_unit (
  id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  term_id INT UNSIGNED NOT NULL,
  unit_id INT UNSIGNED NOT NULL,
  source  VARCHAR(16) NOT NULL DEFAULT 'derived' COMMENT 'derived=位置文本推导|manual=人工指认',
  PRIMARY KEY (id),
  UNIQUE KEY uk_btu (term_id, unit_id),
  KEY idx_btu_unit (unit_id),
  CONSTRAINT fk_btu_term FOREIGN KEY (term_id) REFERENCES contract_billing_term(id) ON DELETE CASCADE,
  CONSTRAINT fk_btu_unit FOREIGN KEY (unit_id) REFERENCES unit(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='计费行绑定单元(楼层级面积口径的数据基础;行级,比 contract_unit 细)'
