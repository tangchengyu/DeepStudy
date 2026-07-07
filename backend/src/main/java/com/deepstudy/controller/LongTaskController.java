package com.deepstudy.controller;

import com.deepstudy.dto.ApiResponse;
import com.deepstudy.entity.LongTask;
import com.deepstudy.service.LongTaskService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/long-tasks")
public class LongTaskController {

    @Autowired
    private LongTaskService longTaskService;

    @Autowired
    private ObjectMapper objectMapper;

    @GetMapping
    public ApiResponse<List<LongTask>> getLongTasks() {
        return ApiResponse.success(longTaskService.getAllActiveTasks());
    }

    @GetMapping("/all")
    public ApiResponse<List<LongTask>> getAllLongTasks() {
        return ApiResponse.success(longTaskService.getAllTasks());
    }

    @PostMapping
    public ApiResponse<LongTask> createLongTask(@RequestBody LongTask task) {
        return ApiResponse.success(longTaskService.createTask(task));
    }

    @PatchMapping("/{id}")
    public ApiResponse<LongTask> updateLongTask(
            @PathVariable String id, @RequestBody LongTask updates) {
        return ApiResponse.success(longTaskService.updateTask(id, updates));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteLongTask(@PathVariable String id) {
        longTaskService.deleteTask(id);
        return ApiResponse.success();
    }

    @PostMapping("/reorder")
    public ApiResponse<Void> reorderLongTasks(@RequestBody List<LongTask> tasks) {
        longTaskService.reorderTasks(tasks);
        return ApiResponse.success();
    }

    @PostMapping("/complete/{id}")
    public ApiResponse<LongTask> completeLongTask(@PathVariable String id) {
        return ApiResponse.success(longTaskService.completeTask(id));
    }

    @PostMapping("/ai-chat")
    public ApiResponse<Map<String, Object>> aiChat(@RequestBody Map<String, Object> payload) {
        try {
            // For now, return a simple response indicating we'd integrate with AI
            // The actual AI call would be handled by a service
            String taskId = (String) payload.get("taskId");
            String operation = (String) payload.get("operation");
            String prompt = (String) payload.get("prompt");

            // TODO: Actually call AI service
            Map<String, Object> result = java.util.Map.of(
                    "taskId", taskId,
                    "operation", operation,
                    "suggestions", java.util.List.of(
                            "AI integration placeholder - would suggest breaking down task into smaller steps",
                            "Consider prioritizing quadrant based on urgency and importance"
                    ),
                    "confidence", 0.8
            );

            return ApiResponse.success(result);
        } catch (Exception e) {
            return ApiResponse.error("AI processing failed: " + e.getMessage());
        }
    }

    @PostMapping("/ai-apply")
    public ApiResponse<Void> applyAiOps(@RequestBody List<Map<String, Object>> operations) {
        // In real implementation, this would apply AI-suggested changes to tasks
        // For now, just acknowledge receipt
        return ApiResponse.success();
    }
}