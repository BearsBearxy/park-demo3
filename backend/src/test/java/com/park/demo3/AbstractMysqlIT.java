package com.park.demo3;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;

// ponytail: no @Testcontainers/@Container — singleton start keeps the container alive
//           across all test classes in one JVM run; Ryuk cleans it at JVM exit.
//           Per-class @Container would stop MYSQL after WebLayerIT, breaking AuthIT.
@SpringBootTest
public abstract class AbstractMysqlIT {
    // ponytail: 600s timeout for Docker Desktop/WSL2 Windows where MySQL 8.0
    //           first-run init can take 4-5 min; reduce if environment is faster
    //
    // withReuse:容器跑完不销毁,下次 JVM 起来直接连上去。没有它,每次 mvnw test 都要
    // 「新起空库 + 跑完 V1..V112 迁移 + 塞种子」才轮到第一条断言 —— 实测跑 1 个测试方法
    // 与跑全量 766 条同样要 8-9 分钟,代价几乎全在这段启动上。开了之后首次照旧、之后十几秒。
    //
    // ⚠ 代价:库的状态会在多次运行之间留下来。没有 @Transactional、靠自己清理的用例
    //    (LedgerApiIT 等)若某次跑到一半失败留下残渣,下次可能红 —— 「单独跑绿、连着跑红」。
    //    真遇到就给那个类补 @Transactional,别把这个开关关掉。
    // ⚠ 开关在本机 ~/.testcontainers.properties 的 testcontainers.reuse.enable=true,
    //    **不进仓库**:CI 每次都该是全新库,不该复用。那边没这行,withReuse 自动降级为不复用。
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
            .withDatabaseName("park_demo3")
            .withStartupTimeoutSeconds(600)
            .withReuse(true);

    static {
        MYSQL.start();
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", MYSQL::getJdbcUrl);
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
        r.add("app.jwt.secret", () -> "test-secret-test-secret-test-secret-32");
        // 钉死只读账号口令:RoleApiIT 硬编码 viewer123,不受宿主机 VIEWER_PASSWORD 环境变量影响
        r.add("app.viewer.password", () -> "viewer123");
    }
}
