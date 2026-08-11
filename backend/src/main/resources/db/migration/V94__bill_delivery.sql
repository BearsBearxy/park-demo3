-- V94__bill_delivery.sql — 催缴单交付链(S20-BILL-DELIVERY-SPEC §1)：收款账户 / 确认状态。
-- 全部新列可空或带默认，零数据迁移：现有 6 家公司 full_name=NULL(展示回落 name)、status=1(启用)；
-- 现有 bill_notice 三个时间列 NULL(未确认未导出)。

ALTER TABLE management_company
  ADD COLUMN full_name VARCHAR(128) NULL COMMENT '法定全称,印在通知单落款与账户块;空则回落 name',
  ADD COLUMN status TINYINT NOT NULL DEFAULT 1 COMMENT '1=启用 0=停用(停用不再出现在收款公司选择器,历史单不受影响)';

-- 一公司多收款账户(对公银行/微信/支付宝/个人卡)。字段除 kind 外全部可空 —— 建表即用,用户逐条补录。
-- is_default 同公司唯一由 CompanyService 维护(设新默认时清旧),不用 DB 约束:
-- MySQL 无部分唯一索引,uk(company_id,is_default) 会连带禁止同公司出现两个非默认账户。
-- 公司删除走级联(CompanyService.delete 已是级联语义,账户不该拦住 deleteById)。
CREATE TABLE company_account (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id   INT UNSIGNED NOT NULL,
  kind         VARCHAR(12)  NOT NULL COMMENT 'bank对公银行/wechat/alipay/personal个人卡/other',
  account_name VARCHAR(64)  NULL COMMENT '户名(对公=公司全称,个人=收款人姓名)',
  account_no   VARCHAR(64)  NULL COMMENT '账号/收款码标识',
  bank_name    VARCHAR(128) NULL COMMENT '开户行(bank/personal 用;wechat/alipay 留空)',
  is_default   TINYINT      NOT NULL DEFAULT 0 COMMENT '该公司默认收款账户(导出时预选)',
  sort_no      SMALLINT     NOT NULL DEFAULT 0,
  remark       VARCHAR(255) NULL COMMENT '备注(如「仅限水电费」)',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_company_account (company_id),
  CONSTRAINT fk_company_account FOREIGN KEY (company_id) REFERENCES management_company(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='公司收款账户;导出通知单账户块取默认';

-- 状态机 draft→confirmed→exported 复用现有 status 列(值域扩展),这里只加三个留痕列。
ALTER TABLE bill_notice
  ADD COLUMN confirmed_at DATETIME    NULL COMMENT '点「确认无误」的时间',
  ADD COLUMN confirmed_by VARCHAR(64) NULL COMMENT '确认人登录名',
  ADD COLUMN exported_at  DATETIME    NULL COMMENT '最近一次导出时间';
