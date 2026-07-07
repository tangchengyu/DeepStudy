package com.deepstudy.service;

import com.deepstudy.entity.TimeAuditEntry;
import com.deepstudy.repository.TimeAuditEntryRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class TimeAuditService {

    @Autowired
    private TimeAuditEntryRepository timeAuditEntryRepository;

    @Transactional(readOnly = true)
    public List<TimeAuditEntry> getEntriesBetween(long start, long end) {
        return timeAuditEntryRepository.findByStartBetweenOrEndBetween(start, end, start, end);
    }

    @Transactional
    public TimeAuditEntry createEntry(TimeAuditEntry entry) {
        if (entry.getId() == null || entry.getId().isEmpty()) {
            entry.setId(java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 36));
        }
        return timeAuditEntryRepository.save(entry);
    }

    @Transactional
    public List<TimeAuditEntry> batchCreate(List<TimeAuditEntry> entries) {
        entries.forEach(entry -> {
            if (entry.getId() == null || entry.getId().isEmpty()) {
                entry.setId(java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 36));
            }
        });
        return timeAuditEntryRepository.saveAll(entries);
    }

    @Transactional
    public void deleteEntry(String id) {
        timeAuditEntryRepository.deleteById(id);
    }
}
