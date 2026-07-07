package com.deepstudy.controller;

import com.deepstudy.dto.ApiResponse;
import com.deepstudy.entity.CustomNoiseTrack;
import com.deepstudy.service.AudioService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/audio")
public class AudioController {

    @Autowired
    private AudioService audioService;

    @GetMapping("/tracks")
    public ApiResponse<List<CustomNoiseTrack>> getNoiseTracks() {
        return ApiResponse.success(audioService.getAllNoiseTracks());
    }

    @PostMapping("/upload")
    public ApiResponse<CustomNoiseTrack> uploadNoise(
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false, defaultValue = "custom") String type) {
        return ApiResponse.success(audioService.uploadNoise(file, type));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteNoise(@PathVariable String id) {
        audioService.deleteNoise(id);
        return ApiResponse.success();
    }

    @GetMapping("/defaults")
    public ApiResponse<List<CustomNoiseTrack>> getDefaultTracks() {
        return ApiResponse.success(audioService.getDefaultNoiseTracks());
    }

    @GetMapping("/file/{fileName}")
    public ResponseEntity<ByteArrayResource> getNoiseFile(@PathVariable String fileName) {
        byte[] data;
        try {
            data = java.nio.file.Files.readAllBytes(
                    java.nio.file.Paths.get(System.getProperty("user.dir"), "resources", "audio", fileName));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Audio file not found: " + fileName, e);
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(data.length)
                .body(new ByteArrayResource(data));
    }
}
