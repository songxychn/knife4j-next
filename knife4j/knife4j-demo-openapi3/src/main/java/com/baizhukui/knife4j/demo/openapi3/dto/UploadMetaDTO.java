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


package com.baizhukui.knife4j.demo.openapi3.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * 文件上传附带的 JSON 元数据 DTO（用于演示 multipart + JSON part 场景）
 */
@Data
@Schema(description = "文件上传元数据")
public class UploadMetaDTO {

    @Schema(description = "文件描述", example = "用户头像")
    private String description;

    @Schema(description = "文件分类标签", example = "avatar")
    private String category;

    @Schema(description = "是否公开", example = "true")
    private Boolean isPublic;
}
