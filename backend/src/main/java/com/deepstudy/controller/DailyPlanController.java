package com.deepstudy.controller;

import com.deepstudy.entity.DailyTask;
import com.deepstudy.repository.DailyTaskRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/plans")
public class DailyPlanController {

    @Autowired
    private DailyTaskRepository dailyTaskRepository;

    @GetMapping
    public List<DailyTask> getTodayPlan(@RequestParam(required = false, defaultValue = "") String date) {
        if (date == null || date.isEmpty()) {
            date = java.time.LocalDate.now().toString();
        }
        return dailyTaskRepository.findByDateOrderByOrderAsc(date);
    }

    @PostMapping
    public DailyTask addTask(@RequestBody DailyTask task) {
        if (task.getDate() == null || task.getDate().isEmpty()) {
            task.setDate(java.time.LocalDate.now().toString());
        }
        if (task.getOrder() == null) {
            // Set order to max + 1
            List<DailyTask> existing = dailyTaskRepository.findByDateOrderByOrderAsc(task.getDate());
            int maxOrder = existing.isEmpty() ? 0 : existing.get(existing.size() - 1).getOrder();
            task.setOrder(maxOrder + 1);
        }
        if (task.getId() == null || task.getId().isEmpty()) {
            task.setId(java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 16));
        }
        if (task.getCreatedAt() == 0) {
            task.setCreatedAt(System.currentTimeMillis());
        }
        return dailyTaskRepository.save(task);
    }

    @PatchMapping("/{id}")
    public DailyTask updateTask(@PathVariable String id, @RequestBody DailyTask updates) {
        DailyTask task = dailyTaskRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Task not found: " + id));
        if (updates.getText() != null) task.setText(updates.getText());
        if (updates.getPriority() != null) task.setPriority(updates.getPriority());
        if (updates.getDone() != null) {
            task.setDone(updates.getDone());
            if (updates.getDone()) {
                task.setCompletedAt(System.currentTimeMillis());
            } else {
                task.setCompletedAt(null);
            }
        }
        if (updates.getOrder() != null) task.setOrder(updates.getOrder());
        return dailyTaskRepository.save(task);
    }

    @DeleteMapping("/{id}")
    public String deleteTask(@PathVariable String id) {
        dailyTaskRepository.deleteById(id);
        return "{}";
    }

    @PostMapping("/reorder")
    public String reorderTasks(@RequestBody List<DailyTask> tasks) {
        for (int i = 0; i < tasks.size(); i++) {
            DailyTask task = tasks.get(i);
            task.setOrder(i);
            dailyTaskRepository.save(task);
        }
        return "{}";
    }

    @PostMapping("/clear-completed")
    public String clearCompleted(@RequestBody Map<String, String> body) {
        String date = body.getOrDefault("date", java.time.LocalDate.now().toString());
        List<DailyTask> completed = dailyTaskRepository.findByDateAndDone(date, true);
        dailyTaskRepository.deleteAll(completed);
        return "{}";
    }

    @DeleteMapping("/reset")
    public String resetPlan(@RequestParam(required = false, defaultValue = "") String date) {
        if (date.isEmpty()) date = java.time.LocalDate.now().toString();
        // Delete all tasks for this date
        List<DailyTask> all = dailyTaskRepository.findByDateOrderByOrderAsc(date);
        dailyTaskRepository.deleteAll(all);
        return "{}";
    }
}
