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

package com.github.xiaoymin.knife4j.smoke.boot4

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.tags.Tag
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@Tag(name = "Kotlin is 前缀字段接口", description = "Boot4 Kotlin is 前缀字段示例接口")
@RestController
@RequestMapping("/api/kotlin-is-prefix-field")
class KotlinIsPrefixFieldController {

    @Operation(summary = "回显 Kotlin isEnabled 字段")
    @PostMapping(path = ["/echo"], consumes = ["application/json"], produces = ["application/json"])
    fun echo(@RequestBody request: KotlinIsPrefixFieldPayload): KotlinIsPrefixFieldPayload = request

    @Operation(summary = "回显显式命名的 Kotlin enabled 字段")
    @PostMapping(path = ["/explicit-json-name/echo"], consumes = ["application/json"], produces = ["application/json"])
    fun explicitJsonNameEcho(
        @RequestBody request: KotlinExplicitJsonNamePayload
    ): KotlinExplicitJsonNamePayload = request
}

@Schema(description = "Kotlin is 前缀字段复现 DTO")
data class KotlinIsPrefixFieldPayload(
    val isEnabled: Boolean
)

@Schema(description = "Kotlin 显式 JSON 字段名 DTO")
data class KotlinExplicitJsonNamePayload(
    @get:JsonProperty("enabled")
    val isEnabled: Boolean
)
