-- offbook-roster.sql — V89 新列 tenant.offbook 回填(账外户:出单不入应收)。2026-08-05。⚠只起草待人工核对后执行。
-- 依据:S4-BILL-NOTICE-SPEC 行15/52、BILL-DERIVE-SPEC §6.8、P1-UTILITY-FEE-STRUCTURE §2.8:
--   不入应收总表的 10 个 sheet = 翔海、工程队宿舍×3(本体/陈道文/朱锐)、个人宿舍(龙二明)、
--   王伍平宿舍、速新宿舍(2023-11~12 补单混册)、幸悦、詹凯乔、顺心鸿。
--   ⚠公交车站(佛广公汽)**入**总表,不在名单。
-- 前置:V89__bill_notice.sql 已应用。幂等:先清零再置 1。
--
-- 名称→tenant.id 匹配实证(2026-08-05 dev 库,含 aliases 通道均查过):
--   翔海=265 / 个人宿舍=308 / 幸悦=367(status=0 停用,照标) / 顺心鸿=370(status=0,照标) /
--   王伍平=382 / 曾回文（工程队）=385 / 工程队宿舍（朱锐）=388 / 詹凯乔=391
--
-- ── 待核清单(匹配不到/存疑,不写库)──────────────────────────────────────
-- ① 工程队宿舍（陈道文）:库中无「陈道文」任何形态(company_name/aliases 均无)。
-- ② 速新宿舍:库中无「速新」任何形态。①②要么未建档、要么另名建档,待人工指认后补 UPDATE 或先补别名。
-- ③ 曾回文（工程队）=385:册内 sheet 名是「工程队宿舍」(无人名),库档挂的是曾回文——
--    本脚本按「(工程队)」字样认定为工程队宿舍本体照标,若实为第 4 个工程队户需user确认。
-- ──────────────────────────────────────────────────────────────────────

-- 【0】清零(幂等基线)
UPDATE tenant SET offbook = 0 WHERE offbook <> 0;

-- 【1】按名称精确匹配置 1。护栏:IN 精确名单,匹配不到该名则该行自然不生效;
--     不用 LIKE 防误伤(如「王伍平」不可写 LIKE 以免将来同姓户误中)。
UPDATE tenant SET offbook = 1
WHERE company_name IN (
  '翔海',
  '个人宿舍',
  '幸悦',
  '顺心鸿',
  '王伍平',
  '曾回文（工程队）',
  '工程队宿舍（朱锐）',
  '詹凯乔'
);

-- ── 验证(预期锚点)───────────────────────────────────────────────────
-- v1: 置1总数 = 8(名单10 sheet − 陈道文/速新 2 个待核)
SELECT COUNT(*) AS offbook_cnt, IF(COUNT(*) = 8, 'OK', 'MISMATCH') AS verdict
FROM tenant WHERE offbook = 1;

-- v2: 逐户回显(人工过目 id 与实证一致:265/308/367/370/382/385/388/391)
SELECT id, company_name, aliases, status, offbook FROM tenant WHERE offbook = 1 ORDER BY id;

-- v3: 公交车站不得被标(入总表),预期 0 行
SELECT id, company_name FROM tenant WHERE offbook = 1 AND company_name LIKE '%公交%';
