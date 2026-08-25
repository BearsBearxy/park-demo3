package com.park.demo3.common;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ExtraFeesTest {
    static BigDecimal bd(String v) { return new BigDecimal(v); }

    @Test void parse_nullBlankBadJson_allYieldEmptyMap() {
        assertThat(ExtraFees.parse(null)).isEmpty();
        assertThat(ExtraFees.parse("  ")).isEmpty();
        assertThat(ExtraFees.parse("{oops")).isEmpty();
    }

    @Test void write_emptyMap_storesNull_roundTripKeepsValues() {
        assertThat(ExtraFees.write(null)).isNull();
        assertThat(ExtraFees.write(Map.of())).isNull();
        Map<String, BigDecimal> m = new LinkedHashMap<>();
        m.put("c_pv", bd("120.50"));
        m.put("c_ad", bd("0"));
        Map<String, BigDecimal> rt = ExtraFees.parse(ExtraFees.write(m));
        // write 统一 2 位小数(与物理列 r2 同口径),按值比较不比 scale
        assertThat(rt.get("c_pv")).isEqualByComparingTo("120.50");
        assertThat(rt.get("c_ad")).isEqualByComparingTo("0");
    }

    @Test void sum_ignoresNullValues_addsRest() {
        assertThat(ExtraFees.sum(null)).isEqualByComparingTo("0");
        assertThat(ExtraFees.sum("{\"c_a\":10.5,\"c_b\":null,\"c_c\":2}"))
            .isEqualByComparingTo("12.5");
    }

    // 导入语义(SPEC §4):键出现=覆盖(含显式 0);键缺席=不动
    @Test void mergeKeys_presentOverwritesIncludingZero_absentUntouched() {
        String existing = ExtraFees.write(Map.of("c_a", bd("100"), "c_b", bd("200")));
        String merged = ExtraFees.mergeKeys(existing, Map.of("c_a", bd("0"), "c_c", bd("7")));
        Map<String, BigDecimal> m = ExtraFees.parse(merged);
        assertThat(m.get("c_a")).isEqualByComparingTo("0");     // 显式 0 覆盖
        assertThat(m.get("c_b")).isEqualByComparingTo("200");   // 缺席不动
        assertThat(m.get("c_c")).isEqualByComparingTo("7");     // 新键落入
    }

    @Test void mergeKeys_emptyIncoming_returnsExistingUnchanged() {
        String existing = ExtraFees.write(Map.of("c_a", bd("1")));
        assertThat(ExtraFees.mergeKeys(existing, Map.of())).isEqualTo(existing);
        assertThat(ExtraFees.mergeKeys(existing, null)).isEqualTo(existing);
    }
}
