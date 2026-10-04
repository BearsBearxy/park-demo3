package com.park.demo3;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 新园区按部署指南起一个空库(2026-10-04 用户拍板:每园一个库,从 db/baseline 起步):
 * 设 FLYWAY_LOCATIONS 指向起点链、设 ADMIN_PASSWORD,应用要起得来,管理员用 ADMIN_PASSWORD 登得进
 * (种子口令 admin123 已被换掉),核心各屏的读接口在空库上都要 200 —— 空列表可以,5xx/403 不行。
 * 不继承 AbstractMysqlIT:那边钉死连 park_demo3(老链),这里连自己建的临时库,用完删掉。
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext
class BaselineBootIT {
    private static final String SCHEMA = BaselineSqlGenerator.createSchema("boot");
    private static final String ADMIN_PASSWORD = "Baseline-Boot-2026";

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> BaselineSqlGenerator.url(SCHEMA));
        r.add("spring.datasource.username", () -> "root");
        r.add("spring.datasource.password", AbstractMysqlIT.MYSQL::getPassword);
        // 部署指南里新园区要设的就是这两个环境变量,这里按同名属性给,走 application.yml 里同一个占位符
        r.add("FLYWAY_LOCATIONS", () -> String.join(",", BaselineSqlGenerator.BASELINE_CHAIN));
        r.add("ADMIN_PASSWORD", () -> ADMIN_PASSWORD);
        r.add("app.jwt.secret", () -> "test-secret-test-secret-test-secret-32");
    }

    @AfterAll
    static void dropSchema() {
        BaselineSqlGenerator.dropSchema(SCHEMA);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    /** 核心各屏进页时调的读接口(无参或带一个当年/当月参数)。 */
    private static final List<String> CORE_READS = List.of(
            "/api/auth/me", "/api/auth/perms", "/api/data-home/overview",
            "/api/buildings", "/api/buildings/summary", "/api/tenants", "/api/tenants/summary",
            "/api/contracts", "/api/contracts/summary", "/api/zones", "/api/companies",
            "/api/meters", "/api/meters/months", "/api/params?ym=2026-01", "/api/price-cfg",
            "/api/alloc/years", "/api/alloc/pools?ym=2026-01", "/api/bill-notices/months", "/api/books?screen=s10",
            "/api/s10/overview", "/api/salary/overview", "/api/utilities/overview",
            "/api/pv/overview", "/api/elec/overview", "/api/charging/7/overview",
            "/api/pv-meter/stations", "/api/cp-meter/stations", "/api/elec-cost/meters",
            "/api/pnl/s1/overview", "/api/recon/overview", "/api/analysis/months", "/api/budget/all",
            "/api/import-log/overview", "/api/notices", "/api/review/states?year=2026",
            "/api/system/users", "/api/system/roles");

    private String login(String password) throws Exception {
        MvcResult r = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"" + password + "\"}")).andReturn();
        String body = r.getResponse().getContentAsString(StandardCharsets.UTF_8);
        return r.getResponse().getStatus() == 200 && Integer.valueOf(0).equals(JsonPath.read(body, "$.code"))
                ? JsonPath.read(body, "$.data.token") : null;
    }

    @Test
    void emptyParkBootsAndAdminCanOpenCoreScreens() throws Exception {
        assertThat(jdbc.queryForList("SELECT script FROM flyway_schema_history WHERE success=1 ORDER BY installed_rank",
                String.class)).as("跑的是起点链").first().isEqualTo("V" + BaselineSqlGenerator.CUT + "__baseline.sql");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM building", Integer.class)).isZero();

        assertThat(login("admin123")).as("种子口令应已被 ADMIN_PASSWORD 换掉").isNull();
        String token = login(ADMIN_PASSWORD);
        assertThat(token).isNotNull();

        List<String> bad = new ArrayList<>();
        for (String url : CORE_READS) {
            MvcResult r = mvc.perform(get(url).header("Authorization", "Bearer " + token)).andReturn();
            String body = r.getResponse().getContentAsString(StandardCharsets.UTF_8);
            if (r.getResponse().getStatus() != 200 || !body.contains("\"code\":0")) {
                bad.add(url + " → " + r.getResponse().getStatus() + " " + body.substring(0, Math.min(200, body.length())));
            }
        }
        assertThat(bad).isEmpty();

        // 应用起完、管理员点过一圈之后,库里仍不许有我园的名字:启动时 BookSeeder 会给缺册的库补附表10 册,
        // 它写进库的册名、版面组名 Flyway 拆链管不到(2026-10-04 复查:原来写着我园的「A座租金」「B-G座租金」)
        assertThat(BaselineSqlGenerator.realNameHits(SCHEMA)).isEmpty();
    }
}
