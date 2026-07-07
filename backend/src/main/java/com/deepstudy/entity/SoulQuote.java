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
@Table(name = "ds_soul_quote")
public class SoulQuote {
    @Id
    @Column(length = 80)
    private String id;

    @Column(length = 240, nullable = false)
    private String text;

    @Column(name = "created_at")
    private long createdAt;

    @PrePersist
    public void prePersist() {
        if (createdAt == 0) createdAt = System.currentTimeMillis();
    }
}
