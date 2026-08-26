package com.park.demo3.api;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.entity.BookMonthPin;
import com.park.demo3.entity.BookTemplateVersion;
import com.park.demo3.entity.LedgerBook;
import com.park.demo3.mapper.BookMonthPinMapper;
import com.park.demo3.mapper.BookTemplateVersionMapper;
import com.park.demo3.mapper.LedgerBookMapper;
import com.park.demo3.service.BookPinService;
import com.park.demo3.service.BookService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

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
        try {
            BookTemplateVersion tip = versionsMapper.tip(chainBookId);
            ObjectNode def = (ObjectNode) M.readTree(tip.getDefinition());
            ObjectNode col = ((ArrayNode) def.path("groups").path(0).path("cols")).addObject();
            col.put("id", probeColId).put("std", false).put("label", probeColId)
               .put("slot", "other").put("hidden", false).putNull("w");
            col.set("aliases", def.arrayNode());
            BookTemplateVersion v = new BookTemplateVersion();
            v.setBookId(chainBookId); v.setVer(tip.getVer() + 1);
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
