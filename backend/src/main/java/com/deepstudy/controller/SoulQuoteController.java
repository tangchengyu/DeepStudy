package com.deepstudy.controller;

import com.deepstudy.dto.ApiResponse;
import com.deepstudy.entity.SoulQuote;
import com.deepstudy.service.SoulQuoteService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/quotes")
public class SoulQuoteController {

    @Autowired
    private SoulQuoteService soulQuoteService;

    @GetMapping("/random")
    public ApiResponse<SoulQuote> getRandomQuote() {
        return ApiResponse.success(soulQuoteService.getRandomQuote());
    }

    @GetMapping
    public ApiResponse<List<SoulQuote>> getAllQuotes() {
        return ApiResponse.success(soulQuoteService.getAllQuotes());
    }

    @PostMapping
    public ApiResponse<SoulQuote> createQuote(@RequestBody SoulQuote quote) {
        return ApiResponse.success(soulQuoteService.createQuote(quote));
    }

    @PatchMapping("/{id}")
    public ApiResponse<SoulQuote> updateQuote(
            @PathVariable String id, @RequestBody SoulQuote updates) {
        return ApiResponse.success(soulQuoteService.updateQuote(id, updates));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteQuote(@PathVariable String id) {
        soulQuoteService.deleteQuote(id);
        return ApiResponse.success();
    }
}