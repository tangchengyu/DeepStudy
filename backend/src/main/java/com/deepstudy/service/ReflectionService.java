package com.deepstudy.service;

import com.deepstudy.entity.ReflectionEntry;
import com.deepstudy.exception.EntityNotFoundException;
import com.deepstudy.repository.ReflectionEntryRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ReflectionService {

    @Autowired
    private ReflectionEntryRepository reflectionEntryRepository;

    @Transactional(readOnly = true)
    public List<ReflectionEntry> getTodayReflections(String date) {
        if (date == null || date.isEmpty()) {
            date = java.time.LocalDate.now().toString();
        }
        return reflectionEntryRepository.findByDateOrderByUpdatedAtDesc(date);
    }

    @Transactional
    public ReflectionEntry createOrUpdateReflection(ReflectionEntry reflection) {
        if (reflection.getId() == null || reflection.getId().isEmpty()) {
            reflection.setId(java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 36));
            reflection.setUpdatedAt(System.currentTimeMillis());
        }
        return reflectionEntryRepository.save(reflection);
    }

    @Transactional
    public ReflectionEntry updateReflection(String id, ReflectionEntry updates) {
        ReflectionEntry reflection = reflectionEntryRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Reflection not found: " + id));
        if (updates.getContent() != null) reflection.setContent(updates.getContent());
        if (updates.getKind() != null) reflection.setKind(updates.getKind());
        if (updates.getUpdatedAt() != 0) reflection.setUpdatedAt(updates.getUpdatedAt());
        if (updates.getSourceTaskIdsJson() != null) {
            reflection.setSourceTaskIdsJson(updates.getSourceTaskIdsJson());
        }
        return reflectionEntryRepository.save(reflection);
    }

    @Transactional
    public void deleteReflection(String id) {
        reflectionEntryRepository.deleteById(id);
    }

    @Transactional
    public ReflectionEntry getOrCreateTodayReflection(String date) {
        if (date == null || date.isEmpty()) {
            date = java.time.LocalDate.now().toString();
        }
        ReflectionEntry existing = reflectionEntryRepository.findByDateOrderByUpdatedAtDesc(date)
                .stream().findFirst().orElse(null);
        if (existing != null) return existing;

        ReflectionEntry newReflection = new ReflectionEntry();
        newReflection.setId(java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 36));
        newReflection.setDate(date);
        newReflection.setContent("");
        newReflection.setKind("daily");
        newReflection.setUpdatedAt(System.currentTimeMillis());
        return reflectionEntryRepository.save(newReflection);
    }

    @Transactional(readOnly = true)
    public List<String> getDistinctReflectionDates() {
        return reflectionEntryRepository.findDistinctDate();
    }
}