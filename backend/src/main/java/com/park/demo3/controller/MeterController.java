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

    @Operation(summary = "表档案列表(可选 kind/zone 过滤;含读数条数)") @GetMapping
    public List<MeterDTO> list(@RequestParam(required = false) @Pattern(regexp = "elec|water") String kind,
                               @RequestParam(required = false) @Pattern(regexp = "p1|p2|dorm") String zone) {
        return svc.list(kind, zone);
    }

    @Operation(summary = "新增表(同区同类同名 409)") @PostMapping
    public MeterDTO create(@Valid @RequestBody MeterReq req) { return svc.create(req); }

    @Operation(summary = "编辑表(改倍率只影响之后新录读数,历史快照不回溯)") @PutMapping("/{id}")
    public MeterDTO update(@PathVariable Integer id, @Valid @RequestBody MeterReq req) {
        return svc.update(id, req);
    }

    @Operation(summary = "删除表(有读数 409;不存在 404)") @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id) { svc.delete(id); }

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
            @RequestParam(required = false) @Pattern(regexp = "p1|p2|dorm") String zone,
            @RequestParam(defaultValue = "true") boolean cascade,
            @RequestParam(defaultValue = "true") boolean dropEmptyMeters) {
        return svc.batchDelete(ym, kind, zone, cascade, dropEmptyMeters, false);
    }

    @Operation(summary = "批量删除本期读数(不可逆;级联派生快照与空表档案默认开,可关;写 import_log 留痕)")
    @DeleteMapping("/readings")
    public MeterDeleteDTO deleteByYm(
            @RequestParam @Pattern(regexp = "\\d{4}-\\d{2}") String ym,
            @RequestParam(required = false) @Pattern(regexp = "elec|water") String kind,
            @RequestParam(required = false) @Pattern(regexp = "p1|p2|dorm") String zone,
            @RequestParam(defaultValue = "true") boolean cascade,
            @RequestParam(defaultValue = "true") boolean dropEmptyMeters) {
        return svc.batchDelete(ym, kind, zone, cascade, dropEmptyMeters, true);
    }

    @Operation(summary = "批量导入(表按 kind+zone+name 建档/刷新,读数按 表+ym 幂等覆盖;行级错误跳过不整批拦)")
    @PostMapping("/import")
    public MeterImportResultDTO importRows(@Valid @RequestBody MeterImportRequest req) { return svc.importRows(req); }
}
