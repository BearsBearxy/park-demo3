package com.park.demo3.security;

import com.park.demo3.common.BizException;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 审核键的纯单元测试 —— 不起 Spring 上下文,毫秒级。 */
class ReviewKeyTest {

    @Test
    void parse_roundTrips_allThreeShapes() {
        assertThat(ReviewKey.parse("salary:2024-02").raw()).isEqualTo("salary:2024-02");
        assertThat(ReviewKey.parse("ledger:7:2024-02").scope()).isEqualTo("7");
        assertThat(ReviewKey.parse("ledger:7:2024-02").raw()).isEqualTo("ledger:7:2024-02");
        assertThat(ReviewKey.parse("utilities:phase3:2024-02").kind()).isEqualTo(ReviewKind.UTILITIES);
        // 带连字符的 kind 不能被 ':' 切错 —— 从左边切会把这两条切成不存在的 kind
        assertThat(ReviewKey.parse("charging-ebike:2024-02").kind()).isEqualTo(ReviewKind.CHARGING_EBIKE);
        assertThat(ReviewKey.parse("alloc-loss:2024-02").kind()).isEqualTo(ReviewKind.ALLOC_LOSS);
        assertThat(ReviewKey.parse("elec-model:2024-02").kind()).isEqualTo(ReviewKind.ELEC_MODEL);
    }

    @Test
    void parse_rejects_badPeriod() {
        // MeterService 那份 \d{4}-\d{2} 会放行 2024-00 / 2024-13,审核键不能跟着松
        assertThatThrownBy(() -> ReviewKey.parse("salary:2024-13")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse("salary:2024-00")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse("salary:24-02")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse("salary")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse("")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse(null)).isInstanceOf(BizException.class);
    }

    @Test
    void parse_rejects_unknownKind_and_wrongScopeShape() {
        assertThatThrownBy(() -> ReviewKey.parse("recon:2024-02")).isInstanceOf(BizException.class);
        // salary 是园区级表,不许带 scope
        assertThatThrownBy(() -> ReviewKey.parse("salary:office:2024-02")).isInstanceOf(BizException.class);
        // ledger 必须带 scope,且必须是数字 companyId
        assertThatThrownBy(() -> ReviewKey.parse("ledger:2024-02")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse("ledger:abc:2024-02")).isInstanceOf(BizException.class);
        // s10 的期区只有 1..4
        assertThatThrownBy(() -> ReviewKey.parse("s10:5:2024-02")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse("s10:0:2024-02")).isInstanceOf(BizException.class);
        // utilities 只有两个固定 scope
        assertThatThrownBy(() -> ReviewKey.parse("utilities:dorm:2024-02")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse("utilities:2024-02")).isInstanceOf(BizException.class);
    }

    @Test
    void params_takesEitherParamPerm_othersTakeOne() {
        assertThat(ReviewKind.PARAMS.perms())
            .containsExactlyInAnyOrder(Perm.PARAM_POLICY_EDIT, Perm.PARAM_MONTHLY_EDIT);
        assertThat(ReviewKind.METERS.perms()).containsExactly(Perm.METER_READING_EDIT);
        assertThat(ReviewKind.ALLOC.perms()).containsExactly(Perm.BILLING_RUN_EDIT);
        assertThat(ReviewKind.LEDGER.perms()).containsExactly(Perm.ENTRY_EDIT);
    }

    @Test
    void everyKindHasPermsAndLabel_andOnlyElecModelIsOutOfMonthClose() {
        for (ReviewKind k : ReviewKind.values()) {
            assertThat(k.perms()).as(k.code() + " 缺 kind→perm 映射").isNotEmpty();
            assertThat(k.perms()).as(k.code() + " 映射到了不存在的权限点").allMatch(Perm::exists);
            assertThat(k.label()).as(k.code() + " 缺人话名").isNotBlank();
        }
        assertThat(Arrays.stream(ReviewKind.values())
                .filter(k -> !k.countsTowardMonthClose()).map(ReviewKind::code))
            .as("只有 elec-model 不进整月锁账(它没有清单行);多一个少一个都会让锁账口径与屏上不同源")
            .containsExactly("elec-model");
    }

    /** 键集合的规模钉住:14 个 kind,少一个就是有一张表能审但审了不锁。 */
    @Test
    void kindWhitelistIsExactlyTheSpecTable() {
        assertThat(Arrays.stream(ReviewKind.values()).map(ReviewKind::code).toList())
            .containsExactly(
                "params", "meters", "alloc", "alloc-loss", "bill-notices",
                "ledger", "s10", "salary", "utilities",
                "pv", "charging-car", "charging-ebike", "elec-cost", "elec-model");
    }

    /**
     * 整月锁账的键集合 = 出账 5 + 台账公司数 + 附10 期区数 + **其余 7 张**(spec §7.2)。
     *
     * ⚠ 「7 张」数的是**键**不是 kind:utilities 一个 kind 两个 scope(office / phase3)贡献 2 把键,
     * 所以剩下的 kind 只有 6 个。这个 6 与 7 的错位是 §7.2 那个数最容易被读错的地方,钉在这里。
     * elec-model 不在其中 —— 它 countsTowardMonthClose()==false,被上面的 filter 挡掉。
     */
    @Test
    void monthCloseKinds_leaveExactlySevenKeysBeyondChainAndScoped() {
        List<String> chain = List.of("params", "meters", "alloc", "alloc-loss", "bill-notices");
        List<String> scoped = List.of("ledger", "s10");
        List<ReviewKind> rest = Arrays.stream(ReviewKind.values())
            .filter(ReviewKind::countsTowardMonthClose)
            .filter(k -> !chain.contains(k.code()) && !scoped.contains(k.code()))
            .toList();

        assertThat(rest.stream().map(ReviewKind::code).toList())
            .containsExactly("salary", "utilities", "pv", "charging-car", "charging-ebike", "elec-cost");

        int keys = rest.stream()
            .mapToInt(k -> k.scopeShape() == ReviewKind.ScopeShape.FIXED ? ReviewKind.FIXED_SCOPES.size() : 1)
            .sum();
        assertThat(keys).as("spec §7.2 的「其余 7 张」数的是键").isEqualTo(7);
    }
}
