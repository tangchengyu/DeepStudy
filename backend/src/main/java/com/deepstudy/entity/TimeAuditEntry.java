package com.deepstudy.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "ds_time_audit")
public class TimeAuditEntry {
    @Id
    @Column(length = 80)
    private String id;

    @Column(length = 20)
    private String category;

    @Column(name = "duration_ms")
    private long durationMs;

    @Column(name = "start_ts")
    private long start;

    @Column(name = "end_ts")
    private long end;

    @Column(name = "distraction_id", length = 80)
    private String distractionId;
}
