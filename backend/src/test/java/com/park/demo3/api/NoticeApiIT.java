package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.security.ElevationStore;
import com.park.demo3.service.NoticeService;
import com.park.demo3.service.NoticeService.Kind;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 铃铛「有结果了」与系统类看过(V133,PAGE-BEHAVIOR-SPEC §5.1 第二步 / §5.3 末行)。
 * 整类 @Transactional:消息行随用例回滚,复用的测试库里不留残渣。
 */
@AutoConfigureMockMvc
@Transactional
class NoticeApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired NoticeService notices;
    @Autowired ElevationStore elevations;
    @Autowired JdbcTemplate jdbc;

    private static final String U = "viewer";

    @AfterEach void clear() { SecurityContextHolder.clearContext(); elevations.revokeAll(U); }

    private String login(String user, String pass) throws Exception {
        String body = utf8(mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}")).andReturn().getResponse().getContentAsByteArray());
        return "Bearer " + JsonPath.read(body, "$.data.token");
    }

    private static String utf8(byte[] b) { return new String(b, StandardCharsets.UTF_8); }

    /** 以 who 的身份调 service(写入点在业务请求里跑,当前操作人取自 SecurityContext)。 */
    private void as(String who) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(who, null, List.of()));
    }

    private String get(String url, String tok) throws Exception {
        return utf8(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(url).header("Authorization", tok))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
    }

    private String ping(String tok) throws Exception {
        return utf8(mvc.perform(put("/api/presence/ping").header("Authorization", tok).contentType("application/json")
                .content("{\"sid\":\"it-notice-" + System.nanoTime() + "\",\"scope\":\"probe\",\"label\":\"x\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
    }

    private int rows(String who) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM user_notice WHERE username = ?", Integer.class, who);
    }

    @Test
    void 只留最近30条_新的在前() throws Exception {
        as("admin");
        for (int i = 0; i < 31; i++) notices.add(U, Kind.review_approved, "第 " + i + " 条", null, "ledger:1:2026-08");
        SecurityContextHolder.clearContext();
        assertThat(rows(U)).as("插入后裁到 30,库里不留第 31 条").isEqualTo(30);

        String body = get("/api/notices", login(U, "viewer123"));
        List<Integer> ids = JsonPath.read(body, "$.data[*].id");
        assertThat(ids).hasSize(30);
        Long maxId = jdbc.queryForObject("SELECT MAX(id) FROM user_notice WHERE username = ?", Long.class, U);
        assertThat(ids.get(0).longValue()).as("首条是最新的那条").isEqualTo(maxId);
        assertThat((String) JsonPath.read(body, "$.data[0].title")).isEqualTo("第 30 条");
        assertThat((List<String>) JsonPath.read(body, "$.data[*].title")).doesNotContain("第 0 条");
    }

    /**
     * 只动本人的行:清单、标看过、未看数、裁到 30 条,四处都按 username 过滤。
     * 库里得有第二个收件人的行,删掉任一处过滤才会红 —— 只给一个人写消息时,删了也照绿。
     */
    @Test
    void 只动本人的行_别人的消息不列_不标_不裁() throws Exception {
        // U 发给 admin(不是发给自己,不跳):一条比 U 的 31 条都早(裁 U 时不许裁到它),一条比它们都新(不按人取就排第一)
        as(U);
        notices.add("admin", Kind.review_withdrawn, "给管理员的旧一条", null, null);
        as("admin");
        for (int i = 0; i < 31; i++) notices.add(U, Kind.review_approved, "第 " + i + " 条", null, "ledger:1:2026-08");
        as(U);
        notices.add("admin", Kind.review_withdrawn, "给管理员的新一条", null, null);
        SecurityContextHolder.clearContext();
        String adminRows = "SELECT COUNT(*) FROM user_notice WHERE username = 'admin' AND title LIKE '给管理员的%'";
        String adminUnseen = adminRows + " AND seen_at IS NULL";
        assertThat(jdbc.queryForObject(adminRows, Integer.class)).as("裁 U 的 30 条不许裁到 admin 更早的那条").isEqualTo(2);

        String tok = login(U, "viewer123");
        assertThat((List<String>) JsonPath.read(get("/api/notices", tok), "$.data[*].title"))
            .as("U 的清单里没有发给 admin 的").doesNotContain("给管理员的新一条", "给管理员的旧一条");
        mvc.perform(post("/api/notices/seen").header("Authorization", tok)).andExpect(status().isOk());
        assertThat(jdbc.queryForObject(adminUnseen, Integer.class)).as("U 开铃铛不许把 admin 的标成看过").isEqualTo(2);
        assertThat((Integer) JsonPath.read(ping(tok), "$.data.unseenResults")).as("U 的未看数不算 admin 的").isEqualTo(0);
    }

    @Test
    void 发给自己的不写_系统到期回调照写() {
        int before = rows(U);
        as(U);
        notices.add(U, Kind.perms_changed, "自己改了自己", null, null);
        assertThat(rows(U)).as("自己刚做的事是回执,不是通知").isEqualTo(before);
        // 到期清扫跑在某人的心跳里,那人恰好是请求者时也要写进去
        notices.addAsSystem(U, Kind.approval_timeout, "你请的远程授权超时了", null, null);
        assertThat(rows(U)).isEqualTo(before + 1);
        assertThat(jdbc.queryForObject("SELECT actor FROM user_notice WHERE username = ? ORDER BY id DESC LIMIT 1",
            String.class, U)).as("系统造成的,actor 为空").isNull();
    }

    @Test
    void 列表带造成者显示名() throws Exception {
        as("admin");
        notices.add(U, Kind.review_withdrawn, "附表6 光伏 2026 的审核被撤销", "上网电量改按新口径", "pv:2026-01");
        SecurityContextHolder.clearContext();
        String body = get("/api/notices", login(U, "viewer123"));
        String adminName = jdbc.queryForObject("SELECT display_name FROM auth_user WHERE username = 'admin'", String.class);
        assertThat((String) JsonPath.read(body, "$.data[0].actor")).isEqualTo("admin");
        assertThat((String) JsonPath.read(body, "$.data[0].actorName")).isEqualTo(adminName);
        assertThat((String) JsonPath.read(body, "$.data[0].detail")).isEqualTo("上网电量改按新口径");
        assertThat((String) JsonPath.read(body, "$.data[0].kind")).isEqualTo("review_withdrawn");
        assertThat((Boolean) JsonPath.read(body, "$.data[0].seen")).isFalse();
    }

    @Test
    void 心跳带未看条数_打开铃铛后归零() throws Exception {
        String tok = login(U, "viewer123");
        mvc.perform(post("/api/notices/seen").header("Authorization", tok)).andExpect(status().isOk());
        as("admin");
        notices.add(U, Kind.approval_approved, "王主管批准了你的授权", null, null);
        notices.add(U, Kind.bill_unconfirmed, "陈会计取消确认了联塑精铟 9 月的催缴单", "租金按新合同重算", "bill-notices:2026-09");
        SecurityContextHolder.clearContext();

        assertThat((Integer) JsonPath.read(ping(tok), "$.data.unseenResults")).isEqualTo(2);
        mvc.perform(post("/api/notices/seen").header("Authorization", tok)).andExpect(status().isOk());
        assertThat((Integer) JsonPath.read(ping(tok), "$.data.unseenResults")).isEqualTo(0);
        assertThat((List<Boolean>) JsonPath.read(get("/api/notices", tok), "$.data[*].seen")).containsOnly(true);
    }

    @Test
    void 心跳带授权是否还在() throws Exception {
        String tok = login(U, "viewer123");
        assertThat((Boolean) JsonPath.read(ping(tok), "$.data.elevated")).isFalse();
        elevations.grant(U, List.of("entry:edit"), "admin", ElevationStore.ONSITE);
        assertThat((Boolean) JsonPath.read(ping(tok), "$.data.elevated")).isTrue();
        // 被系统提前收回(停用某人 / 改角色时 reload 清掉所有人的)
        elevations.revokeAllUsers();
        assertThat((Boolean) JsonPath.read(ping(tok), "$.data.elevated")).isFalse();
    }

    @Test
    void 系统类看过存服务端_两项互不覆盖_心跳带回() throws Exception {
        String tok = login(U, "viewer123");
        mvc.perform(post("/api/notices/system-seen").header("Authorization", tok).contentType("application/json")
                .content("{\"changelogVersion\":\"0.25.0\"}")).andExpect(status().isOk());
        mvc.perform(post("/api/notices/system-seen").header("Authorization", tok).contentType("application/json")
                .content("{\"bellKey\":\"v0.26.0|0.25.0\"}")).andExpect(status().isOk());

        String got = get("/api/notices/system-seen", tok);
        assertThat((String) JsonPath.read(got, "$.data.changelogVersion")).as("只写 bellKey 不许把版本号冲掉").isEqualTo("0.25.0");
        assertThat((String) JsonPath.read(got, "$.data.bellKey")).isEqualTo("v0.26.0|0.25.0");

        String p = ping(tok);
        assertThat((String) JsonPath.read(p, "$.data.systemSeen.changelogVersion")).isEqualTo("0.25.0");
        assertThat((String) JsonPath.read(p, "$.data.systemSeen.bellKey")).isEqualTo("v0.26.0|0.25.0");
    }
}
