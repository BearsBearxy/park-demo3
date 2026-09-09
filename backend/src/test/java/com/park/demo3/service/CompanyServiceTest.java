package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.CompanyDTO;
import com.park.demo3.dto.CompanyReq;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.mapper.CompanyAccountMapper;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.ReportAccountMapper;
import com.park.demo3.mapper.ReportAmountMapper;
import com.park.demo3.mapper.ReportCustomRowMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CompanyServiceTest {
    ManagementCompanyMapper cm = Mockito.mock(ManagementCompanyMapper.class);
    CompanyAccountMapper am = Mockito.mock(CompanyAccountMapper.class);
    MonthlyLedgerMapper lm = Mockito.mock(MonthlyLedgerMapper.class);
    ReportAmountMapper ram = Mockito.mock(ReportAmountMapper.class);
    ReportCustomRowMapper rcm = Mockito.mock(ReportCustomRowMapper.class);
    ReportAccountMapper racm = Mockito.mock(ReportAccountMapper.class);
    BookService bm = Mockito.mock(BookService.class);
    // 删公司要读 bill_notice(该司当过收款主体的账期):默认 mock 返回空表/0 行,等于「没出过单」
    com.park.demo3.mapper.BillNoticeMapper nm = Mockito.mock(com.park.demo3.mapper.BillNoticeMapper.class);
    // 删公司要过审核闸(见 CompanyService.delete):本类是纯单元测试,mock 一个不拦的闸,
    // 闸本身的行为由 ReviewGuardIT 钉,挂点由 ReviewGuardMasterDataIT 钉
    com.park.demo3.security.ReviewGuard rg = Mockito.mock(com.park.demo3.security.ReviewGuard.class);
    CompanyService svc = new CompanyService(cm, am, lm, ram, rcm, racm, nm, bm, rg);

    ManagementCompany co(int id, String name) {
        ManagementCompany c = new ManagementCompany();
        c.setId(id); c.setName(name); c.setShortName(CompanyService.deriveShort(name)); c.setSortNo(0);
        c.setStatus(1);
        return c;
    }

    static CompanyReq req(String name) { return new CompanyReq(name, null, null, null); }

    @Test void deriveShort_stripsPrefixAndCompanyWordsAndTakesFirstTwo() {
        assertThat(CompanyService.deriveShort("园区租赁管理公司")).isEqualTo("租赁");
        assertThat(CompanyService.deriveShort("园区综合服务公司")).isEqualTo("综合");
        assertThat(CompanyService.deriveShort("园区水电管理公司")).isEqualTo("水电");
    }

    @Test void create_rejectsDuplicateName_409() {
        Mockito.when(cm.selectCount(ArgumentMatchers.any())).thenReturn(1L);
        assertThatThrownBy(() -> svc.create(req("园区租赁管理公司")))
            .isInstanceOf(BizException.class)
            .satisfies(e -> assertThat(((BizException) e).getCode()).isEqualTo(409));
    }

    @Test void create_derivesShortFromName() {
        Mockito.when(cm.selectCount(ArgumentMatchers.any())).thenReturn(0L);
        // capture inserted entity id back via selectById
        Mockito.doAnswer(inv -> { ((ManagementCompany) inv.getArgument(0)).setId(7); return 1; })
            .when(cm).insert(ArgumentMatchers.any(ManagementCompany.class));
        Mockito.when(cm.selectById(7)).thenReturn(co(7, "园区物业服务公司"));
        CompanyDTO d = svc.create(req("园区物业服务公司"));
        assertThat(d.id()).isEqualTo(7);
        assertThat(d.shortName()).isEqualTo("服务");
        assertThat(d.status()).isEqualTo(1);   // 新建默认启用
    }

    @Test void update_rejectsDuplicateName_409() {
        Mockito.when(cm.selectById(1)).thenReturn(co(1, "园区租赁管理公司"));
        Mockito.when(cm.selectCount(ArgumentMatchers.any())).thenReturn(1L);
        assertThatThrownBy(() -> svc.update(1, req("园区综合服务公司")))
            .isInstanceOf(BizException.class)
            .satisfies(e -> assertThat(((BizException) e).getCode()).isEqualTo(409));
    }

    @Test void update_missing_404() {
        Mockito.when(cm.selectById(99)).thenReturn(null);
        assertThatThrownBy(() -> svc.update(99, req("X")))
            .isInstanceOf(BizException.class)
            .satisfies(e -> assertThat(((BizException) e).getCode()).isEqualTo(404));
    }

    // 只带 name 的旧调用不得冲掉 fullName/status(null=保持不变)
    @Test void update_nullOptionalFields_keepExisting() {
        ManagementCompany c = co(1, "园区租赁管理公司");
        c.setFullName("佛山园区租赁管理有限公司"); c.setStatus(0);
        Mockito.when(cm.selectById(1)).thenReturn(c);
        Mockito.when(cm.selectCount(ArgumentMatchers.any())).thenReturn(0L);
        svc.update(1, req("园区租赁管理公司"));
        assertThat(c.getFullName()).isEqualTo("佛山园区租赁管理有限公司");
        assertThat(c.getStatus()).isZero();
    }

    @Test void delete_cascadesLedgerAndReportDataThenCompany() {
        Mockito.when(cm.selectById(1)).thenReturn(co(1, "园区租赁管理公司"));
        svc.delete(1);
        Mockito.verify(lm).delete(ArgumentMatchers.any());
        Mockito.verify(ram).delete(ArgumentMatchers.any());
        Mockito.verify(rcm).delete(ArgumentMatchers.any());
        Mockito.verify(racm).delete(ArgumentMatchers.any());
        Mockito.verify(cm).deleteById(1);
    }

    @Test void delete_missing_404() {
        Mockito.when(cm.selectById(99)).thenReturn(null);
        assertThatThrownBy(() -> svc.delete(99))
            .isInstanceOf(BizException.class)
            .satisfies(e -> assertThat(((BizException) e).getCode()).isEqualTo(404));
        Mockito.verify(cm, Mockito.never()).deleteById(ArgumentMatchers.anyInt());
    }
}
