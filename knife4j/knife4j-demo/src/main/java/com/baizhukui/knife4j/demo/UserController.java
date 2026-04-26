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

import com.baizhukui.knife4j.demo.dto.PageQuery;
import com.baizhukui.knife4j.demo.dto.PageResult;
import com.baizhukui.knife4j.demo.dto.UserCreateRequest;
import com.baizhukui.knife4j.demo.dto.UserUpdateRequest;
import com.baizhukui.knife4j.demo.dto.UserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springdoc.core.annotations.ParameterObject;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "用户接口", description = "用户相关示例接口")
@RestController
@RequestMapping("/api/user")
public class UserController {

    @Operation(summary = "获取用户列表")
    @GetMapping("/list")
    public List<UserVO> list() {
        return List.of(
                new UserVO(1L, "张三", "zhangsan@example.com"),
                new UserVO(2L, "李四", "lisi@example.com"));
    }

    @Operation(summary = "分页查询用户")
    @GetMapping("/page")
    public PageResult<UserVO> page(@ParameterObject PageQuery query) {
        List<UserVO> data = List.of(
                new UserVO(1L, "张三", "zhangsan@example.com"),
                new UserVO(2L, "李四", "lisi@example.com"));
        return new PageResult<>(query.getPageNum(), query.getPageSize(), data.size(), data);
    }

    @Operation(summary = "根据 ID 获取用户")
    @GetMapping("/{id}")
    public UserVO getById(
                          @Parameter(description = "用户 ID") @PathVariable Long id) {
        return new UserVO(id, "张三", "zhangsan@example.com");
    }

    @Operation(summary = "创建用户")
    @PostMapping
    public UserVO create(@RequestBody UserCreateRequest request) {
        return new UserVO(3L, request.getName(), request.getEmail());
    }

    @Operation(summary = "更新用户")
    @PutMapping("/{id}")
    public UserVO update(
                         @Parameter(description = "用户 ID") @PathVariable Long id,
                         @RequestBody UserUpdateRequest request) {
        return new UserVO(id, request.getName(), request.getEmail());
    }

    @Operation(summary = "删除用户")
    @DeleteMapping("/{id}")
    public UserVO delete(
                         @Parameter(description = "用户 ID") @PathVariable Long id) {
        return new UserVO(id, "张三", "zhangsan@example.com");
    }
}
