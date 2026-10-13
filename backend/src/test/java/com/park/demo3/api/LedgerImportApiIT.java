/* Copyright (c) 2026 Junyang. All rights reserved. */
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
class LedgerImportApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }

    private String auth() { return "Bearer " + token; }

    private static String utf8(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    // ── 正常导入 upsert + 未匹配租户落为未绑定行(V105) + 未导入的其他租户行未被改/删 ──
    @Test
    void import_upsertMatched_keepsUnmatchedAsUnbound_andLeavesOthersUntouched() throws Exception {
        // 用一个干净未来月(2026/12,无 seed),先种一行 tenant 2 作为"未在本次导入里的其他租户行"
        String seedOther = "{\"rows\":[{\"tenantId\":2,\"factoryRent\":7777}]}";
        mvc.perform(put("/api/ledger/companies/1/months/2026/12").header("Authorization", auth())
                .contentType("application/json").content(seedOther))
                .andExpect(status().isOk());

        // 导入:tenant 1 (中誉机械重工 = 在租) 命中;一个档案里没有的名字 → 不再跳过,落为未绑定行
        String importBody = "{\"rows\":["
                + "{\"tenantName\":\"中誉机械重工\",\"factoryRent\":50000},"
                + "{\"tenantName\":\"查无此租户\",\"factoryRent\":123}"
                + "]}";
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "12")
                .header("Authorization", auth())
                .contentType("application/json").content(importBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0));

        // 读回本月:tenant 1 收到导入值;tenant 2 旧值未被抹/改;未绑定行(账面名原文)在场且 tenantId=null
        String month = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/12")
                .header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        List<Integer> ids = JsonPath.read(month, "$.data.rows[*].tenantId");
        int idx1 = ids.indexOf(1), idx2 = ids.indexOf(2);
        assertThat(((Number) JsonPath.read(month, "$.data.rows[" + idx1 + "].factoryRent")).doubleValue())
                .isEqualTo(50000.0);
        // tenant 2 未在本次导入里 → 其 7777 行未被改/删
        assertThat(((Number) JsonPath.read(month, "$.data.rows[" + idx2 + "].factoryRent")).doubleValue())
                .isEqualTo(7777.0);
        List<String> names = JsonPath.read(month, "$.data.rows[*].tenantName");
        int idxU = names.indexOf("查无此租户");
        assertThat(idxU).isGreaterThanOrEqualTo(0);
        assertThat((Object) JsonPath.read(month, "$.data.rows[" + idxU + "].tenantId")).isNull();
        assertThat(((Number) JsonPath.read(month, "$.data.rows[" + idxU + "].factoryRent")).doubleValue())
                .isEqualTo(123.0);
        Integer unboundRowId = JsonPath.read(month, "$.data.rows[" + idxU + "].id");

        // 同名未绑定行重导 = upsert 覆盖,不产生第二行(uk 对 NULL 不去重,靠代码级按名归并)
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "12")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"查无此租户\",\"factoryRent\":456}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        String monthU = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/12")
                .header("Authorization", auth())).andReturn());
        List<String> namesU = JsonPath.read(monthU, "$.data.rows[*].tenantName");
        assertThat(namesU.stream().filter("查无此租户"::equals).count()).isEqualTo(1);

        // 绑定:把未绑定行挂到 tenant 3 → tenantId 落位,账面名快照保留原文
        mvc.perform(put("/api/ledger/bind-tenant").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantName\":\"查无此租户\",\"tenantId\":3}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.bound").value(1))
                .andExpect(jsonPath("$.data.conflicts").value(0));
        String monthB = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/12")
                .header("Authorization", auth())).andReturn());
        List<String> namesB = JsonPath.read(monthB, "$.data.rows[*].tenantName");
        int idxB = namesB.indexOf("查无此租户");
        assertThat(((Number) JsonPath.read(monthB, "$.data.rows[" + idxB + "].tenantId")).intValue()).isEqualTo(3);
        assertThat((Object) JsonPath.read(monthB, "$.data.rows[" + idxB + "].id")).isEqualTo(unboundRowId);

        // 行级解绑:tenantId=null → 回到未绑定;再绑到 tenant 2(该月已有 7777 行)→ 409;重绑 3 → ok
        mvc.perform(patch("/api/ledger/rows/" + unboundRowId + "/tenant").header("Authorization", auth())
                .contentType("application/json").content("{\"tenantId\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.tenantId").doesNotExist());
        mvc.perform(patch("/api/ledger/rows/" + unboundRowId + "/tenant").header("Authorization", auth())
                .contentType("application/json").content("{\"tenantId\":2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409));
        mvc.perform(patch("/api/ledger/rows/" + unboundRowId + "/tenant").header("Authorization", auth())
                .contentType("application/json").content("{\"tenantId\":3}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.tenantId").value(3))
                .andExpect(jsonPath("$.data.tenantName").value("查无此租户"));   // 账面名快照不动

        // 二次导入同租户 → update(upsert,非新增):tenant 1 改成 60000
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "12")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"中誉机械重工\",\"factoryRent\":60000}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        String month2 = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/12")
                .header("Authorization", auth())).andReturn());
        List<Integer> ids2 = JsonPath.read(month2, "$.data.rows[*].tenantId");
        assertThat(((Number) JsonPath.read(month2, "$.data.rows[" + ids2.indexOf(1) + "].factoryRent")).doubleValue())
                .isEqualTo(60000.0);

        // 清理:blank tenant 1 / 2 / 3(原「查无此租户」已绑到 3)让重跑确定性
        mvc.perform(put("/api/ledger/companies/1/months/2026/12").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":1},{\"tenantId\":2},{\"tenantId\":3}]}"))
                .andExpect(status().isOk());
    }

    @Test
    void import_withoutToken_returns401() throws Exception {
        mvc.perform(post("/api/ledger/companies/1/import").param("year", "2026").param("month", "12")
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isUnauthorized());
    }

    // ── 导入预演(核对页 5 列,用户 2026-10-14 选「后端预演」):数字 = 真导进去以后的数,而且不落库 ──
    // 破坏验证:previewImport 去掉 setRollbackOnly → 「不落库」两句红;上月结余改取文件值(seedable 恒真)→ 600 那句红
    @Test
    void preview_sameNumbersAsTheRealImport_chainWinsOverFile_andWritesNothing() throws Exception {
        // 2095 年没有别的用例用台账。3 月:中誉机械重工 应收 1000、收 400 → 期末 600,4 月的上月结余在链上是派生位
        mvc.perform(put("/api/ledger/companies/1/months/2095/3").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":1,\"balancePrev\":0,\"factoryRent\":1000,\"totalCollected\":400}]}"))
                .andExpect(status().isOk());
        String body = "{\"rows\":["
                + "{\"tenantName\":\"中誉机械重工\",\"balancePrev\":99999,\"factoryRent\":500,\"totalCollected\":200},"
                + "{\"tenantName\":\"预演查无此户\",\"factoryRent\":123},"
                + "{\"tenantName\":\"预演全零行\"}"
                + "]}";
        Object before3 = monthData(2095, 3), before4 = monthData(2095, 4);

        String pv = utf8(mvc.perform(post("/api/ledger/companies/1/import/preview")
                .param("year", "2095").param("month", "4").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)).andReturn());
        // 文件写的上月结余 99999,链上是 3 月期末 600:预演照导入的规矩取 600
        assertThat(num(pv, "$.data.rows[0].balancePrev")).isEqualTo(600.0);
        assertThat(num(pv, "$.data.rows[0].totalReceivable")).isEqualTo(500.0);
        assertThat(num(pv, "$.data.rows[0].totalCollected")).isEqualTo(200.0);
        assertThat(num(pv, "$.data.rows[0].balanceEnd")).isEqualTo(900.0);
        assertThat(num(pv, "$.data.rows[1].balanceEnd")).isEqualTo(123.0);
        List<Integer> idx = JsonPath.read(pv, "$.data.rows[*].rowIndex");
        assertThat(idx).as("全零行不在里面").containsExactly(0, 1);
        assertThat((Integer) JsonPath.read(pv, "$.data.errors[0].rowIndex")).isEqualTo(2);
        // 不落库:两个月读回来和预演前一样
        assertThat(monthData(2095, 3)).as("3 月").isEqualTo(before3);
        assertThat(monthData(2095, 4)).as("4 月").isEqualTo(before4);

        // 真导一次:库里那户的四个数 = 预演给的
        mvc.perform(post("/api/ledger/companies/1/import").param("year", "2095").param("month", "4")
                .header("Authorization", auth()).contentType("application/json").content(body))
                .andExpect(status().isOk());
        String after = utf8(mvc.perform(get("/api/ledger/companies/1/months/2095/4").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        List<Integer> ids = JsonPath.read(after, "$.data.rows[*].tenantId");
        int i = ids.indexOf(1);
        for (String k : List.of("balancePrev", "totalReceivable", "totalCollected", "balanceEnd"))
            assertThat(num(after, "$.data.rows[" + i + "]." + k)).as(k).isEqualTo(num(pv, "$.data.rows[0]." + k));
    }

    private Object monthData(int y, int m) throws Exception {
        return JsonPath.read(utf8(mvc.perform(get("/api/ledger/companies/1/months/" + y + "/" + m)
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn()), "$.data");
    }

    private static double num(String json, String path) {
        return ((Number) JsonPath.read(json, path)).doubleValue();
    }
}
