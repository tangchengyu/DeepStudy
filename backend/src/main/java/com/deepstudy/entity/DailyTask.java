package com.deepstudy.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "ds_daily_task")
public class DailyTask {
    @Id
    @Column(length = 80)
    private String id;

    @Column(name = "plan_date", length = 10)
    private String date;

    @Column(length = 200)
    private String text;

    @Column
    private Boolean priority = false;

    @Column
    private Boolean done = false;

    @Column(name = "task_order")
    private Integer order;

    @Column(name = "created_at")
    private long createdAt;

    @Column(name = "completed_at")
    private Long completedAt;

    @PrePersist
    public void prePersist() {
        if (createdAt == 0) createdAt = System.currentTimeMillis();
    }
}
