package com.deepstudy.service;

import com.deepstudy.entity.CustomNoiseTrack;
import com.deepstudy.exception.EntityNotFoundException;
import com.deepstudy.repository.CustomNoiseTrackRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.UUID;

@Service
public class AudioService {

    @Autowired
    private CustomNoiseTrackRepository customNoiseTrackRepository;

    private final Path noiseDir = Paths.get(System.getProperty("user.dir"), "resources", "audio");

    @Transactional(readOnly = true)
    public List<CustomNoiseTrack> getAllNoiseTracks() {
        return customNoiseTrackRepository.findAllByOrderByCreatedAtDesc();
    }

    @Transactional(readOnly = true)
    public List<CustomNoiseTrack> getDefaultNoiseTracks() {
        // Default tracks are predefined; return static list
        return List.of();
    }

    @Transactional
    public CustomNoiseTrack uploadNoise(MultipartFile file, String type) {
        try {
            String id = UUID.randomUUID().toString().replace("-", "").substring(0, 36);
            String originalName = file.getOriginalFilename();
            String ext = "";
            if (originalName != null && originalName.contains(".")) {
                ext = originalName.substring(originalName.lastIndexOf("."));
            }
            String fileName = id + ext;

            // Ensure directory exists
            if (!Files.exists(noiseDir)) {
                Files.createDirectories(noiseDir);
            }

            Path target = noiseDir.resolve(fileName);
            Files.copy(file.getInputStream(), target);

            CustomNoiseTrack track = new CustomNoiseTrack();
            track.setId(id);
            track.setName(originalName != null ? originalName : fileName);
            track.setType(type != null ? type : "custom");
            track.setSize(file.getSize());
            track.setFileName(fileName);
            track.setCreatedAt(System.currentTimeMillis());

            return customNoiseTrackRepository.save(track);
        } catch (IOException e) {
            throw new RuntimeException("Failed to save noise file: " + e.getMessage(), e);
        }
    }

    @Transactional
    public void deleteNoise(String id) {
        CustomNoiseTrack track = customNoiseTrackRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Noise track not found: " + id));
        try {
            Path file = noiseDir.resolve(track.getFileName());
            Files.deleteIfExists(file);
        } catch (IOException e) {
            // Log but continue with DB deletion
        }
        customNoiseTrackRepository.deleteById(id);
    }

    @Transactional
    public CustomNoiseTrack createDefaultNoiseTrack(String name) {
        CustomNoiseTrack track = new CustomNoiseTrack();
        track.setId(UUID.randomUUID().toString().replace("-", "").substring(0, 36));
        track.setName(name);
        track.setType("default");
        track.setSize(0);
        track.setFileName("");
        return customNoiseTrackRepository.save(track);
    }
}
