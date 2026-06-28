package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.CompanyDTO;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CompanyServiceTest {
    ManagementCompanyMapper cm = Mockito.mock(ManagementCompanyMapper.class);
    MonthlyLedgerMapper lm = Mockito.mock(MonthlyLedgerMapper.class);
    CompanyService svc = new CompanyService(cm, lm);

    ManagementCompany co(int id, String name) {
        ManagementCompany c = new ManagementCompany();
        c.setId(id); c.setName(name); c.setShortName(CompanyService.deriveShort(name)); c.setSortNo(0);
        return c;
    }

    @Test void deriveShort_stripsPrefixAndCompanyWordsAndTakesFirstTwo() {
        assertThat(CompanyService.deriveShort("园区租赁管理公司")).isEqualTo("租赁");
        assertThat(CompanyService.deriveShort("园区综合服务公司")).isEqualTo("综合");
        assertThat(CompanyService.deriveShort("园区水电管理公司")).isEqualTo("水电");
    }

    @Test void create_rejectsDuplicateName_409() {
        Mockito.when(cm.selectCount(ArgumentMatchers.any())).thenReturn(1L);
        assertThatThrownBy(() -> svc.create("园区租赁管理公司"))
            .isInstanceOf(BizException.class)
            .satisfies(e -> assertThat(((BizException) e).getCode()).isEqualTo(409));
    }

    @Test void create_derivesShortFromName() {
        Mockito.when(cm.selectCount(ArgumentMatchers.any())).thenReturn(0L);
        // capture inserted entity id back via selectById
        Mockito.doAnswer(inv -> { ((ManagementCompany) inv.getArgument(0)).setId(7); return 1; })
            .when(cm).insert(ArgumentMatchers.any(ManagementCompany.class));
        Mockito.when(cm.selectById(7)).thenReturn(co(7, "园区物业服务公司"));
        CompanyDTO d = svc.create("园区物业服务公司");
        assertThat(d.id()).isEqualTo(7);
        assertThat(d.shortName()).isEqualTo("服务");
    }

    @Test void rename_rejectsDuplicateName_409() {
        Mockito.when(cm.selectById(1)).thenReturn(co(1, "园区租赁管理公司"));
        Mockito.when(cm.selectCount(ArgumentMatchers.any())).thenReturn(1L);
        assertThatThrownBy(() -> svc.rename(1, "园区综合服务公司"))
            .isInstanceOf(BizException.class)
            .satisfies(e -> assertThat(((BizException) e).getCode()).isEqualTo(409));
    }

    @Test void rename_missing_404() {
        Mockito.when(cm.selectById(99)).thenReturn(null);
        assertThatThrownBy(() -> svc.rename(99, "X"))
            .isInstanceOf(BizException.class)
            .satisfies(e -> assertThat(((BizException) e).getCode()).isEqualTo(404));
    }

    @Test void delete_guard_409_whenLedgerRowsExist() {
        Mockito.when(cm.selectById(1)).thenReturn(co(1, "园区租赁管理公司"));
        Mockito.when(lm.selectCount(ArgumentMatchers.any())).thenReturn(5L);
        assertThatThrownBy(() -> svc.delete(1))
            .isInstanceOf(BizException.class)
            .satisfies(e -> assertThat(((BizException) e).getCode()).isEqualTo(409));
        Mockito.verify(cm, Mockito.never()).deleteById(ArgumentMatchers.anyInt());
    }

    @Test void delete_ok_whenNoLedgerRows() {
        Mockito.when(cm.selectById(1)).thenReturn(co(1, "园区租赁管理公司"));
        Mockito.when(lm.selectCount(ArgumentMatchers.any())).thenReturn(0L);
        svc.delete(1);
        Mockito.verify(cm).deleteById(1);
    }
}
