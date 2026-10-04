package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 抄表导入改倍率要表档案权限(2026-10-03 安全审计 F15,用户 2026-10-04 选方案 1)。
 *
 * 导入只要 meter-reading,而倍率是 meter-master 的口径。原来财务专员导入一行 factor=80,
 * 这块表的倍率和本行读数快照就跟着变,之后的催缴单金额随之变 —— 专员自己还撤不了。
 * 现在:没有表档案权限而本行要动已有表的倍率 → 档案不改、本行快照取系统里现有的、出一条提示;有权限照旧。
 *
 * 不带 @Transactional:要用新建的专员账号登录(权限缓存走另一条路径)。数据落在独占的 2076 年(全仓无人用),收尾删掉。
 */
@AutoConfigureMockMvc
class MeterImportFactorPermIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private static final String PASS = "init-pass-123";

    /** 破坏验证:去掉 MeterService.importRows 里 F15 那段判定 → 倍率变成 80、快照 80,红。 */
    @Test
    void clerkCannotChangeAnExistingMetersFactorThroughImport() throws Exception {
        String clerk = mkUser(admin(), "it-f15", "finance_clerk");
        String name = "ITF15表" + System.nanoTime();
        try {
            importRow(admin(), name, "2076-01", "1", "1");          // 管理员建档:倍率 1
            int id = meterId(name);

            String r = importRow(login(clerk, PASS), name, "2076-02", "80", "2");
            assertThat(factorOf(id)).isEqualByComparingTo("1");
            assertThat(snapOf(id, "2076-02")).isEqualByComparingTo("1");
            assertThat(notices(r)).anySatisfy(t -> assertThat(t).contains("倍率 80").contains("没有改").contains("按 1 计"));

            // 对照:有表档案权限的人导入,倍率照旧写回(G7)
            importRow(admin(), name, "2076-03", "50", "3");
            assertThat(factorOf(id)).isEqualByComparingTo("50");
            assertThat(snapOf(id, "2076-03")).isEqualByComparingTo("50");
        } finally {
            dropReadings("2076-01", "2076-02", "2076-03");
            cleanup(clerk);
        }
    }

    /** 新建的表照取本行倍率:档案里还没有旧值可护,专员新上的表要能带着真实倍率进来。 */
    @Test
    void clerkStillCreatesNewMetersWithTheRowsFactor() throws Exception {
        String clerk = mkUser(admin(), "it-f15n", "finance_clerk");
        String name = "ITF15新表" + System.nanoTime();
        try {
            String r = importRow(login(clerk, PASS), name, "2076-04", "80", "1");
            int id = meterId(name);
            assertThat(factorOf(id)).isEqualByComparingTo("80");
            assertThat(snapOf(id, "2076-04")).isEqualByComparingTo("80");
            assertThat(notices(r)).noneSatisfy(t -> assertThat(t).contains("倍率"));
        } finally {
            dropReadings("2076-04");
            cleanup(clerk);
        }
    }

    /**
     * 主管当场授权了表档案权限,专员导入就能改倍率(PermissionGuard.has 认临时授权)。
     * 破坏验证:把 importRows 里的 perms.has 换成只看角色权限 → 倍率仍是 1,红。
     */
    @Test
    void clerkWithAManagersGrantCanChangeTheFactor() throws Exception {
        String a = admin();
        String clerk = mkUser(a, "it-f15g", "finance_clerk");
        String boss = mkUser(a, "it-f15b", "finance_manager");
        String name = "ITF15授权表" + System.nanoTime();
        try {
            importRow(admin(), name, "2076-05", "1", "1");
            int id = meterId(name);
            String ct = login(clerk, PASS);
            mvc.perform(post("/api/auth/elevate").header("Authorization", hdr(ct))
                    .contentType("application/json")
                    .content("{\"perms\":[\"meter-master:edit\"],\"authorizer\":\"" + boss + "\",\"password\":\"" + PASS + "\"}"))
               .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));

            String r = importRow(ct, name, "2076-06", "80", "2");
            assertThat(factorOf(id)).isEqualByComparingTo("80");
            assertThat(snapOf(id, "2076-06")).isEqualByComparingTo("80");
            assertThat(notices(r)).noneSatisfy(t -> assertThat(t).contains("没有改"));
        } finally {
            dropReadings("2076-05", "2076-06");
            cleanup(clerk); cleanup(boss);
        }
    }

    /**
     * 原样重导一本旧册不改计费(对抗复查发现的回归):主管按 G7 导过旧册,那个月的快照是旧倍率 80、档案是 1。
     * 专员原样重导同一行(行倍率 80 = 已存快照)什么都没想改 —— 快照不许被改成档案的 1,也不该出提示。
     * 同一本旧册里还没有读数的月份,专员带 80 进来照样被拒(那是在定历史倍率,归表档案)。
     * 破坏验证:把判定改回「只和档案比」→ 第一段快照变成 1,红。
     */
    @Test
    void clerkReimportingAnOldLedgerKeepsTheStoredSnapshot() throws Exception {
        String clerk = mkUser(admin(), "it-f15h", "finance_clerk");
        String name = "ITF15旧册表" + System.nanoTime();
        try {
            importRow(admin(), name, "2076-09", "1", "9");    // 最新月:档案 1
            int id = meterId(name);
            importRow(admin(), name, "2076-07", "80", "7");   // 旧册:只进快照 80(G7)
            assertThat(snapOf(id, "2076-07")).isEqualByComparingTo("80");

            String same = importRow(login(clerk, PASS), name, "2076-07", "80", "7");
            assertThat(snapOf(id, "2076-07")).as("原样重导,快照不动").isEqualByComparingTo("80");
            assertThat(factorOf(id)).isEqualByComparingTo("1");
            assertThat(notices(same)).noneSatisfy(t -> assertThat(t).contains("倍率"));

            String fresh = importRow(login(clerk, PASS), name, "2076-08", "80", "8");
            assertThat(snapOf(id, "2076-08")).as("没有读数的旧月带新倍率 → 按档案").isEqualByComparingTo("1");
            assertThat(notices(fresh)).anySatisfy(t -> assertThat(t).contains("倍率 80").contains("没有改"));
        } finally {
            dropReadings("2076-07", "2076-08", "2076-09");
            cleanup(clerk);
        }
    }

    // ══════════ helpers ══════════

    private String importRow(String token, String name, String ym, String factor, String curr) throws Exception {
        String r = body(mvc.perform(post("/api/meters/import").header("Authorization", hdr(token))
                .contentType("application/json")
                .content("{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"" + name + "\",\"ym\":\"" + ym
                        + "\",\"factor\":" + factor + ",\"prevTotal\":0,\"currTotal\":" + curr + "}]}"))
                .andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(r, "$.code")).as("导入应成功:%s", r).isZero();
        return r;
    }

    private List<String> notices(String importResult) {
        return JsonPath.read(importResult, "$.data.notices[*].reason");
    }

    private int meterId(String name) {
        return jdbc.queryForObject("SELECT id FROM meter WHERE name = ?", Integer.class, name);
    }

    private BigDecimal factorOf(int id) {
        return jdbc.queryForObject("SELECT factor FROM meter WHERE id = ?", BigDecimal.class, id);
    }

    private BigDecimal snapOf(int id, String ym) {
        return jdbc.queryForObject("SELECT factor_snap FROM meter_reading WHERE meter_id = ? AND ym = ?", BigDecimal.class, id, ym);
    }

    /** 按月批删读数(默认连带删空表档案):按月份先后删完,最后一个月删掉时这块表也一起没了。 */
    private void dropReadings(String... yms) throws Exception {
        String t = admin();
        for (String ym : yms)
            mvc.perform(delete("/api/meters/readings").param("ym", ym).header("Authorization", hdr(t)));
    }

    private String login(String user, String pass) throws Exception {
        String b = body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}")).andReturn());
        return JsonPath.read(b, "$.data.token");
    }

    private String admin() throws Exception { return login("admin", "admin123"); }
    private String hdr(String t) { return "Bearer " + t; }

    private String body(MvcResult r) throws Exception {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private String mkUser(String adminToken, String prefix, String roleCode) throws Exception {
        String uname = prefix + "-" + System.nanoTime();
        String roles = body(mvc.perform(get("/api/system/roles").header("Authorization", hdr(adminToken))).andReturn());
        List<Integer> ids = JsonPath.read(roles, "$.data[?(@.code=='" + roleCode + "')].id");
        mvc.perform(post("/api/system/users").header("Authorization", hdr(adminToken))
            .contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"displayName\":\"倍率权限测试\","
                   + "\"password\":\"" + PASS + "\",\"roleIds\":[" + ids.get(0) + "]}"))
           .andExpect(status().isOk());
        passwordAlreadyChanged(uname);
        return uname;
    }

    private void cleanup(String username) throws Exception {
        String t = admin();
        String b = body(mvc.perform(get("/api/system/users").param("q", username)
            .header("Authorization", hdr(t))).andReturn());
        List<Integer> ids = JsonPath.read(b, "$.data[*].id");
        for (Integer id : ids)
            mvc.perform(post("/api/system/users/" + id + "/status").header("Authorization", hdr(t))
                .contentType("application/json").content("{\"status\":0}"));
    }
}
