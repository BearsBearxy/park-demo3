package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal; import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class TenantServiceTest {
    TenantMapper tm = Mockito.mock(TenantMapper.class);
    ContractMapper cm = Mockito.mock(ContractMapper.class);
    BuildingMapper bm = Mockito.mock(BuildingMapper.class);
    TenantCategoryMapper catm = Mockito.mock(TenantCategoryMapper.class);
    BuildingService bs = Mockito.mock(BuildingService.class);
    TenantService svc = new TenantService(tm, cm, bm, catm, bs);

    Tenant t(int id,int status){ Tenant x=new Tenant(); x.setId(id);x.setCompanyName("T"+id);
        x.setBusinessType("精密机械");x.setStatus(status);x.setPhase(1);return x; }
    Building b(int id,String name){ Building x=new Building(); x.setId(id);x.setName(name);return x; }
    Contract c(int tid,int bid,String st,double rent,double area){ Contract x=new Contract();
        x.setTenantId(tid);x.setBuildingId(bid);x.setStatus(st);
        x.setMonthlyRent(BigDecimal.valueOf(rent));x.setRentArea(BigDecimal.valueOf(area));return x; }

    @Test void derivesMonthlyAreaPrimaryContractCount() {
        Mockito.when(tm.selectList(null)).thenReturn(List.of(t(1,1)));
        Mockito.when(bm.selectList(null)).thenReturn(List.of(b(7,"一期 A 栋")));
        Mockito.when(cm.selectList(null)).thenReturn(List.of(
            c(1,7,"active",8000,260), c(1,7,"expiring",5000,200), c(1,7,"terminated",9999,300)));
        TenantDTO d = svc.list().get(0);
        assertThat(d.monthlyRent()).isEqualByComparingTo("13000"); // active+expiring, 不含 terminated
        assertThat(d.leasedArea()).isEqualByComparingTo("460");
        assertThat(d.primaryBuilding()).isEqualTo("一期 A 栋");
        assertThat(d.contractCount()).isEqualTo(3); // 全部历史
    }

    @Test void summaryCountsActiveAndExpiringTenants() {
        Mockito.when(tm.selectList(null)).thenReturn(List.of(t(1,1), t(2,1), t(3,2)));
        Mockito.when(cm.selectList(null)).thenReturn(List.of(
            c(1,7,"active",8000,260), c(2,7,"expiring",5000,200)));
        Mockito.when(bs.summary()).thenReturn(new BuildingSummaryDTO(0,0,BigDecimal.ZERO,42.0,0,0));
        TenantSummaryDTO s = svc.summary();
        assertThat(s.tenantActive()).isEqualTo(2);        // status==1
        assertThat(s.monthlyRent()).isEqualByComparingTo("13000");
        assertThat(s.expiringTenants()).isEqualTo(1);     // distinct tenant with expiring
        assertThat(s.occRate()).isEqualTo(42.0);
    }
}
