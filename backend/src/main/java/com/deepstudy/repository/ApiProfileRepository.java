package com.deepstudy.repository;

import com.deepstudy.entity.ApiProfile;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ApiProfileRepository extends JpaRepository<ApiProfile, String> {
    List<ApiProfile> findAllByOrderByLabel();
}
