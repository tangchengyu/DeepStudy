package com.deepstudy.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "ds_long_task")
public class LongTask {
    @Id
    @Column(length = 80)
    private String id;

    @Column(length = 120, nullable = false)
    private String title;

    @Column(length = 1000)
    private String notes;

    @Column(length = 40)
    private String quadrant;

    @Column(length = 20)
    private String status;

    @Column(name = "task_order")
    private int order;

    @Column(name = "reminder_kind", length = 20)
    private String reminderKind;

    @Column(name = "reminder_time", length = 5)
    private String reminderTime;

    @Column(name = "reminder_at", length = 40)
    private String reminderAt;

    @Column(name = "reminder_weekdays_json", length = 100)
    private String reminderWeekdaysJson;

    @Column(name = "reminder_enabled")
    private boolean reminderEnabled;

    @Column(name = "reminder_last_triggered_at")
    private Long reminderLastTriggeredAt;

    @Column(name = "created_at")
    private long createdAt;

    @Column(name = "updated_at")
    private long updatedAt;

    @Column(name = "completed_at")
    private Long completedAt;

    @Column(name = "planned_at")
    private Long plannedAt;

    @PrePersist
    public void prePersist() {
        long now = System.currentTimeMillis();
        if (createdAt == 0) createdAt = now;
        if (updatedAt == 0) updatedAt = now;
    }
}
