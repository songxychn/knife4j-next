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
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/api/stream")
@Tag(name = "流式接口", description = "SSE 调试示例接口")
public class StreamController {

    private static final long SSE_TIMEOUT_MILLIS = 30_000L;

    @Operation(summary = "SSE 事件流", description = "每隔一段时间推送一条 text/event-stream 事件，用于演示 Knife4j 调试页的 SSE 响应展示。", responses = {
            @ApiResponse(responseCode = "200", description = "SSE 事件流", content = @Content(mediaType = MediaType.TEXT_EVENT_STREAM_VALUE, schema = @Schema(type = "string", example = "data: {\"sequence\":1,\"message\":\"hello knife4j\"}\\n\\n")))
    })
    @GetMapping(value = "/sse", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter sse(
                          @Parameter(description = "事件条数，范围 1-20") @RequestParam(defaultValue = "8") int count,
                          @Parameter(description = "事件间隔毫秒，范围 200-3000") @RequestParam(defaultValue = "1000") long intervalMillis) {
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MILLIS);
        int safeCount = Math.max(1, Math.min(count, 20));
        long safeIntervalMillis = Math.max(200L, Math.min(intervalMillis, 3_000L));

        CompletableFuture.runAsync(() -> {
            try {
                for (int i = 1; i <= safeCount; i++) {
                    Map<String, Object> data = new LinkedHashMap<>();
                    data.put("sequence", i);
                    data.put("message", "hello knife4j");
                    data.put("timestamp", OffsetDateTime.now().toString());

                    emitter.send(SseEmitter.event()
                            .id(String.valueOf(i))
                            .name("tick")
                            .data(data, MediaType.APPLICATION_JSON));
                    Thread.sleep(safeIntervalMillis);
                }
                emitter.complete();
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                emitter.completeWithError(ex);
            } catch (IOException | IllegalStateException ex) {
                emitter.completeWithError(ex);
            }
        });

        return emitter;
    }
}
