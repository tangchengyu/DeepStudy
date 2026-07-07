package com.deepstudy.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "ds_distraction")
public class DistractionEntry {
    @Id
    @Column(length = 80)
    private String id;

    @Column(name = "entry_date", length = 10)
    private String date;

    @Column(length = 200)
    private String text;

    @Column(length = 20)
    private String control;

    @Column(length = 20)
    private String interest;

    @Column(length = 40)
    private String quadrant;

    @Column(name = "duration_ms")
    private long durationMs;

    @Column
    private Boolean resolved = false;

    @Column
    private long timestamp;

    @PrePersist
    public void prePersist() {
        if (timestamp == 0) timestamp = System.currentTimeMillis();
    }
}
