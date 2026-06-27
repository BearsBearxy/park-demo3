package com.park.demo3.service;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import java.math.BigDecimal; import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class BuildingServiceTest {
    BuildingMapper bm = Mockito.mock(BuildingMapper.class);
    UnitMapper um = Mockito.mock(UnitMapper.class);
    ContractMapper cm = Mockito.mock(ContractMapper.class);
    BuildingService svc = new BuildingService(bm, um, cm);

    Building b(int id,int phase,int status,double rentable){ Building x=new Building();
        x.setId(id);x.setName("B"+id);x.setPhase(phase);x.setFloorCount(1);
        x.setTotalArea(BigDecimal.valueOf(rentable));x.setRentableArea(BigDecimal.valueOf(rentable));
        x.setStatus(status);x.setPerFloor(2);return x; }
    Unit u(int id,int bid,double area){ Unit x=new Unit(); x.setId(id);x.setBuildingId(bid);
        x.setFloor(1);x.setUnitNo(""+id);x.setArea(BigDecimal.valueOf(area));return x; }
    Contract c(int bid,int uid,int tid,String st,double rent){ Contract x=new Contract();
        x.setBuildingId(bid);x.setUnitId(uid);x.setTenantId(tid);x.setStatus(st);
        x.setMonthlyRent(BigDecimal.valueOf(rent));x.setRentArea(BigDecimal.ZERO);return x; }

    @Test void occRateAreaBased_includesReserved_capsAndZerosStopped() {
        // 楼栋1: rentable 1000, 单元: occupied(300)+expiring(200)+reserved(100)+vacant(400) → leased=600 → 60.0%
        Mockito.when(bm.selectList(null)).thenReturn(List.of(b(1,1,1,1000), b(2,1,0,1000)));
        Mockito.when(um.selectList(null)).thenReturn(List.of(
            u(11,1,300), u(12,1,200), u(13,1,100), u(14,1,400), u(21,2,500)));
        Mockito.when(cm.selectList(null)).thenReturn(List.of(
            c(1,11,1,"active",8000), c(1,12,2,"expiring",5000), c(1,13,3,"draft",0),
            c(2,21,4,"active",4000))); // 楼栋2 停用 → occRate 0
        List<BuildingDTO> r = svc.list();
        BuildingDTO d1 = r.stream().filter(x->x.id()==1).findFirst().orElseThrow();
        assertThat(d1.leasedArea()).isEqualByComparingTo("600");
        assertThat(d1.occRate()).isEqualTo(60.0);
        assertThat(d1.occupiedCount()).isEqualTo(2);   // occupied + expiring
        assertThat(d1.vacantCount()).isEqualTo(1);
        assertThat(d1.reservedCount()).isEqualTo(1);
        assertThat(d1.monthlyRent()).isEqualByComparingTo("13000"); // active+expiring
        assertThat(d1.tenantIds()).containsExactlyInAnyOrder(1,2);
        BuildingDTO d2 = r.stream().filter(x->x.id()==2).findFirst().orElseThrow();
        assertThat(d2.occRate()).isEqualTo(0.0); // 停用
    }

    @Test void summaryRollsUp() {
        Mockito.when(bm.selectList(null)).thenReturn(List.of(b(1,1,1,1000)));
        Mockito.when(um.selectList(null)).thenReturn(List.of(u(11,1,500), u(12,1,500)));
        Mockito.when(cm.selectList(null)).thenReturn(List.of(c(1,11,1,"active",8000)));
        BuildingSummaryDTO s = svc.summary();
        assertThat(s.buildingCount()).isEqualTo(1);
        assertThat(s.occRate()).isEqualTo(50.0);
        assertThat(s.vacantCount()).isEqualTo(1);
        assertThat(s.stoppedCount()).isEqualTo(0);
        assertThat(s.rentableArea()).isEqualByComparingTo("1000");
    }
}
