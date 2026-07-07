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
@Table(name = "ds_custom_noise")
public class CustomNoiseTrack {
    @Id
    @Column(length = 80)
    private String id;

    @Column(length = 120, nullable = false)
    private String name;

    @Column(length = 80)
    private String type;

    @Column
    private long size;

    @Column(length = 200, nullable = false)
    private String fileName;

    @Column(name = "created_at")
    private long createdAt;

    @PrePersist
    public void prePersist() {
        if (createdAt == 0) createdAt = System.currentTimeMillis();
    }
}
