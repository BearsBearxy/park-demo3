package com.park.demo3.service;
import com.park.demo3.entity.Tenant;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;

/** softIndex(V105):台账/附表10 导入与改名自动配档的解析规则。
 *  核心诉求(用户 2026-08-23):退租户也要能配——导入月当时可能还在租,老「只配在租」把整行跳掉。 */
class TenantSoftIndexTest {

    private static Tenant t(int id, String name, int status, String aliases) {
        Tenant x = new Tenant();
        x.setId(id); x.setCompanyName(name); x.setStatus(status); x.setAliases(aliases);
        return x;
    }

    @Test void retiredTenantStillResolves() {
        Map<String, Integer> idx = TenantService.softIndex(List.of(t(7, "黄路生", 2, null)));
        assertThat(idx.get("黄路生")).isEqualTo(7);   // 退租≠不存在
    }

    @Test void aliasResolvesSameAsName() {
        Map<String, Integer> idx = TenantService.softIndex(List.of(t(3, "鑫皇", 1, "李富全,鑫皇实业")));
        assertThat(idx.get("李富全")).isEqualTo(3);
        assertThat(idx.get("鑫皇实业")).isEqualTo(3);
    }

    @Test void duplicateName_activeWins_whenUniqueActive() {
        Map<String, Integer> idx = TenantService.softIndex(List.of(
            t(1, "曼克维", 2, null), t(2, "曼克维", 1, null)));
        assertThat(idx.get("曼克维")).isEqualTo(2);   // 在租唯一者胜
    }

    @Test void duplicateName_ambiguous_notResolved() {
        // 两个在租同名 → 不瞎猜;两个退租同名 → 同样不猜(留问题面板人工选)
        assertThat(TenantService.softIndex(List.of(
            t(1, "同名户", 1, null), t(2, "同名户", 1, null))).containsKey("同名户")).isFalse();
        assertThat(TenantService.softIndex(List.of(
            t(1, "同名户", 2, null), t(2, "同名户", 2, null))).containsKey("同名户")).isFalse();
    }

    @Test void soleRetiredResolves_whenNoActiveConflict() {
        Map<String, Integer> idx = TenantService.softIndex(List.of(
            t(1, "老租户", 2, null), t(2, "别家", 1, null)));
        assertThat(idx.get("老租户")).isEqualTo(1);
    }
}
