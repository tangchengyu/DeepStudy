package com.deepstudy.controller;

import com.deepstudy.dto.ApiResponse;
import com.deepstudy.entity.DistractionEntry;
import com.deepstudy.service.DistractionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/distractions")
public class DistractionController {

    @Autowired
    private DistractionService distractionService;

    @GetMapping
    public ApiResponse<List<DistractionEntry>> getDistractions(
            @RequestParam(required = false, defaultValue = "") String date) {
        return ApiResponse.success(distractionService.getTodayDistractions(date));
    }

    @PostMapping
    public ApiResponse<DistractionEntry> addDistraction(@RequestBody DistractionEntry entry) {
        if (entry.getDate() == null || entry.getDate().isEmpty()) {
            entry.setDate(java.time.LocalDate.now().toString());
        }
        return ApiResponse.success(distractionService.addDistraction(entry));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteDistraction(@PathVariable String id) {
        distractionService.deleteDistraction(id);
        return ApiResponse.success();
    }

    @PatchMapping("/{id}")
    public ApiResponse<DistractionEntry> updateDistraction(
            @PathVariable String id, @RequestBody DistractionEntry updates) {
        return ApiResponse.success(distractionService.updateDistraction(id, updates));
    }

    @PatchMapping("/{id}/resolve")
    public ApiResponse<DistractionEntry> resolveDistraction(@PathVariable String id) {
        DistractionEntry updates = new DistractionEntry();
        updates.setResolved(true);
        return ApiResponse.success(distractionService.updateDistraction(id, updates));
    }

    @GetMapping("/range")
    public ApiResponse<List<DistractionEntry>> getDistractionsRange(
            @RequestParam long start, @RequestParam long end) {
        return ApiResponse.success(distractionService.getDistractionsBetween(start, end));
    }
}
