package com.park.demo3.dto;
import java.time.LocalDateTime;
import java.util.List;
// 计费参数页状态条(spec §5.1/§6.3):本月电价 n/6;pendingChanges=自最早的快照(池/催缴单)以来的参数改动条数;
// stale=有影响本月的参数改动晚于池快照或催缴单批次(spec §6.3 判据);otherMonthsAffected=其它已生成月里同样过期的账期。
public record ParamStatusDTO(int priceOk, int priceTotal, int pendingChanges, LocalDateTime lastChangeAt,
    LocalDateTime poolSnapshotAt, LocalDateTime billBatchAt, boolean stale, List<String> otherMonthsAffected) {}
