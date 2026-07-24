package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 租金阶梯期读写 IT(CONTRACT-CARD-V2-SPEC §7):详情带出 rentTiers / PUT 整组替换 /
 * 空列表清空 / 不传=不动 / 多费项按 fee_key,seq 排序 / 相对期限(空日期)往返。
 * 阶梯=参考排程,不参与计费(§1)——本 IT 只断读写往返,不碰任何计费口径。
 * 共享单例容器:@Transactional 回滚不污染种子;2099 年槽 + 纳秒唯一合同号(禁顺序依赖断言)。
 */
@AutoConfigureMockMvc
@Transactional
class ContractRentTierApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;
    private int tid, bid;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
        tid = ((List<Integer>) JsonPath.read(getBody("/api/tenants"), "$.data[*].id")).get(0);
        bid = ((List<Integer>) JsonPath.read(getBody("/api/buildings"), "$.data[*].id")).get(0);
    }

    private String getBody(String url) throws Exception {
        return mvc.perform(get(url).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
    }

    /** 自建 2099 槽合同;extra=追加 JSON 字段(如 "\"rentTiers\":[...]"),返回 id */
    private int newContract(String extra) throws Exception {
        String body = mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"IT-RT-" + System.nanoTime() + "\",\"tenantId\":" + tid
                        + ",\"buildingId\":" + bid + ",\"rentArea\":100,\"monthlyRent\":1,\"deposit\":0,"
                        + (extra == null || extra.isBlank() ? "" : extra + ",")
                        + "\"startDate\":\"2099-01-01\",\"endDate\":\"2099-12-31\",\"status\":\"active\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.id");
    }

    private ResultActions putContract(int id, String no, String extra) throws Exception {
        return mvc.perform(put("/api/contracts/" + id)
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"" + no + "\",\"tenantId\":" + tid + ",\"buildingId\":" + bid
                        + ",\"rentArea\":100,\"monthlyRent\":1,\"deposit\":0,"
                        + (extra == null || extra.isBlank() ? "" : extra + ",")
                        + "\"startDate\":\"2099-01-01\",\"endDate\":\"2099-12-31\",\"status\":\"active\"}"));
    }

    private String noOf(int id) throws Exception {
        return JsonPath.read(getBody("/api/contracts/" + id), "$.data.contract.contractNo");
    }

    // 锚点=周兴 S10-0074:2 段,第 2 段 2024-08-10~2026-08-09 单价 14.282(V2-SPEC §10①)
    private static final String TWO_TIERS = "\"rentTiers\":["
            + "{\"seq\":1,\"label\":\"第1年\",\"startDate\":\"2023-08-10\",\"endDate\":\"2024-08-09\","
            + "\"unitPrice\":12.231,\"monthlyAmount\":4770},"
            + "{\"seq\":2,\"label\":\"第2-3年\",\"startDate\":\"2024-08-10\",\"endDate\":\"2026-08-09\","
            + "\"unitPrice\":14.282,\"monthlyAmount\":5570}]";

    // ─── 详情带出 + PUT 整组替换 + 空列表清空(§7) ─────────────

    @Test
    void detailCarriesTiers_putReplacesWholeGroup_emptyClears() throws Exception {
        int id = newContract(TWO_TIERS);

        String d = getBody("/api/contracts/" + id);
        assertThat((List<Integer>) JsonPath.read(d, "$.data.rentTiers[*].seq")).containsExactly(1, 2);
        assertThat((Double) JsonPath.read(d, "$.data.rentTiers[0].unitPrice")).isEqualTo(12.231);
        assertThat((Double) JsonPath.read(d, "$.data.rentTiers[1].unitPrice")).isEqualTo(14.282);
        assertThat((Double) JsonPath.read(d, "$.data.rentTiers[1].monthlyAmount")).isEqualTo(5570.0);
        assertThat((String) JsonPath.read(d, "$.data.rentTiers[1].startDate")).isEqualTo("2024-08-10");
        assertThat((Integer) JsonPath.read(d, "$.data.rentTiers[0].contractId")).isEqualTo(id);

        // PUT 传 1 段 → 整组替换为 1 段
        String no = noOf(id);
        putContract(id, no, "\"rentTiers\":[{\"seq\":1,\"label\":\"唯一档\",\"unitPrice\":20}]")
                .andExpect(jsonPath("$.code").value(0));
        d = getBody("/api/contracts/" + id);
        assertThat((List<Object>) JsonPath.read(d, "$.data.rentTiers[*]")).hasSize(1);
        assertThat((String) JsonPath.read(d, "$.data.rentTiers[0].label")).isEqualTo("唯一档");

        // PUT 传空列表 → 清空
        putContract(id, no, "\"rentTiers\":[]").andExpect(jsonPath("$.code").value(0));
        assertThat((List<Object>) JsonPath.read(getBody("/api/contracts/" + id), "$.data.rentTiers[*]")).isEmpty();
    }

    // ─── 不传 rentTiers = 不动(与 billingLines 同构) ──────────

    @Test
    void putWithoutTiers_leavesThemUntouched() throws Exception {
        int id = newContract(TWO_TIERS);
        putContract(id, noOf(id), null).andExpect(jsonPath("$.code").value(0));
        assertThat((List<Object>) JsonPath.read(getBody("/api/contracts/" + id), "$.data.rentTiers[*]")).hasSize(2);
    }

    // ─── 多费项分档(力灏式各费项各自分档)按 fee_key,seq 排序 + 相对期限往返 ─────

    @Test
    void multiFeeKeyOrdered_andRelativeTermKeepsNullDates() throws Exception {
        int id = newContract("\"rentTiers\":["
                + "{\"feeKey\":\"mgmt\",\"seq\":1,\"label\":\"管理费首年\",\"unitPrice\":5.45},"
                + "{\"feeKey\":\"rent_factory\",\"seq\":2,\"label\":\"第四年至第六年\",\"unitPrice\":18.6},"
                + "{\"feeKey\":\"rent_factory\",\"seq\":1,\"label\":\"首年至第三年\",\"unitPrice\":16.92}]");
        String d = getBody("/api/contracts/" + id);
        assertThat((List<String>) JsonPath.read(d, "$.data.rentTiers[*].feeKey"))
                .containsExactly("mgmt", "rent_factory", "rent_factory");
        assertThat((List<String>) JsonPath.read(d, "$.data.rentTiers[*].label"))
                .containsExactly("管理费首年", "首年至第三年", "第四年至第六年");
        // 相对期限:起止空 → 原样带出 null(前端据此不判定当前段)
        assertThat((Object) JsonPath.read(d, "$.data.rentTiers[1].startDate")).isNull();
        assertThat((Object) JsonPath.read(d, "$.data.rentTiers[1].endDate")).isNull();
    }

    // ─── seq 缺省按下标补(1 起) ────────────────────────────

    @Test
    void missingSeq_backfilledByIndex() throws Exception {
        int id = newContract("\"rentTiers\":[{\"label\":\"A\"},{\"label\":\"B\"},{\"label\":\"C\"}]");
        assertThat((List<Integer>) JsonPath.read(getBody("/api/contracts/" + id), "$.data.rentTiers[*].seq"))
                .containsExactly(1, 2, 3);
    }
}
