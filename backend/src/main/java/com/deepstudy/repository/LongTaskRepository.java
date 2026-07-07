package com.deepstudy.repository;

import com.deepstudy.entity.LongTask;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface LongTaskRepository extends JpaRepository<LongTask, String> {
    List<LongTask> findByStatusOrderByOrderAsc(String status);
    List<LongTask> findByQuadrantAndStatus(String quadrant, String status);
}
