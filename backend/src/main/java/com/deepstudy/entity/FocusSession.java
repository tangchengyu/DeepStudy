package com.deepstudy.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "ds_focus_session")
public class FocusSession {
    @Id
    @Column(length = 80)
    private String id;

    @Column(name = "start_time")
    private long startTime;

    @Column(name = "end_time")
    private long endTime;

    @Column(name = "planned_ms")
    private long plannedMs;

    @Column(name = "focused_ms")
    private long focusedMs;

    @Column(length = 20)
    private String type;

    @Column(name = "types_json", length = 500)
    private String typesJson;

    @Column
    private boolean completed;

    @PrePersist
    public void prePersist() {
        if (startTime == 0) startTime = System.currentTimeMillis();
    }
}
