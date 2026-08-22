package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 操作日志时间线与两个留痕缺口（RBAC-SPEC §7 / P2）。
 *
 * 缺口的要害不是"没有日志"，是**先删后插之后旧值再也查不回来**。所以下面两条不只断言
 * "写了一条"，而是断言那条记录里**留住了改之前的值**。
 */
@AutoConfigureMockMvc
class AuditLogApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;

    private String token(String u, String p) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + u + "\",\"password\":\"" + p + "\"}"))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.token");
    }

    private String admin() throws Exception { return token("admin", "admin123"); }

    private String utf8(org.springframework.test.web.servlet.MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), java.nio.charset.StandardCharsets.UTF_8);
    }

    private String logs(String query) throws Exception {
        return utf8(mvc.perform(get("/api/system/logs" + query)
                .header("Authorization", "Bearer " + admin()))
                .andExpect(status().isOk()).andReturn());
    }

    // ══════════ 时间线 ══════════

    @Test
    void timelineUnionsThreeSources() throws Exception {
        String body = logs("?size=200");
        assertThat((int) JsonPath.read(body, "$.code")).isEqualTo(0);
        List<String> sources = JsonPath.read(body, "$.data.rows[*].source");
        // 种子库里 param_change_log 与 import_log 都有行；auth_audit_log 可能为空（没人建过账号）
        assertThat(sources).as("三张来源表要合到一条时间线上").isNotEmpty();
        assertThat(sources).allMatch(s -> List.of("param", "import", "auth").contains(s));
        long total = ((Number) JsonPath.read(body, "$.data.total")).longValue();
        assertThat(total).isGreaterThan(0);
    }

    @Test
    void timelineIsDescendingByTime() throws Exception {
        List<String> ts = JsonPath.read(logs("?size=50"), "$.data.rows[*].ts");
        assertThat(ts).as("按时间倒序 —— 最近做的事在最上面")
            .isSortedAccordingTo((a, b) -> b.compareTo(a));
    }

    @Test
    void sourceFilterSkipsOtherBranches() throws Exception {
        // ⚠ 不能假设某一路一定有数据：测试库是迁移种子建的，param_change_log 有行
        //    （V96–V100 灌的），import_log / auth_audit_log 都是空的 —— 那 89 条导入记录
        //    是 dev 库里真实用出来的。所以这里用**数据无关**的断言。
        long all = total(logs("?size=1"));
        long param = total(logs("?src=param&size=1"));
        long imp = total(logs("?src=import&size=1"));
        long auth = total(logs("?src=auth&size=1"));

        assertThat(param + imp + auth)
            .as("三路之和必须等于不筛的总数 —— 不等就说明筛选没真的下推到各分支")
            .isEqualTo(all);
        assertThat(param).as("param_change_log 有迁移种子，这一路一定有行").isGreaterThan(0);

        // 有行的那一路，回来的 source 必须全是它
        List<String> only = JsonPath.read(logs("?src=param&size=50"), "$.data.rows[*].source");
        assertThat(only).isNotEmpty().allMatch("param"::equals);
    }

    private static long total(String body) {
        return ((Number) JsonPath.read(body, "$.data.total")).longValue();
    }

    @Test
    void unknownSourceIsRejected() throws Exception {
        String body = utf8(mvc.perform(get("/api/system/logs").param("src", "god-mode")
                .header("Authorization", "Bearer " + admin())).andReturn());
        assertThat((int) JsonPath.read(body, "$.code")).isEqualTo(400);
    }

    @Test
    void paginationIsDoneInSql() throws Exception {
        // 不是捞全量再切：两页的行不能重叠。
        // ⚠ 不能拿 ts 当身份 —— 种子日志是批量插的，一秒里几十行。正因为如此，
        //    ORDER BY 里必须带来源表 id 做末位键，否则 MySQL 对并列行的顺序不保证，
        //    同一行会在两页都出现、另一行谁也见不着。这条测试就是钉这个的。
        List<String> p1 = rowKeys(logs("?size=5&page=1"));
        List<String> p2 = rowKeys(logs("?size=5&page=2"));
        assertThat(p1).hasSize(5);
        assertThat(p2).isNotEmpty();
        assertThat(p1).as("翻页不得重复出行（排序必须是全序）").doesNotContainAnyElementsOf(p2);

        // 且两页拼起来 = 直接取 10 行的前 10（顺序一致）
        List<String> ten = rowKeys(logs("?size=10&page=1"));
        List<String> joined = new java.util.ArrayList<>(p1);
        joined.addAll(p2);
        assertThat(joined).as("分页切出来的顺序要和整体一致").isEqualTo(ten);
    }

    /** 一行的指纹：ts+source+target+detail 足以区分（没有跨表统一 id 可用）。 */
    private static List<String> rowKeys(String body) {
        List<String> ts = JsonPath.read(body, "$.data.rows[*].ts");
        List<String> src = JsonPath.read(body, "$.data.rows[*].source");
        List<String> tgt = JsonPath.read(body, "$.data.rows[*].target");
        List<String> det = JsonPath.read(body, "$.data.rows[*].detail");
        List<String> out = new java.util.ArrayList<>();
        for (int i = 0; i < ts.size(); i++) {
            out.add(ts.get(i) + "|" + src.get(i) + "|" + tgt.get(i) + "|" + det.get(i));
        }
        return out;
    }

    @Test
    void systemLogsRequireSystemView() throws Exception {
        // 日志里有谁在什么时候改了什么，不能给零权限账号看
        mvc.perform(get("/api/system/logs").header("Authorization", "Bearer " + token("viewer", "viewer123")))
           .andExpect(status().isForbidden());
    }

    // ══════════ 留痕缺口一：公摊规则（系数簿改层份走的就是这条） ══════════

    @Test
    @Transactional
    void ruleChangeKeepsTheOldValueThatDeleteThenInsertWouldDestroy() throws Exception {
        String t = admin();
        String rulesJson = utf8(mvc.perform(get("/api/alloc/rules").header("Authorization", "Bearer " + t))
                .andExpect(status().isOk()).andReturn());

        var om = new com.fasterxml.jackson.databind.ObjectMapper();
        var root = om.readTree(rulesJson).get("data");
        assertThat(root.isArray() && root.size() > 0).as("种子库里应有公摊规则").isTrue();

        // 挑一个受益人非空的池 —— 只有它才能证明「改之前有几户」被留住了
        com.fasterxml.jackson.databind.JsonNode target = null;
        for (var n : root) {
            if (n.hasNonNull("members") && n.get("members").size() > 0) { target = n; break; }
        }
        assertThat(target).as("需要一个带受益人的池来验证旧值留痕").isNotNull();
        int ruleId = target.get("id").asInt();
        int wasCount = target.get("members").size();

        // 用 Jackson 精确改 members（正则改 JSON 太脆：members 里是对象，方括号会提前闭合）。
        // 去掉最后一户 → N → N-1
        var body = (com.fasterxml.jackson.databind.node.ObjectNode) target.deepCopy();
        var members = (com.fasterxml.jackson.databind.node.ArrayNode) body.get("members");
        members.remove(members.size() - 1);
        int nowCount = members.size();

        mvc.perform(put("/api/alloc/rules/" + ruleId).header("Authorization", "Bearer " + t)
                .contentType("application/json").content(om.writeValueAsString(body)))
           .andExpect(status().isOk());

        String logBody = logs("?src=param&size=20");
        List<String> targets = JsonPath.read(logBody, "$.data.rows[*].target");
        List<String> details = JsonPath.read(logBody, "$.data.rows[*].detail");
        assertThat(targets).as("规则变更落在 rule:{id} 这个 scope 上").contains("rule:" + ruleId);
        assertThat(details).as("必须记下改之前是几户 —— updateRule 内部先删后插，"
                + "不在删之前抓旧值的话这个数字再也查不回来")
            .anySatisfy(d -> assertThat(d).contains("受益人 " + wasCount + "→" + nowCount));
    }

    // ══════════ 留痕缺口二：单元面积（面积污染炸过一次） ══════════

    @Test
    @Transactional
    void unitAreaChangeIsRecordedWithBothOldAndNew() throws Exception {
        String t = admin();
        String buildings = utf8(mvc.perform(get("/api/buildings").header("Authorization", "Bearer " + t))
                .andExpect(status().isOk()).andReturn());
        List<Integer> bids = JsonPath.read(buildings, "$.data[*].id");
        assertThat(bids).isNotEmpty();

        String detail = utf8(mvc.perform(get("/api/buildings/" + bids.get(0))
                .header("Authorization", "Bearer " + t)).andExpect(status().isOk()).andReturn());
        List<Integer> uids = JsonPath.read(detail, "$.data.units[*].id");
        assertThat(uids).as("该楼栋应有单元").isNotEmpty();
        int unitId = uids.get(0);
        String unitNo = ((List<String>) JsonPath.read(detail, "$.data.units[*].unitNo")).get(0);
        Integer floor = ((List<Integer>) JsonPath.read(detail, "$.data.units[*].floor")).get(0);

        mvc.perform(put("/api/units/" + unitId).header("Authorization", "Bearer " + t)
                .contentType("application/json")
                .content("{\"floor\":" + floor + ",\"unitNo\":\"" + unitNo + "\",\"area\":1234.56}"))
           .andExpect(status().isOk());

        String body = logs("?src=param&size=20");
        List<String> targets = JsonPath.read(body, "$.data.rows[*].target");
        List<String> details = JsonPath.read(body, "$.data.rows[*].detail");
        assertThat(targets).as("面积变更落在 unit:{id} · area").anyMatch(x -> x.startsWith("unit:" + unitId));
        assertThat(details).as("新值要在 detail 里（old → new 两列拼出来的）")
            .anySatisfy(d -> assertThat(d).contains("1234.56"));
    }

    @Test
    @Transactional
    void unitAreaUnchangedWritesNoLog() throws Exception {
        // 改楼层不改面积不该刷屏 —— 日志被噪声淹掉就没人看了
        String t = admin();
        String buildings = utf8(mvc.perform(get("/api/buildings").header("Authorization", "Bearer " + t)).andReturn());
        int bid = ((List<Integer>) JsonPath.read(buildings, "$.data[*].id")).get(0);
        String detail = utf8(mvc.perform(get("/api/buildings/" + bid).header("Authorization", "Bearer " + t)).andReturn());
        int unitId = ((List<Integer>) JsonPath.read(detail, "$.data.units[*].id")).get(0);
        String unitNo = ((List<String>) JsonPath.read(detail, "$.data.units[*].unitNo")).get(0);
        Integer floor = ((List<Integer>) JsonPath.read(detail, "$.data.units[*].floor")).get(0);
        Object area = ((List<Object>) JsonPath.read(detail, "$.data.units[*].area")).get(0);

        long before = ((Number) JsonPath.read(logs("?src=param&size=1"), "$.data.total")).longValue();
        mvc.perform(put("/api/units/" + unitId).header("Authorization", "Bearer " + t)
                .contentType("application/json")
                .content("{\"floor\":" + floor + ",\"unitNo\":\"" + unitNo + "\",\"area\":" + area + "}"))
           .andExpect(status().isOk());
        long after = ((Number) JsonPath.read(logs("?src=param&size=1"), "$.data.total")).longValue();
        assertThat(after).as("面积没变就不该写日志").isEqualTo(before);
    }
}
