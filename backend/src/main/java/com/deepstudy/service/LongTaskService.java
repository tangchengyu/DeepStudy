package com.deepstudy.service;

import com.deepstudy.entity.LongTask;
import com.deepstudy.repository.LongTaskRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
public class LongTaskService {

    @Autowired
    private LongTaskRepository longTaskRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Transactional(readOnly = true)
    public List<LongTask> getAllActiveTasks() {
        return longTaskRepository.findByStatusOrderByOrderAsc("active");
    }

    @Transactional(readOnly = true)
    public List<LongTask> getAllTasks() {
        return longTaskRepository.findAll();
    }

    @Transactional
    public LongTask createTask(LongTask task) {
        if (task.getId() == null || task.getId().isEmpty()) {
            task.setId(UUID.randomUUID().toString().replace("-", "").substring(0, 36));
        }
        if (task.getCreatedAt() == 0) {
            task.setCreatedAt(System.currentTimeMillis());
        }
        if (task.getUpdatedAt() == 0) {
            task.setUpdatedAt(System.currentTimeMillis());
        }
        if (task.getStatus() == null) {
            task.setStatus("active");
        }
        return longTaskRepository.save(task);
    }

    @Transactional
    public LongTask updateTask(String id, LongTask updates) {
        LongTask task = longTaskRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Long task not found: " + id));
        if (updates.getTitle() != null) task.setTitle(updates.getTitle());
        if (updates.getNotes() != null) task.setNotes(updates.getNotes());
        if (updates.getQuadrant() != null) task.setQuadrant(updates.getQuadrant());
        if (updates.getStatus() != null) task.setStatus(updates.getStatus());
        if (updates.getReminderKind() != null) task.setReminderKind(updates.getReminderKind());
        if (updates.getReminderTime() != null) task.setReminderTime(updates.getReminderTime());
        if (updates.getReminderAt() != null) task.setReminderAt(updates.getReminderAt());
        if (updates.getReminderWeekdaysJson() != null) task.setReminderWeekdaysJson(updates.getReminderWeekdaysJson());
        if (updates.isReminderEnabled() != task.isReminderEnabled()) task.setReminderEnabled(updates.isReminderEnabled());
        task.setUpdatedAt(System.currentTimeMillis());

        if ("completed".equals(updates.getStatus()) && task.getCompletedAt() == null) {
            task.setCompletedAt(System.currentTimeMillis());
        }
        return longTaskRepository.save(task);
    }

    @Transactional
    public void deleteTask(String id) {
        longTaskRepository.deleteById(id);
    }

    @Transactional
    public void reorderTasks(List<LongTask> tasks) {
        for (int i = 0; i < tasks.size(); i++) {
            LongTask task = tasks.get(i);
            task.setOrder(i);
            longTaskRepository.save(task);
        }
    }

    @Transactional
    public LongTask completeTask(String id) {
        LongTask task = longTaskRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Long task not found: " + id));
        task.setStatus("completed");
        task.setCompletedAt(System.currentTimeMillis());
        task.setReminderEnabled(false);
        return longTaskRepository.save(task);
    }

    @Transactional
    public Map<String, Object> aiChat(Map<String, Object> payload) {
        // Placeholder for AI integration - would call actual LLM service
        String taskId = (String) payload.get("taskId");
        String operation = (String) payload.get("operation");
        String prompt = (String) payload.get("prompt");

        // In a real implementation, this would:
        // 1. Load the task context
        // 2. Construct an AI prompt with task details
        // 3. Call LLM API (OpenAI compatible) via configured profile
        // 4. Parse response and return structured suggestions

        return java.util.Map.of(
                "taskId", taskId,
                "operation", operation,
                "suggestions", java.util.List.of(
                        "AI integration placeholder - would suggest breaking down task into smaller steps",
                        "Consider prioritizing quadrant based on urgency and importance"
                ),
                "confidence", 0.8,
                "timestamp", System.currentTimeMillis()
        );
    }

    @Transactional
    public void applyAiOps(List<Map<String, Object>> operations) {
        // Placeholder for applying AI-suggested operations to tasks
        // In real implementation, this would:
        // 1. Validate each operation
        // 2. Apply changes to relevant LongTask entities
        // 3. Save to repository
        // For now, we just log/acknowledge
        operations.forEach(op -> {
            // Process operation (e.g., update task, create subtask, etc.)
            // Actual implementation would go here
        });
    }
}
