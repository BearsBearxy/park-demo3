package com.park.demo3.service;

import com.park.demo3.common.BizException;
import com.park.demo3.dto.ImportResultDTO;
import com.park.demo3.dto.PnlImportRequest;
import com.park.demo3.dto.PnlRowDTO;
import com.park.demo3.dto.PnlSaveRequest;
import com.park.demo3.entity.PnlRow;
import com.park.demo3.entity.ValueChangeLog;
import com.park.demo3.mapper.PnlRowMapper;
import com.park.demo3.mapper.ValueChangeLogMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

/**
 * 损益附表保存 / 导入(用户 2026-10-05 拍板「2按你建议，3，4一起做」第 3 条):
 * 只写真变了的格;变了的格落在「整月锁账」的月 → 整次拒并点名月份;手改的每一格进数据修改记录,导入不逐格记。
 * 破坏验证:去掉 apply 里 `if (sameRow(o, n)) continue;` → 「没改」那条红;match 换成按位置对 → 「删中间一行」那条红;
 *          refuseClosed 开头直接 return → 「锁账月」两条红;importRows 也传 log=true → 「导入」那条红;
 *          新行 key 不接着 top 往后编(从 r1 起)→ 「插中间」那条红。
 * 复查补的三条(2026-10-05 对抗复查 PROD-F2 / SEC-3 / SEC-4):match 换回按先后对(最长公共子序列)→ 「换了行序」红;
 *          diff 里不比类别 → 「改类别」红;apply 去掉 auto 那段 → 「自动补行只许加行」红。
 */
class PnlServiceTest {
    private final PnlRowMapper rows = mock(PnlRowMapper.class);
    private final ReviewService review = mock(ReviewService.class);
    private final ValueChangeLogMapper logs = mock(ValueChangeLogMapper.class);
    private final PnlService svc = new PnlService(rows, review, new ChangeLogService(logs));

    private static final String REF = "附表1 租金损益明细 · 2025 年 · 一期 · ";

    /** "3=50" → 3 月 50;没写的月是空(NULL = 未录)。 */
    private static BigDecimal[] mm(String... kv) {
        BigDecimal[] v = new BigDecimal[12];
        for (String s : kv) {
            String[] p = s.split("=");
            v[Integer.parseInt(p[0]) - 1] = new BigDecimal(p[1]);
        }
        return v;
    }

    /** 库里的行:金额两位小数(decimal(18,2))。 */
    private static PnlRow row(long id, String key, int sort, String label, String note, String... kv) {
        PnlRow r = new PnlRow();
        r.setId(id); r.setSchedule("s1"); r.setYear(2025); r.setRowKey(key); r.setGroupLabel("一期");
        r.setLabel(label); r.setKind("detail"); r.setNote(note); r.setSortOrder(sort);
        BigDecimal[] v = mm(kv);
        for (int i = 0; i < 12; i++) v[i] = v[i] == null ? null : v[i].setScale(2);
        r.setM1(v[0]); r.setM2(v[1]); r.setM3(v[2]); r.setM4(v[3]); r.setM5(v[4]); r.setM6(v[5]);
        r.setM7(v[6]); r.setM8(v[7]); r.setM9(v[8]); r.setM10(v[9]); r.setM11(v[10]); r.setM12(v[11]);
        return r;
    }

    /** 屏上送来的行:rowKey / sortOrder 是前端按行序重编的,服务端不认;金额不带尾零。 */
    private static PnlRowDTO dto(String label, String note, String... kv) {
        return new PnlRowDTO("zz", "一期", label, "detail", note, Arrays.asList(mm(kv)), 99);
    }

    private static PnlRowDTO dtoK(String label, String kind, String note, String... kv) {
        return new PnlRowDTO("zz", "一期", label, kind, note, Arrays.asList(mm(kv)), 99);
    }

    private static PnlSaveRequest body(PnlRowDTO... r) { return new PnlSaveRequest(List.of(r)); }

    private static final String MSG_ONE = "2025 年 3 月已锁账（本月出账里「本月锁账」打了勾），改不了。要改，先请审核员撤销那个月其中一张表的审核。";

    // 库里这一年三行:A(1 月 100)、B(3 月 50,有备注)、C(5 月 70)
    @BeforeEach
    void seed() {
        when(rows.year("s1", 2025)).thenReturn(List.of(
            row(1, "r1", 0, "A", null, "1=100"),
            row(2, "r2", 1, "B", "备注b", "3=50"),
            row(3, "r3", 2, "C", null, "5=70")));
        when(review.closedMonths()).thenReturn(List.of());
    }

    @SuppressWarnings("unchecked")
    private List<ValueChangeLog> logged() {
        ArgumentCaptor<List<ValueChangeLog>> cap = ArgumentCaptor.forClass(List.class);
        verify(logs, atLeast(0)).insertBatch(cap.capture());
        List<ValueChangeLog> all = new ArrayList<>();
        cap.getAllValues().forEach(all::addAll);
        return all;
    }

    private static String line(ValueChangeLog l) {
        return l.getRowRef() + " | " + l.getField() + " | " + l.getOldVal() + " → " + l.getNewVal() + " | " + l.getNote();
    }

    private void noWrites() {
        verify(rows, never()).insert(any(PnlRow.class));
        verify(rows, never()).update(any(), any());
        verify(rows, never()).deleteBatchIds(anyCollection());
    }

    @Test
    void unchangedYear_writesNothing_logsNothing() {
        svc.save("s1", 2025, body(dto("A", null, "1=100"), dto("B", "备注b", "3=50"), dto("C", null, "5=70")), false);

        noWrites();
        assertThat(logged()).isEmpty();
        verify(review, never()).closedMonths();   // 一格数都没动,不去算锁账
    }

    @Test
    void oneCell_oneUpdate_oneLogRow() {
        svc.save("s1", 2025, body(dto("A", null, "1=100"), dto("B", "备注b", "3=55"), dto("C", null, "5=70")), false);

        verify(rows, times(1)).update(isNull(), any());
        verify(rows, never()).insert(any(PnlRow.class));
        verify(rows, never()).deleteBatchIds(anyCollection());
        assertThat(logged()).extracting(PnlServiceTest::line)
            .containsExactly(REF + "B | 3月 | 50 → 55 | null");
    }

    // 删中间一行:后面的行只是挪了位置,一格没变 —— 不记、也不因它们落在锁账月而拒
    @Test
    void deleteMiddleRow_laterRowsNotTreatedAsChanged() {
        when(review.closedMonths()).thenReturn(List.of("2025-05"));   // C 的那个月锁了

        svc.save("s1", 2025, body(dto("A", null, "1=100"), dto("C", null, "5=70")), false);

        verify(rows).deleteBatchIds(List.of(2L));
        verify(rows, times(1)).update(isNull(), any());   // C 的行序 2 → 1,不是金额
        verify(rows, never()).insert(any(PnlRow.class));
        assertThat(logged()).extracting(PnlServiceTest::line).containsExactly(
            REF + "B | 3月 | 50 → null | null",
            REF + "B | 备注 | 备注b → null | null");
    }

    // 进年自动补行插在组中间:新行 key 接着留下的行往后编(uk_pnl),记录带注
    @Test
    void autoInsertInMiddle_newKeyAfterKept_loggedWithNote() {
        svc.save("s1", 2025, body(dto("A", null, "1=100"), dto("补的", null, "2=30"),
            dto("B", "备注b", "3=50"), dto("C", null, "5=70")), true);

        ArgumentCaptor<PnlRow> ins = ArgumentCaptor.forClass(PnlRow.class);
        verify(rows).insert(ins.capture());
        assertThat(ins.getValue().getRowKey()).isEqualTo("r4");
        assertThat(ins.getValue().getSortOrder()).isEqualTo(1);
        verify(rows, times(2)).update(isNull(), any());   // B、C 行序各挪一位
        assertThat(logged()).extracting(PnlServiceTest::line)
            .containsExactly(REF + "补的 | 2月 | null → 30 | 打开这一年时自动补的行");
    }

    @Test
    void closedMonth_refusesWholeSave_namingTheMonth() {
        when(review.closedMonths()).thenReturn(List.of("2025-03"));

        assertThatThrownBy(() -> svc.save("s1", 2025,
                body(dto("A", null, "1=101"), dto("B", "备注b", "3=55"), dto("C", null, "5=70")), false))
            .isInstanceOf(BizException.class)
            .hasMessage(MSG_ONE)
            .extracting("code").isEqualTo(423);
        // 删掉一行、而那行在锁账月有数 —— 也是改了那个月
        assertThatThrownBy(() -> svc.save("s1", 2025, body(dto("A", null, "1=100"), dto("C", null, "5=70")), false))
            .hasMessage(MSG_ONE);

        when(review.closedMonths()).thenReturn(List.of("2024-03", "2025-01", "2025-03"));
        assertThatThrownBy(() -> svc.save("s1", 2025,
                body(dto("A", null, "1=101"), dto("B", "备注b", "3=55"), dto("C", null, "5=70")), false))
            .hasMessage("2025 年 1 月、3 月已锁账（本月出账里「本月锁账」打了勾），改不了。要改，先请审核员撤销每个月其中一张表的审核。");
        noWrites();
        assertThat(logged()).isEmpty();

        // 锁的是别的月:照存
        svc.save("s1", 2025, body(dto("A", null, "1=100"), dto("B", "备注b", "3=50"), dto("C", null, "5=71")), false);
        verify(rows, times(1)).update(isNull(), any());
    }

    @Test
    void import_refusesClosedMonth_andIsNotLoggedPerCell() {
        when(review.closedMonths()).thenReturn(List.of("2025-03"));
        PnlImportRequest touchesMarch = new PnlImportRequest(List.of(
            dto("A", null, "1=100"), dto("B", "备注b", "3=55"), dto("C", null, "5=70")));
        assertThatThrownBy(() -> svc.importRows("s1", 2025, touchesMarch))
            .hasMessage(MSG_ONE);
        noWrites();

        ImportResultDTO r = svc.importRows("s1", 2025, new PnlImportRequest(List.of(
            dto("A", null, "1=101"), dto("B", "备注b", "3=50"), dto("C", null, "5=70"))));
        assertThat(r.imported()).isEqualTo(3);
        verify(rows, times(1)).update(isNull(), any());
        assertThat(logged()).isEmpty();   // 导入不逐格记:import_log 记了谁、何时、哪个文件
    }

    // 导入文件的行序和库里不同(屏上新增的行排在最后,表里排在组中):一格没变,不算改、锁账月不误拒
    @Test
    void reorderedRows_notTreatedAsChanged() {
        when(review.closedMonths()).thenReturn(List.of("2025-01"));   // A 的那个月锁了

        svc.importRows("s1", 2025, new PnlImportRequest(List.of(
            dto("B", "备注b", "3=50"), dto("A", null, "1=100"), dto("C", null, "5=70"))));

        verify(rows, never()).insert(any(PnlRow.class));
        verify(rows, never()).deleteBatchIds(anyCollection());
        verify(rows, times(2)).update(isNull(), any());   // A、B 只换了行序
        verify(review, never()).closedMonths();
    }

    // 类别决定这一行进不进经营分析的收入 / 成本 / 损益:改类别 = 动了这一行有数的月,锁账月照拒,并记一格
    @Test
    void kindChange_touchesTheRowsMonths_refusedInClosedMonth_andLogged() {
        when(review.closedMonths()).thenReturn(List.of("2025-03"));
        assertThatThrownBy(() -> svc.save("s1", 2025,
                body(dto("A", null, "1=100"), dtoK("B", "total", "备注b", "3=50"), dto("C", null, "5=70")), false))
            .hasMessage(MSG_ONE);
        noWrites();

        when(review.closedMonths()).thenReturn(List.of());
        svc.save("s1", 2025, body(dto("A", null, "1=100"), dtoK("B", "total", "备注b", "3=50"), dto("C", null, "5=70")), false);
        verify(rows, times(1)).update(isNull(), any());
        assertThat(logged()).extracting(PnlServiceTest::line)
            .containsExactly(REF + "B | 类别 | 明细 → 合计 | null");
    }

    // 进年自动补行送来的是几秒前读到的整年:已有的行一格不同(期间别人存过)、或少了一行 → 不写,免得把别人的数改回去
    @Test
    void autoSave_onlyAddsRows_refusesTouchingExistingOnes() {
        assertThatThrownBy(() -> svc.save("s1", 2025, body(dto("A", null, "1=100"), dto("B", "备注b", "3=55"),
                dto("C", null, "5=70"), dto("补的", null, "2=30")), true))
            .isInstanceOf(BizException.class).extracting("code").isEqualTo(409);
        assertThatThrownBy(() -> svc.save("s1", 2025, body(dto("A", null, "1=100"),
                dto("C", null, "5=70"), dto("补的", null, "2=30")), true))
            .extracting("code").isEqualTo(409);
        noWrites();
        assertThat(logged()).isEmpty();
    }
}
