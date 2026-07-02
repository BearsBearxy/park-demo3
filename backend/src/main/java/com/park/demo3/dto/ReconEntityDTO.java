package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
// 单实体(租户)整月对照:两侧总额 + 逐科目 FeeLine + 台账按公司分卡 / s10 按期分卡(E2/E4)
public record ReconEntityDTO(
    Integer tenantId,               // 匹配上的真实租户(未匹配 s10 实体为 null)
    String  tenantName,             // 实体键(E1)
    String  status,                 // ok | diff | miss(E3)
    BigDecimal ledgerTotal,
    BigDecimal s10Total,
    BigDecimal diff,                // ledgerTotal − s10Total
    boolean marked,                 // 已核实(recon_mark)
    String  markNote,
    List<FeeLine> fees,
    List<LedgerCard> ledgerCards,
    List<S10Card> s10Cards
) {
    // 逐科目对照行:两侧全零科目不出行;onlySide=科目仅一侧存在(E2,不计入 diff 判定)
    public record FeeLine(String key, String label, BigDecimal ledgerAmt, BigDecimal s10Amt,
                          BigDecimal delta, String onlySide) {}     // onlySide: null | 'ledger' | 's10'
    public record LedgerCard(String companyName, BigDecimal total, Map<String, BigDecimal> fees) {}
    public record S10Card(int phase, BigDecimal total, Map<String, BigDecimal> fees) {}
}
