package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.ImportLogDTO;
import com.park.demo3.dto.ImportLogReq;
import com.park.demo3.entity.ImportLog;
import com.park.demo3.mapper.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ImportLogServiceTest {
    private final ImportLogMapper mapper = mock(ImportLogMapper.class);
    private final AuthUserMapper users = mock(AuthUserMapper.class);
    private final ImportLogService svc = new ImportLogService(mapper, users);

    @Test void record_rejectsUnknownDataType() {
        ImportLogReq req = new ImportLogReq("bogus", "X", "f.xlsx", null, 1, 1, 0, "complete");
        assertThatThrownBy(() -> svc.record(req)).isInstanceOf(BizException.class);
        verify(mapper, never()).insert(any(ImportLog.class));   // insert(T) 与 insert(Collection) 重载,需消歧
    }

    @Test void record_insertsWithKnownTypeAndReturnsDto() {
        when(users.selectOne(any())).thenReturn(null); // operator 回退(SecurityContext 无认证→null)
        // 模拟 MP 自增回填 id(否则 selectById(null) 返 null → toDTO NPE,项目记过的坑)
        doAnswer(inv -> { ImportLog l = inv.getArgument(0); l.setId(1L); return 1; }).when(mapper).insert(any(ImportLog.class));
        when(mapper.selectById(1L)).thenAnswer(inv -> {
            ImportLog l = new ImportLog();
            l.setId(1L); l.setDataType("salary"); l.setTypeLabel("工资明细"); l.setFileName("工资.xlsx");
            l.setTarget("2026-05"); l.setRows(10); l.setOk(9); l.setWarn(1); l.setStatus("partial");
            return l;
        });
        ImportLogReq req = new ImportLogReq("salary", "工资明细", "工资.xlsx", "2026-05", 10, 9, 1, "partial");
        ImportLogDTO dto = svc.record(req);
        assertThat(dto.status()).isEqualTo("partial");
        assertThat(dto.ok()).isEqualTo(9);
        verify(mapper).insert(argThat((ImportLog l) -> "salary".equals(l.getDataType()) && l.getWarn() == 1));
    }
}
