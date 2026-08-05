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

    // S5 §2:rent 侧 (property_type, fee_key)→colId 全部映射值 ∈ RECON_FEES s10Key 集合
    @Test
    void rentMappingsPointToS10Cols() {
        String[][] cases = {
            {"factory", "rent_factory", "factoryRent"}, {"office", "rent_office", "officeRent"},
            {"dorm", "rent_dorm", "dormRent"}, {"shop", "rent_shop", "shopRent"},
            {"land", "rent_land", "landRent"},
            {"factory", "mgmt", "factoryMgmtFee"}, {"office", "mgmt", "officeMgmtFee"},
            {"shop", "mgmt", "shopMgmtFee"},
            {"factory", "infra", "infraFactory"}, {"office", "infra", "infraOffice"},
            {"shop", "infra", "infraShop"}, {"dorm", "infra", "infraDorm"},
            {"factory", "elevator", "elevatorMaint"}, {"factory", "transformer", "transformerMaint"},
            {"dorm", "access", "accessMaint"}, {"dorm", "network", "networkFee"},
            {"factory", "land_tax", "landUseTax"}, {"office", "other", "otherFee"}};
        for (String[] c : cases) {
            assertThat(BillFeeMap.rentPayCol(c[0], c[1])).as(c[0] + "/" + c[1]).isEqualTo(c[2]);
            assertThat(c[2]).isIn(S10_COLS);
        }
        // 段类型无关键不看 propertyType;dorm 无 mgmt;未知键 null
        assertThat(BillFeeMap.rentPayCol(null, "rent_factory")).isEqualTo("factoryRent");
        assertThat(BillFeeMap.rentPayCol("dorm", "mgmt")).isNull();
        assertThat(BillFeeMap.rentPayCol("factory", "elec")).isNull();
        assertThat(BillFeeMap.rentPayCol("factory", null)).isNull();
    }

    @Test
    void unknownKeyReturnsNull() {
        assertThat(BillFeeMap.payCol("rent")).isNull();
        assertThat(BillFeeMap.fallbackCol("rent")).isNull();
        assertThat(BillFeeMap.payCol(null)).isNull();
    }
}
