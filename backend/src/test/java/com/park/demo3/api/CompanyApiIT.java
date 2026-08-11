package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 公司与收款账户 CRUD(S20-BILL-DELIVERY-SPEC §1.1/§1.2/§4)。@Transactional 回滚;
// 断言只圈本用例自建的公司(种子 6 家不碰),公司名带 nanoTime 后缀避免与并跑用例撞唯一键。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class CompanyApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }

    private String auth() { return "Bearer " + token; }

    private String postOk(String url, String body) throws Exception {
        return new String(mvc.perform(post(url).header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private String putOk(String url, String body) throws Exception {
        return new String(mvc.perform(put(url).header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private String listBody() throws Exception {
        return new String(mvc.perform(get("/api/companies").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private Map<String, Object> inList(int id) throws Exception {
        List<Map<String, Object>> rows = JsonPath.read(listBody(), "$.data[?(@.id==" + id + ")]");
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    private int newCompany(String suffix) throws Exception {
        return JsonPath.read(postOk("/api/companies",
                "{\"name\":\"IT收款公司" + suffix + System.nanoTime() + "\",\"short\":\"IT收\","
                + "\"fullName\":\"佛山IT收款科技有限公司\"}"), "$.data.id");
    }

    private int addAccount(int companyId, String body) throws Exception {
        return JsonPath.read(postOk("/api/companies/" + companyId + "/accounts", body), "$.data.id");
    }

    // ── c1 新建:short/fullName 落库,status 默认 1(启用),accounts 空数组 ──
    @Test
    void c1_create_keepsShortAndFullName_statusDefaultsEnabled() throws Exception {
        int id = newCompany("甲");
        Map<String, Object> row = inList(id);
        assertThat(row.get("short")).isEqualTo("IT收");
        assertThat(row.get("fullName")).isEqualTo("佛山IT收款科技有限公司");
        assertThat(((Number) row.get("status")).intValue()).isEqualTo(1);
        assertThat((List<?>) row.get("accounts")).isEmpty();
    }

    // ── c2 改名+停用:PUT 全量改四字段;停用后仍在列表(不删),status=0 ──
    @Test
    void c2_update_renameAndDisable() throws Exception {
        int id = newCompany("乙");
        String name = "IT收款公司乙改" + System.nanoTime();
        putOk("/api/companies/" + id, "{\"name\":\"" + name + "\",\"short\":\"乙改\","
                + "\"fullName\":\"佛山乙改实业有限公司\",\"status\":0}");
        Map<String, Object> row = inList(id);
        assertThat(row.get("name")).isEqualTo(name);
        assertThat(row.get("short")).isEqualTo("乙改");
        assertThat(row.get("fullName")).isEqualTo("佛山乙改实业有限公司");
        assertThat(((Number) row.get("status")).intValue()).isZero();
    }

    // ── c3 重名 409(新建与改名同一把闸) ──
    @Test
    void c3_duplicateName_409() throws Exception {
        int id = newCompany("丙");
        String taken = (String) inList(id).get("name");
        mvc.perform(post("/api/companies").header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"" + taken + "\"}"))
                .andExpect(jsonPath("$.code").value(409));
        int other = newCompany("丁");
        mvc.perform(put("/api/companies/" + other).header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"" + taken + "\"}"))
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── c4 账户 CRUD:增→列表带出;改→字段更新;删→列表消失 ──
    @Test
    void c4_accountCrud() throws Exception {
        int id = newCompany("戊");
        int a = addAccount(id, "{\"kind\":\"bank\",\"accountName\":\"佛山IT收款科技有限公司\","
                + "\"accountNo\":\"1234567890\",\"bankName\":\"工行南海支行\",\"remark\":\"仅限水电费\"}");
        Map<String, Object> acct = accounts(id).get(0);
        assertThat(acct.get("kind")).isEqualTo("bank");
        assertThat(acct.get("accountNo")).isEqualTo("1234567890");
        assertThat(acct.get("bankName")).isEqualTo("工行南海支行");
        assertThat(acct.get("remark")).isEqualTo("仅限水电费");
        assertThat(((Number) acct.get("companyId")).intValue()).isEqualTo(id);

        putOk("/api/company-accounts/" + a, "{\"kind\":\"wechat\",\"accountName\":\"IT收款微信\"}");
        acct = accounts(id).get(0);
        assertThat(acct.get("kind")).isEqualTo("wechat");
        assertThat(acct.get("accountName")).isEqualTo("IT收款微信");

        mvc.perform(delete("/api/company-accounts/" + a).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0));
        assertThat(accounts(id)).isEmpty();
    }

    // ── c5 默认账户同公司唯一:设新默认时清旧(增与改两条路径都过闸) ──
    @Test
    void c5_isDefaultUniquePerCompany() throws Exception {
        int id = newCompany("己");
        int a1 = addAccount(id, "{\"kind\":\"bank\",\"accountNo\":\"A1\",\"isDefault\":true}");
        int a2 = addAccount(id, "{\"kind\":\"alipay\",\"accountNo\":\"A2\",\"isDefault\":true}");
        assertThat(defaults(id)).containsExactly(a2);

        putOk("/api/company-accounts/" + a1, "{\"kind\":\"bank\",\"accountNo\":\"A1\",\"isDefault\":true}");
        assertThat(defaults(id)).containsExactly(a1);

        // 另一家公司的默认账户不受影响(清旧只在同公司内)
        int other = newCompany("庚");
        int b1 = addAccount(other, "{\"kind\":\"bank\",\"accountNo\":\"B1\",\"isDefault\":true}");
        assertThat(defaults(id)).containsExactly(a1);
        assertThat(defaults(other)).containsExactly(b1);
    }

    // ── c6 kind 值域闸(bank/wechat/alipay/personal/other 之外 400) ──
    @Test
    void c6_badKind_400() throws Exception {
        int id = newCompany("辛");
        mvc.perform(post("/api/companies/" + id + "/accounts").header("Authorization", auth())
                .contentType("application/json").content("{\"kind\":\"bitcoin\"}"))
                .andExpect(jsonPath("$.code").value(400));
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> accounts(int companyId) throws Exception {
        return (List<Map<String, Object>>) inList(companyId).get("accounts");
    }

    private List<Integer> defaults(int companyId) throws Exception {
        return accounts(companyId).stream()
                .filter(a -> Boolean.TRUE.equals(a.get("isDefault")))
                .map(a -> ((Number) a.get("id")).intValue()).toList();
    }
}
