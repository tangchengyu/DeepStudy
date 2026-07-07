package com.deepstudy.service;

import com.deepstudy.entity.SoulQuote;
import com.deepstudy.exception.EntityNotFoundException;
import com.deepstudy.repository.SoulQuoteRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

@Service
public class SoulQuoteService {

    @Autowired
    private SoulQuoteRepository soulQuoteRepository;

    @Transactional(readOnly = true)
    public List<SoulQuote> getAllQuotes() {
        return soulQuoteRepository.findAll();
    }

    @Transactional(readOnly = true)
    public SoulQuote getRandomQuote() {
        long count = soulQuoteRepository.count();
        if (count == 0) {
            // Return default quote if no quotes exist
            SoulQuote defaultQuote = new SoulQuote();
            defaultQuote.setId("default");
            defaultQuote.setText("专注当下，持续进步。");
            defaultQuote.setCreatedAt(System.currentTimeMillis());
            return defaultQuote;
        }
        List<SoulQuote> all = soulQuoteRepository.findAll();
        int index = ThreadLocalRandom.current().nextInt(all.size());
        return all.get(index);
    }

    @Transactional
    public SoulQuote createQuote(SoulQuote quote) {
        if (quote.getId() == null || quote.getId().isEmpty()) {
            quote.setId(java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 36));
        }
        return soulQuoteRepository.save(quote);
    }

    @Transactional
    public SoulQuote updateQuote(String id, SoulQuote updates) {
        SoulQuote quote = soulQuoteRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Soul quote not found: " + id));
        if (updates.getText() != null) quote.setText(updates.getText());
        return soulQuoteRepository.save(quote);
    }

    @Transactional
    public void deleteQuote(String id) {
        soulQuoteRepository.deleteById(id);
    }
}