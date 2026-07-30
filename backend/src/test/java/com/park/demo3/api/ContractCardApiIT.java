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

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 合同卡重设计 IT(CONTRACT-CARD-SPEC V54):类型钉死越界拒绝 / 上下文费名回显 / 续签链 parentContractId /
 * effectiveStatus 日期派生 / asOfDate 某日在租过滤。共享单例容器 + @Transactional 回滚,不污染种子;
 * 派生用例用相对 today 的日期,跨日运行稳定。
 */
@AutoConfigureMockMvc
@Transactional
class ContractCardApiIT extends AbstractMysqlIT {

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

    /** POST 合同;extra=追加 JSON 字段(billingLines/startDate/endDate…),返回 ResultActions 供断言。 */
    private ResultActions postContract(String extra) throws Exception {
        return mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"IT-CC-" + System.nanoTime() + "\",\"tenantId\":" + tid
                        + ",\"buildingId\":" + bid + ",\"rentArea\":100,\"monthlyRent\":1,\"deposit\":0,"
                        + (extra == null || extra.isBlank() ? "" : extra + ",")
                        + "\"status\":\"active\"}"));
    }

    private int createOk(String extra) throws Exception {
        return JsonPath.read(postContract(extra).andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString(), "$.data.id");
    }

    // ─── 类型钉死:越界费项拒绝 ─────────────────────────────────

    @Test
    void typeNail_feeKeyOutsidePinnedSet_rejected() throws Exception {
        // factory 段填 access(门禁,dorm 专属)→ 400 越界
        postContract("\"billingLines\":[{\"propertyType\":\"factory\",\"location\":\"主\",\"feeKey\":\"access\",\"roomCount\":5}]")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("费项 access 不属于「factory」段类型"));
    }

    @Test
    void typeNail_invalidPropertyType_rejected() throws Exception {
        postContract("\"billingLines\":[{\"propertyType\":\"garage\",\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":100,\"unitPrice\":10}]")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("物业类型非法: garage"));
    }

    @Test
    void typeNail_pinnedSet_persistsWithContextualFeeName() throws Exception {
        // factory 钉死组 rent_factory/mgmt/infra 合法;条件项 elevator/可选 land_tax 合法
        int id = createOk("\"billingLines\":["
                + "{\"propertyType\":\"factory\",\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":9.6785,\"seq\":1},"
                + "{\"propertyType\":\"factory\",\"location\":\"主\",\"feeKey\":\"mgmt\",\"area\":3200,\"unitPrice\":5.45,\"seq\":2},"
                + "{\"propertyType\":\"factory\",\"location\":\"主\",\"feeKey\":\"infra\",\"area\":3200,\"unitPrice\":3,\"seq\":3},"
                + "{\"propertyType\":\"factory\",\"location\":\"主\",\"feeKey\":\"elevator\",\"amountOverride\":318,\"seq\":4},"
                + "{\"propertyType\":\"factory\",\"location\":\"主\",\"feeKey\":\"land_tax\",\"amountOverride\":50,\"seq\":5}]");
        String d = getBody("/api/contracts/" + id);
        // propertyType 往返 + 上下文费名(mgmt→厂房企业管理服务费,infra→厂房基础设施维护费)
        assertThat((List<String>) JsonPath.read(d, "$.data.billingLines[*].propertyType"))
                .containsOnly("factory");
        assertThat((String) JsonPath.read(d, "$.data.billingLines[1].feeName")).isEqualTo("厂房企业管理服务费");
        assertThat((String) JsonPath.read(d, "$.data.billingLines[2].feeName")).isEqualTo("厂房基础设施维护费");
    }

    @Test
    void typeNail_dormSegment_shopMgmtContextualName() throws Exception {
        // 商铺段 mgmt → 商铺企业管理服务费(上下文前缀随段类型)
        int id = createOk("\"billingLines\":["
                + "{\"propertyType\":\"shop\",\"location\":\"临街\",\"feeKey\":\"rent_shop\",\"area\":80,\"unitPrice\":60,\"seq\":1},"
                + "{\"propertyType\":\"shop\",\"location\":\"临街\",\"feeKey\":\"mgmt\",\"area\":80,\"unitPrice\":8,\"seq\":2}]");
        String d = getBody("/api/contracts/" + id);
        assertThat((String) JsonPath.read(d, "$.data.billingLines[1].feeName")).isEqualTo("商铺企业管理服务费");
    }

    // ─── effectiveStatus 日期派生(§5.1) ───────────────────────

    @Test
    void effectiveStatus_derivedFromEndDate() throws Exception {
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Shanghai"));
        int expiredId  = createOk(dates(today.minusYears(1), today.minusDays(1)));   // 已过
        int expiringId = createOk(dates(today.minusMonths(1), today.plusDays(30)));   // ≤90 天
        int activeId   = createOk(dates(today.minusMonths(1), today.plusYears(2)));   // 远期
        assertThat(statusOf(expiredId)).isEqualTo("expired");
        assertThat(statusOf(expiringId)).isEqualTo("expiring");
        assertThat(statusOf(activeId)).isEqualTo("active");
    }

    /** 2026-07-28:起租日未到 → future(未生效),不再冒充执行中。 */
    @Test
    void effectiveStatus_startDateInFuture_isFuture() throws Exception {
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Shanghai"));
        int futureId = createOk(dates(today.plusDays(1), today.plusYears(1)));
        assertThat(statusOf(futureId)).isEqualTo("future");
        // 边界:今天起租 = 已生效
        assertThat(statusOf(createOk(dates(today, today.plusYears(2))))).isEqualTo("active");
    }

    @Test
    void effectiveStatus_nullEndDate_isActive() throws Exception {
        int id = createOk("\"startDate\":\"2020-01-01\"");   // 无 endDate → 在租
        assertThat(statusOf(id)).isEqualTo("active");
    }

    private String dates(LocalDate start, LocalDate end) {
        return "\"startDate\":\"" + start + "\",\"endDate\":\"" + end + "\"";
    }

    private String statusOf(int id) throws Exception {
        return JsonPath.read(getBody("/api/contracts/" + id), "$.data.contract.status");
    }

    // ─── 续签链:parentContractId + 旧合同 renewed + 计费行继承 ─────

    @Test
    void renew_setsParentAndInheritsBillingLinesWithPropertyType() throws Exception {
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Shanghai"));
        int oldId = createOk(dates(today.minusMonths(1), today.plusMonths(6))
                + ",\"billingLines\":[{\"propertyType\":\"factory\",\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":3200,\"unitPrice\":9.6785,\"seq\":1}]");
        String newNo = "IT-CC-R-" + System.nanoTime();
        String r = mvc.perform(post("/api/contracts/" + oldId + "/renew")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"contractNo\":\"" + newNo + "\",\"startDate\":\"" + today.plusMonths(6)
                        + "\",\"endDate\":\"" + today.plusYears(2) + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        int newId = JsonPath.read(r, "$.data.id");

        // 新合同 parentContractId 指向旧;旧合同展示态 renewed
        assertThat((Integer) JsonPath.read(r, "$.data.parentContractId")).isEqualTo(oldId);
        assertThat(statusOf(oldId)).isEqualTo("renewed");
        // 计费行继承,propertyType 保留
        String d = getBody("/api/contracts/" + newId);
        assertThat((List<String>) JsonPath.read(d, "$.data.billingLines[*].feeKey")).containsExactly("rent_factory");
        assertThat((String) JsonPath.read(d, "$.data.billingLines[0].propertyType")).isEqualTo("factory");
    }

    // ─── asOfDate 某日在租过滤(§5.2/§8⑦) ───────────────────────

    @Test
    void asOfDate_filtersInForceContracts() throws Exception {
        int inForce = createOk(dates(LocalDate.of(2040, 1, 1), LocalDate.of(2040, 12, 31)));
        int outOfRange = createOk(dates(LocalDate.of(2041, 1, 1), LocalDate.of(2041, 12, 31)));
        int draft = JsonPath.read(mvc.perform(post("/api/contracts")
                .header("Authorization", "Bearer " + token).contentType("application/json")
                .content("{\"contractNo\":\"IT-CC-D-" + System.nanoTime() + "\",\"tenantId\":" + tid
                        + ",\"buildingId\":" + bid + ",\"rentArea\":100,\"monthlyRent\":1,\"deposit\":0,"
                        + "\"startDate\":\"2040-01-01\",\"endDate\":\"2040-12-31\",\"status\":\"draft\"}"))
                .andExpect(jsonPath("$.code").value(0)).andReturn().getResponse().getContentAsString(),
                "$.data.id");

        List<Integer> ids = JsonPath.read(getBody("/api/contracts?asOfDate=2040-06-01"), "$.data[*].id");
        assertThat(ids).contains(inForce).doesNotContain(outOfRange, draft);   // 非草稿且当日在区间内
    }

    @Test
    void asOfDate_invalidFormat_rejected() throws Exception {
        mvc.perform(get("/api/contracts?asOfDate=2040/06/01").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("asOfDate 格式须为 yyyy-MM-dd"));
    }
}
