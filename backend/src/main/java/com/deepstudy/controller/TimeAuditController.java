package com.deepstudy.controller;

import com.deepstudy.entity.TimeAuditEntry;
import com.deepstudy.service.TimeAuditService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/time-audit")
public class TimeAuditController {

    @Autowired
    private TimeAuditService timeAuditService;

    @GetMapping
    public Map<String, Object> getAudit(
            @RequestParam(required = false) Long start,
            @RequestParam(required = false) Long end) {
        long now = System.currentTimeMillis();
        if (start == null) start = now - 24 * 60 * 60 * 1000;
        if (end == null) end = now;
        List<TimeAuditEntry> entries = timeAuditService.getEntriesBetween(start, end);
        return java.util.Map.of("entries", entries, "start", start, "end", end);
    }

    @PostMapping
    public Map<String, Object> createEntry(@RequestBody TimeAuditEntry entry) {
        return java.util.Map.of("entry", timeAuditService.createEntry(entry));
    }

    @PostMapping("/batch")
    public Map<String, Object> batchCreate(@RequestBody List<TimeAuditEntry> entries) {
        return java.util.Map.of("entries", timeAuditService.batchCreate(entries));
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> deleteEntry(@PathVariable String id) {
        timeAuditService.deleteEntry(id);
        return java.util.Map.of("success", true);
    }
}