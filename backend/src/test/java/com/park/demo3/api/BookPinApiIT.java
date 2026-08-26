package com.park.demo3.api;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.entity.BookMonthPin;
import com.park.demo3.entity.BookTemplateVersion;
import com.park.demo3.entity.LedgerBook;
import com.park.demo3.mapper.BookMonthPinMapper;
import com.park.demo3.mapper.BookTemplateVersionMapper;
import com.park.demo3.mapper.LedgerBookMapper;
import com.park.demo3.service.BookPinService;
import com.park.demo3.service.BookService;
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

/**
 * V111 按月 pin 的回填(spec §7)。
 *
 * ⚠ 迁移在 BookSeeder 启动时就跑完了,测试跑到时既看不到"迁移前"也没法再迁一次 ——
 * 拿迁移后的库自我印证只会得到恒等式(pin 指哪版,读出来就是哪版)。所以这里**自己造前置状态**:
 * 清空 pin 表 → 两条链各加一版 → 让各册的现行版彼此不同,再重跑迁移。
 * 各册现行版不同是关键:全都停在链尾的话,一个"无脑钉链尾"的迁移也能全绿。
 */
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class BookPinApiIT extends AbstractMysqlIT {
    private static final ObjectMapper M = new ObjectMapper();

    @Autowired BookMonthPinMapper pins;
    @Autowired BookPinService pinSvc;
    @Autowired LedgerBookMapper booksMapper;
    @Autowired BookTemplateVersionMapper versionsMapper;
    @Autowired BookService bookSvc;
    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }

    // 种子事实(改种子这些数字就该红):V5 台账 3 公司 × 2026-01..05;
    // V18 附表10 phase1..3 各 30 月(2024 全年 + 2025 全年 + 2026-01..06),phase4 无租户不插行
    private static final int LEDGER_MONTHS = 5, S10_MONTHS = 30, S10_PHASES_WITH_DATA = 3;

    /** 造出来的"迁移前"状态。 */
    private record Pre(LedgerBook laggard, long laggardVer,   // 停在 v1 的台账公司册
                       LedgerBook follower, long followerVer, // 跟到 v2 的台账公司册
                       long ledgerTipVer,
                       LedgerBook p1, long p1Ver,             // 自家链升到 v2 的期区册
                       LedgerBook p2, long p2Ver) {}          // 还停在自家 v1 的期区册

    @Test
    void migrate_pinsEachBookToItsOwnCurrentVersion_notTheChainTip() {
        Pre pre = buildPreMigrationState();
        pinSvc.migrateExisting();

        // ── 台账:同一条链上两家停在不同版,pin 必须各随各的,不是一律钉链尾 ──
        assertThat(pre.laggardVer).isNotEqualTo(pre.ledgerTipVer);
        for (int m = 1; m <= LEDGER_MONTHS; m++) {
            assertThat(pinVer("ledger", pre.laggard.getCompanyId(), 2026, m))
                .as("落后那家的 2026-%d 必须钉它自己的现行版,不是链尾", m).isEqualTo(pre.laggardVer);
            assertThat(pinVer("ledger", pre.follower.getCompanyId(), 2026, m))
                .as("跟到链尾那家的 2026-%d", m).isEqualTo(pre.followerVer);
        }

        // ── 附表10:owner 是 phase;acct_month 'YYYY-MM' 要拆对;每册认自己那条链 ──
        assertThat(pinVer("s10", 1, 2024, 1)).as("最早的月份(拆串的边界)").isEqualTo(pre.p1Ver);
        assertThat(pinVer("s10", 1, 2026, 6)).as("最晚的月份").isEqualTo(pre.p1Ver);
        assertThat(pinVer("s10", 1, 2024, 12)).as("两位数月份不能被 substring 截错").isEqualTo(pre.p1Ver);
        assertThat(pinVer("s10", 2, 2024, 1)).as("phase2 走自己那条链的现行版").isEqualTo(pre.p2Ver);
        assertThat(pre.p1Ver).isNotEqualTo(pre.p2Ver);
        assertThat(pins.at("s10", 4, 2026, 6)).as("phase4 没有数据行,不建 pin").isNull();

        // ── 条数:少转几圈就该红(V18 一行都不回填时,上面 by-phase 的断言会先炸,这里兜住整体规模)──
        assertThat(count("ledger")).isEqualTo((long) booksMapper.ledgerCompanyBooks().size() * LEDGER_MONTHS);
        assertThat(count("s10")).isEqualTo((long) S10_PHASES_WITH_DATA * S10_MONTHS);

        // ── 收尾:台账公司册的指针作废置 NULL;宿主行与期区册的仍是链尾标记,不许被顺手清掉 ──
        for (LedgerBook b : booksMapper.ledgerCompanyBooks())
            assertThat(booksMapper.selectById(b.getId()).getCurrentVersionId())
                .as("台账公司册 %s 的 current_version_id 应作废", b.getName()).isNull();
        assertThat(booksMapper.lineageHost().getCurrentVersionId()).as("宿主行仍标链尾").isNotNull();
        for (int phase = 1; phase <= 4; phase++)
            assertThat(booksMapper.byPhase(phase).getCurrentVersionId())
                .as("期区册 %d 仍标自己那条链的链尾", phase).isNotNull();
    }

    @Test
    void migrate_everyExistingMonthStillReadsItsPreMigrationDefinition() {
        Pre pre = buildPreMigrationState();
        String laggardDef = definitionOf(pre.laggardVer), followerDef = definitionOf(pre.followerVer);
        String p1Def = definitionOf(pre.p1Ver), p2Def = definitionOf(pre.p2Ver);
        pinSvc.migrateExisting();

        // spec §7:迁移后用户看到的每一个月,列与迁移前逐字节相同
        for (int m = 1; m <= LEDGER_MONTHS; m++) {
            assertThat(readDefAt(pre.laggard.getId(), 2026, m)).isEqualTo(laggardDef);
            assertThat(readDefAt(pre.laggard.getId(), 2026, m))
                .as("落后那家不该被链尾的新列污染").doesNotContain("c_ledger_v2");
            assertThat(readDefAt(pre.follower.getId(), 2026, m)).isEqualTo(followerDef);
        }
        assertThat(readDefAt(pre.p1.getId(), 2024, 1)).isEqualTo(p1Def);
        assertThat(readDefAt(pre.p1.getId(), 2026, 6)).isEqualTo(p1Def);
        assertThat(readDefAt(pre.p2.getId(), 2024, 1)).isEqualTo(p2Def);
        assertThat(readDefAt(pre.p2.getId(), 2026, 6))
            .as("phase2 停在自家 v1,不该看到 phase1 那条链上的列").doesNotContain("c_s10_v2");
    }

    @Test
    void migrate_isIdempotent_secondRunAddsNothing() {
        // 启动时已经迁过一轮;这里跑的是那一轮的产物
        long ledger = count("ledger"), s10 = count("s10");
        assertThat(ledger).as("台账回填必须产出 pin").isGreaterThan(0);
        assertThat(s10).as("附表10 回填必须产出 pin —— 只数总数的话,s10 一行不回填也看不出来").isGreaterThan(0);
        pinSvc.migrateExisting();
        assertThat(count("ledger")).as("重跑不产生第二批台账 pin").isEqualTo(ledger);
        assertThat(count("s10")).as("重跑不产生第二批附表10 pin").isEqualTo(s10);
    }

    // ── P6 录入即冻结(Task 3) ──

    @Test
    void firstDataWrite_materializesPin_andEarlierMonthChangesNoLongerLeak() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0], bookId = ((JsonNode) cb[1]).path("id").asInt();

        // 2026-05 落一行数据 → pin 被固化
        putOk("/api/ledger/companies/" + companyId + "/months/2026/5",
              "{\"rows\":[{\"tenantName\":\"冻结测试户\",\"factoryRent\":100}]}");
        assertThat(pins.at("ledger", companyId, 2026, 5)).as("首次落库必须固化 pin").isNotNull();
        int verAt5 = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/5"))
                .path("data").path("ver").asInt();
        assertThat(verAt5).as("读不出版本号的话下面那句 isEqualTo 就是 0==0,等于没测").isPositive();

        // 改更早月份(2026-02,空月)的模板 → 5 月不受影响(本次的核心诉求)
        ObjectNode def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/2"))
                .path("data").path("definition").deepCopy();
        ObjectNode col = ((ArrayNode) def.path("groups").path(0).path("cols")).addObject();
        col.put("id", "c_leakprobe").put("std", false).put("label", "泄漏探针")
           .put("slot", "other").put("hidden", false).putNull("w").set("aliases", def.arrayNode());
        putOk("/api/books/" + bookId + "/template",
              "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":2}");

        String at5 = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/5")).toString();
        assertThat(at5).as("已录入月份不受更早月份改动影响").doesNotContain("c_leakprobe");
        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/5"))
                .path("data").path("ver").asInt()).isEqualTo(verAt5);
    }

    @Test
    void recordedMonth_isFrozen_forBothPinAndEdit_thawsWhenDataCleared() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0], bookId = ((JsonNode) cb[1]).path("id").asInt();
        putOk("/api/ledger/companies/" + companyId + "/months/2026/6",
              "{\"rows\":[{\"tenantName\":\"冻结户\",\"factoryRent\":100}]}");

        // 切版本 → 409
        mvc.perform(post("/api/books/" + bookId + "/template/pin").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1,\"year\":2026,\"month\":6}"))
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("已录入")));

        // 编辑模板 → 409
        String def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/6"))
                .path("data").path("definition").toString();
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"definition\":" + def + ",\"year\":2026,\"month\":6}"))
                .andExpect(jsonPath("$.code").value(409));

        // 删光数据 → 解冻。⚠ 空 rows 数组不是「删光」:save 只遍历 body 里送来的行,没送回的行原样留着。
        //   清空的口径是把那一行以全空内容送回去(LedgerService.save 的 blank 分支 → deleteById)
        putOk("/api/ledger/companies/" + companyId + "/months/2026/6",
              "{\"rows\":[{\"tenantName\":\"冻结户\"}]}");
        assertThat(M.readTree(getOk("/api/ledger/companies/" + companyId + "/months/2026/6"))
                .path("data").path("rows").toString())
                .as("解冻的前提是数据真的没了").doesNotContain("冻结户");
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"definition\":" + def + ",\"year\":2026,\"month\":6}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    @Test
    void import_alsoMaterializesPin() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0];
        mvc.perform(post("/api/ledger/companies/" + companyId + "/import")
                .param("year", "2026").param("month", "10")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"导入固化户\",\"factoryRent\":100}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        assertThat(pins.at("ledger", companyId, 2026, 10)).as("导入落库同样要固化 pin").isNotNull();
    }

    @Test
    void importDictionary_followsTheMonthsPin_notTheCompanys() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0], bookId = ((JsonNode) cb[1]).path("id").asInt();

        // 前置:1 月先落一行 → pin 固化在当下这版。没有它,1 月按 P3 第 3 步落到**链尾**,
        // 而链尾正是下面这次编辑要产出的新版 —— 「词典跟着月份走」当场变成恒真,用例自证不了
        putOk("/api/ledger/companies/" + companyId + "/months/2026/1",
              "{\"rows\":[{\"tenantName\":\"占位户\",\"factoryRent\":100}]}");

        // 11 月(空月)加一个自定义列 → 只有 11 月及其之后的空月认得它
        ObjectNode def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/11"))
                .path("data").path("definition").deepCopy();
        ObjectNode col = ((ArrayNode) def.path("groups").path(0).path("cols")).addObject();
        col.put("id", "c_dictprobe").put("std", false).put("label", "词典探针")
           .put("slot", "other").put("hidden", false).putNull("w").set("aliases", def.arrayNode());
        putOk("/api/books/" + bookId + "/template",
              "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":11}");
        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/11")).toString())
                .as("11 月认得新列").contains("c_dictprobe");

        // 往 1 月(钉在旧版,解析不到这个新版)导该列 → 未知 id,记名跳过
        mvc.perform(post("/api/ledger/companies/" + companyId + "/import")
                .param("year", "2026").param("month", "1")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"词典户\",\"extraFees\":{\"c_dictprobe\":10}}]}"))
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("未知自定义列")));
    }

    // R7 切指针不造版本 / R8 可跨版跳(spec §4 保留项)。pin 只写 book_month_pin,不碰版本链。
    @Test
    void pin_crossVersionJumpToTip_doesNotCreateVersion() throws Exception {
        Object[] cb = createCompanyWithBook();
        int bookId = ((JsonNode) cb[1]).path("id").asInt();

        // 造链:三次保存 → v2(钉 4 月)、v3(钉 6 月)、v4(钉 8 月,链尾)。都是空月,不撞 P6 冻结
        addCustomCol(bookId, "c_jump2", 2026, 4);
        addCustomCol(bookId, "c_jump3", 2026, 6);
        addCustomCol(bookId, "c_jump4", 2026, 8);
        int chainLen = M.readTree(getOk("/api/books/" + bookId + "/template/versions"))
                .path("data").path("versions").size();
        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/4"))
                .path("data").path("ver").asInt()).isEqualTo(2);

        // 4 月从 v2 直接跳到 v4(跳过 v3)
        mvc.perform(post("/api/books/" + bookId + "/template/pin").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":4,\"year\":2026,\"month\":4}"))
                .andExpect(jsonPath("$.code").value(0));

        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/4"))
                .path("data").path("ver").asInt()).as("R8:能从旧版跨过中间版直接跳到链尾").isEqualTo(4);
        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/versions"))
                .path("data").path("versions").size()).as("R7:切指针不造版本").isEqualTo(chainLen);
        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/6"))
                .path("data").path("ver").asInt()).as("只钉这一个月,6 月不动").isEqualTo(3);
    }

    // 附表10 同一条规则(计划全局约束「两屏同做」):owner=phase,acct_month 的 'YYYY-MM' 要拆对。
    // 只测台账的话,固化钩子只挂了一半、或冻结判定的 s10 分支写错,都能全绿收尾。
    @Test
    void s10_recordSave_materializesPin_andFreezesThatMonth() throws Exception {
        int bookId = s10BookId(1);
        // 2026-08 是空月(V18 种子止于 2026-06)
        mvc.perform(post("/api/s10").header("Authorization", auth()).contentType("application/json")
                .content("{\"tenantName\":\"附表10冻结户\",\"phase\":1,\"acctMonth\":\"2026-08\","
                        + "\"profile\":\"factory\",\"factoryRent\":100}"))
                .andExpect(jsonPath("$.code").value(0));
        assertThat(pins.at("s10", 1, 2026, 8)).as("附表10 落库同样要固化 pin").isNotNull();

        String def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/8"))
                .path("data").path("definition").toString();
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"definition\":" + def + ",\"year\":2026,\"month\":8}"))
                .andExpect(jsonPath("$.code").value(409));

        // 种子月(2026-06 有 V18 数据)同样冻结 —— 不靠本用例刚写的那一行
        mvc.perform(post("/api/books/" + bookId + "/template/pin").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1,\"year\":2026,\"month\":6}"))
                .andExpect(jsonPath("$.code").value(409));
        // 空月照旧放行(冻结不能变成「s10 一律不许改」)
        mvc.perform(post("/api/books/" + bookId + "/template/pin").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1,\"year\":2026,\"month\":9}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── 复核补丁(2026-08-26 Task 3 复核):Integer 引用比较、s10 导入侧零覆盖、保存路径白名单仍走链尾 ──

    // ver 是 Integer,`v.getVer() == req.ver()` 是引用比较,只在 -128..127 的 Integer 缓存里碰巧成立。
    // 台账全屏共用一条全局链、ver 全系统累加,过了 127 之后会对**存在的**版本报「版本不存在」。
    @Test
    void pin_findsVersionByValue_notByIdentity_aboveTheIntegerCache() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0], bookId = ((JsonNode) cb[1]).path("id").asInt();
        long v200 = addVersion(booksMapper.lineageHost().getId(), 200, "c_bigver");

        mvc.perform(post("/api/books/" + bookId + "/template/pin").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":200,\"year\":2026,\"month\":7}"))
                .andExpect(jsonPath("$.code").value(0));
        assertThat(pins.at("ledger", companyId, 2026, 7))
                .as("ver=200 是链上真实存在的版本,必须钉得上").isNotNull();
        assertThat(pins.at("ledger", companyId, 2026, 7).getVersionId()).isEqualTo(v200);
    }

    // 台账 import_alsoMaterializesPin 的附表10 镜像:导入是与手工保存并列的另一条写路径,
    // 只测台账的话,固化钩子在 s10 侧只挂一半也能全绿收尾(计划全局约束「两屏同做」)。
    @Test
    void s10Import_alsoMaterializesPin() throws Exception {
        // 2026-10 是空月(V18 种子止于 2026-06)
        assertThat(pins.at("s10", 1, 2026, 10)).as("前置:该月还没被钉过").isNull();
        mvc.perform(post("/api/s10/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"phase\":1,\"acctMonth\":\"2026-10\",\"rows\":[{\"tenantName\":\"附10导入固化户\","
                        + "\"profile\":\"factory\",\"factoryRent\":100}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        assertThat(pins.at("s10", 1, 2026, 10)).as("附表10 导入落库同样要固化 pin").isNotNull();
    }

    // 台账 importDictionary_followsTheMonthsPin_notTheCompanys 的附表10 镜像(owner=phase)。
    @Test
    void s10ImportDictionary_followsTheMonthsPin_notThePhases() throws Exception {
        int bookId = s10BookId(1);
        // 前置:2026-06 有 V18 种子数据,回填时已钉在当时那一版
        assertThat(pins.at("s10", 1, 2026, 6)).as("种子月必须已有 pin,否则下面测的是链尾恒真").isNotNull();

        // 9 月(空月)加一个自定义列 → 新版只属于 9 月及其之后的空月
        addCustomCol(bookId, "c_s10dictprobe", 2026, 9);
        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/9")).toString())
                .as("9 月认得新列").contains("c_s10dictprobe");

        // 往 2026-06(钉在旧版)导该列 → 未知 id,记名跳过
        mvc.perform(post("/api/s10/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"phase\":1,\"acctMonth\":\"2026-06\",\"rows\":[{\"tenantName\":\"附10词典户\","
                        + "\"profile\":\"factory\",\"extraFees\":{\"c_s10dictprobe\":10}}]}"))
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("未知自定义列")));
    }

    // 保存路径的口袋键白名单也必须按月(spec §6 那张「逐个确认无漏网」的表里,「新月份首次落库」
    // 一行给的安全理由就是「数据本身经 customIdsAt 校验过」)。走链尾的话,钉在旧版的月份能被写进
    // 该版根本没有的 c_ 列 —— 正是那张表声称已堵死的洞。
    @Test
    void save_extraFeeWhitelist_followsTheMonthsPin_notTheChainTip() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0], bookId = ((JsonNode) cb[1]).path("id").asInt();

        // 1 月(空月)加列 → v2;随即往这列落钱 → 1 月钉死在 v2
        addCustomCol(bookId, "c_janknown", 2026, 1);
        putOk("/api/ledger/companies/" + companyId + "/months/2026/1",
              "{\"rows\":[{\"tenantName\":\"口袋户\",\"extraFees\":{\"c_janknown\":5}}]}");
        assertThat(M.readTree(getOk("/api/ledger/companies/" + companyId + "/months/2026/1")).toString())
                .as("本月认得的列必须写得进去 —— 否则下面那条 400 可能只是「一律拒收」").contains("口袋户");

        // 11 月(空月)再加一列 → 链尾 v3,1 月不认得
        addCustomCol(bookId, "c_novprobe", 2026, 11);
        mvc.perform(put("/api/ledger/companies/" + companyId + "/months/2026/1")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"幽灵钱户\",\"extraFees\":{\"c_novprobe\":10}}]}"))
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString("未知自定义列")));
    }

    // 同上,附表10 侧(owner=phase;acctMonth 'YYYY-MM' 要拆对)。
    @Test
    void s10Save_extraFeeWhitelist_followsTheMonthsPin_notTheChainTip() throws Exception {
        int bookId = s10BookId(1);

        // 2026-07(空月)加列 → v2;随即往这列落钱 → 7 月钉死在 v2
        addCustomCol(bookId, "c_s10known", 2026, 7);
        mvc.perform(post("/api/s10").header("Authorization", auth()).contentType("application/json")
                .content("{\"tenantName\":\"附10口袋户\",\"phase\":1,\"acctMonth\":\"2026-07\","
                        + "\"profile\":\"factory\",\"extraFees\":{\"c_s10known\":5}}"))
                .andExpect(jsonPath("$.code").value(0));

        // 9 月(空月)再加一列 → 链尾 v3,7 月不认得
        addCustomCol(bookId, "c_s10later", 2026, 9);
        mvc.perform(post("/api/s10").header("Authorization", auth()).contentType("application/json")
                .content("{\"tenantName\":\"附10幽灵钱户\",\"phase\":1,\"acctMonth\":\"2026-07\","
                        + "\"profile\":\"factory\",\"extraFees\":{\"c_s10later\":9}}"))
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString("未知自定义列")));
    }

    // ── MockMvc 脚手架(照 BookApiIT) ──

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
        String name = "钉测" + Long.toString(System.nanoTime(), 36);
        String created = new String(mvc.perform(post("/api/companies").header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"" + name + "\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
        int companyId = JsonPath.read(created, "$.data.id");
        JsonNode all = M.readTree(getOk("/api/books?screen=ledger")).path("data");
        JsonNode mine = null;
        for (JsonNode b : all) if (b.path("companyId").asInt() == companyId) mine = b;
        assertThat(mine).as("建司必须附带建台账册").isNotNull();
        return new Object[]{ companyId, mine };
    }

    /** 在某月的生效版上加一个自定义列并保存(P4:升版 + 只把该月切过去)。 */
    private void addCustomCol(int bookId, String colId, int year, int month) throws Exception {
        ObjectNode def = M.readTree(getOk("/api/books/" + bookId + "/template/at/" + year + "/" + month))
                .path("data").path("definition").deepCopy();
        ObjectNode col = ((ArrayNode) def.path("groups").path(0).path("cols")).addObject();
        col.put("id", colId).put("std", false).put("label", colId)
           .put("slot", "other").put("hidden", false).putNull("w").set("aliases", def.arrayNode());
        putOk("/api/books/" + bookId + "/template",
              "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":" + year + ",\"month\":" + month + "}");
    }

    private int s10BookId(int phase) throws Exception {
        for (JsonNode b : M.readTree(getOk("/api/books?screen=s10")).path("data"))
            if (b.path("phase").asInt() == phase) return b.path("id").asInt();
        throw new IllegalStateException("附表10 期区册不存在:phase=" + phase);
    }

    // ── 前置状态 ──

    private Pre buildPreMigrationState() {
        pins.delete(new QueryWrapper<BookMonthPin>().gt("id", 0));

        LedgerBook host = booksMapper.lineageHost();
        long ledgerV1 = versionsMapper.tip(host.getId()).getId();
        long ledgerV2 = addVersion(host.getId(), "c_ledger_v2");
        List<LedgerBook> comps = booksMapper.ledgerCompanyBooks();
        assertThat(comps.size()).as("种子至少两家公司才能造出「现行版不一致」").isGreaterThanOrEqualTo(2);
        LedgerBook laggard = comps.get(0), follower = comps.get(1);
        setPointer(laggard, ledgerV1);
        for (int i = 1; i < comps.size(); i++) setPointer(comps.get(i), ledgerV2);

        LedgerBook p1 = booksMapper.byPhase(1), p2 = booksMapper.byPhase(2);
        long p2V1 = p2.getCurrentVersionId();                 // 期区册的指针启动迁移不动它
        long p1V2 = addVersion(p1.getId(), "c_s10_v2");       // 只给一期升一版
        setPointer(p1, p1V2);

        return new Pre(laggard, ledgerV1, follower, ledgerV2, ledgerV2, p1, p1V2, p2, p2V1);
    }

    /** 在某条链上追加一版(链尾+1),定义 = 链尾版加一个探针自定义列。 */
    private long addVersion(Integer chainBookId, String probeColId) {
        return addVersion(chainBookId, versionsMapper.tip(chainBookId).getVer() + 1, probeColId);
    }

    /** 同上,但版本号指定 —— 造「ver 超出 Integer 缓存」这种要跑一百多次保存才碰得到的前置状态。 */
    private long addVersion(Integer chainBookId, int ver, String probeColId) {
        try {
            BookTemplateVersion tip = versionsMapper.tip(chainBookId);
            ObjectNode def = (ObjectNode) M.readTree(tip.getDefinition());
            ObjectNode col = ((ArrayNode) def.path("groups").path(0).path("cols")).addObject();
            col.put("id", probeColId).put("std", false).put("label", probeColId)
               .put("slot", "other").put("hidden", false).putNull("w");
            col.set("aliases", def.arrayNode());
            BookTemplateVersion v = new BookTemplateVersion();
            v.setBookId(chainBookId); v.setVer(ver);
            v.setDefinition(def.toString()); v.setNote("IT 造的前置状态"); v.setCreatedBy("IT");
            versionsMapper.insert(v);
            return v.getId();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private void setPointer(LedgerBook b, long versionId) {
        b.setCurrentVersionId(versionId);
        booksMapper.updateById(b);
    }

    private Long pinVer(String screen, Integer ownerId, int year, int month) {
        BookMonthPin p = pins.at(screen, ownerId, year, month);
        assertThat(p).as("%s owner=%d %d-%d 必须有 pin", screen, ownerId, year, month).isNotNull();
        return p.getVersionId();
    }

    private long count(String screen) {
        return pins.selectCount(new QueryWrapper<BookMonthPin>().eq("screen", screen));
    }

    /** 版本行里存的定义(过一遍 Jackson,与读接口的序列化口径对齐)。 */
    private String definitionOf(long versionId) {
        try { return M.readTree(versionsMapper.selectById(versionId).getDefinition()).toString(); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    private String readDefAt(Integer bookId, int year, int month) {
        return bookSvc.templateAt(bookId, year, month).definition().toString();
    }
}
