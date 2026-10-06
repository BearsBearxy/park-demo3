package com.park.demo3.service;

import com.park.demo3.entity.ValueChangeLog;
import com.park.demo3.mapper.ValueChangeLogMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;

/**
 * 数据修改记录的写入口(用户 2026-10-05 拍板第 4 条)。钉住调用方依赖的三件事:
 * 没变的格不记(数值按显示比,1200.00 = 1200)、值存成屏上的样子、几百格一次保存按批写。
 * 破坏验证:去掉 record 里的「没变就跳过」→ 第一条红;show 不去尾零 → 第一、二条红;BATCH 不切 → 第三条红。
 */
class ChangeLogServiceTest {
    private final ValueChangeLogMapper mapper = mock(ValueChangeLogMapper.class);
    private final ChangeLogService svc = new ChangeLogService(mapper);

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
        org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();
    }

    /**
     * 借了别人的编辑权(提权)做的改动记上授权人(V139,2026-10-05 对抗复查 SEC-6):提权弹窗告诉用户
     * 「操作日志里会写明由谁授权」,账号与角色、计费参数两路一直这样记。没走提权的请求记 null。
     * 破坏验证:row() 里不设 authorizer → 红。
     */
    @Test
    void elevatedEditsRecordTheAuthorizer() {
        org.springframework.mock.web.MockHttpServletRequest req = new org.springframework.mock.web.MockHttpServletRequest();
        req.setAttribute(com.park.demo3.security.ElevationStore.REQ_ATTR_AUTHORIZER, "wang.mgr");
        org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(
            new org.springframework.web.context.request.ServletRequestAttributes(req));
        svc.record(ChangeLogService.Tbl.REPORT, "利润表 · 甲公司 · 2025-06 · 行次 1", "本月金额", BigDecimal.ONE, BigDecimal.TEN);
        org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();
        svc.record(ChangeLogService.Tbl.REPORT, "利润表 · 甲公司 · 2025-06 · 行次 2", "本月金额", BigDecimal.ONE, BigDecimal.TEN);
        assertThat(written()).extracting(ValueChangeLog::getAuthorizer).containsExactly("wang.mgr", null);
    }

    @SuppressWarnings("unchecked")
    private List<ValueChangeLog> written() {
        ArgumentCaptor<List<ValueChangeLog>> cap = ArgumentCaptor.forClass(List.class);
        verify(mapper, atLeast(0)).insertBatch(cap.capture());
        List<ValueChangeLog> all = new ArrayList<>();
        cap.getAllValues().forEach(all::addAll);
        return all;
    }

    @Test
    void unchangedCellsAreSkipped_andValuesAreStoredAsShown() {
        SecurityContextHolder.getContext().setAuthentication(new TestingAuthenticationToken("li.cw", null));
        svc.record(ChangeLogService.Tbl.SALARY, List.of(
            new ChangeLogService.Cell("2025-06 · 张三", "基本工资", new BigDecimal("4500.00"), new BigDecimal("4800")),
            new ChangeLogService.Cell("2025-06 · 张三", "岗位工资", new BigDecimal("300.00"), 300),   // 没变
            new ChangeLogService.Cell("2025-06 · 张三", "备注", null, "补发"),
            new ChangeLogService.Cell("2025-06 · 张三", "请假天数", 2, null)), "手改");
        List<ValueChangeLog> rows = written();
        assertThat(rows).extracting(ValueChangeLog::getField).containsExactly("基本工资", "备注", "请假天数");
        assertThat(rows).extracting(ValueChangeLog::getOldVal).containsExactly("4500", null, "2");
        assertThat(rows).extracting(ValueChangeLog::getNewVal).containsExactly("4800", "补发", null);
        assertThat(rows).allSatisfy(r -> {
            assertThat(r.getTbl()).isEqualTo("salary_record");
            assertThat(r.getActor()).isEqualTo("li.cw");
            assertThat(r.getRowRef()).isEqualTo("2025-06 · 张三");
            assertThat(r.getNote()).isEqualTo("手改");
        });
    }

    @Test
    void nothingChangedWritesNothing() {
        svc.record(ChangeLogService.Tbl.ANALYSIS_SETTING, "经营分析", "保本固定成本占比", 0.62, new BigDecimal("0.6200"));
        verify(mapper, never()).insertBatch(anyList());
    }

    @Test
    void aBigSaveIsWrittenInBatches_andLongTextIsCutToTheColumn() {
        List<ChangeLogService.Cell> cells = new ArrayList<>();
        for (int i = 0; i < 1201; i++) cells.add(new ChangeLogService.Cell("行" + i, "1月", i, i + 1));
        cells.add(new ChangeLogService.Cell("长", "备注", null, "字".repeat(300)));
        svc.record(ChangeLogService.Tbl.PNL, cells, null);
        verify(mapper, times(3)).insertBatch(anyList());   // 500 + 500 + 202
        List<ValueChangeLog> rows = written();
        assertThat(rows).hasSize(1202);
        assertThat(rows.get(1201).getNewVal()).hasSize(255).endsWith("…");
    }
}
