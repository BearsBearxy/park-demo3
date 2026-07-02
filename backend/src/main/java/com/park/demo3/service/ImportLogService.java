package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.common.*;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class ImportLogService {
    private static final Set<String> KNOWN_TYPES = Set.of(
        "ledger","s10","pv","charging_7","charging_8","elec","salary","office_13","office_14","report_is","report_bs","report_tb",
        "pnl_s1","pnl_s2","pnl_s3","pnl_s4","pnl_s5");
    private final ImportLogMapper mapper; private final AuthUserMapper users;
    public ImportLogService(ImportLogMapper mapper, AuthUserMapper users) { this.mapper = mapper; this.users = users; }

    public ImportLogDTO record(ImportLogReq req) {
        if (!KNOWN_TYPES.contains(req.dataType())) throw new BizException(ResultCode.BAD_REQUEST, "未知数据类型");
        ImportLog l = new ImportLog();
        l.setDataType(req.dataType()); l.setTypeLabel(req.typeLabel()); l.setFileName(req.fileName());
        l.setTarget(req.target()); l.setRows(req.rows()); l.setOk(req.ok()); l.setWarn(req.warn());
        l.setStatus(req.status()); l.setOperator(resolveOperator());
        mapper.insert(l);           // createdAt 由 MetaObjectHandler 填, id 回填
        return toDTO(mapper.selectById(l.getId()));
    }

    public ImportLogOverviewDTO overview(int days, int historyLimit) {
        return new ImportLogOverviewDTO(
            mapper.latestByType().stream().map(this::toDTO).toList(),
            mapper.recent(days, historyLimit).stream().map(this::toDTO).toList());
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
            l.getRows(), l.getOk(), l.getWarn(), l.getStatus(), l.getOperator(), l.getCreatedAt());
    }
}
