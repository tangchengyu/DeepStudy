package com.deepstudy.service;

import com.deepstudy.entity.DistractionEntry;
import com.deepstudy.repository.DistractionEntryRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class DistractionService {

    @Autowired
    private DistractionEntryRepository distractionEntryRepository;

    @Transactional(readOnly = true)
    public List<DistractionEntry> getTodayDistractions(String date) {
        return distractionEntryRepository.findByDateOrderByTimestampDesc(date);
    }

    @Transactional
    public DistractionEntry addDistraction(DistractionEntry entry) {
        if (entry.getTimestamp() == 0) entry.setTimestamp(System.currentTimeMillis());
        return distractionEntryRepository.save(entry);
    }

    @Transactional
    public void deleteDistraction(String id) {
        distractionEntryRepository.deleteById(id);
    }

    @Transactional
    public DistractionEntry updateDistraction(String id, DistractionEntry updates) {
        DistractionEntry entry = distractionEntryRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Distraction not found: " + id));
        if (updates.getText() != null) entry.setText(updates.getText());
        if (updates.getResolved() != null) entry.setResolved(updates.getResolved());
        if (updates.getDurationMs() != 0) entry.setDurationMs(updates.getDurationMs());
        return distractionEntryRepository.save(entry);
    }

    @Transactional
    public List<DistractionEntry> getDistractionsBetween(long start, long end) {
        return distractionEntryRepository.findByTimestampBetween(start, end);
    }
}