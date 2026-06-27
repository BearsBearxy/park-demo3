package com.park.demo3.controller;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/probe")
public class ProbeController {
    @GetMapping("/ok") public Map<String, String> ok() { return Map.of("hello", "demo3"); }
    @GetMapping("/boom") public String boom() { throw new BizException(ResultCode.NOT_FOUND, "probe not found"); }
}
