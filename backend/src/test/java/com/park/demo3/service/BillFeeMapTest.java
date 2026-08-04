package com.park.demo3.service;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/** 纯单测,不起容器。 */
class BillFeeMapTest {

    private static final Set<String> S10_COLS = ReconService.RECON_FEES.stream()
            .map(ReconService.Fee::s10Key).filter(Objects::nonNull)
            .collect(Collectors.toSet());

    private static final List<String> KEYS = List.of(
            "elec", "mgmt_fee", "capacity", "water", "water_pipe",
            "share_elec_floor", "share_elec_elevator", "share_elec_fire",
            "share_elec_light", "share_elec_loss", "share_green_water");

    @Test
    void allMappingsPointToS10Cols() {
        for (String k : KEYS) {
            assertThat(BillFeeMap.payCol(k)).as(k).isIn(S10_COLS);
            assertThat(BillFeeMap.fallbackCol(k)).as(k).isIn("elecStd", "waterStd");
        }
        // 抽查规格锚点
        assertThat(BillFeeMap.payCol("capacity")).isEqualTo("elecBasic");
        assertThat(BillFeeMap.payCol("share_elec_loss")).isEqualTo("elecStd");
        assertThat(BillFeeMap.fallbackCol("water_pipe")).isEqualTo("waterStd");
        assertThat(BillFeeMap.fallbackCol("mgmt_fee")).isEqualTo("elecStd");
    }

    @Test
    void unknownKeyReturnsNull() {
        assertThat(BillFeeMap.payCol("rent")).isNull();
        assertThat(BillFeeMap.fallbackCol("rent")).isNull();
        assertThat(BillFeeMap.payCol(null)).isNull();
    }
}
