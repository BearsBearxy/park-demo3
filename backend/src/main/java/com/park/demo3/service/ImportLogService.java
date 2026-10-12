package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.security.NoReviewGuard;
import com.park.demo3.common.*;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.util.*;

@Service
public class ImportLogService {
    // 不再维护类型白名单:与前端 registry 双份清单必然烂(budget 类型上线即因不在名单被 400,
    // 且前端日志失败静默 → 磁贴永远「未导入」——2026-07-09 事故)。dataType 是审计元数据,
    // @NotBlank + 鉴权 已够;新增导入类型零后端改动。
    private final ImportLogMapper mapper; private final AuthUserMapper users;
    public ImportLogService(ImportLogMapper mapper, AuthUserMapper users) { this.mapper = mapper; this.users = users; }

        @NoReviewGuard(reason = "只写审计流水,不碰期间数据(ImportLog 实体只有 createdAt,连月都没有)。同 ParamService.logRuleChange 的豁免理由")
public ImportLogDTO record(ImportLogReq req) {
        ImportLog l = new ImportLog();
        l.setDataType(req.dataType()); l.setTypeLabel(req.typeLabel()); l.setFileName(req.fileName());
        l.setTarget(req.target()); l.setRows(req.rows()); l.setOk(req.ok()); l.setWarn(req.warn());
        l.setStatus(req.status()); l.setOperator(resolveOperator());
        l.setPeriodFrom(req.periodFrom()); l.setPeriodTo(req.periodTo());
        l.setCompanyId(req.companyId()); l.setZone(req.zone());
        l.setNote(req.note() == null || req.note().length() <= 200 ? req.note() : req.note().substring(0, 200));
        mapper.insert(l);           // createdAt 由 MetaObjectHandler 填, id 回填
        return toDTO(mapper.selectById(l.getId()));
    }

    public ImportLogOverviewDTO overview(int days, int historyLimit) {
        return new ImportLogOverviewDTO(
            mapper.latestByType().stream().map(this::toDTO).toList(),
            mapper.recent(days, historyLimit).stream().map(this::toDTO).toList());
    }

    /**
     * 导入记录分页(改稿 T3):固定近 30 天、不含抄表批量删除(那是删除留痕,不是导入)。
     * status 空 = 全部;dataTypes 空 = 全部去处(同一屏的两类一起筛,如 elec + elecCost)。
     * counts 是三个页签上的数:跟去处筛选走,不跟页签走。
     */
    public ImportCenterDtos.Page page(int page, int size, String status, List<String> dataTypes) {
        LocalDateTime since = LocalDateTime.now().minusDays(30);
        List<String> types = dataTypes == null ? List.of() : dataTypes.stream().filter(t -> !t.isBlank()).toList();
        java.util.function.Supplier<QueryWrapper<ImportLog>> base = () -> {
            QueryWrapper<ImportLog> q = new QueryWrapper<ImportLog>().ge("created_at", since).ne("data_type", "meter_delete");
            if (!types.isEmpty()) q.in("data_type", types);
            return q;
        };
        Map<String, Long> byStatus = new HashMap<>();
        for (Map<String, Object> m : mapper.selectMaps(base.get().select("status", "COUNT(*) AS n").groupBy("status")))
            byStatus.put((String) m.get("status"), ((Number) m.get("n")).longValue());
        long all = byStatus.values().stream().mapToLong(Long::longValue).sum();
        int p = Math.max(1, page), sz = Math.min(200, Math.max(1, size));
        QueryWrapper<ImportLog> q = base.get();
        if (status != null) q.eq("status", status);
        List<ImportLogDTO> rows = mapper.selectList(q.orderByDesc("created_at", "id")
                .last("LIMIT " + sz + " OFFSET " + (long) (p - 1) * sz))
            .stream().map(this::toDTO).toList();
        return new ImportCenterDtos.Page(rows, status == null ? all : byStatus.getOrDefault(status, 0L), p, sz,
            new ImportCenterDtos.Counts(all, byStatus.getOrDefault("partial", 0L), byStatus.getOrDefault("rejected", 0L)));
    }

    private String resolveOperator() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        String username = auth == null ? null : String.valueOf(auth.getName());
        if (username == null) return null;
        AuthUser u = users.selectOne(new QueryWrapper<AuthUser>().eq("username", username));
        return u != null && u.getDisplayName() != null ? u.getDisplayName() : username;
    }

    private ImportLogDTO toDTO(ImportLog l) {
        return new ImportLogDTO(l.getId(), l.getDataType(), l.getTypeLabel(), l.getFileName(), l.getTarget(),
            l.getRows(), l.getOk(), l.getWarn(), l.getStatus(), l.getOperator(), l.getCreatedAt(),
            l.getPeriodFrom(), l.getPeriodTo(), l.getCompanyId(), l.getZone(), l.getNote());
    }
}
