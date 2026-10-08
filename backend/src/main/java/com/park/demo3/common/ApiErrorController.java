package com.park.demo3.common;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.web.servlet.error.ErrorController;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 没进到我们接口里的错误(地址不存在 404、请求方式不对 405 等)由容器转到 /error。原来那里是 Spring Boot 自带的,
 * 回 {timestamp,status,error,path},跟别的接口的 {code,message,data,traceId} 不一样,还露出后台用的框架
 * (渗透测试 I8 与本地低置信观察 4,2026-10-08 用户「按你建议」)。换成同一个信封,HTTP 状态码照旧。
 * 有了这个 bean,Spring Boot 就不再建自带的那个(BasicErrorController 是 @ConditionalOnMissingBean)。
 * 404 / 405 在本系统里基本只有一种来路:浏览器里还开着旧版页面,调了这一版已经改掉的接口 —— 所以叫人刷新。
 * 显式写 Content-Type:不走内容协商,只收 text/html 的请求(扫描器)也拿到 JSON,不会在错误分派里再抛一次 406。
 */
@RestController
public class ApiErrorController implements ErrorController {

    @RequestMapping("${server.error.path:${error.path:/error}}")
    public ResponseEntity<Result<Void>> error(HttpServletRequest req) {
        int status = req.getAttribute(RequestDispatcher.ERROR_STATUS_CODE) instanceof Integer s ? s : 500;
        String msg = switch (status) {
            case 400 -> ResultCode.BAD_REQUEST.message;
            case 404, 405 -> "页面不是最新的，请刷新后再试";
            default -> status >= 500 ? ResultCode.INTERNAL.message : "请求没有成功";
        };
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(Result.error(status, msg));
    }
}
