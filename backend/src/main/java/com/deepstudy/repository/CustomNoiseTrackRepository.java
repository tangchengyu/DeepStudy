package com.deepstudy.repository;

import com.deepstudy.entity.CustomNoiseTrack;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface CustomNoiseTrackRepository extends JpaRepository<CustomNoiseTrack, String> {
    List<CustomNoiseTrack> findAllByOrderByCreatedAtDesc();
}
