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

import com.baizhukui.knife4j.demo.dto.UploadMetaDTO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Encoding;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.parameters.RequestBody;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/**
 * 演示 multipart/form-data 同时上传文件和 JSON DTO 的接口（对应 upstream #922 #771 #831）。
 *
 * <p>OAS3 规范中，当 requestBody 的 mediaType 为 multipart/form-data 且某 property 的
 * {@code encoding.contentType = application/json} 时，该 part 应以 JSON 文本框形式提交。
 * 本 Controller 提供两个示例接口覆盖该场景。
 */
@RestController
@RequestMapping("/upload")
@Tag(name = "文件上传", description = "multipart + JSON DTO 上传示例（issue #110）")
public class UploadController {

    /**
     * 单文件 + JSON 元数据上传。
     *
     * <p>meta 字段的 encoding.contentType = application/json，
     * knife4j-ui 应将其渲染为 JSON 文本框而非展开为普通表单字段。
     */
    @PostMapping(value = "/file-with-meta", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(
        summary = "上传文件 + JSON 元数据",
        description = "演示 multipart/form-data 中 meta 字段以 application/json 编码提交（encoding.contentType=application/json）",
        requestBody = @RequestBody(
            content = @Content(
                mediaType = MediaType.MULTIPART_FORM_DATA_VALUE,
                schema = @Schema(implementation = UploadFileWithMetaRequest.class),
                encoding = {
                    @Encoding(name = "meta", contentType = "application/json")
                }
            )
        )
    )
    public ResponseEntity<Map<String, Object>> uploadFileWithMeta(
        @RequestPart("file") MultipartFile file,
        @RequestPart("meta") UploadMetaDTO meta
    ) {
        return ResponseEntity.ok(Map.of(
            "filename", file.getOriginalFilename(),
            "size", file.getSize(),
            "description", meta.getDescription(),
            "category", meta.getCategory(),
            "isPublic", Boolean.TRUE.equals(meta.getIsPublic())
        ));
    }

    /**
     * 多文件 + JSON 元数据上传。
     */
    @PostMapping(value = "/files-with-meta", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(
        summary = "批量上传文件 + JSON 元数据",
        description = "演示多文件 multipart/form-data 中 meta 字段以 application/json 编码提交",
        requestBody = @RequestBody(
            content = @Content(
                mediaType = MediaType.MULTIPART_FORM_DATA_VALUE,
                schema = @Schema(implementation = UploadFilesWithMetaRequest.class),
                encoding = {
                    @Encoding(name = "meta", contentType = "application/json")
                }
            )
        )
    )
    public ResponseEntity<Map<String, Object>> uploadFilesWithMeta(
        @RequestPart("files") MultipartFile[] files,
        @RequestPart("meta") UploadMetaDTO meta
    ) {
        return ResponseEntity.ok(Map.of(
            "count", files.length,
            "description", meta.getDescription(),
            "category", meta.getCategory()
        ));
    }

    // ─── Inner schema classes for Swagger UI ─────────────────────────────────

    @Schema(description = "单文件 + JSON 元数据上传请求体")
    static class UploadFileWithMetaRequest {
        @Schema(description = "上传的文件", type = "string", format = "binary", requiredMode = Schema.RequiredMode.REQUIRED)
        public MultipartFile file;

        @Schema(description = "文件元数据（JSON 格式）", requiredMode = Schema.RequiredMode.REQUIRED)
        public UploadMetaDTO meta;
    }

    @Schema(description = "多文件 + JSON 元数据上传请求体")
    static class UploadFilesWithMetaRequest {
        @Schema(description = "上传的文件列表", type = "array", requiredMode = Schema.RequiredMode.REQUIRED)
        public MultipartFile[] files;

        @Schema(description = "文件元数据（JSON 格式）", requiredMode = Schema.RequiredMode.REQUIRED)
        public UploadMetaDTO meta;
    }
}
