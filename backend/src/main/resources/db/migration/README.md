# db/migration —— 老链，冻结在 V137

这里的 V1–V137（外加 `src/main/java/db/migration/V35__Bill_pay_company_seed.java`）是我园生产一路跑过来的迁移，
里面混着我园的真实数据（楼栋、租户、电表、公摊池、单价、台账、工资、报表、管理员显示名）。

2026-10-04 用户拍板：我园生产继续用这条链，脚本、Flyway 历史、数据都不动；新园区不跑它，
从 `db/baseline/V137__baseline.sql`（只有表结构 + 通用行）起步。

- **不要改这里任何文件**：生产库和共享测试库都记着它们的校验和，改一个字节启动就校验失败。
- **不要往这里加新文件**：V138 起写在 `db/common`（两条链共用）。`MigrationLayoutTest` 会查。
