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

import com.baizhukui.knife4j.demo.openapi2.dto.UploadMetaDTO;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.HashMap;
import java.util.Map;

/**
 * Multipart file upload demo for the OAS2 / Swagger 2 line.
 *
 * <p>Note: Swagger 2 / springfox does not have a first-class equivalent of
 * OAS3 {@code encoding.contentType=application/json}. This Controller still
 * demonstrates the basic multipart form data upload pattern that knife4j
 * Vue3 UI supports for OAS2.
 */
@Api(tags = "文件上传", description = "multipart 文件上传示例")
@RestController
@RequestMapping("/upload")
public class UploadController {

    @ApiOperation("上传单个文件 + JSON 元数据")
    @PostMapping(value = "/file-with-meta", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> uploadFileWithMeta(
                                                                  @RequestPart("file") MultipartFile file,
                                                                  @RequestPart("meta") UploadMetaDTO meta) {
        Map<String, Object> result = new HashMap<>();
        result.put("filename", file.getOriginalFilename());
        result.put("size", file.getSize());
        result.put("description", meta.getDescription());
        result.put("category", meta.getCategory());
        result.put("isPublic", Boolean.TRUE.equals(meta.getIsPublic()));
        return ResponseEntity.ok(result);
    }

    @ApiOperation("批量上传文件 + JSON 元数据")
    @PostMapping(value = "/files-with-meta", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> uploadFilesWithMeta(
                                                                   @RequestPart("files") MultipartFile[] files,
                                                                   @RequestPart("meta") UploadMetaDTO meta) {
        Map<String, Object> result = new HashMap<>();
        result.put("count", files.length);
        result.put("description", meta.getDescription());
        result.put("category", meta.getCategory());
        return ResponseEntity.ok(result);
    }
}
