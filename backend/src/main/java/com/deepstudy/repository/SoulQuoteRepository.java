package com.deepstudy.repository;

import com.deepstudy.entity.SoulQuote;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface SoulQuoteRepository extends JpaRepository<SoulQuote, String> {
    long count();
}
