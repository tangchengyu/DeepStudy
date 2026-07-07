package com.deepstudy.service;

import com.deepstudy.entity.ApiProfile;
import com.deepstudy.repository.ApiProfileRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Service
public class AiConfigService {

    @Autowired
    private ApiProfileRepository apiProfileRepository;

    @Transactional(readOnly = true)
    public List<ApiProfile> getProfiles() {
        return apiProfileRepository.findAllByOrderByLabel();
    }

    @Transactional(readOnly = true)
    public Optional<ApiProfile> getActiveProfile() {
        List<ApiProfile> profiles = apiProfileRepository.findAllByOrderByLabel();
        if (profiles.isEmpty()) {
            return Optional.empty();
        }
        // Return last used or first profile as active
        return Optional.of(profiles.get(profiles.size() - 1));
    }

    @Transactional
    public ApiProfile saveProfile(ApiProfile profile) {
        if (profile.getId() == null || profile.getId().isEmpty()) {
            profile.setId(java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 36));
        }
        return apiProfileRepository.save(profile);
    }

    @Transactional
    public void deleteProfile(String id) {
        apiProfileRepository.deleteById(id);
    }

    @Transactional
    public ApiProfile updateProfile(String id, ApiProfile updates) {
        ApiProfile profile = apiProfileRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Profile not found: " + id));
        if (updates.getLabel() != null) profile.setLabel(updates.getLabel());
        if (updates.getBaseUrl() != null) profile.setBaseUrl(updates.getBaseUrl());
        if (updates.getModel() != null) profile.setModel(updates.getModel());
        if (updates.getApiKeyEncrypted() != null) profile.setApiKeyEncrypted(updates.getApiKeyEncrypted());
        return apiProfileRepository.save(profile);
    }
}
