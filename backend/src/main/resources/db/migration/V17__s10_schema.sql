-- 附表10(销售收入) · 稀疏宽表:一行 = (期 × 记账月 × 租户) 的逐租户总收款条目。
-- 每行 25 个费用列(office ∪ factory 叶子并集),tenant_id 软引用真实租户(无 FK),tenant_name 兜底显示/配平。
-- 派生(行合计/列合计/总计)绝不落库:后端/前端按列即时算。

CREATE TABLE s10_record (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  tenant_id    INT NULL,                          -- 软引用真实租户,无 FK 约束
  tenant_name  VARCHAR(64) NOT NULL,              -- 显示与配平按名匹配兜底
  phase        TINYINT NOT NULL,                  -- 1 一期 / 2 二期 / 3 三期 / 4 宿舍
  acct_month   CHAR(7) NOT NULL,                  -- YYYY-MM 记账月
  profile      VARCHAR(16) NOT NULL,              -- office/factory/shop/dorm/land/guarantee(仅 UI 列门控)
  note         VARCHAR(255) NULL,
  source       VARCHAR(16) NOT NULL DEFAULT 'manual',  -- seed / manual / import

  -- 25 个费用列(顺序即列展示顺序)
  office_rent       DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 办公室租金
  office_mgmt_fee   DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 办公室企业管理服务费
  factory_rent      DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 厂房租金
  factory_mgmt_fee  DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 厂房企业管理服务费
  land_rent         DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 空地租金
  shop_rent         DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 商铺租金
  shop_mgmt_fee     DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 商铺企业管理服务费
  dorm_rent         DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 宿舍租金
  dorm_facility_fee DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 宿舍配套设施费
  infra_office      DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 办公室基础设施维护费
  infra_factory     DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 厂房基础设施维护费
  infra_shop        DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 商铺基础设施维护费
  infra_dorm        DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 宿舍基础设施维护费
  elevator_maint    DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 电梯维护费
  transformer_maint DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 变压器维护费
  land_use_tax      DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 土地使用税
  network_fee       DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 网络通讯费
  access_maint      DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 门禁设施维护费
  other_fee         DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 其他费用
  elec_basic        DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 基本用电费
  elec_std          DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 基准电费
  elec_maint        DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 电维护费
  water_std         DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 基准水费
  water_maint       DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 水维护费
  guarantee_rent    DECIMAL(14,2) NOT NULL DEFAULT 0,  -- 保障房租金

  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_s10 (phase, acct_month, tenant_name),
  KEY idx_s10_slot (phase, acct_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
