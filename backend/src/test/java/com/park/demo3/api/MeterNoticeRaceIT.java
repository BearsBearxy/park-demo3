package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.TenantMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 批删 × 催缴单的并发(2026-09-24 对抗复查 R-F1 / R-F2):库是 REPEATABLE-READ,两个事务交错才出事。
// 交错只能用「真提交的夹具 + 第二条连接持锁不提交」造,所以本类**不带** @Transactional:
// 夹具独占 2079 年,每条用例 finally 里按 id 清干净(容器跨次复用,残渣会留到下次)。
// 判「对面已经在等锁」看 PROCESSLIST:同一个库账号看得见自己的连接,有语句跑了 ≥1 秒就是卡在锁上。
@AutoConfigureMockMvc
class MeterNoticeRaceIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource ds;
    @Autowired TenantMapper tenantMapper;
    private String token;

    @BeforeEach
    void login() throws Exception {
        token = JsonPath.read(mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(), "$.data.token");
    }

    private String call(RequestBuilder rb) throws Exception {
        return mvc.perform(rb).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private String auth() { return "Bearer " + token; }

    /** 夹具:一户 + 挂在它名下的一块水表 + 本月读数 + 生成一次(出一张草稿单,明细里有这块表)。全部真提交。 */
    private record Fx(String ym, int tenant, int meter, long dcl, long arch, long imp) {}

    private Fx fixture(String ym) throws Exception {
        long dcl = maxId("data_change_log"), arch = maxId("meter_archive_log"), imp = maxId("import_log");
        Tenant t = new Tenant();
        t.setCompanyName("IT并发户" + ym); t.setBusinessType("factory");
        tenantMapper.insert(t);
        int m = JsonPath.read(call(post("/api/meters").header("Authorization", auth()).contentType("application/json")
                .content("{\"kind\":\"water\",\"zone\":\"p1\",\"name\":\"IT并发水表" + ym
                        + "\",\"ownership\":\"tenant\",\"tenantId\":" + t.getId() + "}")), "$.data.id");
        Fx f = new Fx(ym, t.getId(), m, dcl, arch, imp);
        try {
            assertThat(code(call(post("/api/meters/readings").header("Authorization", auth()).contentType("application/json")
                    .content("{\"meterId\":" + m + ",\"ym\":\"" + ym + "\",\"prevTotal\":0,\"currTotal\":20}")))).isZero();
            assertThat(code(call(post("/api/bill-notices/generate").param("ym", ym).header("Authorization", auth())))).isZero();
            assertThat(linesOf(m, ym)).as("夹具退化:生成没把这块表出进单里,下面两条就测不到东西").isPositive();
        } catch (Throwable e) {
            cleanup(f);
            throw e;
        }
        return f;
    }

    private void cleanup(Fx f) {
        jdbc.update("DELETE FROM bill_notice WHERE ym = ?", f.ym());   // 明细 / 告警 FK CASCADE
        jdbc.update("DELETE FROM meter_reading WHERE meter_id = ?", f.meter());
        jdbc.update("DELETE FROM meter WHERE id = ?", f.meter());       // 归属 / 状态 / 册子行 FK CASCADE
        jdbc.update("DELETE FROM tenant WHERE id = ?", f.tenant());
        jdbc.update("DELETE FROM data_change_log WHERE id > ?", f.dcl());
        jdbc.update("DELETE FROM meter_archive_log WHERE id > ?", f.arch());
        jdbc.update("DELETE FROM import_log WHERE id > ?", f.imp());
    }

    private long maxId(String table) {
        return jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) FROM " + table, Long.class);
    }

    private long linesOf(int meterId, String ym) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM bill_notice_line l JOIN bill_notice n ON n.id = l.notice_id"
                + " WHERE l.meter_id = ? AND n.ym = ?", Long.class, meterId, ym);
    }

    private static int code(String body) { return JsonPath.read(body, "$.code"); }

    private static void exec(Connection c, String sql, Object... args) throws Exception {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
            ps.executeUpdate();
        }
    }

    /** 等到后台那条请求卡在锁上(有别的连接的语句跑了 ≥1 秒);它先跑完了也不再等。 */
    private void awaitBlocked(Future<?> bg) throws Exception {
        long end = System.currentTimeMillis() + 30_000;
        while (!bg.isDone() && System.currentTimeMillis() < end) {
            Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.PROCESSLIST"
                    + " WHERE COMMAND = 'Query' AND TIME >= 1 AND ID <> CONNECTION_ID()", Integer.class);
            if (n != null && n > 0) return;
            Thread.sleep(100);
        }
        assertThat(bg.isDone()).as("30 秒内没看到后台请求等锁,也没跑完").isTrue();
    }

    // R-F1:批删读到草稿之后、实删之前,别人把单确认了 —— 实删必须看见这次确认(409),不许读数删了、单还在
    @Test
    void batchDelete_noticeConfirmedWhileWaiting_409_readingAndNoticeKept() throws Exception {
        Fx f = fixture("2079-01");
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            exec(c, "UPDATE bill_notice SET status = 'confirmed' WHERE ym = ? AND tenant_id = ?", f.ym(), f.tenant());
            Future<String> res = pool.submit(() -> call(delete("/api/meters/readings").param("ym", f.ym())
                    .param("dropDraftNotices", "true").header("Authorization", auth())));
            awaitBlocked(res);
            c.commit();
            String body = res.get(60, TimeUnit.SECONDS);
            assertThat(code(body)).as(body).isEqualTo(409);
            assertThat((String) JsonPath.read(body, "$.message")).contains("已确认/已导出的催缴单");
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM meter_reading WHERE meter_id = ? AND ym = ?",
                    Integer.class, f.meter(), f.ym())).as("读数被删了").isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM bill_notice WHERE ym = ? AND status = 'confirmed'",
                    Integer.class, f.ym())).as("已确认的单被删了").isEqualTo(1);
        } finally {
            pool.shutdownNow();
            cleanup(f);
        }
    }

    // R-F2:批删(删草稿单 + 删读数)还没提交时点了生成 —— 生成要等它提交后再读,不许按已删的读数把单出回来
    @Test
    void generate_whileBatchDeleteUncommitted_doesNotRebillDeletedReading() throws Exception {
        Fx f = fixture("2079-02");
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            // 同 MeterService.batchDelete 勾了连带删草稿的次序:先删该月草稿/作废单,再删读数
            exec(c, "DELETE FROM bill_notice WHERE ym = ? AND status IN ('draft', 'void')", f.ym());
            exec(c, "DELETE FROM meter_reading WHERE ym = ? AND meter_id = ?", f.ym(), f.meter());
            Future<String> res = pool.submit(() -> call(post("/api/bill-notices/generate").param("ym", f.ym())
                    .header("Authorization", auth())));
            awaitBlocked(res);
            c.commit();
            String body = res.get(60, TimeUnit.SECONDS);
            assertThat(code(body)).as(body).isZero();
            assertThat(linesOf(f.meter(), f.ym())).as("读数已删,生成又把这块表出进了单里").isZero();
        } finally {
            pool.shutdownNow();
            cleanup(f);
        }
    }
}
