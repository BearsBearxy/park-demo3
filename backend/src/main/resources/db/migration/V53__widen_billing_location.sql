-- V53__widen_billing_location.sql — 加宽计费行 location 列。
-- 真实月度租金册的「位置」列会写整段房号清单(如「宿舍楼 30间宿舍(309、310、…528室)」达 131 字),
-- VARCHAR(64) 触发 MysqlDataTruncation;因 importBillingLines @Transactional,单行截断异常逃出行级 try
-- 直接回滚整批(115 户全导失败)。加宽到 255 治根:真实 location 全量入库,不静默截断、不整批拦。
ALTER TABLE contract_billing_term MODIFY location VARCHAR(255) NULL;
