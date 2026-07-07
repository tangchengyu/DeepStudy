package com.deepstudy.repository;

import com.deepstudy.entity.ReflectionEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ReflectionEntryRepository extends JpaRepository<ReflectionEntry, String> {
    List<ReflectionEntry> findByDateOrderByUpdatedAtDesc(String date);

    @Query("SELECT DISTINCT r.date FROM ReflectionEntry r ORDER BY r.date DESC")
    List<String> findDistinctDate();
}
