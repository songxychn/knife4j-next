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


package com.baizhukui.knife4j.demo.openapi2;

import com.baizhukui.knife4j.demo.openapi2.dto.PageQuery;
import com.baizhukui.knife4j.demo.openapi2.dto.PageResult;
import com.baizhukui.knife4j.demo.openapi2.dto.UserCreateRequest;
import com.baizhukui.knife4j.demo.openapi2.dto.UserUpdateRequest;
import com.baizhukui.knife4j.demo.openapi2.dto.UserVO;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiImplicitParam;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;
import java.util.List;

@Api(tags = "用户接口", description = "用户相关示例接口")
@RestController
@RequestMapping("/api/user")
public class UserController {

    @ApiOperation("获取用户列表")
    @GetMapping("/list")
    public List<UserVO> list() {
        return Arrays.asList(
                new UserVO(1L, "张三", "zhangsan@example.com"),
                new UserVO(2L, "李四", "lisi@example.com"));
    }

    @ApiOperation("分页查询用户")
    @GetMapping("/page")
    public PageResult<UserVO> page(PageQuery query) {
        List<UserVO> data = Arrays.asList(
                new UserVO(1L, "张三", "zhangsan@example.com"),
                new UserVO(2L, "李四", "lisi@example.com"));
        return new PageResult<>(query.getPageNum(), query.getPageSize(), data.size(), data);
    }

    @ApiOperation("根据 ID 获取用户")
    @ApiImplicitParam(name = "id", value = "用户 ID", paramType = "path", dataTypeClass = Long.class, required = true)
    @GetMapping("/{id}")
    public UserVO getById(@PathVariable Long id) {
        return new UserVO(id, "张三", "zhangsan@example.com");
    }

    @ApiOperation("创建用户")
    @PostMapping
    public UserVO create(@RequestBody UserCreateRequest request) {
        return new UserVO(3L, request.getName(), request.getEmail());
    }

    @ApiOperation("更新用户")
    @ApiImplicitParam(name = "id", value = "用户 ID", paramType = "path", dataTypeClass = Long.class, required = true)
    @PutMapping("/{id}")
    public UserVO update(@PathVariable Long id, @RequestBody UserUpdateRequest request) {
        return new UserVO(id, request.getName(), request.getEmail());
    }

    @ApiOperation("删除用户")
    @ApiImplicitParam(name = "id", value = "用户 ID", paramType = "path", dataTypeClass = Long.class, required = true)
    @DeleteMapping("/{id}")
    public UserVO delete(@PathVariable Long id) {
        return new UserVO(id, "张三", "zhangsan@example.com");
    }
}
