package com.park.demo3.dto;
import com.park.demo3.entity.MeterArchiveLog;
import com.park.demo3.entity.MeterAssign;
import com.park.demo3.entity.MeterStatus;
import java.math.BigDecimal;
import java.util.List;
// GET /api/meters/{id}/timeline?ym(METER-TIMELINE-SPEC §1.4 §3.3):一块表的两条链 + 变更记录 + 站在 ym 改归属的两个选项。
//   assign / status 按 from_ym 升序;log 按写入先后倒序。
//   impact.correct = 更正 ym 所在那一段(ym 早于第一行 / 还没有行时为 null);impact.from = 自 ym 起变更。
//   until = 本段最后一个月(含),null = 链尾;locked = 这段月份里冻结的月(SPEC §4),非空时该选项不可用。
//   migrateCopies = 目标行之后紧挨着的、上线时复制的同一份档案的段数(PUT /assign alsoMigrateCopies 会一并更正的)。
//   siblings = 站在 ym 看同楼栋同房号、在册未拆的其它表(同房间一起改)。
public record MeterTimelineDTO(List<MeterAssign> assign, List<MeterStatus> status, List<MeterArchiveLog> log,
                               Impact impact, List<Sibling> siblings) {
    public record Locked(String ym, String reason) {}
    public record Span(String from, String until, List<Locked> locked) {}
    public record Impact(Span correct, Span from, int migrateCopies) {}
    public record Sibling(Integer meterId, String name, String kind, String tenantName) {}
    /** PUT /assign 的写入摘要:真改了的每一行(没变的不列)。 */
    public record Written(Integer meterId, String fromYm, String until) {}
    /** GET /{id}/status-impact:写这一行状态会影响的区间、冻结月、区间里的非零用量月(停用/拆除后不再计费)、所在公摊池、钉的合同。 */
    public record StatusImpact(String from, String until, List<Locked> locked, List<Usage> readings,
                               List<Pool> pools, String contractNo) {}
    public record Usage(String ym, BigDecimal usage) {}
    public record Pool(Integer id, String name) {}
}
