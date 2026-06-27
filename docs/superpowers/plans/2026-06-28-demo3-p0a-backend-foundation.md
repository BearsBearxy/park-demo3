# demo3 P0-A 后端地基 + 试点 API 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起 demo3 工程化 Spring Boot 后端地基，并交付楼栋/租户/合同的只读派生聚合 API（楼栋/租户两屏的全栈后端）。

**Architecture:** 分层 `controller → service → mapper(MyBatis-Plus) → entity`，外加 `common/config/security/dto`。横切一次到位：统一 `Result<T>` 返回（ResponseBodyAdvice 自动包裹）、全局异常、TraceId(MDC)、Spring Security + JWT、Flyway 版本化迁移、Actuator、OpenAPI。派生值（出租率/在租面积/月租金/占用状态）一律 service 层按口径实时算，**绝不落列**。

**Tech Stack:** Java 17 · Spring Boot 3.3.5 · Maven（项目内 `./mvnw` wrapper）· MyBatis-Plus 3.5.7（boot3 starter）· Flyway 10（flyway-mysql）· MySQL 8 · Spring Security 6 · jjwt 0.12.6 · MapStruct 1.6.3 · Lombok · springdoc-openapi 2.6.0 · JUnit5 + Mockito + Testcontainers 1.20。

## Global Constraints

- Java 17；Spring Boot 3.3.5；Maven；包根 `com.park.demo3`。
- 构建工具链：本机仅 JDK 17（无 mvn on PATH，Docker 可用）。统一用项目内 `./mvnw`（Maven Wrapper 已生成于 `backend/`）构建/测试；首次运行自动下载 Maven 3.9.9。Testcontainers ITs 依赖本机 Docker（可用）。
- 所有 HTTP 成功响应统一为 `Result<T>{code,message,data,traceId}`（`code==0` 为成功）；异常经全局处理器映射为 `Result`。
- 数据库 MySQL 8，字符集 `utf8mb4_0900_ai_ci`；迁移仅经 Flyway（`classpath:db/migration`），手工不改库结构。
- 鉴权 Spring Security + JWT，单用户基线，**无 RBAC**；口令 BCrypt；JWT 密钥从环境读，长度 <32 字符或缺失则 **fail-fast**；`/api/auth/login`、`/actuator/**`、OpenAPI 路径放行，其余 `/api/**` 需 Bearer。
- **派生值绝不落列**：出租率/在租面积/月租金/占用状态/单元数/各 KPI 均在 service 层按口径计算。
- 出租率口径：`occRate = round(leasedArea/rentableArea*1000)/10`，封顶 100，`building.status==0`（停用）记 0；`leasedArea` = 单元派生状态 ∈ {occupied, expiring, reserved} 的面积之和；分母 `rentable_area`。
- 单元占用派生：单元的"当前合同" = 该单元 `status ∈ {active,expiring,draft}` 的合同；映射 `active→occupied`、`expiring→expiring`、`draft→reserved`、无→`vacant`。
- 状态枚举：building.status {1 正常,0 停用}；tenant.status {1 在租,2 退租,0 黑名单}；contract.status {active|expiring|draft|expired|terminated}。
- 敏感字段（password/token）不落日志。
- 提交信息结尾署名：`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`；在 demo3 仓库的 `feature/p0a-backend` 分支提交。

---

## File Structure

```
backend/
├─ pom.xml
├─ src/main/java/com/park/demo3/
│  ├─ Demo3Application.java
│  ├─ common/
│  │  ├─ Result.java              统一返回体（record）
│  │  ├─ ResultCode.java          业务码枚举
│  │  ├─ BizException.java        业务异常
│  │  ├─ GlobalExceptionHandler.java
│  │  ├─ ResponseWrapAdvice.java  ResponseBodyAdvice 自动包裹
│  │  └─ TraceIdFilter.java       MDC traceId
│  ├─ config/
│  │  ├─ MyBatisPlusConfig.java   MetaObjectHandler（created_at/updated_at 自动填充）
│  │  ├─ CorsConfig.java
│  │  └─ OpenApiConfig.java
│  ├─ security/
│  │  ├─ JwtUtil.java
│  │  ├─ JwtAuthFilter.java
│  │  └─ SecurityConfig.java
│  ├─ entity/   Building, Unit, Tenant, TenantCategory, Contract, AuthUser
│  ├─ mapper/   *Mapper extends BaseMapper
│  ├─ dto/      LoginReq, LoginResp, BuildingDTO, BuildingDetailDTO, BuildingSummaryDTO,
│  │            TenantDTO, TenantDetailDTO, TenantSummaryDTO, UnitDTO, ContractDTO, TenantCategoryDTO
│  ├─ service/  AuthService, BuildingService, TenantService, (DerivationSupport helper)
│  └─ controller/ AuthController, BuildingController, TenantController, TenantCategoryController
├─ src/main/resources/
│  ├─ application.yml + application-dev.yml + application-prod.yml
│  └─ db/migration/ V1__schema.sql, V2__seed.sql
└─ src/test/java/com/park/demo3/
   ├─ AbstractMysqlIT.java        Testcontainers 基类
   ├─ Demo3ApplicationTests.java  上下文+Flyway 冒烟
   ├─ common/WebLayerIT.java
   ├─ security/AuthIT.java
   ├─ service/BuildingServiceTest.java（派生口径单测，mock mapper）
   └─ service/TenantServiceTest.java
```

---

### Task 1: Maven 脚手架 + 应用启动 + Flyway 建表（Testcontainers 冒烟）

**Files:**
- Create: `backend/pom.xml`
- Create: `backend/src/main/java/com/park/demo3/Demo3Application.java`
- Create: `backend/src/main/resources/application.yml`, `application-dev.yml`, `application-prod.yml`
- Create: `backend/src/main/resources/db/migration/V1__schema.sql`
- Create: `backend/src/test/java/com/park/demo3/AbstractMysqlIT.java`
- Test: `backend/src/test/java/com/park/demo3/Demo3ApplicationTests.java`

**Interfaces:**
- Produces: 可启动的 Spring Boot 应用；Flyway 在启动时建好 7 张表；`AbstractMysqlIT`（提供 Testcontainers MySQL 的 `@SpringBootTest` 基类，后续 IT 继承）。

- [ ] **Step 1: 写 pom.xml**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.5</version>
    <relativePath/>
  </parent>
  <groupId>com.park</groupId>
  <artifactId>demo3-backend</artifactId>
  <version>0.0.1</version>
  <properties>
    <java.version>17</java.version>
    <mybatis-plus.version>3.5.7</mybatis-plus.version>
    <mapstruct.version>1.6.3</mapstruct.version>
    <jjwt.version>0.12.6</jjwt.version>
    <springdoc.version>2.6.0</springdoc.version>
  </properties>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-validation</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-security</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-actuator</artifactId></dependency>
    <dependency><groupId>com.baomidou</groupId><artifactId>mybatis-plus-spring-boot3-starter</artifactId><version>${mybatis-plus.version}</version></dependency>
    <dependency><groupId>org.flywaydb</groupId><artifactId>flyway-core</artifactId></dependency>
    <dependency><groupId>org.flywaydb</groupId><artifactId>flyway-mysql</artifactId></dependency>
    <dependency><groupId>com.mysql</groupId><artifactId>mysql-connector-j</artifactId><scope>runtime</scope></dependency>
    <dependency><groupId>io.jsonwebtoken</groupId><artifactId>jjwt-api</artifactId><version>${jjwt.version}</version></dependency>
    <dependency><groupId>io.jsonwebtoken</groupId><artifactId>jjwt-impl</artifactId><version>${jjwt.version}</version><scope>runtime</scope></dependency>
    <dependency><groupId>io.jsonwebtoken</groupId><artifactId>jjwt-jackson</artifactId><version>${jjwt.version}</version><scope>runtime</scope></dependency>
    <dependency><groupId>org.mapstruct</groupId><artifactId>mapstruct</artifactId><version>${mapstruct.version}</version></dependency>
    <dependency><groupId>org.projectlombok</groupId><artifactId>lombok</artifactId><optional>true</optional></dependency>
    <dependency><groupId>org.springdoc</groupId><artifactId>springdoc-openapi-starter-webmvc-ui</artifactId><version>${springdoc.version}</version></dependency>
    <!-- test -->
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
    <dependency><groupId>org.springframework.security</groupId><artifactId>spring-security-test</artifactId><scope>test</scope></dependency>
    <dependency><groupId>org.testcontainers</groupId><artifactId>mysql</artifactId><scope>test</scope></dependency>
    <dependency><groupId>org.testcontainers</groupId><artifactId>junit-jupiter</artifactId><scope>test</scope></dependency>
  </dependencies>
  <dependencyManagement>
    <dependencies>
      <dependency><groupId>org.testcontainers</groupId><artifactId>testcontainers-bom</artifactId><version>1.20.3</version><type>pom</type><scope>import</scope></dependency>
    </dependencies>
  </dependencyManagement>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
        <configuration><excludes><exclude><groupId>org.projectlombok</groupId><artifactId>lombok</artifactId></exclude></excludes></configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <configuration>
          <annotationProcessorPaths>
            <path><groupId>org.projectlombok</groupId><artifactId>lombok</artifactId><version>${lombok.version}</version></path>
            <path><groupId>org.mapstruct</groupId><artifactId>mapstruct-processor</artifactId><version>${mapstruct.version}</version></path>
            <path><groupId>org.projectlombok</groupId><artifactId>lombok-mapstruct-binding</artifactId><version>0.2.0</version></path>
          </annotationProcessorPaths>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
```

- [ ] **Step 2: 写主类与配置**

`Demo3Application.java`:
```java
package com.park.demo3;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.park.demo3.mapper")
public class Demo3Application {
    public static void main(String[] args) {
        SpringApplication.run(Demo3Application.class, args);
    }
}
```

`application.yml`:
```yaml
server:
  port: 8080
spring:
  application:
    name: demo3-backend
  profiles:
    active: ${SPRING_PROFILES_ACTIVE:dev}
  datasource:
    url: jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}/${DB_NAME:park_demo3}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=false
    username: ${DB_USER:root}
    password: ${DB_PASSWORD:root}
    driver-class-name: com.mysql.cj.jdbc.Driver
  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: false
mybatis-plus:
  configuration:
    map-underscore-to-camel-case: true
app:
  jwt:
    secret: ${JWT_SECRET:dev-only-insecure-secret-change-me-32+chars}
    expire-minutes: ${JWT_EXPIRE_MINUTES:720}
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      show-details: always
logging:
  level:
    com.park.demo3: INFO
```

`application-dev.yml`: `{}`（空占位，dev 默认值已在主配置）。
`application-prod.yml`:
```yaml
app:
  jwt:
    secret: ${JWT_SECRET}   # prod 必须由环境提供，缺失即 fail-fast（JwtUtil 校验）
```

- [ ] **Step 3: 写 V1 schema 迁移**

`db/migration/V1__schema.sql`:
```sql
CREATE TABLE tenant_category (
  id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(32) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_tc_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE building (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(64) NOT NULL,
  phase         TINYINT UNSIGNED NOT NULL,
  floor_count   TINYINT UNSIGNED NOT NULL,
  total_area    DECIMAL(10,2) NOT NULL,
  rentable_area DECIMAL(10,2) NOT NULL,
  status        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  per_floor     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  remark        VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_building_name (name),
  KEY idx_building_phase (phase), KEY idx_building_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE unit (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  building_id INT UNSIGNED NOT NULL,
  floor       TINYINT UNSIGNED NOT NULL,
  unit_no     VARCHAR(16) NOT NULL,
  area        DECIMAL(10,2) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_unit (building_id, unit_no),
  KEY idx_unit_bf (building_id, floor),
  CONSTRAINT fk_unit_building FOREIGN KEY (building_id) REFERENCES building(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tenant (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_name  VARCHAR(128) NOT NULL,
  contact_name  VARCHAR(32) NULL,
  contact_phone VARCHAR(32) NULL,
  business_type VARCHAR(32) NOT NULL,
  status        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  category_id   INT UNSIGNED NULL,
  phase         TINYINT UNSIGNED NULL,
  since         CHAR(7) NULL,
  remark        VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tenant_status (status), KEY idx_tenant_cat (category_id),
  KEY idx_tenant_biz (business_type), KEY idx_tenant_name (company_name),
  CONSTRAINT fk_tenant_cat FOREIGN KEY (category_id) REFERENCES tenant_category(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE contract (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_no  VARCHAR(32) NOT NULL,
  tenant_id    INT UNSIGNED NOT NULL,
  building_id  INT UNSIGNED NOT NULL,
  unit_id      INT UNSIGNED NULL,
  rent_area    DECIMAL(10,2) NOT NULL DEFAULT 0,
  monthly_rent DECIMAL(12,2) NOT NULL DEFAULT 0,
  deposit      DECIMAL(12,2) NOT NULL DEFAULT 0,
  start_date   DATE NULL,
  end_date     DATE NULL,
  sign_date    DATE NULL,
  status       VARCHAR(16) NOT NULL,
  remark       VARCHAR(255) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_contract_no (contract_no),
  KEY idx_ct_tenant (tenant_id), KEY idx_ct_building (building_id),
  KEY idx_ct_unit (unit_id), KEY idx_ct_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_user (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(64) NOT NULL,
  status        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_user_name (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- [ ] **Step 4: 写 Testcontainers 基类 + 冒烟测试（先让它失败）**

`AbstractMysqlIT.java`:
```java
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
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
            .withDatabaseName("park_demo3");

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", MYSQL::getJdbcUrl);
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
        r.add("app.jwt.secret", () -> "test-secret-test-secret-test-secret-32");
    }
}
```

`Demo3ApplicationTests.java`:
```java
package com.park.demo3;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

class Demo3ApplicationTests extends AbstractMysqlIT {
    @Autowired JdbcTemplate jdbc;

    @Test
    void contextLoadsAndFlywayMigrated() {
        Integer tables = jdbc.queryForObject(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() " +
            "AND table_name IN ('building','unit','tenant','tenant_category','contract','auth_user')",
            Integer.class);
        assertThat(tables).isEqualTo(6);
    }
}
```

- [ ] **Step 5: 跑测试确认失败（无 pom/类时编译失败 → 补齐后应通过）**

Run: `cd backend && ./mvnw -q test -Dtest=Demo3ApplicationTests`
Expected: 首次因缺类/依赖未就绪而 FAIL；补齐 Step 1-4 后重跑 PASS（需本机 Docker 运行 Testcontainers）。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd backend && ./mvnw -q test -Dtest=Demo3ApplicationTests`
Expected: PASS（6 张业务表存在；Flyway 历史表 `flyway_schema_history` 自动建）。

- [ ] **Step 7: 提交**

```bash
cd backend && git add -A && git commit -m "feat(backend): maven scaffold + flyway V1 schema + testcontainers smoke

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 统一返回 + 全局异常 + TraceId

**Files:**
- Create: `common/Result.java`, `common/ResultCode.java`, `common/BizException.java`, `common/GlobalExceptionHandler.java`, `common/ResponseWrapAdvice.java`, `common/TraceIdFilter.java`
- Create（测试探针）: `controller/ProbeController.java`（仅测试用，最后一个任务删除或保留为 `/api/probe`）
- Test: `common/WebLayerIT.java`

**Interfaces:**
- Produces: `Result<T>`（`Result.ok(data)` / `Result.error(code,msg)`，字段 `int code,String message,T data,String traceId`）；`BizException(ResultCode)`；所有 `@RestController` 返回自动包裹为 `Result`。
- Consumes: 无。

- [ ] **Step 1: 写 Result / ResultCode / BizException**

```java
// common/Result.java
package com.park.demo3.common;
import org.slf4j.MDC;
public record Result<T>(int code, String message, T data, String traceId) {
    public static <T> Result<T> ok(T data) { return new Result<>(0, "ok", data, MDC.get("traceId")); }
    public static <T> Result<T> error(int code, String message) { return new Result<>(code, message, null, MDC.get("traceId")); }
}
```
```java
// common/ResultCode.java
package com.park.demo3.common;
public enum ResultCode {
    BAD_REQUEST(400, "请求参数错误"),
    UNAUTHORIZED(401, "未认证或令牌无效"),
    NOT_FOUND(404, "资源不存在"),
    CONFLICT(409, "资源冲突"),
    INTERNAL(500, "服务器内部错误");
    public final int code; public final String message;
    ResultCode(int code, String message) { this.code = code; this.message = message; }
}
```
```java
// common/BizException.java
package com.park.demo3.common;
import lombok.Getter;
@Getter
public class BizException extends RuntimeException {
    private final int code;
    public BizException(ResultCode rc) { super(rc.message); this.code = rc.code; }
    public BizException(ResultCode rc, String message) { super(message); this.code = rc.code; }
}
```

- [ ] **Step 2: 写 TraceIdFilter + ResponseWrapAdvice + GlobalExceptionHandler**

```java
// common/TraceIdFilter.java
package com.park.demo3.common;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.slf4j.MDC;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.util.UUID;

@Component @Order(1)
public class TraceIdFilter implements Filter {
    @Override public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) throws IOException, ServletException {
        String tid = ((HttpServletRequest) req).getHeader("X-Trace-Id");
        if (tid == null || tid.isBlank()) tid = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        MDC.put("traceId", tid);
        ((HttpServletResponse) res).setHeader("X-Trace-Id", tid);
        try { chain.doFilter(req, res); } finally { MDC.remove("traceId"); }
    }
}
```
```java
// common/ResponseWrapAdvice.java
package com.park.demo3.common;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

@RestControllerAdvice(basePackages = "com.park.demo3.controller")
public class ResponseWrapAdvice implements ResponseBodyAdvice<Object> {
    @Override public boolean supports(MethodParameter rt, Class conv) { return true; }
    @Override public Object beforeBodyWrite(Object body, MethodParameter rt, MediaType ct,
            Class conv, ServerHttpRequest req, ServerHttpResponse res) {
        if (body instanceof Result<?>) return body;
        return Result.ok(body);
    }
}
```
```java
// common/GlobalExceptionHandler.java
package com.park.demo3.common;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestControllerAdvice(basePackages = "com.park.demo3.controller")
public class GlobalExceptionHandler {
    @ExceptionHandler(BizException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> biz(BizException e) {
        log.warn("biz error: {}", e.getMessage());
        return Result.error(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<Void> invalid(MethodArgumentNotValidException e) {
        FieldError fe = e.getBindingResult().getFieldError();
        String msg = fe == null ? ResultCode.BAD_REQUEST.message : fe.getField() + " " + fe.getDefaultMessage();
        return Result.error(ResultCode.BAD_REQUEST.code, msg);
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result<Void> fallback(Exception e) {
        log.error("unhandled error", e);
        return Result.error(ResultCode.INTERNAL.code, ResultCode.INTERNAL.message);
    }
}
```

- [ ] **Step 3: 写探针 controller + 失败测试**

```java
// controller/ProbeController.java
package com.park.demo3.controller;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/probe")
public class ProbeController {
    @GetMapping("/ok") public Map<String, String> ok() { return Map.of("hello", "demo3"); }
    @GetMapping("/boom") public String boom() { throw new BizException(ResultCode.NOT_FOUND, "probe not found"); }
}
```
```java
// test common/WebLayerIT.java
package com.park.demo3.common;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
class WebLayerIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;

    @Test @WithMockUser
    void wrapsBodyInResultWithTraceId() throws Exception {
        mvc.perform(get("/api/probe/ok"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.code").value(0))
           .andExpect(jsonPath("$.data.hello").value("demo3"))
           .andExpect(jsonPath("$.traceId").isNotEmpty())
           .andExpect(header().exists("X-Trace-Id"));
    }

    @Test @WithMockUser
    void mapsBizExceptionToResultCode() throws Exception {
        mvc.perform(get("/api/probe/boom"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.code").value(404))
           .andExpect(jsonPath("$.message").value("probe not found"));
    }
}
```

- [ ] **Step 4: 跑测试**

Run: `cd backend && ./mvnw -q test -Dtest=WebLayerIT`
Expected: 先 FAIL（类未建/未通过 401，因 Security 尚未放行——若此处 401，Task 3 放行后转 PASS；为隔离，本测试用 `@WithMockUser` 绕过认证），补齐后 PASS（两个用例）。

- [ ] **Step 5: 提交**

```bash
cd backend && git add -A && git commit -m "feat(backend): unified Result + global exception + traceId

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 安全（JWT + 登录）

**Files:**
- Create: `entity/AuthUser.java`, `mapper/AuthUserMapper.java`
- Create: `security/JwtUtil.java`, `security/JwtAuthFilter.java`, `security/SecurityConfig.java`
- Create: `config/CorsConfig.java`, `config/MyBatisPlusConfig.java`
- Create: `dto/LoginReq.java`, `dto/LoginResp.java`
- Create: `service/AuthService.java`, `controller/AuthController.java`
- Modify: `db/migration/V1__schema.sql` 已含 auth_user（不改）；新增 `db/migration/V2__seed.sql` 仅 admin 用户（其余种子在 Task 4 合并扩展）
- Test: `security/AuthIT.java`

**Interfaces:**
- Consumes: `Result`、`BizException`、`AbstractMysqlIT`。
- Produces: `POST /api/auth/login {username,password}` → `Result<LoginResp{token,displayName}>`；`JwtUtil.generate(username)` / `validateAndGetSubject(token)`；Security 链放行登录/actuator/openapi，其余 `/api/**` 需 Bearer。

- [ ] **Step 1: 写 entity / mapper / MyBatisPlus 自动填充**

```java
// entity/AuthUser.java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("auth_user")
public class AuthUser {
    @TableId(type = IdType.AUTO) private Integer id;
    private String username;
    private String passwordHash;
    private String displayName;
    private Integer status;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
```
```java
// mapper/AuthUserMapper.java
package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AuthUser;
public interface AuthUserMapper extends BaseMapper<AuthUser> {}
```
```java
// config/MyBatisPlusConfig.java
package com.park.demo3.config;
import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import org.apache.ibatis.reflection.MetaObject;
import org.springframework.context.annotation.*;
import java.time.LocalDateTime;
@Configuration
public class MyBatisPlusConfig {
    @Bean MetaObjectHandler metaObjectHandler() {
        return new MetaObjectHandler() {
            @Override public void insertFill(MetaObject m) {
                strictInsertFill(m, "createdAt", LocalDateTime.class, LocalDateTime.now());
                strictInsertFill(m, "updatedAt", LocalDateTime.class, LocalDateTime.now());
            }
            @Override public void updateFill(MetaObject m) {
                strictUpdateFill(m, "updatedAt", LocalDateTime.class, LocalDateTime.now());
            }
        };
    }
}
```

- [ ] **Step 2: 写 JwtUtil（密钥 fail-fast）**

```java
// security/JwtUtil.java
package com.park.demo3.security;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
@Component
public class JwtUtil {
    private final SecretKey key;
    private final long expireMs;
    public JwtUtil(@Value("${app.jwt.secret}") String secret,
                   @Value("${app.jwt.expire-minutes}") long expireMinutes) {
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32)
            throw new IllegalStateException("app.jwt.secret must be >= 32 bytes");
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expireMs = expireMinutes * 60_000L;
    }
    public String generate(String username) {
        Date now = new Date();
        return Jwts.builder().subject(username).issuedAt(now)
                .expiration(new Date(now.getTime() + expireMs)).signWith(key).compact();
    }
    public String validateAndGetSubject(String token) {
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload().getSubject();
    }
}
```

- [ ] **Step 3: 写 JwtAuthFilter + SecurityConfig + CorsConfig**

```java
// security/JwtAuthFilter.java
package com.park.demo3.security;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.*;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {
    private final JwtUtil jwt;
    public JwtAuthFilter(JwtUtil jwt) { this.jwt = jwt; }
    @Override protected void doFilterInternal(@NonNull HttpServletRequest req, @NonNull HttpServletResponse res,
            @NonNull FilterChain chain) throws IOException, jakarta.servlet.ServletException {
        String h = req.getHeader("Authorization");
        if (h != null && h.startsWith("Bearer ")) {
            try {
                String user = jwt.validateAndGetSubject(h.substring(7));
                var auth = new UsernamePasswordAuthenticationToken(user, null, AuthorityUtils.NO_AUTHORITIES);
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (Exception ignored) { /* 无效令牌 → 保持匿名,后续被 401 拦截 */ }
        }
        chain.doFilter(req, res);
    }
}
```
```java
// security/SecurityConfig.java
package com.park.demo3.security;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.park.demo3.common.Result;
import com.park.demo3.common.ResultCode;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {
    private final JwtAuthFilter jwtFilter;
    public SecurityConfig(JwtAuthFilter jwtFilter) { this.jwtFilter = jwtFilter; }

    @Bean SecurityFilterChain chain(HttpSecurity http) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
            .cors(c -> {})
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers("/api/auth/login", "/actuator/**",
                                 "/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                .requestMatchers("/api/**").authenticated()
                .anyRequest().permitAll())
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
            .exceptionHandling(e -> e.authenticationEntryPoint((req, res, ex) -> {
                res.setStatus(401);
                res.setContentType("application/json;charset=UTF-8");
                new ObjectMapper().writeValue(res.getWriter(),
                    Result.error(ResultCode.UNAUTHORIZED.code, ResultCode.UNAUTHORIZED.message));
            }));
        return http.build();
    }
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }
}
```
```java
// config/CorsConfig.java
package com.park.demo3.config;
import org.springframework.context.annotation.*;
import org.springframework.web.cors.*;
import org.springframework.web.cors.reactive.*;
import java.util.List;
@Configuration
public class CorsConfig {
    @Bean CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration c = new CorsConfiguration();
        c.setAllowedOriginPatterns(List.of("*"));
        c.setAllowedMethods(List.of("GET","POST","PUT","DELETE","OPTIONS"));
        c.setAllowedHeaders(List.of("*"));
        c.setExposedHeaders(List.of("X-Trace-Id"));
        UrlBasedCorsConfigurationSource s = new UrlBasedCorsConfigurationSource();
        s.registerCorsConfiguration("/**", c);
        return s;
    }
}
```

- [ ] **Step 4: 写 DTO + AuthService + AuthController**

```java
// dto/LoginReq.java
package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
public record LoginReq(@NotBlank String username, @NotBlank String password) {}
```
```java
// dto/LoginResp.java
package com.park.demo3.dto;
public record LoginResp(String token, String displayName) {}
```
```java
// service/AuthService.java
package com.park.demo3.service;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.common.*;
import com.park.demo3.dto.*;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.security.JwtUtil;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
@Service
public class AuthService {
    private final AuthUserMapper users; private final PasswordEncoder enc; private final JwtUtil jwt;
    public AuthService(AuthUserMapper users, PasswordEncoder enc, JwtUtil jwt) {
        this.users = users; this.enc = enc; this.jwt = jwt;
    }
    public LoginResp login(LoginReq req) {
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, req.username()));
        if (u == null || u.getStatus() != 1 || !enc.matches(req.password(), u.getPasswordHash()))
            throw new BizException(ResultCode.UNAUTHORIZED, "用户名或密码错误");
        return new LoginResp(jwt.generate(u.getUsername()), u.getDisplayName());
    }
}
```
```java
// controller/AuthController.java
package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.AuthService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
@Tag(name = "认证")
@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService auth;
    public AuthController(AuthService auth) { this.auth = auth; }
    @PostMapping("/login")
    public LoginResp login(@Valid @RequestBody LoginReq req) { return auth.login(req); }
}
```

- [ ] **Step 5: 写 V2 种子（admin 用户；BCrypt of "admin123"）+ 失败测试**

`db/migration/V2__seed.sql`（本任务先只放 admin；Task 4 在同文件追加业务种子）:
```sql
-- admin / admin123  (BCrypt, cost 10)
INSERT INTO auth_user (username, password_hash, display_name, status) VALUES
('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '周明', 1);
```
> 注：上面是占位哈希示例，实现时用 `BCryptPasswordEncoder().encode("admin123")` 现算一个写入（cost 10），并在测试里用真实哈希。

```java
// test security/AuthIT.java
package com.park.demo3.security;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
class AuthIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;

    @Test
    void loginReturnsToken() throws Exception {
        mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.code").value(0))
           .andExpect(jsonPath("$.data.token").isNotEmpty())
           .andExpect(jsonPath("$.data.displayName").value("周明"));
    }

    @Test
    void protectedEndpointRejectsWithoutToken() throws Exception {
        mvc.perform(get("/api/probe/ok")).andExpect(status().isUnauthorized());
    }

    @Test
    void protectedEndpointAcceptsWithToken() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andReturn().getResponse().getContentAsString();
        String token = com.jayway.jsonpath.JsonPath.read(body, "$.data.token");
        mvc.perform(get("/api/probe/ok").header("Authorization", "Bearer " + token))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.data.hello").value("demo3"));
    }
}
```

- [ ] **Step 6: 跑测试**

Run: `cd backend && ./mvnw -q test -Dtest=AuthIT`
Expected: 三个用例 PASS（登录得 token；无 token 401；带 token 200）。

- [ ] **Step 7: 提交**

```bash
cd backend && git add -A && git commit -m "feat(backend): spring security + jwt login + admin seed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 领域实体/Mapper + 确定性业务种子

**Files:**
- Create: `entity/{Building,Unit,Tenant,TenantCategory,Contract}.java`
- Create: `mapper/{BuildingMapper,UnitMapper,TenantMapper,TenantCategoryMapper,ContractMapper}.java`
- Modify: `db/migration/V2__seed.sql`（追加分类/楼栋/单元/租户/合同确定性种子）
- Test: `service/SeedIT.java`

**Interfaces:**
- Produces: 五个实体 + Mapper（`BaseMapper`）；种子数据（≥3 分类、≥6 楼栋、每楼栋按 `per_floor×floor_count` 生成单元、≥12 租户、对应合同）。
- Consumes: `AbstractMysqlIT`。

- [ ] **Step 1: 写实体**

```java
// entity/Building.java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("building")
public class Building {
    @TableId(type = IdType.AUTO) private Integer id;
    private String name; private Integer phase; private Integer floorCount;
    private BigDecimal totalArea; private BigDecimal rentableArea;
    private Integer status; private Integer perFloor; private String remark;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
```
```java
// entity/Unit.java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("unit")
public class Unit {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer buildingId; private Integer floor; private String unitNo; private BigDecimal area;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
```
```java
// entity/Tenant.java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("tenant")
public class Tenant {
    @TableId(type = IdType.AUTO) private Integer id;
    private String companyName; private String contactName; private String contactPhone;
    private String businessType; private Integer status; private Integer categoryId;
    private Integer phase; private String since; private String remark;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
```
```java
// entity/TenantCategory.java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
@Data @TableName("tenant_category")
public class TenantCategory {
    @TableId(type = IdType.AUTO) private Integer id;
    private String name;
}
```
```java
// entity/Contract.java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDate; import java.time.LocalDateTime;
@Data @TableName("contract")
public class Contract {
    @TableId(type = IdType.AUTO) private Integer id;
    private String contractNo; private Integer tenantId; private Integer buildingId; private Integer unitId;
    private BigDecimal rentArea; private BigDecimal monthlyRent; private BigDecimal deposit;
    private LocalDate startDate; private LocalDate endDate; private LocalDate signDate;
    private String status; private String remark;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}
```

- [ ] **Step 2: 写 Mapper（五个，均 `extends BaseMapper<T>`）**

```java
// mapper/BuildingMapper.java
package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.Building;
public interface BuildingMapper extends BaseMapper<Building> {}
```
（`UnitMapper/TenantMapper/TenantCategoryMapper/ContractMapper` 同构，分别对应实体。）

- [ ] **Step 3: 追加 V2 确定性种子**

在 `V2__seed.sql` 末尾追加（**确定性、无随机**；金额按 `area×UNIT_PRICE[phase]`，`UNIT_PRICE={1:32,2:35,3:30,4:18}`）。示例（实现时按此口径补足到 ≥6 楼栋/≥12 租户；保持 contract.status 覆盖 active/expiring/draft/terminated 以验证派生）：

```sql
INSERT INTO tenant_category (id, name) VALUES (1,'园区直管'),(2,'华盛资管'),(3,'三期招商公司');

INSERT INTO building (id,name,phase,floor_count,total_area,rentable_area,status,per_floor,remark) VALUES
 (1,'一期 A 栋',1,4,4800.00,4200.00,1,4,NULL),
 (2,'一期 B 栋',1,4,4800.00,4200.00,1,4,NULL),
 (3,'二期 C 栋',2,5,6000.00,5400.00,1,4,NULL),
 (4,'二期 D 栋',2,5,6000.00,5400.00,0,4,'停用示例'),
 (5,'三期 E 栋',3,6,7200.00,6600.00,1,4,NULL),
 (6,'宿舍 1 号',4,5,3000.00,2800.00,1,6,NULL);

-- 单元:按 building.per_floor × floor_count 生成,unit_no = floor*100 + seq(厂房) / floor*100+seq(宿舍)
-- 实现时用脚本/存储过程或显式 INSERT 铺满;面积厂房≈260,宿舍≈45。示例(楼栋1,4层×4单元):
INSERT INTO unit (building_id,floor,unit_no,area) VALUES
 (1,1,'101',260),(1,1,'102',260),(1,1,'103',260),(1,1,'104',260),
 (1,2,'201',260),(1,2,'202',260),(1,2,'203',260),(1,2,'204',260),
 (1,3,'301',260),(1,3,'302',260),(1,3,'303',260),(1,3,'304',260),
 (1,4,'401',260),(1,4,'402',260),(1,4,'403',260),(1,4,'404',260);
-- …楼栋 2-6 同法铺满（实现时补全）。

INSERT INTO tenant (id,company_name,contact_name,contact_phone,business_type,status,category_id,phase,since,remark) VALUES
 (1,'中誉机械重工','周琪','138-2841-6602','精密机械',1,1,1,'2020-05','园区元老租户'),
 (2,'锐通电子','李航','139-1100-2233','电子信息',1,1,1,'2021-03',NULL),
 (3,'康泽生物','王敏','137-5566-7788','生物医药',1,2,2,'2022-07',NULL),
 (4,'新元材料','赵磊','135-9988-7766','新材料',1,2,2,'2021-11',NULL),
 (5,'丰仓物流','孙佳','136-2211-3344','仓储物流',1,3,3,'2023-01',NULL),
 (6,'光晟光电','陈宇','138-7788-9900','光电',1,1,3,'2022-02',NULL);
-- …补足 ≥12 租户。

-- 合同:每个在租租户 1+ 合同,关联到具体 unit;status 覆盖 active/expiring/draft/terminated
INSERT INTO contract (contract_no,tenant_id,building_id,unit_id,rent_area,monthly_rent,deposit,start_date,end_date,sign_date,status) VALUES
 ('FP-2024-0001',1,1,1,260,8320,16640,'2024-01-01','2026-12-31','2023-12-20','active'),
 ('FP-2024-0002',1,1,2,260,8320,16640,'2024-01-01','2026-12-31','2023-12-20','active'),
 ('FP-2025-0007',2,1,5,260,8320,16640,'2025-06-01','2026-08-31','2025-05-20','expiring'),
 ('FP-2026-0011',3,3,NULL,300,10500,21000,'2026-09-01','2028-08-31',NULL,'draft'),
 ('FP-2023-0003',4,3,NULL,300,10500,21000,'2023-01-01','2025-12-31','2022-12-15','terminated');
-- …补足覆盖各楼栋,使派生口径可验证。
```

> 实现要点：种子要让至少一栋楼有 occupied+expiring+reserved+vacant 四态单元，便于 Task 5/6 验证口径。`unit_id` 为 null 的合同（如 draft）按楼栋计入 monthlyRent 但不绑定单元占用，按口径处理。

- [ ] **Step 4: 写种子校验测试**

```java
// test service/SeedIT.java
package com.park.demo3.service;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.assertThat;
class SeedIT extends AbstractMysqlIT {
    @Autowired JdbcTemplate jdbc;
    @Test void seedLoaded() {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM tenant_category", Integer.class)).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM building", Integer.class)).isGreaterThanOrEqualTo(6);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM tenant", Integer.class)).isGreaterThanOrEqualTo(6);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM unit", Integer.class)).isGreaterThan(0);
        assertThat(jdbc.queryForObject("SELECT COUNT(DISTINCT status) FROM contract", Integer.class)).isGreaterThanOrEqualTo(3);
    }
}
```

- [ ] **Step 5: 跑测试**

Run: `cd backend && ./mvnw -q test -Dtest=SeedIT`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
cd backend && git add -A && git commit -m "feat(backend): domain entities/mappers + deterministic business seed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 楼栋派生聚合 Service + Controller

**Files:**
- Create: `dto/{BuildingDTO,BuildingDetailDTO,BuildingSummaryDTO,UnitDTO}.java`
- Create: `service/BuildingService.java`
- Create: `controller/BuildingController.java`
- Test: `service/BuildingServiceTest.java`（mock mapper，纯单测验证口径）

**Interfaces:**
- Consumes: `BuildingMapper, UnitMapper, ContractMapper`（`selectList`）。
- Produces:
  - `GET /api/buildings` → `Result<List<BuildingDTO>>`
  - `GET /api/buildings/{id}` → `Result<BuildingDetailDTO>`
  - `GET /api/buildings/summary` → `Result<BuildingSummaryDTO>`
  - `BuildingDTO{ id, name, phase, phaseName, kind, floorCount, totalArea, rentableArea, status, unitCount, occupiedCount, vacantCount, expiringCount, reservedCount, leasedArea, occRate, monthlyRent, tenantIds }`
  - `BuildingSummaryDTO{ buildingCount, stoppedCount, rentableArea, occRate, vacantCount }`

- [ ] **Step 1: 写 DTO**

```java
// dto/BuildingDTO.java
package com.park.demo3.dto;
import java.math.BigDecimal; import java.util.List;
public record BuildingDTO(
    Integer id, String name, Integer phase, String phaseName, String kind,
    Integer floorCount, BigDecimal totalArea, BigDecimal rentableArea, Integer status,
    int unitCount, int occupiedCount, int vacantCount, int expiringCount, int reservedCount,
    BigDecimal leasedArea, double occRate, BigDecimal monthlyRent, List<Integer> tenantIds) {}
```
```java
// dto/UnitDTO.java
package com.park.demo3.dto;
import java.math.BigDecimal;
public record UnitDTO(Integer id, Integer floor, String unitNo, BigDecimal area,
                      String status, Integer tenantId, String contractNo) {}
```
```java
// dto/BuildingDetailDTO.java
package com.park.demo3.dto;
import java.util.List;
public record BuildingDetailDTO(BuildingDTO building, List<UnitDTO> units) {}
```
```java
// dto/BuildingSummaryDTO.java
package com.park.demo3.dto;
import java.math.BigDecimal;
public record BuildingSummaryDTO(int buildingCount, int stoppedCount,
                                 BigDecimal rentableArea, double occRate, int vacantCount) {}
```

- [ ] **Step 2: 写 BuildingService（口径集中实现）**

```java
// service/BuildingService.java
package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.stereotype.Service;
import java.math.BigDecimal; import java.math.RoundingMode;
import java.util.*; import java.util.stream.Collectors;

@Service
public class BuildingService {
    private final BuildingMapper buildings; private final UnitMapper units; private final ContractMapper contracts;
    public BuildingService(BuildingMapper b, UnitMapper u, ContractMapper c) { buildings=b; units=u; contracts=c; }

    static final Map<Integer,String> PHASE = Map.of(1,"一期",2,"二期",3,"三期",4,"宿舍");
    static String kind(int phase) { return phase == 4 ? "宿舍" : "厂房"; }
    static final Set<String> CURRENT = Set.of("active","expiring","draft"); // 占用相关
    static final Set<String> RENT = Set.of("active","expiring");            // 计租相关

    /** 单元派生状态: 取该单元 status∈current 的合同,active→occupied/expiring→expiring/draft→reserved,无→vacant */
    static String unitStatus(Integer unitId, List<Contract> cs) {
        String best = "vacant";
        for (Contract c : cs) {
            if (!Objects.equals(c.getUnitId(), unitId)) continue;
            switch (c.getStatus()) {
                case "active": return "occupied";
                case "expiring": best = "expiring"; break;
                case "draft": if (best.equals("vacant")) best = "reserved"; break;
                default: break;
            }
        }
        return best;
    }

    BuildingDTO toDTO(Building b, List<Unit> us, List<Contract> cs) {
        boolean stopped = b.getStatus() == 0;
        int occ=0, vac=0, exp=0, rsv=0; BigDecimal leased = BigDecimal.ZERO;
        for (Unit u : us) {
            String st = unitStatus(u.getId(), cs);
            switch (st) {
                case "occupied": occ++; leased = leased.add(u.getArea()); break;
                case "expiring": exp++; occ++; leased = leased.add(u.getArea()); break;
                case "reserved": rsv++; leased = leased.add(u.getArea()); break;
                default: vac++;
            }
        }
        double occRate = stopped || b.getRentableArea().signum()==0 ? 0.0
            : Math.min(100.0, leased.divide(b.getRentableArea(), 4, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(1000)).setScale(0, RoundingMode.HALF_UP).doubleValue() / 10.0);
        BigDecimal monthly = cs.stream().filter(c -> RENT.contains(c.getStatus()))
            .map(Contract::getMonthlyRent).reduce(BigDecimal.ZERO, BigDecimal::add);
        List<Integer> tenantIds = cs.stream().filter(c -> RENT.contains(c.getStatus()))
            .map(Contract::getTenantId).distinct().collect(Collectors.toList());
        return new BuildingDTO(b.getId(), b.getName(), b.getPhase(), PHASE.get(b.getPhase()), kind(b.getPhase()),
            b.getFloorCount(), b.getTotalArea(), b.getRentableArea(), b.getStatus(),
            us.size(), occ, vac, exp, rsv, leased, occRate, monthly, tenantIds);
    }

    public List<BuildingDTO> list() {
        List<Building> bs = buildings.selectList(null);
        List<Unit> allUnits = units.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        Map<Integer,List<Unit>> uByB = allUnits.stream().collect(Collectors.groupingBy(Unit::getBuildingId));
        Map<Integer,List<Contract>> cByB = allCt.stream().collect(Collectors.groupingBy(Contract::getBuildingId));
        return bs.stream().map(b -> toDTO(b,
            uByB.getOrDefault(b.getId(), List.of()), cByB.getOrDefault(b.getId(), List.of()))).toList();
    }

    public BuildingSummaryDTO summary() {
        List<BuildingDTO> all = list();
        int stopped = (int) all.stream().filter(d -> d.status()==0).count();
        BigDecimal rentable = all.stream().map(BuildingDTO::rentableArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal leased = all.stream().map(BuildingDTO::leasedArea).reduce(BigDecimal.ZERO, BigDecimal::add);
        double occ = rentable.signum()==0 ? 0.0
            : leased.divide(rentable,4,RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(1000))
                .setScale(0,RoundingMode.HALF_UP).doubleValue()/10.0;
        int vacant = all.stream().mapToInt(BuildingDTO::vacantCount).sum();
        return new BuildingSummaryDTO(all.size(), stopped, rentable, occ, vacant);
    }
}
```

- [ ] **Step 3: 写 BuildingController**

```java
// controller/BuildingController.java
package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.BuildingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;
import java.util.List;
@Tag(name = "楼栋")
@RestController
@RequestMapping("/api/buildings")
public class BuildingController {
    private final BuildingService svc;
    public BuildingController(BuildingService svc) { this.svc = svc; }
    @Operation(summary = "楼栋列表(含派生聚合)") @GetMapping
    public List<BuildingDTO> list() { return svc.list(); }
    @Operation(summary = "楼栋 KPI 汇总") @GetMapping("/summary")
    public BuildingSummaryDTO summary() { return svc.summary(); }
}
```
> 详情端点 `/{id}`（含 units 占用）放在 P0-D（楼栋屏抽屉）实现时补，列表+汇总已足够 Task 测试。

- [ ] **Step 4: 写口径单测（mock mapper，先失败）**

```java
// test service/BuildingServiceTest.java
package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal; import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class BuildingServiceTest {
    BuildingMapper bm = Mockito.mock(BuildingMapper.class);
    UnitMapper um = Mockito.mock(UnitMapper.class);
    ContractMapper cm = Mockito.mock(ContractMapper.class);
    BuildingService svc = new BuildingService(bm, um, cm);

    Building b(int id,int phase,int status,double rentable){ Building x=new Building();
        x.setId(id);x.setName("B"+id);x.setPhase(phase);x.setFloorCount(1);
        x.setTotalArea(BigDecimal.valueOf(rentable));x.setRentableArea(BigDecimal.valueOf(rentable));
        x.setStatus(status);x.setPerFloor(2);return x; }
    Unit u(int id,int bid,double area){ Unit x=new Unit(); x.setId(id);x.setBuildingId(bid);
        x.setFloor(1);x.setUnitNo(""+id);x.setArea(BigDecimal.valueOf(area));return x; }
    Contract c(int bid,int uid,int tid,String st,double rent){ Contract x=new Contract();
        x.setBuildingId(bid);x.setUnitId(uid);x.setTenantId(tid);x.setStatus(st);
        x.setMonthlyRent(BigDecimal.valueOf(rent));x.setRentArea(BigDecimal.ZERO);return x; }

    @Test void occRateAreaBased_includesReserved_capsAndZerosStopped() {
        // 楼栋1: rentable 1000, 单元: occupied(300)+expiring(200)+reserved(100)+vacant(400) → leased=600 → 60.0%
        Mockito.when(bm.selectList(null)).thenReturn(List.of(b(1,1,1,1000), b(2,1,0,1000)));
        Mockito.when(um.selectList(null)).thenReturn(List.of(
            u(11,1,300), u(12,1,200), u(13,1,100), u(14,1,400), u(21,2,500)));
        Mockito.when(cm.selectList(null)).thenReturn(List.of(
            c(1,11,1,"active",8000), c(1,12,2,"expiring",5000), c(1,13,3,"draft",0),
            c(2,21,4,"active",4000))); // 楼栋2 停用 → occRate 0
        List<BuildingDTO> r = svc.list();
        BuildingDTO d1 = r.stream().filter(x->x.id()==1).findFirst().orElseThrow();
        assertThat(d1.leasedArea()).isEqualByComparingTo("600");
        assertThat(d1.occRate()).isEqualTo(60.0);
        assertThat(d1.occupiedCount()).isEqualTo(2);   // occupied + expiring
        assertThat(d1.vacantCount()).isEqualTo(1);
        assertThat(d1.reservedCount()).isEqualTo(1);
        assertThat(d1.monthlyRent()).isEqualByComparingTo("13000"); // active+expiring
        assertThat(d1.tenantIds()).containsExactlyInAnyOrder(1,2);
        BuildingDTO d2 = r.stream().filter(x->x.id()==2).findFirst().orElseThrow();
        assertThat(d2.occRate()).isEqualTo(0.0); // 停用
    }

    @Test void summaryRollsUp() {
        Mockito.when(bm.selectList(null)).thenReturn(List.of(b(1,1,1,1000)));
        Mockito.when(um.selectList(null)).thenReturn(List.of(u(11,1,500), u(12,1,500)));
        Mockito.when(cm.selectList(null)).thenReturn(List.of(c(1,11,1,"active",8000)));
        BuildingSummaryDTO s = svc.summary();
        assertThat(s.buildingCount()).isEqualTo(1);
        assertThat(s.occRate()).isEqualTo(50.0);
        assertThat(s.vacantCount()).isEqualTo(1);
    }
}
```

- [ ] **Step 5: 跑测试**

Run: `cd backend && ./mvnw -q test -Dtest=BuildingServiceTest`
Expected: 两个用例 PASS（口径正确）。

- [ ] **Step 6: 提交**

```bash
cd backend && git add -A && git commit -m "feat(backend): building derived aggregation service + endpoints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 租户派生聚合 Service + Controller + 分类端点

**Files:**
- Create: `dto/{TenantDTO,TenantSummaryDTO,TenantCategoryDTO}.java`
- Create: `service/TenantService.java`
- Create: `controller/TenantController.java`, `controller/TenantCategoryController.java`
- Test: `service/TenantServiceTest.java`

**Interfaces:**
- Consumes: `TenantMapper, ContractMapper, BuildingMapper, TenantCategoryMapper`。
- Produces:
  - `GET /api/tenants` → `Result<List<TenantDTO>>`
  - `GET /api/tenants/summary` → `Result<TenantSummaryDTO>`
  - `GET /api/tenant-categories` → `Result<List<TenantCategoryDTO>>`
  - `TenantDTO{ id, companyName, contactName, contactPhone, businessType, status, categoryId, phase, since, monthlyRent, leasedArea, primaryBuilding, contractCount }`
  - `TenantSummaryDTO{ tenantActive, occRate, monthlyRent, expiringTenants }`

- [ ] **Step 1: 写 DTO**

```java
// dto/TenantDTO.java
package com.park.demo3.dto;
import java.math.BigDecimal;
public record TenantDTO(
    Integer id, String companyName, String contactName, String contactPhone, String businessType,
    Integer status, Integer categoryId, Integer phase, String since,
    BigDecimal monthlyRent, BigDecimal leasedArea, String primaryBuilding, int contractCount) {}
```
```java
// dto/TenantSummaryDTO.java
package com.park.demo3.dto;
import java.math.BigDecimal;
public record TenantSummaryDTO(int tenantActive, double occRate, BigDecimal monthlyRent, int expiringTenants) {}
```
```java
// dto/TenantCategoryDTO.java
package com.park.demo3.dto;
public record TenantCategoryDTO(Integer id, String name) {}
```

- [ ] **Step 2: 写 TenantService**

```java
// service/TenantService.java
package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.stereotype.Service;
import java.math.BigDecimal; import java.math.RoundingMode;
import java.util.*; import java.util.stream.Collectors;

@Service
public class TenantService {
    private final TenantMapper tenants; private final ContractMapper contracts;
    private final BuildingMapper buildings; private final TenantCategoryMapper categories;
    private final BuildingService buildingService;
    public TenantService(TenantMapper t, ContractMapper c, BuildingMapper b,
                         TenantCategoryMapper cat, BuildingService bs) {
        tenants=t; contracts=c; buildings=b; categories=cat; buildingService=bs;
    }
    static final Set<String> RENT = Set.of("active","expiring");

    public List<TenantDTO> list() {
        List<Tenant> ts = tenants.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        Map<Integer,String> bName = buildings.selectList(null).stream()
            .collect(Collectors.toMap(Building::getId, Building::getName));
        Map<Integer,List<Contract>> cByT = allCt.stream().collect(Collectors.groupingBy(Contract::getTenantId));
        return ts.stream().map(t -> {
            List<Contract> cs = cByT.getOrDefault(t.getId(), List.of());
            List<Contract> current = cs.stream().filter(c -> RENT.contains(c.getStatus())).toList();
            BigDecimal monthly = current.stream().map(Contract::getMonthlyRent).reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal area = current.stream().map(Contract::getRentArea).reduce(BigDecimal.ZERO, BigDecimal::add);
            String primary = current.isEmpty() ? "—" : bName.getOrDefault(current.get(0).getBuildingId(), "—");
            return new TenantDTO(t.getId(), t.getCompanyName(), t.getContactName(), t.getContactPhone(),
                t.getBusinessType(), t.getStatus(), t.getCategoryId(), t.getPhase(), t.getSince(),
                monthly, area, primary, cs.size());
        }).toList();
    }

    public TenantSummaryDTO summary() {
        List<Tenant> ts = tenants.selectList(null);
        List<Contract> allCt = contracts.selectList(null);
        int active = (int) ts.stream().filter(t -> t.getStatus()==1).count();
        BigDecimal monthly = allCt.stream().filter(c -> RENT.contains(c.getStatus()))
            .map(Contract::getMonthlyRent).reduce(BigDecimal.ZERO, BigDecimal::add);
        int expiringTenants = (int) allCt.stream().filter(c -> "expiring".equals(c.getStatus()))
            .map(Contract::getTenantId).distinct().count();
        double occRate = buildingService.summary().occRate();
        return new TenantSummaryDTO(active, occRate, monthly, expiringTenants);
    }

    public List<TenantCategoryDTO> categoriesList() {
        return categories.selectList(null).stream().map(c -> new TenantCategoryDTO(c.getId(), c.getName())).toList();
    }
}
```

- [ ] **Step 3: 写 Controller**

```java
// controller/TenantController.java
package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.TenantService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;
import java.util.List;
@Tag(name = "租户")
@RestController
@RequestMapping("/api/tenants")
public class TenantController {
    private final TenantService svc;
    public TenantController(TenantService svc) { this.svc = svc; }
    @Operation(summary = "租户列表(含派生)") @GetMapping
    public List<TenantDTO> list() { return svc.list(); }
    @Operation(summary = "租户 KPI 汇总") @GetMapping("/summary")
    public TenantSummaryDTO summary() { return svc.summary(); }
}
```
```java
// controller/TenantCategoryController.java
package com.park.demo3.controller;
import com.park.demo3.dto.TenantCategoryDTO;
import com.park.demo3.service.TenantService;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;
import java.util.List;
@Tag(name = "租户分类")
@RestController
@RequestMapping("/api/tenant-categories")
public class TenantCategoryController {
    private final TenantService svc;
    public TenantCategoryController(TenantService svc) { this.svc = svc; }
    @GetMapping public List<TenantCategoryDTO> list() { return svc.categoriesList(); }
}
```

- [ ] **Step 4: 写口径单测**

```java
// test service/TenantServiceTest.java
package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal; import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class TenantServiceTest {
    TenantMapper tm = Mockito.mock(TenantMapper.class);
    ContractMapper cm = Mockito.mock(ContractMapper.class);
    BuildingMapper bm = Mockito.mock(BuildingMapper.class);
    TenantCategoryMapper catm = Mockito.mock(TenantCategoryMapper.class);
    BuildingService bs = Mockito.mock(BuildingService.class);
    TenantService svc = new TenantService(tm, cm, bm, catm, bs);

    Tenant t(int id,int status){ Tenant x=new Tenant(); x.setId(id);x.setCompanyName("T"+id);
        x.setBusinessType("精密机械");x.setStatus(status);x.setPhase(1);return x; }
    Building b(int id,String name){ Building x=new Building(); x.setId(id);x.setName(name);return x; }
    Contract c(int tid,int bid,String st,double rent,double area){ Contract x=new Contract();
        x.setTenantId(tid);x.setBuildingId(bid);x.setStatus(st);
        x.setMonthlyRent(BigDecimal.valueOf(rent));x.setRentArea(BigDecimal.valueOf(area));return x; }

    @Test void derivesMonthlyAreaPrimaryContractCount() {
        Mockito.when(tm.selectList(null)).thenReturn(List.of(t(1,1)));
        Mockito.when(bm.selectList(null)).thenReturn(List.of(b(7,"一期 A 栋")));
        Mockito.when(cm.selectList(null)).thenReturn(List.of(
            c(1,7,"active",8000,260), c(1,7,"expiring",5000,200), c(1,7,"terminated",9999,300)));
        TenantDTO d = svc.list().get(0);
        assertThat(d.monthlyRent()).isEqualByComparingTo("13000"); // active+expiring, 不含 terminated
        assertThat(d.leasedArea()).isEqualByComparingTo("460");
        assertThat(d.primaryBuilding()).isEqualTo("一期 A 栋");
        assertThat(d.contractCount()).isEqualTo(3); // 全部历史
    }

    @Test void summaryCountsActiveAndExpiringTenants() {
        Mockito.when(tm.selectList(null)).thenReturn(List.of(t(1,1), t(2,1), t(3,2)));
        Mockito.when(cm.selectList(null)).thenReturn(List.of(
            c(1,7,"active",8000,260), c(2,7,"expiring",5000,200)));
        Mockito.when(bs.summary()).thenReturn(new BuildingSummaryDTO(0,0,BigDecimal.ZERO,42.0,0));
        TenantSummaryDTO s = svc.summary();
        assertThat(s.tenantActive()).isEqualTo(2);        // status==1
        assertThat(s.monthlyRent()).isEqualByComparingTo("13000");
        assertThat(s.expiringTenants()).isEqualTo(1);     // distinct tenant with expiring
        assertThat(s.occRate()).isEqualTo(42.0);
    }
}
```

- [ ] **Step 5: 跑测试**

Run: `cd backend && ./mvnw -q test -Dtest=TenantServiceTest`
Expected: 两个用例 PASS。

- [ ] **Step 6: 提交**

```bash
cd backend && git add -A && git commit -m "feat(backend): tenant derived aggregation + category endpoints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: OpenAPI 配置 + 全量回归 + 收尾

**Files:**
- Create: `config/OpenApiConfig.java`
- Modify: `controller/ProbeController.java`（保留，标 `@Tag("探针")`；或删除——本步保留以便手测）
- Test: 全量 `./mvnw test`

**Interfaces:**
- Produces: Swagger UI `/swagger-ui.html`，OpenAPI JSON `/v3/api-docs`。

- [ ] **Step 1: 写 OpenApiConfig**

```java
// config/OpenApiConfig.java
package com.park.demo3.config;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.*;
@Configuration
public class OpenApiConfig {
    @Bean OpenAPI demo3OpenAPI() {
        return new OpenAPI().info(new Info().title("demo3 园区管理系统 API").version("0.0.1")
            .description("P0-A 后端地基：楼栋/租户/合同只读派生聚合 + JWT 登录"));
    }
}
```

- [ ] **Step 2: 全量回归**

Run: `cd backend && ./mvnw -q test`
Expected: 全部 PASS（Demo3ApplicationTests / WebLayerIT / AuthIT / SeedIT / BuildingServiceTest / TenantServiceTest）。

- [ ] **Step 3: 手测启动（可选，需本机 MySQL 或 compose）**

Run: 设 `DB_*` 环境变量指向一个 MySQL，`./mvnw spring-boot:run`，浏览 `http://localhost:8080/swagger-ui.html`，`POST /api/auth/login` 取 token，带 Bearer 调 `/api/buildings`、`/api/buildings/summary`、`/api/tenants`、`/api/tenants/summary` 验真值。
Expected: 各端点返回 `Result` 包裹的派生数据；无 token 调 `/api/buildings` 得 401。

- [ ] **Step 4: 提交**

```bash
cd backend && git add -A && git commit -m "feat(backend): openapi config + P0-A regression green

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review（计划对照 spec）

**Spec 覆盖**：后端横切（Result/异常/TraceId/Security-JWT/Flyway/MyBatis-Plus/Actuator/OpenAPI/配置/校验）→ Task 1-3,7；schema 7 表 → Task 1(6 业务表)+auth_user；种子 → Task 3(admin)+4(业务)；楼栋派生端点 → Task 5；租户派生端点 → Task 6。✅ MapStruct 列在栈中但 P0-A 的 DTO 均为派生聚合（非实体直映），故用手写 service 组装而非 MapStruct——MapStruct 待 P1 出现实体↔DTO 直映 CRUD 时引入（避免为派生聚合强套映射器，ponytail）。

**占位扫描**：种子 SQL 标注"实现时补全"为**数据铺量**说明而非逻辑占位——口径与示例行已给全，补全为机械录入。无逻辑 TODO。

**类型一致性**：`BuildingService.summary()` 返回 `BuildingSummaryDTO`（occRate double）被 `TenantService.summary()` 复用 occRate——签名一致；`RENT`/`CURRENT` 集合两 service 各自定义但语义同口径（active/expiring 计租；active/expiring/draft 计占用）。`BuildingDTO`/`TenantDTO` 字段与 P0-D/P0-E 前端消费契约对齐（spec §8）。

**遗留到后续计划**：楼栋详情 `/{id}`（含 units 占用状态）→ P0-D（楼栋屏抽屉一并做，避免无消费者的端点）；租户详情 `/{id}`（合同历史）→ P0-E。
