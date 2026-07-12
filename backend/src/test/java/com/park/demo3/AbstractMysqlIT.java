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
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
            .withDatabaseName("park_demo3")
            .withStartupTimeoutSeconds(600);

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
