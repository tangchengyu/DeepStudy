package com.deepstudy.repository;

import com.deepstudy.entity.TimeAuditEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TimeAuditEntryRepository extends JpaRepository<TimeAuditEntry, String> {
    List<TimeAuditEntry> findByStartBetweenOrEndBetween(long start1, long end1, long start2, long end2);
}
