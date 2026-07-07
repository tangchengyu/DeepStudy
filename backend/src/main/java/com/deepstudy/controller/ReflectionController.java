package com.deepstudy.controller;

import com.deepstudy.dto.ApiResponse;
import com.deepstudy.entity.ReflectionEntry;
import com.deepstudy.service.ReflectionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/reflections")
public class ReflectionController {

    @Autowired
    private ReflectionService reflectionService;

    @GetMapping
    public ApiResponse<List<ReflectionEntry>> getReflections(
            @RequestParam(required = false, defaultValue = "") String date) {
        if (date.isEmpty()) {
            date = java.time.LocalDate.now().toString();
        }
        return ApiResponse.success(reflectionService.getTodayReflections(date));
    }

    @PostMapping
    public ApiResponse<ReflectionEntry> saveReflection(@RequestBody ReflectionEntry reflection) {
        return ApiResponse.success(reflectionService.createOrUpdateReflection(reflection));
    }

    @PatchMapping("/{id}")
    public ApiResponse<ReflectionEntry> updateReflection(
            @PathVariable String id, @RequestBody ReflectionEntry updates) {
        return ApiResponse.success(reflectionService.updateReflection(id, updates));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteReflection(@PathVariable String id) {
        reflectionService.deleteReflection(id);
        return ApiResponse.success();
    }

    @GetMapping("/{id}/export")
    public ResponseEntity<String> exportReflection(@PathVariable String id) {
        ReflectionEntry reflection = reflectionService.getTodayReflections("")
                .stream().filter(r -> r.getId().equals(id)).findFirst()
                .orElseThrow(() -> new RuntimeException("Reflection not found: " + id));
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"reflection-" + reflection.getDate() + ".txt\"")
                .contentType(MediaType.TEXT_PLAIN)
                .body("Date: " + reflection.getDate() + "\n\n" + reflection.getContent());
    }

    @GetMapping("/dates")
    public ApiResponse<List<String>> getReflectionDates() {
        return ApiResponse.success(reflectionService.getDistinctReflectionDates());
    }
}