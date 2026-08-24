package com.park.demo3.service;

import com.park.demo3.common.BizException;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TemplateDefTest {

    static TemplateDef.Col col(String id, boolean std, String label, String slot, boolean hidden) {
        return new TemplateDef.Col(id, std, label, List.of(), slot, hidden, 96);
    }
    static TemplateDef.Def def(TemplateDef.Group... gs) { return new TemplateDef.Def(List.of(gs)); }
    static TemplateDef.Def reparse(TemplateDef.Def d) { return TemplateDef.parse(TemplateDef.write(d)); }

    TemplateDef.Def base() {
        return def(new TemplateDef.Group("g1", "租金", List.of(
                col("factoryRent", true, "厂房租金", "rent", false),
                col("shopRent", true, "商铺租金", "rent", false))),
            new TemplateDef.Group("g2", "电费", List.of(
                col("elecStd", true, "基准电费", "elec", false))));
    }

    // ── parse 校验 ──
    @Test void parse_rejectsDupId_badSlot_customWithoutPrefix() {
        assertThatThrownBy(() -> reparse(def(new TemplateDef.Group("g", "x", List.of(
                col("a", true, "甲", "rent", false), col("a", true, "乙", "rent", false))))))
            .isInstanceOf(BizException.class).hasMessageContaining("重复");
        assertThatThrownBy(() -> reparse(def(new TemplateDef.Group("g", "x", List.of(
                col("a", true, "甲", "太阳能", false))))))
            .isInstanceOf(BizException.class).hasMessageContaining("语义槽");
        assertThatThrownBy(() -> reparse(def(new TemplateDef.Group("g", "x", List.of(
                col("myCol", false, "甲", "misc", false))))))
            .isInstanceOf(BizException.class).hasMessageContaining("c_");
    }

    // ── §3 轻改动:改名/别名/组名 → 非结构 ──
    @Test void renameAliasGroupLabel_isLightChange() {
        TemplateDef.Def a = base();
        TemplateDef.Def b = def(new TemplateDef.Group("g1", "租金收入", List.of(   // 组名变
                new TemplateDef.Col("factoryRent", true, "厂房月租", List.of("厂租"), "rent", false, 120), // 改名+别名+列宽
                col("shopRent", true, "商铺租金", "rent", false))),
            new TemplateDef.Group("g2", "电费", List.of(
                col("elecStd", true, "基准电费", "elec", false))));
        assertThat(TemplateDef.structuralChange(a, b)).isFalse();
        assertThat(TemplateDef.diffSummary(a, b)).contains("改名").contains("别名");
    }

    // ── §3 结构改动:增列/删列/换槽/隐藏/列序/换组 → 升版 ──
    @Test void addRemoveSlotHiddenReorder_areStructural() {
        TemplateDef.Def a = base();
        // 增自定义列
        TemplateDef.Def add = def(a.groups().get(0),
            new TemplateDef.Group("g2", "电费", List.of(
                col("elecStd", true, "基准电费", "elec", false),
                col("c_pv", false, "光伏抵扣", "elec", false))));
        assertThat(TemplateDef.structuralChange(a, add)).isTrue();
        assertThat(TemplateDef.diffSummary(a, add)).contains("新增列「光伏抵扣」");
        // 隐藏切换
        TemplateDef.Def hide = def(new TemplateDef.Group("g1", "租金", List.of(
                col("factoryRent", true, "厂房租金", "rent", false),
                col("shopRent", true, "商铺租金", "rent", true))),
            a.groups().get(1));
        assertThat(TemplateDef.structuralChange(a, hide)).isTrue();
        // 换槽
        TemplateDef.Def reslot = def(new TemplateDef.Group("g1", "租金", List.of(
                col("factoryRent", true, "厂房租金", "misc", false),
                col("shopRent", true, "商铺租金", "rent", false))),
            a.groups().get(1));
        assertThat(TemplateDef.structuralChange(a, reslot)).isTrue();
        // 列序
        TemplateDef.Def reorder = def(new TemplateDef.Group("g1", "租金", List.of(
                col("shopRent", true, "商铺租金", "rent", false),
                col("factoryRent", true, "厂房租金", "rent", false))),
            a.groups().get(1));
        assertThat(TemplateDef.structuralChange(a, reorder)).isTrue();
    }

    // ── §3 标准列不可删(隐藏可以) ──
    @Test void assertStdKept_deleteThrows_hideAllowed() {
        TemplateDef.Def a = base();
        TemplateDef.Def dropped = def(new TemplateDef.Group("g1", "租金", List.of(
                col("factoryRent", true, "厂房租金", "rent", false))),
            a.groups().get(1));
        assertThatThrownBy(() -> TemplateDef.assertStdKept(a, dropped))
            .isInstanceOf(BizException.class).hasMessageContaining("shopRent");
        TemplateDef.Def hidden = def(new TemplateDef.Group("g1", "租金", List.of(
                col("factoryRent", true, "厂房租金", "rent", false),
                col("shopRent", true, "商铺租金", "rent", true))),
            a.groups().get(1));
        TemplateDef.assertStdKept(a, hidden);   // 不抛
    }

    @Test void customIds_collectsOnlyNonStd() {
        TemplateDef.Def d = def(new TemplateDef.Group("g", "x", List.of(
            col("factoryRent", true, "厂房租金", "rent", false),
            col("c_pv", false, "光伏", "elec", false),
            col("c_ad", false, "广告位", "misc", false))));
        assertThat(TemplateDef.customIds(d)).containsExactly("c_pv", "c_ad");
        assertThat(TemplateDef.stdIds(d)).containsExactly("factoryRent");
    }

    // ── 种子模板健全性(§8):三份都能过 parse,列数与现行版面一致,标准列全 std ──
    @Test void seedTemplates_parse_andColumnCountsMatchCurrentLayouts() {
        TemplateDef.Def ledger = TemplateDef.parse(BookTemplates.ledgerStandard());
        TemplateDef.Def office = TemplateDef.parse(BookTemplates.s10Office());
        TemplateDef.Def factory = TemplateDef.parse(BookTemplates.s10Factory());
        assertThat(TemplateDef.flatten(ledger)).hasSize(21);
        assertThat(TemplateDef.flatten(office)).hasSize(25);
        assertThat(TemplateDef.flatten(factory)).hasSize(20);
        List<TemplateDef.Col> all = new ArrayList<>();
        all.addAll(TemplateDef.flatten(ledger));
        all.addAll(TemplateDef.flatten(office));
        all.addAll(TemplateDef.flatten(factory));
        assertThat(all).allMatch(TemplateDef.Col::std);
        // 2024-01 丢列事故词条(SPEC §4 起因):台账 shopRent 必须带「宿舍区租金」别名
        TemplateDef.Col shopRent = TemplateDef.flatten(ledger).stream()
            .filter(c -> c.id().equals("shopRent")).findFirst().orElseThrow();
        assertThat(shopRent.aliases()).contains("宿舍区租金");
    }
}
