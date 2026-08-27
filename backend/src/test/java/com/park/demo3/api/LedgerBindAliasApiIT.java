package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.entity.Tenant;
import com.park.demo3.mapper.TenantMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 绑定时顺手记住账面名(2026-08-27 用户拍板)。
//
// 背景:导入按 TenantService.softIndex(档案名 ∪ 别名)配租户,配不上就落未绑定行。
// 手工绑定此前只写 monthly_ledger.tenant_id —— 系统学不到那个名字,下月同名照样落未绑定,
// 同一个判断要做 12 遍。
//
// ⚠ 但**默认不记**。实测库里 4243 条已绑定行中账面名与档案名不一致的只有 21 条、10 种写法,
//    其中「诺玲/诺铃」是个错别字 —— 自动记会把错别字固化成系统认可的正确写法,
//    从此再没人发现它错了。所以要记必须由人显式点一下:那一下就是在分辨
//    「老板名/曾用名」(该记)与「打错了」(该去改源册)。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class LedgerBindAliasApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired TenantMapper tenants;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }

    private String auth() { return "Bearer " + token; }

    /** 在 2026/9 导一条配不上档案的未绑定行,返回它的行 id。 */
    private int unboundRow(String bookName) throws Exception {
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "9")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"" + bookName + "\",\"factoryRent\":100}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        String body = new String(mvc.perform(get("/api/ledger/companies/1/months/2026/9")
                .header("Authorization", auth())).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
        java.util.List<java.util.Map<String, Object>> rows = JsonPath.read(body, "$.data.rows[*]");
        return rows.stream().filter(r -> bookName.equals(r.get("tenantName")))
                .map(r -> ((Number) r.get("id")).intValue()).findFirst().orElseThrow();
    }

    private void bind(int rowId, int tenantId, Boolean addAlias) throws Exception {
        String body = addAlias == null
                ? "{\"tenantId\":" + tenantId + "}"
                : "{\"tenantId\":" + tenantId + ",\"addAlias\":" + addAlias + "}";
        mvc.perform(patch("/api/ledger/rows/" + rowId + "/tenant")
                .header("Authorization", auth()).contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
    }

    private String aliasesOf(int tenantId) { return tenants.selectById(tenantId).getAliases(); }

    @Test
    void bind_withoutFlag_doesNotTouchAliases() throws Exception {
        String before = aliasesOf(1);
        bind(unboundRow("源册随手写的名"), 1, null);
        assertThat(aliasesOf(1)).as("不传 addAlias 时别名一个字都不能动").isEqualTo(before);
    }

    @Test
    void bind_withFlagFalse_doesNotTouchAliases() throws Exception {
        String before = aliasesOf(1);
        bind(unboundRow("这次打错的名"), 1, false);
        assertThat(aliasesOf(1)).as("显式 false 同样不动").isEqualTo(before);
    }

    @Test
    void bind_withFlagTrue_remembersTheBookName() throws Exception {
        String bookName = "老板名·记住我";
        bind(unboundRow(bookName), 1, true);
        assertThat(aliasesOf(1)).as("勾了才写进别名").contains(bookName);
    }

    @Test
    void bind_withFlagTrue_keepsExistingAliases() throws Exception {
        Tenant t = tenants.selectById(1);
        t.setAliases("原有别名甲,原有别名乙");
        tenants.updateById(t);
        bind(unboundRow("新记的名"), 1, true);
        assertThat(aliasesOf(1)).as("追加而不是覆盖")
                .contains("原有别名甲").contains("原有别名乙").contains("新记的名");
    }

    @Test
    void bind_withFlagTrue_isIdempotent_noDuplicateAlias() throws Exception {
        // 该名字已经在别名里(上个月记过)→ 再记一次不能出现第二条。
        // 不走"绑两行"复现:同租户同月第二行会撞 uk_ledger(409),那是另一条规则,别混进来
        String bookName = "重复记的名";
        Tenant t = tenants.selectById(1);
        t.setAliases(bookName);
        tenants.updateById(t);

        bind(unboundRow(bookName), 1, true);

        long times = java.util.Arrays.stream(aliasesOf(1).split("[,，]"))
                .map(String::trim).filter(bookName::equals).count();
        assertThat(times).as("同一个名字只记一条").isEqualTo(1);
    }

    @Test
    void bind_whenBookNameEqualsArchiveName_recordsNothing() throws Exception {
        // 账面名与档案名本来就一样 → 没有"异名"可记,勾了也不该往别名里塞垃圾
        String archiveName = tenants.selectById(1).getCompanyName();
        String before = aliasesOf(1);
        bind(unboundRow(archiveName), 1, true);
        assertThat(aliasesOf(1)).as("同名无需记忆").isEqualTo(before);
    }
}
