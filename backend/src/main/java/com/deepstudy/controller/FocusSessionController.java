package com.deepstudy.controller;

import com.deepstudy.dto.ApiResponse;
import com.deepstudy.entity.FocusSession;
import com.deepstudy.service.FocusSessionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

@RestController
@RequestMapping("/focus")
public class FocusSessionController {

    @Autowired
    private FocusSessionService focusSessionService;

    @GetMapping
    public ApiResponse<List<FocusSession>> getActiveSession() {
        FocusSession session = focusSessionService.getActiveSession();
        return ApiResponse.success(session != null ? List.of(session) : List.of());
    }

    @GetMapping("/sessions")
    public ApiResponse<List<FocusSession>> getSessionsByDate(
            @RequestParam(required = false) Long start,
            @RequestParam(required = false) Long end) {
        if (start != null && end != null) {
            List<FocusSession> sessions = focusSessionService.getSessionsByDate(start, end);
            return ApiResponse.success(sessions);
        }
        return ApiResponse.success(focusSessionService.getSessionsForToday(null));
    }

    @PostMapping("/start")
    public ApiResponse<FocusSession> startSession(@RequestBody FocusSession session) {
        FocusSession saved = focusSessionService.startSession(session);
        return ApiResponse.success(saved);
    }

    @PatchMapping("/pause/{id}")
    public ApiResponse<FocusSession> pauseSession(@PathVariable String id) {
        FocusSession session = focusSessionService.pauseSession(id);
        return ApiResponse.success(session);
    }

    @PatchMapping("/resume/{id}")
    public ApiResponse<FocusSession> resumeSession(@PathVariable String id) {
        FocusSession session = focusSessionService.resumeSession(id);
        return ApiResponse.success(session);
    }

    @PatchMapping("/stop/{id}")
    public ApiResponse<FocusSession> stopSession(@PathVariable String id) {
        FocusSession session = focusSessionService.stopSession(id);
        return ApiResponse.success(session);
    }

    @PatchMapping("/{id}")
    public ApiResponse<FocusSession> updateSession(
            @PathVariable String id, @RequestBody FocusSession updates) {
        return ApiResponse.success(focusSessionService.updateSession(id, updates));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteSession(@PathVariable String id) {
        focusSessionService.deleteSession(id);
        return ApiResponse.success();
    }
}