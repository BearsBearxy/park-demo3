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

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 新园区按部署指南起一个空库(2026-10-04 用户拍板:每园一个库,从 db/baseline 起步):
 * 照 deploy/gen-env.sh 设 FLYWAY_LOCATIONS(起点链)、ADMIN_PASSWORD 和两个部署开关,应用要起得来,管理员用 ADMIN_PASSWORD 登得进
 * (起点脚本里 admin 的口令列是占位,首次启动由 AdminInitializer 写进 ADMIN_PASSWORD;admin123 登不进),核心各屏的读接口在空库上都要 200 —— 空列表可以,5xx/403 不行;
 * 各附表年份概览落今年;光伏/电费/充电各录一条要成(2026-10-05 用户拍板「按你建议修改」)。
 * 不继承 AbstractMysqlIT:那边钉死连 park_demo3(老链),这里连自己建的临时库,用完删掉。
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext
class BaselineBootIT {
    private static final String SCHEMA = BaselineSqlGenerator.createSchema("boot");
    private static final String ADMIN_PASSWORD = "Baseline-Boot-2026";
    /** gen-env.sh 写 RELEASE_BASELINE 用的就是这一行:此刻 frontend/package.json 的 version。 */
    private static final String VERSION = packageVersion();

    private static String packageVersion() {
        try {
            Matcher m = Pattern.compile("\"version\":\\s*\"([^\"]+)\"")
                    .matcher(Files.readString(Path.of("../frontend/package.json"), StandardCharsets.UTF_8));
            if (!m.find()) throw new IllegalStateException("frontend/package.json 没有 version");
            return m.group(1);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> BaselineSqlGenerator.url(SCHEMA));
        r.add("spring.datasource.username", () -> "root");
        r.add("spring.datasource.password", AbstractMysqlIT.MYSQL::getPassword);
        // gen-env.sh 给新园区写的就是这几个环境变量,这里按同名属性给,走 application.yml 里同一个占位符。
        // 两个部署开关缺了 DeployConfig 会拒绝启动(起点链上默认值是我园的样子,2026-10-05 复查)
        r.add("FLYWAY_LOCATIONS", () -> String.join(",", BaselineSqlGenerator.BASELINE_CHAIN));
        r.add("ADMIN_PASSWORD", () -> ADMIN_PASSWORD);
        r.add("PARK_TOOLS_ENABLED", () -> "false");
        r.add("RELEASE_BASELINE", () -> VERSION);
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

        assertThat(login("admin123")).as("admin123 不该登得进").isNull();
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

        // 两个部署开关按客户值到了前端;模拟填充在起点链上被拒(2026-10-05 用户拍板「按你建议修改」)
        String cfg = mvc.perform(get("/api/app/config").header("Authorization", "Bearer " + token)).andReturn()
                .getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat((Boolean) JsonPath.read(cfg, "$.data.parkTools")).isFalse();
        assertThat((String) JsonPath.read(cfg, "$.data.releaseBaseline")).isEqualTo(VERSION);
        String sim = mvc.perform(post("/api/pv-meter/simulate").param("year", "2026")
                .header("Authorization", "Bearer " + token)).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat((Integer) JsonPath.read(sim, "$.code")).isEqualTo(404);

        // 空库上各附表的年份概览落今年,不落我园台账起点 2024(2026-10-05 用户拍板「按你建议修改」:没数据才读时钟)。
        // 期望值自己读时钟,不借 YearSpan —— 那边被改坏这里要能红
        int now = LocalDate.now(ZoneId.of("Asia/Shanghai")).getYear();
        List<String> yearBad = new ArrayList<>();
        for (String[] probe : new String[][] {
                {"/api/pv/overview", "$.data.currentYear"}, {"/api/elec/overview", "$.data.currentYear"},
                {"/api/charging/7/overview", "$.data.currentYear"}, {"/api/utilities/overview", "$.data.currentYear"},
                {"/api/s10/overview", "$.data.currentYear"}, {"/api/salary/overview", "$.data.currentYear"},
                // 损益附表没有 currentYear:空库范围 [去年..明年],第二格是今年
                {"/api/pnl/s1/overview", "$.data.years[1].year"}, {"/api/recon/overview", "$.data.year"}}) {
            String body = mvc.perform(get(probe[0]).header("Authorization", "Bearer " + token)).andReturn()
                    .getResponse().getContentAsString(StandardCharsets.UTF_8);
            Integer got = JsonPath.read(body, probe[1]);
            if (!Integer.valueOf(now).equals(got)) yearBad.add(probe[0] + " → " + got);
        }
        assertThat(yearBad).as("空库年份应落 " + now).isEmpty();

        // 空库录得进数:起点脚本带了占位期别(一期~三期)和充电类别(运营商一/二),
        // 光伏、电费、充电三张附表各录一条都要成(改前三张字典表是空的,录入一律 409「期别不存在 / 类别不存在」)
        String ym = now + "-01";
        List<String> writeBad = new ArrayList<>();
        for (String[] w : new String[][] {
                {"/api/pv/records", "{\"phase\":\"p1\",\"acctMonth\":\"" + ym + "\",\"occurMonth\":\"" + ym
                        + "\",\"selfKwh\":100,\"selfAmt\":80,\"gridKwh\":10,\"gridAmt\":4}"},
                {"/api/elec/records", "{\"type\":\"energy\",\"phase\":\"p1\",\"acctMonth\":\"" + ym
                        + "\",\"period\":\"峰\",\"unit\":\"度\",\"qty\":100,\"price\":0.9,\"rate\":0.13}"},
                {"/api/charging/7/records", "{\"scheduleNo\":7,\"cat\":\"op1\",\"acctMonth\":\"" + ym
                        + "\",\"kwh\":100,\"fee\":90,\"cost\":60}"}}) {
            MvcResult r = mvc.perform(post(w[0]).header("Authorization", "Bearer " + token)
                    .contentType("application/json").content(w[1])).andReturn();
            String body = r.getResponse().getContentAsString(StandardCharsets.UTF_8);
            if (r.getResponse().getStatus() != 200 || !body.contains("\"code\":0")) {
                writeBad.add(w[0] + " → " + r.getResponse().getStatus() + " " + body.substring(0, Math.min(200, body.length())));
            }
        }
        assertThat(writeBad).isEmpty();

        // 应用起完、管理员点过一圈之后,库里仍不许有我园的名字:启动时 BookSeeder 会给缺册的库补附表10 册,
        // 它写进库的册名、版面组名 Flyway 拆链管不到(2026-10-04 复查:原来写着我园的「A座租金」「B-G座租金」)
        assertThat(BaselineSqlGenerator.realNameHits(SCHEMA)).isEmpty();
    }
}
