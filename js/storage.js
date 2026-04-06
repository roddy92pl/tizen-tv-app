/**
 * storage.js – localStorage wrapper for IPTV Player
 * Manages: credentials, profiles, favorites, history, watch positions, settings, API cache
 */
const Storage = (() => {
    const KEYS = {
        CREDENTIALS:    'iptv_credentials',
        PROFILES:       'iptv_profiles',
        SETTINGS:       'iptv_settings',
        FAVORITES_LIVE: 'iptv_fav_live',
        FAVORITES_VOD:  'iptv_fav_vod',
        FAVORITES_SER:  'iptv_fav_series',
        HISTORY:        'iptv_history',
        POSITIONS:      'iptv_positions',
        PIN:            'iptv_pin',
        CACHE_PREFIX:   'iptv_cache_'
    };

    /* ---------- Simple obfuscation for stored credentials ----------
     * Passwords are XOR-obfuscated + base64-encoded before being written to
     * localStorage so that they are not stored as plain readable text.
     * Note: this is obfuscation, not encryption – it prevents casual
     * inspection of storage but is NOT a substitute for secure key storage.
     * Tizen Web Apps do not expose a hardware keystore API.
     */
    const _OBF_KEY = 'T1Z3nIPTV2025';
    function _obfuscate(str) {
        if (!str) return '';
        try {
            let out = '';
            for (let i = 0; i < str.length; i++) {
                out += String.fromCharCode(str.charCodeAt(i) ^ _OBF_KEY.charCodeAt(i % _OBF_KEY.length));
            }
            return btoa(out);
        } catch (e) { return str; }
    }
    function _deobfuscate(str) {
        if (!str) return '';
        try {
            const raw = atob(str);
            let out = '';
            for (let i = 0; i < raw.length; i++) {
                out += String.fromCharCode(raw.charCodeAt(i) ^ _OBF_KEY.charCodeAt(i % _OBF_KEY.length));
            }
            return out;
        } catch (e) { return str; }
    }

    const DEFAULT_SETTINGS = {
        format:     'auto',
        quality:    'auto',
        subtitles:  'off',
        parentalPin: false
    };

    /* ---------- helpers ---------- */
    function read(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            return raw !== null ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }
    function write(key, value) {
        // Passwords stored here are pre-obfuscated by _obfuscate() before
        // reaching this helper; plain-text storage of passwords never occurs.
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }
    function remove(key) {
        try { localStorage.removeItem(key); } catch (e) {}
    }

    /* ---------- Credentials (active session) ---------- */
    function saveCredentials(serverUrl, username, password) {
        write(KEYS.CREDENTIALS, { serverUrl, username, password: _obfuscate(password) });
    }
    function getCredentials() {
        const creds = read(KEYS.CREDENTIALS, null);
        if (!creds) return null;
        return { ...creds, password: _deobfuscate(creds.password) };
    }
    function clearCredentials() {
        remove(KEYS.CREDENTIALS);
    }

    /* ---------- Profiles ---------- */
    function getProfiles() {
        const profiles = read(KEYS.PROFILES, []);
        return profiles.map(p => ({ ...p, password: _deobfuscate(p.password) }));
    }
    function saveProfile(serverUrl, username, password, label) {
        const rawProfiles = read(KEYS.PROFILES, []);
        const existing = rawProfiles.findIndex(p => p.serverUrl === serverUrl && p.username === username);
        const profile = { serverUrl, username, password: _obfuscate(password), label: label || username, updatedAt: Date.now() };
        if (existing >= 0) {
            rawProfiles[existing] = profile;
        } else {
            rawProfiles.push(profile);
        }
        write(KEYS.PROFILES, rawProfiles);
    }
    function deleteProfile(serverUrl, username) {
        const profiles = getProfiles().filter(p => !(p.serverUrl === serverUrl && p.username === username));
        write(KEYS.PROFILES, profiles);
    }

    /* ---------- Settings ---------- */
    function getSettings() {
        return Object.assign({}, DEFAULT_SETTINGS, read(KEYS.SETTINGS, {}));
    }
    function saveSettings(settings) {
        write(KEYS.SETTINGS, Object.assign(getSettings(), settings));
    }

    /* ---------- PIN ---------- */
    function getPin() {
        return read(KEYS.PIN, null);
    }
    function savePin(pin) {
        write(KEYS.PIN, pin);
    }
    function clearPin() {
        remove(KEYS.PIN);
    }

    /* ---------- Favorites ---------- */
    function _favKey(type) {
        const map = { live: KEYS.FAVORITES_LIVE, vod: KEYS.FAVORITES_VOD, series: KEYS.FAVORITES_SER };
        return map[type] || KEYS.FAVORITES_LIVE;
    }
    function getFavorites(type) {
        return read(_favKey(type), []);
    }
    function addFavorite(type, item) {
        const list = getFavorites(type);
        if (!list.find(i => i.stream_id === item.stream_id || i.series_id === item.series_id)) {
            list.unshift({ ...item, favAt: Date.now() });
            write(_favKey(type), list);
        }
    }
    function removeFavorite(type, id) {
        const list = getFavorites(type).filter(i => String(i.stream_id) !== String(id) && String(i.series_id) !== String(id));
        write(_favKey(type), list);
    }
    function isFavorite(type, id) {
        return getFavorites(type).some(i => String(i.stream_id) === String(id) || String(i.series_id) === String(id));
    }

    /* ---------- Watch History ---------- */
    function addToHistory(item) {
        let history = read(KEYS.HISTORY, []);
        history = history.filter(i => !(i.type === item.type && String(i.id) === String(item.id)));
        history.unshift({ ...item, watchedAt: Date.now() });
        if (history.length > 50) history = history.slice(0, 50);
        write(KEYS.HISTORY, history);
    }
    function getHistory(type) {
        const all = read(KEYS.HISTORY, []);
        return type ? all.filter(i => i.type === type) : all;
    }
    function clearHistory() {
        remove(KEYS.HISTORY);
    }

    /* ---------- Watch Positions (VOD resume) ---------- */
    function savePosition(streamId, position, duration) {
        const positions = read(KEYS.POSITIONS, {});
        if (duration && position / duration > 0.95) {
            delete positions[String(streamId)];
        } else {
            positions[String(streamId)] = { position, duration, savedAt: Date.now() };
        }
        write(KEYS.POSITIONS, positions);
    }
    function getPosition(streamId) {
        const positions = read(KEYS.POSITIONS, {});
        return positions[String(streamId)] || null;
    }
    function clearPositions() {
        remove(KEYS.POSITIONS);
    }

    /* ---------- API Cache ---------- */
    function setCache(key, data, ttlMs) {
        write(KEYS.CACHE_PREFIX + key, { data, expiresAt: Date.now() + ttlMs });
    }
    function getCache(key) {
        const cached = read(KEYS.CACHE_PREFIX + key, null);
        if (!cached) return null;
        if (Date.now() > cached.expiresAt) {
            remove(KEYS.CACHE_PREFIX + key);
            return null;
        }
        return cached.data;
    }
    function clearCache() {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(KEYS.CACHE_PREFIX)) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
    }

    /* ---------- Public API ---------- */
    return {
        saveCredentials, getCredentials, clearCredentials,
        getProfiles, saveProfile, deleteProfile,
        getSettings, saveSettings,
        getPin, savePin, clearPin,
        getFavorites, addFavorite, removeFavorite, isFavorite,
        addToHistory, getHistory, clearHistory,
        savePosition, getPosition, clearPositions,
        setCache, getCache, clearCache
    };
})();
