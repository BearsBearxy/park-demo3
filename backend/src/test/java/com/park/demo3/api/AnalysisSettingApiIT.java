package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 经营分析「目标与阈值」进库(用户 2026-10-05 拍板「2按你建议，3，4一起做」第 2 条):
 * 全员看同一份;只有「账簿报表」编辑权能改;每改一项进操作日志(改前 → 改后)。
 *
 * 整类 @Transactional:建的角色、账号、设置、日志全部回滚;权限快照不随库回滚,@AfterTransaction 重载一次(同 AuditTrailIT)。
 */
@AutoConfigureMockMvc
@Transactional
class AnalysisSettingApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired com.park.demo3.security.UserPermissionCache cache;

    private static final String PASS = "init-pass-123";

    @org.springframework.test.context.transaction.AfterTransaction
    void reloadCacheAfterRollback() { cache.reload(); }

    /**
     * 破坏验证:PermissionRegistry 的 PUT 规则改成分析屏查看 → 只读的人存上了,403 那句红;
     * save() 里不调 changes.record → 记录那句红;「改前」不取默认值(没存过记 —)→ 记录那句红;
     * 去掉下限判断 → 收缴率 40 存上了,400 那句红。
     */
    @Test
    void onlyTheOwningScreensEditCanChange_everyoneReadsTheSameCopy_everyChangeIsLogged() throws Exception {
        jdbc.update("DELETE FROM analysis_setting");   // 事务里删,用例结束回滚
        String a = admin();
        String viewer = login(mkUser(a, "it-ana-view", mkRole(a, "it_ana_view", "[\"cockpit:view\"]")), PASS);
        // v4(RBAC-SPEC §15.6):六项各归一屏,收缴率目标归现金流量分析、光伏投资归光伏投资回收
        String editorName = mkUser(a, "it-ana-edit", mkRole(a, "it_ana_edit", "[\"fin-cashflow:edit\",\"pv-roi:edit\"]"));
        String editor = login(editorName, PASS);

        // 没存过:一项都不回(前端用默认值)
        assertThat(JsonPath.<Map<String, Object>>read(fetch(viewer), "$.data")).isEmpty();

        // 只有分析查看权:改不了,库里没变
        mvc.perform(put("/api/analysis/settings").header("Authorization", hdr(viewer))
                .contentType("application/json").content("{\"collectTarget\":95}"))
            .andExpect(status().isForbidden());
        assertThat(JsonPath.<Map<String, Object>>read(fetch(viewer), "$.data")).isEmpty();

        // 有账簿报表编辑权:存上;只读的人读到同一份
        String saved = save(editor, "{\"collectTarget\":95,\"pvInvestment\":1478.7}");
        assertThat((int) JsonPath.read(saved, "$.code")).as(saved).isZero();
        String seen = fetch(viewer);
        assertThat(num(seen, "$.data.collectTarget")).isEqualTo(95.0);
        assertThat(num(seen, "$.data.pvInvestment")).isEqualTo(1478.7);
        assertThat(JsonPath.<Map<String, Object>>read(seen, "$.data")).containsOnlyKeys("collectTarget", "pvInvestment");

        // 同样的值再存一次不记;光伏投资改回 0 记成人话
        save(editor, "{\"collectTarget\":95,\"pvInvestment\":0}");
        assertThat(log(editorName)).containsExactly(
            List.of("经营分析", "收缴率目标 (%)", "96", "95"),          // 没存过的项,改前 = 屏上显示的默认值
            List.of("经营分析", "光伏投资 (万)", "按各期工程成本合计", "1478.7"),
            List.of("经营分析", "光伏投资 (万)", "1478.7", "按各期工程成本合计"));

        // 只能改一项的账号:PUT 只回它送来的那几项。回整份的话,一次值没变的「保存」就把别的项读走了(对抗复查 SEC-7)。
        // 破坏验证:save() 改回 return get() → 红
        String repOnly = login(mkUser(a, "it-ana-rep", mkRole(a, "it_ana_rep", "[\"fin-cashflow:edit\"]")), PASS);
        String echo = save(repOnly, "{\"collectTarget\":95}");
        assertThat((int) JsonPath.read(echo, "$.code")).as(echo).isZero();
        assertThat(JsonPath.<Map<String, Object>>read(echo, "$.data")).containsOnlyKeys("collectTarget");

        // 每一项要它归属那一屏的编辑:只有「出租与楼栋 · 编辑」的人改收缴率目标 403、改出租率目标照存;
        // 一次带两项、其中一项不归他 → 整次 403,哪一项都不存
        // 破坏验证:AnalysisSettingService 去掉按项 require → 第一条红
        String parkOnly = login(mkUser(a, "it-ana-park", mkRole(a, "it_ana_park", "[\"park:edit\"]")), PASS);
        String denied = save(parkOnly, "{\"collectTarget\":90}");
        assertThat((int) JsonPath.read(denied, "$.code")).as(denied).isEqualTo(403);
        assertThat((String) JsonPath.read(denied, "$.message")).contains("现金流量分析 · 编辑");
        assertThat((int) JsonPath.read(save(parkOnly, "{\"occTarget\":92,\"collectTarget\":90}"), "$.code")).isEqualTo(403);
        assertThat(JsonPath.<Map<String, Object>>read(fetch(viewer), "$.data")).doesNotContainKey("occTarget");
        assertThat((int) JsonPath.read(save(parkOnly, "{\"occTarget\":92}"), "$.code")).isZero();
        assertThat(num(fetch(viewer), "$.data.occTarget")).isEqualTo(92.0);

        // 超范围 / 不认识的项:整次不存,说清哪一项、该填多少
        String bad = save(editor, "{\"churnTh\":70,\"collectTarget\":40}");
        assertThat((int) JsonPath.read(bad, "$.code")).isEqualTo(400);
        assertThat((String) JsonPath.read(bad, "$.message")).isEqualTo("「收缴率目标 (%)」要在 50 到 100 之间");
        assertThat((int) JsonPath.read(save(editor, "{\"foo\":1}"), "$.code")).isEqualTo(400);
        assertThat(JsonPath.<Map<String, Object>>read(fetch(viewer), "$.data")).doesNotContainKey("churnTh");
        assertThat(log(editorName)).hasSize(3);
    }

    // ══════════ helpers ══════════

    private List<List<String>> log(String actor) {
        return jdbc.query("SELECT row_ref, field, old_val, new_val FROM value_change_log"
                        + " WHERE tbl = 'analysis_setting' AND actor = ? ORDER BY id",
            (rs, i) -> Arrays.asList(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)), actor);   // 允许 null(— )
    }

    private static double num(String body, String path) { return ((Number) JsonPath.read(body, path)).doubleValue(); }

    private String fetch(String token) throws Exception {
        return body(mvc.perform(get("/api/analysis/settings").header("Authorization", hdr(token))).andReturn());
    }

    private String save(String token, String json) throws Exception {
        return body(mvc.perform(put("/api/analysis/settings").header("Authorization", hdr(token))
            .contentType("application/json").content(json)).andReturn());
    }

    private String admin() throws Exception { return login("admin", "admin123"); }
    private String hdr(String t) { return "Bearer " + t; }

    private String login(String user, String pass) throws Exception {
        return JsonPath.read(body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}")).andReturn()), "$.data.token");
    }

    private String body(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private int mkRole(String token, String codePrefix, String permsJson) throws Exception {
        String b = body(mvc.perform(post("/api/system/roles").header("Authorization", hdr(token))
            .contentType("application/json")
            .content("{\"code\":\"" + codePrefix + "_" + System.nanoTime() % 100000 + "\",\"name\":\"目标测试\","
                   + "\"navLayers\":[\"analysis\"],\"perms\":" + permsJson + "}")).andReturn());
        assertThat((int) JsonPath.read(b, "$.code")).as(b).isZero();
        return JsonPath.read(b, "$.data.id");
    }

    private String mkUser(String token, String prefix, int roleId) throws Exception {
        String uname = prefix + "-" + System.nanoTime();
        String b = body(mvc.perform(post("/api/system/users").header("Authorization", hdr(token))
            .contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"displayName\":\"目标测试\",\"password\":\"" + PASS
                   + "\",\"roleIds\":[" + roleId + "]}")).andReturn());
        assertThat((int) JsonPath.read(b, "$.code")).as(b).isZero();
        passwordAlreadyChanged(uname);
        return uname;
    }
}
