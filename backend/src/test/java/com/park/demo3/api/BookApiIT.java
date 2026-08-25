package com.park.demo3.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.entity.BookTemplateVersion;
import com.park.demo3.entity.LedgerBook;
import com.park.demo3.mapper.BookTemplateVersionMapper;
import com.park.demo3.mapper.LedgerBookMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 账册与模板(BOOK-WORKBENCH-SPEC):建司即建册(§9)/轻改动不升版·结构改动升版(§3)/
// 标准列不可删(§3)/切版不造版本(R7)/自定义列口袋走导入与合计(§2/§4)。
// @Transactional 回滚;断言只圈本用例自建的公司(种子册不碰),名字带 nanoTime 防并跑撞唯一键。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class BookApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired LedgerBookMapper booksMapper;
    @Autowired BookTemplateVersionMapper versionsMapper;
    private static final ObjectMapper M = new ObjectMapper();
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

    private String getOk(String url) throws Exception {
        return new String(mvc.perform(get(url).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private String putOk(String url, String body) throws Exception {
        return new String(mvc.perform(put(url).header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    /** 建司 → 附带建册(§9);返回 [companyId, bookNode]。 */
    private Object[] createCompanyWithBook() throws Exception {
        String name = "册测" + Long.toString(System.nanoTime(), 36);
        String created = new String(mvc.perform(post("/api/companies").header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"" + name + "\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
        int companyId = JsonPath.read(created, "$.data.id");
        JsonNode books = M.readTree(getOk("/api/books?screen=ledger")).path("data");
        JsonNode mine = null;
        for (JsonNode b : books) if (b.path("companyId").asInt() == companyId) mine = b;
        assertThat(mine).as("建司必须附带建台账册").isNotNull();
        return new Object[]{ companyId, mine };
    }

    @Test
    void seededBooks_ledgerPerCompany_andFourPhaseBooks() throws Exception {
        JsonNode ledger = M.readTree(getOk("/api/books?screen=ledger")).path("data");
        assertThat(ledger.size()).isGreaterThanOrEqualTo(1);
        for (JsonNode b : ledger) {
            assertThat(b.path("ver").asInt()).isGreaterThanOrEqualTo(1);
            assertThat(b.path("definition").path("groups").isArray()).isTrue();
        }
        JsonNode s10 = M.readTree(getOk("/api/books?screen=s10")).path("data");
        assertThat(s10.size()).isEqualTo(4);
        int cols = 0;
        for (JsonNode b : s10) if (b.path("phase").asInt() == 2)
            for (JsonNode g : b.path("definition").path("groups")) cols += g.path("cols").size();
        assertThat(cols).as("二期厂房版面 20 列").isEqualTo(20);
    }

    @Test
    void createCompany_autoCreatesStandardBook_21Cols_v1() throws Exception {
        JsonNode book = (JsonNode) createCompanyWithBook()[1];
        assertThat(book.path("ver").asInt()).isEqualTo(1);
        int cols = 0;
        boolean dormAlias = false;
        for (JsonNode g : book.path("definition").path("groups"))
            for (JsonNode c : g.path("cols")) {
                cols++;
                for (JsonNode a : c.path("aliases")) if ("宿舍区租金".equals(a.asText())) dormAlias = true;
            }
        assertThat(cols).isEqualTo(21);
        assertThat(dormAlias).as("29万丢列事故词条别名必须在种子里").isTrue();
    }

    @Test
    void saveTemplate_lightChange_keepsVersion_structuralBumps_adoptSwitchesPin() throws Exception {
        Object[] cb = createCompanyWithBook();
        JsonNode book = (JsonNode) cb[1];
        int bookId = book.path("id").asInt();
        ObjectNode def = (ObjectNode) book.path("definition").deepCopy();

        // 轻改动:第一列改显示名 → structural=false,版本号不动(§3)
        ObjectNode firstCol = (ObjectNode) def.path("groups").path(0).path("cols").path(0);
        firstCol.put("label", firstCol.path("label").asText() + "·改");
        String r1 = putOk("/api/books/" + bookId + "/template",
                "{\"definition\":" + M.writeValueAsString(def) + ",\"note\":\"改名\"}");
        assertThat((Boolean) JsonPath.read(r1, "$.data.structural")).isFalse();
        assertThat((Integer) JsonPath.read(r1, "$.data.book.ver")).isEqualTo(1);

        // 结构改动:追加自定义列 → structural=true,升版 v2(§3)
        ObjectNode custom = def.objectNode();
        custom.put("id", "c_it_test").put("std", false).put("label", "IT自定义列")
              .put("slot", "other").put("hidden", false).put("w", 96)
              .set("aliases", def.arrayNode());
        ((ArrayNode) def.path("groups").path(0).path("cols")).add(custom);
        String r2 = putOk("/api/books/" + bookId + "/template",
                "{\"definition\":" + M.writeValueAsString(def) + "}");
        assertThat((Boolean) JsonPath.read(r2, "$.data.structural")).isTrue();
        assertThat((Integer) JsonPath.read(r2, "$.data.book.ver")).isEqualTo(2);
        assertThat((String) JsonPath.read(r2, "$.data.changeSummary")).contains("IT自定义列");

        // 版本链:2 版,current 指 v2
        String vs = getOk("/api/books/" + bookId + "/template/versions");
        assertThat((Integer) JsonPath.read(vs, "$.data.versions.length()")).isEqualTo(2);

        // adopt 切指针:本册 ver 变成目标版,链尾 latestVer 不变(R7:切指针不造版本)
        int tipBefore = JsonPath.read(utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andReturn()), "$.data[0].latestVer");
        mvc.perform(post("/api/books/" + bookId + "/template/adopt").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.ver").value(1));
        int tipAfter = JsonPath.read(utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andReturn()), "$.data[0].latestVer");
        assertThat(tipAfter).isEqualTo(tipBefore);
    }

    @Test
    void saveTemplate_deletingStdColumn_isRejected() throws Exception {
        Object[] cb = createCompanyWithBook();
        int bookId = ((JsonNode) cb[1]).path("id").asInt();
        ObjectNode def = (ObjectNode) ((JsonNode) cb[1]).path("definition").deepCopy();
        ((ArrayNode) def.path("groups").path(0).path("cols")).remove(0);   // 删标准列
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"definition\":" + M.writeValueAsString(def) + "}"))
                .andExpect(jsonPath("$.code").value(org.hamcrest.Matchers.not(0)));
    }

    @Test
    void extraFees_importMergesByKey_unknownIdRejected_totalsIncludePocket() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (Integer) cb[0];
        int bookId = ((JsonNode) cb[1]).path("id").asInt();
        // 先给模板加自定义列 c_pv(结构升版)
        ObjectNode def = (ObjectNode) ((JsonNode) cb[1]).path("definition").deepCopy();
        ObjectNode custom = def.objectNode();
        custom.put("id", "c_pv").put("std", false).put("label", "光伏抵扣")
              .put("slot", "other").put("hidden", false).put("w", 96)
              .set("aliases", def.arrayNode());
        ((ArrayNode) def.path("groups").path(0).path("cols")).add(custom);
        putOk("/api/books/" + bookId + "/template", "{\"definition\":" + M.writeValueAsString(def) + "}");

        // 导入:已知 c_pv 落袋;未知 c_ghost 该行报错不静默吞(§4)
        String imp = new String(mvc.perform(post("/api/ledger/companies/" + companyId + "/import?year=2031&month=5")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[" +
                        "{\"tenantName\":\"口袋户\",\"factoryRent\":100,\"extraFees\":{\"c_pv\":50}}," +
                        "{\"tenantName\":\"幽灵户\",\"extraFees\":{\"c_ghost\":1}}]}"))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
        assertThat((Integer) JsonPath.read(imp, "$.data.imported")).isEqualTo(1);
        assertThat((String) JsonPath.read(imp, "$.data.errors[0].reason")).contains("c_ghost");

        // 月读:合计含口袋(100+50);extraFees 透出
        String month = getOk("/api/ledger/companies/" + companyId + "/months/2031/5");
        assertThat(((Number) JsonPath.read(month, "$.data.rows[0].totalReceivable")).doubleValue()).isEqualTo(150.0);
        assertThat(((Number) JsonPath.read(month, "$.data.rows[0].extraFees.c_pv")).doubleValue()).isEqualTo(50.0);

        // 重导仅带 factoryRent(extraFees 缺席)→ 口袋不动(§4 键缺席=不动)
        mvc.perform(post("/api/ledger/companies/" + companyId + "/import?year=2031&month=5")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"口袋户\",\"factoryRent\":200}]}"))
                .andExpect(jsonPath("$.code").value(0));
        String month2 = getOk("/api/ledger/companies/" + companyId + "/months/2031/5");
        assertThat(((Number) JsonPath.read(month2, "$.data.rows[0].totalReceivable")).doubleValue()).isEqualTo(250.0);
        assertThat(((Number) JsonPath.read(month2, "$.data.rows[0].extraFees.c_pv")).doubleValue()).isEqualTo(50.0);
    }

    @Test
    void customColWithData_cannotBeRemoved_hideAllowed_adoptGuardedToo() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (Integer) cb[0];
        int bookId = ((JsonNode) cb[1]).path("id").asInt();
        ObjectNode def = (ObjectNode) ((JsonNode) cb[1]).path("definition").deepCopy();
        ObjectNode custom = def.objectNode();
        custom.put("id", "c_keep").put("std", false).put("label", "有数据列")
              .put("slot", "other").put("hidden", false).put("w", 96)
              .set("aliases", def.arrayNode());
        ((ArrayNode) def.path("groups").path(0).path("cols")).add(custom);
        putOk("/api/books/" + bookId + "/template", "{\"definition\":" + M.writeValueAsString(def) + "}");   // v2
        mvc.perform(post("/api/ledger/companies/" + companyId + "/import?year=2032&month=1")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"归档户\",\"extraFees\":{\"c_keep\":9}}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));

        // 删除有数据的自定义列 → 409(§3 归档守卫)
        ObjectNode dropped = def.deepCopy();
        ArrayNode cols = (ArrayNode) dropped.path("groups").path(0).path("cols");
        cols.remove(cols.size() - 1);
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json").content("{\"definition\":" + M.writeValueAsString(dropped) + "}"))
                .andExpect(jsonPath("$.code").value(org.hamcrest.Matchers.not(0)));

        // 切到没有该列的 v1 → 同样被守卫拦下
        mvc.perform(post("/api/books/" + bookId + "/template/adopt").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1}"))
                .andExpect(jsonPath("$.code").value(org.hamcrest.Matchers.not(0)));

        // 隐藏(归档)→ 放行,升版
        ObjectNode hidden = def.deepCopy();
        ((ObjectNode) hidden.path("groups").path(0).path("cols").path(hidden.path("groups").path(0).path("cols").size() - 1))
                .put("hidden", true);
        String r = putOk("/api/books/" + bookId + "/template",
                "{\"definition\":" + M.writeValueAsString(hidden) + "}");
        assertThat((Boolean) JsonPath.read(r, "$.data.structural")).isTrue();
    }

    @Test
    void booksEndpoint_requiresAuth() throws Exception {
        mvc.perform(get("/api/books?screen=ledger")).andExpect(status().isUnauthorized());
    }

    /** 该册看到的版本链身份:版本行 id 序列(顺序=ver 倒序)。 */
    private List<Object> chainOf(String versionsBody, int bookId) {
        List<Object> rows = JsonPath.read(versionsBody, "$.data.versions[*].id");
        // 空清单会让「各册都一样」恒真:先钉死链非空,再谈身份是否相同
        assertThat(rows).as("册 " + bookId + " 的版本链非空").isNotEmpty();
        return rows;
    }

    @Test
    void lineage_allLedgerCompaniesShareOneChain_hostHidden() throws Exception {
        String body = getOk("/api/books?screen=ledger");
        List<Object> companyIds = JsonPath.read(body, "$.data[*].companyId");
        assertThat(companyIds).as("宿主行不是账册,不进清单").doesNotContainNull();
        List<Integer> ids = JsonPath.read(body, "$.data[*].id");
        List<Integer> vers = JsonPath.read(body, "$.data[*].ver");
        List<Integer> latest = JsonPath.read(body, "$.data[*].latestVer");
        assertThat(new java.util.HashSet<>(latest)).as("全局链只有一条").hasSize(1);

        List<Object> chain = null;
        for (int i = 0; i < ids.size(); i++) {
            String vs = getOk("/api/books/" + ids.get(i) + "/template/versions");
            // latestVer 相同证明不了什么(chainBookId 对 ledger 恒返回宿主 id);
            // 真正能发现分叉册的是版本行本身:私链会带出另一批 id
            if (chain == null) chain = chainOf(vs, ids.get(i));
            else assertThat(chainOf(vs, ids.get(i))).as("每册看到同一条链的同一批版本行").isEqualTo(chain);
            List<Integer> cur = JsonPath.read(vs, "$.data.versions[?(@.current == true)].ver");
            assertThat(cur).as("current 恰好标在本册 pin 的那版上").containsExactly(vers.get(i));
            assertThat(vers.get(i)).isLessThanOrEqualTo(latest.get(i));
        }
    }

    @Test
    void newCompany_afterMigration_joinsGlobalChain_notItsOwnFork() throws Exception {
        List<Integer> ids0 = JsonPath.read(getOk("/api/books?screen=ledger"), "$.data[*].id");
        List<Object> chain = chainOf(getOk("/api/books/" + ids0.get(0) + "/template/versions"), ids0.get(0));

        int newBookId = ((JsonNode) createCompanyWithBook()[1]).path("id").asInt();

        // 建司若照旧另起私链,新册带出的版本行与全局链对不上 —— 「全局唯一模板」当场作废,
        // 且永远修不回来:它不在链上,链尾编辑再也带不动它
        assertThat(chainOf(getOk("/api/books/" + newBookId + "/template/versions"), newBookId))
            .as("新册直接落在全局链上").isEqualTo(chain);
        String body = getOk("/api/books?screen=ledger");
        List<Integer> ids = JsonPath.read(body, "$.data[*].id");
        List<Integer> vers = JsonPath.read(body, "$.data[*].ver");
        List<Integer> latest = JsonPath.read(body, "$.data[*].latestVer");
        int i = ids.indexOf(newBookId);
        assertThat(vers.get(i)).as("新册没有历史,没有理由落后于链尾").isEqualTo(latest.get(i));
    }

    // ── 链尾编辑规则 R3/R4 与跨公司归档守卫(2026-08-25 全局链) ──

    private static String utf8(org.springframework.test.web.servlet.MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private String ledgerBooks() throws Exception {
        return utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
    }

    /** 在指定册上加一个自定义列并保存(结构改动 → 升版)。 */
    @SuppressWarnings("unchecked")
    private void addCustomColAtTip(int bookId, String colId, String label) throws Exception {
        String body = ledgerBooks();
        int idx = ((List<Integer>) JsonPath.read(body, "$.data[*].id")).indexOf(bookId);
        JsonNode d = M.readTree(M.writeValueAsString(JsonPath.read(body, "$.data[" + idx + "].definition")));
        ObjectNode col = ((ArrayNode) d.get("groups").get(0).get("cols")).addObject();
        col.put("id", colId); col.put("std", false); col.put("label", label);
        col.put("slot", "other"); col.put("hidden", false); col.putNull("w"); col.putArray("aliases");
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json").content("{\"definition\":" + d + ",\"note\":\"" + label + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.structural").value(true));
    }

    /** 把某册的版本指针按回旧版 —— 造前置状态用。
     *  切版接口 /template/adopt 属 Task 4,尚未落地;这里直接改指针,R3/R4 的断言一字不动。 */
    private void pinTo(int bookId, int ver) {
        Integer host = booksMapper.lineageHost().getId();
        BookTemplateVersion target = versionsMapper.byBook(host).stream()
                .filter(v -> v.getVer() == ver).findFirst().orElseThrow();
        LedgerBook b = booksMapper.selectById(bookId);
        b.setCurrentVersionId(target.getId());
        booksMapper.updateById(b);
    }

    /** 造出「有落后册」的状态:链尾升一版,除首册外全部停在链尾,首册按回 v1。
     *  链尾必须留下**多册** —— 只留一册时 R4 与「只移动被编辑的那册」结果相同,用例分辨不出。
     *  返回 {落后册 id, 链尾册 id, 链尾版本号}。 */
    @SuppressWarnings("unchecked")
    private int[] makeLaggingState(String probeColId) throws Exception {
        List<Integer> ids = JsonPath.read(ledgerBooks(), "$.data[*].id");
        int lagging = ids.get(0), tip = ids.get(1);
        addCustomColAtTip(tip, probeColId, "计划探针");
        int latest = ((List<Integer>) JsonPath.read(ledgerBooks(), "$.data[*].latestVer")).get(0);
        for (Integer id : ids) pinTo(id, id == lagging ? 1 : latest);
        return new int[]{ lagging, tip, latest };
    }

    @Test
    @SuppressWarnings("unchecked")
    void saveTemplate_fromNonTipVersion_isRejected() throws Exception {
        int[] s = makeLaggingState("c_probe_r3");
        int lagging = s[0];
        String body = ledgerBooks();
        int idx = ((List<Integer>) JsonPath.read(body, "$.data[*].id")).indexOf(lagging);
        Object d = JsonPath.read(body, "$.data[" + idx + "].definition");
        assertThat((int) (Integer) JsonPath.read(body, "$.data[" + idx + "].ver")).isEqualTo(1);   // 确认真的落后了
        mvc.perform(put("/api/books/" + lagging + "/template").header("Authorization", auth())
                .contentType("application/json").content("{\"definition\":" + M.writeValueAsString(d) + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("先升")));
    }

    @Test
    @SuppressWarnings("unchecked")
    void saveTemplate_structural_movesOnlyTipPinnedCompanies() throws Exception {
        int[] s = makeLaggingState("c_probe_r4a");
        int lagging = s[0], tip = s[1];

        String before = ledgerBooks();
        List<Integer> ids = JsonPath.read(before, "$.data[*].id");
        List<Integer> vers = JsonPath.read(before, "$.data[*].ver");
        int latest = ((List<Integer>) JsonPath.read(before, "$.data[*].latestVer")).get(0);
        assertThat(vers.get(ids.indexOf(lagging))).as("前置:落后册在 v1").isEqualTo(1);

        addCustomColAtTip(tip, "c_probe_r4b", "计划探针二");

        String after = ledgerBooks();
        List<Integer> vers2 = JsonPath.read(after, "$.data[*].ver");
        int latest2 = ((List<Integer>) JsonPath.read(after, "$.data[*].latestVer")).get(0);
        assertThat(latest2).isEqualTo(latest + 1);
        for (int i = 0; i < ids.size(); i++) {
            if (vers.get(i) == latest) assertThat(vers2.get(i)).as("链尾册跟进").isEqualTo(latest2);
            else assertThat(vers2.get(i)).as("落后册原地不动").isEqualTo(vers.get(i));
        }
        assertThat(vers2.get(ids.indexOf(lagging))).as("落后册仍在 v1").isEqualTo(1);
    }

    @Test
    @SuppressWarnings("unchecked")
    void tipEdit_removingCustomCol_blockedByAnotherCompanysData() throws Exception {
        // ① 链尾加一列(所有在链尾的册跟进,含 company 1 与另一家)
        String body0 = ledgerBooks();
        List<Integer> ids = JsonPath.read(body0, "$.data[*].id");
        List<Integer> cids = JsonPath.read(body0, "$.data[*].companyId");
        int bookOfC1 = ids.get(cids.indexOf(1));
        int otherBook = ids.get(cids.indexOf(1) == 0 ? 1 : 0);      // 另一家公司的册
        addCustomColAtTip(bookOfC1, "c_xcheck", "跨司探针");

        // ② 只给 company 1 的台账写这列的数据
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "11")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"跨司探针户\",\"extraFees\":{\"c_xcheck\":50}}]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.imported").value(1));

        // ③ 从**另一家公司**的册发起删列 → 必须被 company 1 的数据拦下(§7 跨公司检查)
        String body = ledgerBooks();
        int oIdx = ((List<Integer>) JsonPath.read(body, "$.data[*].id")).indexOf(otherBook);
        JsonNode d = M.readTree(M.writeValueAsString(JsonPath.read(body, "$.data[" + oIdx + "].definition")));
        for (JsonNode g : d.get("groups")) {
            ArrayNode cols = (ArrayNode) g.get("cols");
            for (int i = cols.size() - 1; i >= 0; i--)
                if ("c_xcheck".equals(cols.get(i).get("id").asText())) cols.remove(i);
        }
        mvc.perform(put("/api/books/" + otherBook + "/template").header("Authorization", auth())
                .contentType("application/json").content("{\"definition\":" + d + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("不能删除")));
        // 类上 @Transactional,用例结束整体回滚 —— 不需要计划里那段手工清理
    }

    // ── 切版指针 adopt(R6/R7/R8):切指针不造版本,跨版可一步到位,缺列且有数据被守卫拦下 ──
    // 探针列 id 必须与其他用例各不相同 —— 链只追加,重名会撞 TemplateDef.validate 的「列 id 重复」

    @Test
    @SuppressWarnings("unchecked")
    void adopt_crossVersionJumpToTip_doesNotCreateVersion() throws Exception {
        // 造出三版链:v1(种子) → v2 → v3
        List<Integer> ids0 = JsonPath.read(ledgerBooks(), "$.data[*].id");
        int book = ids0.get(0), other = ids0.get(1);
        addCustomColAtTip(other, "c_jump_a", "跳版探针A");
        addCustomColAtTip(other, "c_jump_b", "跳版探针B");
        int latest = ((List<Integer>) JsonPath.read(ledgerBooks(), "$.data[*].latestVer")).get(0);
        assertThat(latest).isEqualTo(3);

        // 先退到 v1,再一步跳到链尾(R8:不必逐版爬)
        mvc.perform(post("/api/books/" + book + "/template/adopt").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.ver").value(1));
        mvc.perform(post("/api/books/" + book + "/template/adopt").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":" + latest + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.ver").value(latest));

        // R7:切指针不造新版本 —— 链尾纹丝不动
        assertThat(((List<Integer>) JsonPath.read(ledgerBooks(), "$.data[*].latestVer")).get(0))
                .isEqualTo(latest);
    }

    @Test
    @SuppressWarnings("unchecked")
    void adopt_downgradeBlockedWhenCustomColumnHasData() throws Exception {
        // ① 链尾加一列并升版(所有在链尾的册跟进)
        String body0 = ledgerBooks();
        List<Integer> ids = JsonPath.read(body0, "$.data[*].id");
        List<Integer> cids = JsonPath.read(body0, "$.data[*].companyId");
        int cIdx = cids.indexOf(1);                       // 用 companyId=1 的册,种子必有
        int bookId = ids.get(cIdx);
        addCustomColAtTip(bookId, "c_guard_probe", "守卫探针");

        // ② 往该列导一行钱进去 —— 有数据才谈得上"降级会藏钱"
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "12")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"守卫探针户\",\"extraFees\":{\"c_guard_probe\":100}}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));

        // ③ 降到不含该列的 v1 → 被守卫拦下(R6)
        mvc.perform(post("/api/books/" + bookId + "/template/adopt").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("已有")));
        // 类上 @Transactional,用例结束整体回滚 —— 不需要计划里那段手工清理
    }

    @Test
    @SuppressWarnings("unchecked")
    void adopt_requiresBookTemplateEditPerm() throws Exception {
        String vt = JsonPath.read(mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(),
                "$.data.token");
        String body = utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andReturn());
        int id = ((List<Integer>) JsonPath.read(body, "$.data[*].id")).get(0);
        // 路径改名后权限门若没跟着挪,这条规则匹配不上任何端点 → 新端点对任何登录账号敞开
        mvc.perform(post("/api/books/" + id + "/template/adopt").header("Authorization", "Bearer " + vt)
                .contentType("application/json").content("{\"ver\":1}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(403));
    }
}
