package com.park.demo3.api;
import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 种子两本账天然重叠(台账 2026-1..5 × s10 2024..2026-06):对照用 2026-03,mark 往返用 2026-04
// (其余 IT 只动 2026-05/06/09/11/12,不干扰)。
@AutoConfigureMockMvc
class ReconApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }
    private String auth() { return "Bearer " + token; }
    private static String utf8(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }
    private String getMonth(int year, int month) throws Exception {
        return utf8(mvc.perform(get("/api/recon/" + year + "/" + month).header("Authorization", auth()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)).andReturn());
    }

    // ── 重叠月 2026-03:实体非空;status 全∈{ok,diff,miss} 且存在 diff(两本账种子不同源);delta=ledgerAmt−s10Amt ──
    @Test
    void recon_month_overlap_hasEntities_andStatuses() throws Exception {
        String res = getMonth(2026, 3);
        List<String> statuses = JsonPath.read(res, "$.data.entities[*].status");
        assertThat(statuses).isNotEmpty()
                .allMatch(s -> Set.of("ok", "diff", "miss").contains(s))
                .contains("diff");
        // 任取实体一条两侧都有值的科目行:delta = ledgerAmt − s10Amt
        List<Map<String, Object>> lines = JsonPath.read(res,
                "$.data.entities[0].fees[?(@.ledgerAmt != null && @.s10Amt != null)]");
        assertThat(lines).isNotEmpty();
        double l = ((Number) lines.get(0).get("ledgerAmt")).doubleValue();
        double s = ((Number) lines.get(0).get("s10Amt")).doubleValue();
        double d = ((Number) lines.get(0).get("delta")).doubleValue();
        assertThat(d).isCloseTo(l - s, within(0.001));
    }

    // ── 软引用归并(E1):s10 种子行 tenant_id 非空 → 实体 tenantId 非空且名=公司名,双源卡片都有 ──
    @Test
    void recon_softRef_mergesByName() throws Exception {
        String res = getMonth(2026, 3);
        List<Map<String, Object>> hit = JsonPath.read(res,
                "$.data.entities[?(@.tenantName == '中誉机械重工')]");
        assertThat(hit).isNotEmpty();
        assertThat(((Number) hit.get(0).get("tenantId")).intValue()).isEqualTo(1);
        assertThat((List<?>) hit.get(0).get("ledgerCards")).isNotEmpty();
        assertThat((List<?>) hit.get(0).get("s10Cards")).isNotEmpty();
    }

    // ── mark 往返(E5):POST(note A)→marked+note;再 POST(note B)→upsert 更新;DELETE→marked=false ──
    @Test
    void recon_mark_upsert_delete_roundtrip() throws Exception {
        mvc.perform(post("/api/recon/2026/4/mark").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantName\":\"锐通电子\",\"tenantId\":2,\"note\":\"备注A\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.note").value("备注A"));
        List<Map<String, Object>> hit = JsonPath.read(getMonth(2026, 4),
                "$.data.entities[?(@.tenantName == '锐通电子')]");
        assertThat(hit).isNotEmpty();
        assertThat((Boolean) hit.get(0).get("marked")).isTrue();
        assertThat((String) hit.get(0).get("markNote")).isEqualTo("备注A");

        // 同键再 POST → uk 冲突 upsert note
        mvc.perform(post("/api/recon/2026/4/mark").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantName\":\"锐通电子\",\"tenantId\":2,\"note\":\"备注B\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.note").value("备注B"));
        hit = JsonPath.read(getMonth(2026, 4), "$.data.entities[?(@.tenantName == '锐通电子')]");
        assertThat((String) hit.get(0).get("markNote")).isEqualTo("备注B");

        // DELETE → 取消核实
        mvc.perform(delete("/api/recon/2026/4/mark").param("tenantName", "锐通电子")
                .header("Authorization", auth()))
                .andExpect(status().isOk());
        hit = JsonPath.read(getMonth(2026, 4), "$.data.entities[?(@.tenantName == '锐通电子')]");
        assertThat((Boolean) hit.get(0).get("marked")).isFalse();
        assertThat(hit.get(0).get("markNote")).isNull();
    }

    // ── overview?year=2026:month 3 hasData=true 且 entityCount=ok+diff+miss;缺省 year=最大数据年 2026 ──
    @Test
    void recon_overview_counts() throws Exception {
        String res = utf8(mvc.perform(get("/api/recon/overview").param("year", "2026")
                .header("Authorization", auth()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat(((Number) JsonPath.read(res, "$.data.year")).intValue()).isEqualTo(2026);
        assertThat((Boolean) JsonPath.read(res, "$.data.months[2].hasData")).isTrue();   // 3 月
        int entityCount = ((Number) JsonPath.read(res, "$.data.months[2].entityCount")).intValue();
        int ok = ((Number) JsonPath.read(res, "$.data.months[2].okCount")).intValue();
        int diff = ((Number) JsonPath.read(res, "$.data.months[2].diffCount")).intValue();
        int miss = ((Number) JsonPath.read(res, "$.data.months[2].missCount")).intValue();
        assertThat(entityCount).isGreaterThan(0).isEqualTo(ok + diff + miss);

        String def = utf8(mvc.perform(get("/api/recon/overview").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(def, "$.data.year")).intValue()).isEqualTo(2026);
    }

    // ── 无 token → 401 ──
    @Test
    void noToken_401() throws Exception {
        mvc.perform(get("/api/recon/overview")).andExpect(status().isUnauthorized());
    }
}
