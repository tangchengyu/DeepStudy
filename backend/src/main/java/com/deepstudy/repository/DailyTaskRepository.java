package com.deepstudy.repository;

import com.deepstudy.entity.DailyTask;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DailyTaskRepository extends JpaRepository<DailyTask, String> {
    List<DailyTask> findByDateOrderByOrderAsc(String date);
    List<DailyTask> findByDateAndDone(String date, boolean done);
    void deleteByDate(String date);
    void deleteByDateAndDone(String date, boolean done);

    @Query("SELECT MAX(t.order) FROM DailyTask t WHERE t.date = :date")
    Integer findMaxOrderByDate(@Param("date") String date);
}