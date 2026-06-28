package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal; import java.time.LocalDate; import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;

class TenantServiceTest {
    TenantMapper tm = Mockito.mock(TenantMapper.class);
    ContractMapper cm = Mockito.mock(ContractMapper.class);
    BuildingMapper bm = Mockito.mock(BuildingMapper.class);
    TenantCategoryMapper catm = Mockito.mock(TenantCategoryMapper.class);
    BuildingService bs = Mockito.mock(BuildingService.class);
    com.park.demo3.mapper.UnitMapper um = Mockito.mock(com.park.demo3.mapper.UnitMapper.class);
    TenantService svc = new TenantService(tm, cm, bm, catm, bs, um);

    Tenant t(int id,int status){ Tenant x=new Tenant(); x.setId(id);x.setCompanyName("T"+id);
        x.setBusinessType("精密机械");x.setStatus(status);x.setPhase(1);return x; }
    Building b(int id,String name){ Building x=new Building(); x.setId(id);x.setName(name);return x; }
    Contract c(int tid,int bid,String st,double rent,double area){ Contract x=new Contract();
        x.setTenantId(tid);x.setBuildingId(bid);x.setStatus(st);
        x.setMonthlyRent(BigDecimal.valueOf(rent));x.setRentArea(BigDecimal.valueOf(area));return x; }
    Contract cWithUnit(int tid,int bid,Integer uid,String st,double rent,double area){
        Contract x=c(tid,bid,st,rent,area); x.setUnitId(uid);
        x.setContractNo("C-00"+tid); x.setStartDate(LocalDate.of(2023,1,1));
        x.setEndDate(LocalDate.of(2024,12,31)); return x; }
    Unit u(int id,int floor,String no){ Unit x=new Unit();x.setId(id);x.setFloor(floor);x.setUnitNo(no);return x; }

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

    @Test void detail_returnsAllContractsWithFloorInfo() {
        Tenant tenant = t(1, 1);
        Contract active = cWithUnit(1, 7, 3, "active", 8000, 260);
        Contract terminated = cWithUnit(1, 7, null, "terminated", 9999, 300);
        Mockito.when(tm.selectById(1)).thenReturn(tenant);
        Mockito.when(cm.selectList(any())).thenReturn(List.of(active, terminated));
        Mockito.when(bm.selectList(null)).thenReturn(List.of(b(7, "一期A栋")));
        Mockito.when(um.selectList(null)).thenReturn(List.of(u(3, 3, "301")));

        TenantDetailDTO d = svc.detail(1);
        assertThat(d.tenant().companyName()).isEqualTo("T1");
        assertThat(d.contracts()).hasSize(2);
        ContractHistoryDTO h = d.contracts().get(0);
        assertThat(h.buildingName()).isEqualTo("一期A栋");
        assertThat(h.floorInfo()).isEqualTo("3F-301");
        assertThat(h.status()).isEqualTo("active");
        // terminated contract has no unit → floorInfo blank
        assertThat(d.contracts().get(1).floorInfo()).isEmpty();
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
