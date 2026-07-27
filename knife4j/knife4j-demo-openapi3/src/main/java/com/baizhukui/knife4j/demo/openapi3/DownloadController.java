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


package com.baizhukui.knife4j.demo.openapi3;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/api/download")
@Tag(name = "文件下载", description = "二进制响应与附件响应头示例")
public class DownloadController {

    private static final String FILE_NAME = "knife4j-demo.txt";
    private static final byte[] FILE_CONTENT = "Knife4j download demo\n".getBytes(StandardCharsets.UTF_8);

    @Operation(summary = "下载示例文件", responses = {
            @ApiResponse(responseCode = "200", description = "文件流", headers = @Header(name = HttpHeaders.CONTENT_DISPOSITION, description = "附件文件名", schema = @Schema(type = "string", example = "attachment; filename=\"knife4j-demo.txt\"")), content = @Content(mediaType = MediaType.APPLICATION_OCTET_STREAM_VALUE, schema = @Schema(type = "string", format = "binary")))
    })
    @GetMapping(value = "/sample", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<byte[]> sample() {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(FILE_NAME).build().toString())
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(FILE_CONTENT);
    }
}
