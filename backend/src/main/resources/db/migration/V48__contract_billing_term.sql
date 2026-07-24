-- V48__contract_billing_term.sql — 合同计费条款(BILL-FORWARD-SPEC 第1刀 §1.1)。
-- 独立子表挂合同,不改 contract 宽表(V33 面积模型原样不动)。删合同 FK 级联删条款。
-- 无自然唯一键:同合同同费项可多行(一户多房间);幂等在导入层(整组替换 source='import',manual 保留)。
CREATE TABLE contract_billing_term (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id INT UNSIGNED NOT NULL,                 -- FK contract(id) ON DELETE CASCADE
  fee_key     VARCHAR(32) NULL,                      -- 费项标准键=附表10 colId(sales-income/layout.ts leaves);映射不上留 NULL 待核
  fee_name    VARCHAR(64) NOT NULL,                  -- 费项原文(厂房租金/企业管理服务费/电梯维护费…)
  bill_mode   VARCHAR(16) NOT NULL,                  -- per_sqm_month(元/㎡/月) | per_month(元/月固定额) | per_kva_month(元/KVA/月,本刀仅建模)
  unit_price  DECIMAL(12,4) NOT NULL,                -- 单价,含税口径(=应收口径);per_month=固定月额
  area        DECIMAL(12,2) NULL,                    -- 计费面积(取自 sheet,独立于合同面积,§1.4 差异标警不覆盖)
  coeff       DECIMAL(8,4)  NOT NULL DEFAULT 1,      -- 系数(旭化成类 1.56;金额=面积×单价×系数)
  tax_rate    DECIMAL(6,4)  NULL,                    -- 税率(李李 0.128);不含税价放 params
  params      JSON NULL,                             -- 扩展:梯层数/KVA容量/用电类型/房号/不含税单价/原文文本等
  note        VARCHAR(255) NULL,
  source      VARCHAR(16) NOT NULL DEFAULT 'manual', -- import | manual
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cbt_contract (contract_id),
  CONSTRAINT fk_cbt_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
