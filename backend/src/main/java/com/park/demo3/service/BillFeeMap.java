package com.park.demo3.service;

import java.util.Map;

/** 催缴单行 fee_key → 附表10 colId 静态映射(查 bill_pay_company 收款主体;S4-BILL-NOTICE-SPEC §4)。 */
public final class BillFeeMap {

    private BillFeeMap() {}

    // colId 合法集=ReconService.RECON_FEES 的 s10Key(单测校验),禁另抄
    private static final Map<String, String> PAY_COL = Map.ofEntries(
        Map.entry("elec",                "elecStd"),
        Map.entry("mgmt_fee",            "elecMaint"),
        Map.entry("capacity",            "elecBasic"),
        Map.entry("water",               "waterStd"),
        Map.entry("water_pipe",          "waterMaint"),
        Map.entry("share_elec_floor",    "elecStd"),
        Map.entry("share_elec_elevator", "elecStd"),
        Map.entry("share_elec_fire",     "elecStd"),
        Map.entry("share_elec_light",    "elecStd"),
        Map.entry("share_elec_loss",     "elecStd"),
        Map.entry("share_green_water",   "waterStd"));

    /** 未知键返回 null。 */
    public static String payCol(String feeKey) {
        return feeKey == null ? null : PAY_COL.get(feeKey); // Map.of 的 get(null) 抛 NPE
    }

    /** 同类兜底(§4 拆单规则1):电类→elecStd,水类→waterStd;未知键返回 null。 */
    public static String fallbackCol(String feeKey) {
        String col = payCol(feeKey);
        if (col == null) return null;
        return col.startsWith("water") ? "waterStd" : "elecStd";
    }
}
