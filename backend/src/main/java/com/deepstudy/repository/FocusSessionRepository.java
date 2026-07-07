package com.deepstudy.repository;

import com.deepstudy.entity.FocusSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface FocusSessionRepository extends JpaRepository<FocusSession, String> {
    List<FocusSession> findByStartTimeBetween(long start, long end);
    List<FocusSession> findByCompleted(boolean completed);
}
