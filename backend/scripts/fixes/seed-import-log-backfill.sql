-- 种子批次导入日志追溯补录(2026-08-03)。
-- 背景:2026-07-21 P-A 园区抄表落地时,建档批次(15:19)与 2024-05 读数批次(16:42)未落 import_log,
-- 源文件又躺在名不副实的「2024年3月费用数据」文件夹 —— 已造成两次考古:
--   ①南盛物流 428 室"幽灵行"案(2026-08-02);②吉罗德 1-213"明明没导却有"案(2026-08-03)。
-- 补录让导入中心可见这批数据的来历;created_at 用批次真实时间,status=backfill 注明追溯。
SET NAMES utf8mb4;
INSERT INTO import_log (data_type, type_label, file_name, target, `rows`, ok, warn, status, operator, created_at) VALUES
  ('meter', '园区抄表', '202405水电表数据表.xlsx(建档种子·追溯补录)', '全区 1134 块表建档,企业名称/位置原文为 2024-05 版快照', 1134, 1134, 0, 'success', '(系统种子)', '2026-07-21 15:19:46'),
  ('meter', '园区抄表', '202405水电表数据表.xlsx(2024-05 读数种子·追溯补录)', '2024-05 全月读数 1134 条', 1134, 1134, 0, 'success', '(系统种子)', '2026-07-21 16:42:37');
SELECT id, file_name, rows, created_at FROM import_log WHERE file_name LIKE '%追溯补录%';
