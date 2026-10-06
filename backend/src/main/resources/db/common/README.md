# db/common —— V138 起的所有新迁移写在这里

2026-10-04 用户拍板：产品卖给别的园区，每个园区一个库。迁移从此分两条链，共用这个目录：

| 链 | spring.flyway.locations（环境变量 `FLYWAY_LOCATIONS`） | 谁用 |
|---|---|---|
| 老链 | `classpath:db/migration,classpath:db/common`（application.yml 默认值，不用设） | 我园生产、开发库、全部测试 |
| 起点链 | `classpath:db/baseline,classpath:db/common` | 新园区（空库起步） |

所以这里的脚本**两条链都会跑**，要求：

- 版本号从 **V138** 起往上排（`MigrationLayoutTest` 会查：这里不许出现 ≤ V137 的文件）。
- 只写表结构和每个园区都要的通用行（权限、内置角色、字典……）。**不许写任何园区的数据**：
  楼栋、租户、电表、单价、公摊池、台账……新园区的库客户能整个读到。
  只修我园存量数据的一次性脚本放 `backend/scripts/fixes/`，在我园库上手动跑，不进迁移。
- 回填类 UPDATE 要在空库上是空操作（新园区跑到它时表是空的）。
- 不要再往 `db/migration` 里加文件，那个目录已冻结在 V137。
