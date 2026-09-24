package com.park.demo3.dto;
import java.util.List;

// 刀H §H5 抄表批量删除(按账期)。预览与实删**共用同一形状**:
// 预览多一个字段、少一条清单,IT 就没法「拿两个 DTO 逐格比」,预览撒谎当场穿帮的这条线就断了。
//   readings/meters/metersEmptied/derived —— 规范里那四个数;
//   notices —— 该月催缴单张数(任意状态,S4-2 守卫);拆成下面末尾四项说话(2026-09-24);
//   manualKept   —— alloc_result source='manual' 保留行的点名(规范:manual 保留并在预览里点名);
//   meterDeleted —— 连带删掉的表档案(仅 dropEmptyMeters=true 时非空);
//   meterBlocked —— 删完零读数但被 alloc_rule_meter / 别的月的 bill_notice_line FK 挡住、跳过的表档案(不静默失败)。
// 注:derived 是**整月口径**(alloc_pool_result/alloc_pool_meter_result/alloc_loss_result/alloc_result gen 四表
// 该 ym 全量),不随 kind/zone 收窄 —— 派生快照本就是全园区一次算出来的,删掉一部分读数它整月都不再可信。
public record MeterDeleteDTO(
    String ym,
    int readings,
    int meters,
    int metersEmptied,
    int derived,
    int notices,
    List<String> manualKept,
    List<String> meterDeleted,
    List<String> meterBlocked,
    // METER-TIMELINE-SPEC §3.5:连带删掉的「本期导入写下的」归属行 / 状态行条数(from_ym = 本期 且 src = import)
    int assignRows,
    int statusRows,
    // METER-TIMELINE-SPEC §10.2:连带删掉的本月「册子里有这块表」记录条数(作用域同读数 kind/zone)
    int bookRows,
    // 该月催缴单分类(用户 2026-09-24:批删是死胡同):草稿 / 已作废 = 请求带 dropDraftNotices 时连带删(整月,不随 kind/zone);
    // 锁定 = 已确认 / 已导出 / 历史签发,>0 时执行 409;lockedTenants = 锁定单的户名(去重、全量,屏上只列前 5 户)
    int draftNotices,
    int voidNotices,
    int lockedNotices,
    List<String> lockedTenants
) {
    /**
     * GET /api/meters/{id}/delete-impact(删一块表前的确认框):readings = 读数条数、poolBindings = 所在公摊池名,
     * 两者非空都删不了;notices = 明细里有它的催缴单(按月、单号升序,lines = 它在这张单里占几行);
     * draftCount = 草稿 + 已作废(勾「同时删掉」随表一起删),lockedCount = 已确认 / 已导出 / 历史签发(要先作废)。
     */
    public record Impact(int readings, List<String> poolBindings, List<Notice> notices, int draftCount, int lockedCount) {}
    public record Notice(Integer noticeId, String ym, String tenantName, String status, long lines) {}
}
