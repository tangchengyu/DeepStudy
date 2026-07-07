package com.deepstudy.service;

import com.deepstudy.entity.DailyTask;
import com.deepstudy.repository.DailyTaskRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Service
 public class DailyPlanService {

     @Autowired
     private DailyTaskRepository dailyTaskRepository;

     @Transactional(readOnly = true)
     public List<DailyTask> getTodayTasks(String date) {
         if (date == null || date.isEmpty()) {
             date = java.time.LocalDate.now().toString();
         }
         return dailyTaskRepository.findByDateOrderByOrderAsc(date);
     }

     @Transactional
     public DailyTask createTask(DailyTask task) {
         if (task.getDate() == null || task.getDate().isEmpty()) {
             task.setDate(java.time.LocalDate.now().toString());
         }
         if (task.getOrder() == null) {
             Integer maxOrder = dailyTaskRepository.findMaxOrderByDate(task.getDate());
             task.setOrder((maxOrder == null ? 0 : maxOrder) + 1);
         }
         if (task.getId() == null || task.getId().isEmpty()) {
             task.setId(java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 36));
         }
         if (task.getCreatedAt() == 0) {
             task.setCreatedAt(System.currentTimeMillis());
         }
         return dailyTaskRepository.save(task);
     }

     @Transactional
     public DailyTask updateTask(String id, DailyTask updates) {
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

     @Transactional
     public void deleteTask(String id) {
         dailyTaskRepository.deleteById(id);
     }

     @Transactional
     public void reorderTasks(List<DailyTask> tasks) {
         for (int i = 0; i < tasks.size(); i++) {
             DailyTask task = tasks.get(i);
             task.setOrder(i);
         }
         dailyTaskRepository.saveAll(tasks);
     }

     @Transactional
     public void clearCompletedTasks(String date) {
         if (date == null || date.isEmpty()) {
             date = java.time.LocalDate.now().toString();
         }
         dailyTaskRepository.deleteByDateAndDone(date, true);
     }
 }