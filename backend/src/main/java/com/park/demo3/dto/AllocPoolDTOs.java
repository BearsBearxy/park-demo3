package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// V69 增补:池四级定位(buildingId/floorLabel/side/feeName + autoName 自动池名)、受益人 members、
// 候选/差集三端点契约(字段名与用户拍板的 API 契约一字不差)。

// 池核算表 API 契约(POOL-ENGINE-SPEC §4,字段名前后端共同遵守不得偏离)。
// rows=全部规则(config)左连当月快照;无快照月 generated=false 且数值列 null;sortNo 保 Excel 原行序。
public final class AllocPoolDTOs {
    private AllocPoolDTOs() {}

    // V69:label=「楼层·电表①」位置化标签(不再露内部标识名);spot/subName/meterType 供 hover 明细
    public record MeterBind(Integer meterId, String name, Integer sign,
                            String label, String spot, String subName, String meterType) {
        public MeterBind(Integer meterId, String name, Integer sign) { this(meterId, name, sign, null, null, null, null); }
    }
    public record Link(Integer ruleId, String name, String type) {}

    // V69 受益人:src=month(该月覆盖行)/default(默认长期行)
    // inForce 三态(2026-07-30 契约变更,前端同步):'yes' 在租 / 'no' 已退租 / 'unknown' 合同缺起止日期判不了
    public record PoolMember(Integer tenantId, String tenantName, String unitNo,
                             java.math.BigDecimal weight, String inForce, String src) {}

    // 候选(pool-candidates):meters 按定位过滤,tenants=该定位在租租户(preChecked=按合同预勾)
    public record MeterCand(Integer meterId, String label, String spot, String subName,
                            String meterType, String ownership, BigDecimal usage) {}
    public record TenantCand(Integer tenantId, String tenantName, String unitNo,
                             String inForce, Boolean preChecked) {}   // inForce 三态同 PoolMember
    public record Candidates(List<MeterCand> meters, List<TenantCand> tenants) {}

    // 受益人变动提醒(member-diff):该定位本月在租租户 与 池当前受益人 的差集
    public record MemberDiff(Integer ruleId, String poolName,
                             List<TenantCand> added, List<TenantCand> removed) {}

    public record PoolRow(
        Integer ruleId, String zone, String name, String groupLabel,
        String method, String stdKind, Integer roundScale, String baseKey, Integer sortNo, String note,
        Integer buildingId, String buildingName, String floorLabel, String side, String feeName, String autoName,
        // autoMembers=true:园区级池未显式勾受益人 → 引擎按「该期全园在租名册」自动摊,前端显示"自动=全园在租"而非逐户勾选
        boolean autoMembers, List<PoolMember> members,
        List<MeterBind> meters, List<Link> links,
        BigDecimal qtyTotal, BigDecimal qtySharp, BigDecimal qtyPeak, BigDecimal qtyFlat, BigDecimal qtyValley,
        BigDecimal extraQty, BigDecimal costAmount, BigDecimal baseSnap, BigDecimal stdValue,
        BigDecimal foldAdd, BigDecimal priceSnap,
        // ⚠语义(刀3 正名,V71 COMMENT 同步):allocatedAmount=引擎按受益人配置**正向试算**摊到户的合计
        // (前端列头「摊出」),不是账册 AE「已分摊」= 从电费总表按费目列拉回的**实收**;
        // gapAmount=摊出−应分摊(列头「差额」),不是账册 AF「盈/亏」= 实收−应分摊。
        // 实收/盈亏两列待 bill_notice 落地后从账单侧回填,现前端恒 '–'(POOL-ENGINE-SPEC §6.1)。
        BigDecimal allocatedAmount, BigDecimal gapAmount, String warn) {}

    public record Pools(boolean generated, List<PoolRow> rows) {}

    // 楼栋损耗表:units=快照;recon=读时派生(供电侧总表 vs 单元合计,loss_recon=0 的单元排除)
    public record LossUnit(
        Integer headBuildingId, String label, String zone,
        BigDecimal cQty, BigDecimal cableQty, BigDecimal dQty, BigDecimal eQty, BigDecimal rawRate,
        BigDecimal gQty, BigDecimal adjQty, BigDecimal adjRate,
        String variant, BigDecimal tenantRate, String note) {}

    public record LossRecon(
        String zone, BigDecimal supplyQty, BigDecimal sumC, BigDecimal sumD,
        BigDecimal lossVsC, BigDecimal rateVsC, BigDecimal lossVsD, BigDecimal rateVsD) {}

    public record Loss(boolean generated, List<LossUnit> units, List<LossRecon> recon) {}
}
