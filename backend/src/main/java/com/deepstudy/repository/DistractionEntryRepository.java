package com.deepstudy.repository;

import com.deepstudy.entity.DistractionEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DistractionEntryRepository extends JpaRepository<DistractionEntry, String> {
    List<DistractionEntry> findByDateOrderByTimestampDesc(String date);
    List<DistractionEntry> findByTimestampBetween(long start, long end);
}
