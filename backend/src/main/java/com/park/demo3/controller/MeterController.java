package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.MeterService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

// 园区抄表(METER-SPEC)。GET=viewer 可读,写=admin(SecurityConfig 统一门)。
// 与办公室水电 /api/office 零共享:彼为园区自身成本,此为向租户收费的抄表原料。
@Tag(name = "园区抄表")
@RestController
@Validated
@RequestMapping("/api/meters")
public class MeterController {
    private final MeterService svc;
    public MeterController(MeterService svc) { this.svc = svc; }

    @Operation(summary = "表档案列表(可选 kind/zone 过滤;含读数条数;站在 ym 看,缺省=各表最新一行)") @GetMapping
    public List<MeterDTO> list(@RequestParam(required = false) @Pattern(regexp = "elec|water") String kind,
                               @RequestParam(required = false) @Pattern(regexp = "p\\d+|dorm") String zone,
                               @RequestParam(required = false) @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym) {
        return svc.list(kind, zone, ym);
    }

    @Operation(summary = "新增表(同区同类同名 409;自 fromYm 起在册,缺省 1900-01;这段月份有审核锁 423)") @PostMapping
    public MeterDTO create(@Valid @RequestBody MeterReq req) { return svc.create(req); }

    @Operation(summary = "编辑表的资产列(名称/编码/表类/表类型/倍率/存疑标,不分月;改倍率只影响之后新录读数)") @PutMapping("/{id}")
    public MeterDTO update(@PathVariable Integer id, @Valid @RequestBody MeterAssetReq req) {
        return svc.update(id, req);
    }

    // ── METER-TIMELINE-SPEC §3.3 §3.4:按月改归属与状态。受影响区间有冻结月 → 审核锁 423 / 其余 409 点名,一行不写 ──
    @Operation(summary = "按月改归属(correct=更正 ym 所在那一段 / from=自 ym 起变更;meterIds 同房间一起写;改到的组置人工标记;返回写了哪几行)")
    @PutMapping("/assign")
    public List<MeterTimelineDTO.Written> assign(@Valid @RequestBody MeterAssignReq req) { return svc.assignByMonth(req); }

    @Operation(summary = "改回按册子:清掉 ym 所在那一段的三组人工标记(位置三列回到按位置原文解析)")
    @PostMapping("/assign/clear-manual")
    public void clearManual(@Valid @RequestBody MeterClearManualReq req) { svc.clearManual(req); }

    @Operation(summary = "一块表的归属段 / 状态段 / 档案变更记录,以及站在 ym 改归属的两个选项(区间与冻结月)和同房间的表")
    @GetMapping("/{id}/timeline")
    public MeterTimelineDTO timeline(@PathVariable Integer id,
                                     @RequestParam @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym) {
        return svc.timelineOf(id, ym);
    }

    @Operation(summary = "写一行状态:自 fromYm 起 在用/停用/已拆;replaceFromYm = 把那一行挪到 fromYm(改月)")
    @PostMapping("/{id}/status")
    public void writeStatus(@PathVariable Integer id, @Valid @RequestBody MeterStatusReq req) { svc.writeStatusRow(id, req); }

    @Operation(summary = "删一行状态(撤回误标;第一行不能删 409)")
    @DeleteMapping("/{id}/status/{fromYm}")
    public void deleteStatus(@PathVariable Integer id,
                             @PathVariable @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String fromYm) {
        svc.dropStatusRow(id, fromYm);
    }

    @Operation(summary = "写这一行状态前的影响:区间、冻结月、区间里的非零用量月、所在公摊池、钉的合同")
    @GetMapping("/{id}/status-impact")
    public MeterTimelineDTO.StatusImpact statusImpact(@PathVariable Integer id,
            @RequestParam @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String fromYm,
            @RequestParam @Pattern(regexp = "active|retired|removed") String status) {
        return svc.statusImpact(id, fromYm, status);
    }

    @Operation(summary = "删表前看影响:读数条数、所在公摊池、明细里有它的催缴单(草稿/已作废可随表一起删,已确认/已导出要先作废)")
    @GetMapping("/{id}/delete-impact")
    public MeterDeleteDTO.Impact deleteImpact(@PathVariable Integer id) { return svc.deleteImpact(id); }

    @Operation(summary = "删除表(有读数、绑公摊池 409;明细里有它的催缴单:已确认/已导出 409,草稿/已作废带 dropDraftNotices "
        + "连单一起删、那几个月记需重算,不带 409;不存在 404)") @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id, @RequestParam(defaultValue = "false") boolean dropDraftNotices) {
        svc.delete(id, dropDraftNotices);
    }

    @Operation(summary = "有读数的账期('YYYY-MM' 升序;空表=[],默认月数据驱动)") @GetMapping("/months")
    public List<String> months() { return svc.months(); }

    @Operation(summary = "有读数的年份(升序;空表=[],年选择器数据驱动)") @GetMapping("/years")
    public List<Integer> years() { return svc.years(); }

    @Operation(summary = "某月全部读数(行含 factor_snap 与派生用量;漏抄/倒走徽标由前端派生)") @GetMapping("/readings")
    public List<MeterReadingDTO> readings(@RequestParam @Pattern(regexp = "\\d{4}-\\d{2}") String ym) {
        return svc.readingsByYm(ym);
    }

    @Operation(summary = "某表逐月历史(抽屉用)") @GetMapping("/{id}/readings")
    public List<MeterReadingDTO> meterReadings(@PathVariable Integer id) { return svc.readingsByMeter(id); }

    @Operation(summary = "新增读数(source=manual;factor_snap=当时表倍率;同表同月 409)") @PostMapping("/readings")
    public MeterReadingDTO createReading(@Valid @RequestBody MeterReadingReq req) { return svc.createReading(req); }

    @Operation(summary = "编辑读数(月份/读数/备注;factor_snap 保持原快照)") @PutMapping("/readings/{id}")
    public MeterReadingDTO updateReading(@PathVariable Integer id, @Valid @RequestBody MeterReadingReq req) {
        return svc.updateReading(id, req);
    }

    @Operation(summary = "删除读数(不存在 404)") @DeleteMapping("/readings/{id}")
    public void deleteReading(@PathVariable Integer id) { svc.deleteReading(id); }

    // ── 刀H §H5 按账期批量删除:先预览后执行,两条端点走同一个 batchDelete(apply 开关),数字必然一致。
    //   预览=GET(viewer 也能看,纯读);执行=DELETE → SecurityConfig 的「非 GET 仅 admin」自动 403,本处零鉴权代码。
    @Operation(summary = "批量删除预览(只算不删:将删N条读数/涉及M块表/其中K块删完零读数/该月派生快照X条)")
    @GetMapping("/readings/delete-preview")
    public MeterDeleteDTO deletePreview(
            @RequestParam @Pattern(regexp = "\\d{4}-\\d{2}") String ym,
            @RequestParam(required = false) @Pattern(regexp = "elec|water") String kind,
            @RequestParam(required = false) @Pattern(regexp = "p\\d+|dorm") String zone,
            @RequestParam(defaultValue = "true") boolean cascade,
            @RequestParam(defaultValue = "true") boolean dropEmptyMeters,
            @RequestParam(defaultValue = "false") boolean dropDraftNotices) {
        return svc.batchDelete(ym, kind, zone, cascade, dropEmptyMeters, dropDraftNotices, false);
    }

    @Operation(summary = "批量删除本期读数(不可逆;级联派生快照与空表档案默认开,可关;dropDraftNotices 连带删该月草稿/已作废催缴单,"
            + "该月有已确认/已导出的单 409;写 import_log 留痕)")
    @DeleteMapping("/readings")
    public MeterDeleteDTO deleteByYm(
            @RequestParam @Pattern(regexp = "\\d{4}-\\d{2}") String ym,
            @RequestParam(required = false) @Pattern(regexp = "elec|water") String kind,
            @RequestParam(required = false) @Pattern(regexp = "p\\d+|dorm") String zone,
            @RequestParam(defaultValue = "true") boolean cascade,
            @RequestParam(defaultValue = "true") boolean dropEmptyMeters,
            @RequestParam(defaultValue = "false") boolean dropDraftNotices) {
        return svc.batchDelete(ym, kind, zone, cascade, dropEmptyMeters, dropDraftNotices, true);
    }

    @Operation(summary = "批量导入(表按 kind+zone+name 建档/刷新,读数按 表+ym 幂等覆盖;行级错误跳过不整批拦;"
        + "档案只写导入月那一行,返回 batchId 与逐表逐字段的 changes)")
    @PostMapping("/import")
    public MeterImportResultDTO importRows(@Valid @RequestBody MeterImportRequest req) { return svc.importRows(req); }

    @Operation(summary = "撤销一次导入的档案改动(按变更记录逆序还原,读数不动;之后又改过或波及冻结月则整批拒并列出;返回还原条数)")
    @PostMapping("/import-batches/{batchId}/revert")
    public int revertImport(@PathVariable @Pattern(regexp = "[0-9a-f-]{36}") String batchId) {
        return svc.revertImport(batchId);
    }
}
