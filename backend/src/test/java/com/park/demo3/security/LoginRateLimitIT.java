package com.park.demo3.security;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

// LoginRateLimiter 是单例内存态,整个 JVM 一份、跨测试类共享(共享容器约定)。
// 因此本类一律用自己独有的 X-Forwarded-For 桶 IP,失败计数只打在本类独有的用户名/桶上——
// 一旦把 admin 的默认桶锁死,同 JVM 里几十个靠 admin 登录取 token 的 IT 会集体连坐。
@AutoConfigureMockMvc
class LoginRateLimitIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;

    /** 打一次登录并断言信封 code（业务错走 HTTP 200 + body.code，见 GlobalExceptionHandler 口径） */
    private void login(String ip, String username, String password, int expectCode) throws Exception {
        mvc.perform(post("/api/auth/login").contentType("application/json")
                .header("X-Forwarded-For", ip)
                .content("{\"username\":\"" + username + "\",\"password\":\"" + password + "\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.code").value(expectCode));
    }

    @Test
    void sixthFailureIsRateLimited() throws Exception {
        for (int i = 0; i < 5; i++) login("10.77.0.1", "ratelimit-probe-user", "wrong-pass", 401);
        login("10.77.0.1", "ratelimit-probe-user", "wrong-pass", 429);
        // 同 IP 换用户名不连坐:键是 ip|username 不是纯 ip
        login("10.77.0.1", "ratelimit-probe-other", "wrong-pass", 401);
    }

    @Test
    void successResetsFailureCount() throws Exception {
        for (int i = 0; i < 4; i++) login("10.77.0.2", "admin", "wrong-pass", 401);
        login("10.77.0.2", "admin", "admin123", 0);
        // 清零后重新计数:再错 2 次仍在阈值内。若成功登录没清零(4+2=6 ≥ 5),这两次里第二次就该是 429
        for (int i = 0; i < 2; i++) login("10.77.0.2", "admin", "wrong-pass", 401);
    }
}
