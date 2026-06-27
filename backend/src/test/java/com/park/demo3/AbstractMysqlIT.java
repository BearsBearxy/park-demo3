package com.park.demo3;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@Testcontainers
public abstract class AbstractMysqlIT {
    @Container
    // ponytail: 600s timeout for Docker Desktop/WSL2 Windows where MySQL 8.0
    //           first-run init can take 4-5 min; reduce if environment is faster
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
            .withDatabaseName("park_demo3")
            .withStartupTimeoutSeconds(600);

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", MYSQL::getJdbcUrl);
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
        r.add("app.jwt.secret", () -> "test-secret-test-secret-test-secret-32");
    }
}
