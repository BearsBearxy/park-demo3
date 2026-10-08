package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.security.Perm;
import com.park.demo3.security.ReadAccessManager;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

// 真起 Tomcat:404 / 405 由容器转到 /error,MockMvc 不走这一步(PentestFixesIT 只能直接打 /error)。
// 渗透测试 I8 / 低置信 4、5(2026-10-08,用户 10-09「按你建议」)。
// 破坏验证:删 ApiErrorController → 前两条回 Spring Boot 自带的 {timestamp,status,error,path},红;
//          去掉 ApiErrorController 里的 .contentType(APPLICATION_JSON) → htmlOnlyAccept 那条红;
//          SecurityConfig 改回 getRequestURI().contains("/api/system/") → 第三条红(真 Tomcat 下原始 URI 是 %73ystem)。
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApiErrorEnvelopeIT extends AbstractMysqlIT {

    @LocalServerPort int port;
    private final HttpClient http = HttpClient.newHttpClient();

    private HttpResponse<String> send(HttpRequest.Builder b) throws Exception {
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private HttpRequest.Builder at(String path) { return HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)); }

    @Test
    void wrongMethod_405_sameEnvelope() throws Exception {
        HttpResponse<String> r = send(at("/api/auth/login").GET());
        assertThat(r.statusCode()).isEqualTo(405);
        assertThat((Integer) JsonPath.read(r.body(), "$.code")).isEqualTo(405);
        assertThat(r.body()).doesNotContain("timestamp").doesNotContain("\"path\"");
    }

    @Test
    void noSuchPath_404_sameEnvelope() throws Exception {
        HttpResponse<String> r = send(at("/no-such-thing-xyz").GET());
        assertThat(r.statusCode()).isEqualTo(404);
        assertThat((Integer) JsonPath.read(r.body(), "$.code")).isEqualTo(404);
        assertThat(r.body()).doesNotContain("timestamp");
    }

    // 只收 text/html 的请求(扫描器常这么发)也回 JSON,不在错误分派里再抛 406
    @Test
    void htmlOnlyAccept_stillJson() throws Exception {
        HttpResponse<String> r = send(at("/no-such-thing-xyz").header("Accept", "text/html").GET());
        assertThat(r.statusCode()).isEqualTo(404);
        assertThat(r.headers().firstValue("Content-Type").orElse("")).startsWith("application/json");
        assertThat((String) JsonPath.read(r.body(), "$.message")).isEqualTo("页面不是最新的，请刷新后再试");
    }

    @Test
    void encodedSystemPath_systemMessage() throws Exception {
        String login = send(at("/api/auth/login").header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))).body();
        String token = JsonPath.read(login, "$.data.token");
        HttpResponse<String> r = send(at("/api/%73ystem/users").header("Authorization", "Bearer " + token).GET());
        assertThat(r.statusCode()).isEqualTo(403);
        assertThat((String) JsonPath.read(r.body(), "$.message"))
                .isEqualTo(ReadAccessManager.deniedMessage(List.of(Perm.SYSTEM_VIEW)));
    }
}
