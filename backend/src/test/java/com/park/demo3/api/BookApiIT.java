package com.park.demo3.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
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

// 账册与模板(BOOK-WORKBENCH-SPEC):建司即建册(§9)/版本不可变、任何保存都升版(2026-08-26 P5)/
// 编辑只带走 body 里那个月(P4)/标准列不可删(§3)/自定义列口袋走导入与合计(§2/§4)。
// @Transactional 回滚;断言只圈本用例自建的公司(种子册不碰),名字带 nanoTime 防并跑撞唯一键。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class BookApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
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
    void saveTemplate_everySaveAppendsAVersion_summaryNamesTheChange() throws Exception {
        Object[] cb = createCompanyWithBook();
        JsonNode book = (JsonNode) cb[1];
        int bookId = book.path("id").asInt();
        ObjectNode def = (ObjectNode) book.path("definition").deepCopy();

        // 改显示名 —— 旧口径的"轻改动"。spec P5 之后一样升版,structural 恒 true
        ObjectNode firstCol = (ObjectNode) def.path("groups").path(0).path("cols").path(0);
        firstCol.put("label", firstCol.path("label").asText() + "·改");
        String r1 = putOk("/api/books/" + bookId + "/template",
                "{\"definition\":" + M.writeValueAsString(def) + ",\"note\":\"改名\",\"year\":2026,\"month\":3}");
        assertThat((Boolean) JsonPath.read(r1, "$.data.structural")).isTrue();
        assertThat((Integer) JsonPath.read(r1, "$.data.book.ver")).isEqualTo(2);

        // 追加自定义列 → 再升一版,摘要点名新列
        ObjectNode custom = def.objectNode();
        custom.put("id", "c_it_test").put("std", false).put("label", "IT自定义列")
              .put("slot", "other").put("hidden", false).put("w", 96)
              .set("aliases", def.arrayNode());
        ((ArrayNode) def.path("groups").path(0).path("cols")).add(custom);
        String r2 = putOk("/api/books/" + bookId + "/template",
                "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":3}");
        assertThat((Boolean) JsonPath.read(r2, "$.data.structural")).isTrue();
        assertThat((Integer) JsonPath.read(r2, "$.data.book.ver")).isEqualTo(3);
        assertThat((String) JsonPath.read(r2, "$.data.changeSummary")).contains("IT自定义列");

        // 链只追加:两次保存 = 两个新版本
        String vs = getOk("/api/books/" + bookId + "/template/versions");
        assertThat((Integer) JsonPath.read(vs, "$.data.versions.length()")).isEqualTo(3);
    }

    // ── 版本不可变 + 按月编辑(2026-08-26 spec P4/P5) ──

    @Test
    void saveTemplate_isAlwaysImmutable_lightChangeAlsoBumpsVersion() throws Exception {
        Object[] cb = createCompanyWithBook();
        int bookId = ((JsonNode) cb[1]).path("id").asInt();

        String v1Def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/3"))
                .path("data").path("definition").toString();

        // 只改一个列名 —— 旧口径的"轻改动",现在也必须升版
        ObjectNode def = (ObjectNode) M.readTree(v1Def).deepCopy();
        ObjectNode first = (ObjectNode) def.path("groups").path(0).path("cols").path(0);
        first.put("label", first.path("label").asText() + "·改");
        String res = putOk("/api/books/" + bookId + "/template",
                "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":3}");
        assertThat((Integer) JsonPath.read(res, "$.data.book.ver")).isEqualTo(2);

        // 旧版本逐字节不变(永不改写 —— P5 的存在理由,也是本用例唯一守得住它的断言)
        // ⚠ 不能只 contains(原 label):新 label 就是"原 label·改",就地改写 v1 之后 contains 照样为真,
        //   等于空跑。整棵定义树相等才挡得住"升了版还顺手改写旧版"这类回归。
        JsonNode v1After = M.readTree(getOk("/api/books/" + bookId + "/template/versions/1")).path("data");
        assertThat(v1After).as("v1 的定义在保存前后必须一模一样").isEqualTo(M.readTree(v1Def));
    }

    @Test
    void saveTemplate_movesOnlyThatMonth() throws Exception {
        Object[] cb = createCompanyWithBook();
        int bookId = ((JsonNode) cb[1]).path("id").asInt();

        // 前置:先原样保存一次 2 月 —— 给 2 月一个自己的 pin。没有它,2 月按 P3 第 3 步落到链尾,
        // 而链尾正是下面这次保存要产出的新版,"更早月份不受影响"就成了一句空话(用例自证不了)
        putOk("/api/books/" + bookId + "/template",
                "{\"definition\":" + M.writeValueAsString(
                        M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/2"))
                                .path("data").path("definition"))
                        + ",\"year\":2026,\"month\":2}");

        ObjectNode def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/3"))
                .path("data").path("definition").deepCopy();
        ObjectNode col = ((ArrayNode) def.path("groups").path(0).path("cols")).addObject();
        col.put("id", "c_m3only").put("std", false).put("label", "只给3月")
           .put("slot", "other").put("hidden", false).putNull("w").set("aliases", def.arrayNode());
        putOk("/api/books/" + bookId + "/template",
                "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":3}");

        // 3 月用新版
        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/3"))
                .path("data").path("definition").toString()).contains("c_m3only");
        // 4 月(空月,沿用最近更早的 pin = 3 月那条)也会看到 —— 这是 P3 的规定行为
        // 但 2 月(更早)必须不受影响
        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/2"))
                .path("data").path("definition").toString()).doesNotContain("c_m3only");
    }

    @Test
    void saveTemplate_deletingStdColumn_isRejected() throws Exception {
        Object[] cb = createCompanyWithBook();
        int bookId = ((JsonNode) cb[1]).path("id").asInt();
        ObjectNode def = (ObjectNode) ((JsonNode) cb[1]).path("definition").deepCopy();
        ((ArrayNode) def.path("groups").path(0).path("cols")).remove(0);   // 删标准列
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":3}"))
                .andExpect(jsonPath("$.code").value(org.hamcrest.Matchers.not(0)));
    }

    // 月份既是 book_month_pin.period_month(TINYINT),又是 P3「往前找最近一版」的排序键 ——
    // 13 月会原样落库、排到 12 月后面,把解析顺序搅乱。@NotNull 只挡缺失,区间得另守。
    @Test
    void saveTemplate_monthOutOfRange_isRejected() throws Exception {
        Object[] cb = createCompanyWithBook();
        int bookId = ((JsonNode) cb[1]).path("id").asInt();
        String def = M.writeValueAsString(((JsonNode) cb[1]).path("definition"));
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"definition\":" + def + ",\"year\":2026,\"month\":13}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
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
        putOk("/api/books/" + bookId + "/template",
                "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2031,\"month\":5}");

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
            // 这里原先还有一句 ver <= latestVer:spec §6 之后不带月份的清单两个字段同取链尾,
            // 它已恒真、零检出力。真正的 ver < latestVer 由按月接口守(见 s10_monthPinnedToOlderVersion)
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
        // 新册一个 pin 都没有 → 按 P3 第 3 步落到链尾。这条从按月接口读才有检出力:
        // 清单接口的 ver 与 latestVer 自 spec §6 起同取链尾,在那儿断言 ver==latestVer 是恒真
        JsonNode at = M.readTree(getOk("/api/books/" + newBookId + "/template/at/2026/3")).path("data");
        assertThat(at.path("ver").asInt()).as("新册没有历史,该月落到链尾")
            .isEqualTo(at.path("latestVer").asInt());
    }

    private static String utf8(org.springframework.test.web.servlet.MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private String ledgerBooks() throws Exception {
        return utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
    }

    /** 在指定册的某个月上加一个自定义列并保存(spec P4:升版 + 只把该月切过去)。 */
    @SuppressWarnings("unchecked")
    private void addCustomColAtTip(int bookId, String colId, String label, int year, int month) throws Exception {
        String body = ledgerBooks();
        int idx = ((List<Integer>) JsonPath.read(body, "$.data[*].id")).indexOf(bookId);
        JsonNode d = M.readTree(M.writeValueAsString(JsonPath.read(body, "$.data[" + idx + "].definition")));
        ObjectNode col = ((ArrayNode) d.get("groups").get(0).get("cols")).addObject();
        col.put("id", colId); col.put("std", false); col.put("label", label);
        col.put("slot", "other"); col.put("hidden", false); col.putNull("w"); col.putArray("aliases");
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json").content("{\"definition\":" + d + ",\"note\":\"" + label
                        + "\",\"year\":" + year + ",\"month\":" + month + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.structural").value(true));
    }

    // ── 建司不再写 current_version_id(spec §5:台账公司册的那一列作废) ──
    // 写了它,新司「不带月份读」到的版本会永远停在建司当刻那一版,导入白名单跟着停:
    // 此后别人给链尾加的自定义列,这家公司永远导不进来。该列已无任何生产路径去写,
    // 所以只能从可观察的后果上钉:建司在先、别的册把链尾推走在后,这家司导入照样认新列。
    @Test
    void newCompany_importWhitelist_followsChainTip_notTheVersionAtCreation() throws Exception {
        int companyId = (int) createCompanyWithBook()[0];                       // 先建司
        int otherBookId = ((JsonNode) createCompanyWithBook()[1]).path("id").asInt();
        addCustomColAtTip(otherBookId, "c_afterbirth", "建司之后加的列", 2026, 9);   // 再由别人推链尾

        mvc.perform(post("/api/ledger/companies/" + companyId + "/import")
                .param("year", "2026").param("month", "9")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"新司户\",\"extraFees\":{\"c_afterbirth\":10}}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(1));   // 白名单跟着链尾走
    }
    // ── s10 回归(design §4「s10 恒等变换」):停在非链尾的月份仍然可编辑 ──
    // 08-25 的 R3「只能在链尾编辑」已随 2026-08-26 spec §4 删除。删掉一道门之后最容易悄悄回归的
    // 就是它,所以这条用例改写口径继续留着:历史月钉在 v1、链尾早已走远,从那个月编辑必须放行。
    @Test
    void s10_monthPinnedToOlderVersion_isStillEditable() throws Exception {
        JsonNode book = M.readTree(getOk("/api/books?screen=s10")).path("data").get(0);
        int id = book.path("id").asInt();

        // 在空月 2026-09 加一列 → 链尾升到 v2,但只带走 2026-09
        ObjectNode d = M.readTree(getOk("/api/books/" + id + "/template/at/2026/9"))
                .path("data").path("definition").deepCopy();
        ObjectNode col = ((ArrayNode) d.path("groups").get(0).path("cols")).addObject();
        col.put("id", "c_s10probe"); col.put("std", false); col.put("label", "s10 探针");
        col.put("slot", "other"); col.put("hidden", false); col.putNull("w"); col.putArray("aliases");
        putOk("/api/books/" + id + "/template", "{\"definition\":" + d + ",\"year\":2026,\"month\":9}");
        int tip = M.readTree(getOk("/api/books?screen=s10")).path("data").get(0).path("ver").asInt();
        assertThat(tip).isGreaterThan(1);

        // 2026-07 沿用最近一个更早月份的 pin(种子数据止于 2026-06)→ 停在 v1,不在链尾
        assertThat(M.readTree(getOk("/api/books/" + id + "/template/at/2026/7"))
                .path("data").path("ver").asInt()).as("空月沿用更早的 pin,停在非链尾").isEqualTo(1);

        // 停在非链尾仍可编辑 —— R3 删除之前这里是 409
        ObjectNode d2 = M.readTree(getOk("/api/books/" + id + "/template/at/2026/7"))
                .path("data").path("definition").deepCopy();
        ObjectNode first = (ObjectNode) d2.path("groups").get(0).path("cols").get(0);
        first.put("label", first.path("label").asText() + "·改");
        putOk("/api/books/" + id + "/template", "{\"definition\":" + d2 + ",\"year\":2026,\"month\":7}");
    }
}
