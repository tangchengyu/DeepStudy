package com.deepstudy.service;

import com.deepstudy.entity.FocusSession;
import com.deepstudy.exception.EntityNotFoundException;
import com.deepstudy.repository.FocusSessionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;

@Service
public class FocusSessionService {

    @Autowired
    private FocusSessionRepository focusSessionRepository;

    @Transactional(readOnly = true)
    public FocusSession getActiveSession() {
        // An active session is one that has started but not completed (endTime == 0)
        return focusSessionRepository.findByCompleted(false).stream()
                .filter(s -> s.getEndTime() == 0)
                .findFirst()
                .orElse(null);
    }

    @Transactional(readOnly = true)
    public List<FocusSession> getSessionsByDate(long start, long end) {
        return focusSessionRepository.findByStartTimeBetween(start, end);
    }

    @Transactional(readOnly = true)
    public List<FocusSession> getSessionsForToday(String date) {
        if (date == null || date.isEmpty()) {
            date = LocalDate.now().toString();
        }
        LocalDate ld = LocalDate.parse(date);
        long start = ld.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
        long end = ld.plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
        return focusSessionRepository.findByStartTimeBetween(start, end);
    }

    @Transactional
    public FocusSession startSession(FocusSession session) {
        if (session.getId() == null || session.getId().isEmpty()) {
            session.setId(java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 36));
        }
        if (session.getStartTime() == 0) {
            session.setStartTime(System.currentTimeMillis());
        }
        session.setCompleted(false);
        return focusSessionRepository.save(session);
    }

    @Transactional
    public FocusSession pauseSession(String id) {
        // Pause is treated as "still active" — frontend tracks pause periods locally.
        // We just record current focusedMs snapshot.
        FocusSession session = focusSessionRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Session not found: " + id));
        if (session.getFocusedMs() == 0) {
            session.setFocusedMs(System.currentTimeMillis() - session.getStartTime());
        }
        return focusSessionRepository.save(session);
    }

    @Transactional
    public FocusSession resumeSession(String id) {
        // Resume resets the start reference for focusedMs accumulation; frontend tracks deltas.
        FocusSession session = focusSessionRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Session not found: " + id));
        return session;
    }

    @Transactional
    public FocusSession stopSession(String id) {
        FocusSession session = focusSessionRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Session not found: " + id));
        long now = System.currentTimeMillis();
        session.setEndTime(now);
        session.setCompleted(true);
        if (session.getFocusedMs() == 0) {
            long elapsed = now - session.getStartTime();
            // Cap focusedMs at planned duration if completed fully
            session.setFocusedMs(session.getPlannedMs() > 0
                    ? Math.min(elapsed, session.getPlannedMs())
                    : elapsed);
        }
        return focusSessionRepository.save(session);
    }

    @Transactional
    public FocusSession updateSession(String id, FocusSession updates) {
        FocusSession session = focusSessionRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Session not found: " + id));
        if (updates.getEndTime() != 0) session.setEndTime(updates.getEndTime());
        if (updates.getPlannedMs() != 0) session.setPlannedMs(updates.getPlannedMs());
        if (updates.getFocusedMs() != 0) session.setFocusedMs(updates.getFocusedMs());
        if (updates.getType() != null) session.setType(updates.getType());
        if (updates.getTypesJson() != null) session.setTypesJson(updates.getTypesJson());
        if (updates.isCompleted()) session.setCompleted(updates.isCompleted());
        return focusSessionRepository.save(session);
    }

    @Transactional
    public void deleteSession(String id) {
        focusSessionRepository.deleteById(id);
    }
}
