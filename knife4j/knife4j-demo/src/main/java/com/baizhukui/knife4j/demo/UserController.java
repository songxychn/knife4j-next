/*
 * Copyright © 2017-2023 Knife4j(xiaoymin@foxmail.com)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


package com.baizhukui.knife4j.demo;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Tag(name = "用户接口", description = "用户相关示例接口")
@RestController
@RequestMapping("/api/user")
public class UserController {
    
    @Operation(summary = "获取用户列表")
    @GetMapping("/list")
    public List<Map<String, Object>> list() {
        return List.of(
                Map.of("id", 1, "name", "张三", "email", "zhangsan@example.com"),
                Map.of("id", 2, "name", "李四", "email", "lisi@example.com"));
    }
    
    @Operation(summary = "根据 ID 获取用户")
    @GetMapping("/{id}")
    public Map<String, Object> getById(
                                       @Parameter(description = "用户 ID") @PathVariable Long id) {
        return Map.of("id", id, "name", "张三", "email", "zhangsan@example.com");
    }
    
    @Operation(summary = "创建用户")
    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        body.put("id", 3);
        return body;
    }
    
    @Operation(summary = "删除用户")
    @DeleteMapping("/{id}")
    public Map<String, Object> delete(
                                      @Parameter(description = "用户 ID") @PathVariable Long id) {
        return Map.of("success", true, "id", id);
    }
}
