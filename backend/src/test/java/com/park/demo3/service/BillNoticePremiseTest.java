package com.park.demo3.service;

import com.park.demo3.entity.Meter;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * S6 §2 场地标签按表定位:纯单测,不起 Spring、不连库。
 * 口径唯一事实源 docs/design/S6-PREMISE-BY-METER-SPEC.md §2.1/§2.2/§2.3。
 */
class BillNoticePremiseTest {

    private static Meter meter(String roomNo, String name, String spot, String subName) {
        Meter m = new Meter();
        m.setRoomNo(roomNo); m.setName(name); m.setSpot(spot); m.setSubName(subName);
        return m;
    }

    // 合同 1 = 逐间计费行(B 类);合同 2 = 单条合并串(A 类,改拼接救不了)
    private static final String MERGED = "宿舍一栋309、310、…、528室";
    private static final Map<Integer, List<String>> LOCS = Map.of(
        1, List.of("宿舍一栋309室", "宿舍一栋310室", "宿舍一栋311室"),
        2, List.of(MERGED),
        3, List.of("宿舍区二号楼首层2101、2102室"),
        4, List.of("一期D座三楼整层"));   // 按整层计的合同:location 整串无房号

    // ── §2.1 tok:最长连续数字段,3≤len≤4 ──
    @Test
    void tokTakesOnlyThreeToFourDigitRuns() {
        assertThat(BillNoticeService.tok("202007151529")).isEmpty();   // 12 位 code 整段落选,不切子串
        assertThat(BillNoticeService.tok("309.00")).containsExactly("309");
        assertThat(BillNoticeService.tok("三楼 1-309")).containsExactly("309");
        assertThat(BillNoticeService.tok("一楼商铺 2101、2102")).containsExactlyInAnyOrder("2101", "2102");
        assertThat(BillNoticeService.tok("501-504")).containsExactlyInAnyOrder("501", "504");
        assertThat(BillNoticeService.tok("二期11号楼西边301、401单元"))
            .containsExactlyInAnyOrder("301", "401");                  // 「11」两位不入
        assertThat(BillNoticeService.tok(null)).isEmpty();
    }

    // ── §2.1 roomTokens:name/room_no 压 spot/sub_name ──
    @Test
    void roomTokensPrefersNameAndRoomNoOverSpot() {
        // 锚:表 929 name=411.00 / spot=五楼 1-516(516 另有其表,认 spot 会让 411 房没水表)
        assertThat(BillNoticeService.roomTokens(meter(null, "411.00", "五楼 1-516", null)))
            .containsExactly("411");
        assertThat(BillNoticeService.roomTokens(meter("430室", "1-431", "五楼", null)))
            .containsExactlyInAnyOrder("430", "431");
        // 首选层无 token 才回落
        assertThat(BillNoticeService.roomTokens(meter(null, "总表", "五楼 1-516", "副表602")))
            .containsExactlyInAnyOrder("516", "602");
        assertThat(BillNoticeService.roomTokens(meter(null, "总表", null, null))).isEmpty();
    }

    // ── §2.2 唯一命中 → 计费行原文(与公摊行同源) ──
    @Test
    void uniqueHitReturnsBillingRowText() {
        assertThat(BillNoticeService.resolveMeterPremise(meter(null, "309.00", null, null), 1, LOCS))
            .isEqualTo("宿舍一栋309室");
    }

    // ── §2.2 多命中 → 回退今天的行为,不猜 ──
    @Test
    void multiHitFallsBackToContractJoin() {
        assertThat(BillNoticeService.resolveMeterPremise(meter(null, "309、310", null, null), 1, LOCS))
            .isEqualTo("宿舍一栋309室、宿舍一栋310室、宿舍一栋311室");
    }

    // ── §2.2 零命中 / 无 token / 无 location / 无合同 → 回退 ──
    @Test
    void zeroHitAndDegenerateInputsFallBack() {
        String join = "宿舍一栋309室、宿舍一栋310室、宿舍一栋311室";
        assertThat(BillNoticeService.resolveMeterPremise(meter(null, "999.00", null, null), 1, LOCS))
            .isEqualTo(join);                                          // 房号不在本合同清单(D3)
        assertThat(BillNoticeService.resolveMeterPremise(meter(null, "总表", null, null), 1, LOCS))
            .isEqualTo(join);                                          // 表侧抽不出房号
        assertThat(BillNoticeService.resolveMeterPremise(meter(null, "309.00", null, null), 9, LOCS))
            .isNull();                                                 // 该合同无计费行 location
        assertThat(BillNoticeService.resolveMeterPremise(meter(null, "309.00", null, null), null, LOCS))
            .isNull();
    }

    // ── §2.2 A 类合并串:唯一命中 + |tok(L)|>1 + |inter|==1 → 合成单间 ──
    @Test
    void mergedLocationSynthesizesSingleRoom() {
        assertThat(BillNoticeService.resolveMeterPremise(meter(null, "309.00", null, null), 2, LOCS))
            .isEqualTo("宿舍一栋309室");
    }

    // ── §2.2 |inter|>1 不合成:表确实同时管几间,原文才是对的 ──
    @Test
    void multiRoomMeterKeepsOriginalText() {
        assertThat(BillNoticeService.resolveMeterPremise(meter(null, "一楼商铺 2101、2102", null, null), 3, LOCS))
            .isEqualTo("宿舍区二号楼首层2101、2102室");
    }

    // ── §2.4 告警只认「真·零命中」:no_token / multi_hit 都不是「场地未定」 ──
    @Test
    void onlyTrueZeroHitIsFlaggedUndecided() {
        // 真·零命中:表有房号、合同有候选计费行,却一条都对不上(D3 借表/挂错合同,人工归属可消)
        BillNoticeService.Pin zero = BillNoticeService.pin(meter(null, "999.00", null, null), 1, LOCS);
        assertThat(zero.tokens()).isEqualTo(1);
        assertThat(zero.cands()).isEqualTo(3);
        assertThat(zero.hits()).isZero();
        assertThat(zero.undecided()).isTrue();
        // no_token:整栋表/借电表压根没房号 → 无场地可定,告警永远消不掉,不出噪音
        BillNoticeService.Pin noToken = BillNoticeService.pin(meter(null, "总表", null, null), 1, LOCS);
        assertThat(noToken.tokens()).isZero();
        assertThat(noToken.undecided()).isFalse();
        // multi_hit:一表合法地同时管几间(桑尼号「二楼201、301室」)=已定场地,与 §2.2 |inter|>1 同构
        BillNoticeService.Pin multi = BillNoticeService.pin(meter(null, "309、310", null, null), 1, LOCS);
        assertThat(multi.hits()).isEqualTo(2);
        assertThat(multi.undecided()).isFalse();
        // 无候选(合同无计费行 location / 无合同归属):无处可定,与 S6 前一致不告警
        assertThat(BillNoticeService.pin(meter(null, "309.00", null, null), 9, LOCS).undecided()).isFalse();
        assertThat(BillNoticeService.pin(meter(null, "309.00", null, null), null, LOCS).undecided()).isFalse();
    }

    // ── §2.4 候选侧无房号(整层/整栋计的合同)不是「未定」,有房号却对不上仍是 ──
    @Test
    void contractWithoutRoomNumbersIsNeverUndecided() {
        // 锚:金纳合同 5 条计费行 location 全是「一期D座三楼整层」(整串无 3~4 位房号),
        // 而表名/房号「金纳D301电 / 301室」抽得出 301 → 老判据误报三条「场地未定」
        BillNoticeService.Pin whole = BillNoticeService.pin(meter("301室", "金纳D301电", null, null), 4, LOCS);
        assertThat(whole.tokens()).isEqualTo(1);
        assertThat(whole.cands()).isEqualTo(1);
        assertThat(whole.hits()).isZero();
        assertThat(whole.undecided()).isFalse();       // 候选侧无房号可对,不是数据缺口
        // 对照:合同房间清单有房号、表也有房号、就是对不上 = D3 借表/挂错合同,必须继续报
        assertThat(BillNoticeService.pin(meter(null, "999.00", null, null), 1, LOCS).undecided()).isTrue();
    }

    // ── §2.5 整层回退(S17):房号零命中时,表侧楼层文本与「无房号候选」唯一同层 → 落整层场地 ──
    @Test
    void wholeFloorFallbackPinsRoomlessCandidateByFloor() {
        Map<Integer, List<String>> locs = Map.of(
            5, List.of("一期D座二楼", "宿舍楼四座630室"),
            6, List.of("一期D座二楼", "一期E座二楼"));
        // 汤周杰型:5 表房号 201 打不中 630,但 spot「二楼201室」↔「一期D座二楼」唯一同层 → 细化,不再未定
        BillNoticeService.Pin tang = BillNoticeService.pin(meter("201室", "D201电", "二楼201室", null), 5, locs);
        assertThat(tang.text()).isEqualTo("一期D座二楼");
        assertThat(tang.hits()).isEqualTo(1);
        assertThat(tang.undecided()).isFalse();
        // 楼层对不上:三楼表 vs 二楼整层 → 回退不触发,仍是真·零命中(D3 借表/挂错合同要继续报)
        BillNoticeService.Pin miss = BillNoticeService.pin(meter("301室", null, "三楼301室", null), 5, locs);
        assertThat(miss.text()).isNull();
        assertThat(miss.undecided()).isTrue();
        // 同层多个整层候选 → 歧义不猜(候选全无房号,本就不告警,只是不细化)
        BillNoticeService.Pin ambi = BillNoticeService.pin(meter("201室", null, "二楼201室", null), 6, locs);
        assertThat(ambi.text()).isNull();
        assertThat(ambi.undecided()).isFalse();
        // 表侧无楼层文本 → 不触发回退(金纳 301室 无「N楼」字样,行为与既有用例一致)
        assertThat(BillNoticeService.pin(meter("301室", "金纳D301电", null, null), 4, LOCS).text()).isNull();
        // floorOf 变体
        assertThat(BillNoticeService.floorOf("2F-2F整层")).isEqualTo(2);
        assertThat(BillNoticeService.floorOf("首层商铺")).isEqualTo(1);
        assertThat(BillNoticeService.floorOf("十一楼")).isEqualTo(11);
        assertThat(BillNoticeService.floorOf("11号楼")).isNull();
        assertThat(BillNoticeService.floorOf("宿舍楼四座630室")).isNull();
    }

    // ── §2.5b 单元候选(S17):结构化楼层/单元号驱动——「合同里写了2F整层」就是判据,不靠文本抠字 ──
    @Test
    void unitCandidatesDriveWholeFloorPin() {
        Map<Integer, List<String>> locs = Map.of(7, List.of("一期D座", "宿舍楼四座630室"));
        Map<Integer, List<BillNoticeService.UnitCand>> ucs = Map.of(7, List.of(
            new BillNoticeService.UnitCand(2, java.util.Set.of(), "一期D座"),            // 「2F-2F整层」:floor=2,无房号token
            new BillNoticeService.UnitCand(6, java.util.Set.of("630"), "宿舍楼四座630室")));
        // b级:location 文本连楼层字样都没有(「一期D座」),单元结构化 floor=2 仍能落位
        BillNoticeService.Pin p = BillNoticeService.pin(meter("201室", "D201电", "二楼201室", null), 7, locs, ucs);
        assertThat(p.text()).isEqualTo("一期D座");
        assertThat(p.undecided()).isFalse();
        // a级:表房号 ↔ 单元号 token(location 文本无 630 也能中)
        Map<Integer, List<String>> locs2 = Map.of(8, List.of("一期D座", "宿舍楼四座"));
        Map<Integer, List<BillNoticeService.UnitCand>> ucs2 = Map.of(8, List.of(
            new BillNoticeService.UnitCand(6, java.util.Set.of("630"), "宿舍楼四座")));
        assertThat(BillNoticeService.pin(meter(null, "630.00", null, null), 8, locs2, ucs2).text())
            .isEqualTo("宿舍楼四座");
        // 歧义:两个同层单元不同 location → 不猜(文本兜底也无楼层字样,维持 null)
        Map<Integer, List<BillNoticeService.UnitCand>> ucs3 = Map.of(7, List.of(
            new BillNoticeService.UnitCand(2, java.util.Set.of(), "一期D座"),
            new BillNoticeService.UnitCand(2, java.util.Set.of(), "一期E座")));
        assertThat(BillNoticeService.pin(meter("201室", null, "二楼201室", null), 7, locs, ucs3).text()).isNull();
        // 3-arg 兼容:老签名=空单元候选,行为与既有用例一致
        assertThat(BillNoticeService.pin(meter("201室", null, "二楼201室", null), 7, locs).text()).isNull();
    }

    // ── §2.3 synthesize:规范表格逐行五例 ──
    @Test
    void synthesizeMatchesSpecTable() {
        assertThat(BillNoticeService.synthesize(MERGED, "309")).isEqualTo("宿舍一栋309室");
        assertThat(BillNoticeService.synthesize("A座孵化器四楼429室、430室、431室", "430"))
            .isEqualTo("A座孵化器四楼430室");
        assertThat(BillNoticeService.synthesize("二期10号楼（三车间）602、603、604单元", "603"))
            .isEqualTo("二期10号楼（三车间）603单元");
        assertThat(BillNoticeService.synthesize("一期C座二楼217、218、219室", "218"))
            .isEqualTo("一期C座二楼218室");
        assertThat(BillNoticeService.synthesize("二期9栋(车间二)101单元、102单元、5楼整层501-504单元", "101"))
            .isEqualTo("二期9栋(车间二)101单元");
    }
}
