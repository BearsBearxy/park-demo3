package com.park.demo3.dto;
import java.time.LocalDateTime;
import java.util.List;
// 计费参数页状态条(spec §5.1/§6.3):本月电价 n/6;pendingChanges=自最早的快照(池/催缴单)以来的参数改动条数;
// stale=有影响本月的参数改动**或抄表改动**(data_change_log,METER-TIMELINE-SPEC §5)晚于池快照或催缴单批次(spec §6.3 判据);
// otherMonthsAffected=其它已生成月里同样过期的账期。
// lastChangeAt=两个来源里较晚的那次,lastChangeSource=它来自哪边(param 参数 / meter 抄表,无改动 null);
// staleSources=让本月过期的来源(param / meter,可两个都在,不过期为空)—— 给前端说「改过参数」还是「改过抄表」用。
// pendingChanges 仍只数参数改动(抄表改动一次写可能落一整段月份,条数没有意义)。
public record ParamStatusDTO(int priceOk, int priceTotal, int pendingChanges, LocalDateTime lastChangeAt,
    LocalDateTime poolSnapshotAt, LocalDateTime billBatchAt, boolean stale, List<String> otherMonthsAffected,
    String lastChangeSource, List<String> staleSources) {}
