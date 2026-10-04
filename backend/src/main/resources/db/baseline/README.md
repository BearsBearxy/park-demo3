# db/baseline —— 新园区的起点（空库起步）

2026-10-04 用户拍板：产品卖给别的园区，程序跑在我们的服务器上，每个园区一个自己的库，客户能读到库里的一切。
所以新园区的库不能跑老链 `db/migration`（里面混着我园的楼栋、租户、电表、单价、台账、工资……），
而是从这里唯一的一份 `V137__baseline.sql` 起步，再接 `db/common` 里 V138 起的迁移。

## 里面有什么

- 老链 V1–V137 迁到底之后的**全部表结构**（表、列、索引、外键，字符集/排序规则照抄；去掉了 `AUTO_INCREMENT=n`）。
  列注释里写着我园楼名、租户名、单价、源册单元格的，换成了中性说明（只改说明文字，不改列定义）。
- **每个园区都要的通用行**，其余每张表都是空的：

  | 表 | 行数 | 内容 |
  |---|---|---|
  | auth_role | 7 | 内置角色（系统管理员、财务主管、财务专员、总经理、园区股东、只读账号、审核员），备注是 V134–V136 改完的最终版 |
  | auth_role_perm | 91 | 内置角色的权限点，V101–V137 累计的最终状态 |
  | auth_user | 1 | admin，种子口令 admin123，显示名「管理员」 |
  | auth_user_role | 1 | admin → 系统管理员 |
  | alloc_cfg | 5 | 光伏分栋分析的判据线默认值（月抄表覆盖率、台账差、年等效比、正常范围半宽、连续刻度数） |

  不带：年等效小时锚点 `pv_yield_anchor_h`（按我园所在地实测调的）、全部单价/口径/楼栋·电表·公摊池参数、
  光伏/电费/充电的期别与运营商字典、管理公司、附表10 册（册由启动时的 BookSeeder 建）。

## 怎么生成（不要手改）

由 `backend/src/test/java/com/park/demo3/BaselineSqlGenerator.java` 生成：在共享 Testcontainers MySQL 里建临时库、
用老链迁到底、逐表 `SHOW CREATE TABLE` + 导出通用行，写到这里，删临时库。

```bash
cd backend && ./mvnw -q test -Dtest=BaselineSqlGenerator          # 重新生成(老链在 Windows Docker 上迁一遍约 6 分钟)
./mvnw -q test -Dtest=MigrationLayoutTest,BaselineChainIT,BaselineBootIT   # 确认两条链等价、新库干净、应用起得来
```

要带哪些通用行、换哪些注释，改生成器里的 `GENERIC` / `VALUE_OVERRIDE` / `COMMENT_OVERRIDE` 再重跑。

## 守卫

- `MigrationLayoutTest`：这里只能有 `V137__baseline.sql`；老链不许超过 V137；`db/common` 只许 > V137（子目录也查）；生产默认仍是老链；
  gen-env 生成的 `.env` 走起点链；已发出去的脚本钉了 Flyway 校验和（`src/test/resources/baseline/migration-checksums.txt`，只许加行）。
- `FlywayChainGuard`（运行时）：空库遇到老链拒绝启动；`FLYWAY_LOCATIONS` 只认两条链。
- `BaselineChainIT`：老链与起点链迁出来的表结构（不比注释）一致、通用行一致；起点链上除通用行外每张表为空，
  任何文本列和注释里没有我园真名（清单在 `src/test/resources/baseline/real-names.txt`，只在测试里）。
- `BaselineBootIT`：按部署指南设 `FLYWAY_LOCATIONS` + `ADMIN_PASSWORD` 起空库，admin 登录后核心各屏读接口全 200；
  起完再扫一遍全库真名（启动时 BookSeeder 会往库里写附表10 册，Flyway 拆链管不到）。

## 已上线的新园区

库里的 Flyway 历史只有一行 V137（baseline），之后接 V138+。**这份文件一旦有园区跑过就不能再改**
（校验和对不上，启动失败），和老链的规矩一样；要变就在 `db/common` 加新迁移。
