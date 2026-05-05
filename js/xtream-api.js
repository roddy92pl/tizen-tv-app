/**
 * xtream-api.js – Xtream Codes API client
 * Handles authentication, data fetching with caching and error handling.
 */
const XtreamAPI = (() => {
    let _config = { serverUrl: '', username: '', password: '' };

    const CACHE_TTL = {
        categories: 30 * 60 * 1000,   // 30 minutes
        streams:    15 * 60 * 1000,   // 15 minutes
        series:     15 * 60 * 1000,
        epg:         5 * 60 * 1000,   // 5 minutes
        account:    10 * 60 * 1000,
        seriesInfo: 60 * 60 * 1000    // 1 hour
    };

    const DEFAULT_EXT = { live: 'ts', vod: 'mp4', series: 'mkv' };

    /* ---------- Init ---------- */
    function init(serverUrl, username, password) {
        _config.serverUrl = serverUrl.replace(/\/$/, '');
        _config.username  = username;
        _config.password  = password;
    }

    /* ---------- URL Builders ---------- */
    function _apiUrl(extraParams) {
        const base = `${_config.serverUrl}/player_api.php?username=${encodeURIComponent(_config.username)}&password=${encodeURIComponent(_config.password)}`;
        if (!extraParams) return base;
        const qs = Object.entries(extraParams)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');
        return `${base}&${qs}`;
    }

    function getLiveStreamUrl(streamId, ext) {
        const e = ext || DEFAULT_EXT.live;
        return `${_config.serverUrl}/live/${encodeURIComponent(_config.username)}/${encodeURIComponent(_config.password)}/${streamId}.${e}`;
    }
    function getVodStreamUrl(streamId, ext) {
        const e = ext || DEFAULT_EXT.vod;
        return `${_config.serverUrl}/movie/${encodeURIComponent(_config.username)}/${encodeURIComponent(_config.password)}/${streamId}.${e}`;
    }
    function getSeriesStreamUrl(streamId, ext) {
        const e = ext || DEFAULT_EXT.series;
        return `${_config.serverUrl}/series/${encodeURIComponent(_config.username)}/${encodeURIComponent(_config.password)}/${streamId}.${e}`;
    }

    /* ---------- HTTP Fetch with timeout ---------- */
    async function _fetch(url, timeoutMs) {
        timeoutMs = timeoutMs || 15000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                cache: 'no-store',
                headers: { 'Accept': 'application/json' }
            });
            clearTimeout(timer);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    }

    /* ---------- Cached fetch ---------- */
    async function _cachedFetch(cacheKey, url, ttl) {
        const cached = Storage.getCache(cacheKey);
        if (cached !== null) return cached;
        const data = await _fetch(url);
        Storage.setCache(cacheKey, data, ttl);
        return data;
    }

    /* ---------- API Methods ---------- */

    /** Verify credentials and return account info */
    async function authenticate() {
        const url = _apiUrl();
        const data = await _fetch(url, 10000);
        if (!data || !data.user_info) throw new Error('Invalid server response');
        if (data.user_info.auth === 0 || data.user_info.auth === '0') {
            throw new Error('Authentication failed: wrong username or password');
        }
        return data;
    }

    async function getAccountInfo() {
        const cacheKey = `account_${_config.username}`;
        return _cachedFetch(cacheKey, _apiUrl({ action: 'get_account_info' }), CACHE_TTL.account);
    }

    async function getLiveCategories() {
        const cacheKey = `live_cats_${_config.username}`;
        return _cachedFetch(cacheKey, _apiUrl({ action: 'get_live_categories' }), CACHE_TTL.categories);
    }

    async function getLiveStreams(categoryId) {
        const params = { action: 'get_live_streams' };
        if (categoryId && categoryId !== 'all') params.category_id = categoryId;
        const cacheKey = `live_streams_${_config.username}_${categoryId || 'all'}`;
        return _cachedFetch(cacheKey, _apiUrl(params), CACHE_TTL.streams);
    }

    async function getVodCategories() {
        const cacheKey = `vod_cats_${_config.username}`;
        return _cachedFetch(cacheKey, _apiUrl({ action: 'get_vod_categories' }), CACHE_TTL.categories);
    }

    async function getVodStreams(categoryId) {
        const params = { action: 'get_vod_streams' };
        if (categoryId && categoryId !== 'all') params.category_id = categoryId;
        const cacheKey = `vod_streams_${_config.username}_${categoryId || 'all'}`;
        return _cachedFetch(cacheKey, _apiUrl(params), CACHE_TTL.streams);
    }

    async function getVodInfo(vodId) {
        const cacheKey = `vod_info_${_config.username}_${vodId}`;
        return _cachedFetch(cacheKey, _apiUrl({ action: 'get_vod_info', vod_id: vodId }), CACHE_TTL.seriesInfo);
    }

    async function getSeriesCategories() {
        const cacheKey = `series_cats_${_config.username}`;
        return _cachedFetch(cacheKey, _apiUrl({ action: 'get_series_categories' }), CACHE_TTL.categories);
    }

    async function getSeries(categoryId) {
        const params = { action: 'get_series' };
        if (categoryId && categoryId !== 'all') params.category_id = categoryId;
        const cacheKey = `series_list_${_config.username}_${categoryId || 'all'}`;
        return _cachedFetch(cacheKey, _apiUrl(params), CACHE_TTL.series);
    }

    async function getSeriesInfo(seriesId) {
        const cacheKey = `series_info_${_config.username}_${seriesId}`;
        return _cachedFetch(cacheKey, _apiUrl({ action: 'get_series_info', series_id: seriesId }), CACHE_TTL.seriesInfo);
    }

    async function getEPG(streamId) {
        const cacheKey = `epg_${_config.username}_${streamId}`;
        return _cachedFetch(cacheKey, _apiUrl({ action: 'get_short_epg', stream_id: streamId }), CACHE_TTL.epg);
    }

    async function getLiveEPG(streamId, limit) {
        const params = { action: 'get_short_epg', stream_id: streamId };
        if (limit) params.limit = limit;
        const cacheKey = `live_epg_${_config.username}_${streamId}`;
        return _cachedFetch(cacheKey, _apiUrl(params), CACHE_TTL.epg);
    }

    /** Search across all live streams (client-side, uses cached data) */
    async function searchLive(query) {
        const streams = await getLiveStreams('all');
        const q = query.toLowerCase();
        return (streams || []).filter(s => (s.name || '').toLowerCase().includes(q));
    }

    /** Search VOD (client-side) */
    async function searchVod(query) {
        const streams = await getVodStreams('all');
        const q = query.toLowerCase();
        return (streams || []).filter(s => (s.name || '').toLowerCase().includes(q));
    }

    /** Search series (client-side) */
    async function searchSeries(query) {
        const series = await getSeries('all');
        const q = query.toLowerCase();
        return (series || []).filter(s => (s.name || '').toLowerCase().includes(q));
    }

    /* ---------- Public ---------- */
    return {
        init,
        authenticate,
        getAccountInfo,
        getLiveCategories, getLiveStreams,
        getVodCategories, getVodStreams, getVodInfo,
        getSeriesCategories, getSeries, getSeriesInfo,
        getEPG, getLiveEPG,
        searchLive, searchVod, searchSeries,
        getLiveStreamUrl, getVodStreamUrl, getSeriesStreamUrl,
        get config() { return { ..._config }; }
    };
})();
