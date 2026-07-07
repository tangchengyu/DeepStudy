package com.deepstudy.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "ds_reflection")
public class ReflectionEntry {
    @Id
    @Column(length = 80)
    private String id;

    @Column(name = "entry_date", length = 10)
    private String date;

    @Column(length = 2000)
    private String content;

    @Column(length = 40)
    private String kind;

    @Column(name = "updated_at")
    private long updatedAt;

    @Column(name = "source_task_ids", length = 1000)
    private String sourceTaskIdsJson;
}
