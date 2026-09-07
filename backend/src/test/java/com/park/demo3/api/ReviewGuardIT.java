package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.common.BizException;
import com.park.demo3.entity.ReviewState;
import com.park.demo3.mapper.ReviewStateMapper;
import com.park.demo3.security.ReviewGuard;
import com.park.demo3.security.ReviewKind;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * ReviewGuard 三个闸的行为(spec §7.4)。直接注入 guard 与 mapper,不走 HTTP ——
 * 端到端那一层留给 ReviewApiIT,这里只钉守卫本身。
 *
 * 类上 @Transactional:本用例只 INSERT review_state,没有 DDL,回滚干净,不会污染复用容器。
 */
@Transactional
class ReviewGuardIT extends AbstractMysqlIT {

    @Autowired ReviewGuard guard;
    @Autowired ReviewStateMapper states;

    private void seed(String key, String kind, String period, String scope, String status) {
        ReviewState s = new ReviewState();
        s.setReviewKey(key); s.setKind(kind); s.setPeriod(period); s.setScope(scope); s.setStatus(status);
        states.insert(s);
    }

    @Test
    void enteredMonth_passes_submittedAndApproved_throw423() {
        // 库里没行 = 派生态「录入中」= 放行
        assertThatCode(() -> guard.assertEditable(ReviewKind.SALARY, "2024-02", null))
            .doesNotThrowAnyException();

        seed("salary:2024-02", "salary", "2024-02", null, "submitted");
        assertThatThrownBy(() -> guard.assertEditable(ReviewKind.SALARY, "2024-02", null))
            .isInstanceOf(BizException.class)
            .hasFieldOrPropertyWithValue("code", 423)
            .hasMessageContaining("2024-02").hasMessageContaining("附表12").hasMessageContaining("待审核");
    }

    @Test
    void approved_says_soInTheMessage() {
        seed("pv:2024-04", "pv", "2024-04", null, "approved");
        assertThatThrownBy(() -> guard.assertEditable(ReviewKind.PV, "2024-04", null))
            .isInstanceOf(BizException.class)
            .hasFieldOrPropertyWithValue("code", 423)
            .hasMessageContaining("已审核").hasMessageContaining("撤销审核后才能修改");
    }

    @Test
    void returned_isEditableAgain() {
        // returned 只是留痕,可编辑性等同录入中(§7.2)
        seed("salary:2024-03", "salary", "2024-03", null, "returned");
        assertThatCode(() -> guard.assertEditable(ReviewKind.SALARY, "2024-03", null))
            .doesNotThrowAnyException();
    }

    @Test
    void scopeIsPartOfTheKey_otherCompanyUnaffected() {
        seed("ledger:7:2024-02", "ledger", "2024-02", "7", "approved");
        assertThatThrownBy(() -> guard.assertEditable(ReviewKind.LEDGER, "2024-02", "7"))
            .isInstanceOf(BizException.class);
        // 反向用例:另一家公司同月不受影响。漏了它,scope 这一维形同虚设也没人发现
        assertThatCode(() -> guard.assertEditable(ReviewKind.LEDGER, "2024-02", "8"))
            .doesNotThrowAnyException();
    }

    @Test
    void batch_namesTheEarliestLockedMonth() {
        seed("pv:2024-05", "pv", "2024-05", null, "approved");
        seed("pv:2024-09", "pv", "2024-09", null, "approved");
        assertThatThrownBy(() -> guard.assertEditable(ReviewKind.PV,
                List.of("2024-09", "2024-03", "2024-05"), null))
            .as("批量文案要点名最早的锁月,不是集合里碰巧第一个")
            .isInstanceOf(BizException.class)
            .hasMessageContaining("2024-05")
            .hasMessageNotContaining("2024-09");
    }

    @Test
    void batch_passesWhenNoMonthIsLocked() {
        assertThatCode(() -> guard.assertEditable(ReviewKind.PV,
                List.of("2024-01", "2024-02", "2024-03"), null)).doesNotThrowAnyException();
    }

    @Test
    void crossMonth_anyLockedMonthBlocks_andNamesTheEarliest() {
        seed("params:2024-06", "params", "2024-06", null, "approved");
        seed("params:2024-01", "params", "2024-01", null, "submitted");
        assertThatThrownBy(() -> guard.assertNoLockedMonth(ReviewKind.PARAMS, null))
            .isInstanceOf(BizException.class)
            .hasMessageContaining("2024-01")     // byKindAndScope 按 period 升序,取第一个
            .hasMessageNotContaining("2024-06");
    }

    @Test
    void crossMonth_scopedKindsAreIsolated() {
        seed("ledger:9:2024-01", "ledger", "2024-01", "9", "approved");
        assertThatThrownBy(() -> guard.assertNoLockedMonth(ReviewKind.LEDGER, "9"))
            .isInstanceOf(BizException.class).hasMessageContaining("2024-01");
        assertThatCode(() -> guard.assertNoLockedMonth(ReviewKind.LEDGER, "10"))
            .doesNotThrowAnyException();
    }

    @Test
    void badPeriod_isRejectedByTheGuardItself() {
        // 前面 8 个 service 一个 requireYm 都没有,MeterService 那份正则还放行 2024-13。
        // 守卫是最后一道闸,不能信调用方洗过。
        assertThatThrownBy(() -> guard.assertEditable(ReviewKind.SALARY, "2024-13", null))
            .isInstanceOf(BizException.class).hasFieldOrPropertyWithValue("code", 400);
        assertThatThrownBy(() -> guard.assertEditable(ReviewKind.SALARY, "2024-00", null))
            .isInstanceOf(BizException.class).hasFieldOrPropertyWithValue("code", 400);
    }

    /**
     * assertNoLockedMonth 的「点名最早」建立在 byKindAndScope 的期序上,这里钉住那个顺序。
     *
     * ⚠ 已知天花板(2026-09-07 破坏验证实测):把 mapper 里的 orderByAsc("period") 拿掉,
     * 这条**照样绿**。因为主键是 `kind[:scope]:period`,限定在同一个 (kind, scope) 内主键的
     * 字典序恒等于期序,InnoDB 全扫按主键序返回 —— ORDER BY 是可证明冗余的,任何断言都杀不死它。
     * 这条断言真正能挡的是**主键改形状**(比如换成自增 id):那时候顺序不再免费,它会红。
     */
    @Test
    void mapperOrdersByPeriodAscending() {
        seed("meters:2024-08", "meters", "2024-08", null, "approved");
        seed("meters:2024-02", "meters", "2024-02", null, "approved");
        seed("meters:2024-05", "meters", "2024-05", null, "approved");
        assertThat(states.byKindAndScope("meters", null).stream().map(ReviewState::getPeriod))
            .containsExactly("2024-02", "2024-05", "2024-08");
    }
}
