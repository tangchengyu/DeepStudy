package com.deepstudy.controller;

import com.deepstudy.dto.ApiResponse;
import com.deepstudy.entity.ApiProfile;
import com.deepstudy.service.AiConfigService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/ai")
public class AiController {

    @Autowired
    private AiConfigService aiConfigService;

    @GetMapping("/config")
    public ApiResponse<ApiProfile> getConfig(@RequestParam(required = false, defaultValue = "planner") String scope) {
        return ApiResponse.success(aiConfigService.getActiveProfile().orElse(null));
    }

    @PostMapping("/config")
    public ApiResponse<ApiProfile> saveConfig(@RequestBody Map<String, Object> body) {
        ApiProfile profile = new ApiProfile();
        Object id = body.get("id");
        if (id != null) profile.setId((String) id);
        profile.setLabel((String) body.getOrDefault("label", scopeLabel((String) body.get("scope"))));
        profile.setBaseUrl((String) body.get("baseUrl"));
        profile.setModel((String) body.get("model"));
        profile.setApiKeyEncrypted((String) body.get("apiKey"));
        return ApiResponse.success(aiConfigService.saveProfile(profile));
    }

    @GetMapping("/profiles")
    public ApiResponse<List<ApiProfile>> getProfiles() {
        return ApiResponse.success(aiConfigService.getProfiles());
    }

    @DeleteMapping("/profiles/{id}")
    public ApiResponse<Void> deleteProfile(
            @PathVariable String id, @RequestParam(required = false) String scope) {
        aiConfigService.deleteProfile(id);
        return ApiResponse.success();
    }

    @PostMapping("/planner")
    public ApiResponse<Map<String, Object>> plannerChat(@RequestBody Map<String, Object> payload) {
        // Placeholder: real implementation would call the configured model endpoint.
        try {
            String message = (String) payload.getOrDefault("message", "");
            List<Map<String, Object>> history = (List<Map<String, Object>>) payload.get("history");
            List<Map<String, Object>> tasks = (List<Map<String, Object>>) payload.get("tasks");

            // TODO: Call actual model service.
            Map<String, Object> result = new java.util.HashMap<>();
            result.put("reply", "已收到你的规划请求。基于你当前的" + (tasks == null ? 0 : tasks.size())
                    + "个长期任务，建议先从重要且紧急的事项开始，并为核心目标设定明确的下一步行动。");
            result.put("ops", java.util.List.of());
            result.put("mode", "planner");
            return ApiResponse.success(result);
        } catch (Exception e) {
            return ApiResponse.error("AI planner failed: " + e.getMessage());
        }
    }

    private String scopeLabel(String scope) {
        if (scope == null) return "Planner";
        return switch (scope) {
            case "planner" -> "Planner";
            case "long-ai" -> "Long Task AI";
            default -> scope;
        };
    }
}
