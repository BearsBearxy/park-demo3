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

    // V73 逐表明细行(原册一表一行:A座天面四部梯各占一行)。快照读出,不现算。
    // costAmount:仅 p1/dorm「逐表 ROUND 再求和」口径有值;p2 池级一次 ROUND、净额池/手输量池 → null,
    // 前端该列改由池行 rowspan 显池级合计,不把池金额按比例摊回逐表冒充逐表数。
    // 刀I §I3:floorLabel/useName 是**逐行身份**两列的来源 —— 原册 B/C/D 三列永远逐行写、从不纵向合并,
    // 屏上「楼层」「池名称」两列必须取本行电表的值,不能取池级(一个池跨多个原册行时会错)。
    // useName = 原册 D 列「企业名称」(名不副实,实为用电部位/归属:走廊灯/西侧租户、东侧货梯、消防控制箱),
    // 与 meterLabel 里的用途段同一把口径(tenant_name 空则回退 name),故共用 meterUse()。
    public record MeterLine(Integer meterId, String label, String area, String spot,
                            String floorLabel, String useName, String subName,
                            String meterType, String code, Integer sign, BigDecimal factorSnap,
                            BigDecimal prevTotal, BigDecimal currTotal,
                            BigDecimal qtyTotal, BigDecimal qtySharp, BigDecimal qtyPeak,
                            BigDecimal qtyFlat, BigDecimal qtyValley, BigDecimal costAmount) {}

    // 刀I §I2 净额构成项(hover 明细,不占逐表行)。
    // 依据:净额池的绑定表在原册「公共电分摊明细」上**根本没有行** —— 招商中心那 7 块表是
    // 「一期园区电」S44:S50 的中间量,原册只留 r8 一行、用量写净额 152.06(=X50−670)。
    // qty=带 sign 的**有符号**净量(相加即得池净量,hover 那条链必须自洽);
    // meterId=null 的一项是原册硬编码扣度(招商中心 N8 公式原文 `=-670`),不是电表。
    // 前端「电表」列尾 −N 角标取 meterId!=null && sign<0 的条数(扣度不计入表数)。
    public record NetPart(Integer meterId, String label, Integer sign, BigDecimal qty) {}

    // V69 受益人:src=month(版本组行,自该月起前滚 S14)/default(默认长期行=初始版)
    // inForce 三态(2026-07-30 契约变更,前端同步):'yes' 在租 / 'no' 已退租 / 'unknown' 合同缺起止日期判不了
    // 刀D:floorLabel=该户在本池楼栋解析出的楼层(§D.1 两级回退,读时现算不落库),跨多层用「、」连,定不出=null
    public record PoolMember(Integer tenantId, String tenantName, String unitNo,
                             java.math.BigDecimal weight, String inForce, String src, String floorLabel) {}

    // 候选(pool-candidates):meters 按定位过滤,tenants=该定位在租租户(preChecked=按合同预勾)
    // tenantNote:tenants 为空时的原因说明(刀D §D.4 direct 池户对户,「该定位在租租户」对它无意义);其余情况 null
    public record MeterCand(Integer meterId, String label, String spot, String subName,
                            String meterType, String ownership, BigDecimal usage) {}
    public record TenantCand(Integer tenantId, String tenantName, String unitNo,
                             String inForce, Boolean preChecked) {}   // inForce 三态同 PoolMember
    public record Candidates(List<MeterCand> meters, List<TenantCand> tenants, String tenantNote) {}

    // 受益人变动提醒(member-diff):该定位本月在租租户 与 池当前受益人 的差集
    public record MemberDiff(Integer ruleId, String poolName,
                             List<TenantCand> added, List<TenantCand> removed) {}

    public record PoolRow(
        Integer ruleId, String zone, String name,
        // V80 原册锚点:bookBlock=分带用的原册块名(逐字原文),bookKey=原册 A 列自然键(屏上池名称列优先显它)。
        // 二期/宿舍无原册块 → 两者 null,前端按 buildingName 分带的老路走。
        String bookBlock, String bookKey, String groupLabel,
        String method, String stdKind, Integer roundScale, String baseKey, Integer sortNo, String note,
        Integer buildingId, String buildingName, String floorLabel, String side, String feeName, String autoName,
        // autoMembers=true:园区级池未显式勾受益人 → 引擎按「该期全园在租名册」自动摊,前端显示"自动=全园在租"而非逐户勾选
        boolean autoMembers, List<PoolMember> members,
        List<MeterBind> meters, List<Link> links,
        // V73:当月逐表明细快照(未生成月为空表);屏上一表一行,池级列 rowspan 合并
        List<MeterLine> lines,
        // 刀I §I2:净额池的构成明细,只进主行 hover;非净额池恒为空表
        List<NetPart> netParts,
        BigDecimal qtyTotal, BigDecimal qtySharp, BigDecimal qtyPeak, BigDecimal qtyFlat, BigDecimal qtyValley,
        BigDecimal extraQty, BigDecimal costAmount, BigDecimal baseSnap, BigDecimal stdValue,
        BigDecimal foldAdd, BigDecimal priceSnap,
        // ⚠语义(刀3 正名,V71 COMMENT 同步):allocatedAmount=引擎按受益人配置**正向试算**摊到户的合计
        // (前端列头「摊出」),不是账册 AE「已分摊」= 从电费总表按费目列拉回的**实收**;
        // gapAmount=摊出−应分摊(列头「差额」),不是账册 AF「盈/亏」= 实收−应分摊。
        // 实收/盈亏两列待 bill_notice 落地后从账单侧回填,现前端恒 '–'(POOL-ENGINE-SPEC §6.1)。
        BigDecimal allocatedAmount, BigDecimal gapAmount, String warn,
        // 刀D §D.6:floor 池的分桶明细串「按 3 层拆:二楼 1 户 / 三楼 1 户 / 未定层 2 户」,供前端做「摊出」列 title
        // ——让「为什么摊出少于应分摊」在屏上看得见。读时按当前主数据现算(楼层不落库),非 floor 池为 null。
        String allocNote) {}

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
