package com.deepstudy.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "ds_api_profile")
public class ApiProfile {
    @Id
    @Column(length = 80)
    private String id;

    @Column(length = 80, nullable = false)
    private String label;

    @Column(length = 300, nullable = false)
    private String baseUrl;

    @Column(length = 160, nullable = false)
    private String model;

    @Column(length = 4000)
    private String apiKeyEncrypted;
}
